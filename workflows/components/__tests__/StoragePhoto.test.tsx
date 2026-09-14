import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// react-native's own jest mock for Image (jest/mocks/Image.js) requires the RN
// preset's haste platform resolution to reach Image.ios.js; under this ts-jest
// config Image.js resolves to itself and the mock throws. Substitute a host View
// that carries every prop (source, style, testID, onError) through — the same
// precedent NotificationList.test.tsx uses for FlatList.
jest.mock('react-native/Libraries/Image/Image', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const ImageMock = (props: Record<string, unknown>) => ReactLocal.createElement(View, props);
  return { __esModule: true, default: ImageMock };
});

// tools/storage pulls in supabase + expo-image-picker; substitute the resolver only.
jest.mock('../../../tools/storage', () => ({
  resolvePhotoUrl: jest.fn(),
}));

import { resolvePhotoUrl } from '../../../tools/storage';
import StoragePhoto from '../StoragePhoto';

const mockResolve = resolvePhotoUrl as jest.MockedFunction<typeof resolvePhotoUrl>;

describe('StoragePhoto', () => {
  beforeEach(() => {
    mockResolve.mockReset();
  });

  it('shows a loading placeholder, then renders the resolved URL (never the raw path)', async () => {
    const signed = 'https://project.supabase.co/storage/v1/object/sign/photos/site-changes/p1/1.jpg?token=abc';
    mockResolve.mockResolvedValue(signed);

    const { getByTestId, queryByTestId, getByText } = render(
      <StoragePhoto path="site-changes/p1/1.jpg" testID="photo" />,
    );

    expect(getByTestId('photo-placeholder')).toBeTruthy();
    expect(getByText('Memuat foto')).toBeTruthy();
    expect(queryByTestId('photo')).toBeNull();

    await waitFor(() => expect(getByTestId('photo')).toBeTruthy());
    expect(getByTestId('photo').props.source).toEqual({ uri: signed });
    expect(queryByTestId('photo-placeholder')).toBeNull();
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith('site-changes/p1/1.jpg');
  });

  it('hands prefixed values to resolvePhotoUrl untouched (site-media:<path> routing lives in storage.ts)', async () => {
    mockResolve.mockResolvedValue('https://signed.example/x');
    const { findByTestId } = render(
      <StoragePhoto path="site-media:site-events/p1/e1/m1.jpg" testID="photo" />,
    );
    await findByTestId('photo');
    expect(mockResolve).toHaveBeenCalledWith('site-media:site-events/p1/e1/m1.jpg');
  });

  it('shows the unavailable placeholder when resolution rejects', async () => {
    mockResolve.mockRejectedValue(new Error('storage down'));
    const { findByText, queryByTestId } = render(
      <StoragePhoto path="site-changes/p1/2.jpg" testID="photo" />,
    );
    expect(await findByText('Foto tidak tersedia')).toBeTruthy();
    expect(queryByTestId('photo')).toBeNull();
  });

  it('falls back to the unavailable placeholder when the image itself fails to load', async () => {
    mockResolve.mockResolvedValue('https://signed.example/expired');
    const { findByTestId, findByText, queryByTestId } = render(
      <StoragePhoto path="site-changes/p1/3.jpg" testID="photo" />,
    );
    const image = await findByTestId('photo');
    fireEvent(image, 'error');
    expect(await findByText('Foto tidak tersedia')).toBeTruthy();
    expect(queryByTestId('photo')).toBeNull();
  });

  it('re-resolves when the path prop changes and drops the stale URL meanwhile', async () => {
    mockResolve.mockResolvedValueOnce('https://signed.example/first');
    const { findByTestId, getByTestId, rerender } = render(
      <StoragePhoto path="a.jpg" testID="photo" />,
    );
    await findByTestId('photo');

    mockResolve.mockResolvedValueOnce('https://signed.example/second');
    rerender(<StoragePhoto path="b.jpg" testID="photo" />);
    expect(getByTestId('photo-placeholder')).toBeTruthy();

    await waitFor(() => expect(getByTestId('photo').props.source).toEqual({ uri: 'https://signed.example/second' }));
    expect(mockResolve).toHaveBeenLastCalledWith('b.jpg');
  });

  it('honours custom labels and applies the given style to both states', async () => {
    mockResolve.mockResolvedValue('https://signed.example/x');
    const style = { width: 160, height: 120 };
    const { getByTestId, getByText, findByTestId } = render(
      <StoragePhoto path="a.jpg" testID="photo" style={style} loadingLabel="Memuat foto 2" />,
    );
    expect(getByText('Memuat foto 2')).toBeTruthy();
    expect(getByTestId('photo-placeholder').props.style).toEqual(
      expect.arrayContaining([style]),
    );
    const image = await findByTestId('photo');
    expect(image.props.style).toEqual(style);
  });
});
