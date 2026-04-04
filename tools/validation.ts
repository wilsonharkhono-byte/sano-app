// Input validation utilities — validates at system boundaries only

export function isPositiveNumber(value: string | number): boolean {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return !isNaN(num) && num > 0;
}

export function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function sanitizeText(input: string): string {
  return input.trim().slice(0, 500);
}

export function validateMaterialRequest(fields: {
  boqId: string;
  quantity: string;
  targetDate: string;
}): string | null {
  if (!fields.boqId) return 'Pilih item BoQ';
  if (!isPositiveNumber(fields.quantity)) return 'Masukkan jumlah lebih dari 0';
  if (!fields.targetDate) return 'Pilih target pengiriman';
  return null;
}

export function validateReceipt(fields: {
  poId: string;
  quantityActual: string;
  photoCount: number;
  requiredPhotos: number;
  hasGps: boolean;
}): string | null {
  if (!fields.poId) return 'Pilih PO terlebih dahulu';
  if (!isPositiveNumber(fields.quantityActual)) return 'Masukkan jumlah yang diterima';
  if (fields.photoCount < fields.requiredPhotos) return `Ambil semua ${fields.requiredPhotos} foto yang diperlukan`;
  if (!fields.hasGps) return 'Foto kendaraan harus memiliki data GPS';
  return null;
}

export function validateProgress(fields: {
  boqId: string;
  quantity: string;
  workStatus: string | null;
  hasPhoto: boolean;
}): string | null {
  if (!fields.boqId) return 'Pilih item BoQ';
  if (!isPositiveNumber(fields.quantity)) return 'Masukkan jumlah terpasang';
  if (!fields.workStatus) return 'Pilih status pekerjaan';
  if (!fields.hasPhoto) return 'Foto progres wajib diambil';
  return null;
}

export function validateDefect(fields: {
  boqRef: string;
  location: string;
  description: string;
  severity: string | null;
  hasPhoto: boolean;
}): string | null {
  if (!fields.boqRef) return 'Pilih item BoQ';
  if (!isNonEmpty(fields.location)) return 'Masukkan lokasi spesifik';
  if (!isNonEmpty(fields.description)) return 'Masukkan deskripsi cacat';
  if (!fields.severity) return 'Pilih tingkat keparahan';
  if (!fields.hasPhoto) return 'Foto bukti wajib diambil';
  return null;
}
