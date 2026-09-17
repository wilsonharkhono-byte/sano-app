import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, Switch, Alert, Platform } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { listGateRefs, listGateStepRefs } from '../../tools/gateRefs';
import { getProjectTeamResult, type TeamMember } from '../../tools/projectManagement';
import {
  confirmSiteEvent,
  discardSiteEvent,
  getSiteEventResult,
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
  manualConfirmGate,
  relatedSuggestion,
  staleVoQuotes,
  survivingVoQuotes,
  toConfirmInput,
  withEventType,
  withGate,
  withTranscript,
  VO_PARTIAL_EVIDENCE_NOTE,
  VO_STALE_EVIDENCE_MESSAGE,
  type ConfirmForm,
} from './siteEvent/confirmModel';

/** How often a still-analysing draft re-checks itself, so nobody has to tap "Muat ulang". */
const PENDING_POLL_MS = 10_000;

/** A manual confirm cannot proceed once the model's draft has landed (see onConfirm). */
const DRAFT_ARRIVED_MESSAGE = 'Draf AI baru saja tiba. Muat ulang untuk melihatnya.';

/** A manual confirm cannot proceed when the re-check read itself fails (see onConfirm). */
const DRAFT_RECHECK_FAILED_MESSAGE = 'Gagal memeriksa draf terbaru. Periksa koneksi lalu coba lagi.';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gates, setGates] = useState<GateRef[]>([]);
  const [steps, setSteps] = useState<GateStepRef[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamError, setTeamError] = useState<string | null>(null);
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
      const evResult = await getSiteEventResult(eventId);
      if (!alive.current) return;
      if (evResult.event === null && opts.silent) return;
      if (evResult.error) {
        // A network failure is not "kejadian tidak ditemukan" (CLAUDE.md
        // §12) — offer a retry instead of the not-found copy below.
        setLoadError('Gagal memuat. Periksa koneksi lalu coba lagi.');
        setEvent(null);
        setLoading(false);
        return;
      }
      setLoadError(null);
      const ev = evResult.event;
      setEvent(ev);
      if (ev) {
        const [gateRows, stepRows, teamResult, open] = await Promise.all([
          listGateRefs({ activeOnly: true }),
          listGateStepRefs({ activeOnly: true }),
          getProjectTeamResult(ev.project_id),
          listOpenEventsForRoom(ev.room_id, 10),
        ]);
        if (!alive.current) return;
        setGates(gateRows);
        setSteps(stepRows);
        if (teamResult.team === null) {
          // Same rule for the team: an empty team here would make OwnerField
          // say "Tim proyek belum diatur", which is wrong for a dropped
          // connection rather than a project with genuinely nobody assigned.
          setTeamError('Tim proyek gagal dimuat. Coba lagi.');
          setTeam([]);
        } else {
          setTeamError(null);
          setTeam(teamResult.team);
        }
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
      // manualConfirmGate (confirmModel.ts) turns the three-way read outcome
      // into the right action so a failed re-check is never silently read as
      // "no draft arrived" (CLAUDE.md §12).
      if (manual) {
        const freshResult = await getSiteEventResult(event.id);
        if (!alive.current) return;
        const gate = manualConfirmGate(freshResult);
        if (gate === 'block-read-failed') {
          setErrors([DRAFT_RECHECK_FAILED_MESSAGE]);
          toast(DRAFT_RECHECK_FAILED_MESSAGE, 'critical');
          return;
        }
        if (gate === 'block-not-found') {
          // Same as load()'s own notFound handling: clear the event so the
          // "Kejadian tidak ditemukan..." card renders instead of guessing.
          setEvent(null);
          setLoadError(null);
          return;
        }
        if (gate === 'block-draft-arrived') {
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
   * The VO quotes that are, and are not, still in the transcript as it stands
   * NOW — `sources` is `[form.transcript, event.raw_text]`, the same two
   * haystacks confirm_site_event (migration 100,
   * supabase/migrations/100_confirm_vo_evidence_recheck.sql) checks against
   * the transcript it is about to persist, through the same normaliser
   * (site_event_norm_quote mirrors normalizeForQuoteMatch fold for fold). The
   * RPC keeps whichever quotes still match and refuses the VO only when NONE
   * do; this screen mirrors that exact rule so Konfirmasi is blocked only in
   * the same case the server would refuse it (spec §1.1 rule 4).
   */
  const staleQuotes = useMemo(
    () => (event && form && !manual ? staleVoQuotes(event.ai_draft, [form.transcript, event.raw_text]) : []),
    [event, form, manual],
  );
  const survivingQuotes = useMemo(
    () => (event && form && !manual ? survivingVoQuotes(event.ai_draft, [form.transcript, event.raw_text]) : []),
    [event, form, manual],
  );
  // Blocked only when the edit wiped out every quote — the same case
  // confirm_site_event (100) would refuse with SITE_EVENT_VO_NO_EVIDENCE.
  const voEvidenceBlocked = !!form?.voConfirm && staleQuotes.length > 0 && survivingQuotes.length === 0;
  // Some, but not all, quotes survived: Konfirmasi proceeds, but only the
  // survivors will reach Catatan Perubahan, so say so.
  const voEvidencePartial = staleQuotes.length > 0 && survivingQuotes.length > 0;
  const confirmDisabled = busy || mismatchBlocks || voEvidenceBlocked;

  return (
    <View style={s.flex}>
      <Header />
      <ScrollView style={s.scroll} contentContainerStyle={[s.content, s.contentFabClear]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.navigate('Beranda')} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          <Text style={s.backText}>Beranda</Text>
        </TouchableOpacity>

        {loading ? (
          <Card>
            <Text style={s.empty}>Memuat draf…</Text>
          </Card>
        ) : null}

        {!loading && !event && loadError ? (
          <Card borderColor={COLORS.critical}>
            <Text style={s.errorText}>{loadError}</Text>
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
              {teamError ? (
                <View>
                  <Text style={s.errorText}>{teamError}</Text>
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => void load()} accessibilityRole="button">
                    <Text style={s.secondaryText}>Coba lagi</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <OwnerField team={team} value={form.ownerId} onChange={(id) => update({ ownerId: id })} required={actionable} disabled={busy} />
              )}

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
                partialEvidenceNote={voEvidencePartial ? VO_PARTIAL_EVIDENCE_NOTE : null}
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
              {voEvidenceBlocked ? <Text style={s.errorText}>{VO_STALE_EVIDENCE_MESSAGE}</Text> : null}
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
