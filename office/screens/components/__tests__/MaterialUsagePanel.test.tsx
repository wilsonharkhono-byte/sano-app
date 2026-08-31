import React from 'react';
import { render } from '@testing-library/react-native';
import { MaterialUsagePanel } from '../MaterialUsagePanel';
import type { EnvelopeWithPrice } from '../../../../tools/envelopes';

describe('MaterialUsagePanel', () => {
  it('renders "Tidak ada alokasi pembanding" for an unlinked/free-text line', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId={null}
        customMaterialName="Material X"
        tier={null}
        requestedQuantity={50}
        requestedUnit="unit"
        envelope={null}
      />,
    );
    expect(getByText(/Tidak ada alokasi pembanding/i)).toBeTruthy();
  });
});

const tier2Envelope = (m: Partial<EnvelopeWithPrice> = {}): EnvelopeWithPrice => ({
  material_id: 'mat-bata',
  project_id: 'proj-1',
  material_code: 'AAC-BL07',
  material_name: 'Bata ringan 7.5 cm',
  tier: 2,
  unit: 'pcs',
  total_planned: 5000,
  total_ordered: 200,
  total_requested: 350,
  total_received: 0,
  remaining_to_order: 4800,
  burn_pct: 4,
  boq_item_count: 8,
  baseline_unit_price: 6000,
  envelope_total_rupiah: 30_000_000,
  envelope_used_rupiah: 1_200_000,
  envelope_remaining_rupiah: 28_800_000,
  ...m,
});

describe('MaterialUsagePanel — Tier 2', () => {
  it('renders quantity envelope with burn percent and both remaining figures', () => {
    const { getByText, getAllByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={tier2Envelope()}
      />,
    );
    // "Di-PO" surfaces the SANO PO qty (total_ordered).
    expect(getByText(/Di-PO: 200 \/ 5\.000 pcs/)).toBeTruthy();
    expect(getByText(/4%/)).toBeTruthy();
    // total_requested 350 self-excludes this request's own 200 → 150
    // other-open, labeled EXACTLY like the Block-A overage panel above it
    // (both are project grain for a Tier-2 line, so the two panels agree
    // byte-for-byte — hence 2 matches, not a collision).
    expect(getAllByText(/Permintaan berjalan lain: 150 pcs/)).toHaveLength(2);
    expect(getAllByText(/Permintaan ini: 200 pcs/)).toHaveLength(2);
    // remainingToOrder = planned(5.000) − ordered(200) = 4.800 (hard cap,
    // requests not subtracted).
    expect(getByText(/Sisa untuk di-PO \(batas keras\): 4\.800 pcs/)).toBeTruthy();
    // remainingFree = max(0, 5.000 − 200 − 350) = 4.450 (all commitments
    // subtracted, including this request since it's already counted in
    // total_requested at review time).
    expect(getByText(/Sisa bebas \(belum terikat permintaan\): 4\.450 pcs/)).toBeTruthy();
  });

  it('falls back to the self-inclusive label on Block B when the request quantity is not a finite number', () => {
    // Defensive branch: MaterialUsagePanelProps.requestedQuantity is typed as
    // a required `number`, so this is not reachable from ApprovalsScreen
    // today — asserted directly to document the "self-exclusion isn't
    // possible" contract from the task brief without needing a new caller.
    // Block A (renderOverageRunningTotal) is a separate, pre-existing code
    // path this task doesn't touch, so this only asserts Block B's own text.
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={NaN}
        requestedUnit="pcs"
        envelope={tier2Envelope()}
      />,
    );
    expect(getByText(/Permintaan berjalan \(termasuk permintaan ini\): 350 pcs/)).toBeTruthy();
  });

  it('renders Rupiah envelope when baseline_unit_price is present', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={tier2Envelope()}
      />,
    );
    expect(getByText(/Rp 1\.2 jt \/ Rp 30 jt/)).toBeTruthy();
    expect(getByText(/Sisa: Rp 28\.8 jt/)).toBeTruthy();
  });

  it('hides Rupiah block when baseline_unit_price is null', () => {
    const { getByText, queryByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={tier2Envelope({ baseline_unit_price: null, envelope_total_rupiah: null, envelope_used_rupiah: null, envelope_remaining_rupiah: null })}
      />,
    );
    expect(queryByText(/Rp/)).toBeNull();
    expect(getByText(/Anggaran tidak tersedia/i)).toBeTruthy();
  });

  it('shows red warning when burn percent exceeds 100', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={500}
        requestedUnit="pcs"
        envelope={tier2Envelope({ total_ordered: 5500, burn_pct: 110, remaining_to_order: -500, envelope_used_rupiah: 33_000_000, envelope_remaining_rupiah: -3_000_000 })}
      />,
    );
    expect(getByText(/⚠ Envelope sudah terlampaui/i)).toBeTruthy();
  });

  it('shows "Tidak ada alokasi pembanding" when the envelope is null', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={null}
      />,
    );
    expect(getByText(/Tidak ada alokasi pembanding/i)).toBeTruthy();
  });

  it('renders the recomputed Signal-1 overage running total (planned/di-PO/berjalan/ini/proyeksi) + reason', () => {
    // planned 1000, di-PO 900, total_requested 110 (incl. this 50) → other-open
    // 60; projected 900+60+50 = 1010 = 101%.
    const { getByText, getAllByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={50}
        requestedUnit="kg"
        envelope={tier2Envelope({ unit: 'kg', total_planned: 1000, total_ordered: 900, total_requested: 110 })}
        overageReason="PLAN_UNDERESTIMATE"
        overageNote="RAB kurang di zona B"
      />,
    );
    expect(getByText(/Rencana: 1\.000 kg/)).toBeTruthy();
    expect(getByText(/Sudah di-PO: 900 kg/)).toBeTruthy();
    // Block B (Envelope kuantitas) below shares the same project grain, so it
    // renders the identical self-excluded figures too — 2 matches each, not
    // a collision (see the label-collision test above for the same pattern).
    expect(getAllByText(/Permintaan berjalan lain: 60 kg/)).toHaveLength(2);
    expect(getAllByText(/Permintaan ini: 50 kg/)).toHaveLength(2);
    expect(getByText(/Proyeksi: 1\.010 kg \(101%\)/)).toBeTruthy();
    expect(getByText(/Melebihi total alokasi/i)).toBeTruthy();
    expect(getByText(/Alasan pengaju: Volume RAB kurang — RAB kurang di zona B/)).toBeTruthy();
  });

  it('renders boq_item_count when present', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={tier2Envelope({ boq_item_count: 8 })}
      />,
    );
    expect(getByText(/Melayani 8 item BoQ/i)).toBeTruthy();
  });
});

const tier1BoqItem = (m: Partial<{ planned: number; installed: number; code: string; label: string }> = {}) => ({
  planned: 10.2,
  installed: 3.2,
  code: 'III.A.1',
  label: 'Sloof S24-1',
  ...m,
});

describe('MaterialUsagePanel — Tier 1', () => {
  it('renders BoQ planned/installed/remaining', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-beton"
        tier={1}
        requestedQuantity={2.5}
        requestedUnit="m3"
        boqItemId="boq-1"
        envelope={tier2Envelope({ tier: 1, material_name: 'Beton K-225', unit: 'm3', total_planned: 10.2, total_ordered: 3.2, remaining_to_order: 7.0, burn_pct: 31.4 })}
        boqItem={tier1BoqItem()}
      />,
    );
    expect(getByText(/III\.A\.1 — Sloof S24-1/)).toBeTruthy();
    expect(getByText(/Volume rencana:\s+10[,.]2 m3/)).toBeTruthy();
    expect(getByText(/Sudah dipasang:\s+3[,.]2 m3/)).toBeTruthy();
    expect(getByText(/Sisa BoQ:\s+7 m3/)).toBeTruthy();
    expect(getByText(/Setelah request:\s+4[,.]5 m3 tersisa/)).toBeTruthy();
  });

  it('renders red warning when request exceeds remaining', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-beton"
        tier={1}
        requestedQuantity={10}
        requestedUnit="m3"
        boqItemId="boq-1"
        envelope={tier2Envelope({ tier: 1, material_name: 'Beton K-225', unit: 'm3' })}
        boqItem={tier1BoqItem()}
      />,
    );
    expect(getByText(/⚠ Akan melampaui BoQ rencana/i)).toBeTruthy();
  });

  it('falls back to envelope view when boqItem is null', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-beton"
        tier={1}
        requestedQuantity={2.5}
        requestedUnit="m3"
        boqItemId="boq-orphan"
        envelope={tier2Envelope({ tier: 1, material_name: 'Beton K-225', unit: 'm3' })}
        boqItem={null}
      />,
    );
    // Falls back to envelope-style display; should not crash, should show envelope numbers
    expect(getByText(/Envelope kuantitas/i)).toBeTruthy();
  });

  // Design spec §3 remediation — Change 1: a WORKGROUP_ENVELOPE line (no DIRECT
  // boq_item allocation) must show the WORK-GROUP grain prominently, not just
  // the project-wide figures. Change 2: the Tier-1 line must not claim
  // "Anggaran tidak tersedia" — cost isn't tracked per material at Tier 1 by
  // design.
  it('renders the group-grain envelope panel + Tier-1 cost wording when groupEnvelope is provided', () => {
    const { getByText, getAllByText, queryByText } = render(
      <MaterialUsagePanel
        materialId="mat-besi-d13"
        tier={1}
        requestedQuantity={200}
        requestedUnit="kg"
        boqItemId="boq-t1-005"
        envelope={tier2Envelope({
          tier: 1, material_name: 'Besi D13', unit: 'kg',
          total_planned: 50000, total_ordered: 8000, total_requested: 10996,
          baseline_unit_price: null, envelope_total_rupiah: null, envelope_used_rupiah: null, envelope_remaining_rupiah: null,
        })}
        boqItem={null}
        groupEnvelope={{ label: 'Lantai 1 ; Boredpile', planned: 1600, ordered: 400, requested: 1174.6, unit: 'kg' }}
      />,
    );
    // Group grain, prominent, explicitly labeled.
    expect(getByText(/Envelope kuantitas — Grup: Lantai 1 ; Boredpile/)).toBeTruthy();
    expect(getByText(/Rencana grup: 1\.600 kg/)).toBeTruthy();
    expect(getByText(/Sudah di-PO \(grup\): 400 kg/)).toBeTruthy();
    // requested 1174.6 includes this request's own 200 → self-excluded: 974.6.
    expect(getByText(/Permintaan berjalan lain \(grup\): 974[,.]6 kg/)).toBeTruthy();
    // Three panels now show "Permintaan ini" with the same quantity: the
    // project-grain overage panel (Block A, unconditional), the group panel
    // (Block C), and the project-grain "Envelope kuantitas" panel (Block B) —
    // which, since Task 1, also self-excludes and shows its own "Permintaan
    // ini" line instead of a raw total.
    expect(getAllByText(/Permintaan ini: 200 kg/)).toHaveLength(3);
    // Block A and Block B are both project grain against the same envelope,
    // so their self-excluded "other open" figures (10.996 total_requested −
    // 200 this request = 10.796) now agree byte-for-byte too.
    expect(getAllByText(/Permintaan berjalan lain: 10\.796 kg/)).toHaveLength(2);
    // Proyeksi grup = 400 + 974.6 + 200 = 1574.6 / 1600 = 98%.
    expect(getByText(/Proyeksi grup: 1\.574[,.]6 kg \(98%\)/)).toBeTruthy();
    // Project grain stays visible too, explicitly labeled so the two can't be confused.
    expect(getByText(/Envelope kuantitas — Proyek/)).toBeTruthy();
    // Grain disclosure (Task 2): the group panel's header states the
    // denominator relationship to the project plan inline.
    expect(getByText(/Rencana grup: 1\.600 kg — dari total proyek 50\.000 kg/)).toBeTruthy();
    // Change 2: Tier-1 wording, not the Tier-2 "Anggaran tidak tersedia" copy.
    expect(getByText(/Tier 1: kontrol kuantitas — biaya tidak dilacak per material\./)).toBeTruthy();
    expect(queryByText(/Anggaran tidak tersedia/i)).toBeNull();
  });

  it('flags the group envelope as critical when the group projection exceeds 100%', () => {
    // planned 1000, ordered 1200, requested == thisQty (self-excludes to 0
    // otherOpen) → projected 1200 + 0 + 500 = 1700 = 170% > 100.
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-besi-d13"
        tier={1}
        requestedQuantity={500}
        requestedUnit="kg"
        boqItemId="boq-t1-005"
        envelope={tier2Envelope({ tier: 1, material_name: 'Besi D13', unit: 'kg', total_planned: 50000 })}
        boqItem={null}
        groupEnvelope={{ label: 'Lantai 1 ; Boredpile', planned: 1000, ordered: 1200, requested: 500, unit: 'kg' }}
      />,
    );
    expect(getByText(/⚠ Melebihi alokasi grup/i)).toBeTruthy();
  });

  it('shows a no-baseline note (not a fake 0%) when the group has no planned demand', () => {
    const { getByText, queryByText } = render(
      <MaterialUsagePanel
        materialId="mat-besi-d13"
        tier={1}
        requestedQuantity={50}
        requestedUnit="kg"
        boqItemId="boq-t1-009"
        envelope={tier2Envelope({ tier: 1, material_name: 'Besi D13', unit: 'kg', total_planned: 50000 })}
        boqItem={null}
        groupEnvelope={{ label: 'Atap', planned: 0, ordered: 0, requested: 0, unit: 'kg' }}
      />,
    );
    expect(getByText(/Tidak ada alokasi pembanding untuk grup ini/)).toBeTruthy();
    expect(queryByText(/\(0%\)/)).toBeNull();
  });

  it('falls back to the project-grain-only panel (old behavior) when groupEnvelope is null', () => {
    const { getByText, queryByText } = render(
      <MaterialUsagePanel
        materialId="mat-besi-d13"
        tier={1}
        requestedQuantity={50}
        requestedUnit="kg"
        boqItemId="boq-t1-009"
        envelope={tier2Envelope({
          tier: 1, material_name: 'Besi D13', unit: 'kg', total_planned: 50000,
          baseline_unit_price: null, envelope_total_rupiah: null, envelope_used_rupiah: null, envelope_remaining_rupiah: null,
        })}
        boqItem={null}
        groupEnvelope={null}
      />,
    );
    expect(queryByText(/Envelope kuantitas — Grup:/)).toBeNull();
    expect(getByText(/Envelope kuantitas — Proyek/)).toBeTruthy();
    expect(getByText(/Tier 1: kontrol kuantitas — biaya tidak dilacak per material\./)).toBeTruthy();
  });

  it('keeps the original Tier-2 "Anggaran tidak tersedia" wording unchanged', () => {
    const { getByText, queryByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={tier2Envelope({ baseline_unit_price: null, envelope_total_rupiah: null, envelope_used_rupiah: null, envelope_remaining_rupiah: null })}
      />,
    );
    expect(getByText(/Anggaran tidak tersedia \(harga acuan kosong di AHS\)\./)).toBeTruthy();
    expect(queryByText(/kontrol kuantitas/i)).toBeNull();
  });
});

describe('MaterialUsagePanel — Tier 3', () => {
  it('renders spend cap with estimated cost', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-paku"
        tier={3}
        requestedQuantity={5}
        requestedUnit="kg"
        envelope={tier2Envelope({ tier: 3, material_name: 'Paku 7 cm', unit: 'kg', baseline_unit_price: 15_000, envelope_total_rupiah: null, envelope_used_rupiah: null, envelope_remaining_rupiah: null })}
      />,
    );
    expect(getByText(/Estimasi biaya:\s+Rp 75rb/i)).toBeTruthy();
    expect(getByText(/Spend cap per request:\s+Rp 5 jt/i)).toBeTruthy();
    expect(getByText(/1\.5%/)).toBeTruthy();   // 75k / 5jt = 1.5%
  });

  it('renders fallback when baseline_unit_price is missing', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-paku"
        tier={3}
        requestedQuantity={5}
        requestedUnit="kg"
        envelope={tier2Envelope({ tier: 3, material_name: 'Paku 7 cm', unit: 'kg', baseline_unit_price: null, envelope_total_rupiah: null, envelope_used_rupiah: null, envelope_remaining_rupiah: null })}
      />,
    );
    expect(getByText(/Estimasi biaya tidak tersedia/i)).toBeTruthy();
  });
});

// material_request_lines.tier has allowed 4 (untracked consumable) since
// migration 053_tier4_request_lines.sql, and PermintaanScreen already lets
// estimators submit tier-4 request lines (commit 21cde48) — this office
// review side must render them without crashing or falling into the
// generic "tier tidak terdefinisi" warning branch.
describe('MaterialUsagePanel — Tier 4', () => {
  it('renders the untracked-consumable notice, not the unknown-tier fallback', () => {
    const { getByText, queryByText } = render(
      <MaterialUsagePanel
        materialId="mat-oli"
        tier={4}
        requestedQuantity={2}
        requestedUnit="liter"
        envelope={tier2Envelope({ tier: 4, material_name: 'Oli bekisting', unit: 'liter' })}
      />,
    );
    expect(getByText(/Tier 4 consumable — tidak dilacak anggaran/i)).toBeTruthy();
    expect(queryByText(/Material tier tidak terdefinisi/i)).toBeNull();
  });
});
