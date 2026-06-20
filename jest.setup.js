// Jest setup for React Native component tests
global.__DEV__ = true;

// React Native requires Platform.OS to be defined
jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'ios',
  select: (obj) => obj.ios ?? obj.default,
  isPad: false,
  isTV: false,
  isTesting: true,
  Version: 15,
}));

// @expo/vector-icons ships untransformed ESM that jest can't load. Substitute a
// lightweight stub for every icon set (Ionicons, MaterialIcons, …) — a Text node
// that carries the icon name through, so tests can render screens that use icons.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const makeIconSet = (setName) => {
    const Icon = (props) =>
      React.createElement(Text, { ...props, testID: props.testID ?? `icon-${setName}` }, props.name);
    Icon.glyphMap = {};
    return Icon;
  };
  return new Proxy({}, { get: (_target, key) => makeIconSet(String(key)) });
});
