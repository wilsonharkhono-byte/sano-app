// tools/progressClaims/stages.ts
// App-side labels for the report-line vocabulary. The codes live in
// tools/reportLineDraftValidate.ts (the edge function's byte copy); this file
// is never copied into Deno.
import {
  REPORT_LINE_STAGES, ACTIVITY_STATES, isWeightBearingStage,
  type ReportLineStage, type ActivityState,
} from '../reportLineDraftValidate';

export const STAGE_LABELS: Record<ReportLineStage, string> = {
  GALIAN: 'Galian',
  LANTAI_KERJA: 'Lantai kerja',
  MARKING: 'Marking',
  STEK: 'Stek',
  BEKISTING: 'Bekisting',
  PEMBESIAN: 'Pembesian',
  PENGECORAN: 'Pengecoran',
  BONGKAR_BEKISTING: 'Bongkar bekisting',
  CURING: 'Curing',
  PERSIAPAN: 'Persiapan',
  LAINNYA: 'Lainnya',
};

export const ACTIVITY_STATE_LABELS: Record<ActivityState, string> = {
  MULAI: 'Mulai',
  LANJUT: 'Lanjut',
  SELESAI: 'Selesai',
};

export function stageLabel(stage: string | null | undefined): string {
  return stage && stage in STAGE_LABELS ? STAGE_LABELS[stage as ReportLineStage] : 'Tanpa tahap';
}

export function activityStateLabel(state: string | null | undefined): string {
  return state && state in ACTIVITY_STATE_LABELS ? ACTIVITY_STATE_LABELS[state as ActivityState] : 'Lanjut';
}

/** SelectSheet options; `meta` marks the stages that carry BoQ value. */
export function stageOptions(): Array<{ value: string; label: string; meta?: string }> {
  return REPORT_LINE_STAGES.map((s) => ({
    value: s,
    label: STAGE_LABELS[s],
    ...(isWeightBearingStage(s) ? { meta: 'berbobot' } : {}),
  }));
}

export const ACTIVITY_STATE_ORDER: ReadonlyArray<ActivityState> = ACTIVITY_STATES;
