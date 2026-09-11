// SANO - Gate reference data (spec §2 decision 3, §4.1).
//
// gate_refs mirrors DATUM's gate_code enum A..H and gate_step_refs mirrors its
// trade_steps. Labels, descriptions, order and the active flag are editable
// from "Kelola gerbang"; codes are not, and cannot be deleted - migration 096
// enforces both with a trigger, and these wrappers refuse earlier so the user
// gets an Indonesian sentence instead of a Postgres exception.
//
// Under RLS a filtered UPDATE is not an error: PostgREST matches zero rows and
// Supabase reports error null. updateGateRef and updateGateStepRef report
// this via the shared tools/readBackUpdate.ts helper (CLAUDE.md §12).

import { supabase } from './supabase';
import { readBackUpdate } from './readBackUpdate';
import type { GateRef, GateStepRef } from './types';

// One string literal each, exported so gateRefs.test.ts can assert every
// GateRef/GateStepRef field is listed - see the comment on ROOM_COLUMNS in
// tools/rooms.ts for why it must stay a literal (a concatenated string
// defeats supabase-js's row typing and every `as GateRef`/`as GateStepRef`
// cast below then fails tsc with TS2352).
export const GATE_COLUMNS =
  'code, name_id, short_label, description, sort_order, active, datum_gate_code, created_at';
export const STEP_COLUMNS =
  'code, gate_code, name_id, description, sort_order, active, datum_step_code, created_at';

export async function listGateRefs(opts: { activeOnly?: boolean } = {}): Promise<GateRef[]> {
  let q = supabase.from('gate_refs').select(GATE_COLUMNS).order('sort_order', { ascending: true });
  if (opts.activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) { console.warn('listGateRefs failed:', error.message); return []; }
  return (data ?? []) as GateRef[];
}

export async function listGateStepRefs(opts: { activeOnly?: boolean } = {}): Promise<GateStepRef[]> {
  let q = supabase.from('gate_step_refs').select(STEP_COLUMNS)
    .order('gate_code', { ascending: true }).order('sort_order', { ascending: true });
  if (opts.activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) { console.warn('listGateStepRefs failed:', error.message); return []; }
  return (data ?? []) as GateStepRef[];
}

export type GateRefPatch = Partial<Pick<GateRef, 'name_id' | 'short_label' | 'description' | 'sort_order' | 'active'>>;
export type GateStepRefPatch = Partial<Pick<GateStepRef, 'name_id' | 'description' | 'sort_order' | 'active'>>;

/**
 * Throws synchronously, before any request, when `patch` carries any of
 * `keys` as an own property, naming the offending key - `code` and
 * `gate_code` are foreign keys release 2's site_events will reference, so
 * like updateRoom's room_code guard (tools/rooms.ts), this is an invariant
 * violation in the caller's code, not a runtime error to catch and display.
 */
function refuseImmutableKeys(patch: object, keys: string[]): void {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      throw new Error(`Kode "${key}" tidak boleh diubah - kode adalah kunci referensi kejadian lapangan.`);
    }
  }
}

const GATE_UPDATE_REFUSED = 'Perubahan gerbang tidak tersimpan. Hanya peran kantor yang dapat mengubah data gerbang.';

/**
 * Throws synchronously (a rejected promise, since this function is async),
 * before any request, if `patch` contains `code` - that is an invariant
 * violation in the caller's code (see the header), not a runtime error to
 * catch and display.
 */
export async function updateGateRef(code: string, patch: GateRefPatch): Promise<{ gate?: GateRef; error?: string }> {
  refuseImmutableKeys(patch, ['code']);
  const { data, error } = await readBackUpdate<GateRef>('gate_refs', patch, 'code', code, GATE_COLUMNS, GATE_UPDATE_REFUSED);
  if (error) return { error };
  return { gate: data };
}

export async function createGateStepRef(input: {
  code: string; gate_code: string; name_id: string;
  description?: string | null; sort_order?: number;
}): Promise<{ step?: GateStepRef; error?: string }> {
  const code = input.code.trim().toUpperCase();
  if (!code) return { error: 'Kode langkah wajib diisi.' };
  // Not validated against a fixed A-H pattern: gates are editable reference
  // data (see the header) and more may be added, so any non-blank code is
  // sent to the database - the 23503 branch below turns an unknown one into
  // a friendly message once Postgres has actually checked it.
  const gate_code = input.gate_code.trim();
  if (!gate_code) return { error: 'Kode gerbang induk wajib diisi.' };
  if (!input.name_id.trim()) return { error: 'Nama langkah wajib diisi.' };

  const { data, error } = await supabase.from('gate_step_refs').insert({
    code,
    gate_code,
    name_id: input.name_id.trim(),
    description: input.description ?? null,
    sort_order: input.sort_order ?? 0,
  }).select(STEP_COLUMNS).single();

  if (error?.code === '23505') return { error: `Kode langkah "${code}" sudah dipakai.` };
  if (error?.code === '23503') return { error: `Gerbang "${gate_code}" tidak ditemukan.` };
  if (error) return { error: error.message };
  return { step: data as GateStepRef };
}

/**
 * Throws synchronously (a rejected promise, since this function is async),
 * before any request, if `patch` contains `code` or `gate_code` - that is an
 * invariant violation in the caller's code (see the header), not a runtime
 * error to catch and display.
 */
export async function updateGateStepRef(code: string, patch: GateStepRefPatch): Promise<{ step?: GateStepRef; error?: string }> {
  refuseImmutableKeys(patch, ['code', 'gate_code']);
  const { data, error } = await readBackUpdate<GateStepRef>('gate_step_refs', patch, 'code', code, STEP_COLUMNS, GATE_UPDATE_REFUSED);
  if (error) return { error };
  return { step: data };
}

// ─── Pure: chip labels ───────────────────────────────────────────────────────

/** "B · Basah" - the chip a supervisor taps and the report prints. */
export function gateChipLabel(gate: GateRef): string {
  return `${gate.code} · ${gate.short_label}`;
}

/** "B · B4 Waterproofing". */
export function stepChipLabel(step: GateStepRef, gate?: GateRef): string {
  return `${gate?.code ?? step.gate_code} · ${step.code} ${step.name_id}`;
}
