/**
 * /defi/nouveau · Défier un ami (ou demander la revanche) : jeu, variante, format, cadence et
 * mise dans la limite du plafond calculé par le serveur (25 % du plus petit solde, limite de
 * table). Le défi part en notification ; la réponse arrive sur l'écran 26.
 */
import {
  DEFAULT_ROOM_CLOCK,
  ROOM_CLOCKS,
  type ChallengeFormat,
  type RoomGame,
} from "@kwatt/protocol";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { translateError, useFormat } from "@/i18n";
import { useAccessSession } from "@/session";
import { Button, Header, Screen, SectionLabel, Text, showToast } from "@/ui";
import {
  ChoiceBox,
  Note,
  Row,
  RowGroup,
  Stepper,
} from "../../leagues/components";
import { useCreateChallenge, useStakeCap } from "../api";
import {
  DAMES_VARIANTS,
  LUDO_VARIANTS,
  clampStake,
  clockParts,
  isFriendlyVariant,
  seatRange,
  stakeStep,
  type RoomVariant,
} from "../logic";

export interface NewChallengeParams {
  userId: string;
  name?: string;
  game?: RoomGame;
  variant?: string;
  rematchOf?: string;
}

/** Variantes jouables à deux (le Pachisi se joue à quatre). */
const duelVariants = (game: RoomGame): readonly RoomVariant[] =>
  game === "dames"
    ? DAMES_VARIANTS
    : LUDO_VARIANTS.filter((v) => seatRange(v)[0] <= 2);

export function NewChallengeScreen({ params }: { params: NewChallengeParams }) {
  const { t } = useTranslation("online");
  const f = useFormat();
  const session = useAccessSession();
  const [game, setGame] = useState<RoomGame>(params.game ?? "dames");
  const [variant, setVariant] = useState<RoomVariant>(() => {
    const wanted = params.variant as RoomVariant | undefined;
    return wanted && duelVariants(params.game ?? "dames").includes(wanted)
      ? wanted
      : (params.game ?? "dames") === "dames"
        ? "dames10"
        : "ludo_classique";
  });
  const [format, setFormat] = useState<ChallengeFormat>("simple");
  const [clockIndex, setClockIndex] = useState(
    ROOM_CLOCKS.indexOf(DEFAULT_ROOM_CLOCK),
  );
  const [stake, setStake] = useState(0);
  const cap = useStakeCap(params.userId, variant);
  const create = useCreateChallenge();
  const friendly = isFriendlyVariant(variant);
  const max = friendly ? 0 : (cap.data?.max ?? 0);
  const shown = clampStake(stake, max);
  const name = params.name ?? t("newChallenge.someone");

  const pickGame = (g: RoomGame) => {
    setGame(g);
    setVariant(g === "dames" ? "dames10" : "ludo_classique");
  };

  const submit = () => {
    create.mutate(
      {
        toUserId: params.userId,
        game,
        variant,
        stake: shown,
        format,
        ...(game === "dames"
          ? { clock: ROOM_CLOCKS[clockIndex] ?? DEFAULT_ROOM_CLOCK }
          : {}),
        ...(params.rematchOf ? { rematchOf: params.rematchOf } : {}),
      },
      {
        onSuccess: (c) => {
          showToast(t("newChallenge.sent", { name }));
          router.replace(`/defi/${c.id}` as Href);
        },
        onError: (e) => showToast(translateError(e), "alert"),
      },
    );
  };

  return (
    <Screen
      testID="screen-nouveau-defi"
      space={game}
      header={
        <Header
          title={
            params.rematchOf
              ? t("newChallenge.rematchTitle", { name })
              : t("newChallenge.title", { name })
          }
          fallback="/"
        />
      }
      footer={
        <Button
          label={
            shown > 0
              ? t("newChallenge.sendStake", { stake: f.number(shown) })
              : t("newChallenge.send")
          }
          onPress={submit}
          loading={create.isPending}
        />
      }
    >
      <SectionLabel>{t("create.game")}</SectionLabel>
      <View style={styles.grid}>
        {(["dames", "ludo"] as const).map((g) => (
          <ChoiceBox
            key={g}
            selected={game === g}
            onPress={() => pickGame(g)}
            title={t(`game.${g}`)}
            style={styles.half}
            fit
          />
        ))}
      </View>
      <SectionLabel>{t("create.variant")}</SectionLabel>
      <View style={styles.grid}>
        {duelVariants(game).map((v) => (
          <ChoiceBox
            key={v}
            selected={variant === v}
            onPress={() => setVariant(v)}
            title={t(`variant.${v}`)}
            style={styles.half}
          />
        ))}
      </View>
      <SectionLabel>{t("create.format")}</SectionLabel>
      <View style={styles.stack}>
        {(["simple", "aller_retour"] as const).map((fm) => (
          <ChoiceBox
            key={fm}
            selected={format === fm}
            onPress={() => setFormat(fm)}
            title={t(`format.${fm}.label`)}
            sub={t(`format.${fm}.desc`)}
          />
        ))}
      </View>
      {game === "dames" ? (
        <>
          <SectionLabel>{t("create.pace")}</SectionLabel>
          <View style={styles.grid}>
            {ROOM_CLOCKS.map((c, i) => (
              <ChoiceBox
                key={i}
                selected={clockIndex === i}
                onPress={() => setClockIndex(i)}
                title={t("pace.clock", clockParts(c))}
                style={styles.half}
                fit
              />
            ))}
          </View>
        </>
      ) : null}

      <RowGroup>
        <Row
          label={t("newChallenge.stake")}
          right={
            max > 0 ? (
              <Stepper
                value={f.number(shown)}
                onMinus={() =>
                  setStake(clampStake(shown - stakeStep(max), max))
                }
                onPlus={() => setStake(clampStake(shown + stakeStep(max), max))}
                minusLabel={t("challenge.less")}
                plusLabel={t("challenge.more")}
                minusDisabled={shown <= 0}
                plusDisabled={shown >= max}
              />
            ) : (
              <Text variant="labelStrong" tone="muted">
                {t("create.stakeNone")}
              </Text>
            )
          }
          last
        />
      </RowGroup>
      {friendly ? (
        <Text variant="caption" tone="muted">
          {t("create.stakeFriendly")}
        </Text>
      ) : !session.isAdult ? (
        <Text variant="caption" tone="muted">
          {t("create.stakeAdult")}
        </Text>
      ) : cap.data?.refusal ? (
        <Note>
          {t(`challenge.refusal.${cap.data.refusal.replace("stake.", "")}`, {
            defaultValue: t("challenge.noStake"),
          })}
        </Note>
      ) : cap.data ? (
        <Text variant="caption" tone="muted">
          {t("newChallenge.capLine", {
            max: f.number(cap.data.max),
            balance: f.number(cap.data.myBalance),
          })}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  half: { flexGrow: 1, flexBasis: "40%", minHeight: 52 },
  stack: { gap: 8 },
});
