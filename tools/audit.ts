// SAN Contractor — Audit & Hardening Layer
// Centralizes audit event logging, override tracking, and anomaly detection.
// Every significant action writes here for compliance and post-mortem analysis.

import { supabase } from './supabase';
import type { FlagLevel } from './types';
import { AuditCaseStatus, DefectSeverity, DefectStatus, POStatus } from './constants';

// ── Audit Event Types ────────────────────────────────────────────────

export type AuditEventType =
  // Gate events
  | 'gate1_auto_hold'
  | 'gate1_warning_submitted'
  | 'gate2_price_escalation'
  | 'gate2_override'
  | 'gate2_qty_breach'
  | 'gate3_quantity_over_po'
  | 'gate3_accumulation_breach'
  | 'gate4_progress_over_planned'
  | 'gate5_report_generated'
  // Lifecycle
  | 'defect_lifecycle_transition'
  | 'milestone_revised'
  | 'baseline_published'
  | 'import_session_created'
  // Auth / access
  | 'role_action_denied'
  | 'project_switched'
  // Approval
  | 'approval_override'
  | 'approval_rejected'
  // MTN
  | 'mtn_submitted'
  // Scoring
  | 'score_computed';

export interface AuditEvent {
  project_id: string;
  user_id: string;
  event_type: AuditEventType;
  entity_type: string;
  entity_id: string;
  severity: FlagLevel;
  description: string;
  metadata?: object;
}

// ── Write Audit Event ────────────────────────────────────────────────

export interface AuditWriteResult {
  ok: boolean;
  error?: string;
}

export async function writeAuditEvent(event: AuditEvent): Promise<AuditWriteResult> {
  try {
    const { error: anomalyError } = await supabase.from('anomaly_events').insert({
      project_id: event.project_id,
      user_id: event.user_id,
      event_type: event.event_type,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      severity: event.severity,
      description: event.description,
      metadata: event.metadata ?? null,
      created_at: new Date().toISOString(),
    });

    if (anomalyError) {
      // Audit trail must not drop events silently. Surface, but don't throw —
      // audit must not block main flow; the caller inspects the result instead.
      console.error(
        `Audit write failed (anomaly_events, event_type=${event.event_type}, entity_id=${event.entity_id}):`,
        anomalyError.message,
      );
      return { ok: false, error: anomalyError.message };
    }

    // Also log to activity_log for in-app visibility
    if (event.severity === 'HIGH' || event.severity === 'CRITICAL') {
      const { error: activityError } = await supabase.from('activity_log').insert({
        project_id: event.project_id,
        user_id: event.user_id,
        type: 'permintaan', // closest available type
        label: `[AUDIT] ${event.event_type}: ${event.description.slice(0, 80)}`,
        flag: event.severity,
      });

      if (activityError) {
        console.error(
          `Audit write failed (activity_log, event_type=${event.event_type}, entity_id=${event.entity_id}):`,
          activityError.message,
        );
        return { ok: false, error: activityError.message };
      }
    }

    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Audit write failed:', message);
    // Never throw — audit must not block main flow; report via result instead.
    return { ok: false, error: message };
  }
}

// ── Critical-gate audit wiring (Task 3.4) ────────────────────────────
// Thin, non-fatal wrappers the gate screens call so a CRITICAL gate outcome
// lands in anomaly_events (which powers the audit_list report + the Beranda
// "Kasus Audit Terbuka" surface). Every path here is best-effort: a failed
// audit write is logged and swallowed, NEVER thrown, so the business flow
// (submit request / create PO / receive) is never blocked by audit trouble.

/**
 * Emit a CRITICAL-severity gate audit event, but ONLY when `observedFlag` is
 * 'CRITICAL'. Any other flag (OK/INFO/WARNING/HIGH/null) is a no-op. Fully
 * non-fatal: never throws; failures are console.warn'd and returned as
 * { ok:false }. This is the single testable seam behind the three gate wirings.
 */
export async function auditCriticalGateEvent(
  observedFlag: FlagLevel | string | null | undefined,
  event: Omit<AuditEvent, 'severity'>,
): Promise<AuditWriteResult> {
  if (observedFlag !== 'CRITICAL') return { ok: true };
  try {
    const result = await writeAuditEvent({ ...event, severity: 'CRITICAL' });
    if (!result.ok) {
      console.warn(`Critical gate audit failed (${event.event_type}):`, result.error);
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Critical gate audit threw (${event.event_type}):`, message);
    return { ok: false, error: message };
  }
}

/**
 * Request-time (Gate 1) wiring: after a transactional submit_material_request
 * (073) returns the header id, read the SERVER-computed overall_flag (033
 * triggers set it; the RPC returns only the id) and, if it landed CRITICAL
 * (a Tier-1 envelope breach → AUTO_HOLD, see migration 056), record an audit
 * event. Cheap (one indexed select) and non-fatal — any failure is swallowed.
 */
export async function auditRequestSubmitIfCritical(params: {
  projectId: string;
  userId: string;
  requestHeaderId: string;
  summary?: string;
}): Promise<AuditWriteResult> {
  try {
    const { data, error } = await supabase
      .from('material_request_headers')
      .select('overall_flag')
      .eq('id', params.requestHeaderId)
      .single();
    if (error) {
      console.warn('auditRequestSubmitIfCritical flag read failed:', error.message);
      return { ok: false, error: error.message };
    }
    return await auditCriticalGateEvent(data?.overall_flag, {
      project_id: params.projectId,
      user_id: params.userId,
      event_type: 'gate1_auto_hold',
      entity_type: 'material_request',
      entity_id: params.requestHeaderId,
      description: `Permintaan material CRITICAL (AUTO_HOLD)${params.summary ? `: ${params.summary}` : ''}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('auditRequestSubmitIfCritical threw:', message);
    return { ok: false, error: message };
  }
}

// ── Override Log ─────────────────────────────────────────────────────
// Records when a user overrides a gate flag with justification.

export interface OverrideRecord {
  project_id: string;
  user_id: string;
  gate: '1' | '2' | '3' | '4' | '5';
  entity_type: string;
  entity_id: string;
  original_flag: FlagLevel;
  override_reason: string;
}

export async function logOverride(record: OverrideRecord): Promise<AuditWriteResult> {
  return writeAuditEvent({
    project_id: record.project_id,
    user_id: record.user_id,
    event_type: record.gate === '2' ? 'gate2_override' : 'approval_override',
    entity_type: record.entity_type,
    entity_id: record.entity_id,
    severity: 'HIGH',
    description: `Gate ${record.gate} override (was ${record.original_flag}): ${record.override_reason}`,
  });
}

// ── Open Audit Cases ──────────────────────────────────────────────────
// Creates a case record for anomalies that require follow-up.

export async function openAuditCase(
  projectId: string,
  triggerType: string,
  entityType: string,
  entityId: string,
  notes: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from('audit_cases')
    .select('id')
    .eq('project_id', projectId)
    .eq('entity_id', entityId)
    .eq('status', AuditCaseStatus.OPEN)
    .single();

  if (existing) return; // already open case for this entity

  const { error } = await supabase.from('audit_cases').insert({
    project_id: projectId,
    trigger_type: triggerType,
    entity_type: entityType,
    entity_id: entityId,
    status: AuditCaseStatus.OPEN,
    notes,
    created_at: new Date().toISOString(),
  });

  if (error) {
    // Audit cases are part of the compliance trail — do not drop silently.
    console.error(
      `Audit case write failed (audit_cases, trigger_type=${triggerType}, entity_id=${entityId}):`,
      error.message,
    );
    throw new Error(`Failed to open audit case for ${entityType} ${entityId}: ${error.message}`);
  }
}

// ── Anomaly Detection ─────────────────────────────────────────────────
// Scans recent activity for patterns that warrant review.

interface AnomalyCheck {
  type: string;
  found: boolean;
  description: string;
  entityId: string;
  severity: FlagLevel;
}

export async function detectAnomalies(projectId: string): Promise<AnomalyCheck[]> {
  const anomalies: AnomalyCheck[] = [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

  // 1. Multiple CRITICAL flags in 24 hours
  const { data: criticalActivity } = await supabase
    .from('activity_log')
    .select('id, flag')
    .eq('project_id', projectId)
    .eq('flag', 'CRITICAL')
    .gte('created_at', new Date(now.getTime() - 86400000).toISOString());

  if ((criticalActivity ?? []).length >= 3) {
    anomalies.push({
      type: 'critical_spike',
      found: true,
      description: `${criticalActivity!.length} CRITICAL flags dalam 24 jam terakhir`,
      entityId: projectId,
      severity: 'HIGH',
    });
  }

  // 2. Defects stuck in OPEN > 14 days
  const { data: stuckDefects } = await supabase
    .from('defects')
    .select('id, reported_at, severity')
    .eq('project_id', projectId)
    .eq('status', DefectStatus.OPEN)
    .lte('reported_at', new Date(now.getTime() - 14 * 86400000).toISOString());

  for (const d of stuckDefects ?? []) {
    if (d.severity === DefectSeverity.CRITICAL || d.severity === DefectSeverity.MAJOR) {
      anomalies.push({
        type: 'defect_stuck',
        found: true,
        description: `${d.severity} defect belum divalidasi > 14 hari`,
        entityId: d.id,
        severity: d.severity === DefectSeverity.CRITICAL ? 'CRITICAL' : 'HIGH',
      });
    }
  }

  // 3. POs with no receipt activity in 7 days but status OPEN
  // Single query instead of N+1: fetch stale POs, then batch-check receipts.
  const { data: stalePOs } = await supabase
    .from('purchase_orders')
    .select('id, po_number, material_name, ordered_date')
    .eq('project_id', projectId)
    .eq('status', POStatus.OPEN)
    .lte('ordered_date', sevenDaysAgo);

  if ((stalePOs ?? []).length > 0) {
    const stalePOIds = (stalePOs ?? []).map(po => po.id);

    // Single query: get distinct po_ids that DO have receipts
    const { data: posWithReceipts } = await supabase
      .from('receipts')
      .select('po_id')
      .in('po_id', stalePOIds);

    const posWithReceiptSet = new Set((posWithReceipts ?? []).map((r) => r.po_id));

    for (const po of stalePOs ?? []) {
      if (!posWithReceiptSet.has(po.id)) {
        anomalies.push({
          type: 'po_no_receipt',
          found: true,
          description: `${po.po_number ?? 'PO'} "${po.material_name}" belum ada penerimaan setelah ${Math.round((now.getTime() - new Date(po.ordered_date).getTime()) / 86400000)} hari`,
          entityId: po.id,
          severity: 'WARNING',
        });
      }
    }
  }

  // 4. No progress entries in 7 days (active project)
  const { count: recentProgress } = await supabase
    .from('progress_entries')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .gte('created_at', sevenDaysAgo);

  if ((recentProgress ?? 0) === 0) {
    anomalies.push({
      type: 'no_progress',
      found: true,
      description: 'Tidak ada entri progres dalam 7 hari terakhir',
      entityId: projectId,
      severity: 'WARNING',
    });
  }

  return anomalies;
}

// ── Open Audit Cases Summary ─────────────────────────────────────────

export async function getOpenAuditCases(projectId: string) {
  const { data } = await supabase
    .from('audit_cases')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', AuditCaseStatus.OPEN)
    .order('created_at', { ascending: false });

  return data ?? [];
}

// ── Recent Critical Anomalies (Beranda tile) ─────────────────────────
// The Beranda audit tile used to read audit_cases (written only by the still-
// uncalled openAuditCase → permanently 0). The critical-gate wiring (3.4)
// populates anomaly_events instead, so the tile now reads from there.
//
// anomaly_events has NO status/resolution column (see migration 002: id,
// project_id, event_type, entity_type, entity_id, severity, description,
// created_at). "Unresolved/open" is therefore not expressible, so we use a
// recency window instead: CRITICAL-severity events in the last 7 days, over
// the indexed (project_id, created_at DESC) path.
const CRITICAL_ANOMALY_WINDOW_DAYS = 7;

export async function getRecentCriticalAnomalies(projectId: string) {
  const since = new Date(
    Date.now() - CRITICAL_ANOMALY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data } = await supabase
    .from('anomaly_events')
    .select('*')
    .eq('project_id', projectId)
    .eq('severity', 'CRITICAL')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  return data ?? [];
}
