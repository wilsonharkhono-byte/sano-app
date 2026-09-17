import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, Platform, Linking } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import PhotoGalleryField from '../components/PhotoGalleryField';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { listRoomsResult } from '../../tools/rooms';
import { listGateRefs } from '../../tools/gateRefs';
import { PhotoPermissionError, pickPhoto } from '../../tools/storage';
import { getRoomLastGate, newSiteEventId, workGroupHints } from '../../tools/siteEvents';
import { enqueueNewCapture } from '../../tools/captureQueueStore';
import { triggerDrain } from '../../tools/captureQueueWorker';
import { PROJECT_PHASE_LABELS, SITE_EVENT_MAX_CLOSEUPS } from '../../tools/constants';
import type { GateRef, Room } from '../../tools/types';
import { COLORS } from '../theme';
import { formStyles as s } from './siteEvent/styles';
import { GateChipRow } from './siteEvent/GateChipRow';
import VoiceNoteField from './siteEvent/VoiceNoteField';
import OpenEventsList from './siteEvent/OpenEventsList';
import { WEB_QUEUE_WARNING, WEB_QUEUED_TOAST } from './siteEvent/captureQueueModel';
import {
  buildNewSiteEvent,
  canSend,
  removeAt,
  replaceAt,
  type CaptureDraft,
  type CapturePhoto,
  type CaptureVoice,
} from './siteEvent/captureModel';

const NOTE_MAX = 500;

/**
 * Scan, photograph, speak, send (spec §5.2). The event id is fixed when the
 * screen opens, and every photo's id when it is taken, so "Kirim ulang" after a
 * failed upload reuses the same object paths and the same row: nothing
 * duplicates. The route is registered with unmountOnBlur, so the next visit
 * always starts empty.
 */
export default function SiteEventCaptureScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { projects, project: activeProject, profile, boqItems } = useProject();
  const { show: toast } = useToast();
  const params = (route.params ?? {}) as { projectId?: string; roomId?: string };
  const project = projects.find((p) => p.id === params.projectId) ?? null;

  const [room, setRoom] = useState<Room | null>(null);
  const [roomLoadError, setRoomLoadError] = useState<string | null>(null);
  const [gates, setGates] = useState<GateRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventId] = useState(() => newSiteEventId());
  const [contextPhoto, setContextPhoto] = useState<CapturePhoto | null>(null);
  const [closeups, setCloseups] = useState<CapturePhoto[]>([]);
  const [voice, setVoice] = useState<CaptureVoice | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [note, setNote] = useState('');
  const [gateCode, setGateCode] = useState<string | null>(null);
  const [gateHint, setGateHint] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cameraDenied, setCameraDenied] = useState(false);
  const sendingRef = useRef(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadRoom = useCallback(async () => {
    setLoading(true);
    if (!project || !params.roomId) {
      if (alive.current) setLoading(false);
      return;
    }
    const [roomsResult, gateRows, lastGate] = await Promise.all([
      listRoomsResult(project.id, { includeInactive: true }),
      listGateRefs({ activeOnly: true }),
      getRoomLastGate(params.roomId),
    ]);
    if (!alive.current) return;
    if (roomsResult.rooms === null) {
      // A failed read is not "ruangan tidak ditemukan" (CLAUDE.md §12) — that
      // sends a supervisor standing in a real room to re-scan a label that
      // isn't the problem. Offer a retry instead.
      setRoomLoadError('Gagal memuat ruangan. Periksa koneksi lalu coba lagi.');
      setRoom(null);
      setLoading(false);
      return;
    }
    setRoomLoadError(null);
    setRoom(roomsResult.rooms.find((r) => r.id === params.roomId) ?? null);
    setGates(gateRows);
    // Spec §5.2: the room's last tagged gate is a suggestion, not a pick —
    // it renders as a dashed "Saran AI" chip (GateChipRow's hintCode), and
    // only lands in the payload if the supervisor never taps a chip of
    // their own (see buildNewSiteEvent's gateCode ?? gateHint fallback).
    setGateHint(lastGate && gateRows.some((g) => g.code === lastGate) ? lastGate : null);
    setLoading(false);
  }, [project, params.roomId]);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  const takePhoto = async (): Promise<CapturePhoto | null> => {
    try {
      const photo = await pickPhoto();
      if (photo) setCameraDenied(false);
      return photo ? { id: newSiteEventId(), photo } : null;
    } catch (err) {
      toast((err as Error).message, 'critical');
      // pickPhoto (tools/storage.ts) throws a typed PhotoPermissionError on
      // denial, carrying canAskAgain directly — no need to re-query the
      // permission here. Any other error clears cameraDenied: reaching this
      // catch past the permission check means the permission was granted.
      setCameraDenied(err instanceof PhotoPermissionError ? !err.canAskAgain : false);
      return null;
    }
  };

  const backToRoom = () => {
    if (project && room) navigation.navigate('Room', { projectCode: project.code, roomCode: room.room_code });
    else navigation.navigate('Beranda');
  };

  const onSend = async () => {
    // Synchronous, checked-and-set before any await: two taps landing in the
    // same tick both pass the `sending` state check (it hasn't re-rendered
    // yet), so the state guard alone isn't enough.
    if (sendingRef.current) return;
    sendingRef.current = true;
    if (!project || !room || !profile) {
      sendingRef.current = false;
      return;
    }
    const draft: CaptureDraft = {
      eventId,
      projectId: project.id,
      roomId: room.id,
      reporterId: profile.id,
      gateCode,
      gateHint,
      note,
      context: contextPhoto,
      closeups,
      voice,
    };
    const check = canSend(draft);
    if (!check.ok) {
      setSendError(check.reason);
      sendingRef.current = false;
      return;
    }
    setSending(true);
    setSendError(null);
    // Work-group names are prompt hints; they come from the loaded BoQ only
    // when the scanned project is the active one.
    const hints = activeProject?.id === project.id ? workGroupHints(boqItems) : [];
    try {
      await enqueueNewCapture({
        userId: profile.id,
        event: buildNewSiteEvent(draft, new Date().toISOString()),
        workGroupNames: hints,
        nowIso: new Date().toISOString(),
      });
    } catch (err) {
      setSending(false);
      sendingRef.current = false;
      // enqueueNewCapture only throws for a genuinely unexpected failure
      // (disk full, permission denied on the document directory) — the
      // ordinary "no signal" case is exactly what the queue exists to
      // absorb, so it never reaches here. The draft's inputs are untouched,
      // so "Kirim ulang" retries with everything still in place.
      const message = (err as Error).message || 'Gagal menyimpan laporan di HP ini.';
      setSendError(message);
      // Also toast: if the supervisor already tapped "Ruangan" while this was
      // in flight, the screen (unmountOnBlur) is gone and setSendError is a
      // no-op — the toast is what still reaches them.
      toast(message, 'critical');
      return;
    }
    // Kirim returns at once; the queue delivers this in the background
    // (tools/captureQueueWorker.ts) whenever there is a signal.
    triggerDrain();
    setSending(false);
    sendingRef.current = false;
    // Web's queue backend is in-memory only (captureQueueStore.ts), so
    // "Tersimpan" would contradict WEB_QUEUE_WARNING at the moment it
    // matters most — say so honestly instead of reusing the native toast.
    toast(Platform.OS === 'web' ? WEB_QUEUED_TOAST : 'Tersimpan, dikirim saat ada sinyal', 'ok');
    backToRoom();
  };

  const refusal = loading
    ? null
    : roomLoadError
      ? null // rendered separately below, with a retry
      : !project
        ? 'Anda tidak ditugaskan ke proyek ini.'
        : !room
          ? 'Ruangan tidak ditemukan. Pindai ulang labelnya.'
          : !room.active
            ? 'Ruangan ini sudah tidak aktif. Hubungi kantor.'
            : null;

  const sendDisabled = !contextPhoto || sending || voiceBusy;

  return (
    <View style={s.flex}>
      <Header />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, s.contentFabClear]}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!voiceBusy}
      >
        <TouchableOpacity style={s.backBtn} onPress={backToRoom} disabled={sending} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          <Text style={s.backText}>Ruangan</Text>
        </TouchableOpacity>

        {loading ? (
          <Card>
            <Text style={s.empty}>Memuat ruangan…</Text>
          </Card>
        ) : null}

        {!loading && roomLoadError ? (
          <Card borderColor={COLORS.critical}>
            <Text style={s.errorText}>{roomLoadError}</Text>
            <TouchableOpacity style={s.secondaryBtn} onPress={() => void loadRoom()} accessibilityRole="button">
              <Text style={s.secondaryText}>Coba lagi</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {refusal ? (
          <Card borderColor={COLORS.critical}>
            <Text style={s.errorText}>{refusal}</Text>
          </Card>
        ) : null}

        {!loading && !roomLoadError && !refusal && project && room ? (
          <>
            <Card>
              <Text style={s.title}>{room.room_name}</Text>
              <Text style={s.meta}>
                {room.floor || 'Tanpa lantai'} · Fase {PROJECT_PHASE_LABELS[project.phase] ?? project.phase}
              </Text>
            </Card>

            <Card title="Kejadian terbuka di ruangan ini" subtitle="Sudah dilaporkan? Buka saja, jangan kirim ulang.">
              <OpenEventsList
                roomId={room.id}
                limit={3}
                onOpen={(event) => navigation.navigate('SiteEventDetail', { eventId: event.id, projectId: event.project_id })}
              />
            </Card>

            <Card title="Lapor kejadian">
              <Text style={s.label}>
                Foto konteks <Text style={s.req}>*</Text>
              </Text>
              <PhotoGalleryField
                photoPaths={contextPhoto ? [contextPhoto.photo.uri] : []}
                maxPhotos={1}
                emptyLabel="Foto konteks"
                helperText="Wajib. Ambil seluruh area agar close-up bisa dipahami besok."
                onAdd={async () => {
                  const taken = await takePhoto();
                  if (taken) setContextPhoto(taken);
                }}
                onReplace={async () => {
                  const taken = await takePhoto();
                  if (taken) setContextPhoto(taken);
                }}
                onRemove={() => setContextPhoto(null)}
              />
              {cameraDenied ? (
                <View style={s.errorBox}>
                  <Text style={s.errorText}>Akses kamera untuk SANO telah dimatikan. Aktifkan lagi lewat Pengaturan.</Text>
                  <TouchableOpacity
                    style={s.secondaryBtn}
                    onPress={() => void Linking.openSettings()}
                    accessibilityRole="button"
                  >
                    <Text style={s.secondaryText}>Buka Pengaturan</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <Text style={s.label}>Close-up</Text>
              <PhotoGalleryField
                photoPaths={closeups.map((c) => c.photo.uri)}
                maxPhotos={SITE_EVENT_MAX_CLOSEUPS}
                emptyLabel="Close-up"
                helperText={`Opsional, maksimal ${SITE_EVENT_MAX_CLOSEUPS} foto.`}
                onAdd={async () => {
                  const taken = await takePhoto();
                  if (taken) setCloseups((prev) => [...prev, taken].slice(0, SITE_EVENT_MAX_CLOSEUPS));
                }}
                onReplace={async (index) => {
                  const taken = await takePhoto();
                  if (taken) setCloseups((prev) => replaceAt(prev, index, taken));
                }}
                onRemove={(index) => setCloseups((prev) => removeAt(prev, index))}
              />

              <Text style={s.label}>Suara</Text>
              <VoiceNoteField value={voice} onChange={setVoice} onBusyChange={setVoiceBusy} disabled={sending} />

              <Text style={s.label}>Catatan</Text>
              <TextInput
                style={[s.input, s.textarea]}
                value={note}
                onChangeText={setNote}
                placeholder="Opsional. Tulis bila tidak sempat merekam."
                placeholderTextColor={COLORS.textMuted}
                multiline
                maxLength={NOTE_MAX}
                editable={!sending}
                accessibilityLabel="Catatan"
              />
              <Text style={s.counter}>{note.length}/{NOTE_MAX}</Text>

              <Text style={s.label}>Gerbang</Text>
              <GateChipRow gates={gates} value={gateCode} hintCode={gateHint} onChange={setGateCode} disabled={sending} />
              <Text style={s.hint}>Bawaan: gerbang terakhir ruangan ini. AI tetap memeriksa, Anda yang memutuskan.</Text>

              {sendError ? (
                <View style={s.errorBox}>
                  <Text style={s.errorText}>{sendError}</Text>
                </View>
              ) : null}

              {voiceBusy ? <Text style={s.hint}>Menunggu rekaman selesai…</Text> : null}

              <TouchableOpacity
                style={[s.primaryBtn, sendDisabled && s.primaryBtnDisabled]}
                onPress={() => void onSend()}
                disabled={sendDisabled}
                accessibilityRole="button"
                accessibilityState={{ disabled: sendDisabled }}
              >
                <Text style={s.primaryText}>{sending ? 'Mengirim…' : sendError ? 'Kirim ulang' : 'Kirim'}</Text>
              </TouchableOpacity>
              {Platform.OS === 'web' ? (
                <Text style={s.hint}>{WEB_QUEUE_WARNING}</Text>
              ) : null}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
