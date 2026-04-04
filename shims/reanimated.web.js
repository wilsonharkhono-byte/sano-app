// Empty shim for react-native-reanimated on web
export default {};
export const useSharedValue = (v) => ({ value: v });
export const useAnimatedStyle = () => ({});
export const withTiming = (v) => v;
export const withSpring = (v) => v;
export const runOnJS = (fn) => fn;
export const runOnUI = (fn) => fn;
