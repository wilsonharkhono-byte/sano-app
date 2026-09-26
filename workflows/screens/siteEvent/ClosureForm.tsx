import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import PhotoGalleryField from '../../components/PhotoGalleryField';
import { useToast } from '../../components/Toast';
import { pickPhoto } from '../../../tools/storage';
import { newSiteEventId, type LocalSiteEventMedia } from '../../../tools/siteEvents';
import { enqueueCloseJob } from '../../../tools/captureQueueStore';
import { triggerDrain } from '../../../tools/captureQueueWorker';
import type { SiteEventType } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';
import { formStyles as s } from './styles';
import {
  CLOSE_QUEUED_TOAST,
  CLOSURE_NOTE_MAX,
  WEB_CLOSE_QUEUED_TOAST,
  closureBlocker,
  closureCopy,
  closureRequirement,
  noteLength,
  type Requirement,
} from './closureModel';

interface Props {
  /** The signed-in profile; the close job belongs to it (a shared phone must not mix people). */
  userId: string;
  eventId: string;
  projectId: string;
  roomId: string;
  eventTitle: string;
  eventType: SiteEventType | null;
  /** Called once the close is safely in the queue - NOT when the server has closed the event. */
  onQueued: () => void;
  onCancel: () => void;
}

/** Coloured by the rule (closureRequirement), never by its wording. */
function Badge({ requirement, label }: { requirement: Requirement; label: string }) {
  const required = requirement === 'wajib';
  return (
    <View style={[styles.badge, required ? styles.badgeRequired : styles.badgeOptional]}>
      <Text style={[styles.badgeText, required ? styles.badgeTextRequired : styles.badgeTextOptional]}>{label}</Text>
    </View>
  );
}

/**
 * "Selesai" (closure spec 2026-09-26 §3.3). Asks for proof by event type,
 * the same rule migration 105 enforces, and never closes anything itself: the
 * submit puts a close job in the capture queue and the status turns "Selesai"
 * only when the server has accepted it (spec §1.1 rule 1).
 */
export default function ClosureForm({ userId, eventId, projectId, roomId, eventTitle, eventType, onQueued, onCancel }: Props) {
  const { show: toast } = useToast();
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<LocalSiteEventMedia | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set synchronously, unlike `saving`: two presses in one frame both run
  // against the render before setSaving(true) lands, and would queue the
  // close twice.
  const submitting = useRef(false);

  const requirement = closureRequirement(eventType);
  const copy = closureCopy(eventType);
  // The exact string the job will send, and the one both sides count.
  const sentNote = note.trim();
  const blocker = closureBlocker({ type: eventType, hasPhoto: photo !== null, sentNote });
  const disabled = saving || blocker !== null;

  const take = async () => {
    try {
      const picked = await pickPhoto();
      if (!picked) return;
      setPhoto({
        id: newSiteEventId(),
        localUri: picked.uri,
        kind: 'photo',
        role: 'closure',
        mimeType: picked.contentType,
        ext: picked.ext,
        durationS: null,
        sortOrder: 0,
        capturedAt: picked.capturedAt,
      });
    } catch (err) {
      toast((err as Error).message, 'critical');
    }
  };

  const submit = async () => {
    if (disabled || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await enqueueCloseJob({
        userId,
        jobId: newSiteEventId(),
        eventId,
        projectId,
        roomId,
        eventTitle,
        note: sentNote,
        closurePhoto: photo,
        nowIso: new Date().toISOString(),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
    } catch (err) {
      setError(`Penutupan gagal disimpan di ponsel: ${(err as Error).message}`);
      return;
    } finally {
      submitting.current = false;
      setSaving(false);
    }
    triggerDrain();
    toast(Platform?.OS === 'web' ? WEB_CLOSE_QUEUED_TOAST : CLOSE_QUEUED_TOAST, 'ok');
    onQueued();
  };

  return (
    <View>
      <View style={styles.labelRow}>
        <Text style={[s.label, styles.labelInRow]}>Foto penutupan</Text>
        <Badge requirement={requirement.photo} label={copy.photoBadge} />
      </View>
      <PhotoGalleryField
        photoPaths={photo ? [photo.localUri] : []}
        maxPhotos={1}
        emptyLabel="Foto hasil"
        helperText={copy.photoHelper}
        onAdd={() => void take()}
        onReplace={() => void take()}
        onRemove={() => setPhoto(null)}
      />

      <View style={styles.labelRow}>
        <Text style={[s.label, styles.labelInRow]}>{copy.noteLabel}</Text>
        <Badge requirement={requirement.note} label={copy.noteBadge} />
      </View>
      {copy.noteHint ? <Text style={s.hint}>{copy.noteHint}</Text> : null}
      <TextInput
        style={[s.input, s.textarea]}
        value={note}
        onChangeText={setNote}
        maxLength={CLOSURE_NOTE_MAX}
        multiline
        editable={!saving}
        placeholder={copy.notePlaceholder}
        placeholderTextColor={COLORS.textMuted}
        accessibilityLabel={copy.noteLabel}
      />
      <Text style={s.counter}>{copy.counter(noteLength(sentNote))}</Text>

      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[s.primaryBtn, disabled && s.primaryBtnDisabled]}
        onPress={() => void submit()}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
      >
        <Text style={s.primaryText}>{saving ? 'Menyimpan…' : 'Tandai selesai'}</Text>
      </TouchableOpacity>
      {blocker && !saving ? <Text style={s.hint}>{blocker}</Text> : null}
      <TouchableOpacity style={s.secondaryBtn} onPress={onCancel} disabled={saving} accessibilityRole="button">
        <Text style={s.secondaryText}>Batal</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.md, marginBottom: 6 },
  labelInRow: { marginTop: 0, marginBottom: 0 },
  badge: { paddingVertical: 2, paddingHorizontal: SPACE.sm, borderRadius: RADIUS },
  badgeRequired: { backgroundColor: COLORS.criticalBg },
  badgeOptional: { backgroundColor: COLORS.surfaceAlt },
  badgeText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold },
  badgeTextRequired: { color: COLORS.critical },
  badgeTextOptional: { color: COLORS.textSec },
});
