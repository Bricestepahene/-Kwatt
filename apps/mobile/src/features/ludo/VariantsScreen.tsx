/**
 * Écran 20b · Ludo : plateau & règles (planches LudoVariantes et VariantesLudo).
 * 1 · Le plateau (5 variantes) ; 2 · Les mécanismes (tableau, « Personnaliser » : sortie,
 * capture, protection, barrières dans les limites de la planche, combinaisons bloquées
 * refusées avec le code de @kwatt/rules-ludo) ; règles maison enregistrées et nommées
 * (/v1/ludo/house-rules). Une partie aux règles maison est amicale.
 */
import type { HouseRuleSet } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { translateError, useDynamicT } from '@/i18n';
import { useIsOffline } from '@/offline';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { Badge, BottomSheet, Button, ConfirmSheet, Header, Icon, IconButton, Screen, Skeleton, Text, TextField, Toggle, showToast } from '@/ui';
import { useDeleteHouseRuleSet, useHouseRuleSets, useSaveHouseRuleSet } from './api';
import { mechanicLines, ruleValueKey, type MechanicLine } from './mechanics';
import { changePreset, isRankedSetup, PRESET_ORDER, ruleChoices, sanitizeSetup, withRule, type HouseRuleKey, type LudoSetup } from './setup';
import { setLudoSetup, useLudoSetup } from './setupStore';

export function VariantsScreen() {
  const { t } = useTranslation('ludo');
  const td = useDynamicT();
  const { colors } = useTheme();
  const setup = useLudoSetup();
  const member = useSession((s) => s.status === 'member');
  const offline = useIsOffline();
  const [custom, setCustom] = useState(setup.house !== null);
  // La variante gardée arrive après la lecture de l'appareil : « Personnaliser » suit ses règles maison.
  useEffect(() => {
    if (setup.house !== null) setCustom(true);
  }, [setup.house]);
  const [editing, setEditing] = useState<HouseRuleKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<HouseRuleSet | null>(null);
  const sets = useHouseRuleSets(member && !offline);
  const remove = useDeleteHouseRuleSet();

  const ranked = isRankedSetup(setup);
  const lines = mechanicLines(setup);
  const name = td(`ludo:board.${setup.preset}.name`);
  const update = (next: LudoSetup) => setLudoSetup(next);

  const toggleCustom = (on: boolean) => {
    setCustom(on);
    if (!on && setup.house) update({ ...setup, house: null, houseSet: null });
  };

  const apply = (set: HouseRuleSet) => {
    const next = sanitizeSetup({ preset: set.preset, house: set.rules, houseSet: { id: set.id, name: set.name } });
    update(next);
    setCustom(next.house !== null);
    showToast(t('variants.saved.applied', { name: set.name }), 'success');
  };

  return (
    <Screen
      space="ludo"
      header={
        <Header
          title={t('variants.title')}
          fallback={'/jouer/ludo' as Href}
          right={<Badge label={ranked ? t('variants.ranked') : t('variants.friendly')} tone={ranked ? 'action' : 'ndop'} />}
        />
      }
      gap={12}
      footer={<Button label={t('variants.play', { name })} onPress={() => router.navigate('/jouer/ludo?jouer=1' as Href)} />}
    >
      <Text variant="section" tone="muted">
        {t('variants.boardSection')}
      </Text>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {PRESET_ORDER.map((p) => {
          const on = p === setup.preset;
          return (
            <Pressable
              key={p}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${td(`ludo:board.${p}.name`)}. ${td(`ludo:board.${p}.desc`)}`}
              onPress={() => update(changePreset(setup, p))}
              style={({ pressed }) => [
                styles.board,
                { backgroundColor: colors.surface, borderColor: on ? colors.text : colors.border, borderWidth: on ? 2 : 1, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text variant="smallStrong">{td(`ludo:board.${p}.name`)}</Text>
              <Text variant="caption" tone="muted">
                {td(`ludo:board.${p}.desc`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.rowBetween}>
        <Text variant="section" tone="muted">
          {t('variants.mechSection')}
        </Text>
        <View style={styles.toggle}>
          <Text variant="smallStrong">{t('variants.customize')}</Text>
          <Toggle value={custom} onChange={toggleCustom} accessibilityLabel={t('variants.customize')} />
        </View>
      </View>
      <View style={[styles.table, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {lines.map((line, i) => (
          <MechanicRow key={line.row} line={line} first={i === 0} editable={custom && line.editable} onPress={() => setEditing(line.row as HouseRuleKey)} />
        ))}
      </View>
      <Text variant="caption" tone="muted">
        {custom ? t('variants.houseNote') : td(`ludo:board.${setup.preset}.note`)}
      </Text>

      {custom && setup.house && !setup.houseSet ? (
        member ? (
          <Button variant="outline" size="sm" icon="plus" label={t('variants.saved.save')} onPress={() => setSaving(true)} disabled={offline} />
        ) : null
      ) : null}

      <Text variant="section" tone="muted" style={styles.savedTitle}>
        {t('variants.saved.section')}
      </Text>
      {!member ? (
        <Text variant="small" tone="muted">
          {t('variants.saved.guest')}
        </Text>
      ) : offline ? (
        <Text variant="small" tone="muted">
          {t('variants.saved.offline')}
        </Text>
      ) : sets.isLoading ? (
        <Skeleton height={56} radius={12} />
      ) : (sets.data?.items.length ?? 0) === 0 ? (
        <Text variant="small" tone="muted">
          {sets.isError ? translateError(sets.error) : t('variants.saved.empty')}
        </Text>
      ) : (
        <View style={styles.savedList}>
          {sets.data!.items.map((set) => {
            const on = setup.houseSet?.id === set.id;
            return (
              <View key={set.id} style={[styles.saved, { backgroundColor: colors.surface, borderColor: on ? colors.text : colors.border, borderWidth: on ? 2 : 1 }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('variants.saved.use', { name: set.name })} onPress={() => apply(set)} style={styles.savedMain}>
                  <Text variant="labelStrong" numberOfLines={1}>
                    {set.name}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {[td(`ludo:board.${set.preset}.name`), ...Object.entries(set.rules).map(([rule, value]) => td(`ludo:${ruleValueKey(rule as HouseRuleKey, String(value))}`))].join(' · ')}
                  </Text>
                </Pressable>
                <IconButton icon="trash" tone="plain" accessibilityLabel={t('variants.saved.delete', { name: set.name })} onPress={() => setToDelete(set)} size={48} />
              </View>
            );
          })}
        </View>
      )}

      <RulePicker setup={setup} rule={editing} onClose={() => setEditing(null)} onPick={(next) => update(next)} />
      <SaveSheet visible={saving} setup={setup} onClose={() => setSaving(false)} onSaved={(set) => apply(set)} />
      <ConfirmSheet
        visible={toDelete !== null}
        title={t('variants.saved.deleteTitle', { name: toDelete?.name ?? '' })}
        message={t('variants.saved.deleteMessage')}
        confirmLabel={t('variants.saved.delete', { name: toDelete?.name ?? '' })}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await remove.mutateAsync(toDelete.id);
            if (setup.houseSet?.id === toDelete.id) update({ ...setup, houseSet: null });
            showToast(t('variants.saved.deleted'), 'success');
          } catch (error) {
            showToast(translateError(error), 'alert');
          }
          setToDelete(null);
        }}
      />
    </Screen>
  );
}

function MechanicRow({ line, first, editable, onPress }: { line: MechanicLine; first: boolean; editable: boolean; onPress: () => void }) {
  const { t } = useTranslation('ludo');
  const td = useDynamicT();
  const { colors } = useTheme();
  const label = td(`ludo:mech.rows.${line.row}`);
  const value = td(`ludo:${line.valueKey}`, line.params);
  const body = (
    <>
      <Text variant="small" tone="muted" style={styles.rowKey}>
        {label}
      </Text>
      <Text variant="smallStrong" tone={editable ? 'action' : 'default'} style={styles.rowValue}>
        {editable ? `${value} ›` : value}
      </Text>
    </>
  );
  const style = [styles.row, first ? null : { borderTopWidth: 1, borderTopColor: colors.border }];
  if (!editable) {
    return (
      <View style={style} accessible accessibilityLabel={`${label} : ${value}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('variants.changeRule', { rule: label, value })} onPress={onPress} style={({ pressed }) => [style, { opacity: pressed ? 0.8 : 1 }]}>
      {body}
    </Pressable>
  );
}

/** Choix d'un réglage maison : valeurs permises, combinaisons bloquées grisées avec leur raison. */
function RulePicker({ setup, rule, onClose, onPick }: { setup: LudoSetup; rule: HouseRuleKey | null; onClose: () => void; onPick: (next: LudoSetup) => void }) {
  const { t } = useTranslation('ludo');
  const td = useDynamicT();
  const { colors } = useTheme();
  const choices = rule ? ruleChoices(setup, rule) : [];
  const current = rule ? (setup.house?.[rule] ?? choices.find((c) => c.isDefault)?.value) : null;
  return (
    <BottomSheet visible={rule !== null} onClose={onClose} accessibilityLabel={rule ? td(`ludo:mech.rows.${rule}`) : ''}>
      <Text variant="title" accessibilityRole="header">
        {rule ? td(`ludo:mech.rows.${rule}`) : ''}
      </Text>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {choices.map((c) => {
          const on = c.value === current;
          const blocked = c.blocked;
          return (
            <Pressable
              key={c.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: !!blocked }}
              disabled={!!blocked}
              onPress={() => {
                if (!rule) return;
                onPick({ ...setup, house: withRule(setup, rule, c.value), houseSet: null });
                onClose();
              }}
              style={({ pressed }) => [
                styles.choice,
                { backgroundColor: colors.bg, borderColor: on ? colors.text : colors.border, borderWidth: on ? 2 : 1, opacity: blocked ? 0.55 : pressed ? 0.85 : 1 },
              ]}
            >
              <View style={styles.flex}>
                <Text variant="labelStrong">{rule ? td(`ludo:${ruleValueKey(rule, c.value)}`) : ''}</Text>
                {blocked ? (
                  <Text variant="caption" tone="alert">
                    {`${t('variants.blocked')} · ${td(`errors:${blocked.code}`, blocked.params)}`}
                  </Text>
                ) : c.isDefault ? (
                  <Text variant="caption" tone="muted">
                    {t('variants.official')}
                  </Text>
                ) : null}
              </View>
              {on ? <Icon name="check" size={20} color={colors.text} /> : null}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

function SaveSheet({ visible, setup, onClose, onSaved }: { visible: boolean; setup: LudoSetup; onClose: () => void; onSaved: (set: HouseRuleSet) => void }) {
  const { t } = useTranslation('ludo');
  const save = useSaveHouseRuleSet();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!setup.house || name.trim().length === 0) return;
    setError(null);
    try {
      const set = await save.mutateAsync({ name: name.trim(), preset: setup.preset, rules: setup.house });
      showToast(t('variants.saved.savedToast', { name: set.name }), 'success');
      setName('');
      onClose();
      onSaved(set);
    } catch (e) {
      setError(translateError(e));
    }
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('variants.saved.save')}>
      <Text variant="title" accessibilityRole="header">
        {t('variants.saved.save')}
      </Text>
      <TextField
        label={t('variants.saved.nameLabel')}
        placeholder={t('variants.saved.namePlaceholder')}
        value={name}
        onChangeText={setName}
        maxLength={40}
        error={error}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <Button label={t('variants.saved.confirm')} onPress={() => void submit()} loading={save.isPending} disabled={name.trim().length === 0} />
      <Button variant="ghost" label={t('variants.saved.cancel')} onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  board: { width: '48.6%', minHeight: 62, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center', gap: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  table: { borderWidth: 1, borderRadius: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 6 },
  rowKey: { flexShrink: 1 },
  rowValue: { textAlign: 'right', flexShrink: 1 },
  savedTitle: { marginTop: 8 },
  savedList: { gap: 8 },
  saved: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingLeft: 12 },
  savedMain: { flex: 1, paddingVertical: 10, gap: 2, minHeight: 48 },
  choices: { gap: 8 },
  choice: { minHeight: 52, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  flex: { flex: 1 },
});
