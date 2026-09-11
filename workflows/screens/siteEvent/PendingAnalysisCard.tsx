import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import Card from '../../components/Card';
import { AI_QUOTA_MESSAGE, canOfferManualAuthoring } from '../../../tools/siteEventRules';
import { SITE_EVENT_MANUAL_AFTER_ATTEMPTS } from '../../../tools/constants';
import type { SiteEventWithMedia } from '../../../tools/siteEvents';
import { COLORS } from '../../theme';
import { formStyles as s } from './styles';

interface Props {
  event: SiteEventWithMedia;
  busy: boolean;
  onReload: () => void;
  onReanalyze: () => void;
  onManual: () => void;
}

/** Spec §12: the supervisor is never stuck behind a model. */
export default function PendingAnalysisCard({ event, busy, onReload, onReanalyze, onManual }: Props) {
  const quotaSpent = event.last_error === AI_QUOTA_MESSAGE;
  return (
    <Card title="Menunggu analisis AI" borderColor={event.last_error ? COLORS.warning : COLORS.info}>
      <Text style={s.bannerText}>
        {event.last_error ?? 'Foto dan suara sedang dianalisis. Biasanya kurang dari satu menit.'}
      </Text>
      {event.analysis_attempts > 0 ? (
        <Text style={s.hint}>
          Percobaan gagal: {event.analysis_attempts}. Isi manual tersedia setelah {SITE_EVENT_MANUAL_AFTER_ATTEMPTS} kali.
        </Text>
      ) : null}
      <TouchableOpacity style={s.secondaryBtn} onPress={onReload} disabled={busy} accessibilityRole="button">
        <Text style={s.secondaryText}>Muat ulang</Text>
      </TouchableOpacity>
      {!quotaSpent ? (
        <TouchableOpacity style={s.secondaryBtn} onPress={onReanalyze} disabled={busy} accessibilityRole="button">
          <Text style={s.secondaryText}>{busy ? 'Menganalisis…' : 'Analisis ulang'}</Text>
        </TouchableOpacity>
      ) : null}
      {canOfferManualAuthoring(event) ? (
        <TouchableOpacity style={s.primaryBtn} onPress={onManual} disabled={busy} accessibilityRole="button">
          <Text style={s.primaryText}>Isi manual</Text>
        </TouchableOpacity>
      ) : null}
    </Card>
  );
}
