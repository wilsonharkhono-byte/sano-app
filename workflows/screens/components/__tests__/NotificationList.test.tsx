import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// FlatList pulls in @react-native/virtualized-lists which reads Platform.OS from a
// path our jest.setup.js mock doesn't cover. Substitute a simple non-virtualized
// renderer that exercises the same data prop and renderItem callback.
jest.mock('react-native/Libraries/Lists/FlatList', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  function FlatListMock<T>(props: {
    data: ReadonlyArray<T>;
    renderItem: (info: { item: T; index: number }) => React.ReactNode;
    keyExtractor?: (item: T, index: number) => string;
  }) {
    return ReactLocal.createElement(
      View,
      null,
      props.data.map((item, index) =>
        ReactLocal.createElement(
          View,
          { key: props.keyExtractor ? props.keyExtractor(item, index) : index },
          props.renderItem({ item, index }),
        ),
      ),
    );
  }
  return { __esModule: true, default: FlatListMock };
});

import { NotificationList, type NotificationItem } from '../NotificationList';

const items: NotificationItem[] = [
  {
    id: 'n1',
    type: 'AUTO_HOLD',
    title: 'Permintaan butuh review',
    body: 'Request di-flag CRITICAL',
    createdAt: new Date('2026-05-09T10:00:00Z').toISOString(),
    readAt: null,
    deeplinkScreen: 'ApprovalsScreen',
    deeplinkParams: { headerId: 'h1' },
  },
  {
    id: 'n2',
    type: 'APPROVED',
    title: 'Permintaan disetujui',
    body: 'Request disetujui',
    createdAt: new Date('2026-05-08T10:00:00Z').toISOString(),
    readAt: new Date('2026-05-08T11:00:00Z').toISOString(),
    deeplinkScreen: 'ApprovalsScreen',
    deeplinkParams: { headerId: 'h2' },
  },
];

describe('NotificationList', () => {
  it('renders titles and bodies', () => {
    const { getByText } = render(
      <NotificationList items={items} onPress={() => {}} />,
    );
    expect(getByText('Permintaan butuh review')).toBeTruthy();
    expect(getByText('Permintaan disetujui')).toBeTruthy();
  });

  it('shows empty state when items is empty', () => {
    const { getByText } = render(
      <NotificationList items={[]} onPress={() => {}} />,
    );
    expect(getByText(/belum ada notifikasi/i)).toBeTruthy();
  });

  it('calls onPress with the item when row tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <NotificationList items={items} onPress={onPress} />,
    );
    fireEvent.press(getByText('Permintaan butuh review'));
    expect(onPress).toHaveBeenCalledWith(items[0]);
  });
});
