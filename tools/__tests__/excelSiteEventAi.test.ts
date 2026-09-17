// AI Usage Summary export — "Kejadian ruangan (AI)" follow-up (plan 4 Task 8,
// D18). Verifies the two new sheets built from SiteEventAiUsage: present with
// correct numbers when the block is on the payload, absent entirely (not
// zeroed) when it is not — same "no mocking of our own code" discipline as
// excelReportRedaction.test.ts, real SheetJS objects built and read back.

import * as XLSX from 'xlsx';
import { buildAIUsageSummary } from '../excel';
import type { AIUsageData } from '../reportDataTypes';

function sheetHeader(wb: XLSX.WorkBook, sheetName: string): string[] {
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
  return (aoa[0] ?? []).map(String);
}

function sheetRows(wb: XLSX.WorkBook, sheetName: string): string[][] {
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
  return aoa.slice(1).map((row) => row.map(String));
}

const BASE_DATA: AIUsageData = {
  summary: {
    total_interactions: 0, active_users: 0, total_input_tokens: 0,
    total_output_tokens: 0, total_tokens: 0, haiku_count: 0, sonnet_count: 0,
  },
  users: [],
  usage_by_day: [],
  date_range: { from: null, to: null },
};

describe('excel.ts buildAIUsageSummary — Kejadian ruangan (AI)', () => {
  it('adds no site-event sheets when site_events is absent (older payload)', () => {
    const wb = XLSX.utils.book_new();
    buildAIUsageSummary(wb, { ...BASE_DATA });
    expect(wb.SheetNames).not.toContain('AI Kejadian Ruangan');
    expect(wb.SheetNames).not.toContain('AI Kejadian per Tahap');
  });

  it('adds the summary and per-stage sheets with the right totals and labels when present', () => {
    const wb = XLSX.utils.book_new();
    buildAIUsageSummary(wb, {
      ...BASE_DATA,
      site_events: {
        total_runs: 4, total_input_tokens: 6000, total_output_tokens: 800, total_tokens: 6800,
        unknown_token_runs: 1, total_cost_usd: 0.023, unknown_cost_runs: 1,
        by_stage: [
          {
            stage: 'analyze', run_count: 3, ok_count: 1, rejected_count: 1, error_count: 1,
            input_tokens: 6000, output_tokens: 800, total_tokens: 6800, unknown_token_runs: 1,
            cost_usd: 0.02, unknown_cost_runs: 1, models: ['claude-sonnet-5'],
          },
          {
            stage: 'transcribe', run_count: 1, ok_count: 1, rejected_count: 0, error_count: 0,
            input_tokens: 0, output_tokens: 0, total_tokens: 0, unknown_token_runs: 0,
            cost_usd: 0.003, unknown_cost_runs: 0, models: ['gpt-4o-mini-transcribe'],
          },
        ],
      },
    });

    expect(wb.SheetNames).toContain('AI Kejadian Ruangan');
    expect(wb.SheetNames).toContain('AI Kejadian per Tahap');

    const summaryRows = sheetRows(wb, 'AI Kejadian Ruangan');
    expect(summaryRows).toContainEqual(['Total Proses', '4']);
    expect(summaryRows).toContainEqual(['Total Token', '6800']);
    expect(summaryRows).toContainEqual(['Total Biaya (USD)', 'US$0.023000']);
    expect(summaryRows).toContainEqual([
      'Catatan Biaya',
      '1 analisis tanpa biaya diketahui (model tidak dikenali) tidak termasuk dalam total.',
    ]);
    expect(summaryRows).toContainEqual([
      'Catatan Token',
      '1 analisis tanpa token diketahui (model tidak dikenali) tidak termasuk dalam total.',
    ]);

    const stageHeader = sheetHeader(wb, 'AI Kejadian per Tahap');
    expect(stageHeader).toEqual(['Tahap', 'Proses', 'Token Input', 'Token Output', 'Total Token', 'Biaya (USD)']);
    const stageRows = sheetRows(wb, 'AI Kejadian per Tahap');
    expect(stageRows).toContainEqual(['Analisis draf', '3', '6000', '800', '6800', 'US$0.020000']);
    expect(stageRows).toContainEqual(['Transkripsi suara', '1', '0', '0', '0', 'US$0.003000']);
  });

  it('renders a present-but-empty block (zero runs) as zero, not as absent', () => {
    const wb = XLSX.utils.book_new();
    buildAIUsageSummary(wb, {
      ...BASE_DATA,
      site_events: {
        total_runs: 0, total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0,
        unknown_token_runs: 0, total_cost_usd: 0, unknown_cost_runs: 0, by_stage: [],
      },
    });
    expect(wb.SheetNames).toContain('AI Kejadian Ruangan');
    const summaryRows = sheetRows(wb, 'AI Kejadian Ruangan');
    expect(summaryRows).toContainEqual(['Total Proses', '0']);
    expect(summaryRows.some((row) => row[0] === 'Catatan Biaya')).toBe(false);
  });

  it('surfaces the read error rather than presenting zero spend as a known fact', () => {
    const wb = XLSX.utils.book_new();
    buildAIUsageSummary(wb, {
      ...BASE_DATA,
      site_events: {
        total_runs: 0, total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0,
        unknown_token_runs: 0, total_cost_usd: 0, unknown_cost_runs: 0, by_stage: [],
        error: 'permission denied for table site_event_ai_runs',
      },
    });
    const summaryRows = sheetRows(wb, 'AI Kejadian Ruangan');
    expect(summaryRows).toContainEqual(['Error', 'permission denied for table site_event_ai_runs']);
  });
});
