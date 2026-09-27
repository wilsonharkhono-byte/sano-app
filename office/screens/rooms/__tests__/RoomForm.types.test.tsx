// office/screens/rooms/__tests__/RoomForm.types.test.tsx
//
// DATUM sync spec 2026-09-27 §4.2: SANO room types are DATUM's thirteen,
// with DATUM's own labels for the four zones. The form reads AREA_TYPES, so
// the picker offers exactly that list, in that order.
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@react-native-picker/picker', () => {
  const ReactLocal = require('react');
  const { Text, View } = require('react-native');
  const Picker = (props: { children: React.ReactNode }) => ReactLocal.createElement(View, { testID: 'picker' }, props.children);
  Picker.Item = (props: { label: string; value: string }) =>
    ReactLocal.createElement(Text, { testID: `type-${props.value}` }, props.label);
  return { Picker };
});

import RoomForm from '../RoomForm';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

describe('RoomForm type picker', () => {
  it("offers DATUM's thirteen types, the four zones with DATUM's labels", () => {
    const utils = render(<RoomForm saving={false} onCancel={jest.fn()} onSubmit={jest.fn()} />);
    const items = utils.getAllByTestId(/^type-/);
    expect(items.map((i) => i.props.testID.replace('type-', ''))).toEqual([
      'bathroom', 'kitchen', 'bedroom', 'living', 'dining', 'garden', 'circulation', 'utility', 'general',
      'facade', 'terrace', 'hall', 'exterior',
    ]);
    expect(utils.getByTestId('type-facade').props.children).toBe('Fasad');
    expect(utils.getByTestId('type-terrace').props.children).toBe('Teras / Balkon');
    expect(utils.getByTestId('type-hall').props.children).toBe('Hall / Lobi');
    expect(utils.getByTestId('type-exterior').props.children).toBe('Area luar lain');
  });
});
