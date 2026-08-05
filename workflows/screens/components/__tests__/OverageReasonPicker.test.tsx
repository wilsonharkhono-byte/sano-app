import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import OverageReasonPicker from '../../../components/OverageReasonPicker';
import { OVERAGE_REASON_LABELS } from '../../../../tools/requestOverage';

describe('OverageReasonPicker', () => {
  it('reports the tapped reason', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <OverageReasonPicker reason={null} note="" onChange={onChange} />,
    );

    fireEvent.press(getByLabelText(OVERAGE_REASON_LABELS.WASTE));

    expect(onChange).toHaveBeenCalledWith({ overageReason: 'WASTE' });
  });

  it('deselects the active reason on a second tap', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <OverageReasonPicker reason="WASTE" note="" onChange={onChange} />,
    );

    fireEvent.press(getByLabelText(OVERAGE_REASON_LABELS.WASTE));

    expect(onChange).toHaveBeenCalledWith({ overageReason: null });
  });

  it('shows the note field only after a reason is picked, and demands text for Lainnya', () => {
    const { queryByPlaceholderText, rerender, getByText } = render(
      <OverageReasonPicker reason={null} note="" onChange={jest.fn()} />,
    );
    expect(queryByPlaceholderText(/Catatan tambahan/)).toBeNull();

    rerender(<OverageReasonPicker reason="OTHER" note="" onChange={jest.fn()} />);
    expect(getByText("Alasan 'Lainnya' butuh keterangan")).toBeTruthy();
  });

  it('accepts custom heading copy (Mode Besi applies one picker per diameter)', () => {
    const { getByText } = render(
      <OverageReasonPicker
        reason={null}
        note=""
        onChange={jest.fn()}
        title="Alasan kelebihan — Besi ulir 13 mm"
        hint="Berlaku untuk semua grup diameter ini yang melebihi alokasi."
      />,
    );
    // Substring matcher, not an exact one: the heading Text carries the
    // required-asterisk child verbatim from the screen block it was extracted
    // from, so its text content is "…13 mm *".
    expect(getByText(/Alasan kelebihan — Besi ulir 13 mm/)).toBeTruthy();
  });
});
