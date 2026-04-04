import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Animated, Text, StyleSheet, View } from 'react-native';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

type ToastType = '' | 'ok' | 'warning' | 'critical';

interface ToastContextType {
  show: (msg: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

const BG_MAP: Record<ToastType, string> = {
  '':        COLORS.primary,
  ok:        COLORS.ok,
  warning:   COLORS.warning,
  critical:  COLORS.critical,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('');
  const [type, setType]       = useState<ToastType>('');
  const opacity = useRef(new Animated.Value(0)).current;
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  const show = useCallback((msg: string, t: ToastType = '') => {
    if (!mounted.current) return;
    if (timeout.current) clearTimeout(timeout.current);
    setMessage(msg);
    setType(t);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    timeout.current = setTimeout(() => {
      if (mounted.current) {
        Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }).start();
      }
    }, 3500);
  }, [opacity]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <Animated.View
        style={[styles.container, { opacity }]}
        pointerEvents="none"
        accessibilityLiveRegion="polite"
        accessibilityLabel={message}
      >
        <View style={[styles.toast, { backgroundColor: BG_MAP[type] }]}>
          <Text style={styles.text}>{message}</Text>
        </View>
      </Animated.View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 88,
    left: SPACE.base,
    right: SPACE.base,
    zIndex: 999,
  },
  toast: {
    borderRadius: RADIUS,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.base,
    shadowColor: '#141210',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 5,
  },
  text: {
    color: COLORS.textInverse,
    fontSize: TYPE.sm,
    fontFamily: FONTS.medium,
    lineHeight: 20,
  },
});
