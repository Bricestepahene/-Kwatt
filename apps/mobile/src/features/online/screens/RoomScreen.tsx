/**
 * Écran 25 · Salon et file d'attente (planche Salon) : code à partager, places à table (prêt,
 * hôte, place gardée), file d'attente (roi de la table), réglages, puis « Lancer la partie »
 * pour l'hôte ; les autres se déclarent prêts. La vue arrive en direct (`room.state`) et
 * chacun rejoint l'écran de partie dès qu'elle commence.
 */
import { ludoSeats } from "@kwatt/design";
import type { RoomPlayer, RoomSeatView, RoomView } from "@kwatt/protocol";
import * as Clipboard from "expo-clipboard";
import { router, type Href } from "expo-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Share, StyleSheet, View } from "react-native";
import { env } from "@/config/env";
import { translateError, useFormat } from "@/i18n";
import { useSession } from "@/session";
import { useTheme } from "@/theme";
import {
  Avatar,
  Button,
  Header,
  Pill,
  Screen,
  SectionLabel,
  Text,
  formatRoomCode,
  showToast,
} from "@/ui";
import { avatarProps } from "../../profile/looks";
import { QueryBody } from "../../leagues/components";
import { useRoom, useRoomAction } from "../api";
import { clockParts, gameHref, startState } from "../logic";

/** Couleur d'une place : celle de la maison au Ludo, blancs puis noirs aux Dames. */
function seatColor(room: RoomView, seat: number, fallback: string): string {
  if (room.game === "ludo") return ludoSeats[seat % ludoSeats.length]!.color;
  return fallback;
}

export function shareLink(code: string): string {
  return env.webDomain
    ? `https://${env.webDomain}/s/${code}`
    : `kwatt://salon/${code}`;
}

export function RoomScreen({ code }: { code: string }) {
  const { t } = useTranslation("online");
  const query = useRoom(code);
  return (
    <Screen
      testID="screen-salon"
      space={query.data?.game ?? "hub"}
      header={
        <Header
          title={query.data?.name ?? t("room.title")}
          {...(query.data
            ? {
                subtitle: t("room.overline", {
                  game: t(`game.${query.data.game}`),
                  count: query.data.seats,
                }),
              }
            : {})}
          fallback="/"
        />
      }
    >
      <QueryBody query={query}>{(room) => <RoomBody room={room} />}</QueryBody>
    </Screen>
  );
}

function RoomBody({ room }: { room: RoomView }) {
  const { t } = useTranslation("online");
  const f = useFormat();
  const { colors } = useTheme();
  const me = useSession((s) => s.data?.user.id ?? null);
  const action = useRoomAction(room.code);
  const seated = room.table.filter((s) => s.player).length;
  const start = startState(room);
  const role = room.me.role;
  const run = (a: Parameters<typeof action.mutate>[0]) =>
    action.mutate(a, { onError: (e) => showToast(translateError(e), "alert") });

  // La partie commence : les joueurs assis y vont ; la file et les spectateurs restent ici.
  const lastGame = useRef(room.gameId);
  useEffect(() => {
    if (room.gameId && room.gameId !== lastGame.current && role === "seat")
      router.push(gameHref(room.game, room.gameId) as Href);
    lastGame.current = room.gameId;
  }, [room.gameId, room.game, role]);

  const share = () => {
    const link = shareLink(room.code);
    void Share.share({
      message: t("room.shareText", {
        name: room.name,
        code: formatRoomCode(room.code),
        link,
      }),
    }).catch(() => undefined);
  };
  const copy = () => {
    void Clipboard.setStringAsync(formatRoomCode(room.code)).then(() =>
      showToast(t("room.copied")),
    );
  };

  const chips = [
    room.stake > 0
      ? t("room.chipStake", { stake: f.number(room.stake) })
      : t("room.chipFriendly"),
    room.clock
      ? t("pace.clock", clockParts(room.clock))
      : room.turnMs
        ? t("pace.turn", { seconds: room.turnMs / 1000 })
        : null,
    t(`format.${room.format}.chip`),
  ].filter((x): x is string => Boolean(x));

  const footer = (() => {
    if (room.status === "playing") {
      return role === "seat" && room.gameId ? (
        <Button
          label={t("room.backToGame")}
          onPress={() => router.push(gameHref(room.game, room.gameId!) as Href)}
        />
      ) : room.gameId ? (
        <Button
          label={t("room.watch")}
          variant="secondary"
          onPress={() => router.push(`/regarder/${room.gameId}` as Href)}
        />
      ) : null;
    }
    if (role === null || role === "spectator") {
      return (
        <View style={styles.footerRow}>
          <Button
            label={seated < room.seats ? t("room.sit") : t("room.queue")}
            onPress={() => run({ kind: "join", body: { as: "seat" } })}
            loading={action.isPending}
            style={styles.flex}
          />
        </View>
      );
    }
    if (room.me.isHost) {
      return (
        <Button
          label={t("room.start")}
          onPress={() => run({ kind: "start" })}
          disabled={!start.canStart}
          loading={action.isPending}
          accessibilityHint={
            start.reason === "players"
              ? t("room.needPlayers", { count: start.missing })
              : start.reason === "ready"
                ? t("room.waitReady")
                : undefined
          }
        />
      );
    }
    if (role === "seat") {
      return (
        <Button
          label={room.me.ready ? t("room.notReady") : t("room.ready")}
          variant={room.me.ready ? "secondary" : "primary"}
          onPress={() => run({ kind: "ready", ready: !room.me.ready })}
          loading={action.isPending}
        />
      );
    }
    return null;
  })();

  const hostHint =
    room.status === "open" && room.me.isHost && !start.canStart
      ? start.reason === "players"
        ? t("room.needPlayers", { count: start.missing })
        : t("room.waitReady")
      : room.status === "open" && role === "seat" && !room.me.isHost
        ? t("room.hostStarts", { name: room.host.pseudo })
        : role === "queue"
          ? t("room.inQueue", {
              position: room.queue.find((q) => q.userId === me)?.position ?? 0,
            })
          : null;

  return (
    <>
      <View style={[styles.codeCard, { backgroundColor: colors.surface }]}>
        <Text variant="small" tone="muted">
          {t("room.code")}
        </Text>
        <Text
          variant="numberLarge"
          style={styles.code}
          accessibilityLabel={t("room.codeLabel", {
            code: room.code.split("").join(" "),
          })}
          selectable
        >
          {formatRoomCode(room.code)}
        </Text>
        <View style={styles.codeActions}>
          <Button
            label={t("room.copy")}
            variant="outline"
            size="sm"
            onPress={copy}
            style={styles.flex}
          />
          <Button
            label={t("room.share")}
            variant="tonal"
            size="sm"
            onPress={share}
            style={styles.flex}
          />
        </View>
      </View>

      <SectionLabel>
        {t("room.table", { seated, seats: room.seats })}
      </SectionLabel>
      <View style={styles.table}>
        {room.table.map((s) => (
          <SeatCard
            key={s.seat}
            room={room}
            seat={s}
            onSit={
              role !== "seat" && room.status === "open"
                ? () =>
                    run({ kind: "join", body: { as: "seat", seat: s.seat } })
                : undefined
            }
          />
        ))}
      </View>

      {room.king ? (
        <Text variant="small" tone="muted">
          {t("room.king", { name: room.king.pseudo, count: room.king.wins })}
        </Text>
      ) : null}

      {room.queue.length > 0 || room.format === "roi" ? (
        <>
          <SectionLabel>
            {room.format === "roi" ? t("room.queueKing") : t("room.queueTitle")}
          </SectionLabel>
          <View style={[styles.queue, { backgroundColor: colors.surface }]}>
            {room.queue.length === 0 ? (
              <Text variant="small" tone="muted" style={styles.queueEmpty}>
                {t("room.queueEmpty")}
              </Text>
            ) : (
              room.queue.map((q, i) => (
                <QueueRow
                  key={q.userId}
                  player={q}
                  position={q.position}
                  stake={room.stake}
                  last={i === room.queue.length - 1}
                />
              ))
            )}
          </View>
        </>
      ) : null}

      <View style={styles.chips}>
        {chips.map((c) => (
          <Pill key={c}>{c}</Pill>
        ))}
        {room.game === "ludo" && room.lastGameId ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push(`/partie/${room.lastGameId}/de` as Href)}
            style={[styles.diceChip, { backgroundColor: colors.gainSoft }]}
          >
            <Text variant="smallStrong" style={{ color: colors.gain }}>
              {t("room.dice")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {room.spectators > 0 ? (
        <Text variant="caption" tone="muted">
          {t("room.spectators", { count: room.spectators })}
        </Text>
      ) : null}

      {hostHint ? (
        <Text variant="small" tone="muted" style={styles.center}>
          {hostHint}
        </Text>
      ) : null}
      {footer}
      {role !== null ? (
        <Button
          label={t("room.leave")}
          variant="ghost"
          size="sm"
          onPress={() => run({ kind: "leave" })}
          style={styles.center}
        />
      ) : null}
    </>
  );
}

function SeatCard({
  room,
  seat,
  onSit,
}: {
  room: RoomView;
  seat: RoomSeatView;
  onSit: (() => void) | undefined;
}) {
  const { t } = useTranslation("online");
  const { colors } = useTheme();
  const color = seatColor(
    room,
    seat.seat,
    seat.seat === 0 ? colors.text : colors.textMuted,
  );
  const p = seat.player;
  if (!p) {
    const colorName =
      room.game === "ludo"
        ? t(`color.${ludoSeats[seat.seat % ludoSeats.length]!.id}`)
        : t(seat.seat === 0 ? "color.white" : "color.black");
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          onSit
            ? t("room.sitHere", { color: colorName })
            : t("room.freeSeat", { color: colorName })
        }
        disabled={!onSit}
        onPress={onSit}
        style={({ pressed }) => [
          styles.seat,
          styles.seatFree,
          {
            borderColor: room.game === "ludo" ? color : colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.seatDot,
            { borderColor: room.game === "ludo" ? color : colors.border },
          ]}
        />
        <Text
          variant="small"
          tone="muted"
          style={styles.flex}
          numberOfLines={2}
        >
          {t("room.freeSeat", { color: colorName })}
        </Text>
      </Pressable>
    );
  }
  const isHost = p.userId === room.host.userId;
  const status = seat.keptUntil
    ? t("room.kept")
    : isHost
      ? t("room.host")
      : seat.ready
        ? t("room.isReady")
        : t("room.isNotReady");
  const statusColor = seat.keptUntil
    ? colors.alert
    : isHost
      ? colors.actionText
      : seat.ready
        ? colors.gain
        : colors.textMuted;
  const look = p.avatar
    ? avatarProps(p.avatar as Parameters<typeof avatarProps>[0])
    : null;
  return (
    <View
      style={[
        styles.seat,
        { backgroundColor: colors.surface, borderColor: color, borderWidth: 2 },
      ]}
      accessible
      accessibilityLabel={`${p.pseudo}. ${status}${p.guest ? `. ${t("room.guest")}` : ""}`}
    >
      <Avatar
        name={p.pseudo}
        size={36}
        decorative
        ringColor={color}
        {...(look ? { avatar: look.avatar, frame: look.frame } : {})}
      />
      <View style={styles.flex}>
        <Text variant="smallStrong" numberOfLines={1}>
          {p.pseudo}
        </Text>
        <Text
          variant="caption"
          style={{ color: statusColor }}
          numberOfLines={1}
        >
          {status}
          {!p.connected && !seat.keptUntil ? ` · ${t("room.offline")}` : ""}
        </Text>
      </View>
    </View>
  );
}

function QueueRow({
  player,
  position,
  stake,
  last,
}: {
  player: RoomPlayer;
  position: number;
  stake: number;
  last: boolean;
}) {
  const { t } = useTranslation("online");
  const f = useFormat();
  const { colors } = useTheme();
  const note = player.guest
    ? t("room.guestNoStake")
    : stake > 0 && player.staking
      ? t("room.stakeReady", { stake: f.number(stake) })
      : t("room.member");
  return (
    <View
      style={[
        styles.queueRow,
        last
          ? null
          : { borderBottomWidth: 1, borderBottomColor: colors.border },
      ]}
      accessible
      accessibilityLabel={`${position}. ${player.pseudo}. ${note}`}
    >
      <Text
        variant="number"
        style={[styles.queuePos, { color: colors.actionText }]}
      >
        {position}
      </Text>
      <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
        {player.pseudo}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {note}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignSelf: "center", textAlign: "center" },
  codeCard: { borderRadius: 18, padding: 16, alignItems: "center", gap: 10 },
  code: { fontSize: 38, lineHeight: 46, letterSpacing: 5 },
  codeActions: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
  table: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  seat: {
    flexBasis: "45%",
    flexGrow: 1,
    minHeight: 60,
    borderRadius: 14,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  seatFree: { borderWidth: 2, borderStyle: "dashed" },
  seatDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: "dashed",
  },
  queue: { borderRadius: 14 },
  queueEmpty: { padding: 12 },
  queueRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  queuePos: { width: 22, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  diceChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    minHeight: 32,
    justifyContent: "center",
  },
  footerRow: { flexDirection: "row", gap: 8 },
});
