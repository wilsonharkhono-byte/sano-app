import React from 'react';
import { render } from '@testing-library/react-native';
import { MaterialUsagePanel } from '../MaterialUsagePanel';
import type { EnvelopeWithPrice } from '../../../../tools/envelopes';

describe('MaterialUsagePanel', () => {
  it('renders unlinked-material warning when materialId is null', () => {
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
    expect(getByText(/tidak terdaftar di katalog/i)).toBeTruthy();
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
  it('renders quantity envelope with burn percent', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={tier2Envelope()}
      />,
    );
    expect(getByText(/200 \/ 5,000 pcs/)).toBeTruthy();
    expect(getByText(/4%/)).toBeTruthy();
    expect(getByText(/Sisa: 4,800 pcs/)).toBeTruthy();
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

  it('shows envelope-empty state when envelope is null', () => {
    const { getByText } = render(
      <MaterialUsagePanel
        materialId="mat-bata"
        tier={2}
        requestedQuantity={200}
        requestedUnit="pcs"
        envelope={null}
      />,
    );
    expect(getByText(/Envelope belum ada di baseline/i)).toBeTruthy();
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
