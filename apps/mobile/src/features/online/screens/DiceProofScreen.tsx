/**
 * Écran 22 · Le dé était-il honnête ? (planche DeHonnete). La preuve publiée par le serveur
 * (empreinte, clé révélée, grains de sel) est recalculée ICI, dans l'appli, avec
 * @kwatt/fair-dice : le verdict ne repose pas sur la parole du serveur.
 */
import type { DiceProof, GameSummary } from "@kwatt/protocol";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share, StyleSheet, View } from "react-native";
import { useFormat } from "@/i18n";
import { useSession } from "@/session";
import { useTheme } from "@/theme";
import { Button, Header, Icon, Screen, SectionLabel, Text } from "@/ui";
import { QueryBody } from "../../leagues/components";
import { useDiceProof, useGameSummary } from "../api";
import { checkProof, diceStats, expectedSixes } from "../logic";

export function DiceProofScreen({ gameId }: { gameId: string }) {
  const { t } = useTranslation("online");
  const proof = useDiceProof(gameId);
  return (
    <Screen
      testID="screen-de-honnete"
      space="ludo"
      header={<Header title={t("dice.title")} fallback="/" />}
    >
      <QueryBody query={proof}>
        {(p) => <ProofBody proof={p} gameId={gameId} />}
      </QueryBody>
    </Screen>
  );
}

function ProofBody({ proof, gameId }: { proof: DiceProof; gameId: string }) {
  const { t } = useTranslation("online");
  const f = useFormat();
  const { colors } = useTheme();
  const summary = useGameSummary(gameId);
  const me = useSession((s) => s.data?.user.id ?? null);
  const verdict = useMemo(() => checkProof(proof), [proof]);
  const stats = useMemo(() => diceStats(proof), [proof]);
  const [all, setAll] = useState(false);
  const nameOf = (seat: number, game: GameSummary | undefined) => {
    const s = game?.seats.find((x) => x.seat === seat);
    if (!s) return t("dice.seat", { n: seat + 1 });
    return s.userId && s.userId === me ? t("challenge.you") : s.pseudo;
  };
  const maxRolls = Math.max(1, ...stats.map((s) => s.rolls));
  const tone =
    verdict.state === "bad"
      ? { bg: colors.lossSoft, fg: colors.alert }
      : verdict.state === "ok"
        ? { bg: colors.gainSoft, fg: colors.gain }
        : { bg: colors.surface, fg: colors.textMuted };
  const headline =
    verdict.state === "ok"
      ? t("dice.ok", { count: verdict.count })
      : verdict.state === "bad"
        ? t("dice.bad", { count: verdict.mismatches.length })
        : t("dice.pending");
  const context = summary.data
    ? [
        t(`game.${summary.data.family}`),
        summary.data.startedAt
          ? f.date(new Date(summary.data.startedAt), "dayTime")
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const expected = stats[0] ? expectedSixes(proof.kind, stats[0].rolls) : 0;

  const shareProof = () => {
    const lines = [
      t("dice.shareHead", { id: proof.gameId }),
      `${t("dice.commitment")} ${proof.commitment}`,
      `${t("dice.key")} ${proof.serverSeed ?? "—"}`,
      ...proof.rolls.map(
        (r) =>
          `#${r.rollIndex} · ${nameOf(r.seat, summary.data)} · ${r.clientSeed} → ${r.value}`,
      ),
    ];
    void Share.share({ message: lines.join("\n") }).catch(() => undefined);
  };

  return (
    <>
      <View
        style={[styles.verdict, { backgroundColor: tone.bg }]}
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`${headline}. ${context}`}
      >
        <Icon
          name={
            verdict.state === "bad"
              ? "alert"
              : verdict.state === "ok"
                ? "check"
                : "clock"
          }
          size={28}
          color={tone.fg}
        />
        <View style={styles.flex}>
          <Text variant="bodyStrong" style={{ color: tone.fg }}>
            {headline}
          </Text>
          {context ? (
            <Text variant="small" tone="muted">
              {context}
            </Text>
          ) : null}
        </View>
      </View>

      <SectionLabel>{t("dice.how")}</SectionLabel>
      <View style={styles.steps}>
        {(["before", "salt", "after"] as const).map((k, i) => (
          <View key={k} style={styles.step}>
            <View
              style={[
                styles.stepNum,
                { backgroundColor: colors.surfaceStrong },
              ]}
            >
              <Text variant="smallStrong">{i + 1}</Text>
            </View>
            <Text variant="small" style={styles.flex}>
              <Text variant="smallStrong">{t(`dice.step.${k}.strong`)}</Text>{" "}
              {t(`dice.step.${k}.rest`)}
            </Text>
          </View>
        ))}
      </View>

      {stats.length > 0 ? (
        <>
          <SectionLabel>
            {proof.kind === "die" ? t("dice.sixes") : t("dice.sixesCowries")}
          </SectionLabel>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {stats.map((s) => (
              <View
                key={s.seat}
                style={styles.statRow}
                accessible
                accessibilityLabel={t("dice.statLabel", {
                  name: nameOf(s.seat, summary.data),
                  sixes: s.sixes,
                  rolls: s.rolls,
                })}
              >
                <Text variant="small" style={styles.statName} numberOfLines={1}>
                  {nameOf(s.seat, summary.data)}
                </Text>
                <View style={[styles.bar, { backgroundColor: colors.bg }]}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.round((s.rolls / maxRolls) * 100)}%`,
                        backgroundColor: colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.barSix,
                        {
                          width: `${s.rolls ? Math.round((s.sixes / s.rolls) * 100) : 0}%`,
                          backgroundColor: colors.gain,
                        },
                      ]}
                    />
                  </View>
                </View>
                <Text variant="smallStrong" style={styles.statValue}>
                  {t("dice.ratio", { sixes: s.sixes, rolls: s.rolls })}
                </Text>
              </View>
            ))}
            <Text variant="caption" tone="muted">
              {proof.kind === "die"
                ? t("dice.expected", { expected, rolls: stats[0]?.rolls ?? 0 })
                : t("dice.expectedCowries")}
            </Text>
          </View>
        </>
      ) : null}

      {all ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text variant="caption" tone="muted" selectable>
            {t("dice.commitment")} {proof.commitment}
          </Text>
          <Text variant="caption" tone="muted" selectable>
            {t("dice.key")} {proof.serverSeed ?? t("dice.keyHidden")}
          </Text>
          {proof.rolls.map((r) => {
            const bad =
              verdict.state === "bad" &&
              verdict.mismatches.includes(r.rollIndex);
            return (
              <Text
                key={r.rollIndex}
                variant="caption"
                style={bad ? { color: colors.alert } : null}
                selectable
              >
                {t("dice.rollLine", {
                  n: r.rollIndex + 1,
                  name: nameOf(r.seat, summary.data),
                  value: r.value,
                })}
                {r.byMachine ? ` · ${t("dice.byMachine")}` : ""}
              </Text>
            );
          })}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={all ? t("dice.hideRolls") : t("dice.allRolls")}
          variant="outline"
          size="sm"
          onPress={() => setAll((v) => !v)}
          style={styles.flex}
        />
        <Button
          label={t("dice.share")}
          variant="tonal"
          size="sm"
          onPress={shareProof}
          style={styles.flex}
          disabled={!proof.serverSeed}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  verdict: {
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  steps: { gap: 10 },
  step: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  card: { borderRadius: 14, padding: 12, gap: 10 },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 28,
  },
  statName: { width: 90 },
  statValue: { width: 64, textAlign: "right" },
  bar: { flex: 1, height: 10, borderRadius: 5, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 5, overflow: "hidden" },
  barSix: { height: 10 },
  actions: { flexDirection: "row", gap: 8 },
});
