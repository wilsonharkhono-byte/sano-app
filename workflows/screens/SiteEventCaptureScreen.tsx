import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import PhotoGalleryField from '../components/PhotoGalleryField';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { listRooms } from '../../tools/rooms';
import { listGateRefs } from '../../tools/gateRefs';
import { pickPhoto } from '../../tools/storage';
import { createSiteEventWithMedia, getRoomLastGate, newSiteEventId, workGroupHints } from '../../tools/siteEvents';
import { PROJECT_PHASE_LABELS, SITE_EVENT_MAX_CLOSEUPS } from '../../tools/constants';
import type { GateRef, Room } from '../../tools/types';
import { COLORS } from '../theme';
import { formStyles as s } from './siteEvent/styles';
import { GateChipRow } from './siteEvent/GateChipRow';
import VoiceNoteField from './siteEvent/VoiceNoteField';
import OpenEventsList from './siteEvent/OpenEventsList';
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
  const [gates, setGates] = useState<GateRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventId] = useState(() => newSiteEventId());
  const [contextPhoto, setContextPhoto] = useState<CapturePhoto | null>(null);
  const [closeups, setCloseups] = useState<CapturePhoto[]>([]);
  const [voice, setVoice] = useState<CaptureVoice | null>(null);
  const [note, setNote] = useState('');
  const [gateCode, setGateCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      if (!project || !params.roomId) {
        if (alive) setLoading(false);
        return;
      }
      const [rooms, gateRows, lastGate] = await Promise.all([
        listRooms(project.id, { includeInactive: true }),
        listGateRefs({ activeOnly: true }),
        getRoomLastGate(params.roomId),
      ]);
      if (!alive) return;
      setRoom(rooms.find((r) => r.id === params.roomId) ?? null);
      setGates(gateRows);
      // Spec §5.2: default to the room's last tagged gate, if it is still active.
      setGateCode((current) => current ?? (lastGate && gateRows.some((g) => g.code === lastGate) ? lastGate : null));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [project, params.roomId]);

  const takePhoto = async (): Promise<CapturePhoto | null> => {
    try {
      const photo = await pickPhoto();
      return photo ? { id: newSiteEventId(), photo } : null;
    } catch (err) {
      toast((err as Error).message, 'critical');
      return null;
    }
  };

  const backToRoom = () => {
    if (project && room) navigation.navigate('Room', { projectCode: project.code, roomCode: room.room_code });
    else navigation.navigate('Beranda');
  };

  const onSend = async () => {
    if (!project || !room || !profile) return;
    const draft: CaptureDraft = {
      eventId,
      projectId: project.id,
      roomId: room.id,
      reporterId: profile.id,
      gateCode,
      note,
      context: contextPhoto,
      closeups,
      voice,
    };
    const check = canSend(draft);
    if (!check.ok) {
      setSendError(check.reason);
      return;
    }
    setSending(true);
    setSendError(null);
    // Work-group names are prompt hints; they come from the loaded BoQ only
    // when the scanned project is the active one.
    const hints = activeProject?.id === project.id ? workGroupHints(boqItems) : [];
    const result = await createSiteEventWithMedia(buildNewSiteEvent(draft, new Date().toISOString()), {
      workGroupNames: hints,
    });
    setSending(false);
    if (result.error) {
      setSendError(result.error);
      return;
    }
    toast('Terkirim. Draf AI akan muncul di Beranda.', 'ok');
    void result.analysis?.then((analysis) => {
      if (!analysis.ok && analysis.error) toast(analysis.error, 'warning');
    });
    backToRoom();
  };

  const refusal = loading
    ? null
    : !project
      ? 'Anda tidak ditugaskan ke proyek ini.'
      : !room
        ? 'Ruangan tidak ditemukan. Pindai ulang labelnya.'
        : !room.active
          ? 'Ruangan ini sudah tidak aktif. Hubungi kantor.'
          : null;

  const sendDisabled = !contextPhoto || sending;

  return (
    <View style={s.flex}>
      <Header />
      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.backBtn} onPress={backToRoom} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          <Text style={s.backText}>Ruangan</Text>
        </TouchableOpacity>

        {loading ? (
          <Card>
            <Text style={s.empty}>Memuat ruangan…</Text>
          </Card>
        ) : null}

        {refusal ? (
          <Card borderColor={COLORS.critical}>
            <Text style={s.errorText}>{refusal}</Text>
          </Card>
        ) : null}

        {!loading && !refusal && project && room ? (
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
              <VoiceNoteField value={voice} onChange={setVoice} disabled={sending} />

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
              <GateChipRow gates={gates} value={gateCode} onChange={setGateCode} disabled={sending} />
              <Text style={s.hint}>Bawaan: gerbang terakhir ruangan ini. AI tetap memeriksa, Anda yang memutuskan.</Text>

              {sendError ? (
                <View style={s.errorBox}>
                  <Text style={s.errorText}>{sendError}</Text>
                </View>
              ) : null}

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
                <Text style={s.hint}>Di web, tetap di halaman ini sampai muncul "Terkirim".</Text>
              ) : null}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
