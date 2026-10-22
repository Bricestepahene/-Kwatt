/**
 * Écran 18 · Fin de partie (planche Resultat), commun aux Dames et au Ludo (contrat C4).
 * Lit d'abord l'historique local, sinon GET /v1/games/:id (C3). Contextes : machine (gains
 * détaillés, série, force +x → niveau), défi (revanche, même mise), salon (roi de la table,
 * aller-retour), ligue ; nulle ; carte gagnée si le serveur en renvoie une ; Ludo : places.
 */
import { levelProgress } from '@kwatt/domain';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { brand, fabrics } from '@kwatt/design';
import { useDynamicT, useFormat } from '../../i18n';
import { useSession } from '../../session';
import { useTheme } from '../../theme';
import { Button, EmptyState, Fabric, Icon, LoadingState, ProgressBar, Screen, Text, type IconName } from '../../ui';
import { useGameSummary } from '../dames/api';
import { useLocalGame } from './history';
import { fromLocalGame, fromSummary, longestCapture, type ResultPlayer, type ResultView } from './resultView';

export function useResult(id: string | undefined): { view: ResultView | null; loading: boolean; moves: string[] } {
  const local = useLocalGame(id);
  const userId = useSession((s) => s.data?.user.id ?? null);
  const summary = useGameSummary(id, local === null);
  if (local) return { view: fromLocalGame(local), loading: false, moves: local.moves };
  if (summary.data) return { view: fromSummary(summary.data, userId), loading: false, moves: summary.data.moves };
  return { view: null, loading: local === undefined || summary.isLoading, moves: [] };
}

export function ResultScreen({ id }: { id: string }) {
  const { t } = useTranslation('dames');
  const { view, loading, moves } = useResult(id);

  if (!view) {
    return (
      <Screen space="hub">
        {loading ? (
          <LoadingState />
        ) : (
          <EmptyState icon="search" title={t('result.notFound')} action={{ label: t('game.backToDames'), onPress: () => router.replace('/jouer/dames') }} />
        )}
      </Screen>
    );
  }
  return <ResultBody view={view} moves={moves} />;
}

function badgeKey(v: ResultView): 'machine' | 'room' | 'defi' | 'league' | 'ludoMachine' | 'ludoRoom' | 'ludoLeague' {
  if (v.family === 'ludo') return v.context === 'machine' ? 'ludoMachine' : v.context === 'league' ? 'ludoLeague' : 'ludoRoom';
  if (v.context === 'machine') return 'machine';
  if (v.context === 'league') return 'league';
  return v.stake > 0 ? 'defi' : 'room';
}

function ResultBody({ view: v, moves }: { view: ResultView; moves: string[] }) {
  const { t } = useTranslation('dames');
  const td = useDynamicT();
  const f = useFormat();
  const { colors } = useTheme();
  const win = v.verdict === 'win';
  const space = v.family === 'ludo' ? '/jouer/ludo' : '/jouer/dames';
  const opponentName = (p: ResultPlayer | null) =>
    p?.machine ? t('result.machineOpponent', { level: t(`difficulty.${p.machine as 'facile'}`) }) : (p?.name ?? '');

  // Titre et sous-titre.
  const title =
    v.family === 'ludo' && v.playerCount > 2
      ? v.myPlace === 1
        ? t('result.placeFirst')
        : t('result.place', { place: v.myPlace })
      : t(`result.${v.verdict}`);
  const reasonText = (): string => {
    if (v.reason === 'quiet_kings') return t(v.variant === 'dames8' ? 'reason.quiet_kings8' : 'reason.quiet_kings10');
    return td(`dames:reason.${v.reason}`, { defaultValue: '' });
  };
  let sub = '';
  if (v.family === 'ludo') sub = [t('result.subLudo', { count: v.playerCount }), reasonText()].filter(Boolean).join(' · ');
  else if (v.verdict === 'draw') sub = reasonText();
  else if (v.verdict === 'win') {
    const mySeat = v.me?.seat ?? 0;
    // Plis du joueur : blancs (siège 0) aux plis pairs en 10×10 ; en 8×8 les noirs commencent.
    const whiteFirst = v.variant !== 'dames8';
    const even = (mySeat === 0) === whiteFirst;
    const captures = longestCapture(moves, even ? 'even' : 'odd');
    const name = opponentName(v.opponent);
    sub = captures >= 2 ? t('result.subWinCaptures', { name, count: v.moveCount, captures }) : t('result.subWin', { name, count: v.moveCount });
  } else if (v.reason === 'resign') sub = t('result.subResign', { count: v.moveCount });
  else sub = t('result.subLoss', { name: opponentName(v.opponent), count: v.moveCount });

  const amount = (n: number | null, mine: boolean): { text: string; tone: 'gain' | 'alert' | 'default' | 'muted' } => {
    if (mine && v.pending) return { text: t('result.pending'), tone: 'muted' };
    if (mine && v.rejected) return { text: '—', tone: 'muted' };
    if (n === null) return { text: v.stake > 0 ? '' : t('result.noStake'), tone: 'muted' };
    if (v.stake > 0 && v.verdict === 'draw') return { text: t('result.returned', { amount: f.caurisAmount(v.stake) }), tone: 'default' };
    if (n > 0) return { text: mine ? t('result.caurisSigned', { amount: f.signed(n) }) : f.signed(n), tone: 'gain' };
    if (n < 0) return { text: mine ? t('result.caurisSigned', { amount: f.signed(n) }) : f.signed(n), tone: 'alert' };
    return { text: mine ? t('result.caurisSigned', { amount: '0' }) : '0', tone: 'default' };
  };
  const mine = amount(v.myCauris, true);
  const theirs = v.opponent?.machine ? { text: t(`difficulty.${v.opponent.machine as 'facile'}`), tone: 'muted' as const } : amount(v.opponentCauris, false);

  const headerIcon: IconName = win ? 'trophy' : v.verdict === 'draw' ? 'check' : 'flag';

  return (
    <Screen padded={false} gap={0} testID="screen-resultat">
      <Fabric name={win ? 'toghu' : 'ndop'} style={styles.header}>
        <View style={[styles.badge, { backgroundColor: brand.obom }]}>
          <Text variant="badge" style={{ color: brand.raphia }}>
            {t(`result.badge.${badgeKey(v)}`)}
          </Text>
        </View>
        <Icon name={headerIcon} size={56} color={win ? brand.orToghu : brand.raphia} />
        <View style={[styles.plate, { backgroundColor: fabrics.toghu.base }]}>
          <Text variant="display" style={[styles.title, { color: brand.raphia }]} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit>
            {title}
          </Text>
        </View>
        {sub ? (
          <View style={[styles.subPlate, { backgroundColor: fabrics.toghu.base }]}>
            <Text variant="label" align="center" style={{ color: brand.raphia }}>
              {sub}
            </Text>
          </View>
        ) : null}
      </Fabric>

      <View style={styles.body}>
        {v.family === 'ludo' && v.playerCount > 2 ? (
          <Card>
            <Text variant="section" tone="muted">
              {t('result.places')}
            </Text>
            {v.players.map((p) => (
              <View key={p.seat} style={styles.placeRow}>
                <Text variant="number" tone={p.place === 1 ? 'action' : 'default'} style={styles.placeNum}>
                  {p.place}
                </Text>
                <Text variant={p.me ? 'bodyStrong' : 'body'} style={styles.flex} numberOfLines={1}>
                  {p.me ? t('result.you') : opponentName(p)}
                </Text>
                {p.me ? (
                  <Text variant="smallStrong" tone={mine.tone}>
                    {mine.text}
                  </Text>
                ) : null}
              </View>
            ))}
          </Card>
        ) : (
          <Card row>
            <View style={styles.side}>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {opponentName(v.opponent)}
              </Text>
              <Text variant="number" tone={theirs.tone} numberOfLines={1} adjustsFontSizeToFit>
                {theirs.text}
              </Text>
            </View>
            <Text variant="smallStrong" tone="muted">
              ·
            </Text>
            <View style={[styles.side, styles.right]}>
              <Text variant="caption" tone="muted">
                {t('result.you')}
              </Text>
              <Text variant="number" tone={mine.tone} numberOfLines={1} adjustsFontSizeToFit>
                {mine.text}
              </Text>
            </View>
          </Card>
        )}

        <ForceCard view={v} />

        {v.settlement && v.context === 'machine' ? <GainsCard view={v} /> : null}
        {v.pending ? (
          <Text variant="caption" tone="muted">
            {t('result.pendingNote')}
          </Text>
        ) : null}
        {v.rejected ? (
          <Text variant="caption" tone="alert">
            {t('result.rejected')}
          </Text>
        ) : null}

        {v.card ? (
          <View style={[styles.cardWon, { backgroundColor: colors.surface, borderColor: colors.action }]}>
            <Fabric name="obom" style={[styles.cardThumb, { borderColor: colors.action }]} />
            <View style={styles.flex}>
              <Text variant="section" tone="action">
                {t('result.card')}
              </Text>
              <Text variant="bodyStrong">{td(`items:name.${v.card}`, { defaultValue: v.card })}</Text>
            </View>
          </View>
        ) : null}

        <NextBlock view={v} space={space} />
      </View>
    </Screen>
  );
}

function Card({ children, row = false }: { children: ReactNode; row?: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.card, row ? styles.cardRow : null, { backgroundColor: colors.surface }]}>{children}</View>;
}

function ForceCard({ view: v }: { view: ResultView }) {
  const { t } = useTranslation('dames');
  const f = useFormat();
  const { colors } = useTheme();
  const family = t(`result.family.${v.family}`);
  if (!v.rating) {
    if (v.pending) {
      return (
        <Card>
          <View style={styles.forceRow}>
            <Text variant="smallStrong">{t('result.force', { family, delta: '' })}</Text>
            <Text variant="caption" tone="muted">
              {t('result.pending')}
            </Text>
          </View>
        </Card>
      );
    }
    if (v.rejected) return null;
    return (
      <Card>
        <Text variant="small" tone="muted">
          {t('result.notRated')}
        </Text>
      </Card>
    );
  }
  const r = v.rating;
  return (
    <Card>
      <View style={styles.forceRow}>
        <Text variant="smallStrong">{t('result.force', { family, delta: f.signed(r.delta) })}</Text>
        <Text variant="caption" tone="muted">
          {r.delta !== 0
            ? t('result.forceSub', { before: f.number(r.before), after: f.number(r.after), level: r.levelAfter })
            : t('result.forceSame', { after: f.number(r.after), level: r.levelAfter })}
        </Text>
      </View>
      <ProgressBar value={levelProgress(r.after)} color={colors.action} height={8} />
    </Card>
  );
}

function GainsCard({ view: v }: { view: ResultView }) {
  const { t } = useTranslation('dames');
  const f = useFormat();
  const s = v.settlement!;
  const lines: [string, number][] = [];
  if (s.base > 0) lines.push([s.streakBonus ? `${t('result.gainBase')} · ${t('result.gainStreak')}` : t('result.gainBase'), s.base]);
  if (s.participation > 0) lines.push([t('result.gainParticipation'), s.participation]);
  if (s.betNet !== 0) lines.push([t('result.gainBet'), s.betNet]);
  return (
    <Card>
      <Text variant="section" tone="muted">
        {t('result.gains')}
      </Text>
      {lines.map(([label, n]) => (
        <View key={label} style={styles.gainRow}>
          <Text variant="small" style={styles.flex}>
            {label}
          </Text>
          <Text variant="smallStrong" tone={n >= 0 ? 'gain' : 'alert'}>
            {f.signed(n)}
          </Text>
        </View>
      ))}
      <View style={styles.gainRow}>
        <Text variant="smallStrong" style={styles.flex}>
          {t('result.gainTotal')}
        </Text>
        <Text variant="smallStrong" tone={s.net >= 0 ? 'gain' : 'alert'}>
          {f.cauris(s.net)}
        </Text>
      </View>
      {!s.counted ? (
        <Text variant="caption" tone="muted">
          {t('result.gainNotCounted')}
        </Text>
      ) : null}
      {v.winStreak && v.winStreak > 1 ? (
        <Text variant="caption" tone="muted">
          {t('result.streak', { count: v.winStreak })}
        </Text>
      ) : null}
    </Card>
  );
}

function Note({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: colors.surfaceStrong }]}>
      <Text variant="small">{children}</Text>
    </View>
  );
}

function NextBlock({ view: v, space }: { view: ResultView; space: string }) {
  const { t } = useTranslation('dames');
  const jeu = v.family === 'ludo' ? 'ludo' : v.variant === 'dames8' ? 'dames8' : 'dames';
  const review = () => router.push(`/partie/${encodeURIComponent(v.id)}/revoir` as Href);
  const later = () => router.replace(space as Href);
  const secondary = (
    <View style={styles.rowButtons}>
      <Button label={t('result.review')} variant="outline" size="sm" style={styles.flex} onPress={review} />
      <Button label={t('result.later')} variant="outline" size="sm" style={styles.flex} onPress={later} />
    </View>
  );
  const n = v.next;
  switch (n.kind) {
    case 'machine':
      return (
        <View style={styles.actions}>
          <Button
            label={t('result.machineAgain')}
            onPress={() =>
              router.replace((v.family === 'ludo' ? '/jouer/ludo' : `/dames/machine?variant=${encodeURIComponent(v.variant)}`) as Href)
            }
          />
          {secondary}
        </View>
      );
    case 'rematch': {
      const name = n.opponent?.name ?? '';
      const href =
        n.stake > 0 && n.opponent?.userId
          ? `/defi/nouveau?jeu=${jeu}&adversaire=${encodeURIComponent(n.opponent.userId)}&mise=${n.stake}&revanche=${encodeURIComponent(v.id)}`
          : n.code
            ? `/salon/${n.code}`
            : `/salon/nouveau?jeu=${jeu}`;
      return (
        <>
          <Note>{n.stake > 0 ? t('result.rematchText', { name }) : t('result.rematchNoStake', { name })}</Note>
          <View style={styles.actions}>
            <Button label={t('result.rematchAccept')} onPress={() => router.push(href as Href)} />
            {secondary}
          </View>
        </>
      );
    }
    case 'return_leg':
      return (
        <>
          <Note>{t('result.returnLeg')}</Note>
          <View style={styles.actions}>
            <Button label={t('result.returnLegCta')} onPress={() => router.replace(`/salon/${n.code}` as Href)} />
            {secondary}
          </View>
        </>
      );
    case 'king':
      return (
        <>
          <Note>
            {v.family === 'ludo' ? t('result.kingLudo') : n.stays ? t('result.kingStays') : t('result.kingLeaves')}
            {n.next ? ` ${t('result.kingNext', { name: n.next.pseudo })}` : ''}
          </Note>
          <View style={styles.actions}>
            <Button
              label={n.next ? t('result.kingNextCta', { name: n.next.pseudo }) : t('result.backToRoom')}
              onPress={() => router.replace(`/salon/${n.code}` as Href)}
            />
            {n.next ? <Button label={t('result.backToRoom')} variant="outline" size="sm" onPress={() => router.replace(`/salon/${n.code}` as Href)} /> : null}
          </View>
        </>
      );
    case 'same_table':
      return (
        <View style={styles.actions}>
          <Button label={t('result.sameTable')} onPress={() => router.replace(`/salon/${n.code}` as Href)} />
          {secondary}
        </View>
      );
    case 'league':
      return (
        <View style={styles.actions}>
          <Button label={t('result.league')} onPress={() => router.replace(`/ligue/${encodeURIComponent(n.leagueId)}` as Href)} />
          {secondary}
        </View>
      );
    default:
      return <View style={styles.actions}>{secondary}</View>;
  }
}

const styles = StyleSheet.create({
  header: { paddingTop: 34, paddingBottom: 26, paddingHorizontal: 20, alignItems: 'center', gap: 10, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  plate: { borderRadius: 8, paddingHorizontal: 10, maxWidth: '100%' },
  title: { fontSize: 34, lineHeight: 40 },
  subPlate: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28, gap: 12, flexGrow: 1 },
  card: { borderRadius: 16, padding: 14, gap: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  side: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end' },
  forceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  gainRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  placeNum: { width: 28 },
  cardWon: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 12, borderWidth: 1 },
  cardThumb: { width: 56, height: 76, borderRadius: 10, borderWidth: 3 },
  note: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  actions: { marginTop: 'auto', gap: 10 },
  rowButtons: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
