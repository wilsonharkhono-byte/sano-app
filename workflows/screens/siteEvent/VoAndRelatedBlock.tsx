import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mapVoChangeType, type VoCheckboxState } from '../../../tools/siteEventRules';
import { CHANGE_TYPE_LABELS } from '../../../tools/siteChanges';
import type { SiteEventDraft, SiteEventType } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';
import { formStyles as s } from './styles';

interface Props {
  draft: SiteEventDraft | null;
  voState: VoCheckboxState;
  voConfirm: boolean;
  onVoChange: (value: boolean) => void;
  /** The HUMAN-confirmed type, which is what the RPC maps change_type from. */
  eventType: SiteEventType | null;
  /**
   * Quotes that are no longer literal substrings of the edited transcript
   * (confirmModel's staleVoQuotes). Each one is labelled so the supervisor can
   * see WHICH basis their edit removed, not just that something broke.
   */
  staleQuotes?: ReadonlyArray<string>;
  /**
   * Set only when some, but not all, quotes survived the edit (confirmModel's
   * `VO_PARTIAL_EVIDENCE_NOTE`): Konfirmasi is not blocked, but
   * confirm_site_event (100) records the survivors only, so the stale labels
   * above should not be read as still reaching Catatan Perubahan.
   */
  partialEvidenceNote?: string | null;
  related: { id: string; title: string } | null;
  relatedEventId: string | null;
  onLink: (id: string | null) => void;
  disabled?: boolean;
}

/** The VO checkbox with the literal quotes behind it, and the "Mungkin terkait" link (spec §5.4). */
export default function VoAndRelatedBlock({
  draft, voState, voConfirm, onVoChange, eventType, staleQuotes = [], partialEvidenceNote = null, related,
  relatedEventId, onLink, disabled = false,
}: Props) {
  const stale = new Set(staleQuotes);
  const quoteLine = (quote: string) =>
    stale.has(quote) ? `Dasar (tidak cocok lagi): "${quote}"` : `Dasar: "${quote}"`;

  // Low confidence hides the checkbox (spec §1.1), but the model's suggestion
  // is still recorded, and confirm_site_event will still write vo_flag
  // 'rejected' for it. Rendering nothing meant a real VO signal vanished from
  // the only screen a supervisor sees — so show it, read-only, and say why it
  // cannot be confirmed here.
  const suggestedButHidden =
    voState === 'hidden' && !!draft && draft.vo.flag === 'suggested' && draft.vo.evidence_quotes.length > 0;

  return (
    <View>
      {voState !== 'hidden' && draft ? (
        <View>
          <Text style={s.label}>Perubahan pekerjaan (VO)</Text>
          <TouchableOpacity
            style={s.checkRow}
            onPress={() => onVoChange(!voConfirm)}
            disabled={disabled}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: voConfirm, disabled }}
          >
            <Ionicons name={voConfirm ? 'checkbox' : 'square-outline'} size={22} color={voConfirm ? COLORS.primary : COLORS.textSec} />
            <Text style={s.checkText}>Buat Catatan Perubahan untuk estimator</Text>
          </TouchableOpacity>
          {draft.vo.reason ? <Text style={s.hint}>Alasan AI: {draft.vo.reason}</Text> : null}
          {draft.vo.evidence_quotes.map((quote) => (
            <Text key={quote} style={[styles.quote, stale.has(quote) && styles.quoteStale]}>
              {quoteLine(quote)}
            </Text>
          ))}
          {partialEvidenceNote ? <Text style={s.hint}>{partialEvidenceNote}</Text> : null}
          {/* The category the RPC will file this under, computed here from the
              same keyword lists 097 mirrors — so the supervisor sees the
              consequence before tapping, not afterwards in Catatan Perubahan. */}
          {voConfirm && eventType ? (
            <Text style={s.hint}>Akan dicatat sebagai: {CHANGE_TYPE_LABELS[mapVoChangeType(eventType, draft)]}.</Text>
          ) : null}
          <Text style={s.hint}>Tanpa biaya. Estimator menilai dan memberi harga di Catatan Perubahan.</Text>
        </View>
      ) : null}

      {suggestedButHidden && draft ? (
        <View>
          <Text style={s.label}>Perubahan pekerjaan (VO)</Text>
          <Text style={s.hint}>
            Saran VO dari AI — tidak bisa dikonfirmasi karena AI kurang yakin. Laporkan ke estimator bila memang
            perubahan pekerjaan.
          </Text>
          {draft.vo.reason ? <Text style={s.hint}>Alasan AI: {draft.vo.reason}</Text> : null}
          {draft.vo.evidence_quotes.map((quote) => (
            <Text key={quote} style={[styles.quote, stale.has(quote) && styles.quoteStale]}>
              {quoteLine(quote)}
            </Text>
          ))}
        </View>
      ) : null}

      {related ? (
        <View style={styles.relatedBox}>
          <Text style={s.checkText}>Mungkin terkait: {related.title}</Text>
          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={() => onLink(relatedEventId === related.id ? null : related.id)}
            disabled={disabled}
            accessibilityRole="button"
          >
            <Text style={s.secondaryText}>{relatedEventId === related.id ? 'Lepas tautan' : 'Tautkan'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  quote: {
    fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, fontStyle: 'italic',
    marginTop: SPACE.xs, paddingLeft: SPACE.sm, borderLeftWidth: 2, borderLeftColor: COLORS.accent,
  },
  quoteStale: { color: COLORS.critical, borderLeftColor: COLORS.critical },
  relatedBox: {
    marginTop: SPACE.md, padding: SPACE.md, borderRadius: RADIUS,
    borderWidth: 1, borderColor: COLORS.borderSub, backgroundColor: COLORS.surfaceAlt,
  },
});
