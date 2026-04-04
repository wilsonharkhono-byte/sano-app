// ─── SANO Design System ─────────────────────────────────────────────────────
// Single source of truth for all visual tokens.
// All colours, type, spacing, and radius values live here.

// ── Colour Palette ────────────────────────────────────────────────────────────
// Warm near-black & near-white (tinted toward the sand accent, never pure)
// textSec on bg (#D2D0C4) achieves ≥ 5:1 contrast ratio (WCAG AA)

export const COLORS = {
  // Core
  primary:   '#141210',       // warm near-black (tinted, not pure #000)
  accent:    '#B29F86',       // sand — brand warmth
  accentDark:'#7A6B56',       // darker sand for text-on-light uses
  bg:        '#D2D0C4',       // oat — app background
  bgOat:     '#C6C1B6',       // slightly darker oat — subtle section dividers
  surface:   '#FDFAF6',       // warm near-white (tinted, not pure #FFF)
  surfaceAlt:'#F2EFE9',       // slightly warmer surface for disabled / inactive

  // Text
  text:      '#141210',       // primary text (matches primary)
  textSec:   '#524E49',       // secondary text — 5.0:1 on bg, 5.9:1 on surface ✓
  textMuted: '#847E78',       // muted / placeholder — use only at large sizes

  // Borders
  border:    '#B5AFA8',       // visible border
  borderSub: 'rgba(148,148,148,0.18)', // subtle border (cards)

  // Semantic — status colours
  ok:        '#3D8B40',       // darkened green for better contrast
  info:      '#1565C0',       // darkened blue
  warning:   '#E65100',       // amber/orange
  critical:  '#C62828',       // darkened red
  high:      '#BF360C',       // deep orange

  // Accent background (sand tint for selected/active states)
  accentBg:   'rgba(178,159,134,0.10)',

  // Semantic backgrounds (8% opacity tints)
  okBg:       'rgba(61,139,64,0.08)',
  infoBg:     'rgba(21,101,192,0.08)',
  warningBg:  'rgba(230,81,0,0.10)',
  highBg:     'rgba(191,54,12,0.10)',
  criticalBg: 'rgba(198,40,40,0.08)',

  // Inverse (text on dark/primary backgrounds)
  textInverse:       '#FDFAF6',
  textInverseSec:    'rgba(253,250,246,0.65)',
  textInverseMuted:  'rgba(253,250,246,0.40)',
} as const;

// ── Typography ────────────────────────────────────────────────────────────────
// Space Grotesk — geometric humanist, precise yet warm.
// Loaded via @expo-google-fonts/space-grotesk in App.tsx.

export const FONTS = {
  light:    'SpaceGrotesk_300Light',
  regular:  'SpaceGrotesk_400Regular',
  medium:   'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
  bold:     'SpaceGrotesk_700Bold',
} as const;

// Type scale — modular 1.25 ratio from base 14
// Mobile-first: xs floor raised to 12 (11dp was below comfortable legibility on phone)
export const TYPE = {
  xs:   12,   // captions, timestamps, badge labels — minimum for comfortable mobile reading
  sm:   13,   // secondary labels, hints, field notes
  base: 15,   // body / list items
  md:   16,   // input text, card body
  lg:   19,   // subheadings, card titles
  xl:   24,   // section stats
  xxl:  30,   // display numbers
} as const;

// ── Spacing Scale ─────────────────────────────────────────────────────────────
export const SPACE = {
  xs:   4,
  sm:   8,
  md:   12,
  base: 16,
  lg:   20,
  xl:   24,
  xxl:  32,
  xxxl: 48,
} as const;

// ── Touch & Interaction ───────────────────────────────────────────────────────
// WCAG 2.5.5: minimum 44×44dp for all interactive targets
export const TOUCH_TARGET = 44;

// ── Responsive Breakpoints ────────────────────────────────────────────────────
// Used with useWindowDimensions() for phone / tablet / desktop layouts.
// Desktop dashboard is a derivative of mobile — same components, wider canvas.
export const BREAKPOINTS = {
  phone:   0,    //    0 – 767dp  → single column, compact spacing
  tablet:  768,  //  768 – 1023dp → two column possible, richer headers
  desktop: 1024, // 1024dp+      → sidebar nav, max-width content, data-dense layouts
} as const;

// Max content width on wide screens (keeps text lines readable, cards bounded)
export const MAX_CONTENT_WIDTH = {
  tablet:  620,
  desktop: 860,
} as const;

// ── Radii ─────────────────────────────────────────────────────────────────────
export const RADIUS = 8;
export const RADIUS_SM = 5;
export const RADIUS_LG = 14;

// ── Flag System ───────────────────────────────────────────────────────────────
export const FLAG_COLORS: Record<string, string> = {
  OK:       COLORS.ok,
  INFO:     COLORS.info,
  WARNING:  COLORS.warning,
  HIGH:     COLORS.high,
  CRITICAL: COLORS.critical,
};

export const FLAG_BG: Record<string, string> = {
  OK:       COLORS.okBg,
  INFO:     COLORS.infoBg,
  WARNING:  COLORS.warningBg,
  HIGH:     COLORS.highBg,
  CRITICAL: COLORS.criticalBg,
};
