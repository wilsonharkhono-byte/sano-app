import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Card from '../../../workflows/components/Card';
import {
  canPairDatum,
  canSyncDatum,
  getDatumSyncState,
  importFromDatum,
  setDatumProjectCode,
  syncDatum,
  type DatumSyncState,
} from '../../../tools/datumSync';
import type { UserRoleType } from '../../../tools/constants';
import type { Project } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';
import {
  DATUM_CARD_COPY as T,
  differenceGroups,
  importOffer,
  importResultLines,
  lastRunView,
  staffView,
  waitingLine,
  type DifferenceGroup,
} from './datumSyncModel';

/**
 * "DATUM" on the Kelola ruangan sub-screen (spec 2026-09-27 §8.1): the
 * pairing, "Sinkron DATUM", the last run as the server wrote it, the
 * automatic-sync health line, "Ambil n ruangan dari DATUM" with an inline
 * confirmation, the differences and the staff not yet linked.
 *
 * Nothing on screen changes until the server has answered (truth contract):
 * a press only disables its button; afterwards the card reloads the run table
 * and shows what the server wrote. Every office role may pair, sync and
 * import (the owner's 2026-09-27 decision); others only read.
 */
export default function DatumSyncCard(props: {
  project: Pick<Project, 'id' | 'code' | 'name' | 'datum_project_code'>;
  role: UserRoleType | null | undefined;
  /** Reloads the project after the pairing changed (useProject().refresh). */
  onPaired: () => void | Promise<void>;
}) {
  const { project, role, onPaired } = props;
  const office = canPairDatum(role);
  const maySync = canSyncDatum(role);

  const [state, setState] = useState<DatumSyncState | { error: string } | null>(null);
  const request = useRef(0);
  const [pairedCode, setPairedCode] = useState<string | null>(project.datum_project_code ?? null);
  const [draft, setDraft] = useState(project.datum_project_code ?? '');
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importLines, setImportLines] = useState<string[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setPairedCode(project.datum_project_code ?? null);
    setDraft(project.datum_project_code ?? '');
  }, [project.id, project.datum_project_code]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setState(null);
    const next = await getDatumSyncState(project.id);
    if (id === request.current) setState(next);
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePairing = async () => {
    setPairing(true);
    setPairError(null);
    const res = await setDatumProjectCode(project.id, draft);
    setPairing(false);
    if (res.error !== undefined) {
      setPairError(res.error);
      return;
    }
    setPairedCode(res.code);
    setDraft(res.code ?? '');
    await onPaired();
  };

  const runSync = async () => {
    setSyncing(true);
    setSyncError(null);
    const res = await syncDatum(project.id);
    setSyncing(false);
    if (res.error !== undefined) setSyncError(res.error);
    await load();
  };

  const offer = useMemo(() => (state && !('error' in state) ? importOffer(state) : null), [state]);

  const runImport = async () => {
    if (!offer) return;
    setImporting(true);
    setImportError(null);
    setImportLines(null);
    const res = await importFromDatum(project.id, offer.areas.map((a) => a.area_code));
    setImporting(false);
    if (res.error !== undefined) {
      setImportError(res.error);
    } else {
      setImportLines(importResultLines(res.run));
      setImportOpen(false);
    }
    await load();
  };

  const syncDisabled = syncing || !pairedCode || !maySync;
  const trimmedDraft = draft.trim().toUpperCase();
  const pairingUnchanged = trimmedDraft === (pairedCode ?? '');

  return (
    <Card title={T.title} subtitle="Tautan proyek ini ke DATUM: ruangan, status gerbang dan keputusan.">
      <Text style={styles.label}>{T.pairingLabel}</Text>
      {office ? (
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={T.pairingPlaceholder}
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!pairing}
            accessibilityLabel={T.pairingLabel}
          />
          <TouchableOpacity
            style={[styles.ghostBtn, (pairing || pairingUnchanged) && styles.off]}
            disabled={pairing || pairingUnchanged}
            onPress={() => void savePairing()}
            accessibilityRole="button"
          >
            <Text style={styles.ghostText}>{pairing ? T.pairingSaving : T.pairingSave}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.value}>{pairedCode ?? T.unpaired}</Text>
      )}
      {pairError ? <Text style={styles.error}>{pairError}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, syncDisabled && styles.primaryOff]}
        disabled={syncDisabled}
        onPress={() => void runSync()}
        accessibilityRole="button"
        accessibilityState={{ disabled: syncDisabled }}
      >
        <Text style={styles.primaryText}>{syncing ? T.syncing : T.sync}</Text>
      </TouchableOpacity>
      {!pairedCode ? <Text style={styles.hint}>{T.syncNeedsPairing}</Text> : null}
      {syncError ? <Text style={styles.error}>{syncError}</Text> : null}

      <LastRun state={state} onRetry={() => void load()} />

      {offer && office ? (
        <View style={styles.block}>
          {offer.buttonLabel === null ? null : !importOpen ? (
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setImportOpen(true)} accessibilityRole="button">
              <Text style={styles.ghostText}>{offer.buttonLabel}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.confirm}>
              <Text style={styles.body}>{offer.question}</Text>
              {offer.areas.map((a) => (
                <Text key={a.area_code} style={styles.listLine}>{a.line}</Text>
              ))}
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.ghostBtn, importing && styles.off]}
                  disabled={importing}
                  onPress={() => setImportOpen(false)}
                  accessibilityRole="button"
                >
                  <Text style={styles.ghostText}>{T.importCancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, importing && styles.primaryOff]}
                  disabled={importing}
                  onPress={() => void runImport()}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: importing }}
                >
                  <Text style={styles.primaryText}>{importing ? T.importing : T.importConfirm}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {offer.limitNote ? <Text style={styles.hint}>{offer.limitNote}</Text> : null}
          {offer.tooLong.length > 0 ? (
            <View style={[styles.group, styles.block]}>
              <Text style={styles.groupTitle}>{T.importTooLong}</Text>
              {offer.tooLong.map((line, i) => <Text key={`${i}:${line}`} style={styles.listLine}>{line}</Text>)}
            </View>
          ) : null}
        </View>
      ) : null}
      {importError ? <Text style={styles.error}>{importError}</Text> : null}
      {importLines ? importLines.map((line) => <Text key={line} style={styles.body}>{line}</Text>) : null}

      {state && !('error' in state) ? <Differences state={state} /> : null}
    </Card>
  );
}

function LastRun({ state, onRetry }: { state: DatumSyncState | { error: string } | null; onRetry: () => void }) {
  if (state === null) return <Text style={styles.muted}>{T.loading}</Text>;
  if ('error' in state) {
    return (
      <View style={styles.row}>
        <Text style={styles.error}>{T.readError}</Text>
        <TouchableOpacity onPress={onRetry} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.link}>{T.retry}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  const view = lastRunView(state, new Date().toISOString());
  const wait = waitingLine(state);
  return (
    <View style={styles.block}>
      <Text style={[styles.body, view.tone === 'critical' && styles.criticalText]}>{view.line}</Text>
      {view.details.map((d) => <Text key={d} style={styles.muted}>{d}</Text>)}
      {view.steps.map((s) => <Text key={s} style={styles.criticalSmall}>{s}</Text>)}
      {wait ? <Text style={styles.warning}>{wait}</Text> : null}
    </View>
  );
}

function Groups({ groups }: { groups: DifferenceGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <View key={g.title} style={styles.group}>
          <Text style={styles.groupTitle}>{g.title}</Text>
          {g.lines.map((line) => <Text key={line} style={styles.listLine}>{line}</Text>)}
          {g.note ? <Text style={styles.hint}>{g.note}</Text> : null}
        </View>
      ))}
    </>
  );
}

function Differences({ state }: { state: DatumSyncState }) {
  const groups = differenceGroups(state.latestFinished);
  const staff = staffView(state.staffRun);
  return (
    <>
      {groups.length > 0 ? (
        <View style={styles.block}>
          <Groups groups={groups} />
          <Text style={styles.hint}>{T.differencesNote}</Text>
        </View>
      ) : null}
      {staff ? (
        <View style={styles.block}>
          <Text style={styles.groupTitle}>{staff.heading}</Text>
          <Groups groups={staff.groups} />
          <Text style={styles.body}>{staff.linkedLine}</Text>
          <Text style={styles.hint}>{T.staffNote}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, marginBottom: 6 },
  value: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text, marginBottom: SPACE.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' },
  input: {
    flex: 1, minWidth: 140, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    padding: SPACE.md, fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.text,
  },
  ghostBtn: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.md,
    minHeight: 44, justifyContent: 'center',
  },
  ghostText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  off: { opacity: 0.5 },
  primaryBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.md,
    marginTop: SPACE.md, alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center',
  },
  primaryOff: { backgroundColor: COLORS.surfaceAlt },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  block: { marginTop: SPACE.md },
  confirm: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, gap: SPACE.xs },
  body: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, lineHeight: 18 },
  muted: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 16 },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 16, marginTop: SPACE.xs },
  error: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.critical, lineHeight: 18, marginTop: SPACE.xs },
  criticalText: { color: COLORS.critical, fontFamily: FONTS.medium },
  criticalSmall: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.critical, lineHeight: 16 },
  warning: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.warning, lineHeight: 16, marginTop: SPACE.xs },
  retry: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary },
  group: { marginBottom: SPACE.sm },
  groupTitle: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  listLine: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.text, lineHeight: 16 },
});
