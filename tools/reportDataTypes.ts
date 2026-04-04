/**
 * SANO — Report Data Shape Interfaces
 *
 * Typed data payloads for each report type. Used by excel.ts, pdf.ts,
 * and ReportPreview.tsx to avoid `any` on the `ReportPayload.data` field.
 *
 * Each interface mirrors the `data` object returned by the corresponding
 * generator in reports.ts.
 */

// Re-export the one already defined in reports.ts
export type { ProgressSummaryData } from './reports';

// ── Shared photo shape ─────────────────────────────────────────────
export interface ReportPhoto {
  storage_path: string;
  photo_url: string;
  captured_at?: string | null;
  photo_kind?: string | null;
  photo_type?: string | null;
  gps_lat?: number | null;
  gps_lon?: number | null;
}

// ── Material Balance ───────────────────────────────────────────────
export interface MaterialBalanceData {
  total_materials: number;
  over_received: number;
  under_received: number;
  balances: Array<{
    material_name?: string;
    name?: string;
    unit?: string;
    planned?: number;
    received?: number;
    total_received?: number;
    installed?: number;
    on_site?: number;
  }>;
}

// ── Receipt Log ────────────────────────────────────────────────────
export interface ReceiptLogData {
  total_pos: number;
  fully_received: number;
  entries: Array<{
    po_number: string;
    po_ref: string | null;
    supplier: string | null;
    material: string;
    ordered_qty: number;
    received_qty: number;
    receipt_count: number;
    unit: string;
    unit_price: number | null;
    status: string;
    ordered_date: string;
    last_receipt: string | null;
  }>;
  receipts: Array<{
    receipt_id: string;
    po_number: string;
    po_ref: string;
    supplier: string;
    material_name: string;
    quantity_actual: number;
    unit: string;
    vehicle_ref: string | null;
    gate3_flag: boolean;
    notes: string | null;
    created_at: string;
    photos: ReportPhoto[];
  }>;
}

// ── Site Change Log ────────────────────────────────────────────────
export interface SiteChangeLogData {
  show_costs: boolean;
  summary: {
    total_items: number;
    pending: number;
    disetujui: number;
    ditolak: number;
    selesai: number;
    urgent: number;
    impact_berat: number;
    approved_unresolved: number;
    open_rework: number;
    open_quality_notes: number;
    approved_cost_total: number | null;
  };
  by_type: Array<{ change_type: string; label: string; count: number }>;
  by_decision: Array<{ decision: string; label: string; count: number }>;
  items: Array<{
    id: string;
    created_at: string;
    location: string | null;
    description: string | null;
    change_type: string;
    change_type_label: string;
    boq_code: string | null;
    boq_label: string | null;
    mandor_name: string | null;
    reporter_name: string | null;
    impact: string;
    impact_label: string;
    is_urgent: boolean;
    decision: string;
    decision_label: string;
    flags: string[];
    photos: ReportPhoto[];
    est_cost?: number | null;
    cost_bearer?: string | null;
    cost_bearer_label?: string | null;
    estimator_note?: string | null;
  }>;
  date_range: { from: string | null; to: string | null };
}

// ── Schedule Variance ──────────────────────────────────────────────
export interface ScheduleVarianceData {
  total_milestones: number;
  on_track: number;
  at_risk: number;
  delayed: number;
  milestones: Array<{
    label: string;
    planned_date: string;
    revised_date: string | null;
    revision_reason: string | null;
    status: string;
    days_remaining: number;
  }>;
}

// ── Weekly Digest ──────────────────────────────────────────────────
export interface WeeklyDigestData {
  week_start: string;
  week_end: string;
  total_activities: number;
  by_type: Record<string, number>;
  by_flag: Record<string, number>;
  overall_progress: number;
}

// ── Payroll Support Summary ────────────────────────────────────────
export interface PayrollSupportData {
  purpose: string;
  total_entries: number;
  total_qty: number;
  by_reporter: Array<{
    reporter_name: string;
    total_qty: number;
    entry_count: number;
  }>;
  entries: Array<{
    id: string;
    created_at: string;
    boq_code: string;
    boq_label: string;
    quantity: number;
    unit: string;
    location: string | null;
    note: string | null;
    reporter_name: string;
  }>;
  date_range: { from: string | null; to: string | null };
}

// ── Client Charge Report ───────────────────────────────────────────
export interface ClientChargeData {
  purpose: string;
  vo_charges: {
    items: Array<{
      id: string;
      created_at: string;
      location: string | null;
      description: string | null;
      requested_by_name: string | null;
      cause: string;
      est_material: number | null;
      est_cost: number | null;
      status: string;
    }>;
    total_est_cost: number;
  };
  progress_support: {
    items: Array<{
      id: string;
      created_at: string;
      boq_code: string;
      boq_label: string;
      quantity: number;
      unit: string;
      location: string | null;
      reporter_name: string;
      note?: string | null;
    }>;
    total_entries: number;
    total_qty: number;
  };
  grand_total_est_cost: number;
  date_range: { from: string | null; to: string | null };
}

// ── Audit List ─────────────────────────────────────────────────────
export interface AuditListData {
  anomalies: {
    total: number;
    open: number;
    items: Array<{
      id: string;
      created_at: string;
      event_type: string;
      entity_type: string;
      entity_id: string;
      severity: string;
      description: string;
    }>;
  };
  audit_cases: {
    total: number;
    open: number;
    items: Array<{
      id: string;
      created_at: string;
      trigger_type: string;
      entity_type: string;
      entity_id: string;
      status: string;
      notes: string | null;
    }>;
  };
  date_range: { from: string | null; to: string | null };
}

// ── AI Usage Summary ───────────────────────────────────────────────
export interface AIUsageData {
  summary: {
    total_interactions: number;
    active_users: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
    haiku_count: number;
    sonnet_count: number;
  };
  users: Array<{
    user_id: string;
    full_name: string;
    role: string;
    interaction_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    haiku_count: number;
    sonnet_count: number;
    active_days: number;
    last_used_at: string | null;
  }>;
  usage_by_day: Array<{
    date: string;
    interaction_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }>;
  date_range: { from: string | null; to: string | null };
}

// ── Approval SLA per User ──────────────────────────────────────────
export interface ApprovalSLAData {
  summary: {
    handled_events: number;
    active_reviewers: number;
    avg_hours: number;
    median_hours: number;
    over_24h: number;
    pending_items: number;
  };
  pending_by_queue: Array<{ label: string; count: number }>;
  users: Array<{
    user_id: string;
    full_name: string;
    role: string;
    handled_events: number;
    avg_hours: number;
    median_hours: number;
    over_24h: number;
    assigned_pending: number;
    last_acted_at: string | null;
    by_entity: Record<string, number>;
  }>;
  entity_sla: Array<{
    entity: string;
    handled_events: number;
    avg_hours: number;
    median_hours: number;
  }>;
  note: string;
  date_range: { from: string | null; to: string | null };
}

// ── Operational Entry Discipline ───────────────────────────────────
export interface OperationalDisciplineData {
  summary: {
    total_entries: number;
    active_users: number;
    photo_eligible_entries: number;
    photo_backed_entries: number;
    photo_coverage_pct: number;
  };
  by_module: Array<{ module: string; count: number }>;
  users: Array<{
    user_id: string;
    full_name: string;
    role: string;
    total_entries: number;
    active_days: number;
    photo_coverage_pct: number | null;
    last_activity: string | null;
    by_module: Record<string, number>;
  }>;
  note: string;
  date_range: { from: string | null; to: string | null };
}

// ── Tool Usage Summary ─────────────────────────────────────────────
export interface ToolUsageData {
  summary: {
    total_exports: number;
    export_users: number;
    total_ai_chats: number;
    ai_users: number;
    total_ai_tokens: number;
  };
  top_report_types: Array<{ report_type: string; count: number }>;
  users: Array<{
    user_id: string;
    full_name: string;
    role: string;
    export_count: number;
    ai_chat_count: number;
    total_tokens: number;
    haiku_count: number;
    sonnet_count: number;
    last_seen: string | null;
  }>;
  note: string;
  date_range: { from: string | null; to: string | null };
}

// ── Exception Handling Load ────────────────────────────────────────
export interface ExceptionHandlingData {
  summary: {
    auto_hold_requests: number;
    rejected_requests: number;
    rejected_vo: number;
    rejected_mtn: number;
    hold_reject_override_actions: number;
    anomalies_total: number;
    anomalies_high_or_critical: number;
    audit_cases_open: number;
  };
  users: Array<{
    user_id: string;
    full_name: string;
    role: string;
    generated_count: number;
    handled_count: number;
    hold_reject_override: number;
    last_touch: string | null;
  }>;
  anomaly_breakdown: Array<{ event_type: string; count: number }>;
  note: string;
  date_range: { from: string | null; to: string | null };
}

/**
 * Union of all report data types. Use as a discriminated lookup:
 *   type DataFor<T extends ReportType> = ReportDataMap[T]
 */
export interface ReportDataMap {
  progress_summary: import('./reports').ProgressSummaryData;
  material_balance: MaterialBalanceData;
  receipt_log: ReceiptLogData;
  site_change_log: SiteChangeLogData;
  schedule_variance: ScheduleVarianceData;
  weekly_digest: WeeklyDigestData;
  payroll_support_summary: PayrollSupportData;
  client_charge_report: ClientChargeData;
  audit_list: AuditListData;
  ai_usage_summary: AIUsageData;
  approval_sla_user: ApprovalSLAData;
  operational_entry_discipline: OperationalDisciplineData;
  tool_usage_summary: ToolUsageData;
  exception_handling_load: ExceptionHandlingData;
}
