import { StyleSheet } from 'react-native';
import { COLORS, FAB_CLEARANCE, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

/** Shared by the capture, confirm and detail screens and their components. */
export const formStyles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginBottom: SPACE.sm, alignSelf: 'flex-start', minHeight: 44 },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  title: { fontSize: TYPE.xl, fontFamily: FONTS.bold, color: COLORS.text },
  meta: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, marginBottom: 6, marginTop: SPACE.md },
  req: { color: COLORS.critical },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 4, lineHeight: 16 },
  counter: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'right', marginTop: 2 },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    padding: SPACE.md, fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text,
  },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  chip: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: 6,
    paddingHorizontal: SPACE.sm + 2, backgroundColor: COLORS.surface, minHeight: 40, justifyContent: 'center',
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipHint: { borderStyle: 'dashed', borderColor: COLORS.textMuted, backgroundColor: COLORS.surfaceAlt },
  chipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text },
  chipTextActive: { color: COLORS.textInverse },
  chipTextHint: { color: COLORS.textSec },
  // Gate picker: a vertical list, one row per active gate (GateChipRow). A
  // gate now carries a full description, so it no longer fits a horizontal
  // chip — StepChipRow and EventTypeChipRow still use the chip* styles above.
  gateList: { gap: SPACE.sm },
  gateRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 48,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.md, backgroundColor: COLORS.surface,
  },
  gateRowActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  gateRowHint: { borderStyle: 'dashed', borderColor: COLORS.textMuted, backgroundColor: COLORS.surfaceAlt },
  gateRowText: { flex: 1 },
  gateTitle: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  gateTitleActive: { color: COLORS.textInverse },
  gateSubtitle: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2, lineHeight: 15 },
  gateSubtitleActive: { color: COLORS.textInverseSec },
  gateCheck: { marginLeft: SPACE.xs },
  saranBadge: {
    paddingVertical: 2, paddingHorizontal: SPACE.sm, borderRadius: RADIUS,
    backgroundColor: COLORS.infoBg, marginLeft: SPACE.xs,
  },
  saranText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.info },
  // Extra bottom clearance for the two screens whose primary button would
  // otherwise sit under GlobalAIChatLauncher's floating sparkle button.
  // FAB_CLEARANCE (workflows/theme.ts) carries the derivation from the
  // launcher's own bottom offset + size — shared so every screen that needs
  // clearance from the fab agrees on the same number.
  contentFabClear: { paddingBottom: FAB_CLEARANCE },
  periksa: {
    alignSelf: 'flex-start', marginTop: SPACE.xs, paddingVertical: 2, paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS, backgroundColor: COLORS.warningBg,
  },
  periksaText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.warning },
  primaryBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center',
    justifyContent: 'center', marginTop: SPACE.base, minHeight: 48,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  secondaryBtn: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center',
    justifyContent: 'center', marginTop: SPACE.sm, backgroundColor: COLORS.surface, minHeight: 44,
  },
  secondaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  dangerBtn: {
    borderWidth: 1, borderColor: COLORS.critical, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center',
    justifyContent: 'center', marginTop: SPACE.sm, backgroundColor: COLORS.criticalBg, minHeight: 44,
  },
  dangerText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.critical },
  banner: {
    borderRadius: RADIUS, padding: SPACE.md, backgroundColor: COLORS.warningBg,
    borderWidth: 1, borderColor: COLORS.warning, marginBottom: SPACE.md,
  },
  bannerText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, lineHeight: 19 },
  errorBox: { borderRadius: RADIUS, padding: SPACE.md, backgroundColor: COLORS.criticalBg, marginTop: SPACE.md },
  errorText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.critical, lineHeight: 19 },
  empty: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, paddingVertical: SPACE.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACE.sm, paddingVertical: 4 },
  rowLabel: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  rowValue: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, flexShrink: 1, textAlign: 'right' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.sm, minHeight: 44 },
  checkText: { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, lineHeight: 19 },
});
