// tools/progressClaims/diaryEvidence.ts
// SANO — what the daily Blueprint reports say about a work area (spec
// 2026-09-17 §4.2). The confirmed report lines since the area was last
// verified propose a status per stage; the latest line of a stage decides.
// Nothing here estimates a figure, and nothing is saved from here. Pure.
import { isWeightBearingStage } from '../reportLineDraftValidate';
import { pctOfStatus, stageStatusLabel, statusOfActivity, type StageStatus } from './statusCredit';
import { stageKeyLabel } from './claimView';
import type { StagePct } from './stageMath';
import { isSingle, stagesOf, type StageKey, type StageWeights } from './stageWeights';

/** One CONFIRMED client_report_lines row with the report it belongs to. */
export interface DiaryLine {
  id: string;
  boq_item_id: string | null;
  stage: string | null;
  activity_state: string | null;
  line_text: string;
  line_index: number;
  report_id: string;
  report_no: number;
  revision: number;
  /** The report's last day, YYYY-MM-DD. */
  period_end: string;
  issued_at: string | null;
}

/** Lines of the latest revision of each report number; a re-issued report never counts twice. */
export function latestRevisionLines(lines: DiaryLine[]): DiaryLine[] {
  const latest = new Map<number, number>();
  for (const l of lines) latest.set(l.report_no, Math.max(latest.get(l.report_no) ?? 0, l.revision));
  return lines.filter((l) => l.revision === latest.get(l.report_no));
}

/**
 * Lines per work area, keeping those issued after the area's last verification
 * (every line of an area never verified). A week without a claim is never
 * lost, and what was already verified is not counted again.
 */
export function linesByRowSince(lines: DiaryLine[], verifiedAtByRow: ReadonlyMap<string, string | null | undefined>): Map<string, DiaryLine[]> {
  const byRow = new Map<string, DiaryLine[]>();
  for (const l of lines) {
    if (!l.boq_item_id) continue;
    const verifiedAt = verifiedAtByRow.get(l.boq_item_id);
    if (verifiedAt && l.issued_at && l.issued_at <= verifiedAt) continue;
    const list = byRow.get(l.boq_item_id) ?? [];
    list.push(l);
    byRow.set(l.boq_item_id, list);
  }
  return byRow;
}

const newestFirst = (a: DiaryLine, b: DiaryLine) =>
  b.period_end.localeCompare(a.period_end) || (b.issued_at ?? '').localeCompare(a.issued_at ?? '') || b.line_index - a.line_index;

export interface DiaryStageStatus {
  stage: StageKey;
  status: StageStatus;
  reportNo: number;
  date: string;
}

export interface DiaryProposal {
  /** Stage percents by status credit, never below `prevPct`. */
  pct: StagePct;
  /** True when the proposal differs from `prevPct`. */
  changed: boolean;
  /** What the diary says per stage it mentions, in the weights' stage order. */
  stages: DiaryStageStatus[];
  /** Lines on work without BoQ weight (galian, curing, ...): context only. */
  context: DiaryLine[];
  lines: DiaryLine[];
}

/** The status the diary proposes for one work area, or null when it has no lines. */
export function proposeFromDiary(weights: StageWeights, prevPct: StagePct, lines: DiaryLine[]): DiaryProposal | null {
  if (lines.length === 0) return null;
  const sorted = [...lines].sort(newestFirst);
  const single = isSingle(weights);
  const stages: DiaryStageStatus[] = [];
  const pct: StagePct = {};
  for (const stage of stagesOf(weights)) {
    const prev = prevPct[stage] ?? 0;
    const latest = single ? sorted[0] : sorted.find((l) => l.stage === stage);
    if (!latest) {
      pct[stage] = prev;
      continue;
    }
    const status = statusOfActivity(latest.activity_state);
    stages.push({ stage, status, reportNo: latest.report_no, date: latest.period_end });
    pct[stage] = Math.max(prev, pctOfStatus(status));
  }
  const changed = stagesOf(weights).some((s) => (pct[s] ?? 0) !== (prevPct[s] ?? 0));
  const context = single ? [] : sorted.filter((l) => !isWeightBearingStage(l.stage));
  return { pct, changed, stages, context, lines: sorted };
}

/** "Dari laporan #14: Bekisting selesai · Pembesian berjalan"; empty when the diary names no weighted stage. */
export function diarySummary(proposal: DiaryProposal | null | undefined): string {
  if (!proposal || proposal.stages.length === 0) return '';
  const reports = [...new Set(proposal.stages.map((s) => s.reportNo))].sort((a, b) => a - b).map((n) => `#${n}`).join(', ');
  const parts = proposal.stages.map((s) => `${stageKeyLabel(s.stage)} ${stageStatusLabel(s.status).toLowerCase()}`);
  return `Dari laporan ${reports}: ${parts.join(' · ')}`;
}
