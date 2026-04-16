import React, { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { COLORS } from '../theme';

export function ScreenLoader() {
  return (
    <View style={styles.loader}>
      <ActivityIndicator size="large" color={COLORS.accent} />
    </View>
  );
}

export function lazyScreen<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): React.ComponentType<React.ComponentProps<T>> {
  const LazyComponent = React.lazy(loader);

  function DeferredScreen(props: React.ComponentProps<T>) {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  }

  DeferredScreen.displayName = 'DeferredScreen';

  return DeferredScreen;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
  },
});
