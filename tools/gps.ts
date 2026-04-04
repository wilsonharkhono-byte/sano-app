import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface GpsCoords {
  lat: number;
  lon: number;
}

export async function requestGps(): Promise<GpsCoords | null> {
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return null;

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: parseFloat(position.coords.latitude.toFixed(7)),
            lon: parseFloat(position.coords.longitude.toFixed(7)),
          });
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    });
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  return {
    lat: parseFloat(location.coords.latitude.toFixed(7)),
    lon: parseFloat(location.coords.longitude.toFixed(7)),
  };
}
