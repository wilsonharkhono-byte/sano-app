import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import PhotoGalleryField from '../../components/PhotoGalleryField';
import { useToast } from '../../components/Toast';
import { pickPhoto } from '../../../tools/storage';
import { closeSiteEvent, newSiteEventId, type LocalSiteEventMedia } from '../../../tools/siteEvents';
import { COLORS } from '../../theme';
import { formStyles as s } from './styles';

const NOTE_MAX = 500;

interface Props {
  eventId: string;
  projectId: string;
  onClosed: () => void;
  onCancel: () => void;
}

/** "Selesai" (spec §5.5): closure evidence is offered, not required, in release 1. */
export default function ClosureForm({ eventId, projectId, onClosed, onCancel }: Props) {
  const { show: toast } = useToast();
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<LocalSiteEventMedia | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setSaving(true);
    setError(null);
    const result = await closeSiteEvent({ eventId, projectId, note, closurePhoto: photo });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    toast('Kejadian ditandai selesai.', 'ok');
    onClosed();
  };

  return (
    <View>
      <Text style={s.label}>Foto penutupan</Text>
      <PhotoGalleryField
        photoPaths={photo ? [photo.localUri] : []}
        maxPhotos={1}
        emptyLabel="Foto hasil"
        helperText="Opsional. Bukti bahwa masalahnya sudah beres."
        onAdd={() => void take()}
        onReplace={() => void take()}
        onRemove={() => setPhoto(null)}
      />

      <Text style={s.label}>Catatan penutupan</Text>
      <TextInput
        style={[s.input, s.textarea]}
        value={note}
        onChangeText={setNote}
        maxLength={NOTE_MAX}
        multiline
        editable={!saving}
        placeholder="Opsional. Apa yang dikerjakan?"
        placeholderTextColor={COLORS.textMuted}
        accessibilityLabel="Catatan penutupan"
      />
      <Text style={s.counter}>{note.length}/{NOTE_MAX}</Text>

      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[s.primaryBtn, saving && s.primaryBtnDisabled]}
        onPress={() => void submit()}
        disabled={saving}
        accessibilityRole="button"
      >
        <Text style={s.primaryText}>{saving ? 'Menyimpan…' : 'Tandai selesai'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.secondaryBtn} onPress={onCancel} disabled={saving} accessibilityRole="button">
        <Text style={s.secondaryText}>Batal</Text>
      </TouchableOpacity>
    </View>
  );
}
