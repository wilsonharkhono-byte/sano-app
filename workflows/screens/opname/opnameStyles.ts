import { StyleSheet } from 'react-native';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, RADIUS_SM } from '../../theme';

export const styles = StyleSheet.create({
  flex:   { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },

  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.base, paddingVertical: SPACE.md },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },

  sectionHead: { fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 0.8, textTransform: 'uppercase', color: COLORS.textSec, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  hint:     { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 17 },
  fieldLabel: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, marginTop: SPACE.md, marginBottom: SPACE.xs },

  // Contract selector
  contractScroll: { marginBottom: SPACE.md },
  contractChip:       { paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, marginRight: SPACE.sm },
  contractChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  contractChipText:       { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  contractChipTextActive: { color: COLORS.textInverse },

  // New opname
  newOpnameBtn:     { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.md, paddingHorizontal: SPACE.md, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS, borderStyle: 'dashed', marginBottom: SPACE.sm, justifyContent: 'center' },
  newOpnameBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },

  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingVertical: SPACE.md - 1, paddingHorizontal: SPACE.md,
    fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top', paddingTop: SPACE.md - 1 },
  textareaSmall: { minHeight: 64, textAlignVertical: 'top', paddingTop: SPACE.md - 1 },

  rowBtns:    { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md, marginTop: SPACE.sm },
  importActionGroup: { gap: SPACE.sm, marginTop: SPACE.md },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, borderWidth: 1, borderColor: COLORS.info, borderRadius: RADIUS, paddingVertical: SPACE.md, backgroundColor: COLORS.info + '10' },
  disabledBtn: { opacity: 0.45 },
  primaryBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.3 },
  secondaryBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.info, textTransform: 'uppercase', letterSpacing: 0.3 },
  ghostBtn:   { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center', marginTop: SPACE.sm, minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },

  // Opname list
  opnameRow:    { flexDirection: 'row', alignItems: 'flex-start' },
  opnameTitle:  { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  opnameDate:   { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  reconHeader:  { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginBottom: SPACE.xs },
  reconTitle:   { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  reconBadge:   { marginTop: SPACE.sm, flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, borderWidth: 1, borderRadius: RADIUS_SM, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs },
  reconBadgeWarn: { backgroundColor: COLORS.warning + '14', borderColor: COLORS.warning + '55' },
  reconBadgeHigh: { backgroundColor: COLORS.critical + '14', borderColor: COLORS.critical + '55' },
  reconBadgeText: { flex: 1, fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.text },
  paymentSummary: { flexDirection: 'row', gap: SPACE.base, marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  paymentItem:  { flex: 1 },
  paymentLabel: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted },
  paymentValue: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text, marginTop: 1 },
  aiSummaryBox: { marginTop: SPACE.sm, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, backgroundColor: COLORS.infoBg },
  aiSummaryText: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.info, lineHeight: 18 },

  // Status
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.md },

  // Lines
  lineHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.sm },
  lineDesc:   { flex: 1, fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  tdkBadge:   { backgroundColor: COLORS.critical, paddingHorizontal: SPACE.sm, paddingVertical: 2, borderRadius: RADIUS_SM },
  tdkText:    { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.textInverse, letterSpacing: 0.5 },

  progressTrack: { height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden', marginVertical: SPACE.sm, position: 'relative' },
  progressFill:  { position: 'absolute', height: '100%', backgroundColor: COLORS.ok, borderRadius: 3 },
  progressPrev:  { position: 'absolute', height: '100%', backgroundColor: COLORS.ok + '44', borderRadius: 3 },

  pctRow:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.md },
  pctInput:  { flex: 1 },
  pctLabel:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginBottom: SPACE.xs },
  pctField:  { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS_SM, paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.primary, minWidth: 70 },
  pctDisplay:{ fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text },
  amountBox: { alignItems: 'flex-end' },
  amountValue: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text },
  pickerWrap: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    overflow: 'hidden',
    marginTop: SPACE.sm,
    backgroundColor: COLORS.surface,
  },
  scopeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.sm },
  scopeChip: { paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs + 1, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  scopeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  scopeChipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  scopeChipTextActive: { color: COLORS.textInverse },
  allocationForm: { marginTop: SPACE.md, paddingTop: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  allocationEntryRow: { flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.sm, alignItems: 'flex-start' },
  allocationRowCard: { marginTop: SPACE.md, paddingTop: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.borderSub, gap: SPACE.xs },
  allocationRowHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.sm },
  deleteAllocationBtn: { paddingHorizontal: SPACE.xs, paddingVertical: SPACE.xs },
  emptyAllocationBox: { marginTop: SPACE.md, paddingTop: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  aiSuggestionRow: { marginTop: SPACE.sm, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, backgroundColor: COLORS.infoBg, gap: SPACE.xs },
  applyAiText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.info },
  inlineSavingRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.sm },

  tdkBtn:      { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.md, paddingVertical: SPACE.xs + 1, paddingHorizontal: SPACE.md, borderWidth: 1, borderColor: COLORS.critical, borderRadius: RADIUS_SM, alignSelf: 'flex-start' },
  tdkBtnActive:{ backgroundColor: COLORS.critical, borderColor: COLORS.critical },
  tdkBtnText:  { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.critical },

  // Waterfall
  waterfallRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACE.xs + 1, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  waterfallLabel:{ fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  waterfallValue:{ fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  kasbonRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACE.xs + 1, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  kasbonInput:   { borderBottomWidth: 1.5, borderBottomColor: COLORS.warning, fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.warning, textAlign: 'right', minWidth: 120, paddingVertical: 2 },
  totalRow:      { marginTop: SPACE.xs, borderTopWidth: 2, borderTopColor: COLORS.text, borderBottomWidth: 0 },
  totalLabel:    { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text, textTransform: 'uppercase', letterSpacing: 0.3 },
  totalValue:    { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.ok },

  actionGroup: { gap: SPACE.sm, marginTop: SPACE.md },
});
