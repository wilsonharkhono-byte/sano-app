/**
 * Worker Roster Tools
 *
 * CRUD for mandor_workers, worker_rates, and mandor_overtime_rules.
 * Used by estimator/admin during contract setup for harian/campuran contracts.
 */

import { supabase } from './supabase';

// ─── Types ─────────────────────────────────────────────────────────────────

export type SkillLevel = 'wakil_mandor' | 'tukang' | 'kenek' | 'operator' | 'lainnya';

export interface MandorWorker {
  id: string;
  contract_id: string;
  project_id: string;
  worker_name: string;
  skill_level: SkillLevel;
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface WorkerRate {
  id: string;
  worker_id: string;
  contract_id: string;
  daily_rate: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  set_by: string | null;
  created_at: string;
}

export interface OvertimeRules {
  id: string;
  contract_id: string;
  normal_hours: number;
  tier1_threshold_hours: number;
  tier1_hourly_rate: number;
  tier2_threshold_hours: number;
  tier2_hourly_rate: number;
  effective_from: string;
  created_by: string | null;
  created_at: string;
}

/** Per-worker overtime rule configuration (fallback to contract if not set) */
export interface WorkerOvertimeRules {
  id: string;
  worker_id: string;
  contract_id: string;
  tier1_hourly_rate: number;
  tier2_threshold_hours: number;
  tier2_hourly_rate: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  set_by: string | null;
  created_at: string;
}

/** Worker with current active rate and OT rules joined */
export interface WorkerWithRate extends MandorWorker {
  current_daily_rate: number | null;
  rate_effective_from: string | null;
  ot_tier1_rate: number | null;
  ot_tier2_rate: number | null;
  ot_tier2_threshold: number | null;
}

// ─── Worker Queries ────────────────────────────────────────────────────────

/** Get all workers for a contract */
export async function getWorkersByContract(
  contractId: string,
  activeOnly = true,
): Promise<MandorWorker[]> {
  let query = supabase
    .from('mandor_workers')
    .select('*')
    .eq('contract_id', contractId)
    .order('worker_name');

  if (activeOnly) query = query.eq('is_active', true);

  const { data } = await query;
  return data ?? [];
}

/** Get workers with their current active rate and OT rules */
export async function getWorkersWithRates(contractId: string): Promise<WorkerWithRate[]> {
  const workers = await getWorkersByContract(contractId, true);
  if (workers.length === 0) return [];

  const today = new Date().toISOString().split('T')[0];

  // Get current rates and OT rules in parallel
  const [ratesRes, otRes] = await Promise.all([
    supabase
      .from('worker_rates')
      .select('*')
      .eq('contract_id', contractId)
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gt.${today}`)
      .order('effective_from', { ascending: false }),
    supabase
      .from('worker_overtime_rules')
      .select('*')
      .eq('contract_id', contractId)
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gt.${today}`)
      .order('effective_from', { ascending: false }),
  ]);

  const rateMap = new Map<string, WorkerRate>();
  for (const rate of ratesRes.data ?? []) {
    // First match per worker (most recent effective_from) wins
    if (!rateMap.has(rate.worker_id)) {
      rateMap.set(rate.worker_id, rate);
    }
  }

  const otMap = new Map<string, WorkerOvertimeRules>();
  for (const ot of otRes.data ?? []) {
    // First match per worker (most recent effective_from) wins
    if (!otMap.has(ot.worker_id)) {
      otMap.set(ot.worker_id, ot);
    }
  }

  return workers.map((w) => {
    const rate = rateMap.get(w.id);
    const ot = otMap.get(w.id);
    return {
      ...w,
      current_daily_rate: rate?.daily_rate ?? null,
      rate_effective_from: rate?.effective_from ?? null,
      ot_tier1_rate: ot?.tier1_hourly_rate ?? null,
      ot_tier2_rate: ot?.tier2_hourly_rate ?? null,
      ot_tier2_threshold: ot?.tier2_threshold_hours ?? null,
    };
  });
}

/** Get a single worker by ID */
export async function getWorker(workerId: string): Promise<MandorWorker | null> {
  const { data } = await supabase
    .from('mandor_workers')
    .select('*')
    .eq('id', workerId)
    .single();
  return data;
}

// ─── Worker Mutations ──────────────────────────────────────────────────────

/** Add a new worker to a contract */
export async function addWorker(params: {
  contractId: string;
  projectId: string;
  workerName: string;
  skillLevel?: SkillLevel;
  notes?: string;
}): Promise<{ data?: MandorWorker; error?: string }> {
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('mandor_workers')
    .insert({
      contract_id: params.contractId,
      project_id: params.projectId,
      worker_name: params.workerName,
      skill_level: params.skillLevel ?? 'lainnya',
      notes: params.notes ?? null,
      created_by: user?.user?.id ?? null,
    })
    .select()
    .single();
  if (error) return { error: error.message };
  return { data };
}

/** Update a worker (name, skill_level, is_active, notes) */
export async function updateWorker(
  workerId: string,
  updates: Partial<Pick<MandorWorker, 'worker_name' | 'skill_level' | 'is_active' | 'notes'>>,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('mandor_workers')
    .update(updates)
    .eq('id', workerId);
  return { error: error?.message };
}

/** Deactivate a worker (soft delete) */
export async function deactivateWorker(workerId: string): Promise<{ error?: string }> {
  return updateWorker(workerId, { is_active: false });
}

// ─── Rate Queries ──────────────────────────────────────────────────────────

/** Get rate history for a worker */
export async function getWorkerRateHistory(workerId: string): Promise<WorkerRate[]> {
  const { data } = await supabase
    .from('worker_rates')
    .select('*')
    .eq('worker_id', workerId)
    .order('effective_from', { ascending: false });
  return data ?? [];
}

/** Get all active rates for a contract (one per worker) */
export async function getActiveRates(contractId: string): Promise<WorkerRate[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('worker_rates')
    .select('*')
    .eq('contract_id', contractId)
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gt.${today}`)
    .order('effective_from', { ascending: false });
  return data ?? [];
}

// ─── Rate Mutations ────────────────────────────────────────────────────────

/** Set a new rate for a worker, closing any existing active rate */
export async function setWorkerRate(params: {
  workerId: string;
  contractId: string;
  dailyRate: number;
  effectiveFrom?: string;
  notes?: string;
}): Promise<{ data?: WorkerRate; error?: string }> {
  const { data: user } = await supabase.auth.getUser();
  const effectiveFrom = params.effectiveFrom ?? new Date().toISOString().split('T')[0];

  // Close any existing active rate
  const { data: existingRates } = await supabase
    .from('worker_rates')
    .select('id, effective_from')
    .eq('worker_id', params.workerId)
    .is('effective_to', null)
    .order('effective_from', { ascending: false })
    .limit(1);

  if (existingRates && existingRates.length > 0) {
    const existing = existingRates[0];
    // Only close if new rate starts on or after existing
    if (effectiveFrom >= existing.effective_from) {
      await supabase
        .from('worker_rates')
        .update({ effective_to: effectiveFrom })
        .eq('id', existing.id);
    }
  }

  // Insert new rate
  const { data, error } = await supabase
    .from('worker_rates')
    .insert({
      worker_id: params.workerId,
      contract_id: params.contractId,
      daily_rate: params.dailyRate,
      effective_from: effectiveFrom,
      notes: params.notes ?? null,
      set_by: user?.user?.id ?? null,
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { data };
}

// ─── Overtime Rules Queries ────────────────────────────────────────────────

/** Get overtime rules for a contract */
export async function getOvertimeRules(contractId: string): Promise<OvertimeRules[]> {
  const { data } = await supabase
    .from('mandor_overtime_rules')
    .select('*')
    .eq('contract_id', contractId)
    .order('effective_from', { ascending: false });
  return data ?? [];
}

/** Get current active overtime rules for a contract */
export async function getCurrentOvertimeRules(
  contractId: string,
): Promise<OvertimeRules | null> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('mandor_overtime_rules')
    .select('*')
    .eq('contract_id', contractId)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .limit(1)
    .single();
  return data;
}

// ─── Overtime Rules Mutations ──────────────────────────────────────────────

/** Set overtime rules for a contract */
export async function setOvertimeRules(params: {
  contractId: string;
  normalHours?: number;
  tier1ThresholdHours?: number;
  tier1HourlyRate: number;
  tier2ThresholdHours?: number;
  tier2HourlyRate: number;
  effectiveFrom?: string;
}): Promise<{ data?: OvertimeRules; error?: string }> {
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('mandor_overtime_rules')
    .insert({
      contract_id: params.contractId,
      normal_hours: params.normalHours ?? 7,
      tier1_threshold_hours: params.tier1ThresholdHours ?? 7,
      tier1_hourly_rate: params.tier1HourlyRate,
      tier2_threshold_hours: params.tier2ThresholdHours ?? 10,
      tier2_hourly_rate: params.tier2HourlyRate,
      effective_from: params.effectiveFrom ?? new Date().toISOString().split('T')[0],
      created_by: user?.user?.id ?? null,
    })
    .select()
    .single();
  if (error) return { error: error.message };
  return { data };
}

/** Update existing overtime rules */
export async function updateOvertimeRules(
  rulesId: string,
  updates: Partial<Pick<OvertimeRules,
    'normal_hours' | 'tier1_threshold_hours' | 'tier1_hourly_rate' |
    'tier2_threshold_hours' | 'tier2_hourly_rate'
  >>,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('mandor_overtime_rules')
    .update(updates)
    .eq('id', rulesId);
  return { error: error?.message };
}

// ─── Per-Worker Overtime Rules ──────────────────────────────────────────────

/** Get per-worker overtime rules history */
export async function getWorkerOvertimeRulesHistory(workerId: string): Promise<WorkerOvertimeRules[]> {
  const { data } = await supabase
    .from('worker_overtime_rules')
    .select('*')
    .eq('worker_id', workerId)
    .order('effective_from', { ascending: false });
  return data ?? [];
}

/** Set new per-worker overtime rules, closing the current active rule */
export async function setWorkerOvertimeRules(params: {
  workerId: string;
  contractId: string;
  tier1HourlyRate: number;
  tier2HourlyRate: number;
  tier2ThresholdHours?: number;
  effectiveFrom?: string;
  notes?: string;
}): Promise<{ data?: WorkerOvertimeRules; error?: string }> {
  const { data: user } = await supabase.auth.getUser();
  const effectiveFrom = params.effectiveFrom ?? new Date().toISOString().split('T')[0];

  // Close the current active rule (if exists)
  const { error: closeError } = await supabase
    .from('worker_overtime_rules')
    .update({ effective_to: effectiveFrom })
    .eq('worker_id', params.workerId)
    .is('effective_to', null)
    .lte('effective_from', effectiveFrom);

  if (closeError) return { error: closeError.message };

  // Insert new rule
  const { data, error } = await supabase
    .from('worker_overtime_rules')
    .insert({
      worker_id: params.workerId,
      contract_id: params.contractId,
      tier1_hourly_rate: params.tier1HourlyRate,
      tier2_hourly_rate: params.tier2HourlyRate,
      tier2_threshold_hours: params.tier2ThresholdHours ?? 10,
      effective_from: effectiveFrom,
      notes: params.notes ?? null,
      set_by: user?.user?.id ?? null,
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { data };
}

/** Clear per-worker OT rules, reverting to contract-level fallback */
export async function clearWorkerOvertimeRules(workerId: string): Promise<{ error?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('worker_overtime_rules')
    .update({ effective_to: today })
    .eq('worker_id', workerId)
    .is('effective_to', null);
  return { error: error?.message };
}

// ─── Formatting ────────────────────────────────────────────────────────────

const SKILL_LABELS: Record<SkillLevel, string> = {
  wakil_mandor: 'Wakil Mandor',
  tukang: 'Tukang',
  kenek: 'Kenek',
  operator: 'Operator',
  lainnya: 'Lainnya',
};

export function skillLevelLabel(level: SkillLevel): string {
  return SKILL_LABELS[level] ?? level;
}

export function formatRate(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`;
}
