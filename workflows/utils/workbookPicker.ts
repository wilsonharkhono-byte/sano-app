import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

function base64ToUint8Array(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function readPickedWorkbook(asset: DocumentPicker.DocumentPickerAsset): Promise<{
  arrayBuffer: ArrayBuffer;
  uploadBody: Uint8Array | File;
  mimeType: string;
}> {
  const mimeType = asset.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (Platform.OS === 'web') {
    if (asset.file && typeof asset.file.arrayBuffer === 'function') {
      const arrayBuffer = await asset.file.arrayBuffer();
      return {
        arrayBuffer,
        uploadBody: asset.file,
        mimeType,
      };
    }

    if (asset.base64) {
      const base64 = asset.base64.includes(',')
        ? asset.base64.split(',').pop() ?? ''
        : asset.base64;
      const bytes = base64ToUint8Array(base64);
      return {
        arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        uploadBody: bytes,
        mimeType,
      };
    }

    const response = await fetch(asset.uri);
    const arrayBuffer = await response.arrayBuffer();
    return {
      arrayBuffer,
      uploadBody: new Uint8Array(arrayBuffer),
      mimeType,
    };
  }

  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToUint8Array(base64);
  return {
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    uploadBody: bytes,
    mimeType,
  };
}
