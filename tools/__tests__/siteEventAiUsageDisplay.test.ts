import {
  siteEventStageLabel,
  formatUsd,
  buildSiteEventAiUsageDisplay,
} from '../siteEventAiUsageDisplay';
import type { SiteEventAiUsage } from '../reports';

// ── siteEventStageLabel ──────────────────────────────────────────────

describe('siteEventStageLabel', () => {
  it('maps the two known pipeline stages to their Indonesian labels', () => {
    expect(siteEventStageLabel('transcribe')).toBe('Transkripsi suara');
    expect(siteEventStageLabel('analyze')).toBe('Analisis draf');
  });

  it('falls back to the raw stage string for an unknown stage', () => {
    expect(siteEventStageLabel('unknown')).toBe('unknown');
    expect(siteEventStageLabel('future-stage')).toBe('future-stage');
  });
});

// ── formatUsd ─────────────────────────────────────────────────────────

describe('formatUsd', () => {
  it('formats with 6 decimal places and a US$ prefix', () => {
    expect(formatUsd(0.013)).toBe('US$0.013000');
    expect(formatUsd(0)).toBe('US$0.000000');
    expect(formatUsd(0.0002)).toBe('US$0.000200');
  });
});

// ── buildSiteEventAiUsageDisplay ─────────────────────────────────────

const BASE_USAGE: SiteEventAiUsage = {
  total_runs: 4,
  total_input_tokens: 6000,
  total_output_tokens: 800,
  total_tokens: 6800,
  unknown_token_runs: 1,
  total_cost_usd: 0.023,
  unknown_cost_runs: 1,
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
};

describe('buildSiteEventAiUsageDisplay', () => {
  it('returns null when the block is absent (older report payload) — render nothing, not a zeroed table', () => {
    expect(buildSiteEventAiUsageDisplay(null)).toBeNull();
    expect(buildSiteEventAiUsageDisplay(undefined)).toBeNull();
  });

  it('maps totals and per-stage rows with Indonesian labels', () => {
    const display = buildSiteEventAiUsageDisplay(BASE_USAGE);
    expect(display).not.toBeNull();
    expect(display!.totalRuns).toBe(4);
    expect(display!.totalTokens).toBe(6800);
    expect(display!.totalCostUsd).toBe(0.023);
    expect(display!.stages).toEqual([
      {
        stage: 'analyze', label: 'Analisis draf', runCount: 3,
        inputTokens: 6000, outputTokens: 800, totalTokens: 6800, costUsd: 0.02,
      },
      {
        stage: 'transcribe', label: 'Transkripsi suara', runCount: 1,
        inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0.003,
      },
    ]);
  });

  it('emits the exact unknown-cost disclaimer copy when unknown_cost_runs > 0', () => {
    const display = buildSiteEventAiUsageDisplay(BASE_USAGE);
    expect(display!.unknownCostNote).toBe(
      '1 analisis tanpa biaya diketahui (model tidak dikenali) tidak termasuk dalam total.',
    );
  });

  it('emits the analogous unknown-token disclaimer when unknown_token_runs > 0', () => {
    const display = buildSiteEventAiUsageDisplay(BASE_USAGE);
    expect(display!.unknownTokenNote).toBe(
      '1 analisis tanpa token diketahui (model tidak dikenali) tidak termasuk dalam total.',
    );
  });

  it('omits both disclaimers when there is nothing unknown to disclose', () => {
    const clean: SiteEventAiUsage = {
      ...BASE_USAGE,
      unknown_cost_runs: 0,
      unknown_token_runs: 0,
    };
    const display = buildSiteEventAiUsageDisplay(clean);
    expect(display!.unknownCostNote).toBeNull();
    expect(display!.unknownTokenNote).toBeNull();
  });

  it('renders a present-but-empty block (zero runs, no error) rather than treating it as absent', () => {
    const empty: SiteEventAiUsage = {
      total_runs: 0, total_input_tokens: 0, total_output_tokens: 0,
      total_tokens: 0, unknown_token_runs: 0, total_cost_usd: 0, unknown_cost_runs: 0, by_stage: [],
    };
    const display = buildSiteEventAiUsageDisplay(empty);
    expect(display).not.toBeNull();
    expect(display!.totalRuns).toBe(0);
    expect(display!.stages).toEqual([]);
    expect(display!.unknownCostNote).toBeNull();
    expect(display!.error).toBeNull();
  });

  it('passes through the read error rather than presenting zero spend as a known fact', () => {
    const errored: SiteEventAiUsage = {
      total_runs: 0, total_input_tokens: 0, total_output_tokens: 0,
      total_tokens: 0, unknown_token_runs: 0, total_cost_usd: 0, unknown_cost_runs: 0, by_stage: [],
      error: 'permission denied for table site_event_ai_runs',
    };
    const display = buildSiteEventAiUsageDisplay(errored);
    expect(display!.error).toBe('permission denied for table site_event_ai_runs');
  });
});
