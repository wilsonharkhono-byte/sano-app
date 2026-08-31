import {
  remainingToOrder,
  remainingFree,
  projected,
  burnPct,
  type EnvelopeLegs,
} from '../envelopeMath';

function legs(partial: Partial<EnvelopeLegs> = {}): EnvelopeLegs {
  return { planned: 1000, ordered: 0, requested: 0, ...partial };
}

describe('remainingToOrder — "Sisa untuk di-PO" (hard-gate headroom)', () => {
  it('is planned − ordered, and does NOT subtract requests', () => {
    // The double-block trap: a PO fulfils a request, so subtracting the running
    // request as well would block the very order the request asked for.
    expect(remainingToOrder(legs({ ordered: 300, requested: 400 }))).toBe(700);
  });

  it('matches the server gate figure exactly (088:671 / 071 remaining = planned − ordered)', () => {
    expect(remainingToOrder(legs({ planned: 4452, ordered: 1200, requested: 999 }))).toBe(3252);
  });

  it('returns a NEGATIVE headroom when already over-ordered — never floored', () => {
    // Over-PO happens via an approved principal override. Hiding the sign would
    // let the next PO look like it still has room.
    expect(remainingToOrder(legs({ planned: 100, ordered: 130 }))).toBe(-30);
  });

  it('is 0 at exact exhaustion', () => {
    expect(remainingToOrder(legs({ planned: 100, ordered: 100 }))).toBe(0);
  });

  it('treats a missing/NaN leg as a zero sum rather than propagating NaN', () => {
    expect(remainingToOrder(legs({ ordered: NaN }))).toBe(1000);
    expect(remainingToOrder({ planned: NaN, ordered: 10, requested: 0 })).toBe(-10);
  });
});

describe('remainingFree — "Sisa bebas" (uncommitted after running requests)', () => {
  it('subtracts BOTH ordered and requested', () => {
    expect(remainingFree(legs({ ordered: 300, requested: 400 }))).toBe(300);
  });

  it('floors at 0 when the plan is fully committed or overcommitted', () => {
    expect(remainingFree(legs({ planned: 100, ordered: 80, requested: 40 }))).toBe(0);
    expect(remainingFree(legs({ planned: 100, ordered: 200, requested: 50 }))).toBe(0);
  });

  it('differs from remainingToOrder exactly by the requested leg — the two labels are not interchangeable', () => {
    const l = legs({ planned: 1000, ordered: 250, requested: 150 });
    expect(remainingToOrder(l)).toBe(750);
    expect(remainingFree(l)).toBe(600);
    expect(remainingToOrder(l) - remainingFree(l)).toBe(l.requested);
  });

  it('equals remainingToOrder when nothing is requested', () => {
    const l = legs({ ordered: 250 });
    expect(remainingFree(l)).toBe(remainingToOrder(l));
  });
});

describe('projected — committed projection', () => {
  it('is ordered + requested + thisQty', () => {
    expect(projected(legs({ ordered: 100, requested: 50 }), 25)).toBe(175);
  });

  it('defaults thisQty to 0', () => {
    expect(projected(legs({ ordered: 100, requested: 50 }))).toBe(150);
  });

  it('self-exclusion contract: the line under evaluation is counted once, not twice', () => {
    // A request line of 40 already sits inside the stored total (requested=90).
    // Re-checking it must remove it from the leg and pass it as thisQty.
    const stored = 90;
    const thisLine = 40;
    const selfExcluded = legs({ ordered: 100, requested: stored - thisLine });

    expect(projected(selfExcluded, thisLine)).toBe(190);
    // The naive call — leg NOT self-excluded — inflates by exactly this line.
    expect(projected(legs({ ordered: 100, requested: stored }), thisLine)).toBe(230);
  });

  it('a projection over the plan is returned as-is for the caller to compare', () => {
    const l = legs({ planned: 100, ordered: 90, requested: 20 });
    expect(projected(l, 5)).toBe(115);
    expect(projected(l, 5) > l.planned).toBe(true);
  });
});

describe('burnPct', () => {
  it("basis 'po' burns ordered only — the envelope view's burn_pct (072:378)", () => {
    expect(burnPct(legs({ planned: 1000, ordered: 250, requested: 500 }), 'po')).toBe(25);
  });

  it("basis 'requests' burns request demand only", () => {
    expect(burnPct(legs({ planned: 1000, ordered: 250, requested: 500 }), 'requests')).toBe(50);
  });

  it("basis 'committed' burns ordered + requested", () => {
    expect(burnPct(legs({ planned: 1000, ordered: 250, requested: 500 }), 'committed')).toBe(75);
  });

  it('adds extraQty for the line being typed', () => {
    expect(burnPct(legs({ planned: 1000, ordered: 250, requested: 500 }), 'committed', 100)).toBe(85);
    expect(burnPct(legs({ planned: 1000, ordered: 250 }), 'po', 250)).toBe(50);
  });

  it('returns null when planned is 0 — cannot evaluate, never a fake 0%', () => {
    // The whole point: 0% reads as "nothing used yet". With no plan the honest
    // answer is "tidak terukur" (CLAUDE.md §1.1).
    expect(burnPct(legs({ planned: 0, ordered: 500 }), 'po')).toBeNull();
    expect(burnPct(legs({ planned: 0 }), 'committed', 10)).toBeNull();
  });

  it('returns null for a negative or non-finite plan too', () => {
    expect(burnPct(legs({ planned: -5, ordered: 1 }), 'po')).toBeNull();
    expect(burnPct({ planned: NaN, ordered: 10, requested: 0 }, 'po')).toBeNull();
  });

  it('reports over-100% rather than capping — an overrun must stay visible', () => {
    expect(burnPct(legs({ planned: 100, ordered: 140 }), 'po')).toBe(140);
    expect(burnPct(legs({ planned: 100, ordered: 90, requested: 60 }), 'committed')).toBe(150);
  });

  it('is unrounded — formatting belongs at the display boundary', () => {
    expect(burnPct(legs({ planned: 3, ordered: 1 }), 'po')).toBeCloseTo(33.3333333, 6);
  });

  it('non-finite ordered/requested legs count as 0 instead of poisoning the percentage', () => {
    expect(burnPct({ planned: 100, ordered: NaN, requested: 40 }, 'committed')).toBe(40);
  });
});

describe('the five-formula problem this module exists to end', () => {
  it('one set of legs answers each surface\'s question differently — by design, with names', () => {
    // planned 1000, one PO of 300 booked, 200 kg of approved requests still
    // awaiting a PO (link-aware: nothing double-counted).
    const l = legs({ planned: 1000, ordered: 300, requested: 200 });

    expect(remainingToOrder(l)).toBe(700); // admin/estimator: what a PO may still book
    expect(remainingFree(l)).toBe(500);    // supervisor: what may still be asked for
    expect(burnPct(l, 'po')).toBe(30);
    expect(burnPct(l, 'committed')).toBe(50);

    // The invariant that keeps the story consistent: free = headroom − requested.
    expect(remainingFree(l)).toBe(remainingToOrder(l) - l.requested);
  });
});
