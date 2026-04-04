// SAN Contractor — Audit & Hardening Layer
// Centralizes audit event logging, override tracking, and anomaly detection.
// Every significant action writes here for compliance and post-mortem analysis.

import { supabase } from './supabase';
import type { FlagLevel } from './types';

// ── Audit Event Types ────────────────────────────────────────────────

export type AuditEventType =
  // Gate events
  | 'gate1_auto_hold'
  | 'gate1_warning_submitted'
  | 'gate2_price_escalation'
  | 'gate2_override'
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

export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await supabase.from('anomaly_events').insert({
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

    // Also log to activity_log for in-app visibility
    if (event.severity === 'HIGH' || event.severity === 'CRITICAL') {
      await supabase.from('activity_log').insert({
        project_id: event.project_id,
        user_id: event.user_id,
        type: 'permintaan', // closest available type
        label: `[AUDIT] ${event.event_type}: ${event.description.slice(0, 80)}`,
        flag: event.severity,
      });
    }
  } catch (err: any) {
    console.warn('Audit write failed:', err.message);
    // Never throw — audit must not block main flow
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

export async function logOverride(record: OverrideRecord): Promise<void> {
  await writeAuditEvent({
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
    .eq('status', 'OPEN')
    .single();

  if (existing) return; // already open case for this entity

  await supabase.from('audit_cases').insert({
    project_id: projectId,
    trigger_type: triggerType,
    entity_type: entityType,
    entity_id: entityId,
    status: 'OPEN',
    notes,
    created_at: new Date().toISOString(),
  });
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
    .eq('status', 'OPEN')
    .lte('reported_at', new Date(now.getTime() - 14 * 86400000).toISOString());

  for (const d of stuckDefects ?? []) {
    if (d.severity === 'Critical' || d.severity === 'Major') {
      anomalies.push({
        type: 'defect_stuck',
        found: true,
        description: `${d.severity} defect belum divalidasi > 14 hari`,
        entityId: d.id,
        severity: d.severity === 'Critical' ? 'CRITICAL' : 'HIGH',
      });
    }
  }

  // 3. POs with no receipt activity in 7 days but status OPEN
  // Single query instead of N+1: fetch stale POs, then batch-check receipts.
  const { data: stalePOs } = await supabase
    .from('purchase_orders')
    .select('id, po_number, material_name, ordered_date')
    .eq('project_id', projectId)
    .eq('status', 'OPEN')
    .lte('ordered_date', sevenDaysAgo);

  if ((stalePOs ?? []).length > 0) {
    const stalePOIds = (stalePOs ?? []).map(po => po.id);

    // Single query: get distinct po_ids that DO have receipts
    const { data: posWithReceipts } = await supabase
      .from('receipts')
      .select('po_id')
      .in('po_id', stalePOIds);

    const posWithReceiptSet = new Set((posWithReceipts ?? []).map((r: any) => r.po_id));

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

// ── Report Generation History ─────────────────────────────────────────

export async function getReportHistory(
  projectId: string,
  limit = 20,
): Promise<Array<{ report_type: string; generated_by: string; generated_at: string; filters: object }>> {
  const { data } = await supabase
    .from('report_exports')
    .select('report_type, generated_by, generated_at, filters')
    .eq('project_id', projectId)
    .order('generated_at', { ascending: false })
    .limit(limit);

  return data ?? [];
}

// ── Open Audit Cases Summary ─────────────────────────────────────────

export async function getOpenAuditCases(projectId: string) {
  const { data } = await supabase
    .from('audit_cases')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false });

  return data ?? [];
}
