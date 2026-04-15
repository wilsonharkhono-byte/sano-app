import React from 'react';
import { useNavigation } from '@react-navigation/native';
import BaselineScreen from '../../workflows/screens/BaselineScreen';

export default function OfficeBaselineScreen() {
  const navigation = useNavigation<any>();

  return (
    <BaselineScreen
      onBack={() => navigation.navigate('Home')}
      backLabel="Kembali ke Beranda"
      onGoToJadwal={() => navigation.navigate('Reports', { initialSection: 'jadwal' })}
    />
  );
}
