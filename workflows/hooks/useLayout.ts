/**
 * useLayout — responsive breakpoint hook for SANO.
 *
 * Drives layout decisions based on window dimensions so the same component
 * tree looks great on a 375dp phone, a 768dp tablet, and a 1280dp desktop.
 *
 * Usage:
 *   const { isTablet, contentPadding, contentMaxWidth } = useLayout();
 *
 * Desktop dashboard is a *derivative* of mobile — same screens and components,
 * wider canvas with larger padding and optional max-width centering.
 */

import { useWindowDimensions } from 'react-native';
import { BREAKPOINTS, MAX_CONTENT_WIDTH, SPACE } from '../theme';

export interface Layout {
  /** Raw window width in dp */
  width: number;
  /** Raw window height in dp */
  height: number;

  // ── Breakpoint flags ─────────────────────────────────────────────────────
  isPhone:   boolean;   // < 768dp
  isTablet:  boolean;   // 768 – 1023dp
  isDesktop: boolean;   // ≥ 1024dp

  // ── Content sizing ───────────────────────────────────────────────────────
  /**
   * Horizontal padding for ScrollView / screen containers.
   * Phone: 16dp · Tablet: 24dp · Desktop: 40dp
   */
  contentPadding: number;

  /**
   * Optional maxWidth to apply to inner content container on wide screens.
   * Undefined on phones — let content fill naturally.
   */
  contentMaxWidth: number | undefined;

  /**
   * Number of stat-tile columns that comfortably fit.
   * Phone: 3 · Tablet: 4 · Desktop: 5
   */
  statColumns: number;

  /**
   * Whether the layout is wide enough to show two side-by-side content columns
   * (e.g. form + preview, list + detail).
   */
  isTwoColumn: boolean;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();

  const isPhone   = width < BREAKPOINTS.tablet;
  const isTablet  = width >= BREAKPOINTS.tablet && width < BREAKPOINTS.desktop;
  const isDesktop = width >= BREAKPOINTS.desktop;

  const contentPadding: number = isDesktop
    ? SPACE.xxxl           // 48dp — generous breathing room on desktop
    : isTablet
      ? SPACE.xl           // 24dp — comfortable tablet margin
      : SPACE.base;        // 16dp — compact mobile margin

  const contentMaxWidth: number | undefined = isDesktop
    ? MAX_CONTENT_WIDTH.desktop   // 860dp
    : isTablet
      ? MAX_CONTENT_WIDTH.tablet  // 620dp
      : undefined;                // full width on phone

  const statColumns = isDesktop ? 5 : isTablet ? 4 : 3;

  const isTwoColumn = isTablet || isDesktop;

  return {
    width,
    height,
    isPhone,
    isTablet,
    isDesktop,
    contentPadding,
    contentMaxWidth,
    statColumns,
    isTwoColumn,
  };
}
