import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../components/Card';
import { formatRp } from '../../../tools/opname';
import type { OpnameHeader, OpnameLine, OpnameProgressFlag } from '../../../tools/opname';
import { COLORS, FONTS, TYPE, SPACE } from '../../theme';
import { styles } from './opnameStyles';

interface BoronganLinesSectionProps {
  activeOpname: OpnameHeader;
  lines: OpnameLine[];
  progressFlags: Record<string, OpnameProgressFlag>;
  lineInputs: Record<string, { cumulative_pct: string; verified_pct: string }>;
  previewLines: any[];
  previewGrossTotal: number;
  previewRetentionAmount: number;
  previewNetToDate: number;
  previewKasbon: number;
  previewNetThisWeek: number;
  kasbonInput: string;
  setKasbonInput: (input: string) => void;
  attendanceTotal: number;
  canDraftEditRole: boolean;
  isEstimator: boolean;
  isAdmin: boolean;
  canImportProgress: boolean;
  tdkAccLineId: string | null;
  setTdkAccLineId: (id: string | null) => void;
  tdkAccReason: string;
  setTdkAccReason: (reason: string) => void;
  importingProgress: boolean;
  exportingTemplate: boolean;
  verifyNotes: string;
  setVerifyNotes: (notes: string) => void;
  handleLineInputText: (lineId: string, field: 'cumulative_pct' | 'verified_pct', value: string) => void;
  handleLineCommit: (line: OpnameLine, field: 'cumulative_pct' | 'verified_pct') => Promise<void>;
  handleTdkAcc: (line: OpnameLine) => Promise<void>;
  handleTdkAccSubmit: () => Promise<void>;
  handleImportProgress: () => Promise<void>;
  handleDownloadProgressTemplate: () => Promise<void>;
}

export const BoronganLinesSection: React.FC<BoronganLinesSectionProps> = ({
  activeOpname,
  lines,
  progressFlags,
  lineInputs,
  previewLines,
  previewGrossTotal,
  previewRetentionAmount,
  previewNetToDate,
  previewKasbon,
  previewNetThisWeek,
  kasbonInput,
  setKasbonInput,
  attendanceTotal,
  canDraftEditRole,
  isEstimator,
  isAdmin,
  canImportProgress,
  tdkAccLineId,
  setTdkAccLineId,
  tdkAccReason,
  setTdkAccReason,
  importingProgress,
  exportingTemplate,
  verifyNotes,
  setVerifyNotes,
  handleLineInputText,
  handleLineCommit,
  handleTdkAcc,
  handleTdkAccSubmit,
  handleImportProgress,
  handleDownloadProgressTemplate,
}) => {
  return (
    <>
      {/* Progress flags warning */}
      {Object.keys(progressFlags).length > 0 && (
        <Card borderColor={COLORS.warning}>
          <View style={styles.reconHeader}>
            <Ionicons name="warning-outline" size={18} color={COLORS.warning} />
            <Text style={styles.reconTitle}>Perlu cek silang dengan Progress Lapangan</Text>
          </View>
          <Text style={styles.hint}>
            {Object.keys(progressFlags).length} item opname berbeda signifikan dari progress Gate 4.
            Klaim mandor tetap bisa direview, tapi angka ini perlu dicek sebelum verifikasi/approval.
          </Text>
        </Card>
      )}

      {lines.length === 0 && (
        <Card borderColor={COLORS.warning}>
          <Text style={styles.reconTitle}>Belum ada item pembayaran yang terhubung</Text>
          <Text style={styles.hint}>
            Draft opname ini kosong karena item BoQ belum dikonfigurasi di Kontrak Mandor.
            Buka tab Kontrak Mandor, set harga per item BoQ, lalu buat ulang opname.
          </Text>
        </Card>
      )}

      {activeOpname.status === 'DRAFT' && isEstimator && lines.length > 0 && (
        <Card borderColor={COLORS.info}>
          <Text style={styles.reconTitle}>Estimator dapat koreksi draft sebelum diajukan</Text>
          <Text style={styles.hint}>
            Supervisor mengusulkan progress kumulatif per item. Di draft ini Anda juga bisa menyesuaikan angka
            sebelum opname dikirim ke tahap verifikasi berikutnya.
          </Text>
        </Card>
      )}

      {canImportProgress && (
        <Card borderColor={COLORS.info}>
          <Text style={styles.reconTitle}>Import progress dari Excel</Text>
          <Text style={styles.hint}>
            Upload file dengan kolom `Kode BoQ` atau `Uraian Pekerjaan`, lalu kolom `Progress (%)`.
            Sistem akan mencocokkan item ke daftar opname ini dan mengisi angka secara massal.
          </Text>
          <View style={styles.importActionGroup}>
            <TouchableOpacity
              style={[styles.secondaryBtn, (importingProgress || exportingTemplate) && styles.disabledBtn]}
              onPress={handleDownloadProgressTemplate}
              disabled={importingProgress || exportingTemplate}
            >
              {exportingTemplate
                ? <ActivityIndicator size="small" color={COLORS.info} />
                : <Ionicons name="download-outline" size={18} color={COLORS.info} />}
              <Text style={styles.secondaryBtnText}>Download Template Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, (importingProgress || exportingTemplate) && styles.disabledBtn]}
              onPress={handleImportProgress}
              disabled={importingProgress || exportingTemplate}
            >
              {importingProgress
                ? <ActivityIndicator size="small" color={COLORS.info} />
                : <Ionicons name="cloud-upload-outline" size={18} color={COLORS.info} />}
              <Text style={styles.secondaryBtnText}>Upload Progress Excel</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {/* Line items */}
      {previewLines.map(line => {
        const effectivePct = line.effectivePct;
        const canEdit = activeOpname.status === 'DRAFT' && canDraftEditRole;
        const canVerify = activeOpname.status === 'SUBMITTED' && isEstimator;
        const progressFlag = progressFlags[line.id];
        const previewVariancePct = progressFlag
          ? effectivePct - progressFlag.field_progress_pct
          : null;

        return (
          <Card key={line.id} borderColor={line.is_tdk_acc ? COLORS.critical : COLORS.borderSub}>
            <View style={styles.lineHeader}>
              <Text style={styles.lineDesc}>{line.description}</Text>
              {line.is_tdk_acc && (
                <View style={styles.tdkBadge}>
                  <Text style={styles.tdkText}>TDK ACC</Text>
                </View>
              )}
            </View>
            <Text style={styles.hint}>{line.budget_volume} {line.unit} · Rp {Math.round(line.contracted_rate).toLocaleString('id-ID')}/{line.unit}</Text>

            {progressFlag && (
              <View style={[
                styles.reconBadge,
                progressFlag.variance_flag === 'HIGH' ? styles.reconBadgeHigh : styles.reconBadgeWarn,
              ]}>
                <Ionicons
                  name={progressFlag.variance_flag === 'HIGH' ? 'alert-circle' : 'alert-outline'}
                  size={14}
                  color={progressFlag.variance_flag === 'HIGH' ? COLORS.critical : COLORS.warning}
                />
                <Text style={styles.reconBadgeText}>
                  Gate 4 {progressFlag.field_progress_pct.toFixed(0)}% · Opname {effectivePct.toFixed(0)}%
                  {' '}({(previewVariancePct ?? 0) > 0 ? '+' : ''}{(previewVariancePct ?? 0).toFixed(0)}%)
                </Text>
              </View>
            )}

            {/* Progress bar */}
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(effectivePct, 100)}%` }]} />
              {line.prev_cumulative_pct > 0 && (
                <View style={[styles.progressPrev, { width: `${Math.min(line.prev_cumulative_pct, 100)}%` }]} />
              )}
            </View>

            <View style={styles.pctRow}>
              {/* Supervisor input */}
              {canEdit ? (
                <View style={styles.pctInput}>
                  <Text style={styles.pctLabel}>Progress % (kumulatif)</Text>
                  <TextInput
                    style={styles.pctField}
                    keyboardType="numeric"
                    value={lineInputs[line.id]?.cumulative_pct ?? String(line.cumulative_pct)}
                    onChangeText={text => handleLineInputText(line.id, 'cumulative_pct', text)}
                    onEndEditing={() => handleLineCommit(line, 'cumulative_pct')}
                    accessibilityLabel={`Progress kumulatif untuk ${line.description}`}
                    accessibilityHint="Masukkan persentase progress 0 sampai 100"
                  />
                </View>
              ) : canVerify ? (
                <View style={styles.pctInput}>
                  <Text style={styles.pctLabel}>Verifikasi % (estimator)</Text>
                  <TextInput
                    style={[styles.pctField, { borderColor: COLORS.warning }]}
                    keyboardType="numeric"
                    value={lineInputs[line.id]?.verified_pct ?? String(line.previewVerifiedPct ?? line.previewCumulativePct)}
                    onChangeText={text => handleLineInputText(line.id, 'verified_pct', text)}
                    onEndEditing={() => handleLineCommit(line, 'verified_pct')}
                    accessibilityLabel={`Verifikasi progress untuk ${line.description}`}
                    accessibilityHint="Masukkan persentase verifikasi 0 sampai 100"
                  />
                </View>
              ) : (
                <View>
                  <Text style={styles.pctLabel}>Progress</Text>
                  <Text style={styles.pctDisplay}>{effectivePct.toFixed(0)}%</Text>
                  {line.previewVerifiedPct !== null && line.previewVerifiedPct !== line.previewCumulativePct && (
                    <Text style={[styles.hint, { color: COLORS.warning }]}>
                      Diajukan: {line.previewCumulativePct}% → Diverif: {line.previewVerifiedPct}%
                    </Text>
                  )}
                </View>
              )}

              <View style={styles.amountBox}>
                <Text style={styles.pctLabel}>Minggu ini</Text>
                <Text style={[styles.amountValue, line.is_tdk_acc && { color: COLORS.textMuted, textDecorationLine: 'line-through' }]}>
                  {formatRp(line.thisWeekAmount)}
                </Text>
                <Text style={styles.hint}>{line.thisWeekPct.toFixed(0)}% × vol</Text>
              </View>
            </View>

            {/* TDK ACC toggle for estimator */}
            {canVerify && (
              <>
                <TouchableOpacity
                  style={[styles.tdkBtn, line.is_tdk_acc && styles.tdkBtnActive]}
                  onPress={() => handleTdkAcc(line)}
                >
                  <Ionicons
                    name={line.is_tdk_acc ? 'close-circle' : 'ban-outline'}
                    size={14}
                    color={line.is_tdk_acc ? COLORS.textInverse : COLORS.critical}
                  />
                  <Text style={[styles.tdkBtnText, line.is_tdk_acc && { color: COLORS.textInverse }]}>
                    {line.is_tdk_acc ? 'Batalkan TDK ACC' : 'Tandai TDK ACC'}
                  </Text>
                </TouchableOpacity>
                {tdkAccLineId === line.id && (
                  <View style={{ marginTop: SPACE.sm }}>
                    <TextInput
                      style={styles.input}
                      placeholder="Alasan TDK ACC..."
                      placeholderTextColor={COLORS.textMuted}
                      value={tdkAccReason}
                      onChangeText={setTdkAccReason}
                      autoFocus
                    />
                    <View style={styles.rowBtns}>
                      <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.critical }]} onPress={handleTdkAccSubmit}>
                        <Text style={styles.primaryBtnText}>Tandai</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.ghostBtn} onPress={() => setTdkAccLineId(null)}>
                        <Text style={styles.ghostBtnText}>Batal</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
          </Card>
        );
      })}

      {/* Payment waterfall */}
      <Card>
        <Text style={styles.sectionHead}>Ringkasan Pembayaran</Text>
        <View style={styles.waterfallRow}>
          <Text style={styles.waterfallLabel}>Total Pekerjaan</Text>
          <Text style={styles.waterfallValue}>{formatRp(previewGrossTotal)}</Text>
        </View>
        <View style={styles.waterfallRow}>
          <Text style={styles.waterfallLabel}>Retensi {activeOpname.retention_pct}%</Text>
          <Text style={[styles.waterfallValue, { color: COLORS.warning }]}>-{formatRp(previewRetentionAmount)}</Text>
        </View>
        <View style={styles.waterfallRow}>
          <Text style={styles.waterfallLabel}>Yang Dibayarkan s/d Minggu Ini</Text>
          <Text style={styles.waterfallValue}>{formatRp(previewNetToDate)}</Text>
        </View>
        <View style={styles.waterfallRow}>
          <Text style={styles.waterfallLabel}>Yang Dibayarkan s/d Minggu Lalu</Text>
          <Text style={[styles.waterfallValue, { color: COLORS.textSec }]}>-{formatRp(activeOpname.prior_paid)}</Text>
        </View>

        {/* Kasbon input (admin only, during VERIFIED) */}
        {activeOpname.status === 'VERIFIED' && isAdmin ? (
          <View style={styles.kasbonRow}>
            <Text style={styles.waterfallLabel}>Kasbon</Text>
            <TextInput
              style={styles.kasbonInput}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={COLORS.textMuted}
              value={kasbonInput}
              onChangeText={setKasbonInput}
            />
          </View>
        ) : (
          <View style={styles.waterfallRow}>
            <Text style={styles.waterfallLabel}>Kasbon</Text>
            <Text style={[styles.waterfallValue, { color: COLORS.textSec }]}>-{formatRp(previewKasbon)}</Text>
          </View>
        )}

        {attendanceTotal > 0 && (
          <View style={styles.waterfallRow}>
            <Text style={styles.waterfallLabel}>Kehadiran (HOK) belum terpotong</Text>
            <Text style={[styles.waterfallValue, { color: COLORS.info }]}>{formatRp(attendanceTotal)}</Text>
          </View>
        )}

        <View style={[styles.waterfallRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>SISA BAYAR MINGGU INI</Text>
          <Text style={styles.totalValue}>{formatRp(previewNetThisWeek)}</Text>
        </View>
      </Card>

      {/* Verifier notes */}
      {activeOpname.status === 'SUBMITTED' && isEstimator && (
        <View>
          <Text style={styles.fieldLabel}>Catatan Estimator</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            multiline
            placeholder="Catatan verifikasi (opsional)..."
            placeholderTextColor={COLORS.textMuted}
            value={verifyNotes}
            onChangeText={setVerifyNotes}
          />
        </View>
      )}
      {activeOpname.verifier_notes && activeOpname.status !== 'SUBMITTED' && (
        <Card>
          <Text style={styles.sectionHead}>Catatan Estimator</Text>
          <Text style={styles.hint}>{activeOpname.verifier_notes}</Text>
        </Card>
      )}
    </>
  );
};
