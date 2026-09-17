// workflows/screens/progressClaim/StageClaimForm.tsx
// SANO — the supervisor's stage claim for one work-area row (spec §16). It
// expands under the tapped row (project convention: inline, never a modal)
// and saves one line of the project's claim in progress through
// save_progress_claim_line, which re-checks every rule on the server.
import React, { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import PhotoGalleryField from '../../components/PhotoGalleryField';
import { pickAndUploadPhoto } from '../../../tools/storage';
import { isStaleClaimRefusal } from '../../../tools/progressClaims/claimRules';
import { removeClaimLine, saveClaimLine, type SaveClaimLineResult } from '../../../tools/progressClaims/claims';
import {
  formatFraction, formatPercent, formatQty, pctInputs, readPctInputs, regressedStages, stageKeyLabel, weightSourceLabel,
  type ClaimRowView,
} from '../../../tools/progressClaims/claimView';
import { deltaFromInstalled, rowFraction } from '../../../tools/progressClaims/stageMath';
import { stagesOf, weightOf, type StageWeights } from '../../../tools/progressClaims/stageWeights';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

export const MAX_CLAIM_PHOTOS = 12;
const QUICK_PCT = [0, 25, 50, 75, 100];
const lh = (size: number) => Math.round(size * 1.45);

export type WeightedRowView = ClaimRowView & { weights: StageWeights };

interface Props {
  projectId: string;
  row: WeightedRowView;
  /** False while the claim waits for verification, or for a role that only reads. */
  editable: boolean;
  onSaved: (result: SaveClaimLineResult) => void;
  onRemoved: () => void;
  /** A refusal showed the claim, row or weights on screen are out of date: the panel reloads. */
  onStale?: () => void;
  onClose: () => void;
  toast: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
}

export default function StageClaimForm({ projectId, row, editable, onSaved, onRemoved, onStale, onClose, toast }: Props) {
  const { weights, item } = row;
  // A claim saved before the weights changed shape cannot fill these stages: start from the verified figures.
  const [inputs, setInputs] = useState<Record<string, string>>(() => pctInputs(weights, row.claimNeedsRefill ? row.prevPct : row.claimedPct ?? row.prevPct));
  const [photos, setPhotos] = useState<string[]>(row.photoRefs);
  const [note, setNote] = useState(row.note ?? '');
  const [reason, setReason] = useState(row.regressReason ?? '');
  const [busy, setBusy] = useState(false);

  const read = useMemo(() => readPctInputs(weights, inputs), [weights, inputs]);
  const preview = useMemo(() => {
    if (!read.ok) return null;
    const next = rowFraction(weights, read.pct);
    return {
      next,
      // What verification will write: the difference from what the row's entries already sum to.
      delta: deltaFromInstalled(item.planned, row.installedLedger, next),
      regressed: regressedStages(weights, row.prevPct, read.pct),
    };
  }, [read, weights, item.planned, row.installedLedger, row.prevPct]);
  const quantityDrops = !!preview && preview.delta.deltaQuantity < 0;
  const needsReason = !!preview && (preview.regressed.length > 0 || quantityDrops);

  const setStage = (stage: string, value: string) => setInputs((prev) => ({ ...prev, [stage]: value }));

  const addPhoto = async (replaceIndex?: number) => {
    try {
      const path = await pickAndUploadPhoto(`progress/${projectId}`);
      if (!path) return;
      setPhotos((prev) => (replaceIndex == null
        ? [...prev, path].slice(0, MAX_CLAIM_PHOTOS)
        : prev.map((p, i) => (i === replaceIndex ? path : p))));
    } catch (err) {
      toast((err as Error)?.message ?? 'Foto gagal diunggah.', 'critical');
    }
  };

  const save = async () => {
    if (!read.ok) {
      toast(read.reason, 'critical');
      return;
    }
    if (needsReason && !reason.trim()) {
      toast('Penurunan progres wajib disertai alasan.', 'critical');
      return;
    }
    const rises = !!preview && preview.next > row.prevFraction;
    if (rises && photos.length === 0 && Platform?.OS !== 'web') {
      toast('Tambahkan minimal satu foto sebagai bukti.', 'critical');
      return;
    }
    setBusy(true);
    try {
      const result = await saveClaimLine({
        projectId,
        boqItemId: item.id,
        claimedPct: read.pct,
        note: note.trim() || null,
        photoRefs: photos,
        regressReason: needsReason ? reason.trim() : null,
      });
      toast(`${item.code} disimpan ke klaim.`, 'ok');
      onSaved(result);
    } catch (err) {
      toast((err as Error)?.message ?? 'Gagal menyimpan.', 'critical');
      if (isStaleClaimRefusal((err as { code?: string | null })?.code)) onStale?.();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!row.lineId) return;
    setBusy(true);
    try {
      await removeClaimLine(row.lineId);
      toast(`${item.code} dihapus dari klaim.`, 'warning');
      onRemoved();
    } catch (err) {
      toast((err as Error)?.message ?? 'Gagal menghapus.', 'critical');
      if (isStaleClaimRefusal((err as { code?: string | null })?.code)) onStale?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box} testID={`claim-form-${item.id}`}>
      <Text style={styles.meta}>{weightSourceLabel(row.source, row.referenceClass)}</Text>
      {row.claimNeedsRefill && (
        <Text style={styles.warn}>Bobot baris ini berubah setelah diklaim. Isi ulang persentasenya lalu simpan.</Text>
      )}

      {stagesOf(weights).map((stage) => (
        <View key={stage} style={styles.stage}>
          <View style={styles.stageHead}>
            <Text style={styles.stageName}>
              {stageKeyLabel(stage)}{stage === 'SINGLE' ? '' : ` (bobot ${formatFraction(weightOf(weights, stage))})`}
            </Text>
            <Text style={styles.prev}>Terverifikasi {formatPercent(row.prevPct[stage] ?? 0)}</Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, !editable && styles.inputDisabled]}
              value={inputs[stage] ?? ''}
              onChangeText={(v) => setStage(stage, v)}
              editable={editable}
              keyboardType="decimal-pad"
              placeholder="0-100"
              placeholderTextColor={COLORS.textMuted}
              accessibilityLabel={`Persentase ${stageKeyLabel(stage)}`}
            />
            <Text style={styles.pctSign}>%</Text>
            {editable && QUICK_PCT.map((q) => (
              <TouchableOpacity
                key={q}
                style={styles.chip}
                onPress={() => setStage(stage, String(q))}
                accessibilityRole="button"
                accessibilityLabel={`${stageKeyLabel(stage)} ${q} persen`}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              >
                <Text style={styles.chipText}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {preview ? (
        <Text style={styles.preview}>
          {`Progres baris ${formatFraction(row.prevFraction)} menjadi ${formatFraction(preview.next)} (${preview.delta.deltaQuantity > 0 ? '+' : ''}${formatQty(preview.delta.deltaQuantity, item.unit)})`}
        </Text>
      ) : (
        <Text style={styles.error}>{read.ok ? '' : read.reason}</Text>
      )}
      {row.installedMismatch && (
        <Text style={styles.meta}>
          {`Terpasang di BoQ ${formatQty(item.installed, item.unit)} berbeda dari riwayat progres ${formatQty(row.installedLedger, item.unit)}; verifikasi mengikuti riwayat.`}
        </Text>
      )}

      {needsReason && (
        <>
          <Text style={styles.warn}>
            {preview!.regressed.length > 0
              ? `Turun dari angka terverifikasi: ${preview!.regressed.map((s) => stageKeyLabel(s)).join(', ')}.`
              : 'Volume terpasang turun karena bobot atau volume rencana berubah sejak verifikasi terakhir.'}
          </Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={reason}
            onChangeText={setReason}
            editable={editable}
            multiline
            placeholder="Jelaskan kenapa progres turun"
            placeholderTextColor={COLORS.textMuted}
            accessibilityLabel="Alasan penurunan"
          />
        </>
      )}

      <Text style={styles.label}>Catatan</Text>
      <TextInput
        style={[styles.input, styles.textarea, !editable && styles.inputDisabled]}
        value={note}
        onChangeText={setNote}
        editable={editable}
        multiline
        placeholder="Contoh: kolom K1-K8 zona utara sudah dicor"
        placeholderTextColor={COLORS.textMuted}
        accessibilityLabel="Catatan progres"
      />

      <Text style={styles.label}>Foto bukti</Text>
      {editable ? (
        <PhotoGalleryField
          photoPaths={photos}
          onAdd={() => void addPhoto()}
          onReplace={(index) => void addPhoto(index)}
          onRemove={(index) => setPhotos((prev) => prev.filter((_, i) => i !== index))}
          maxPhotos={MAX_CLAIM_PHOTOS}
          emptyLabel="Tambah Foto Progres"
          helperText="Foto menjadi bukti untuk estimator saat verifikasi."
        />
      ) : (
        <Text style={styles.meta}>{`${photos.length} foto terlampir`}</Text>
      )}

      <View style={styles.btnRow}>
        {editable && (
          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnBusy]}
            onPress={() => void save()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Simpan progres ${item.code}`}
            accessibilityState={{ disabled: busy, busy }}
          >
            <Text style={styles.primaryBtnText}>{busy ? 'Menyimpan...' : 'Simpan'}</Text>
          </TouchableOpacity>
        )}
        {editable && row.lineId && (
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={() => void remove()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Hapus ${item.code} dari klaim`}
          >
            <Text style={styles.ghostBtnText}>Hapus dari klaim</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.ghostBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Tutup form progres">
          <Text style={styles.ghostBtnText}>Tutup</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: SPACE.md, marginBottom: SPACE.sm, borderRadius: RADIUS, borderTopLeftRadius: 0, borderTopRightRadius: 0,
    backgroundColor: COLORS.surfaceSunken, borderWidth: 1, borderColor: COLORS.borderSub,
  },
  meta: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginBottom: SPACE.xs },
  stage: { marginTop: SPACE.sm },
  stageHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: SPACE.xs },
  stageName: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  prev: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  inputRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.xs },
  input: {
    minWidth: 72, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md, fontSize: TYPE.md, lineHeight: lh(TYPE.md),
    fontFamily: FONTS.regular, color: COLORS.text,
  },
  inputDisabled: { backgroundColor: COLORS.surfaceAlt, color: COLORS.textSec },
  textarea: { minHeight: 64, textAlignVertical: 'top', alignSelf: 'stretch', marginTop: SPACE.xs },
  pctSign: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textSec, marginRight: SPACE.xs },
  chip: {
    minWidth: 40, minHeight: 36, paddingHorizontal: SPACE.sm, borderRadius: RADIUS, borderWidth: 1,
    borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center',
  },
  chipText: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.text },
  preview: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.accentDark, marginTop: SPACE.md },
  error: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.critical, marginTop: SPACE.sm },
  warn: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.warning, marginTop: SPACE.sm },
  label: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text, marginTop: SPACE.md },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.md },
  primaryBtn: {
    flexGrow: 1, minHeight: 44, paddingHorizontal: SPACE.base, borderRadius: RADIUS, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnBusy: { opacity: 0.6 },
  primaryBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase' },
  ghostBtn: {
    minHeight: 44, paddingHorizontal: SPACE.base, borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  ghostBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.medium, color: COLORS.textSec, textTransform: 'uppercase' },
});
