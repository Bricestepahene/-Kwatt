/**
 * Lien d'invitation `kwatt://ami/CODE` : « Mireille t'invite à devenir ami sur Kwatt »,
 * puis Ajouter (ou Accepter si elle t'a déjà demandé). Ton propre lien te propose de le partager.
 */
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { Button, EmptyState, Header, Screen, Text, showToast } from '@/ui';
import { PlayerAvatar, QueryBody } from '../../leagues/components';
import { useFriendAction, useFriendByCode } from '../api';
import { friendLink } from '../logic';

export function FriendLinkScreen({ code }: { code: string | undefined }) {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  const clean = (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const target = useFriendByCode(clean || undefined);
  const action = useFriendAction();

  return (
    <Screen testID="screen-ami" header={<Header title={t('friends.linkTitle')} leading="close" fallback="/amis" />}>
      {target.isError ? (
        <EmptyState
          icon="link"
          title={t('friends.linkNotFound')}
          message={t('friends.linkNotFoundText')}
          action={{ label: t('friends.openFriends'), onPress: () => router.replace('/amis' as Href) }}
        />
      ) : (
        <QueryBody query={target}>
          {(p) => (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <PlayerAvatar player={{ userId: p.userId, pseudo: p.pseudo, avatar: p.avatar }} size={88} />
              <Text variant="title" align="center">
                {p.pseudo}
              </Text>
              <Text variant="body" tone="muted" align="center">
                {p.self
                  ? t('friends.linkSelf')
                  : p.relation === 'friend'
                    ? t('friends.linkFriend', { name: p.pseudo })
                    : p.relation === 'outgoing'
                      ? t('friends.linkPending')
                      : p.relation === 'incoming'
                        ? t('friends.linkIncoming', { name: p.pseudo })
                        : t('friends.linkLead', { name: p.pseudo })}
              </Text>
              {p.self ? (
                <Button
                  label={t('friends.linkShare')}
                  onPress={() => void Share.share({ message: t('friends.inviteMessage', { link: friendLink(clean), code: clean }) }).catch(() => undefined)}
                />
              ) : p.relation === 'none' || p.relation === 'incoming' ? (
                <Button
                  label={p.relation === 'incoming' ? t('friends.accept') : t('friends.linkAdd', { name: p.pseudo })}
                  loading={action.isPending}
                  onPress={() =>
                    action.mutate(p.relation === 'incoming' ? { kind: 'accept', userId: p.userId } : { kind: 'requestCode', code: clean }, {
                      onSuccess: (res) => {
                        const friend = 'relation' in res && res.relation === 'friend';
                        showToast(friend ? t('friends.accepted', { name: p.pseudo }) : t('friends.requestSent', { name: p.pseudo }), 'success');
                        void target.refetch();
                      },
                    })
                  }
                />
              ) : (
                <Button label={t('friends.openFriends')} variant="outline" onPress={() => router.replace('/amis' as Href)} />
              )}
            </View>
          )}
        </QueryBody>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 14, padding: 24, borderRadius: 20, borderWidth: 1, marginTop: 24 },
});
