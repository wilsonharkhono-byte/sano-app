// SANO — Pure display helpers for the "Kejadian ruangan (AI)" subsection of
// the AI Usage Summary report (follow-up to plan 4 Task 8's D18 deviation).
//
// tools/reports.ts's readSiteEventAiUsage() already computes SiteEventAiUsage
// (totals, by_stage, unknown_cost_runs, unknown_token_runs) but nothing reads
// it — it sits on ReportPayload.data.site_events unused. This module is the
// ONE place that turns that block into label/number strings, shared by
// ReportPreview.tsx, tools/excel.ts and tools/pdf.ts so the three renderers
// never drift from each other and never re-derive the truth-contract notes
// on their own (CLAUDE.md §12 / §1.1: unknown beats a made-up number).
//
// Dependency-free (no supabase, no react-native) — same discipline as
// tools/planDrift.ts. Unit-tests without mocking.

import type { SiteEventAiUsage } from './reports';

const STAGE_LABELS: Readonly<Record<string, string>> = {
  transcribe: 'Transkripsi suara',
  analyze: 'Analisis draf',
};

/**
 * "Transkripsi suara" / "Analisis draf" for the two known pipeline stages
 * (site-event-analyze/stages.ts: 'transcribe' | 'analyze'). Falls back to the
 * raw stage string for anything else, so a future stage still shows up
 * instead of silently vanishing from the report.
 */
export function siteEventStageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** "US$0.013000" — 6 decimals matches reports.ts's round6; a single run can cost fractions of a cent. */
export function formatUsd(n: number): string {
  return `US$${n.toFixed(6)}`;
}

export interface SiteEventAiUsageStageDisplay {
  stage: string;
  label: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface SiteEventAiUsageDisplay {
  stages: SiteEventAiUsageStageDisplay[];
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  /** Exact copy per spec — null when unknown_cost_runs is 0 (nothing to disclaim). */
  unknownCostNote: string | null;
  /** Same idea as unknownCostNote, worded for tokens instead of biaya. */
  unknownTokenNote: string | null;
  /** Passthrough of SiteEventAiUsage.error — the read itself failed (RLS / missing 097), not "zero runs". */
  error: string | null;
}

/**
 * Builds the display model for the subsection. Returns null when `usage`
 * itself is absent/undefined — i.e. an older report payload generated before
 * this block existed. Callers must render NOTHING in that case, never a
 * zeroed-out table that implies "we checked and there was no AI spend."
 *
 * A *present* block with total_runs === 0 (readSiteEventAiUsage's empty
 * result) is a different, honest state — "we checked, there were no runs in
 * this window" — and DOES render, with zero counts.
 */
export function buildSiteEventAiUsageDisplay(
  usage: SiteEventAiUsage | null | undefined,
): SiteEventAiUsageDisplay | null {
  if (!usage) return null;

  const stages: SiteEventAiUsageStageDisplay[] = usage.by_stage.map((s) => ({
    stage: s.stage,
    label: siteEventStageLabel(s.stage),
    runCount: s.run_count,
    inputTokens: s.input_tokens,
    outputTokens: s.output_tokens,
    totalTokens: s.total_tokens,
    costUsd: s.cost_usd,
  }));

  return {
    stages,
    totalRuns: usage.total_runs,
    totalInputTokens: usage.total_input_tokens,
    totalOutputTokens: usage.total_output_tokens,
    totalTokens: usage.total_tokens,
    totalCostUsd: usage.total_cost_usd,
    unknownCostNote: usage.unknown_cost_runs > 0
      ? `${usage.unknown_cost_runs} analisis tanpa biaya diketahui (model tidak dikenali) tidak termasuk dalam total.`
      : null,
    unknownTokenNote: usage.unknown_token_runs > 0
      ? `${usage.unknown_token_runs} analisis tanpa token diketahui (model tidak dikenali) tidak termasuk dalam total.`
      : null,
    error: usage.error ?? null,
  };
}
