/**
 * Unit tests for tools/equipment.ts — the equipment (asset pool) core.
 *
 * Pure math only: computeEquipmentBalances folds an append-only ledger into
 * derived balances (owned / yard ready / yard repair / deployed per project /
 * written off per disposition). No DB — same philosophy as derivation.test.ts
 * but the fold is exported pure — the supabase module is mocked only so the
 * import chain doesn't drag the real (RN-only) client into jest.
 */

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import {
  computeEquipmentBalances,
  evaluateEquipmentAvailability,
  validateReconciliation,
  type EquipmentLedgerEvent,
  type EquipmentDisposition,
} from '../equipment';

const DISPOSITIONS: EquipmentDisposition[] = [
  { id: 'd-ok', name: 'OK — kembali', ledger_effect: 'RETURN_OK' },
  { id: 'd-repair', name: 'Rusak — bisa perbaikan', ledger_effect: 'RETURN_HOLD' },
  { id: 'd-scrap', name: 'Rusak — scrap', ledger_effect: 'WRITE_OFF' },
  { id: 'd-lost', name: 'Hilang', ledger_effect: 'WRITE_OFF' },
];

const ev = (partial: Partial<EquipmentLedgerEvent>): EquipmentLedgerEvent => ({
  material_id: 'mat-jack',
  event_type: 'OPENING',
  from_project_id: null,
  to_project_id: null,
  qty: 0,
  disposition_id: null,
  yard_bucket: null,
  ...partial,
});

describe('computeEquipmentBalances — event folding', () => {
  it('OPENING seeds owned and yard-ready', () => {
    const balances = computeEquipmentBalances([ev({ qty: 100 })], DISPOSITIONS);
    expect(balances.get('mat-jack')).toMatchObject({
      owned: 100,
      yard_ready: 100,
      yard_repair: 0,
      deployed: {},
      written_off: {},
    });
  });

  it('DEPLOY moves yard-ready to the project', () => {
    const balances = computeEquipmentBalances(
      [ev({ qty: 100 }), ev({ event_type: 'DEPLOY', to_project_id: 'p1', qty: 40 })],
      DISPOSITIONS,
    );
    expect(balances.get('mat-jack')).toMatchObject({
      owned: 100,
      yard_ready: 60,
      deployed: { p1: 40 },
    });
  });

  it('TRANSFER rolls deployed stock project-to-project (the MTN move)', () => {
    const balances = computeEquipmentBalances(
      [
        ev({ qty: 100 }),
        ev({ event_type: 'DEPLOY', to_project_id: 'p1', qty: 40 }),
        ev({ event_type: 'TRANSFER', from_project_id: 'p1', to_project_id: 'p2', qty: 15 }),
      ],
      DISPOSITIONS,
    );
    expect(balances.get('mat-jack')!.deployed).toEqual({ p1: 25, p2: 15 });
    expect(balances.get('mat-jack')!.owned).toBe(100);
  });

  it('RETURN with a RETURN_OK disposition goes back to yard-ready', () => {
    const balances = computeEquipmentBalances(
      [
        ev({ qty: 100 }),
        ev({ event_type: 'DEPLOY', to_project_id: 'p1', qty: 40 }),
        ev({ event_type: 'RETURN', from_project_id: 'p1', qty: 30, disposition_id: 'd-ok' }),
      ],
      DISPOSITIONS,
    );
    expect(balances.get('mat-jack')).toMatchObject({
      owned: 100,
      yard_ready: 90,
      yard_repair: 0,
      deployed: { p1: 10 },
    });
  });

  it('RETURN with a RETURN_HOLD disposition lands in the repair bucket, not deployable', () => {
    const balances = computeEquipmentBalances(
      [
        ev({ qty: 100 }),
        ev({ event_type: 'DEPLOY', to_project_id: 'p1', qty: 40 }),
        ev({ event_type: 'RETURN', from_project_id: 'p1', qty: 5, disposition_id: 'd-repair' }),
      ],
      DISPOSITIONS,
    );
    expect(balances.get('mat-jack')).toMatchObject({
      yard_ready: 60,
      yard_repair: 5,
      deployed: { p1: 35 },
    });
  });

  it('WRITE_OFF from a project shrinks owned and books the disposition by name', () => {
    const balances = computeEquipmentBalances(
      [
        ev({ qty: 100 }),
        ev({ event_type: 'DEPLOY', to_project_id: 'p1', qty: 40 }),
        ev({ event_type: 'WRITE_OFF', from_project_id: 'p1', qty: 3, disposition_id: 'd-lost' }),
      ],
      DISPOSITIONS,
    );
    expect(balances.get('mat-jack')).toMatchObject({
      owned: 97,
      deployed: { p1: 37 },
      written_off: { Hilang: 3 },
    });
  });

  it('REPAIRED drains the repair bucket back to ready', () => {
    const balances = computeEquipmentBalances(
      [
        ev({ qty: 10 }),
        ev({ event_type: 'DEPLOY', to_project_id: 'p1', qty: 10 }),
        ev({ event_type: 'RETURN', from_project_id: 'p1', qty: 10, disposition_id: 'd-repair' }),
        ev({ event_type: 'REPAIRED', qty: 4 }),
      ],
      DISPOSITIONS,
    );
    expect(balances.get('mat-jack')).toMatchObject({ yard_ready: 4, yard_repair: 6 });
  });

  it('WRITE_OFF from the yard debits the named yard_bucket', () => {
    const balances = computeEquipmentBalances(
      [
        ev({ qty: 10 }),
        ev({ event_type: 'DEPLOY', to_project_id: 'p1', qty: 10 }),
        ev({ event_type: 'RETURN', from_project_id: 'p1', qty: 10, disposition_id: 'd-repair' }),
        ev({ event_type: 'WRITE_OFF', qty: 6, disposition_id: 'd-scrap', yard_bucket: 'REPAIR' }),
      ],
      DISPOSITIONS,
    );
    expect(balances.get('mat-jack')).toMatchObject({
      owned: 4,
      yard_repair: 4,
      written_off: { 'Rusak — scrap': 6 },
    });
  });

  it('cleans up float residue when a project is fully drained (0.1+0.2-0.3)', () => {
    const balances = computeEquipmentBalances(
      [
        ev({ qty: 1 }),
        ev({ event_type: 'DEPLOY', to_project_id: 'p1', qty: 0.1 }),
        ev({ event_type: 'DEPLOY', to_project_id: 'p1', qty: 0.2 }),
        ev({ event_type: 'RETURN', from_project_id: 'p1', qty: 0.3, disposition_id: 'd-ok' }),
      ],
      DISPOSITIONS,
    );
    // 0.1 + 0.2 - 0.3 leaves IEEE residue (~5.5e-17); the project entry must
    // still be removed — no phantom deployed row / bogus reconciliation prompt.
    expect(balances.get('mat-jack')!.deployed).toEqual({});
  });

  it('tracks each material independently', () => {
    const balances = computeEquipmentBalances(
      [ev({ qty: 100 }), ev({ material_id: 'mat-tie', qty: 500 })],
      DISPOSITIONS,
    );
    expect(balances.get('mat-jack')!.owned).toBe(100);
    expect(balances.get('mat-tie')!.owned).toBe(500);
  });

  it('throws on a RETURN/WRITE_OFF with an unknown disposition — never guesses', () => {
    expect(() =>
      computeEquipmentBalances(
        [ev({ qty: 10 }), ev({ event_type: 'RETURN', from_project_id: 'p1', qty: 1, disposition_id: 'd-nope' })],
        DISPOSITIONS,
      ),
    ).toThrow(/disposition/i);
  });
});

describe('evaluateEquipmentAvailability — the deploy gate', () => {
  const balance = { owned: 100, yard_ready: 60, yard_repair: 5, deployed: { p1: 35 }, written_off: {} };

  it('OK when the yard has enough ready stock', () => {
    expect(evaluateEquipmentAvailability(balance, 60)).toMatchObject({ flag: 'OK' });
  });

  it('SHORTAGE with the shortfall when the yard is short', () => {
    const r = evaluateEquipmentAvailability(balance, 75);
    expect(r.flag).toBe('SHORTAGE');
    expect(r.shortfall).toBe(15);
  });

  it('a missing balance means nothing is available', () => {
    const r = evaluateEquipmentAvailability(undefined, 10);
    expect(r.flag).toBe('SHORTAGE');
    expect(r.shortfall).toBe(10);
  });
});

describe('validateReconciliation — count-&-close completeness', () => {
  it('accepts lines that exactly account for the expected quantity', () => {
    const r = validateReconciliation(40, [
      { qty: 30, disposition_id: 'd-ok' },
      { qty: 7, disposition_id: 'd-repair' },
      { qty: 3, disposition_id: 'd-lost' },
    ]);
    expect(r.ok).toBe(true);
  });

  it('rejects lines that do not sum to expected (nothing silently disappears)', () => {
    const r = validateReconciliation(40, [{ qty: 30, disposition_id: 'd-ok' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/40|30/);
  });

  it('rejects non-positive line quantities', () => {
    const r = validateReconciliation(10, [
      { qty: 0, disposition_id: 'd-ok' },
      { qty: 10, disposition_id: 'd-ok' },
    ]);
    expect(r.ok).toBe(false);
  });
});
