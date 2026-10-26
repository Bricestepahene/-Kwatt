/**
 * Écran 26 · Défi avec mise (planche Mise) : les deux joueurs face à face sur l'obom (Dames)
 * ou le kaba (Ludo), la mise de chacun (−/+ dans la limite du plafond), le pot, le solde si
 * on perd, puis « J'accepte », « Contre-proposer » ou « Refuser ». L'auteur d'une
 * proposition attend la réponse et peut retirer son défi.
 */
import type { ChallengeView } from "@kwatt/protocol";
import { router, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { translateError, useFormat } from "@/i18n";
import { useSession } from "@/session";
import { useTheme } from "@/theme";
import {
  Avatar,
  Button,
  EmptyState,
  Fabric,
  Header,
  Screen,
  Text,
  showToast,
} from "@/ui";
import { avatarProps } from "../../profile/looks";
import { QueryBody, StatTiles, Stepper } from "../../leagues/components";
import { OnWood } from "../../dames/FabricHeader";
import { useChallenge, useChallengeAction } from "../api";
import { clampStake, gameHref, stakeStep } from "../logic";

export function ChallengeScreen({ id }: { id: string }) {
  const { t } = useTranslation("online");
  const query = useChallenge(id);
  return (
    <Screen
      testID="screen-mise"
      padded={false}
      header={
        <View style={styles.header}>
          <Header title={t("challenge.title")} fallback="/" />
        </View>
      }
    >
      <QueryBody query={query}>
        {(c) => <ChallengeBody challenge={c} />}
      </QueryBody>
    </Screen>
  );
}

function Face({
  player,
  label,
}: {
  player: ChallengeView["from"];
  label: string;
}) {
  const look = player.avatar
    ? avatarProps(player.avatar as Parameters<typeof avatarProps>[0])
    : null;
  return (
    <View style={styles.face}>
      <Avatar
        name={player.pseudo}
        size={64}
        decorative
        {...(look ? { avatar: look.avatar, frame: look.frame } : {})}
      />
      <OnWood variant="bodyStrong" numberOfLines={1}>
        {label}
      </OnWood>
    </View>
  );
}

function ChallengeBody({ challenge: c }: { challenge: ChallengeView }) {
  const { t } = useTranslation("online");
  const f = useFormat();
  const { colors } = useTheme();
  const me = useSession((s) => s.data?.user.id ?? null);
  const action = useChallengeAction(c.id);
  const mine = me === c.from.userId;
  const other = mine ? c.to : c.from;
  const myTurn = c.status === "pending" && c.awaiting === me;
  const cap = c.cap.max;
  const [amount, setAmount] = useState(c.stake);
  useEffect(() => setAmount(c.stake), [c.stake]);
  const step = stakeStep(cap);
  const changed = amount !== c.stake;
  const run = (
    a: Parameters<typeof action.mutate>[0],
    then?: (v: ChallengeView) => void,
  ) =>
    action.mutate(a, {
      onSuccess: (v) => then?.(v),
      onError: (e) => showToast(translateError(e), "alert"),
    });

  // Accepté : la partie commence (l'autre joueur y est mené par la notification).
  useEffect(() => {
    if (c.status === "accepted" && c.gameId)
      router.replace(gameHref(c.game, c.gameId) as Href);
  }, [c.status, c.gameId, c.game]);

  const context = [
    t(`game.${c.game}`),
    c.rematchOf ? t("challenge.rematch") : null,
    t(`format.${c.format}.label`),
  ]
    .filter(Boolean)
    .join(" · ");
  const title = mine
    ? myTurn
      ? t("challenge.counteredTitle", { name: other.pseudo })
      : t("challenge.sentTitle", { name: other.pseudo })
    : t("challenge.receivedTitle", { name: other.pseudo });

  if (c.status !== "pending" && c.status !== "accepted") {
    return (
      <View style={styles.pad}>
        <EmptyState
          icon="info"
          title={t(`challenge.status.${c.status}`)}
          message={t("challenge.closedMessage")}
          action={{
            label: t("challenge.back"),
            onPress: () => router.replace("/" as Href),
          }}
        />
      </View>
    );
  }

  return (
    <>
      <Fabric name={c.game === "ludo" ? "kaba" : "obom"} style={styles.band}>
        <View style={styles.faces}>
          <Face
            player={c.from}
            label={mine ? t("challenge.you") : c.from.pseudo}
          />
          <OnWood variant="subheading">{t("challenge.vs")}</OnWood>
          <Face player={c.to} label={mine ? c.to.pseudo : t("challenge.you")} />
        </View>
        <OnWood variant="small" style={styles.centerText}>
          {context}
        </OnWood>
      </Fabric>

      <View style={styles.pad}>
        <Text variant="title">{title}</Text>
        <Text variant="body" tone="muted">
          {c.stake > 0 || myTurn
            ? t("challenge.explain")
            : t("challenge.friendly")}
        </Text>

        <View style={[styles.stakeBox, { backgroundColor: colors.surface }]}>
          {myTurn && cap > 0 ? (
            <Stepper
              value={f.number(amount)}
              onMinus={() => setAmount((a) => clampStake(a - step, cap))}
              onPlus={() => setAmount((a) => clampStake(a + step, cap))}
              minusLabel={t("challenge.less")}
              plusLabel={t("challenge.more")}
              minusDisabled={amount <= 0}
              plusDisabled={amount >= cap}
            />
          ) : (
            <Text variant="numberLarge">{f.number(c.stake)}</Text>
          )}
          <Text variant="small" tone="muted">
            {t("challenge.each")}
          </Text>
        </View>

        <StatTiles
          items={[
            { value: f.number(amount * 2), label: t("challenge.pot") },
            {
              value: f.number(Math.max(0, c.cap.myBalance - amount)),
              label: t("challenge.ifLose"),
            },
            { value: f.number(cap), label: t("challenge.cap") },
          ]}
        />
        <Text variant="caption" tone="muted">
          {c.cap.refusal
            ? t(`challenge.refusal.${c.cap.refusal.replace("stake.", "")}`, {
                defaultValue: t("challenge.noStake"),
              })
            : t("challenge.capRule")}
        </Text>
        <Text variant="caption" tone="muted">
          {t("challenge.expires", {
            time: f.date(new Date(c.expiresAt), "time"),
          })}
        </Text>

        {myTurn ? (
          <View style={styles.actions}>
            <Button
              label={
                changed
                  ? t("challenge.counter", { stake: f.number(amount) })
                  : t("challenge.accept", { stake: f.number(c.stake) })
              }
              onPress={() =>
                run(
                  changed
                    ? { kind: "counter", stake: amount }
                    : { kind: "accept" },
                )
              }
              loading={action.isPending}
            />
            <View style={styles.row}>
              <Button
                label={t("challenge.counterShort")}
                variant="outline"
                size="sm"
                onPress={() =>
                  changed
                    ? run({ kind: "counter", stake: amount })
                    : showToast(t("challenge.counterHint"))
                }
                style={styles.flex}
              />
              <Button
                label={t("challenge.decline")}
                variant="ghost"
                size="sm"
                onPress={() => run({ kind: "decline" }, () => router.back())}
                style={styles.flex}
              />
            </View>
          </View>
        ) : c.status === "pending" ? (
          <View style={styles.actions}>
            <Text variant="bodyStrong" style={styles.centerText}>
              {t("challenge.waiting", { name: other.pseudo })}
            </Text>
            <Button
              label={t("challenge.cancel")}
              variant="outline"
              onPress={() => run({ kind: "cancel" }, () => router.back())}
            />
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  pad: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  band: { paddingHorizontal: 20, paddingVertical: 20, gap: 10 },
  faces: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  face: { alignItems: "center", gap: 6, maxWidth: 130 },
  centerText: { textAlign: "center" },
  stakeBox: {
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    gap: 6,
  },
  actions: { gap: 10, marginTop: 4 },
  row: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
});
