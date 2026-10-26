/**
 * Écran 24 · Créer un salon (planche CreerSalon) : jeu, variante, joueurs à la table, format,
 * cadence, mise par joueur, puis « Créer et obtenir le code » → salon (25).
 */
import { router, type Href } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { translateError, useFormat } from "@/i18n";
import { useAccessSession, useSession } from "@/session";
import { useTheme } from "@/theme";
import {
  Badge,
  Button,
  Header,
  Screen,
  SectionLabel,
  Text,
  TextField,
  showToast,
} from "@/ui";
import {
  ChoiceBox,
  Note,
  Row,
  RowGroup,
  Stepper,
} from "../../leagues/components";
import { useCreateRoom } from "../api";
import {
  DAMES_VARIANTS,
  DEFAULT_DRAFT,
  LUDO_VARIANTS,
  ROOM_CLOCKS,
  ROOM_TURN_MS,
  SEAT_CHOICES,
  STAKE_MAX,
  STAKE_STEP,
  clockParts,
  draftRequest,
  isFriendlyVariant,
  seatAllowed,
  withGame,
  withVariant,
  type RoomDraft,
} from "../logic";

export function CreateRoomScreen() {
  const { t } = useTranslation("online");
  const f = useFormat();
  const { colors } = useTheme();
  const session = useAccessSession();
  const pseudo = useSession((s) => s.data?.user.pseudo ?? "");
  const [draft, setDraft] = useState<RoomDraft>(DEFAULT_DRAFT);
  const [name, setName] = useState(() =>
    t("create.defaultName", { pseudo }).slice(0, 30),
  );
  const create = useCreateRoom();
  const friendly = isFriendlyVariant(draft.variant);
  const stakeLocked = !session.isAdult || friendly;
  const variants = draft.game === "dames" ? DAMES_VARIANTS : LUDO_VARIANTS;
  const nameOk = name.trim().length >= 1;

  const submit = () => {
    create.mutate(
      draftRequest({ ...draft, stake: stakeLocked ? 0 : draft.stake }, name),
      {
        onSuccess: (room) => router.replace(`/salon/${room.code}` as Href),
        onError: (error) => showToast(translateError(error), "alert"),
      },
    );
  };

  return (
    <Screen
      testID="screen-creer-salon"
      space={draft.game}
      header={
        <Header
          title={t("create.title")}
          fallback="/"
          right={<Badge label={t("create.memberOnly")} display={false} />}
        />
      }
      footer={
        <Button
          label={t("create.submit")}
          onPress={submit}
          loading={create.isPending}
          disabled={!nameOk || session.status !== "member"}
          accessibilityHint={t("create.submitHint")}
        />
      }
    >
      <TextField
        label={t("create.name")}
        value={name}
        onChangeText={setName}
        maxLength={30}
        placeholder={t("create.namePlaceholder")}
      />

      <SectionLabel>{t("create.game")}</SectionLabel>
      <View style={styles.grid2}>
        {(["dames", "ludo"] as const).map((game) => (
          <ChoiceBox
            key={game}
            selected={draft.game === game}
            onPress={() => setDraft((d) => withGame(d, game))}
            title={t(`game.${game}`)}
            style={styles.half}
            fit
          />
        ))}
      </View>

      <SectionLabel>{t("create.variant")}</SectionLabel>
      <View style={styles.grid2}>
        {variants.map((v) => (
          <ChoiceBox
            key={v}
            selected={draft.variant === v}
            onPress={() => setDraft((d) => withVariant(d, v))}
            title={t(`variant.${v}`)}
            style={styles.half}
          />
        ))}
      </View>
      <Button
        variant="ghost"
        size="sm"
        label={t("create.rules")}
        onPress={() =>
          router.push(
            (draft.game === "dames" ? "/regles" : "/ludo/variantes") as Href,
          )
        }
        style={styles.link}
      />

      <SectionLabel>{t("create.seats")}</SectionLabel>
      <View style={styles.grid4}>
        {SEAT_CHOICES.map((n) => {
          const allowed = seatAllowed(draft.variant, n);
          return (
            <ChoiceBox
              key={n}
              selected={draft.seats === n}
              onPress={() =>
                allowed
                  ? setDraft((d) => ({ ...d, seats: n }))
                  : showToast(t("create.seatsNotAllowed", { count: n }))
              }
              title={t("create.seatsShort", { count: n })}
              style={[styles.cell, allowed ? null : styles.off]}
              fit
            />
          );
        })}
      </View>

      <SectionLabel>{t("create.format")}</SectionLabel>
      <View style={styles.stack}>
        {(["simple", "aller_retour", "roi"] as const).map((format) => (
          <ChoiceBox
            key={format}
            selected={draft.format === format}
            onPress={() => setDraft((d) => ({ ...d, format }))}
            title={t(`format.${format}.label`)}
            sub={t(`format.${format}.desc`)}
          />
        ))}
      </View>

      <SectionLabel>{t("create.pace")}</SectionLabel>
      <View style={styles.wrap}>
        {draft.game === "dames"
          ? ROOM_CLOCKS.map((c, i) => (
              <ChoiceBox
                key={i}
                selected={draft.clockIndex === i}
                onPress={() => setDraft((d) => ({ ...d, clockIndex: i }))}
                title={t("pace.clock", clockParts(c))}
                style={styles.pace}
                fit
              />
            ))
          : ROOM_TURN_MS.map((ms) => (
              <ChoiceBox
                key={ms}
                selected={draft.turnMs === ms}
                onPress={() => setDraft((d) => ({ ...d, turnMs: ms }))}
                title={t("pace.turn", { seconds: ms / 1000 })}
                style={styles.pace}
                fit
              />
            ))}
      </View>

      <RowGroup>
        <Row
          label={t("create.stake")}
          right={
            stakeLocked ? (
              <Text variant="labelStrong" tone="muted">
                {t("create.stakeNone")}
              </Text>
            ) : (
              <Stepper
                value={f.number(draft.stake)}
                onMinus={() =>
                  setDraft((d) => ({
                    ...d,
                    stake: Math.max(0, d.stake - STAKE_STEP),
                  }))
                }
                onPlus={() =>
                  setDraft((d) => ({
                    ...d,
                    stake: Math.min(STAKE_MAX, d.stake + STAKE_STEP),
                  }))
                }
                minusLabel={t("create.stakeLess")}
                plusLabel={t("create.stakeMore")}
                minusDisabled={draft.stake <= 0}
                plusDisabled={draft.stake >= STAKE_MAX}
              />
            )
          }
          last
        />
      </RowGroup>
      <Text variant="caption" tone="muted">
        {friendly
          ? t("create.stakeFriendly")
          : !session.isAdult
            ? t("create.stakeAdult")
            : t("create.stakeHelp")}
      </Text>
      {draft.stake > 0 && !stakeLocked ? (
        <Note>
          <Text variant="small">
            {t("create.stakeSummary", { stake: f.number(draft.stake) })}
            <Text variant="smallStrong" style={{ color: colors.actionText }}>
              {" "}
              {t("create.stakeCap")}
            </Text>
          </Text>
        </Note>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid2: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  grid4: { flexDirection: "row", gap: 8 },
  cell: { flexGrow: 1, flexBasis: 0, minWidth: 64, minHeight: 52 },
  half: { flexGrow: 1, flexBasis: "40%", minHeight: 52 },
  off: { opacity: 0.35 },
  stack: { gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pace: { minHeight: 48, flexGrow: 1 },
  link: { alignSelf: "flex-start" },
});
