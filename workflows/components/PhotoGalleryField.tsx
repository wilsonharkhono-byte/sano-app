import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS } from '../theme';
import { resolvePhotoUrl } from '../../tools/storage';

interface Props {
  photoPaths: string[];
  onAdd: () => void;
  onReplace: (index: number) => void;
  onRemove: (index: number) => void;
  emptyLabel?: string;
  helperText?: string;
  maxPhotos?: number;
}

interface ThumbProps {
  path: string;
  index: number;
  onReplace: (index: number) => void;
  onRemove: (index: number) => void;
}

function PhotoThumb({ path, index, onReplace, onRemove }: ThumbProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    resolvePhotoUrl(path)
      .then((url) => {
        if (alive) setPhotoUrl(url);
      })
      .catch(() => {
        if (alive) setPhotoUrl(null);
      });

    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.frame} onPress={() => onReplace(index)} activeOpacity={0.8}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={styles.imageFallback}>
            <Ionicons name="image-outline" size={22} color={COLORS.textSec} />
            <Text style={styles.fallbackText}>Memuat foto</Text>
          </View>
        )}
      </TouchableOpacity>
      <View style={styles.metaRow}>
        <Text style={styles.metaTitle}>Foto {index + 1}</Text>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.textBtn} onPress={() => onReplace(index)}>
            <Text style={styles.replaceText}>Ganti</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.textBtn} onPress={() => onRemove(index)}>
            <Text style={styles.removeText}>Hapus</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function PhotoGalleryField({
  photoPaths,
  onAdd,
  onReplace,
  onRemove,
  emptyLabel = 'Tambah Foto',
  helperText,
  maxPhotos = 6,
}: Props) {
  const canAdd = photoPaths.length < maxPhotos;

  return (
    <View style={styles.wrapper}>
      <View style={styles.grid}>
        {photoPaths.map((path, index) => (
          <PhotoThumb
            key={`${path}-${index}`}
            path={path}
            index={index}
            onReplace={onReplace}
            onRemove={onRemove}
          />
        ))}
        {canAdd ? (
          <TouchableOpacity style={[styles.card, styles.addCard]} onPress={onAdd} activeOpacity={0.8}>
            <View style={styles.addIcon}>
              <Ionicons name="add" size={26} color={COLORS.primary} />
            </View>
            <Text style={styles.addTitle}>{emptyLabel}</Text>
            <Text style={styles.addHint}>
              {photoPaths.length > 0 ? 'Tambah lampiran lain untuk bukti lebih lengkap.' : 'Ambil atau upload foto pertama.'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.countText}>
        {photoPaths.length > 0 ? `${photoPaths.length} foto terlampir` : 'Belum ada foto terlampir'}
      </Text>
      {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 6,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '48%',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    backgroundColor: COLORS.surface,
    padding: 8,
    gap: 8,
  },
  frame: {
    height: 116,
    borderRadius: RADIUS - 2,
    backgroundColor: '#f0ede6',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  fallbackText: {
    fontSize: 11,
    color: COLORS.textSec,
  },
  metaRow: {
    gap: 6,
  },
  metaTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  textBtn: {
    paddingVertical: 2,
  },
  replaceText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: COLORS.primary,
  },
  removeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: COLORS.critical,
  },
  addCard: {
    minHeight: 164,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
    backgroundColor: '#f8f5ef',
  },
  addIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(178,159,134,0.18)',
    marginBottom: 8,
  },
  addTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: COLORS.primary,
    marginBottom: 4,
  },
  addHint: {
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.textSec,
    textAlign: 'center',
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSec,
  },
  helper: {
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.textSec,
  },
});
