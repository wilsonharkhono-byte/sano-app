// SANO — Equipment Asset Pool (scaffolding & parts)
//
// Company-owned equipment (material_catalog.is_asset = true) circulates
// project → project instead of being consumed. This module is the single
// source of the derived pool state, folding the append-only equipment_ledger
// into balances — the same events → derived-totals philosophy as derivation.ts.
// Nothing here is stored; the truth is always recomputable from the ledger.
//
// Locations: a single company Yard is project_id NULL. The yard has two
// buckets: READY (deployable) and REPAIR (returned damaged, awaiting fix).
//
// Dispositions ("Hilang", "Rusak — bisa perbaikan", …) are DATA rows the user
// can extend; only their ledger_effect is fixed vocabulary:
//   RETURN_OK   → back to yard-ready
//   RETURN_HOLD → back to yard-repair (not deployable)
//   WRITE_OFF   → leaves the owned pool entirely
//
// See docs/superpowers/specs/2026-07-16-equipment-asset-tracking-design.md.

import { supabase } from './supabase';
import { fetchAllPaged } from './queryHelpers';

export type EquipmentEventType =
  | 'OPENING'
  | 'DEPLOY'
  | 'TRANSFER'
  | 'RETURN'
  | 'WRITE_OFF'
  | 'REPAIRED';

export type LedgerEffect = 'RETURN_OK' | 'RETURN_HOLD' | 'WRITE_OFF';

export interface EquipmentDisposition {
  id: string;
  name: string;
  ledger_effect: LedgerEffect;
}

export interface EquipmentLedgerEvent {
  material_id: string;
  event_type: EquipmentEventType;
  /** NULL = the Yard. */
  from_project_id: string | null;
  /** NULL = the Yard. */
  to_project_id: string | null;
  qty: number;
  disposition_id?: string | null;
  /** Which yard bucket a yard-side WRITE_OFF debits. */
  yard_bucket?: 'READY' | 'REPAIR' | null;
}

export interface EquipmentBalance {
  owned: number;
  yard_ready: number;
  yard_repair: number;
  /** project_id → quantity currently deployed there. */
  deployed: Record<string, number>;
  /** disposition name → cumulative quantity written off. */
  written_off: Record<string, number>;
}

const emptyBalance = (): EquipmentBalance => ({
  owned: 0,
  yard_ready: 0,
  yard_repair: 0,
  deployed: {},
  written_off: {},
});

/**
 * Fold ledger events into per-material balances. Pure — throws on events that
 * reference an unknown disposition rather than guessing (truth contract).
 */
export function computeEquipmentBalances(
  events: EquipmentLedgerEvent[],
  dispositions: EquipmentDisposition[],
): Map<string, EquipmentBalance> {
  const dispositionById = new Map(dispositions.map((d) => [d.id, d]));
  const balances = new Map<string, EquipmentBalance>();

  const requireDisposition = (e: EquipmentLedgerEvent): EquipmentDisposition => {
    const d = e.disposition_id ? dispositionById.get(e.disposition_id) : undefined;
    if (!d) {
      throw new Error(
        `equipment_ledger ${e.event_type} for ${e.material_id} references unknown disposition "${e.disposition_id ?? '(none)'}"`,
      );
    }
    return d;
  };

  const bumpDeployed = (b: EquipmentBalance, projectId: string, delta: number) => {
    b.deployed[projectId] = (b.deployed[projectId] ?? 0) + delta;
    // Epsilon, not === 0: fractional quantities leave IEEE residue (0.1 + 0.2
    // − 0.3 ≈ 5.5e-17) which would keep a phantom "deployed" row alive.
    if (Math.abs(b.deployed[projectId]) < 1e-9) delete b.deployed[projectId];
  };

  for (const e of events) {
    let b = balances.get(e.material_id);
    if (!b) {
      b = emptyBalance();
      balances.set(e.material_id, b);
    }
    const qty = Number(e.qty ?? 0);

    switch (e.event_type) {
      case 'OPENING':
        b.owned += qty;
        b.yard_ready += qty;
        break;
      case 'DEPLOY':
        b.yard_ready -= qty;
        bumpDeployed(b, e.to_project_id as string, qty);
        break;
      case 'TRANSFER':
        bumpDeployed(b, e.from_project_id as string, -qty);
        bumpDeployed(b, e.to_project_id as string, qty);
        break;
      case 'RETURN': {
        const d = requireDisposition(e);
        bumpDeployed(b, e.from_project_id as string, -qty);
        if (d.ledger_effect === 'RETURN_HOLD') b.yard_repair += qty;
        else b.yard_ready += qty;
        break;
      }
      case 'WRITE_OFF': {
        const d = requireDisposition(e);
        if (e.from_project_id) {
          bumpDeployed(b, e.from_project_id, -qty);
        } else if (e.yard_bucket === 'READY') {
          b.yard_ready -= qty;
        } else {
          b.yard_repair -= qty;
        }
        b.owned -= qty;
        b.written_off[d.name] = (b.written_off[d.name] ?? 0) + qty;
        break;
      }
      case 'REPAIRED':
        b.yard_repair -= qty;
        b.yard_ready += qty;
        break;
    }
  }

  return balances;
}

// ── Availability gate (client side; the DB trigger is the server twin) ──────

export interface EquipmentAvailability {
  flag: 'OK' | 'SHORTAGE';
  requested: number;
  available: number;
  shortfall: number;
}

/** Can the yard cover a deploy of `requestedQty`? Missing balance = nothing available. */
export function evaluateEquipmentAvailability(
  balance: Pick<EquipmentBalance, 'yard_ready'> | undefined,
  requestedQty: number,
): EquipmentAvailability {
  const available = balance?.yard_ready ?? 0;
  const shortfall = Math.max(0, requestedQty - available);
  return {
    flag: shortfall > 0 ? 'SHORTAGE' : 'OK',
    requested: requestedQty,
    available,
    shortfall,
  };
}

// ── Count-&-close reconciliation ─────────────────────────────────────────────

export interface ReconciliationLine {
  qty: number;
  disposition_id: string;
}

/**
 * Every hand-over must account for the FULL expected quantity across its
 * disposition lines — nothing silently disappears. Small float tolerance only.
 */
export function validateReconciliation(
  expectedQty: number,
  lines: ReconciliationLine[],
): { ok: true } | { ok: false; error: string } {
  for (const line of lines) {
    if (!(Number(line.qty) > 0)) {
      return { ok: false, error: `Semua baris harus punya qty > 0 (dapat ${line.qty})` };
    }
  }
  const total = lines.reduce((s, l) => s + Number(l.qty), 0);
  if (Math.abs(total - expectedQty) > 1e-9) {
    return {
      ok: false,
      error: `Total baris (${total}) harus sama dengan jumlah tercatat (${expectedQty}) — semua unit wajib dipertanggungjawabkan`,
    };
  }
  return { ok: true };
}

// ── DB access (thin wrappers; logic stays in the pure functions above) ──────

export interface EquipmentBalanceRow extends EquipmentBalance {
  material_id: string;
  material_name: string;
  unit: string;
}

/** Active dispositions, sorted for pickers. */
export async function fetchDispositions(): Promise<EquipmentDisposition[]> {
  const { data, error } = await supabase
    .from('equipment_dispositions')
    .select('id, name, ledger_effect, active, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Gagal memuat disposisi: ${error.message}`);
  return (data ?? []) as EquipmentDisposition[];
}

/**
 * Derive the company-wide pool: fold the full ledger (paged past the 1000-row
 * cap). Pass pre-fetched dispositions to avoid a duplicate query when the
 * caller already loaded them for its pickers.
 */
export async function deriveEquipmentBalances(
  knownDispositions?: EquipmentDisposition[],
): Promise<EquipmentBalanceRow[]> {
  const [dispositions, events, { data: assets, error: assetsError }] = await Promise.all([
    knownDispositions ? Promise.resolve(knownDispositions) : fetchDispositions(),
    fetchAllPaged<EquipmentLedgerEvent & { id: string }>((from, to) =>
      supabase
        .from('equipment_ledger')
        .select('id, material_id, event_type, from_project_id, to_project_id, qty, disposition_id, yard_bucket')
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: never[] | null; error: { message?: string } | null }>),
    supabase.from('material_catalog').select('id, name, unit').eq('is_asset', true),
  ]);
  if (assetsError) throw new Error(`Gagal memuat katalog alat: ${assetsError.message}`);

  const balances = computeEquipmentBalances(events, dispositions);
  // Every asset part appears, even with an empty ledger — an unseeded part
  // showing owned 0 is honest and prompts the OPENING count.
  return (assets ?? []).map((a) => ({
    material_id: a.id,
    material_name: a.name,
    unit: a.unit,
    ...(balances.get(a.id) ?? emptyBalance()),
  }));
}

export interface EquipmentMovementInput {
  material_id: string;
  event_type: EquipmentEventType;
  from_project_id?: string | null;
  to_project_id?: string | null;
  qty: number;
  disposition_id?: string | null;
  yard_bucket?: 'READY' | 'REPAIR' | null;
  reconciliation_group?: string | null;
  note?: string | null;
  photo_path?: string | null;
  moved_by?: string | null;
}

/**
 * Append movements. A count-&-close submits ALL its disposition lines in one
 * call — a single INSERT statement, so the batch lands atomically (a rejected
 * line aborts the whole hand-over; no half-recorded reconciliation). The DB
 * trigger re-derives balances server-side and rejects overdraw; surface its
 * message verbatim — never mask it.
 */
export async function recordEquipmentMovements(inputs: EquipmentMovementInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const { error } = await supabase.from('equipment_ledger').insert(
    inputs.map((input) => ({
      material_id: input.material_id,
      event_type: input.event_type,
      from_project_id: input.from_project_id ?? null,
      to_project_id: input.to_project_id ?? null,
      qty: input.qty,
      disposition_id: input.disposition_id ?? null,
      yard_bucket: input.yard_bucket ?? null,
      reconciliation_group: input.reconciliation_group ?? null,
      note: input.note ?? null,
      photo_path: input.photo_path ?? null,
      moved_by: input.moved_by ?? null,
    })),
  );
  if (error) throw new Error(`Pergerakan alat ditolak: ${error.message}`);
}

/** Append one movement (see recordEquipmentMovements). */
export async function recordEquipmentMovement(input: EquipmentMovementInput): Promise<void> {
  return recordEquipmentMovements([input]);
}
