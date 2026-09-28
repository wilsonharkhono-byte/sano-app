import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import PushStatusLine from '../PushStatusLine';
import { setPushStatus } from '../../../tools/pushStatus';

describe('PushStatusLine', () => {
  afterEach(() => {
    act(() => setPushStatus('unknown'));
    jest.restoreAllMocks();
  });

  it('shows the current status and follows changes', () => {
    const { getByText } = render(<PushStatusLine />);
    expect(getByText('Memeriksa...')).toBeTruthy();

    act(() => setPushStatus('active'));
    expect(getByText('Aktif')).toBeTruthy();
  });

  it('opens the system settings when permission was denied', () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    act(() => setPushStatus('denied'));

    const { getByText } = render(<PushStatusLine />);
    fireEvent.press(getByText('Izin ditolak - ketuk untuk membuka Pengaturan'));

    expect(openSettings).toHaveBeenCalled();
  });
});
