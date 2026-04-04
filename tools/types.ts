// SAN Contractor — TypeScript Type Definitions
// Updated for multi-project, multi-role, header+lines architecture per SAN Developer Brief

import type {
  OpnameStatusType,
  ProjectStatusType,
  BaselineReviewStatusType,
  MRStatusType,
  POStatusType,
  VOStatusType,
  MTNStatusType,
  AuditCaseStatusType,
  KasbonStatusType,
  AnomalyResolutionType,
  UserRoleType,
  DefectStatusType,
} from './constants';

// ─── Identity & Access ────────────────────────────────────────────────

export type UserRole = UserRoleType;

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  location: string | null;
  client_name: string | null;
  contract_value: number | null;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatusType;
}

export interface ProjectAssignment {
  id: string;
  user_id: string;
  project_id: string;
}

// ─── Baseline & Planning ──────────────────────────────────────────────

export interface BoqItem {
  id: string;
  project_id: string;
  code: string;
  label: string;
  unit: string;
  tier1_material: string | null;
  tier2_material: string | null;
  progress: number;
  planned: number;
  installed: number;
  parent_code: string | null;
  chapter: string | null;
  sort_order: number;
  element_code: string | null;
  composite_factors: CompositeFactors | null;
  cost_breakdown: CostBreakdown | null;
  client_unit_price: number | null;
  internal_unit_price: number | null;
}

export interface CompositeFactors {
  formwork_ratio: number;
  rebar_ratio: number;
  wiremesh_ratio: number;
}

export interface CostBreakdown {
  material: number;
  labor: number;
  equipment: number;
  subkon: number;
  prelim: number;
}

export interface BoqItemVersion {
  id: string;
  boq_item_id: string;
  version: number;
  snapshot: object;
  published_at: string;
}

export interface AhsVersion {
  id: string;
  project_id: string;
  version: number;
  published_at: string;
}

export type AhsLineType = 'material' | 'labor' | 'equipment' | 'subkon';

export interface AhsLine {
  id: string;
  ahs_version_id: string;
  boq_item_id: string;
  material_id: string | null;
  material_spec: string | null;
  tier: 1 | 2 | 3;
  usage_rate: number;
  unit: string;
  waste_factor: number;
  line_type: AhsLineType;
  coefficient: number;
  unit_price: number;
  description: string | null;
  ahs_block_title: string | null;
  source_row: number | null;
}

export interface Material {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  tier: 1 | 2 | 3;
  unit: string;
  supplier_unit: string;
}

export interface MaterialAlias {
  id: string;
  material_id: string;
  alias: string;
}

export interface MaterialSpec {
  id: string;
  material_id: string;
  spec_key: string;
  spec_value: string;
}

export interface ProjectMaterialMaster {
  id: string;
  project_id: string;
  ahs_version_id: string;
  created_at: string;
}

export interface ProjectMaterialMasterLine {
  id: string;
  master_id: string;
  material_id: string;
  boq_item_id: string;
  planned_quantity: number;
  unit: string;
}

// ─── Import Staging (Phase 2) ─────────────────────────────────────────

export type ImportStatus = 'UPLOADED' | 'PARSING' | 'STAGING' | 'REVIEW' | 'PUBLISHED' | 'FAILED';

export interface ImportSession {
  id: string;
  project_id: string;
  uploaded_by: string;
  original_file_path: string;
  original_file_name: string;
  status: ImportStatus;
  error_message: string | null;
  created_at: string;
  published_at: string | null;
}

export interface ImportStagingRow {
  id: string;
  session_id: string;
  row_number: number;
  row_type: 'boq' | 'ahs' | 'material' | 'spec' | 'price';
  raw_data: object;
  parsed_data: object | null;
  confidence: number;
  needs_review: boolean;
  review_status: BaselineReviewStatusType;
  reviewer_notes: string | null;
  created_at: string;
}

export interface Envelope {
  id: string;
  project_id: string;
  material_name: string;
  planned: number;
  received: number;
  unit: string;
  ai_adjustment: number;
}

export interface Milestone {
  id: string;
  project_id: string;
  label: string;
  planned_date: string;
  revised_date: string | null;
  revision_reason: string | null;
  boq_ids: string[];
  status: MilestoneStatus;
}

export type MilestoneStatus = 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'AHEAD' | 'COMPLETE';

// ─── Gate 1: Material Request (Header + Lines) ───────────────────────

export interface MaterialRequestHeader {
  id: string;
  project_id: string;
  boq_item_id: string | null;
  request_basis: MaterialRequestBasis;
  requested_by: string;
  target_date: string;
  urgency: 'NORMAL' | 'URGENT' | 'CRITICAL';
  common_note: string | null;
  overall_flag: FlagLevel;
  overall_status: RequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface MaterialRequestLine {
  id: string;
  request_header_id: string;
  material_id: string | null;
  custom_material_name: string | null;
  tier: 1 | 2 | 3;
  material_spec_reference: string | null;
  quantity: number;
  unit: string;
  line_flag: FlagLevel;
  line_check_details: GateResult | null;
  created_at: string;
}

export interface MaterialRequestLineAllocation {
  id: string;
  request_line_id: string;
  boq_item_id: string | null;
  allocated_quantity: number;
  proportion_pct: number;
  allocation_basis: MaterialRequestAllocationBasis;
  created_at: string;
}

export type RequestStatus = MRStatusType;
export type MaterialRequestBasis = 'BOQ' | 'MATERIAL';
export type MaterialRequestAllocationBasis = 'DIRECT' | 'TIER2_ENVELOPE' | 'GENERAL_STOCK';

/** @deprecated Use MaterialRequestHeader + MaterialRequestLine instead */
export interface MaterialRequest {
  id: string;
  project_id: string;
  boq_item_id: string;
  requested_by: string;
  material_name: string;
  quantity: number;
  unit: string;
  target_date: string;
  notes: string | null;
  gate1_flag: FlagLevel;
  gate1_details: GateResult | null;
  status: Exclude<MRStatusType, 'UNDER_REVIEW'>;
  created_at: string;
}

// ─── Gate 2: Price Validation ─────────────────────────────────────────

export interface PurchaseOrder {
  id: string;
  project_id: string;
  po_number: string | null;
  material_name: string;
  quantity: number;
  unit: string;
  supplier: string;
  ordered_date: string;
  boq_ref: string | null;
  unit_price: number | null;
  flag: FlagLevel;
  status: POStatus;
}

export type POStatus = 'OPEN' | 'PARTIAL_RECEIVED' | 'FULLY_RECEIVED' | 'CLOSED' | 'CANCELLED';

export interface PurchaseOrderLine {
  id: string;
  po_id: string;
  material_id: string | null;
  material_name: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
}

export interface PriceHistory {
  id: string;
  project_id: string;
  material_id: string;
  vendor: string;
  unit_price: number;
  recorded_at: string;
}

export interface VendorScorecard {
  id: string;
  vendor: string;
  project_id: string;
  score: number;
  notes: string | null;
  evaluated_at: string;
}

// ─── Gate 3: Delivery Verification (Partial Receipts) ─────────────────

export interface Receipt {
  id: string;
  po_id: string;
  project_id: string;
  received_by: string;
  vehicle_ref: string | null;
  gate3_flag: FlagLevel;
  gate3_details: object | null;
  notes: string | null;
  created_at: string;
}

export interface ReceiptLine {
  id: string;
  receipt_id: string;
  material_name: string;
  quantity_actual: number;
  unit: string;
}

export interface ReceiptPhoto {
  id: string;
  receipt_id: string;
  photo_type: 'surat_jalan' | 'material_site' | 'vehicle' | 'tiket_timbang';
  storage_path: string;
  gps_lat: number | null;
  gps_lon: number | null;
  captured_at: string;
}

/** @deprecated Use Receipt + ReceiptLine instead */
export interface MaterialReceipt {
  id: string;
  project_id: string;
  po_id: string;
  received_by: string;
  quantity_actual: number;
  unit: string;
  gate3_flag: FlagLevel;
  gate3_details: object | null;
  gps_lat: number | null;
  gps_lon: number | null;
  notes: string | null;
  created_at: string;
}

// ─── Gate 4: Progress Hub ─────────────────────────────────────────────

export interface ProgressEntry {
  id: string;
  project_id: string;
  boq_item_id: string;
  reported_by: string;
  quantity: number;
  unit: string;
  work_status: WorkStatus;
  location: string | null;
  note: string | null;
  payroll_support: boolean;
  client_charge_support: boolean;
  linked_vo_id: string | null;
  linked_rework_id: string | null;
  created_at: string;
}

export type WorkStatus = 'IN_PROGRESS' | 'COMPLETE' | 'COMPLETE_DEFECT';

export interface ProgressPhoto {
  id: string;
  progress_entry_id: string;
  storage_path: string;
  captured_at: string;
}

export interface DefectPhoto {
  id: string;
  defect_id: string;
  photo_kind: 'report' | 'repair';
  storage_path: string;
  captured_at: string;
}

export interface VOPhoto {
  id: string;
  vo_entry_id: string;
  storage_path: string;
  captured_at: string;
}

export interface ReworkPhoto {
  id: string;
  rework_entry_id: string;
  storage_path: string;
  captured_at: string;
}

export interface MtnPhoto {
  id: string;
  mtn_request_id: string;
  storage_path: string;
  captured_at: string;
}

/** @deprecated Use ProgressEntry instead */
export interface ProgressReport {
  id: string;
  project_id: string;
  boq_item_id: string;
  reported_by: string;
  quantity: number;
  unit: string;
  work_status: 'IN_PROGRESS' | 'COMPLETE' | 'COMPLETE_DEFECT';
  location: string | null;
  photo_before_path: string | null;
  photo_after_path: string | null;
  created_at: string;
}

// ─── Defects (inside Progres) ─────────────────────────────────────────

export type DefectStatus = DefectStatusType;

export interface Defect {
  id: string;
  project_id: string;
  boq_item_id: string | null;
  boq_ref: string;
  location: string;
  description: string;
  severity: 'Minor' | 'Major' | 'Critical';
  status: DefectStatus;
  responsible_party: string | null;
  target_resolution_date: string | null;
  verifier_id: string | null;
  handover_impact: boolean;
  photo_path: string | null;
  repair_photo_path: string | null;
  reported_by: string;
  reported_at: string;
  resolved_at: string | null;
  verified_at: string | null;
}

// ─── VO & Rework (inside Progres) ─────────────────────────────────────

export type VOCause =
  | 'client_request'
  | 'design_revision'
  | 'estimator_error'
  | 'site_execution'
  | 'unforeseen_condition'
  | 'owner_supplied'
  | 'contractor_rework';

export type VOGrade = import('./constants').VOGradeType;

export interface VOEntry {
  id: string;
  project_id: string;
  boq_item_id: string | null;
  location: string;
  description: string;
  requested_by_name: string;
  cause: VOCause | null;
  grade: VOGrade | null;
  est_material: string | null;
  est_cost: number | null;
  photo_path: string | null;
  is_micro: boolean;
  status: VOStatusType;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string;
  created_at: string;
}

export interface FormalVO {
  id: string;
  project_id: string;
  vo_entry_ids: string[];
  total_value: number;
  billable: boolean;
  approved_by: string | null;
  approved_at: string | null;
}

export type ReworkStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';

export interface ReworkEntry {
  id: string;
  project_id: string;
  boq_item_id: string | null;
  description: string;
  cause: VOCause;
  cost_impact: number | null;
  performance_impact: boolean;
  linked_defect_id: string | null;
  status: ReworkStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_by: string;
  created_at: string;
}

// ─── MTN (Material Transfer Nota) ─────────────────────────────────────

export interface MtnRequest {
  id: string;
  project_id: string;
  material_name: string;
  quantity: number;
  destination_project: string;
  reason: string;
  photo_path: string | null;
  status: MTNStatusType;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

// ─── Approval Tasks ───────────────────────────────────────────────────

export interface ApprovalTask {
  id: string;
  project_id: string;
  entity_type: string;
  entity_id: string;
  assigned_to: string;
  action: 'APPROVE' | 'REJECT' | 'HOLD' | 'OVERRIDE' | null;
  reason: string | null;
  acted_at: string | null;
  created_at: string;
}

// ─── Gate 5: Reporting & Reconciliation ───────────────────────────────

export interface WeeklyDigest {
  id: string;
  project_id: string;
  week_start: string;
  week_end: string;
  summary: object;
  generated_at: string;
}

export interface ReportExport {
  id: string;
  project_id: string;
  report_type: string;
  filters: object;
  file_path: string;
  generated_by: string;
  generated_at: string;
}

// ─── Scoring & Anomaly ───────────────────────────────────────────────

export interface PerformanceScore {
  id: string;
  project_id: string;
  user_id: string;
  role: UserRole;
  period: string;
  metrics: object;
  total_score: number;
  generated_at: string;
}

export interface AnomalyEvent {
  id: string;
  project_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  severity: FlagLevel;
  description: string;
  created_at: string;
}

export interface AuditCase {
  id: string;
  project_id: string;
  trigger_type: string;
  entity_type: string;
  entity_id: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'CLOSED';
  notes: string | null;
  created_at: string;
}

// ─── Activity Log ─────────────────────────────────────────────────────

export interface ActivityLog {
  id: string;
  project_id: string;
  user_id: string;
  type: 'progres' | 'terima' | 'permintaan' | 'defect' | 'vo' | 'rework' | 'mtn';
  label: string;
  flag: FlagLevel;
  created_at: string;
}

// ─── Project Markup Factors ──────────────────────────────────────────

export interface ProjectMarkupFactor {
  id: string;
  project_id: string;
  category: string;
  factor: number;
  sort_order: number;
}

// ─── Material Envelope (Tier 2 cross-BoQ aggregation) ────────────────

export interface MaterialEnvelopeStatus {
  material_id: string;
  project_id: string;
  material_code: string | null;
  material_name: string;
  tier: 1 | 2 | 3;
  unit: string;
  total_planned: number;
  total_ordered: number;
  total_received: number;
  remaining_to_order: number;
  burn_pct: number;
  boq_item_count: number;
}

export interface EnvelopeBoqBreakdown {
  boq_item_id: string;
  boq_code: string;
  boq_label: string;
  planned_quantity: number;
  pct_of_total: number;
}

// ─── Import Anomalies (AI-detected deviations) ──────────────────────

export type ImportAnomalyType =
  | 'coefficient_deviation'
  | 'price_deviation'
  | 'missing_component'
  | 'unit_mismatch'
  | 'duplicate_item'
  | 'waste_factor_unusual'
  | 'zero_quantity'
  | 'unresolved_material'
  | 'formula_error'
  | 'ratio_deviation';

export type AnomalySeverity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';

export type AnomalyResolution = AnomalyResolutionType;

export interface ImportAnomaly {
  id: string;
  session_id: string;
  anomaly_type: ImportAnomalyType;
  severity: AnomalySeverity;
  source_sheet: string | null;
  source_row: number | null;
  description: string;
  expected_value: string | null;
  actual_value: string | null;
  context: Record<string, unknown>;
  resolution: AnomalyResolution;
  resolved_by: string | null;
  resolved_at: string | null;
}

// ─── Flag & Gate System ───────────────────────────────────────────────

export type FlagLevel = 'OK' | 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';

export interface GateResult {
  flag: FlagLevel;
  check: string;
  msg: string;
  extra?: GateResult;
}

// ─── Kasbon Ledger ───────────────────────────────────────────────────

export interface Kasbon {
  id: string;
  project_id: string;
  contract_id: string;
  amount: number;
  kasbon_date: string;
  reason: string | null;
  status: KasbonStatusType;
  requested_by: string;
  approved_by: string | null;
  approved_at: string | null;
  settled_in_opname_id: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface KasbonAging {
  id: string;
  project_id: string;
  contract_id: string;
  mandor_name: string;
  amount: number;
  kasbon_date: string;
  reason: string | null;
  status: Exclude<KasbonStatusType, 'SETTLED'>;
  requested_by: string;
  approved_by: string | null;
  created_at: string;
  age_days: number;
  opname_cycles_since: number;
}

// ─── Attendance / HOK ────────────────────────────────────────────────

export type PaymentMode = 'borongan' | 'harian' | 'campuran';

export interface MandorAttendance {
  id: string;
  project_id: string;
  contract_id: string;
  attendance_date: string;
  worker_count: number;
  daily_rate: number;
  line_total: number;
  work_description: string | null;
  recorded_by: string;
  verified_by: string | null;
  verified_at: string | null;
  status: 'DRAFT' | 'VERIFIED' | 'SETTLED';
  settled_in_opname_id: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface AttendanceWeeklySummary {
  contract_id: string;
  mandor_name: string;
  project_id: string;
  week_start: string;
  work_days: number;
  total_hok: number;
  total_amount: number;
  draft_count: number;
  verified_count: number;
  settled_count: number;
}

export interface AttendanceAnomaly {
  is_anomaly: boolean;
  avg_7day: number;
  threshold: number;
}

// ─── Deprecated ─────────────────────────────────────────────────────

/** @deprecated Use VOEntry with is_micro=true instead */
export interface MicroVo {
  id: string;
  project_id: string;
  requested_by: string;
  location: string;
  description: string;
  requested_by_name: string;
  est_material: string | null;
  est_cost: number | null;
  photo_path: string | null;
  status: Exclude<VOStatusType, 'REVIEWED'>;
  created_at: string;
}

// ─── Opname Progress Reconciliation ──────────────────────────────────

export interface OpnameProgressFlag {
  line_id: string;
  boq_item_id: string;
  boq_code: string;
  boq_label: string;
  claimed_progress_pct: number;
  field_progress_pct: number;
  variance_pct: number;
  variance_flag: 'OK' | 'WARNING' | 'HIGH';
}
