import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from './workflows/components/Toast';
import App from './workflows/App';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      if (__DEV__) {
        console.error('[SANO ErrorBoundary]', this.state.error);
      }
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>Terjadi Kesalahan</Text>
          <Text style={{ fontSize: 14, color: '#666', textAlign: 'center' }}>
            Aplikasi mengalami masalah. Silakan tutup dan buka kembali.
          </Text>
          {__DEV__ && (
            <Text style={{ fontSize: 11, color: '#999', marginTop: 8 }}>{this.state.error.message}</Text>
          )}
        </View>
      );
    }
    return this.props.children;
  }
}

export default function Root() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
