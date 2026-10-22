/**
 * 02 · Rejoindre avec un code (planche RejoindreCode, états de la planche Matrice) :
 * code collé tout seul, aperçu du salon (GET /v1/rooms/by-code/:code, équipe Parties en
 * ligne), nom pour la partie, session invitée (POST /v1/auth/guest), puis /salon/CODE.
 * États : code inconnu, salon plein → regarder, partie lancée, fermé, pas de réseau (le code
 * est gardé, on réessaie au retour du réseau).
 */
import { ludoSeats } from '@kwatt/design';
import { isValidDisplayNameFormat, normalizeDisplayName, type RoomPreview } from '@kwatt/protocol';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { startGuestSession } from '@/api/client';
import { isApiError, toApiError } from '@/api/errors';
import { accountKeys, accountsApi } from '@/features/accounts/api';
import { FormError, TopBar } from '@/features/accounts/components';
import { roomAvailability, roomLookupProblem, type RoomAvailability } from '@/features/accounts/logic';
import { translateError, useFormat } from '@/i18n';
import { normalizeCodeSegment } from '@/navigation/deepLinks';
import { useIsOffline } from '@/offline';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  Icon,
  isRoomCodeComplete,
  extractRoomCode,
  RoomCodeInput,
  Screen,
  showToast,
  SPACE_FABRIC,
  Text,
  TextField,
} from '@/ui';

/** Aperçu du salon ; sans session, un refus « connecte-toi » ouvre la session invitée puis réessaie. */
async function lookupRoom(code: string, signal: AbortSignal): Promise<RoomPreview> {
  try {
    return await accountsApi.roomByCode(code, true, signal);
  } catch (error) {
    if (isApiError(error) && error.code === 'auth.required') {
      await startGuestSession();
      return accountsApi.roomByCode(code, true, signal);
    }
    throw error;
  }
}

function RoomCard({ room, availability }: { room: RoomPreview; availability: RoomAvailability }) {
  const { t } = useTranslation('accounts');
  const { colors } = useTheme();
  const f = useFormat();
  const headline =
    availability === 'full' ? t('join.full') : availability === 'playing' ? t('join.playing') : t('join.found');
  const headColor = availability === 'found' ? colors.gain : availability === 'full' ? colors.alert : colors.text;
  const meta = [
    t('join.host', { name: room.host.pseudo }),
    t('join.seated', { count: room.seated.length, seats: room.seats }),
    room.queueLength > 0 ? t('join.queue', { count: room.queueLength }) : null,
    t(`join.format.${room.format}`),
    room.stake > 0 ? t('join.stake', { amount: f.cauris(room.stake) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card band={SPACE_FABRIC[room.game]} padding={16} gap={12} radius={18}>
      <View style={styles.cardHead}>
        <Text variant="section" style={{ color: headColor }}>
          {headline}
        </Text>
        <Badge label={t(`join.game.${room.game}`)} />
      </View>
      <Text variant="heading">{room.name}</Text>
      <Text variant="label" tone="muted">
        {meta}
      </Text>
      {room.seated.length > 0 ? (
        <View style={styles.faces} accessible accessibilityLabel={t('join.players', { names: room.seated.map((p) => p.pseudo).join(', ') })}>
          {room.seated.map((player, i) => (
            <View key={player.userId} style={[styles.face, i > 0 ? styles.faceOverlap : null, { borderColor: colors.surface }]}>
              <Avatar
                name={player.pseudo}
                size={30}
                decorative
                tint={room.game === 'ludo' ? ludoSeats[i % ludoSeats.length]?.color : undefined}
              />
            </View>
          ))}
        </View>
      ) : null}
      {availability === 'full' ? (
        <Text variant="small" tone="muted">
          {t('join.fullHint')}
        </Text>
      ) : availability === 'playing' ? (
        <Text variant="small" tone="muted">
          {t('join.playingHint')}
        </Text>
      ) : null}
    </Card>
  );
}

export default function RejoindreScreen() {
  const { t } = useTranslation('accounts');
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ code?: string }>();
  const fromLink = typeof params.code === 'string' ? normalizeCodeSegment(params.code) : '';
  const [code, setCode] = useState(isRoomCodeComplete(fromLink) ? fromLink : '');
  const status = useSession((s) => s.status);
  const isMember = status === 'member';
  const offline = useIsOffline();
  const complete = isRoomCodeComplete(code);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState<'play' | 'watch' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const pasteTried = useRef(false);

  // Collage automatique d'un code copié (planche Matrice : « collage auto du code copié »).
  useEffect(() => {
    if (pasteTried.current || code || Platform.OS === 'web') return;
    pasteTried.current = true;
    void (async () => {
      try {
        if (!(await Clipboard.hasStringAsync())) return;
        const pasted = extractRoomCode(await Clipboard.getStringAsync());
        if (pasted) {
          setCode(pasted);
          showToast(t('join.pasted'), 'info');
        }
      } catch {
        // Presse-papiers illisible : le joueur tape le code.
      }
    })();
  }, [code, t]);

  // Nom déjà donné par l'invité de cet appareil.
  const savedName = useQuery({
    queryKey: accountKeys.displayName,
    queryFn: () => accountsApi.displayName(),
    enabled: status === 'guest',
    staleTime: Infinity,
  });
  useEffect(() => {
    const saved = savedName.data?.displayName;
    if (saved && !nameTouched) setName(saved);
  }, [savedName.data, nameTouched]);

  const room = useQuery({
    queryKey: accountKeys.room(code),
    queryFn: ({ signal }) => lookupRoom(code, signal),
    enabled: complete,
    staleTime: 10_000,
    retry: (count, error) => isApiError(error) && error.isTransient && count < 3,
  });

  const problem = room.isError ? roomLookupProblem(toApiError(room.error)) : complete && offline && !room.data ? 'offline' : null;
  const availability = room.data ? roomAvailability(room.data) : null;
  const usable = availability !== null && availability !== 'closed';
  const canPlay = availability === 'found';
  const nameValid = isMember || isValidDisplayNameFormat(name);
  const nameError = !isMember && nameTouched && name.length > 0 && !isValidDisplayNameFormat(name) ? t('join.nameInvalid') : null;

  let codeError: string | null = null;
  if (problem === 'unknown') codeError = t('join.unknown');
  else if (problem === 'closed' || availability === 'closed') codeError = t('join.closed');

  async function enter(mode: 'play' | 'watch') {
    if (!complete || busy) return;
    setActionError(null);
    setBusy(mode);
    try {
      if (!isMember) {
        if (status === 'signedOut') await startGuestSession();
        const clean = normalizeDisplayName(name);
        if (clean) await accountsApi.setDisplayName(clean);
      }
      router.push(`/salon/${code}${mode === 'watch' ? '?regarder=1' : ''}` as Href);
    } catch (error) {
      setActionError(translateError(error));
    } finally {
      setBusy(null);
    }
  }

  const footer = (
    <>
      {availability === 'full' || availability === 'playing' ? (
        <Button
          label={availability === 'full' ? t('join.watch') : t('join.watchGame')}
          icon="tv"
          loading={busy === 'watch'}
          onPress={() => void enter('watch')}
        />
      ) : (
        <Button
          label={t('join.enter')}
          loading={busy === 'play'}
          disabled={!canPlay || !nameValid}
          onPress={() => {
            setNameTouched(true);
            void enter('play');
          }}
        />
      )}
      <Text variant="caption" tone="muted" align="center">
        {isMember ? t('join.memberNote') : t('join.guestNote')}
      </Text>
    </>
  );

  return (
    <Screen header={<TopBar fallback="/bienvenue" label={isMember ? t('join.memberMode') : t('join.guestMode')} />} footer={footer} gap={22}>
      <View style={styles.titles}>
        <Text variant="display" accessibilityRole="header">
          {t('join.title')}
        </Text>
        <Text variant="body" tone="muted">
          {t('join.lead')}
        </Text>
      </View>

      <RoomCodeInput value={code} onChange={setCode} autoFocus={!code} error={codeError} />

      {complete && room.isFetching && !room.data ? (
        <View style={styles.inline} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.textMuted} />
          <Text variant="label" tone="muted">
            {t('join.searching')}
          </Text>
        </View>
      ) : null}
      {problem === 'offline' ? (
        <View style={styles.inline} accessibilityLiveRegion="polite">
          <Icon name="wifiOff" size={20} color={colors.alert} />
          <Text variant="label" style={styles.flex}>
            {t('join.offline')}
          </Text>
        </View>
      ) : null}
      {problem === 'error' ? <ErrorState compact error={room.error} title={t('join.error')} onRetry={() => void room.refetch()} /> : null}

      {room.data && usable && availability ? <RoomCard room={room.data} availability={availability} /> : null}

      {!isMember && availability !== 'closed' ? (
        <TextField
          label={t('join.nameLabel')}
          placeholder={t('join.namePlaceholder')}
          value={name}
          onChangeText={(text) => {
            setNameTouched(true);
            setName(text);
          }}
          onBlur={() => setNameTouched(true)}
          maxLength={20}
          autoCapitalize="words"
          autoComplete="nickname"
          textContentType="nickname"
          returnKeyType="go"
          onSubmitEditing={() => canPlay && void enter('play')}
          error={nameError}
        />
      ) : null}

      <FormError message={actionError} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  titles: { gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  flex: { flex: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  faces: { flexDirection: 'row' },
  face: { borderWidth: 2, borderRadius: 999 },
  faceOverlap: { marginLeft: -8 },
});
