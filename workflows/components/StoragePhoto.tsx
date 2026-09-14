import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type ImageStyle,
  type ImageResizeMode,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPE } from '../theme';
import { resolvePhotoUrl } from '../../tools/storage';

/**
 * Read-only thumbnail for a photo kept in Supabase Storage.
 *
 * Columns such as site_changes.photo_urls and defects.photo_path store bucket
 * PATHS ("site-changes/{projectId}/{ts}.jpg"), not URLs — pickAndUploadPhoto
 * returns the path it uploaded to. Feeding that raw value to <Image> renders a
 * broken image. Every value is therefore handed to resolvePhotoUrl (signed URL
 * with an in-memory cache); storage.ts owns any prefix routing (for example the
 * upcoming "site-media:<path>" private bucket), so nothing here builds a URL.
 *
 * Editable galleries keep using PhotoGalleryField / PhotoSlot; this is the
 * display-only counterpart for office/principal detail views.
 */

type Status = 'loading' | 'ready' | 'error';

interface Props {
  /** Stored Storage path, passed to resolvePhotoUrl verbatim. */
  path: string;
  /** Applied to the image and to the placeholder box, so both take the same space. */
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  loadingLabel?: string;
  errorLabel?: string;
  /** Image gets `testID`; the placeholder gets `${testID}-placeholder`. */
  testID?: string;
}

export default function StoragePhoto({
  path,
  style,
  resizeMode = 'cover',
  loadingLabel = 'Memuat foto',
  errorLabel = 'Foto tidak tersedia',
  testID,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setStatus('loading');

    resolvePhotoUrl(path)
      .then((resolved) => {
        if (!alive) return;
        setUrl(resolved);
        setStatus('ready');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });

    return () => {
      alive = false;
    };
  }, [path]);

  if (status === 'ready' && url) {
    return (
      <Image
        source={{ uri: url }}
        style={style}
        resizeMode={resizeMode}
        onError={() => setStatus('error')}
        testID={testID}
      />
    );
  }

  return (
    <View
      style={[style as StyleProp<ViewStyle>, styles.fallback]}
      testID={testID ? `${testID}-placeholder` : undefined}
    >
      <Ionicons
        name={status === 'error' ? 'alert-circle-outline' : 'image-outline'}
        size={22}
        color={COLORS.textSec}
      />
      <Text style={styles.fallbackText}>{status === 'error' ? errorLabel : loadingLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 6,
  },
  fallbackText: {
    fontSize: TYPE.xs,
    color: COLORS.textSec,
    textAlign: 'center',
  },
});
