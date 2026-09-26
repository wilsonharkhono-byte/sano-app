import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import { getSiteEvent, getSiteEventResult, type SiteEventWithMedia } from '../../tools/siteEvents';
import {
  acknowledgeCloseEntry,
  discardEntryLocally,
  pendingCloseFor,
  supersededCloseFor,
  unreadableCloseFor,
  useCaptureQueueEntries,
} from '../../tools/captureQueueStore';
import { retryQueueEntry } from '../../tools/captureQueueWorker';
import { useProject } from '../hooks/useProject';
import { gateChipLabel, listGateRefs, listGateStepRefs, stepChipLabel } from '../../tools/gateRefs';
import { todayIsoLocal } from '../../tools/siteEventRules';
import { SITE_EVENT_STATUS_LABELS, SITE_EVENT_TYPE_LABELS } from '../../tools/constants';
import type { GateRef, GateStepRef } from '../../tools/types';
import { COLORS, SPACE } from '../theme';
import { formStyles as s } from './siteEvent/styles';
import MediaStrip from './siteEvent/MediaStrip';
import ClosureForm from './siteEvent/ClosureForm';
import { detailActions, isOverdue, voStatusText } from './siteEvent/detailModel';
import {
  REASON_CLOSE_STATUS_UNREADABLE,
  attentionRows,
  closeJobCancelKind,
  supersededReason,
} from './siteEvent/captureQueueModel';

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
 * What the server already did, said wherever a close job on this phone would
 * otherwise imply the event is still open. An open event only ever becomes
 * 'done' on the server (097: only a draft can be discarded).
 */
const CLOSED_ON_SERVER = 'Kejadian ini sudah ditutup di server.';

/** The clause of the card's Batalkan confirmation (attentionRows) that only holds while the server has the event open. */
const CARD_STAYS_OPEN = 'Kejadian tetap terbuka.';

/** Shown for a related event when the row is missing or unreadable (RLS), so the id isn't just a raw UUID. */
function shortId(id: string): string {
  return id.slice(0, 8);
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
  const { profile } = useProject();
  const queue = useCaptureQueueEntries(profile?.id ?? null);

  const [event, setEvent] = useState<SiteEventWithMedia | null>(null);
  const [gates, setGates] = useState<GateRef[]>([]);
  const [steps, setSteps] = useState<GateStepRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  /** null = no related event, or its row is missing/unreadable (guarded below to id-only, no link). */
  const [related, setRelated] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [evResult, gateRows, stepRows] = await Promise.all([
      getSiteEventResult(params.eventId ?? ''),
      listGateRefs(),
      listGateStepRefs(),
    ]);
    // A network failure is not "kejadian tidak ditemukan" (CLAUDE.md §12) —
    // keep the not-found copy for a genuine 404 and show a distinct retry
    // state for a dropped connection.
    setLoadError(evResult.error ?? null);
    const ev = evResult.event;
    setEvent(ev);
    setGates(gateRows);
    setSteps(stepRows);
    setLoading(false);
    if (ev?.related_event_id) {
      const rel = await getSiteEvent(ev.related_event_id);
      setRelated(rel ? { id: rel.id, title: rel.title ?? (rel.ai_draft ? `Draf AI: ${rel.ai_draft.title}` : shortId(rel.id)) } : null);
    } else {
      setRelated(null);
    }
  }, [params.eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Closure spec §4.5: a close job on this phone keeps the server's status on
  // screen and adds "Menunggu kirim". The moment the job leaves the pending
  // set (closed, superseded, or cancelled), read the server again rather than
  // guess what happened there.
  const pendingClose = event ? pendingCloseFor(queue, event.id) : undefined;
  const hadPendingClose = useRef(false);
  useEffect(() => {
    const pending = pendingClose !== undefined;
    if (hadPendingClose.current && !pending) void load();
    hadPendingClose.current = pending;
  }, [pendingClose, load]);
  const [retrying, setRetrying] = useState(false);
  const retryClose = async () => {
    if (!profile || !pendingClose) return;
    setRetrying(true);
    try {
      await retryQueueEntry(profile.id, pendingClose.id);
    } finally {
      setRetrying(false);
    }
  };

  // "Batalkan" (closure spec §4.6), by the Beranda card's own rule
  // (closeJobCancelKind) and in its words (attentionRows' confirm): a close the
  // server refused, or whose photo vanished before upload, while no outcome is
  // recorded. Office and principal phones have no queue card, Selesai stays
  // hidden while the job is pending, and a second close is refused
  // (CLOSE_ALREADY_PENDING), so without it here such a job would sit on this
  // screen for good. The job leaves the phone; the event and every photo
  // already uploaded stay on the server as they are.
  // The card cannot see the server and says "Kejadian tetap terbuka."; this
  // screen can, and once the server has closed the event it says that
  // instead. Everything else stays the card's, including whether the photo is
  // promised (only once its media row is in).
  const cardConfirm =
    pendingClose && closeJobCancelKind(pendingClose) === 'cancel' ? attentionRows([pendingClose])[0]?.confirm ?? null : null;
  const cancelConfirm =
    cardConfirm && event?.status !== 'open' ? cardConfirm.replace(CARD_STAYS_OPEN, CLOSED_ON_SERVER) : cardConfirm;
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancelClose = async (jobId: string) => {
    if (!profile) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const result = await discardEntryLocally(profile.id, jobId);
      if (result.error) {
        setCancelError(result.error);
        return;
      }
    } catch (err) {
      setCancelError((err as Error).message);
      return;
    } finally {
      setCancelling(false);
    }
    void load();
  };
  const confirmCancelClose = () => {
    if (!pendingClose || !cancelConfirm) return;
    const jobId = pendingClose.id;
    if (Platform?.OS === 'web') {
      if (window.confirm(cancelConfirm)) void cancelClose(jobId);
    } else {
      Alert.alert('Batalkan penutupan', cancelConfirm, [
        { text: 'Tidak', style: 'cancel' },
        { text: 'Batalkan', style: 'destructive', onPress: () => void cancelClose(jobId) },
      ]);
    }
  };

  // This phone's queued "Selesai" the server already answered for good
  // (closeJobCancelKind's 'acknowledge'): superseded - the event was already
  // closed, and the lookup read who and when - or no longer open with a status
  // that could not be read (unreadableCloseFor), where nothing about who
  // closed it was read, so only REASON_CLOSE_STATUS_UNREADABLE is said, never
  // a "Sudah ditutup oleh ..." sentence. Office and principal phones have no
  // Beranda queue card, and this screen is shared by every navigator, so
  // "Mengerti" lives here too: it removes the job, then the screen reads the
  // server again. A superseded job goes first when both exist for the event,
  // since it carries what the server said; the unreadable one follows once
  // that is acknowledged, so neither is hidden for good.
  const supersededClose = event && !pendingClose ? supersededCloseFor(queue, event.id) : null;
  const unreadableClose = event && !pendingClose && !supersededClose ? unreadableCloseFor(queue, event.id) : null;
  const acknowledgeJob = supersededClose ?? unreadableClose;
  const [acknowledging, setAcknowledging] = useState(false);
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null);
  const acknowledgeClose = async () => {
    if (!profile || !acknowledgeJob) return;
    setAcknowledging(true);
    setAcknowledgeError(null);
    try {
      const result = await acknowledgeCloseEntry(profile.id, acknowledgeJob.id);
      if (result.error) {
        setAcknowledgeError(result.error);
        return;
      }
    } catch (err) {
      setAcknowledgeError((err as Error).message);
      return;
    } finally {
      setAcknowledging(false);
    }
    void load();
  };

  const routeNames: string[] = navigation.getState?.()?.routeNames ?? [];
  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate(routeNames.includes('Beranda') ? 'Beranda' : 'Home');
  };

  const today = todayIsoLocal();
  const gate = event?.gate_code ? gates.find((g) => g.code === event.gate_code) : undefined;
  const step = event?.step_code ? steps.find((st) => st.code === event.step_code) : undefined;
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

        {!loading && !event && loadError ? (
          <Card borderColor={COLORS.critical}>
            <Text style={s.errorText}>Gagal memuat. Periksa koneksi lalu coba lagi.</Text>
            <TouchableOpacity style={s.secondaryBtn} onPress={() => void load()} accessibilityRole="button">
              <Text style={s.secondaryText}>Coba lagi</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {!loading && !event && !loadError ? (
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
                {/* Only while the server still has it open: after that the close is not "needed", only checked. */}
                {pendingClose && event.status === 'open' ? (
                  <View style={[s.chip, { borderColor: COLORS.info, backgroundColor: COLORS.infoBg }]}>
                    <Text style={[s.chipText, { color: COLORS.info }]}>Menunggu kirim</Text>
                  </View>
                ) : null}
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
                {step ? (
                  <View style={s.chip}>
                    <Text style={s.chipText}>{stepChipLabel(step, gate)}</Text>
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
              {event.related_event_id ? (
                <TouchableOpacity
                  style={s.row}
                  onPress={
                    related
                      ? () => navigation.navigate('SiteEventDetail', { eventId: related.id, projectId: event.project_id })
                      : undefined
                  }
                  disabled={!related}
                  accessibilityRole="button"
                >
                  <Text style={s.rowLabel}>Kejadian terkait</Text>
                  <Text style={[s.rowValue, related ? { color: COLORS.primary } : null]}>
                    {related ? related.title : shortId(event.related_event_id)}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </Card>

            <Card title="Bukti">
              <MediaStrip media={event.media.filter((m) => m.role !== 'closure')} />
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
                <Row
                  label={event.closed_by_name ? 'Ditutup oleh' : 'Ditutup'}
                  value={
                    event.closed_at
                      ? event.closed_by_name
                        ? `${event.closed_by_name} · ${formatDateTime(event.closed_at)}`
                        : formatDateTime(event.closed_at)
                      : '—'
                  }
                />
                {event.closure_note ? <Text style={s.bannerText}>{event.closure_note}</Text> : null}
                {/* The database proved a closure photo exists; a person judges what it shows (spec §1.1 rule 6). */}
                <Text style={[s.label, { marginTop: SPACE.sm }]}>Foto penutupan</Text>
                <MediaStrip media={event.media.filter((m) => m.role === 'closure')} />
              </Card>
            ) : null}

            {pendingClose ? (
              <Card title="Penutupan" borderColor={pendingClose.needsAttention ? COLORS.critical : COLORS.info}>
                {pendingClose.needsAttention ? (
                  <>
                    <Text style={s.errorText}>
                      Penutupan belum terkirim: {pendingClose.lastError ?? 'gagal setelah beberapa kali percobaan.'}
                    </Text>
                    {cancelError ? <Text style={s.errorText}>{cancelError}</Text> : null}
                    {/* retryEntry leaves an unrecoverable job exactly as it is: nothing to retry. */}
                    {!pendingClose.unrecoverable ? (
                      <TouchableOpacity
                        style={s.secondaryBtn}
                        onPress={() => void retryClose()}
                        disabled={retrying}
                        accessibilityRole="button"
                      >
                        <Text style={s.secondaryText}>{retrying ? 'Mencoba…' : 'Coba lagi'}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {cancelConfirm ? (
                      <TouchableOpacity
                        style={s.dangerBtn}
                        onPress={confirmCancelClose}
                        disabled={cancelling}
                        accessibilityRole="button"
                      >
                        <Text style={s.dangerText}>Batalkan</Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                ) : event.status === 'open' ? (
                  <Text style={s.bannerText}>
                    Penutupan tersimpan di ponsel ini dan menunggu kirim. Status tetap Terbuka sampai server menerimanya.
                  </Text>
                ) : (
                  <Text style={s.bannerText}>
                    {CLOSED_ON_SERVER} Penutupan yang tersimpan di ponsel ini akan dicek saat terkirim.
                  </Text>
                )}
              </Card>
            ) : acknowledgeJob ? (
              <Card title="Penutupan" borderColor={COLORS.info}>
                {/* The Beranda card's own sentences: the server's closer, never the queue owner (spec §4.6);
                    for a status that could not be read, only that the event is no longer open. */}
                <Text style={s.bannerText}>
                  {supersededClose ? supersededReason(supersededClose) : REASON_CLOSE_STATUS_UNREADABLE}
                </Text>
                {acknowledgeError ? <Text style={s.errorText}>{acknowledgeError}</Text> : null}
                <TouchableOpacity
                  style={s.secondaryBtn}
                  onPress={() => void acknowledgeClose()}
                  disabled={acknowledging}
                  accessibilityRole="button"
                >
                  <Text style={s.secondaryText}>Mengerti</Text>
                </TouchableOpacity>
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

            {/* The same profile condition as the form below: a Selesai that opens nothing is not offered. */}
            {actions.canClose && !pendingClose && !closing && profile ? (
              <TouchableOpacity style={s.primaryBtn} onPress={() => setClosing(true)} accessibilityRole="button">
                <Text style={s.primaryText}>Selesai</Text>
              </TouchableOpacity>
            ) : null}

            {actions.canClose && !pendingClose && closing && profile ? (
              <Card title="Tandai selesai">
                <ClosureForm
                  userId={profile.id}
                  eventId={event.id}
                  projectId={event.project_id}
                  roomId={event.room_id}
                  eventTitle={event.title ?? 'Kejadian lapangan'}
                  eventType={event.event_type}
                  onQueued={() => setClosing(false)}
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
