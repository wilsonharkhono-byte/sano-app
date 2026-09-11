// SANO - Gate reference data (spec §2 decision 3, §4.1).
//
// gate_refs mirrors DATUM's gate_code enum A..H and gate_step_refs mirrors its
// trade_steps. Labels, descriptions, order and the active flag are editable
// from "Kelola gerbang"; codes are not, and cannot be deleted - migration 096
// enforces both with a trigger, and these wrappers refuse earlier so the user
// gets an Indonesian sentence instead of a Postgres exception.
//
// Under RLS a filtered UPDATE is not an error: PostgREST matches zero rows and
// Supabase reports error null. updateGateRef and updateGateStepRef therefore
// select the row back and treat a null row as the refusal it is, rather than
// reporting a success that did not happen (CLAUDE.md §12; same idiom as
// setProjectPhase, Task 7 of this plan).

import { supabase } from './supabase';
import type { GateRef, GateStepRef } from './types';

const GATE_COLUMNS = 'code, name_id, short_label, description, sort_order, active, datum_gate_code';
const STEP_COLUMNS = 'code, gate_code, name_id, description, sort_order, active, datum_step_code';

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

function refuseCodeChange(patch: object): void {
  if (Object.prototype.hasOwnProperty.call(patch, 'code')) {
    throw new Error('Kode gerbang tidak boleh diubah - kode adalah kunci referensi kejadian lapangan.');
  }
}

const GATE_UPDATE_REFUSED = 'Perubahan gerbang tidak tersimpan. Hanya peran kantor yang dapat mengubah data gerbang.';

export async function updateGateRef(code: string, patch: GateRefPatch): Promise<{ error?: string }> {
  refuseCodeChange(patch);
  const { data, error } = await supabase.from('gate_refs').update(patch).eq('code', code).select('code').maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: GATE_UPDATE_REFUSED };
  return {};
}

export async function createGateStepRef(input: {
  code: string; gate_code: string; name_id: string;
  description?: string | null; sort_order?: number;
}): Promise<{ step?: GateStepRef; error?: string }> {
  const code = input.code.trim().toUpperCase();
  if (!code) return { error: 'Kode langkah wajib diisi.' };
  if (!input.name_id.trim()) return { error: 'Nama langkah wajib diisi.' };

  const { data, error } = await supabase.from('gate_step_refs').insert({
    code,
    gate_code: input.gate_code,
    name_id: input.name_id.trim(),
    description: input.description ?? null,
    sort_order: input.sort_order ?? 0,
  }).select(STEP_COLUMNS).single();

  if (error?.code === '23505') return { error: `Kode langkah "${code}" sudah dipakai.` };
  if (error) return { error: error.message };
  return { step: data as GateStepRef };
}

export async function updateGateStepRef(code: string, patch: GateStepRefPatch): Promise<{ error?: string }> {
  refuseCodeChange(patch);
  const { data, error } = await supabase.from('gate_step_refs').update(patch).eq('code', code).select('code').maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: GATE_UPDATE_REFUSED };
  return {};
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
