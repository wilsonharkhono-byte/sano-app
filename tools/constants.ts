/**
 * SANO Contractor Supervisor — Shared Constants
 *
 * Single source of truth for all status values, roles, severity levels,
 * and other repeated string literals used across the codebase.
 *
 * Usage:  import { OpnameStatus, UserRole } from '../tools/constants';
 *         if (header.status === OpnameStatus.DRAFT) { ... }
 */

// ── Opname / Labor Payment Status ───────────────────────────────────────────
export const OpnameStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  VERIFIED: 'VERIFIED',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
} as const;
export type OpnameStatusType = (typeof OpnameStatus)[keyof typeof OpnameStatus];

// ── Worker Attendance Status ────────────────────────────────────────────────
export const AttendanceStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
  OVERRIDDEN: 'OVERRIDDEN',
  SETTLED: 'SETTLED',
} as const;
export type AttendanceStatusType = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

// ── Defect Lifecycle Status ─────────────────────────────────────────────────
export const DefectStatus = {
  OPEN: 'OPEN',
  VALIDATED: 'VALIDATED',
  IN_REPAIR: 'IN_REPAIR',
  RESOLVED: 'RESOLVED',
  VERIFIED: 'VERIFIED',
  ACCEPTED_BY_PRINCIPAL: 'ACCEPTED_BY_PRINCIPAL',
} as const;
export type DefectStatusType = (typeof DefectStatus)[keyof typeof DefectStatus];

// ── Defect Severity ─────────────────────────────────────────────────────────
export const DefectSeverity = {
  MINOR: 'Minor',
  MAJOR: 'Major',
  CRITICAL: 'Critical',
} as const;
export type DefectSeverityType = (typeof DefectSeverity)[keyof typeof DefectSeverity];

// ── Purchase Order Status ───────────────────────────────────────────────────
export const POStatus = {
  OPEN: 'OPEN',
  PARTIAL_RECEIVED: 'PARTIAL_RECEIVED',
  FULLY_RECEIVED: 'FULLY_RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type POStatusType = (typeof POStatus)[keyof typeof POStatus];

// ── Material Request Header Status ──────────────────────────────────────────
export const MRStatus = {
  PENDING: 'PENDING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  AUTO_HOLD: 'AUTO_HOLD',
} as const;
export type MRStatusType = (typeof MRStatus)[keyof typeof MRStatus];

// ── Material Transfer Note (MTN) Line Status ────────────────────────────────
export const MTNStatus = {
  AWAITING: 'AWAITING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RECEIVED: 'RECEIVED',
  REVIEWED: 'REVIEWED',
} as const;
export type MTNStatusType = (typeof MTNStatus)[keyof typeof MTNStatus];

// ── Baseline Review Status ──────────────────────────────────────────────────
export const BaselineReviewStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  MODIFIED: 'MODIFIED',
} as const;
export type BaselineReviewStatusType = (typeof BaselineReviewStatus)[keyof typeof BaselineReviewStatus];

// ── Kasbon (Advance/Loan) Status ────────────────────────────────────────────
export const KasbonStatus = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  SETTLED: 'SETTLED',
} as const;
export type KasbonStatusType = (typeof KasbonStatus)[keyof typeof KasbonStatus];

// ── Project Status ──────────────────────────────────────────────────────────
export const ProjectStatus = {
  ACTIVE: 'ACTIVE',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProjectStatusType = (typeof ProjectStatus)[keyof typeof ProjectStatus];

// ── Variation Order (VO) Status ─────────────────────────────────────────────
export const VOStatus = {
  AWAITING: 'AWAITING',
  REVIEWED: 'REVIEWED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type VOStatusType = (typeof VOStatus)[keyof typeof VOStatus];

// ── VO Grade ────────────────────────────────────────────────────────────────
export const VOGrade = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL_MARGIN: 'critical_margin',
} as const;
export type VOGradeType = (typeof VOGrade)[keyof typeof VOGrade];

// ── Anomaly Resolution Status ───────────────────────────────────────────────
export const AnomalyResolution = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  CORRECTED: 'CORRECTED',
  DISMISSED: 'DISMISSED',
} as const;
export type AnomalyResolutionType = (typeof AnomalyResolution)[keyof typeof AnomalyResolution];

// ── Audit Case Status ───────────────────────────────────────────────────────
export const AuditCaseStatus = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  CLOSED: 'CLOSED',
} as const;
export type AuditCaseStatusType = (typeof AuditCaseStatus)[keyof typeof AuditCaseStatus];

// ── Rework Status ───────────────────────────────────────────────────────────
export const ReworkStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
} as const;
export type ReworkStatusType = (typeof ReworkStatus)[keyof typeof ReworkStatus];

// ── Work Status (BoQ Progress) ──────────────────────────────────────────────
export const WorkStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETE: 'COMPLETE',
  COMPLETE_DEFECT: 'COMPLETE_DEFECT',
} as const;
export type WorkStatusType = (typeof WorkStatus)[keyof typeof WorkStatus];

// ── User Roles ──────────────────────────────────────────────────────────────
export const UserRole = {
  SUPERVISOR: 'supervisor',
  ESTIMATOR: 'estimator',
  ADMIN: 'admin',
  PRINCIPAL: 'principal',
} as const;
export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];

// ── Confidence Levels (AI / Labor Trade) ────────────────────────────────────
export const Confidence = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;
export type ConfidenceType = (typeof Confidence)[keyof typeof Confidence];

// ── Toast Types (UI Feedback) ───────────────────────────────────────────────
export const ToastType = {
  OK: 'ok',
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;
export type ToastTypeValue = '' | (typeof ToastType)[keyof typeof ToastType];
