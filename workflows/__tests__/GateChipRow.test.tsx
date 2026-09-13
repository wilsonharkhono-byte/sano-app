/**
 * GateChipRow is where the review found the actual logic (Important #2): the
 * active-gate filter, the description/hint rendering, and the tap-to-select /
 * tap-again-to-clear behaviour were only covered by tsc + manual inspection.
 * @expo/vector-icons and RN's FlatList/Platform quirks are already handled by
 * jest.setup.js and don't need a per-test mock here — GateChipRow renders
 * with plain View/Text/TouchableOpacity, same as OverageReasonPicker.test.tsx.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// GateChipRow imports gateChipLabel from tools/gateRefs, which imports
// tools/supabase — and that pulls in react-native-url-polyfill/auto, an
// ESM-only module ts-jest doesn't transform. gateRefs.test.ts mocks the same
// module for the same reason; this test never touches the network, so the
// mock body is irrelevant beyond making the import chain resolve.
jest.mock('../../tools/supabase', () => ({ supabase: { from: jest.fn() } }));

import { GateChipRow } from '../screens/siteEvent/GateChipRow';
import { gateChipLabel } from '../../tools/gateRefs';
import type { GateRef } from '../../tools/types';

const gate = (over: Partial<GateRef> = {}): GateRef => ({
  code: 'B',
  name_id: 'Waterproofing + kamar mandi',
  short_label: 'Waterproofing + kamar mandi',
  description: 'Lapisan waterproofing pada kamar mandi.',
  sort_order: 20,
  active: true,
  datum_gate_code: null,
  created_at: '2026-09-10T00:00:00Z',
  ...over,
});

const gateA = gate({ code: 'A', short_label: 'MEP rough-in + persiapan sipil', description: 'Deskripsi gerbang A.', sort_order: 10 });
const gateB = gate({ code: 'B', short_label: 'Waterproofing + kamar mandi', description: 'Deskripsi gerbang B.', sort_order: 20 });
const gateCInactive = gate({ code: 'C', short_label: 'Plafon + benangan', description: 'Deskripsi gerbang C.', sort_order: 30, active: false });

const gates: GateRef[] = [gateA, gateB, gateCInactive];

describe('GateChipRow', () => {
  it('renders only active gates, each with its chip label and description', () => {
    const { getByText, queryByText } = render(
      <GateChipRow gates={gates} value={null} onChange={() => {}} />,
    );

    expect(getByText(gateChipLabel(gateA))).toBeTruthy();
    expect(getByText(gateA.description!)).toBeTruthy();
    expect(getByText(gateChipLabel(gateB))).toBeTruthy();
    expect(getByText(gateB.description!)).toBeTruthy();

    // The inactive gate C is filtered out entirely.
    expect(queryByText(gateChipLabel(gateCInactive))).toBeNull();
    expect(queryByText(gateCInactive.description!)).toBeNull();
  });

  it('shows the "Saran" badge only on the hinted row, when nothing is selected yet', () => {
    const { getByText, queryByText } = render(
      <GateChipRow gates={gates} value={null} onChange={() => {}} hintCode="B" />,
    );
    expect(getByText('Saran')).toBeTruthy();

    // No hint at all → no badge anywhere.
    const noHint = render(<GateChipRow gates={gates} value={null} onChange={() => {}} />);
    expect(noHint.queryByText('Saran')).toBeNull();
  });

  it('calls onChange(code) when tapping an unselected row', () => {
    const onChange = jest.fn();
    const { getByText } = render(
      <GateChipRow gates={gates} value={null} onChange={onChange} />,
    );

    fireEvent.press(getByText(gateChipLabel(gateB)));

    expect(onChange).toHaveBeenCalledWith('B');
  });

  it('calls onChange(null) when tapping the already-selected row (clear behaviour, unchanged)', () => {
    const onChange = jest.fn();
    const { getByText } = render(
      <GateChipRow gates={gates} value="B" onChange={onChange} />,
    );

    fireEvent.press(getByText(gateChipLabel(gateB)));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
