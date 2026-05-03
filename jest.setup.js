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
