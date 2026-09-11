import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import { getSiteEvent, type SiteEventWithMedia } from '../../tools/siteEvents';
import { gateChipLabel, listGateRefs } from '../../tools/gateRefs';
import { todayIsoLocal } from '../../tools/siteEventRules';
import { SITE_EVENT_STATUS_LABELS, SITE_EVENT_TYPE_LABELS } from '../../tools/constants';
import type { GateRef } from '../../tools/types';
import { COLORS, SPACE } from '../theme';
import { formStyles as s } from './siteEvent/styles';
import MediaStrip from './siteEvent/MediaStrip';
import ClosureForm from './siteEvent/ClosureForm';
import { detailActions, isOverdue, voStatusText } from './siteEvent/detailModel';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * One site event: read view, "Selesai", and the SITE_EVENT_ASSIGNED deeplink
 * target. Registered under this name in the supervisor, office and principal
 * navigators. It reads by eventId through RLS, so it works whichever project
 * the header has selected, and shows an AI-proposed title only labelled as such.
 */
export default function SiteEventDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const params = (route.params ?? {}) as { eventId?: string; projectId?: string };

  const [event, setEvent] = useState<SiteEventWithMedia | null>(null);
  const [gates, setGates] = useState<GateRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [ev, gateRows] = await Promise.all([getSiteEvent(params.eventId ?? ''), listGateRefs()]);
    setEvent(ev);
    setGates(gateRows);
    setLoading(false);
  }, [params.eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const routeNames: string[] = navigation.getState?.()?.routeNames ?? [];
  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate(routeNames.includes('Beranda') ? 'Beranda' : 'Home');
  };

  const today = todayIsoLocal();
  const gate = event?.gate_code ? gates.find((g) => g.code === event.gate_code) : undefined;
  const actions = event ? detailActions(event, routeNames) : { canClose: false, canOpenConfirm: false };
  const vo = event ? voStatusText(event) : null;
  const transcript = event ? event.transcript_edited ?? event.transcript : null;
  const overdue = event ? isOverdue(event, today) : false;
  const heading = event
    ? event.title ?? (event.ai_draft ? `Draf AI: ${event.ai_draft.title}` : 'Belum dikonfirmasi')
    : '';

  return (
    <View style={s.flex}>
      <Header />
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <TouchableOpacity style={s.backBtn} onPress={goBack} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          <Text style={s.backText}>Kembali</Text>
        </TouchableOpacity>

        {loading ? (
          <Card>
            <Text style={s.empty}>Memuat kejadian…</Text>
          </Card>
        ) : null}

        {!loading && !event ? (
          <Card borderColor={COLORS.critical}>
            <Text style={s.errorText}>Kejadian tidak ditemukan atau Anda tidak punya akses.</Text>
          </Card>
        ) : null}

        {!loading && event ? (
          <>
            <Card borderColor={overdue ? COLORS.critical : event.status === 'open' ? COLORS.warning : COLORS.ok}>
              <Text style={s.title}>{heading}</Text>
              <Text style={s.meta}>
                {event.room_name ?? 'Ruangan'} · {event.room_floor || 'Tanpa lantai'}
              </Text>
              <View style={[s.chipRow, { marginTop: SPACE.sm }]}>
                <View style={s.chip}>
                  <Text style={s.chipText}>{SITE_EVENT_STATUS_LABELS[event.status]}</Text>
                </View>
                {event.event_type ? (
                  <View style={s.chip}>
                    <Text style={s.chipText}>{SITE_EVENT_TYPE_LABELS[event.event_type]}</Text>
                  </View>
                ) : null}
                {gate ? (
                  <View style={s.chip}>
                    <Text style={s.chipText}>{gateChipLabel(gate)}</Text>
                  </View>
                ) : null}
                {event.is_blocking ? (
                  <View style={s.chip}>
                    <Text style={s.chipText}>Menghambat</Text>
                  </View>
                ) : null}
              </View>
              {event.summary ? <Text style={[s.bannerText, { marginTop: SPACE.sm }]}>{event.summary}</Text> : null}
            </Card>

            <Card title="Tanggung jawab">
              <Row label="Pemilik" value={event.owner_name ?? '—'} />
              <Row label="Tenggat" value={event.due_date ? `${event.due_date}${overdue ? ' · terlambat' : ''}` : '—'} />
              <Row label="Dampak lanjutan" value={event.downstream_impact ?? '—'} />
              <Row label="Dilaporkan" value={`${event.reporter_name ?? '—'} · ${formatDateTime(event.captured_at)}`} />
              {event.confirmed_at ? <Row label="Dikonfirmasi" value={formatDateTime(event.confirmed_at)} /> : null}
              {event.confirmed_at && !event.ai_used ? <Row label="Sumber" value="Diisi manual" /> : null}
              {vo ? <Text style={s.hint}>{vo}</Text> : null}
            </Card>

            <Card title="Bukti">
              <MediaStrip media={event.media} />
              {event.raw_text ? <Text style={s.hint}>Catatan: {event.raw_text}</Text> : null}
              {transcript ? (
                <>
                  <TouchableOpacity
                    style={s.checkRow}
                    onPress={() => setShowTranscript((v) => !v)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showTranscript }}
                  >
                    <Ionicons name={showTranscript ? 'chevron-down' : 'chevron-forward'} size={16} color={COLORS.text} />
                    <Text style={s.checkText}>Transkrip</Text>
                  </TouchableOpacity>
                  {showTranscript ? <Text style={s.bannerText}>{transcript}</Text> : null}
                </>
              ) : null}
            </Card>

            {event.status === 'done' ? (
              <Card title="Selesai" borderColor={COLORS.ok}>
                <Row label="Ditutup" value={event.closed_at ? formatDateTime(event.closed_at) : '—'} />
                {event.closure_note ? <Text style={s.bannerText}>{event.closure_note}</Text> : null}
              </Card>
            ) : null}

            {actions.canOpenConfirm ? (
              <TouchableOpacity
                style={s.primaryBtn}
                onPress={() => navigation.navigate('SiteEventConfirm', { eventId: event.id })}
                accessibilityRole="button"
              >
                <Text style={s.primaryText}>Buka konfirmasi</Text>
              </TouchableOpacity>
            ) : null}

            {actions.canClose && !closing ? (
              <TouchableOpacity style={s.primaryBtn} onPress={() => setClosing(true)} accessibilityRole="button">
                <Text style={s.primaryText}>Selesai</Text>
              </TouchableOpacity>
            ) : null}

            {actions.canClose && closing ? (
              <Card title="Tandai selesai">
                <ClosureForm
                  eventId={event.id}
                  projectId={event.project_id}
                  onClosed={() => {
                    setClosing(false);
                    void load();
                  }}
                  onCancel={() => setClosing(false)}
                />
              </Card>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
