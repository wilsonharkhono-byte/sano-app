import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { VoCheckboxState } from '../../../tools/siteEventRules';
import type { SiteEventDraft } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';
import { formStyles as s } from './styles';

interface Props {
  draft: SiteEventDraft | null;
  voState: VoCheckboxState;
  voConfirm: boolean;
  onVoChange: (value: boolean) => void;
  related: { id: string; title: string } | null;
  relatedEventId: string | null;
  onLink: (id: string | null) => void;
  disabled?: boolean;
}

/** The VO checkbox with the literal quotes behind it, and the "Mungkin terkait" link (spec §5.4). */
export default function VoAndRelatedBlock({
  draft, voState, voConfirm, onVoChange, related, relatedEventId, onLink, disabled = false,
}: Props) {
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
            <Text key={quote} style={styles.quote}>Dasar: "{quote}"</Text>
          ))}
          <Text style={s.hint}>Tanpa biaya. Estimator menilai dan memberi harga di Catatan Perubahan.</Text>
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
  relatedBox: {
    marginTop: SPACE.md, padding: SPACE.md, borderRadius: RADIUS,
    borderWidth: 1, borderColor: COLORS.borderSub, backgroundColor: COLORS.surfaceAlt,
  },
});
