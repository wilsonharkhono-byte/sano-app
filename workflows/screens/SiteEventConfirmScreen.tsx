import React, { useCallback, useEffect, useState } from 'react';
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
  initialConfirmForm,
  relatedSuggestion,
  toConfirmInput,
  withEventType,
  withGate,
  withTranscript,
  type ConfirmForm,
} from './siteEvent/confirmModel';

/**
 * The only writer of human-facing fields (spec §1.1 rule 2, §5.4). Everything
 * the AI proposed is visible and editable; nothing reaches the database until
 * "Konfirmasi", and confirm_site_event re-checks every rule this screen checks.
 */
export default function SiteEventConfirmScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { project: activeProject, boqItems } = useProject();
  const { show: toast } = useToast();
  const eventId = ((route.params ?? {}) as { eventId?: string }).eventId ?? '';
  // `today` is the phone's LOCAL calendar day, not Asia/Jakarta — confirm_site_event checks the due date against WIB, so right after local midnight in WITA/WIT this screen can reject a same-day (Jakarta) due date the RPC would still accept, which fails closed rather than open (see validateConfirmInput's duePast comment in tools/siteEventRules.ts).
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

  const load = useCallback(async () => {
    setLoading(true);
    const ev = await getSiteEvent(eventId);
    setEvent(ev);
    if (ev) {
      const [gateRows, stepRows, members, open] = await Promise.all([
        listGateRefs({ activeOnly: true }),
        listGateStepRefs({ activeOnly: true }),
        getProjectTeam(ev.project_id),
        listOpenEventsForRoom(ev.room_id, 10),
      ]);
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
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (patch: Partial<ConfirmForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const startManual = () => {
    if (!event) return;
    const initial = initialConfirmForm(event, today, true);
    setForm(initial.form);
    setUi(initial.ui);
    setManual(true);
  };

  const reanalyze = async () => {
    if (!event) return;
    setBusy(true);
    if (form?.transcriptDirty) {
      const saved = await saveTranscriptEdit(event.id, form.transcript);
      if (saved.error) {
        setBusy(false);
        toast(saved.error, 'critical');
        return;
      }
    }
    const hints = activeProject?.id === event.project_id ? workGroupHints(boqItems) : [];
    const result = await invokeSiteEventAnalysis(event.id, { force: true, workGroupNames: hints });
    setBusy(false);
    if (!result.ok && result.error) toast(result.error, 'warning');
    await load();
  };

  const onConfirm = async () => {
    if (!event || !form) return;
    setBusy(true);
    const r = await confirmSiteEvent(event.id, toConfirmInput(form, event, today, manual, steps));
    setBusy(false);
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
  };

  const askDiscard = () => {
    const run = async () => {
      if (!event) return;
      setBusy(true);
      const r = await discardSiteEvent(event.id);
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
  const showForm = !!event && !!form && !!ui && (event.status === 'draft' || (event.status === 'pending_analysis' && manual));
  const actionable = isActionableType(form?.eventType ?? null);
  const mismatchBlocks = !!event && !manual && event.ai_mismatch && !form?.mismatchAcknowledged;
  const confirmDisabled = busy || mismatchBlocks;

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
                onChange={(text) => setForm((f) => (f ? withTranscript(f, text) : f))}
                dirty={form.transcriptDirty}
                onReanalyze={() => void reanalyze()}
                busy={busy}
              />
            </Card>

            <Card title="Konfirmasi kejadian">
              <Text style={s.label}>
                Jenis <Text style={s.req}>*</Text>
              </Text>
              <EventTypeChipRow
                value={form.eventType}
                onChange={(type) => setForm((f) => (f ? withEventType(f, type, event.reporter_id) : f))}
                markPeriksa={ui.markPeriksa}
                hint={ui.hintType}
                disabled={busy}
              />

              <Text style={s.label}>Gerbang</Text>
              <GateChipRow
                gates={gates}
                value={form.gateCode}
                onChange={(code) => setForm((f) => (f ? withGate(f, code) : f))}
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
