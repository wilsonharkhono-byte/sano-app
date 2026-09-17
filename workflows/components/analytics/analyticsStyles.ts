// workflows/components/analytics/analyticsStyles.ts
import { StyleSheet } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

export const lh = (size: number) => Math.round(size * 1.45);

const SHORT_MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
/** "2026-11-02" → "2 Nov 2026". */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${SHORT_MONTHS_ID[m - 1]} ${y}`;
}
/** "2026-11-02" → "2 Nov". */
export function shortLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${SHORT_MONTHS_ID[m - 1]}`;
}
export function qty(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('id-ID');
}

export const a = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.md },
  tile: { flexGrow: 1, flexBasis: 130, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS, padding: SPACE.sm },
  tileLabel: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  tileValue: { fontSize: TYPE.lg, lineHeight: lh(TYPE.lg), fontFamily: FONTS.bold, color: COLORS.text },
  tileSub: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  hint: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.sm },
  note: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.text, marginTop: SPACE.sm },
  warn: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.warning, marginTop: SPACE.xs },
  error: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.regular, color: COLORS.critical },
  subhead: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase', marginTop: SPACE.md, marginBottom: SPACE.xs },
  ghostBtn: {
    alignSelf: 'flex-start', minHeight: 44, marginTop: SPACE.sm, paddingHorizontal: SPACE.base, borderRadius: RADIUS, borderWidth: 1,
    borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
  },
  ghostBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.medium, color: COLORS.textSec, textTransform: 'uppercase' },
  primaryBtn: {
    alignSelf: 'flex-start', minHeight: 44, marginTop: SPACE.sm, paddingHorizontal: SPACE.base, borderRadius: RADIUS, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase' },
  busy: { opacity: 0.6 },
});
