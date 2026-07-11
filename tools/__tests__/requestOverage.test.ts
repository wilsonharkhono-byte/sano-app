import {
  makeOverageComponents,
  formatRunningTotalMessage,
  overageBand,
  capFlagAtWarning,
  buildOverageResult,
  requiresOverageReason,
  projectedTotal,
  OVERAGE_REASONS,
  OVERAGE_REASON_LABELS,
} from '../requestOverage';
import type { FlagLevel, OverageComponents } from '../types';

// Spec §3 canonical example: planned 1000, PO 900, other-open 60, this 50 → 101%.
const project = (o: Partial<OverageComponents> = {}): OverageComponents =>
  makeOverageComponents({
    grainLabel: 'Proyek',
    poOrdered: 900,
    otherOpen: 60,
    thisRequest: 50,
    planned: 1000,
    unit: 'kg',
    ...o,
  });

describe('projectedTotal', () => {
  it('sums PO + other-open + this', () => {
    expect(projectedTotal({ poOrdered: 900, otherOpen: 60, thisRequest: 50 })).toBe(1010);
  });
  it('treats a null PO leg (Tier-1 grain) as 0', () => {
    expect(projectedTotal({ poOrdered: null, otherOpen: 60, thisRequest: 50 })).toBe(110);
  });
});

describe('makeOverageComponents', () => {
  it('computes projectedPct against plan', () => {
    expect(project().projectedPct).toBeCloseTo(101, 5);
  });
  it('is 0% when planned is 0 (no baseline)', () => {
    expect(project({ planned: 0 }).projectedPct).toBe(0);
  });
});

describe('formatRunningTotalMessage — spec §3 copy', () => {
  it('matches the canonical running total exactly (project grain, PO leg present)', () => {
    const msg = formatRunningTotalMessage(project());
    expect(msg).toBe(
      'Proyek — Sudah di-PO 900 kg + permintaan berjalan 60 kg + permintaan ini 50 kg '
      + '= 1.010 kg dari rencana 1.000 kg (101%)',
    );
  });

  it('omits the "Sudah di-PO" leg at a grain with no PO dimension (Tier-1)', () => {
    const c = makeOverageComponents({
      grainLabel: 'Grup: Bekisting Balok Lt. 2', poOrdered: null,
      otherOpen: 60, thisRequest: 50, planned: 100, unit: 'kg',
    });
    const msg = formatRunningTotalMessage(c);
    expect(msg).not.toContain('Sudah di-PO');
    expect(msg).toContain('Grup: Bekisting Balok Lt. 2');
    expect(msg).toContain('permintaan berjalan 60 kg + permintaan ini 50 kg = 110 kg');
    expect(msg).toContain('dari rencana 100 kg (110%)');
  });

  it('supports an injected supplier-unit formatter (batang)', () => {
    const c = makeOverageComponents({
      grainLabel: 'Grup: Pondasi', poOrdered: null, otherOpen: 0, thisRequest: 125,
      planned: 4452, unit: 'kg',
    });
    const fmt = (n: number, unit: string) => `${(n / 12.5).toLocaleString('id-ID', { maximumFractionDigits: 2 })} batang (${Math.round(n).toLocaleString('id-ID')} ${unit})`;
    const msg = formatRunningTotalMessage(c, fmt);
    expect(msg).toContain('permintaan ini 10 batang (125 kg)');
    expect(msg).toContain('dari rencana 356,16 batang (4.452 kg)');
  });
});

describe('overageBand — WARNING cap, escalating copy', () => {
  it('>120% → WARNING, "jauh melebihi alokasi" (was CRITICAL pre-069)', () => {
    const b = overageBand(130, true);
    expect(b.flag).toBe('WARNING');
    expect(b.suffix).toContain('jauh melebihi alokasi');
  });
  it('>100% → WARNING, "melebihi total alokasi" (was HIGH pre-069)', () => {
    const b = overageBand(105, true);
    expect(b.flag).toBe('WARNING');
    expect(b.suffix).toContain('melebihi total alokasi');
  });
  it('80–100% → WARNING approaching (unchanged band)', () => {
    expect(overageBand(89, true).flag).toBe('WARNING');
  });
  it('50–80% → INFO when the info band applies (Tier-2/3)', () => {
    expect(overageBand(65, true).flag).toBe('INFO');
  });
  it('50–80% → OK when the info band does not apply (Tier-1 has no INFO tier)', () => {
    expect(overageBand(65, false).flag).toBe('OK');
  });
  it('≤50% → OK', () => {
    expect(overageBand(10, true).flag).toBe('OK');
  });
  it('never returns HIGH or CRITICAL at any percentage', () => {
    for (const pct of [90, 100.1, 120.1, 500, 9999]) {
      expect(['OK', 'INFO', 'WARNING']).toContain(overageBand(pct, true).flag);
    }
  });
});

describe('capFlagAtWarning', () => {
  const cases: Array<[FlagLevel, FlagLevel]> = [
    ['OK', 'OK'], ['INFO', 'INFO'], ['WARNING', 'WARNING'], ['HIGH', 'WARNING'], ['CRITICAL', 'WARNING'],
  ];
  it.each(cases)('%s → %s', (input, expected) => {
    expect(capFlagAtWarning(input)).toBe(expected);
  });
});

describe('buildOverageResult', () => {
  it('produces WARNING + spec copy + carries components for the canonical case', () => {
    const r = buildOverageResult(project(), '1a');
    expect(r.flag).toBe('WARNING');
    expect(r.msg).toContain('Sudah di-PO 900 kg + permintaan berjalan 60 kg + permintaan ini 50 kg');
    expect(r.msg).toContain('= 1.010 kg dari rencana 1.000 kg (101%)');
    expect(r.msg).toContain('melebihi total alokasi');
    expect(r.overage?.projectedPct).toBeCloseTo(101, 5);
  });
  it('always attaches .overage even in the OK band (for evidence + panels)', () => {
    const r = buildOverageResult(project({ poOrdered: 0, otherOpen: 0, thisRequest: 50 }), '1a');
    expect(r.flag).toBe('OK');
    expect(r.overage).toBeDefined();
  });
});

describe('requiresOverageReason — >100% crossing predicate', () => {
  it('true when projected cumulative strictly exceeds 100%', () => {
    expect(requiresOverageReason(buildOverageResult(project(), '1a'))).toBe(true); // 101%
  });
  it('false exactly at 100% (strict >)', () => {
    const at100 = buildOverageResult(project({ poOrdered: 900, otherOpen: 50, thisRequest: 50 }), '1a'); // 100%
    expect(at100.overage?.projectedPct).toBe(100);
    expect(requiresOverageReason(at100)).toBe(false);
  });
  it('false below 100%', () => {
    expect(requiresOverageReason(buildOverageResult(project({ thisRequest: 10 }), '1a'))).toBe(false); // 97%
  });
  it('false when the result carries no overage components', () => {
    expect(requiresOverageReason({ flag: 'OK', check: 'x', msg: 'no overage' })).toBe(false);
    expect(requiresOverageReason(null)).toBe(false);
  });
});

describe('reason vocabulary (mirrors migration 076 CHECK + spec §3 labels)', () => {
  it('lists the five reasons', () => {
    expect(OVERAGE_REASONS).toEqual(['WASTE', 'REWORK', 'PLAN_UNDERESTIMATE', 'VARIATION', 'OTHER']);
  });
  it('labels each in Indonesian', () => {
    expect(OVERAGE_REASON_LABELS.WASTE).toBe('Kerusakan/susut lapangan');
    expect(OVERAGE_REASON_LABELS.PLAN_UNDERESTIMATE).toBe('Volume RAB kurang');
    expect(OVERAGE_REASON_LABELS.OTHER).toBe('Lainnya');
  });
});
