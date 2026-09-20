// workflows/components/charts/__tests__/LineChart.test.tsx
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import LineChart from '../LineChart';

const series = [
  { key: 'approved', label: 'Disetujui', color: '#D9662B', values: [0, 12.5, 30.9, 30.9], endLabel: true },
  { key: 'verified', label: 'Terpasang (terverifikasi)', color: '#1565C0', values: [null, 1, 8, 13], dots: true, endLabel: true },
  { key: 'diary', label: 'Menurut laporan harian', color: '#1baf7a', width: 1.5, values: [null, 2, 10, 16] },
];

describe('LineChart', () => {
  it('draws a plain legend when there is nothing to switch', () => {
    const { getByText, queryByLabelText } = render(<LineChart labels={['a', 'b', 'c', 'd']} series={series} yMax={100} unit="%" accessibilityLabel="x" />);
    expect(getByText('Disetujui')).toBeTruthy();
    expect(queryByLabelText('Tampilkan Disetujui')).toBeNull();
  });

  it('makes the legend items switches, reporting the hidden state and calling back with the key', () => {
    const onToggle = jest.fn();
    const { getByLabelText } = render(
      <LineChart
        labels={['a', 'b', 'c', 'd']}
        series={series}
        yMax={100}
        unit="%"
        hidden={new Set(['diary'])}
        onToggle={onToggle}
        bands={[{ key: 'stock', between: ['approved', 'verified'], color: '#D9662B', opacity: 0.1, label: 'stok teoretis' }]}
        annotations={[
          { key: 'lead', kind: 'bracket', level: 13, fromIndex: 1, toIndex: 3, label: '~2 minggu', requires: ['approved', 'verified'] },
          { key: 'cover', kind: 'run', level: 30.9, fromIndex: 3, toIndex: 3, label: 'cukup ~9 minggu', color: '#D9662B', requires: ['approved', 'diary'] },
        ]}
        accessibilityLabel="x"
      />,
    );
    expect(getByLabelText('Tampilkan Menurut laporan harian').props.accessibilityState).toEqual({ checked: false });
    expect(getByLabelText('Tampilkan Disetujui').props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(getByLabelText('Tampilkan Disetujui'));
    expect(onToggle).toHaveBeenCalledWith('approved');
  });
});
