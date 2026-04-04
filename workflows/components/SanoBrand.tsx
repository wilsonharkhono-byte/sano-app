import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { FONTS, TYPE, SPACE } from '../theme';

type Tone = 'dark' | 'light';

/**
 * Full SANO typography logo — rendered from "assets/LOGO SANO.svg".
 * Single source of truth: import this wherever the logo is needed.
 */
export function SanoLogo({
  width = 160,
  color,
  tone,
}: {
  width?: number;
  color?: string;
  tone?: Tone;
}) {
  // Resolve colour: explicit `color` wins, then `tone`, then default dark.
  const fill = color ?? (tone === 'light' ? '#FDFAF6' : '#141210');
  const height = Math.round(width * (87.26 / 315.66));

  return (
    <Svg width={width} height={height} viewBox="0 0 315.66 87.26">
      {/* S */}
      <Path fill={fill} d="M26.17,45.71c-4.05,0-7.85-1.58-10.71-4.44-2.86-2.86-4.44-6.67-4.44-10.71s1.58-7.85,4.44-10.71,6.67-4.44,10.71-4.44h52.29v7.32H26.17c-4.32,0-7.83,3.51-7.83,7.83s3.51,7.83,7.83,7.83h7.74l-7.32,7.32h-.41Z" />
      <Path fill={fill} d="M9.6,68.69l7.32-7.32h56.42c2.09,0,4.06-.81,5.54-2.29l1.92-1.92,5.84,4.52-2.58,2.58c-2.86,2.86-6.67,4.44-10.71,4.44H9.6Z" />
      {/* A */}
      <Path fill={fill} d="M166.3,68.69l-43.34-43.34-22.36,22.36-5.84-4.52,28.2-28.2,53.7,53.7h-10.36Z" />
      <Path fill={fill} d="M110.91,68.69c-3.34,0-6.63-1.12-9.27-3.17l-23.51-18.18c-1.36-1.05-3.06-1.64-4.79-1.64h-40.06l7.32-7.32h32.74c3.34,0,6.63,1.12,9.27,3.17l23.51,18.18c1.36,1.05,3.06,1.64,4.79,1.64h38.69v7.32h-38.69Z" />
      {/* N */}
      <Path fill={fill} d="M214.33,68.69c-2.76,0-5.36-1.07-7.31-3.03l-41.96-41.96c-.57-.57-1.32-.88-2.13-.88-.4,0-.78.08-1.15.23-1.13.47-1.86,1.56-1.86,2.78v18.25l-7.32-7.32v-10.92c0-4.19,2.5-7.94,6.38-9.55,1.26-.52,2.59-.79,3.95-.79,2.76,0,5.36,1.07,7.31,3.03l41.96,41.96c.57.57,1.32.88,2.13.88.4,0,.78-.08,1.15-.23,1.13-.47,1.86-1.56,1.86-2.78V15.4h7.32v42.95c0,4.19-2.5,7.94-6.38,9.55-1.26.52-2.59.79-3.95.79Z" />
      {/* O */}
      <Path fill={fill} d="M242.17,68.69c-5.62-.09-10.19-4.72-10.19-10.33v-13.92l7.32,7.32v6.6c0,1.63,1.31,2.98,2.92,3.01h51.59c1.59-.03,2.9-1.38,2.91-3.01V25.74c0-.87-.38-1.7-1.04-2.27-.53-.46-1.22-.73-1.92-.74h-51.52c-.69.01-1.37.27-1.9.74-.66.57-1.04,1.4-1.04,2.27v19.34l-7.32-7.32v-12.02c0-2.99,1.3-5.84,3.56-7.8,1.83-1.59,4.17-2.49,6.59-2.53h51.74c2.44.04,4.78.94,6.61,2.53,2.26,1.96,3.56,4.81,3.56,7.8v32.62c0,5.61-4.56,10.24-10.17,10.33h-51.7Z" />
    </Svg>
  );
}

export default function SanoBrand({
  subtitle,
  tone = 'dark',
  compact = false,
}: {
  subtitle?: string;
  tone?: Tone;
  compact?: boolean;
}) {
  const subColor = tone === 'light' ? 'rgba(253,250,246,0.60)' : '#524E49';

  return (
    <View
      style={styles.wrap}
      accessibilityLabel={`SANO${subtitle ? ', ' + subtitle : ''}`}
      accessibilityRole="text"
    >
      <SanoLogo width={compact ? 100 : 160} tone={tone} />
      {subtitle ? (
        <Text
          style={[
            styles.subtitle,
            compact ? styles.subtitleCompact : null,
            { color: subColor },
          ]}
          numberOfLines={compact ? 1 : 2}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexShrink: 1,
  },
  subtitle: {
    marginTop: SPACE.xs,
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    lineHeight: 18,
    letterSpacing: 0.1,
  },
  subtitleCompact: {
    marginTop: 2,
    fontSize: TYPE.xs,
    fontFamily: FONTS.medium,
    lineHeight: TYPE.xs + 2,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
