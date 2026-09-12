import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, Switch, Alert, Platform } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { listGateRefs, listGateStepRefs } from '../../tools/gateRefs';
import { getProjectTeam, type TeamMember } from '../../tools/projectManagement';
import {
  confirmSiteEvent,
  discardSiteEvent,
  getSiteEvent,
  invokeSiteEventAnalysis,
  listOpenEventsForRoom,
  saveTranscriptEdit,
  workGroupHints,
  type OpenEventSummary,
  type SiteEventWithMedia,
} from '../../tools/siteEvents';
import { isActionableType, todayIsoLocal, type ConfidenceUi } from '../../tools/siteEventRules';
import { DRAFT_IMPACT_MAX, DRAFT_SUMMARY_MAX, DRAFT_TITLE_MAX } from '../../tools/siteEventDraftValidate';
import type { GateRef, GateStepRef } from '../../tools/types';
import { COLORS } from '../theme';
import { formStyles as s } from './siteEvent/styles';
import EventTypeChipRow from './siteEvent/EventTypeChipRow';
import { GateChipRow, StepChipRow } from './siteEvent/GateChipRow';
import DueDateField from './siteEvent/DueDateField';
import OwnerField from './siteEvent/OwnerField';
import TranscriptEditor from './siteEvent/TranscriptEditor';
import MediaStrip from './siteEvent/MediaStrip';
import PendingAnalysisCard from './siteEvent/PendingAnalysisCard';
import VoAndRelatedBlock from './siteEvent/VoAndRelatedBlock';
import {
  clearFieldErrors,
  initialConfirmForm,
  relatedSuggestion,
  staleVoQuotes,
  toConfirmInput,
  withEventType,
  withGate,
  withTranscript,
  VO_STALE_EVIDENCE_MESSAGE,
  type ConfirmForm,
} from './siteEvent/confirmModel';

/** How often a still-analysing draft re-checks itself, so nobody has to tap "Muat ulang". */
const PENDING_POLL_MS = 10_000;

/** A manual confirm cannot proceed once the model's draft has landed (see onConfirm). */
const DRAFT_ARRIVED_MESSAGE = 'Draf AI baru saja tiba. Muat ulang untuk melihatnya.';

/**
 * The only writer of human-facing fields (spec §1.1 rule 2, §5.4). Everything
 * the AI proposed is visible and editable; nothing reaches the database until
 * "Konfirmasi", and confirm_site_event re-checks every rule this screen checks
 * — with ONE exception, the stale-VO-evidence rule below, which exists only
 * here.
 */
export default function SiteEventConfirmScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { project: activeProject, boqItems } = useProject();
  const { show: toast } = useToast();
  const eventId = ((route.params ?? {}) as { eventId?: string }).eventId ?? '';
  // WIB (Asia/Jakarta), not the phone's own calendar day: todayIsoLocal now
  // delegates to timeWindow's todayIsoWIB, so this screen and
  // confirm_site_event's `(now() AT TIME ZONE 'Asia/Jakarta')::date` agree on
  // which day "today" is for every device timezone.
  const today = todayIsoLocal();

  const [event, setEvent] = useState<SiteEventWithMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [gates, setGates] = useState<GateRef[]>([]);
  const [steps, setSteps] = useState<GateStepRef[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [openEvents, setOpenEvents] = useState<OpenEventSummary[]>([]);
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState<ConfirmForm | null>(null);
  const [ui, setUi] = useState<ConfidenceUi | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Every await on this screen can outlive the screen — a supervisor taps back
  // while a confirm or a signed-URL fetch is in flight. Guard each setState
  // that follows an await, or React warns and, worse, a stale response can
  // repaint a screen that is gone.
  const alive = useRef(true);
  // Double-tap guards. `busy` disables the buttons, but it is state: two taps
  // inside one render commit both see the old value, and a second
  // confirm_site_event call would be a second Catatan Perubahan.
  const confirming = useRef(false);
  const reanalyzing = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * `silent` is the polling path: no "Memuat draf…" flash, and a transient
   * null (a dropped connection mid-poll) leaves the event on screen instead of
   * replacing it with "tidak ditemukan".
   */
  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      const ev = await getSiteEvent(eventId);
      if (!alive.current) return;
      if (!ev && opts.silent) return;
      setEvent(ev);
      if (ev) {
        const [gateRows, stepRows, members, open] = await Promise.all([
          listGateRefs({ activeOnly: true }),
          listGateStepRefs({ activeOnly: true }),
          getProjectTeam(ev.project_id),
          listOpenEventsForRoom(ev.room_id, 10),
        ]);
        if (!alive.current) return;
        setGates(gateRows);
        setSteps(stepRows);
        setTeam(members);
        setOpenEvents(open.filter((o) => o.id !== ev.id));
        const initial = initialConfirmForm(ev, todayIsoLocal(), false);
        setForm(initial.form);
        setUi(initial.ui);
        setManual(false);
        setErrors([]);
      }
      if (!opts.silent) setLoading(false);
    },
    [eventId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Spec §5.3: the draft arrives on its own, so the screen should notice on its
  // own. Not while authoring by hand (a reload would throw the supervisor's
  // typed fields away) and not mid-request.
  const pending = event?.status === 'pending_analysis';
  useEffect(() => {
    if (!pending || manual || busy) return;
    const timer = setInterval(() => {
      void load({ silent: true });
    }, PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [pending, manual, busy, load]);

  const update = (patch: Partial<ConfirmForm>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setErrors((prev) => clearFieldErrors(prev, Object.keys(patch) as Array<keyof ConfirmForm>));
  };

  const startManual = () => {
    if (!event) return;
    const initial = initialConfirmForm(event, today, true);
    setForm(initial.form);
    setUi(initial.ui);
    setManual(true);
    setErrors([]);
  };

  const reanalyze = async () => {
    if (!event || reanalyzing.current) return;
    reanalyzing.current = true;
    setBusy(true);
    try {
      if (form?.transcriptDirty) {
        const saved = await saveTranscriptEdit(event.id, form.transcript);
        if (!alive.current) return;
        if (saved.error) {
          toast(saved.error, 'critical');
          return;
        }
      }
      const hints = activeProject?.id === event.project_id ? workGroupHints(boqItems) : [];
      const result = await invokeSiteEventAnalysis(event.id, { force: true, workGroupNames: hints });
      if (!alive.current) return;
      // Only reload on success. Reloading after a failure re-read the SAME
      // stored draft and rebuilt the form from it, silently discarding the
      // supervisor's edits — including the transcript correction they had just
      // asked to be analysed.
      if (!result.ok) {
        if (result.error) toast(result.error, 'warning');
        return;
      }
      await load();
    } finally {
      reanalyzing.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const onConfirm = async () => {
    if (!event || !form || confirming.current) return;
    confirming.current = true;
    setBusy(true);
    try {
      // A manual confirm sends draft: null and ai_used: false. If the model's
      // draft landed while the supervisor was typing, confirming "manually"
      // would record that no AI was used AND let the RPC write
      // vo_flag = 'rejected' for a VO suggestion they were never shown.
      if (manual) {
        const fresh = await getSiteEvent(event.id);
        if (!alive.current) return;
        if (fresh?.ai_draft) {
          await load();
          if (!alive.current) return;
          setErrors([DRAFT_ARRIVED_MESSAGE]);
          toast(DRAFT_ARRIVED_MESSAGE, 'warning');
          return;
        }
      }

      const r = await confirmSiteEvent(event.id, toConfirmInput(form, event, today, manual, steps));
      if (!alive.current) return;
      if (r.errors || r.error) {
        setErrors(r.errors ?? [r.error as string]);
        return;
      }
      setErrors([]);
      const voNote = r.result?.vo_flag === 'confirmed' ? ' Catatan Perubahan dibuat untuk estimator.' : '';
      const ownerNote =
        form.ownerId && form.ownerId !== event.reporter_id
          ? r.result?.notified ? ' Pemilik sudah diberi tahu.' : ' Pemilik belum bisa diberi tahu.'
          : '';
      toast(`Kejadian dikonfirmasi.${voNote}${ownerNote}`, 'ok');
      navigation.navigate('SiteEventDetail', { eventId: event.id, projectId: event.project_id });
    } finally {
      confirming.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const askDiscard = () => {
    const run = async () => {
      if (!event) return;
      setBusy(true);
      const r = await discardSiteEvent(event.id);
      if (!alive.current) return;
      setBusy(false);
      if (r.error) {
        toast(r.error, 'critical');
        return;
      }
      toast('Draf dibuang. Foto dan suara tetap tersimpan.', 'ok');
      navigation.navigate('Beranda');
    };
    const message = 'Buang draf ini? Foto dan suara tetap disimpan, tetapi kejadian tidak dilanjutkan.';
    if (Platform.OS === 'web') {
      if (window.confirm(message)) void run();
    } else {
      Alert.alert('Buang draf', message, [
        { text: 'Batal', style: 'cancel' },
        { text: 'Buang', style: 'destructive', onPress: () => void run() },
      ]);
    }
  };

  const related = event && !manual ? relatedSuggestion(event, openEvents) : null;
  const showForm =
    !loading && !!event && !!form && !!ui && (event.status === 'draft' || (event.status === 'pending_analysis' && manual));
  const actionable = isActionableType(form?.eventType ?? null);
  const mismatchBlocks = !!event && !manual && event.ai_mismatch && !form?.mismatchAcknowledged;

  /**
   * The VO quotes that are no longer in the transcript as it stands NOW.
   *
   * confirm_site_event (097:681-697) reads the quotes out of the stored
   * ai_draft and checks only that vo.flag is 'suggested' and the array is
   * non-empty — it never re-runs the literal-substring test the edge function
   * applied once, at draft-write time. So an edited transcript cannot
   * invalidate the stored evidence as far as the RPC is concerned, and the
   * Catatan Perubahan it writes would quote words the transcript no longer
   * contains. This check is the only thing standing between that and the
   * estimator (spec §1.1 rule 4).
   */
  const staleQuotes = useMemo(
    () => (event && form && !manual ? staleVoQuotes(event.ai_draft, [form.transcript, event.raw_text]) : []),
    [event, form, manual],
  );
  const voEvidenceStale = !!form?.voConfirm && staleQuotes.length > 0;
  const confirmDisabled = busy || mismatchBlocks || voEvidenceStale;

  return (
    <View style={s.flex}>
      <Header />
      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.navigate('Beranda')} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          <Text style={s.backText}>Beranda</Text>
        </TouchableOpacity>

        {loading ? (
          <Card>
            <Text style={s.empty}>Memuat draf…</Text>
          </Card>
        ) : null}

        {!loading && !event ? (
          <Card borderColor={COLORS.critical}>
            <Text style={s.errorText}>Kejadian tidak ditemukan atau Anda tidak punya akses.</Text>
          </Card>
        ) : null}

        {!loading && event && (event.status === 'open' || event.status === 'done') ? (
          <Card>
            <Text style={s.bannerText}>Kejadian ini sudah dikonfirmasi.</Text>
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={() => navigation.navigate('SiteEventDetail', { eventId: event.id, projectId: event.project_id })}
              accessibilityRole="button"
            >
              <Text style={s.primaryText}>Lihat kejadian</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {!loading && event && event.status === 'discarded' ? (
          <Card>
            <Text style={s.bannerText}>Draf ini sudah dibuang. Foto dan suaranya tetap tersimpan.</Text>
          </Card>
        ) : null}

        {!loading && event && event.status === 'pending_analysis' && !manual ? (
          <>
            <PendingAnalysisCard
              event={event}
              busy={busy}
              onReload={() => void load()}
              onReanalyze={() => void reanalyze()}
              onManual={startManual}
            />
            <TouchableOpacity style={s.dangerBtn} onPress={askDiscard} disabled={busy} accessibilityRole="button">
              <Text style={s.dangerText}>Buang</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {showForm && event && form && ui ? (
          <>
            <Card>
              <Text style={s.title}>{event.room_name ?? 'Ruangan'}</Text>
              <Text style={s.meta}>
                {event.room_floor || 'Tanpa lantai'} · dilaporkan {event.reporter_name ?? '—'}
              </Text>
            </Card>

            {manual ? (
              <View style={s.banner}>
                <Text style={s.bannerText}>Isi manual: AI tidak dipakai untuk kejadian ini.</Text>
              </View>
            ) : null}
            {ui.banner ? (
              <View style={s.banner}>
                <Text style={s.bannerText}>{ui.banner}</Text>
              </View>
            ) : null}
            {!manual && event.ai_mismatch ? (
              <View style={s.banner}>
                <Text style={s.bannerText}>
                  Foto dan suara tampak tidak cocok.{event.ai_draft?.mismatch.reason ? ` ${event.ai_draft.mismatch.reason}` : ''}
                </Text>
                <TouchableOpacity
                  style={s.checkRow}
                  onPress={() => update({ mismatchAcknowledged: !form.mismatchAcknowledged })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: form.mismatchAcknowledged }}
                >
                  <Ionicons name={form.mismatchAcknowledged ? 'checkbox' : 'square-outline'} size={22} color={COLORS.primary} />
                  <Text style={s.checkText}>Saya sudah memeriksa foto dan suara</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <Card title="Bukti">
              <MediaStrip media={event.media} />
              {event.raw_text ? <Text style={s.hint}>Catatan: {event.raw_text}</Text> : null}
              <TranscriptEditor
                value={form.transcript}
                onChange={(text) => {
                  setForm((f) => (f ? withTranscript(f, text) : f));
                  setErrors((prev) => clearFieldErrors(prev, ['voConfirm']));
                }}
                dirty={form.transcriptDirty}
                onReanalyze={() => void reanalyze()}
                busy={busy}
                canReanalyze={!manual}
              />

              {/* What the model says it read, and what the validator threw away.
                  Both travel inside ai_draft and were rendered nowhere, so the
                  only person who could check the AI's working could not see it. */}
              {!manual && event.ai_draft && event.ai_draft.evidence_quotes.length > 0 ? (
                <>
                  <Text style={s.label}>Dasar AI</Text>
                  {event.ai_draft.evidence_quotes.map((quote) => (
                    <Text key={quote} style={s.hint}>“{quote}”</Text>
                  ))}
                </>
              ) : null}
              {!manual && event.ai_draft && event.ai_draft.dropped.length > 0 ? (
                <>
                  <Text style={s.label}>Tidak dipakai AI</Text>
                  {event.ai_draft.dropped.map((drop, i) => (
                    <Text key={`${drop.field}-${i}`} style={s.hint}>
                      {drop.field}: {drop.reason}
                    </Text>
                  ))}
                </>
              ) : null}
            </Card>

            <Card title="Konfirmasi kejadian">
              <Text style={s.label}>
                Jenis <Text style={s.req}>*</Text>
              </Text>
              <EventTypeChipRow
                value={form.eventType}
                onChange={(type) => {
                  setForm((f) => (f ? withEventType(f, type, event.reporter_id) : f));
                  setErrors((prev) => clearFieldErrors(prev, ['eventType', 'ownerId']));
                }}
                markPeriksa={ui.markPeriksa}
                hint={ui.hintType}
                disabled={busy}
              />

              <Text style={s.label}>Gerbang</Text>
              <GateChipRow
                gates={gates}
                value={form.gateCode}
                onChange={(code) => {
                  setForm((f) => (f ? withGate(f, code) : f));
                  setErrors((prev) => clearFieldErrors(prev, ['gateCode', 'stepCode']));
                }}
                markPeriksa={ui.markPeriksa}
                hintCode={ui.hintGate}
                disabled={busy}
              />
              <StepChipRow
                steps={steps}
                gates={gates}
                gateCode={form.gateCode}
                value={form.stepCode}
                onChange={(code) => update({ stepCode: code })}
                disabled={busy}
              />

              <Text style={s.label}>
                Judul <Text style={s.req}>*</Text>
              </Text>
              <TextInput
                style={s.input}
                value={form.title}
                onChangeText={(v) => update({ title: v })}
                maxLength={DRAFT_TITLE_MAX}
                editable={!busy}
                accessibilityLabel="Judul"
              />
              <Text style={s.counter}>{form.title.length}/{DRAFT_TITLE_MAX}</Text>

              <Text style={s.label}>Ringkasan</Text>
              <TextInput
                style={[s.input, s.textarea]}
                value={form.summary}
                onChangeText={(v) => update({ summary: v })}
                maxLength={DRAFT_SUMMARY_MAX}
                multiline
                editable={!busy}
                accessibilityLabel="Ringkasan"
              />
              <Text style={s.counter}>{form.summary.length}/{DRAFT_SUMMARY_MAX}</Text>

              <Text style={s.label}>Dampak lanjutan</Text>
              <TextInput
                style={[s.input, s.textarea]}
                value={form.downstreamImpact}
                onChangeText={(v) => update({ downstreamImpact: v })}
                maxLength={DRAFT_IMPACT_MAX}
                multiline
                editable={!busy}
                placeholder="Pekerjaan apa yang tertahan bila ini tidak diselesaikan?"
                placeholderTextColor={COLORS.textMuted}
                accessibilityLabel="Dampak lanjutan"
              />
              <View style={s.checkRow}>
                <Text style={s.checkText}>Menghambat pekerjaan lain</Text>
                <Switch
                  value={form.isBlocking}
                  onValueChange={(v) => update({ isBlocking: v })}
                  disabled={busy}
                  accessibilityLabel="Menghambat pekerjaan lain"
                />
              </View>

              <Text style={s.label}>
                Pemilik{actionable ? <Text style={s.req}> *</Text> : null}
              </Text>
              <OwnerField team={team} value={form.ownerId} onChange={(id) => update({ ownerId: id })} required={actionable} disabled={busy} />

              <Text style={s.label}>
                Tenggat{actionable ? <Text style={s.req}> *</Text> : null}
              </Text>
              <DueDateField value={form.dueDate} onChange={(v) => update({ dueDate: v })} today={today} required={actionable} disabled={busy} />

              <VoAndRelatedBlock
                draft={manual ? null : event.ai_draft}
                voState={ui.voCheckbox}
                voConfirm={form.voConfirm}
                onVoChange={(v) => update({ voConfirm: v })}
                eventType={form.eventType}
                staleQuotes={staleQuotes}
                related={related}
                relatedEventId={form.relatedEventId}
                onLink={(id) => update({ relatedEventId: id })}
                disabled={busy}
              />

              {errors.length > 0 ? (
                <View style={s.errorBox}>
                  {errors.map((e) => (
                    <Text key={e} style={s.errorText}>• {e}</Text>
                  ))}
                </View>
              ) : null}

              <TouchableOpacity
                style={[s.primaryBtn, confirmDisabled && s.primaryBtnDisabled]}
                onPress={() => void onConfirm()}
                disabled={confirmDisabled}
                accessibilityRole="button"
                accessibilityState={{ disabled: confirmDisabled }}
              >
                <Text style={s.primaryText}>{busy ? 'Menyimpan…' : 'Konfirmasi'}</Text>
              </TouchableOpacity>
              {voEvidenceStale ? <Text style={s.errorText}>{VO_STALE_EVIDENCE_MESSAGE}</Text> : null}
              {mismatchBlocks ? <Text style={s.hint}>Centang pemeriksaan ketidakcocokan di atas untuk melanjutkan.</Text> : null}
              {!manual ? (
                <TouchableOpacity style={s.secondaryBtn} onPress={() => void reanalyze()} disabled={busy} accessibilityRole="button">
                  <Text style={s.secondaryText}>Analisis ulang</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={s.dangerBtn} onPress={askDiscard} disabled={busy} accessibilityRole="button">
                <Text style={s.dangerText}>Buang</Text>
              </TouchableOpacity>
            </Card>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
