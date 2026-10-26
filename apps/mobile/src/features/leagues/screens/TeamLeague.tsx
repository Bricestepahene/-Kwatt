/**
 * Ligue par équipes (planche RegleCompet, « Matchs par équipes ») : inscriptions par équipe
 * (créer la sienne et en être capitaine, ou rejoindre une équipe qui n'est pas complète),
 * prochaine rencontre de ton équipe avec l'ordre du capitaine (Dames : 3 planches, caché
 * jusqu'à 1 h avant), rencontres de la journée et classement des équipes.
 */
import { brand } from '@kwatt/design';
import type { LeagueDetail, LeagueMatchCard, LeagueTeam, TeamMatchCard } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { translateError, useFormat } from '@/i18n';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { Badge, BottomSheet, Button, Card, ConfirmSheet, SectionLabel, Text, TextField, formatRoomCode, showToast } from '@/ui';
import { useLeagueAction, useTeamAction } from '../api';
import { Note, useLeagueDates } from '../components';
import { boardColor, initialLineup, swapBoards, teamSide } from '../logic';
import { zoneColor } from './ChampionshipScreen';

/* ------------------------------------------------------------------ */
/* Inscriptions                                                         */

function TeamCard({ league, team }: { league: LeagueDetail; team: LeagueTeam }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const { colors } = useTheme();
  const action = useTeamAction(league.id);
  const size = league.teamSize ?? 0;
  const free = Math.max(0, size - team.players.length);
  const canJoin = !league.me.member && !league.me.joinRefusal && !team.full;
  const mine = league.myTeam?.id === team.id;
  return (
    <View style={[styles.team, { backgroundColor: colors.surface, borderColor: mine ? colors.action : colors.border }]}>
      <View style={styles.teamTop}>
        <Text variant="subheading" style={styles.flex} numberOfLines={1}>
          {team.name}
        </Text>
        {team.full ? <Badge label={t('teams.full')} tone="ndop" /> : <Text variant="smallStrong" tone="muted">{t('teams.free', { count: free })}</Text>}
      </View>
      <View style={styles.roster}>
        {team.players.map((p) => (
          <Text key={p.userId} variant="small" style={[styles.slot, { backgroundColor: colors.bg }]} numberOfLines={1}>
            {p.userId === team.captain ? `${p.pseudo} · ${t('teams.captain')}` : p.pseudo}
          </Text>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <Text key={`free-${i}`} variant="small" tone="muted" style={[styles.slot, styles.freeSlot, { borderColor: colors.border }]}>
            ?
          </Text>
        ))}
      </View>
      {canJoin ? (
        <Button
          label={league.entry > 0 ? t('teams.joinPaid', { amount: f.caurisAmount(league.entry) }) : t('teams.join')}
          accessibilityLabel={t('teams.joinA11y', { name: team.name })}
          size="sm"
          variant="secondary"
          loading={action.isPending && action.variables?.kind === 'join' && action.variables.teamId === team.id}
          onPress={() => action.mutate({ kind: 'join', teamId: team.id }, { onError: (error) => showToast(translateError(error), 'alert') })}
        />
      ) : null}
    </View>
  );
}

function CreateTeamSheet({ league, visible, onClose }: { league: LeagueDetail; visible: boolean; onClose: () => void }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const action = useTeamAction(league.id);
  const [name, setName] = useState('');
  const ok = name.trim().length >= 2;
  const submit = () =>
    action.mutate(
      { kind: 'create', name: name.trim() },
      {
        onSuccess: () => {
          setName('');
          onClose();
        },
        onError: (error) => showToast(translateError(error), 'alert'),
      },
    );
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('teams.createTitle')}>
      <View style={styles.sheet}>
        <Text variant="heading">{t('teams.createTitle')}</Text>
        <Text variant="small" tone="muted">
          {t('teams.createBody')}
        </Text>
        <TextField label={t('teams.myTeamName')} value={name} onChangeText={setName} placeholder={t('teams.myTeamPlaceholder')} maxLength={24} autoFocus />
        <Button
          label={league.entry > 0 ? t('teams.createSubmitPaid', { amount: f.caurisAmount(league.entry) }) : t('teams.createSubmit')}
          loading={action.isPending}
          disabled={!ok || action.isPending}
          onPress={submit}
        />
      </View>
    </BottomSheet>
  );
}

export function TeamRegistration({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const action = useLeagueAction(league.id);
  const [creating, setCreating] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const run = (name: 'leave' | 'start' | 'cancel') =>
    action.mutate(name, { onError: (error) => showToast(translateError(error), 'alert'), onSuccess: () => setConfirmLeave(false) });
  const share = () =>
    void Share.share({ message: t('create.shareText', { name: league.name, code: formatRoomCode(league.code), link: `kwatt://ligue/${league.code}` }) }).catch(() => undefined);
  const fullTeams = league.teams.filter((x) => x.full).length;
  const incomplete = league.teams.length - fullTeams;
  const canCreate = !league.me.member && !league.me.joinRefusal && league.teams.length < league.maxPlaces;
  return (
    <>
      <Card gap={8}>
        <Text variant="bodyStrong">{t('teams.registrationTitle', { count: league.teams.length, max: league.maxPlaces })}</Text>
        <Text variant="small" tone="muted">
          {t('teams.registrationBody', { code: formatRoomCode(league.code) })}
        </Text>
      </Card>
      <SectionLabel>{t('teams.teamsTitle')}</SectionLabel>
      {league.teams.map((team) => (
        <TeamCard key={team.id} league={league} team={team} />
      ))}
      {canCreate ? <Button label={t('teams.create')} icon="plus" variant="outline" onPress={() => setCreating(true)} /> : null}
      {!league.me.member && league.me.joinRefusal ? (
        <Note tone="alert">{t(`refusal.${league.me.joinRefusal.replace(/^league\./, '')}`, { defaultValue: t('refusal.generic') })}</Note>
      ) : null}
      <Button label={t('registration.share')} icon="share" variant="secondary" onPress={share} />
      {league.me.creator ? (
        <>
          {fullTeams < 2 ? <Note>{t('teams.startNeeds')}</Note> : incomplete > 0 ? <Note tone="alert">{t('teams.startDrops', { count: incomplete })}</Note> : null}
          <Button label={t('registration.start')} loading={action.isPending} disabled={fullTeams < 2 || action.isPending} onPress={() => run('start')} />
          <Button label={t('registration.cancel')} variant="ghost" onPress={() => run('cancel')} />
        </>
      ) : league.me.member ? (
        <Button label={t('registration.leave')} variant="outline" onPress={() => setConfirmLeave(true)} />
      ) : null}
      <CreateTeamSheet league={league} visible={creating} onClose={() => setCreating(false)} />
      <ConfirmSheet
        visible={confirmLeave}
        title={t('registration.leaveTitle')}
        message={league.entry > 0 ? t('registration.leaveRefund', { amount: f.caurisAmount(league.entry) }) : t('registration.leaveBody')}
        confirmLabel={t('registration.leave')}
        onConfirm={() => run('leave')}
        onCancel={() => setConfirmLeave(false)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Ordre du capitaine                                                   */

function LineupSheet({ league, match, team, onClose }: { league: LeagueDetail; match: TeamMatchCard; team: LeagueTeam; onClose: () => void }) {
  const { t } = useTranslation('leagues');
  const { colors } = useTheme();
  const dates = useLeagueDates();
  const action = useTeamAction(league.id);
  const side = teamSide(match, team.id) ?? 'home';
  const [order, setOrder] = useState(() => initialLineup(match, team));
  const [picked, setPicked] = useState<number | null>(null);
  const name = (id: string) => team.players.find((p) => p.userId === id)?.pseudo ?? '?';
  const deadline = dates.time(match.lineupDeadline);
  const tap = (i: number) => {
    if (picked === null) return setPicked(i);
    if (picked !== i) setOrder((o) => swapBoards(o, picked, i));
    setPicked(null);
  };
  const submit = () =>
    action.mutate(
      { kind: 'lineup', teamMatchId: match.id, order },
      {
        onSuccess: () => {
          showToast(t('teams.lineupSaved', { time: deadline }), 'success');
          onClose();
        },
        onError: (error) => showToast(translateError(error), 'alert'),
      },
    );
  return (
    <BottomSheet visible onClose={onClose} accessibilityLabel={t('teams.lineupTitle', { round: match.round })}>
      <View style={styles.sheet}>
        <Text variant="heading">{t('teams.lineupTitle', { round: match.round })}</Text>
        <Text variant="small" tone="muted">
          {t('teams.lineupBody', { time: deadline })}
        </Text>
        <View accessibilityRole="list" style={styles.lineup}>
          {order.map((id, i) => {
            const color = boardColor(side, i + 1);
            const selected = picked === i;
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${t('teams.lineupBoard', { n: i + 1, color: t(`teams.${color}`) })}. ${name(id)}`}
                onPress={() => tap(i)}
                style={({ pressed }) => [
                  styles.lineupRow,
                  { backgroundColor: colors.surface, borderColor: selected ? colors.action : colors.border, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={[styles.boardDisc, { backgroundColor: color === 'white' ? brand.raphia : brand.nuit, borderColor: colors.border }]}>
                  <Text variant="labelStrong" style={{ color: color === 'white' ? brand.nuit : brand.raphia }}>
                    {i + 1}
                  </Text>
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {name(id)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t('teams.lineupBoard', { n: i + 1, color: t(`teams.${color}`) })}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Button label={t('teams.lineupSubmit')} loading={action.isPending} onPress={submit} />
      </View>
    </BottomSheet>
  );
}

/* ------------------------------------------------------------------ */
/* Rencontres                                                           */

/** Ma planche (ou ma table) dans une rencontre, et ma couleur aux Dames. */
function myBoardOf(match: TeamMatchCard, me: string | null): LeagueMatchCard | null {
  return match.boards.find((b) => b.players.some((p) => p.userId === me)) ?? null;
}

export function MyTeamMatchCard({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  const dates = useLeagueDates();
  const me = useSession((s) => s.data?.user.id ?? null);
  const [editing, setEditing] = useState(false);
  const match = league.myTeam?.nextMatch ?? null;
  const team = league.teams.find((x) => x.id === league.myTeam?.id);
  if (!match || !team) return null;
  const side = teamSide(match, team.id);
  const other = side === 'home' ? match.away.name : match.home.name;
  const dames = league.game === 'dames';
  const board = myBoardOf(match, me);
  const deadline = dates.time(match.lineupDeadline);
  const myOrder = side ? match.lineups[side] : null;
  const ready = !dames || match.lineupLocked;
  let line: string;
  if (!dames) line = t('teams.myTable');
  else if (match.lineupLocked && board?.boardNo) line = t('teams.myBoard', { n: board.boardNo, color: t(`teams.${board.players[0]?.userId === me ? 'white' : 'black'}`) });
  else line = myOrder ? t('teams.lineupDone', { time: deadline }) : t('teams.lineupPending', { time: deadline });
  const play = () => board && router.push(`/ligue/${league.id}/match/${board.id}` as Href);
  return (
    <Card highlighted gap={10}>
      <View style={styles.next}>
        <View style={styles.flex}>
          <Text variant="caption" tone="muted">
            {t('teams.nextTitle', { round: match.round })}
          </Text>
          <Text variant="bodyStrong">{t('teams.nextVs', { mine: team.name, other })}</Text>
          <Text variant="caption" tone="muted">
            {t('detail.nextWhen', { when: dates.dayTime(match.matchAt) })}
          </Text>
        </View>
        {ready && board ? <Button label={t('detail.play')} size="sm" onPress={play} /> : null}
      </View>
      <Text variant="smallStrong" tone={!match.lineupLocked && dames && !myOrder ? 'action' : 'muted'}>
        {line}
      </Text>
      {dames && league.myTeam?.captain && !match.lineupLocked ? (
        <Button label={myOrder ? t('teams.lineupChange') : t('teams.lineupOpen')} variant={myOrder ? 'outline' : 'primary'} size="sm" onPress={() => setEditing(true)} />
      ) : null}
      {editing ? <LineupSheet league={league} match={match} team={team} onClose={() => setEditing(false)} /> : null}
    </Card>
  );
}

/** Score d'une planche, vu des blancs : 1 – 0, ½ – ½, 0 – 1. */
function boardScore(b: LeagueMatchCard): string | null {
  if (b.status !== 'played' || !b.outcome) return null;
  if (b.outcome === 'draw') return '½ – ½';
  if (b.outcome === 'double_forfeit') return '0 – 0';
  return ['home_win', 'away_forfeit', 'home_awarded'].includes(b.outcome) ? '1 – 0' : '0 – 1';
}

function TeamMatchRow({ league, match }: { league: LeagueDetail; match: TeamMatchCard }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const dates = useLeagueDates();
  const { colors } = useTheme();
  const score = match.homeScore !== null && match.awayScore !== null ? t('teams.score', { home: f.number(match.homeScore), away: f.number(match.awayScore) }) : '–';
  const result =
    match.status === 'played' ? (match.winner ? t('teams.winner', { name: match.winner === 'home' ? match.home.name : match.away.name }) : t('teams.drawn')) : t(`teams.status.${match.status}`);
  const showBoards = league.game === 'ludo' || match.lineupLocked;
  return (
    <View style={[styles.match, { backgroundColor: colors.surface }]} accessible={!showBoards} accessibilityLabel={`${match.home.name} ${score} ${match.away.name}. ${result}`}>
      <View style={styles.matchTop}>
        <Text variant="bodyStrong" style={[styles.flex, styles.right]} numberOfLines={1}>
          {match.home.name}
        </Text>
        <Text variant="number" tone={match.status === 'playing' ? 'action' : undefined} style={styles.score}>
          {score}
        </Text>
        <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
          {match.away.name}
        </Text>
      </View>
      <Text variant="caption" tone="muted" align="center">
        {result}
      </Text>
      {showBoards ? (
        match.boards.map((b) =>
          league.game === 'dames' ? (
            <View key={b.id} style={[styles.boardRow, { borderTopColor: colors.border }]}>
              <Text variant="caption" tone="muted" style={styles.boardNo}>
                {t('teams.board', { n: b.boardNo ?? 0 })}
              </Text>
              <Text variant="small" style={[styles.flex, styles.right]} numberOfLines={1}>
                {b.players[0]?.pseudo}
              </Text>
              <Text variant="smallStrong" style={styles.boardScore}>
                {boardScore(b) ?? '–'}
              </Text>
              <Text variant="small" style={styles.flex} numberOfLines={1}>
                {b.players[1]?.pseudo}
              </Text>
            </View>
          ) : null,
        )
      ) : (
        <Text variant="caption" tone="muted" align="center">
          {t('teams.hidden', { time: dates.time(match.lineupDeadline) })}
        </Text>
      )}
    </View>
  );
}

export function TeamRoundMatches({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  if (league.teamMatches.length === 0) return null;
  return (
    <>
      <SectionLabel>{t('teams.roundMatches', { round: league.currentRound })}</SectionLabel>
      {league.teamMatches.map((m) => (
        <TeamMatchRow key={m.id} league={league} match={m} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Classement                                                           */

export function TeamStandingsTable({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const { colors } = useTheme();
  if (league.teamStandings.length === 0) return null;
  const cols = [t('table.played'), t('table.wins'), t('table.draws'), t('table.losses'), t('teams.diff')];
  return (
    <>
      <SectionLabel>{t('teams.standings')}</SectionLabel>
      <View accessibilityRole="list" style={[styles.table, { backgroundColor: colors.surface }]}>
        <View style={[styles.tr, styles.th, { borderBottomColor: colors.border }]}>
          <Text variant="caption" tone="muted" style={styles.pos}>
            #
          </Text>
          <Text variant="caption" tone="muted" style={styles.flex}>
            {t('teams.team')}
          </Text>
          {cols.map((c) => (
            <Text key={c} variant="caption" tone="muted" style={styles.num}>
              {c}
            </Text>
          ))}
          <Text variant="caption" tone="muted" style={styles.pts}>
            {t('table.points')}
          </Text>
        </View>
        {league.teamStandings.map((r) => {
          const zone = zoneColor(r.zone);
          const mine = r.team.id === league.myTeam?.id;
          const name = mine ? t('teams.mine', { name: r.team.name }) : r.team.name;
          const diff = r.gamesFor - r.gamesAgainst;
          return (
            <View
              key={r.team.id}
              accessible
              accessibilityLabel={t('teams.rowA11y', { place: r.position, name, points: r.points, played: r.played })}
              style={[styles.tr, mine ? { backgroundColor: colors.surfaceStrong } : null]}
            >
              <View style={styles.pos}>
                <View style={[styles.posBox, zone ? { backgroundColor: zone } : null]}>
                  <Text variant="smallStrong" style={zone ? { color: brand.nuit } : null}>
                    {r.position}
                  </Text>
                </View>
              </View>
              <Text variant={mine ? 'smallStrong' : 'small'} style={styles.flex} numberOfLines={1}>
                {name}
              </Text>
              {[r.played, r.wins, r.draws, r.losses].map((v, i) => (
                <Text key={i} variant="small" tone="muted" style={styles.num}>
                  {f.number(v)}
                </Text>
              ))}
              <Text variant="small" tone="muted" style={styles.num}>
                {diff > 0 ? `+${f.number(diff)}` : f.number(diff)}
              </Text>
              <Text variant="smallStrong" style={styles.pts}>
                {f.number(r.points)}
              </Text>
            </View>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  right: { textAlign: 'right' },
  team: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  teamTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roster: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slot: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' },
  freeSlot: { borderWidth: 1, borderStyle: 'dashed', minWidth: 44, textAlign: 'center' },
  sheet: { gap: 12, paddingBottom: 8 },
  lineup: { gap: 8 },
  lineupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, minHeight: 60 },
  boardDisc: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  next: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  match: { borderRadius: 14, padding: 14, gap: 6 },
  matchTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  score: { minWidth: 64, textAlign: 'center' },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  boardNo: { width: 62 },
  boardScore: { width: 52, textAlign: 'center' },
  table: { borderRadius: 14, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 10, gap: 4 },
  th: { borderBottomWidth: 1, minHeight: 34 },
  pos: { width: 30 },
  posBox: { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  num: { width: 26, textAlign: 'center' },
  pts: { width: 34, textAlign: 'right' },
});
