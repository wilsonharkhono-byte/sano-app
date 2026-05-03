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
