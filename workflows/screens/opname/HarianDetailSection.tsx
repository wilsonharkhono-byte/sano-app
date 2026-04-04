import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import Card from '../../components/Card';
import Badge from '../../components/Badge';
import { formatRp } from '../../../tools/opname';
import {
  formatPayPreview, attendanceStatusLabel, recomputeHarianOpname,
  type WorkerAttendanceEntry,
} from '../../../tools/workerAttendance';
import {
  type HarianCostAllocation, type HarianAllocationBoqCandidate, type HarianAllocationScope,
} from '../../../tools/opname';
import { COLORS, FONTS, TYPE, SPACE } from '../../theme';
import { styles } from './opnameStyles';
import type { OpnameHeader } from '../../../tools/opname';

const HARIAN_SCOPE_LABELS: Record<HarianAllocationScope, string> = {
  boq_item: 'Item BoQ',
  general_support: 'Support Umum',
  rework: 'Rework / Punchlist',
  site_overhead: 'Overhead Lapangan',
};

interface HarianDetailSectionProps {
  activeOpname: OpnameHeader;
  harianEntries: WorkerAttendanceEntry[];
  harianAllocations: HarianCostAllocation[];
  harianAllocationCandidates: HarianAllocationBoqCandidate[];
  allocationInputs: Record<string, { allocation_pct: string; supervisor_note: string; estimator_note: string }>;
  showAddAllocation: boolean;
  setShowAddAllocation: (show: boolean) => void;
  addAllocationScope: HarianAllocationScope;
  setAddAllocationScope: (scope: HarianAllocationScope) => void;
  addAllocationBoqItemId: string;
  setAddAllocationBoqItemId: (id: string) => void;
  addAllocationPct: string;
  setAddAllocationPct: (pct: string) => void;
  addAllocationAmount: string;
  setAddAllocationAmount: (amount: string) => void;
  addSupervisorNote: string;
  setAddSupervisorNote: (note: string) => void;
  addEstimatorNote: string;
  setAddEstimatorNote: (note: string) => void;
  aiAllocating: boolean;
  aiAllocationSummary: string | null;
  savingAllocationId: string | null;
  deletingAllocationId: string | null;
  harianAllocationSummary: any;
  addAllocationPreviewPct: number;
  canEditHarianAllocation: boolean;
  canEditEstimatorAllocationNote: boolean;
  isEstimator: boolean;
  loading: boolean;
  handleAllocationInputChange: (allocationId: string, field: 'allocation_pct' | 'supervisor_note' | 'estimator_note', value: string) => void;
  handleAllocationSave: (allocation: HarianCostAllocation) => Promise<void>;
  handleDeleteAllocationRow: (allocation: HarianCostAllocation) => Promise<void>;
  handleUseAiSuggestion: (allocation: HarianCostAllocation) => Promise<void>;
  handleAddAllocation: () => Promise<void>;
  handleGenerateAiAllocation: () => Promise<void>;
  resetHarianAllocationForm: () => void;
  refreshActiveOpname: () => Promise<void>;
  loadHarianDetail: (opname: OpnameHeader) => Promise<void>;
  toast: (msg: string, type: string) => void;
}

export const HarianDetailSection: React.FC<HarianDetailSectionProps> = ({
  activeOpname,
  harianEntries,
  harianAllocations,
  harianAllocationCandidates,
  allocationInputs,
  showAddAllocation,
  setShowAddAllocation,
  addAllocationScope,
  setAddAllocationScope,
  addAllocationBoqItemId,
  setAddAllocationBoqItemId,
  addAllocationPct,
  setAddAllocationPct,
  addAllocationAmount,
  setAddAllocationAmount,
  addSupervisorNote,
  setAddSupervisorNote,
  addEstimatorNote,
  setAddEstimatorNote,
  aiAllocating,
  aiAllocationSummary,
  savingAllocationId,
  deletingAllocationId,
  harianAllocationSummary,
  addAllocationPreviewPct,
  canEditHarianAllocation,
  canEditEstimatorAllocationNote,
  isEstimator,
  loading,
  handleAllocationInputChange,
  handleAllocationSave,
  handleDeleteAllocationRow,
  handleUseAiSuggestion,
  handleAddAllocation,
  handleGenerateAiAllocation,
  resetHarianAllocationForm,
  refreshActiveOpname,
  loadHarianDetail,
  toast,
}) => {
  return (
    <>
      <View style={{ paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs, borderRadius: 4, backgroundColor: COLORS.infoBg, alignSelf: 'flex-start', marginBottom: SPACE.md }}>
        <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.info }}>PEMBAYARAN HARIAN</Text>
      </View>

      <Card borderColor={COLORS.info}>
        <Text style={styles.reconTitle}>Harian membayar tenaga kerja, bukan mengubah progress BoQ otomatis</Text>
        <Text style={styles.hint}>
          Pembayaran HOK mingguan dihitung dari kehadiran pekerja. Progress fisik BoQ tetap dicatat di progres lapangan.
          Untuk kontrak campuran, pilih mode minggu ini saat membuat opname.
        </Text>
      </Card>

      {activeOpname.week_start && activeOpname.week_end && (
        <Text style={styles.hint}>
          Periode: {activeOpname.week_start} — {activeOpname.week_end}
        </Text>
      )}

      {/* Harian payment waterfall */}
      <Card>
        <Text style={[styles.sectionHead, { marginTop: 0 }]}>Ringkasan Pembayaran</Text>
        <View style={styles.paymentSummary}>
          <View style={styles.paymentItem}>
            <Text style={styles.paymentLabel}>Gross (kehadiran)</Text>
            <Text style={styles.paymentValue}>{formatRp(activeOpname.gross_total)}</Text>
          </View>
          <View style={styles.paymentItem}>
            <Text style={styles.paymentLabel}>Retensi</Text>
            <Text style={styles.paymentValue}>{formatRp(0)}</Text>
          </View>
        </View>
        <View style={styles.paymentSummary}>
          <View style={styles.paymentItem}>
            <Text style={styles.paymentLabel}>Prior paid</Text>
            <Text style={styles.paymentValue}>{formatRp(activeOpname.prior_paid)}</Text>
          </View>
          <View style={styles.paymentItem}>
            <Text style={styles.paymentLabel}>Kasbon</Text>
            <Text style={styles.paymentValue}>{formatRp(activeOpname.kasbon)}</Text>
          </View>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACE.md, marginTop: SPACE.md }}>
          <Text style={styles.paymentLabel}>NET BAYAR MINGGU INI</Text>
          <Text style={[styles.paymentValue, { fontSize: TYPE.lg, color: COLORS.ok }]}>{formatRp(activeOpname.net_this_week)}</Text>
        </View>
      </Card>

      <Card borderColor={COLORS.info}>
        <View style={styles.reconHeader}>
          <Ionicons name="sparkles-outline" size={18} color={COLORS.info} />
          <Text style={styles.reconTitle}>Saran AI untuk alokasi biaya harian</Text>
        </View>
        <Text style={styles.hint}>
          AI membaca kehadiran mingguan, uraian kerja, trade mandor, dan kandidat BoQ untuk memberi saran distribusi biaya.
          AI tidak mengubah progress fisik dan tidak mengisi alokasi final otomatis.
        </Text>
        {aiAllocationSummary && (
          <View style={styles.aiSummaryBox}>
            <Text style={styles.aiSummaryText}>{aiAllocationSummary}</Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.secondaryBtn, aiAllocating && styles.disabledBtn]}
          onPress={handleGenerateAiAllocation}
          disabled={aiAllocating}
        >
          {aiAllocating
            ? <ActivityIndicator size="small" color={COLORS.info} />
            : <Ionicons name="sparkles-outline" size={18} color={COLORS.info} />}
          <Text style={styles.secondaryBtnText}>Generate Saran AI</Text>
        </TouchableOpacity>
      </Card>

      <Card borderColor={harianAllocationSummary.remainingPct > 0.05 ? COLORS.warning : COLORS.ok}>
        <View style={styles.reconHeader}>
          <Ionicons
            name={harianAllocationSummary.remainingPct > 0.05 ? 'layers-outline' : 'checkmark-circle-outline'}
            size={18}
            color={harianAllocationSummary.remainingPct > 0.05 ? COLORS.warning : COLORS.ok}
          />
          <Text style={styles.reconTitle}>Alokasi biaya harian ke BoQ / scope kerja</Text>
        </View>
        <Text style={styles.hint}>
          Gunakan modul ini untuk menjelaskan biaya harian minggu ini masuk ke pekerjaan apa saja.
          Alokasi ini membantu rekonsiliasi biaya, tapi tidak menulis progress BoQ otomatis.
        </Text>

        <View style={styles.paymentSummary}>
          <View style={styles.paymentItem}>
            <Text style={styles.paymentLabel}>Sudah dialokasikan</Text>
            <Text style={styles.paymentValue}>{harianAllocationSummary.allocatedPct.toFixed(2)}%</Text>
            <Text style={styles.hint}>{formatRp(harianAllocationSummary.allocatedAmount)}</Text>
          </View>
          <View style={styles.paymentItem}>
            <Text style={styles.paymentLabel}>Sisa belum dialokasikan</Text>
            <Text style={[
              styles.paymentValue,
              { color: harianAllocationSummary.remainingPct > 0.05 ? COLORS.warning : COLORS.ok },
            ]}>
              {harianAllocationSummary.remainingPct.toFixed(2)}%
            </Text>
            <Text style={styles.hint}>{formatRp(harianAllocationSummary.remainingAmount)}</Text>
          </View>
        </View>

        {canEditHarianAllocation && (
          showAddAllocation ? (
            <View style={styles.allocationForm}>
              <Text style={[styles.fieldLabel, { marginTop: 0 }]}>Tambah target alokasi</Text>
              <View style={styles.scopeChipRow}>
                {(['boq_item', 'general_support', 'rework', 'site_overhead'] as HarianAllocationScope[]).map(scope => (
                  <TouchableOpacity
                    key={scope}
                    style={[
                      styles.scopeChip,
                      addAllocationScope === scope && styles.scopeChipActive,
                    ]}
                    onPress={() => setAddAllocationScope(scope)}
                  >
                    <Text style={[
                      styles.scopeChipText,
                      addAllocationScope === scope && styles.scopeChipTextActive,
                    ]}>
                      {HARIAN_SCOPE_LABELS[scope]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {addAllocationScope === 'boq_item' && (
                <View style={styles.pickerWrap}>
                  <Picker
                    selectedValue={addAllocationBoqItemId}
                    onValueChange={value => setAddAllocationBoqItemId(value || '')}
                  >
                    <Picker.Item label="— Pilih item BoQ —" value="" />
                    {harianAllocationCandidates.map(candidate => (
                      <Picker.Item
                        key={candidate.id}
                        label={`${candidate.code} — ${candidate.label}`}
                        value={candidate.id}
                      />
                    ))}
                  </Picker>
                </View>
              )}

              <View style={styles.allocationEntryRow}>
                <View style={styles.pctInput}>
                  <Text style={styles.pctLabel}>Alokasi %</Text>
                  <TextInput
                    style={styles.pctField}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={COLORS.textMuted}
                    value={addAllocationPct}
                    onChangeText={setAddAllocationPct}
                  />
                </View>
                <View style={styles.pctInput}>
                  <Text style={styles.pctLabel}>Atau nominal (Rp)</Text>
                  <TextInput
                    style={styles.pctField}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={COLORS.textMuted}
                    value={addAllocationAmount}
                    onChangeText={text => setAddAllocationAmount(text.replace(/[^\d.]/g, ''))}
                  />
                </View>
              </View>

              <Text style={styles.hint}>
                Preview final: {addAllocationPreviewPct.toFixed(2)}% · {formatRp((activeOpname.gross_total ?? 0) * (addAllocationPreviewPct / 100))}
              </Text>

              <Text style={styles.fieldLabel}>Catatan Supervisor</Text>
              <TextInput
                style={[styles.input, styles.textareaSmall]}
                multiline
                placeholder="Apa pekerjaan utama minggu ini?"
                placeholderTextColor={COLORS.textMuted}
                value={addSupervisorNote}
                onChangeText={setAddSupervisorNote}
              />

              {isEstimator && (
                <>
                  <Text style={styles.fieldLabel}>Catatan Estimator</Text>
                  <TextInput
                    style={[styles.input, styles.textareaSmall]}
                    multiline
                    placeholder="Catatan review estimator..."
                    placeholderTextColor={COLORS.textMuted}
                    value={addEstimatorNote}
                    onChangeText={setAddEstimatorNote}
                  />
                </>
              )}

              <View style={styles.rowBtns}>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleAddAllocation}>
                  <Text style={styles.primaryBtnText}>Simpan Alokasi</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={resetHarianAllocationForm}>
                  <Text style={styles.ghostBtnText}>Batal</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.ghostBtn, { marginTop: SPACE.md }]}
              onPress={() => setShowAddAllocation(true)}
            >
              <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
              <Text style={styles.ghostBtnText}>Tambah Alokasi</Text>
            </TouchableOpacity>
          )
        )}

        {harianAllocations.length === 0 ? (
          <View style={styles.emptyAllocationBox}>
            <Text style={styles.hint}>
              Belum ada row alokasi. Tambahkan target manual atau generate saran AI untuk mulai menyusun distribusi biaya minggu ini.
            </Text>
          </View>
        ) : (
          harianAllocations.map(allocation => {
            const targetLabel = allocation.allocation_scope === 'boq_item'
              ? `${allocation.boq_code ?? 'BoQ'} — ${allocation.boq_label ?? 'Tanpa label'}`
              : HARIAN_SCOPE_LABELS[allocation.allocation_scope];
            const livePct = parseFloat(allocationInputs[allocation.id]?.allocation_pct ?? String(allocation.allocation_pct));
            const effectivePct = Number.isFinite(livePct) ? Math.max(0, Math.min(100, livePct)) : Number(allocation.allocation_pct ?? 0);
            const effectiveAmount = (activeOpname.gross_total ?? 0) * (effectivePct / 100);

            return (
              <View key={allocation.id} style={styles.allocationRowCard}>
                <View style={styles.allocationRowHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineDesc}>{targetLabel}</Text>
                    <Text style={styles.hint}>
                      {allocation.allocation_scope === 'boq_item'
                        ? 'Scope BoQ'
                        : `Scope ${HARIAN_SCOPE_LABELS[allocation.allocation_scope]}`}
                    </Text>
                  </View>
                  {canEditHarianAllocation && (
                    <TouchableOpacity
                      onPress={() => handleDeleteAllocationRow(allocation)}
                      disabled={deletingAllocationId === allocation.id}
                      style={styles.deleteAllocationBtn}
                    >
                      {deletingAllocationId === allocation.id
                        ? <ActivityIndicator size="small" color={COLORS.critical} />
                        : <Ionicons name="trash-outline" size={18} color={COLORS.critical} />}
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.allocationEntryRow}>
                  <View style={styles.pctInput}>
                    <Text style={styles.pctLabel}>Alokasi Final %</Text>
                    {canEditHarianAllocation ? (
                      <TextInput
                        style={styles.pctField}
                        keyboardType="numeric"
                        value={allocationInputs[allocation.id]?.allocation_pct ?? String(allocation.allocation_pct)}
                        onChangeText={text => handleAllocationInputChange(allocation.id, 'allocation_pct', text)}
                        onEndEditing={() => handleAllocationSave(allocation)}
                      />
                    ) : (
                      <Text style={styles.pctDisplay}>{effectivePct.toFixed(2)}%</Text>
                    )}
                  </View>
                  <View style={styles.amountBox}>
                    <Text style={styles.pctLabel}>Nominal Minggu Ini</Text>
                    <Text style={styles.amountValue}>{formatRp(effectiveAmount)}</Text>
                  </View>
                </View>

                {allocation.ai_suggested_pct != null && (
                  <View style={styles.aiSuggestionRow}>
                    <Text style={styles.hint}>
                      AI menyarankan {allocation.ai_suggested_pct.toFixed(2)}%
                      {allocation.ai_reason ? ` · ${allocation.ai_reason}` : ''}
                    </Text>
                    {canEditHarianAllocation && (
                      <TouchableOpacity onPress={() => handleUseAiSuggestion(allocation)}>
                        <Text style={styles.applyAiText}>Pakai saran AI</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                <Text style={styles.fieldLabel}>Catatan Supervisor</Text>
                {canEditHarianAllocation ? (
                  <TextInput
                    style={[styles.input, styles.textareaSmall]}
                    multiline
                    placeholder="Apa pekerjaan utama yang dikerjakan?"
                    placeholderTextColor={COLORS.textMuted}
                    value={allocationInputs[allocation.id]?.supervisor_note ?? ''}
                    onChangeText={text => handleAllocationInputChange(allocation.id, 'supervisor_note', text)}
                    onEndEditing={() => handleAllocationSave(allocation)}
                  />
                ) : (
                  <Text style={styles.hint}>{allocation.supervisor_note || 'Belum ada catatan supervisor.'}</Text>
                )}

                <Text style={styles.fieldLabel}>Catatan Estimator</Text>
                {canEditEstimatorAllocationNote ? (
                  <TextInput
                    style={[styles.input, styles.textareaSmall]}
                    multiline
                    placeholder="Catatan review estimator..."
                    placeholderTextColor={COLORS.textMuted}
                    value={allocationInputs[allocation.id]?.estimator_note ?? ''}
                    onChangeText={text => handleAllocationInputChange(allocation.id, 'estimator_note', text)}
                    onEndEditing={() => handleAllocationSave(allocation)}
                  />
                ) : (
                  <Text style={styles.hint}>{allocation.estimator_note || 'Belum ada catatan estimator.'}</Text>
                )}

                {savingAllocationId === allocation.id && (
                  <View style={styles.inlineSavingRow}>
                    <ActivityIndicator size="small" color={COLORS.primary} />
                    <Text style={styles.hint}>Menyimpan alokasi...</Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </Card>

      {activeOpname.status === 'SUBMITTED' && harianAllocationSummary.remainingPct > 0.05 && (
        <Card borderColor={COLORS.warning}>
          <Text style={styles.reconTitle}>Verifikasi tertahan sampai alokasi genap 100%</Text>
          <Text style={styles.hint}>
            Lengkapi alokasi biaya harian dulu. Sistem akan menahan verifikasi jika masih ada sisa {harianAllocationSummary.remainingPct.toFixed(2)}%
            atau {formatRp(harianAllocationSummary.remainingAmount)} yang belum dialokasikan.
          </Text>
        </Card>
      )}

      {/* Per-worker breakdown */}
      <Text style={styles.sectionHead}>Detail Per Pekerja</Text>
      {harianEntries.length === 0 && !loading && (
        <Card>
          <Text style={styles.hint}>Belum ada data kehadiran untuk minggu ini. Catat kehadiran di tab Kehadiran.</Text>
        </Card>
      )}
      {(() => {
        const byWorker = new Map<string, WorkerAttendanceEntry[]>();
        for (const e of harianEntries) {
          const arr = byWorker.get(e.worker_id) ?? [];
          arr.push(e);
          byWorker.set(e.worker_id, arr);
        }
        return Array.from(byWorker.entries()).map(([wid, entries]) => {
          const name = entries[0]?.worker_name ?? 'Pekerja';
          const totalPay = entries.reduce((s, e) => s + e.day_total, 0);
          const daysPresent = entries.filter(e => e.is_present).length;
          const totalOT = entries.reduce((s, e) => s + (e.is_present ? e.overtime_hours : 0), 0);
          return (
            <Card key={wid}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text }}>{name}</Text>
                <Text style={{ fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.ok }}>{formatRp(totalPay)}</Text>
              </View>
              <Text style={styles.hint}>
                {daysPresent} hari hadir{totalOT > 0 ? ` · ${totalOT}j lembur` : ''}
              </Text>
              {entries.map(e => (
                <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub }}>
                  <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text, width: 40 }}>{e.attendance_date.slice(5)}</Text>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: e.is_present ? COLORS.ok : COLORS.critical }} />
                  <Text style={[styles.hint, { flex: 1 }]}>
                    {e.is_present ? formatPayPreview(e.regular_pay, e.overtime_pay) : 'Absen'}
                  </Text>
                  <Badge
                    flag={e.status === 'SETTLED' ? 'OK' : e.status === 'CONFIRMED' || e.status === 'OVERRIDDEN' ? 'INFO' : 'WARNING'}
                    label={attendanceStatusLabel(e.status)}
                  />
                </View>
              ))}
            </Card>
          );
        });
      })()}

      {/* Refresh totals */}
      {activeOpname.status === 'DRAFT' && (
        <TouchableOpacity
          style={[styles.ghostBtn, { marginTop: SPACE.md }]}
          onPress={async () => {
            await recomputeHarianOpname(activeOpname.id);
            await refreshActiveOpname();
            await loadHarianDetail(activeOpname);
            toast('Total diperbarui dari kehadiran', 'ok');
          }}
        >
          <Ionicons name="refresh" size={16} color={COLORS.primary} />
          <Text style={styles.ghostBtnText}>Refresh Total dari Kehadiran</Text>
        </TouchableOpacity>
      )}
    </>
  );
};
