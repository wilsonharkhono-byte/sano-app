// workflows/screens/clientReport/ReportLinesCard.tsx
// The "Tautan Progres" card under an issued client report (spec §6.1). Every
// line shows the AI's suggestion or the supervisor's decision; confirming is
// a tap, changing opens an inline picker under the row, and nothing here
// writes a number.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../components/Card';
import SelectSheet from '../../components/SelectSheet';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';
import type { BoqItem } from '../../../tools/types';
import type { ActivityState, ReportLineStage } from '../../../tools/reportLineDraftValidate';
import { ACTIVITY_STATE_LABELS, ACTIVITY_STATE_ORDER, stageOptions } from '../../../tools/progressClaims/stages';
import {
  confirmReportLine, confirmSuggestedLines, dismissReportLine, invokeReportLink, listReportLines, reopenReportLine,
  summarizeLines, suggestionLabel, type ClientReportLine,
} from '../../../tools/clientReportLines';

interface Props {
  reportId: string;
  boqItems: BoqItem[];
  toast: (message: string, kind: 'ok' | 'critical') => void;
}

interface EditDraft { boqItemId: string; stage: string; state: ActivityState }

const STATUS_LABELS: Record<ClientReportLine['status'], string> = { SUGGESTED: 'Saran', CONFIRMED: 'Terkonfirmasi', DISMISSED: 'Tidak terkait' };

export default function ReportLinesCard({ reportId, boqItems, toast }: Props) {
  const [lines, setLines] = useState<ClientReportLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ boqItemId: '', stage: '', state: 'LANJUT' });

  const load = useCallback(async () => {
    try {
      setLines(await listReportLines(reportId));
    } catch (err: any) {
      toast(err.message ?? 'Gagal memuat tautan', 'critical');
      setLines([]);
    }
  }, [reportId, toast]);

  useEffect(() => { load(); }, [load]);

  const rowOptions = useMemo(
    () => boqItems.map((b) => ({ value: b.id, code: b.code, label: b.label, meta: `${b.planned} ${b.unit}` })),
    [boqItems],
  );
  const stageOpts = useMemo(() => [{ value: '', label: 'Tanpa tahap' }, ...stageOptions()], []);
  const codeOf = useCallback((id: string | null) => boqItems.find((b) => b.id === id)?.code ?? null, [boqItems]);
  const summary = useMemo(() => summarizeLines(lines ?? []), [lines]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      await load();
    } catch (err: any) {
      toast(err.message ?? 'Gagal menyimpan', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const runAi = (force: boolean) => run(async () => {
    const res = await invokeReportLink(reportId, { force });
    if (!res.ok) toast(res.error ?? 'Tautan AI gagal', 'critical');
    else if (res.code === 'LINKED') toast(`AI menyarankan ${res.suggested ?? 0} tautan`, 'ok');
    else toast('Tidak ada baris yang perlu ditautkan', 'ok');
  });
  const confirmAll = () => run(async () => {
    const n = await confirmSuggestedLines(reportId);
    toast(`${n} tautan dikonfirmasi`, 'ok');
  });
  const acceptSuggestion = (line: ClientReportLine) => run(async () => {
    if (!line.ai_boq_item_id) return;
    await confirmReportLine(line.id, { boqItemId: line.ai_boq_item_id, stage: line.ai_stage, activityState: line.ai_activity_state ?? 'LANJUT' });
  });
  const dismiss = (line: ClientReportLine) => run(() => dismissReportLine(line.id));
  const reopen = (line: ClientReportLine) => run(() => reopenReportLine(line.id));
  const startEdit = (line: ClientReportLine) => {
    setEditing(line.id);
    setDraft({
      boqItemId: line.boq_item_id ?? line.ai_boq_item_id ?? '',
      stage: line.stage ?? line.ai_stage ?? '',
      state: (line.activity_state ?? line.ai_activity_state ?? 'LANJUT') as ActivityState,
    });
  };
  const saveEdit = (line: ClientReportLine) => {
    if (!draft.boqItemId) { toast('Pilih baris BoQ dulu', 'critical'); return; }
    run(async () => {
      await confirmReportLine(line.id, {
        boqItemId: draft.boqItemId,
        stage: (draft.stage || null) as ReportLineStage | null,
        activityState: draft.state,
      });
      setEditing(null);
    });
  };

  return (
    <Card
      title={`Tautan Progres (${summary.confirmed}/${summary.total})`}
      subtitle="Setiap baris update dikaitkan ke baris BoQ dan tahap. Saran AI perlu dikonfirmasi; angka progres tidak ditulis di sini."
    >
      {lines === null && <ActivityIndicator color={COLORS.primary} />}

      {lines && lines.length === 0 && (
        <View>
          <Text style={styles.hint}>Belum ada tautan untuk laporan ini.</Text>
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.disabled]} disabled={busy} onPress={() => runAi(false)}>
            <Ionicons name="sparkles-outline" size={16} color={COLORS.textInverse} />
            <Text style={styles.primaryText}>Buat tautan (AI)</Text>
          </TouchableOpacity>
        </View>
      )}

      {lines && lines.length > 0 && (
        <>
          <View style={styles.topRow}>
            {summary.suggestedReady > 0 && (
              <TouchableOpacity style={[styles.primaryBtn, busy && styles.disabled]} disabled={busy} onPress={confirmAll}>
                <Ionicons name="checkmark-done-outline" size={16} color={COLORS.textInverse} />
                <Text style={styles.primaryText}>Konfirmasi {summary.suggestedReady} saran</Text>
              </TouchableOpacity>
            )}
            {summary.aiMissing > 0 && (
              <TouchableOpacity style={[styles.secondaryBtn, busy && styles.disabled]} disabled={busy} onPress={() => runAi(true)}>
                <Ionicons name="sparkles-outline" size={16} color={COLORS.primary} />
                <Text style={styles.secondaryText}>Jalankan AI</Text>
              </TouchableOpacity>
            )}
          </View>

          {lines.map((line) => (
            <View key={line.id} style={styles.line} testID={`report-line-${line.line_index}`}>
              <Text style={styles.lineText} numberOfLines={3}>{line.line_text}</Text>
              <View style={styles.chipRow}>
                <View style={[styles.chip, line.status === 'CONFIRMED' && styles.chipOk, line.status === 'DISMISSED' && styles.chipMuted]}>
                  <Text style={styles.chipText}>{STATUS_LABELS[line.status]}</Text>
                </View>
                <Text style={styles.linkText}>{suggestionLabel(line, codeOf)}</Text>
              </View>
              {line.status === 'SUGGESTED' && line.ai_quote ? (
                <Text style={styles.quote}>{`“${line.ai_quote}”`}</Text>
              ) : null}

              {editing === line.id ? (
                <View style={styles.editBox}>
                  <Text style={styles.label}>Baris BoQ</Text>
                  <SelectSheet
                    value={draft.boqItemId}
                    options={rowOptions}
                    onChange={(v) => setDraft((d) => ({ ...d, boqItemId: v }))}
                    title="Pilih baris BoQ"
                    placeholder="Pilih baris"
                    emptyText="Proyek belum punya baris BoQ terbit."
                    accessibilityLabel={`Baris BoQ untuk update ${line.line_index + 1}`}
                  />
                  <Text style={styles.label}>Tahap</Text>
                  <SelectSheet
                    value={draft.stage}
                    options={stageOpts}
                    onChange={(v) => setDraft((d) => ({ ...d, stage: v }))}
                    title="Pilih tahap"
                    placeholder="Tanpa tahap"
                    accessibilityLabel={`Tahap untuk update ${line.line_index + 1}`}
                  />
                  <Text style={styles.label}>Status pekerjaan</Text>
                  <View style={styles.stateRow}>
                    {ACTIVITY_STATE_ORDER.map((s) => (
                      <TouchableOpacity key={s} style={[styles.stateChip, draft.state === s && styles.stateChipOn]} onPress={() => setDraft((d) => ({ ...d, state: s }))}>
                        <Text style={[styles.stateText, draft.state === s && styles.stateTextOn]}>{ACTIVITY_STATE_LABELS[s]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.btnRow}>
                    <TouchableOpacity style={[styles.primaryBtn, busy && styles.disabled]} disabled={busy} onPress={() => saveEdit(line)}>
                      <Text style={styles.primaryText}>Simpan</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.textBtn} onPress={() => setEditing(null)}>
                      <Text style={styles.textBtnLabel}>Batal</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.btnRow}>
                  {line.status === 'SUGGESTED' && line.ai_boq_item_id ? (
                    <TouchableOpacity style={styles.textBtn} disabled={busy} onPress={() => acceptSuggestion(line)}>
                      <Text style={styles.textBtnLabel}>Konfirmasi</Text>
                    </TouchableOpacity>
                  ) : null}
                  {line.status !== 'DISMISSED' ? (
                    <TouchableOpacity style={styles.textBtn} disabled={busy} onPress={() => startEdit(line)}>
                      <Text style={styles.textBtnLabel}>{line.status === 'CONFIRMED' ? 'Ubah' : 'Pilih baris'}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {line.status !== 'DISMISSED' ? (
                    <TouchableOpacity style={styles.textBtn} disabled={busy} onPress={() => dismiss(line)}>
                      <Text style={[styles.textBtnLabel, styles.muted]}>Tidak terkait</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.textBtn} disabled={busy} onPress={() => reopen(line)}>
                      <Text style={styles.textBtnLabel}>Buka lagi</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          ))}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, marginBottom: SPACE.sm, lineHeight: 19 },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.sm },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.base, alignSelf: 'flex-start' },
  primaryText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.base, alignSelf: 'flex-start' },
  secondaryText: { color: COLORS.primary, fontSize: TYPE.sm, fontFamily: FONTS.semibold },
  disabled: { opacity: 0.6 },
  line: { borderTopWidth: 1, borderTopColor: COLORS.borderSub, paddingVertical: SPACE.md - 2, gap: SPACE.xs + 2 },
  lineText: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, lineHeight: 19 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' },
  chip: { backgroundColor: COLORS.accentBg, borderRadius: 999, paddingHorizontal: SPACE.sm, paddingVertical: 2 },
  chipOk: { backgroundColor: COLORS.okBg },
  chipMuted: { backgroundColor: COLORS.surfaceAlt },
  chipText: { fontSize: TYPE.xs - 1, fontFamily: FONTS.bold, letterSpacing: 0.4, textTransform: 'uppercase', color: COLORS.text },
  linkText: { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, lineHeight: 19 },
  quote: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 18 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md, alignItems: 'center' },
  textBtn: { paddingVertical: SPACE.xs },
  textBtnLabel: { fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.4, color: COLORS.primary },
  muted: { color: COLORS.textSec },
  editBox: { backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS, padding: SPACE.md, gap: SPACE.xs },
  label: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginTop: SPACE.xs },
  stateRow: { flexDirection: 'row', gap: SPACE.sm, flexWrap: 'wrap' },
  stateChip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs + 2 },
  stateChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  stateText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text },
  stateTextOn: { color: COLORS.textInverse },
});
