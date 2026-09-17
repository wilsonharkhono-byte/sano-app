// react-native-svg cannot load under this jest setup (its colour pipeline reads
// Platform.OS at import, which react-native's jest mock leaves undefined), so
// tests render every SVG element as a plain View. Geometry is tested on its
// own in workflows/components/charts/__tests__/chartGeometry.test.ts.
const React = require('react');
const { View } = require('react-native');

const element = (name) => {
  const Component = (props) => React.createElement(View, { testID: props.testID, accessibilityLabel: props.accessibilityLabel }, props.children);
  Component.displayName = `Svg${name}`;
  return Component;
};

const names = ['Svg', 'Circle', 'Ellipse', 'G', 'Text', 'TSpan', 'TextPath', 'Path', 'Polygon', 'Polyline', 'Line', 'Rect', 'Use', 'Image', 'Symbol', 'Defs', 'LinearGradient', 'RadialGradient', 'Stop', 'ClipPath', 'Pattern', 'Mask'];
const mock = { __esModule: true, default: element('Svg') };
for (const name of names) mock[name] = element(name);
module.exports = mock;
