# SANO / WHAstudio — Moodboard & Graphic Standard

> A portable design summary derived from two sources: the **SANO app design system**
> (`workflows/theme.ts`, component library) and the **original WHAstudio brand
> guideline** (`WHAstudio_SAN_Sistem_Kontrol_Spesifikasi_Desain_v3.0`). Both share one
> coherent visual language — this document distills it so a *second app* can adopt the
> same look without reverse-engineering the codebase.

---

## 1. The mood in one paragraph

**Warm, grounded, precise.** This is the visual world of an Indonesian construction-
control system, so it deliberately rejects the cold blue/white of generic SaaS. Instead
it sits on a palette of **sand, oat, and warm near-black** — the colors of concrete,
raw earth, paper, and timber on site. Type is a single geometric-humanist sans (**Space
Grotesk**) that reads as engineered yet approachable. Surfaces are calm and matte; the
only loud moments are **solid-black data-table headers** and **status colors** that fire
only when something needs attention. The feeling is a well-made field notebook or a
quantity-surveyor's spec sheet: quiet confidence, no decoration for its own sake,
truth-on-the-page.

Keywords: *earthen · tactile · documentary · disciplined · low-stimulus · trustworthy.*

---

## 2. Color palette

Every color is **tinted warm** — never pure black, never pure white, never a cold gray.
This is the single most important rule of the brand.

### Core neutrals
| Token | Hex | Role |
|---|---|---|
| `primary` / `text` | `#141210` | Warm near-black. Headlines, body text, table headers. *Not* `#000`. |
| `bg` | `#D2D0C4` | **Oat** — the app/page background. The signature surface. |
| `bgOat` | `#C6C1B6` | Slightly darker oat — subtle section dividers. |
| `surface` | `#FDFAF6` | Warm near-white — cards, panels, content blocks. *Not* `#FFF`. |
| `surfaceAlt` | `#F2EFE9` | Warmer off-white — disabled / inactive surfaces. |

### Brand accent (the "sand" family)
| Token | Hex | Role |
|---|---|---|
| `accent` | `#B29F86` | **Sand** — brand warmth. Rules, dividers, sub-headings, active states, logo on dark. |
| `accentDark` | `#7A6B56` | Darker sand — accent text on light backgrounds (passes contrast). |
| `accentBg` | `rgba(178,159,134,0.10–0.12)` | Sand tint for selected/active backgrounds. |

### Text
| Token | Hex | Role |
|---|---|---|
| `text` | `#141210` | Primary text. |
| `textSec` | `#524E49` | Secondary text — 5.0:1 on oat, 5.9:1 on surface (WCAG AA ✓). |
| `textMuted` | `#847E78` | Muted / placeholder — **large sizes only** (fails AA at small sizes). |

### Borders
| Token | Value | Role |
|---|---|---|
| `border` | `#B5AFA8` | Visible borders. |
| `borderSub` | `rgba(148,148,148,0.18)` | Subtle card borders. |

### Semantic / status colors (the "Flag System")
Used **only** to signal state — never decoratively. Each has a matching 8–10% tint
background for badges and rows. A 5-step severity ladder:

| Flag | Color | Hex | Tint bg |
|---|---|---|---|
| `OK` | green | `#3D8B40` | `rgba(61,139,64,0.08)` |
| `INFO` | blue | `#1565C0` | `rgba(21,101,192,0.08)` |
| `WARNING` | amber | `#E65100` | `rgba(230,81,0,0.10)` |
| `HIGH` | deep orange | `#BF360C` | `rgba(191,54,12,0.10)` |
| `CRITICAL` | red | `#C62828` | `rgba(198,40,40,0.08)` |

> All status colors are **darkened** versions of their hue so they hold contrast on the
> warm-light surfaces. Don't use bright/neon stoplight colors.

### Inverse (text on dark/`primary` backgrounds)
`textInverse #FDFAF6` · `textInverseSec rgba(253,250,246,0.65)` · `textInverseMuted rgba(253,250,246,0.40)`

---

## 3. Typography

**One typeface only: Space Grotesk** (geometric humanist — "precise yet warm").
Loaded via Google Fonts / `@expo-google-fonts/space-grotesk`.

### Weights
| Name | Weight |
|---|---|
| light | 300 |
| regular | 400 |
| medium | 500 |
| semibold | 600 |
| bold | 700 |

### Type scale — modular 1.25 ratio, base 14, mobile-first
| Token | px | Use |
|---|---|---|
| `xs` | 12 | captions, timestamps, badge labels (minimum for mobile) |
| `sm` | 13 | secondary labels, hints, field notes |
| `base` | 15 | body / list items |
| `md` | 16 | input text, card body |
| `lg` | 19 | subheadings, card titles |
| `xl` | 24 | section stats |
| `xxl` | 30 | display numbers |

(The brand-document/print layer scales larger — display headings up to 44–56px for
covers and hero numbers — but uses the same family and weight logic.)

### Type treatments (signatures)
- **Labels & eyebrows**: UPPERCASE, `letterSpacing` 0.4–1.5, semibold/bold, often in
  `accent`. Used for card titles, kickers, badge text, the "WHAstudio" wordmark.
- **Card titles**: 13px **bold, uppercase, +0.8 letter-spacing** — small but assertive.
- **Body**: regular 15px, line-height ~1.3–1.45.
- **Display headings** (brand doc): bold, tight, near-black, with a thin sand underline
  rule beneath section numbers.

---

## 4. Spacing, radius, dimension

### Spacing scale (4px base grid)
`xs 4 · sm 8 · md 12 · base 16 · lg 20 · xl 24 · xxl 32 · xxxl 48`

### Corner radius
| Token | px | Use |
|---|---|---|
| `RADIUS_SM` | 5 | badges, chips, small controls |
| `RADIUS` | 8 | default — cards, buttons, inputs |
| `RADIUS_LG` | 14 | sheets, modals, large containers |

Soft, modern, never pill-shaped (except true toggles), never sharp 0px corners.

### Touch & accessibility
- **Minimum touch target: 44×44dp** (WCAG 2.5.5) for everything interactive.
- Body text meets **WCAG AA contrast** on both oat and surface.

### Responsive breakpoints
`phone 0–767 · tablet 768–1023 · desktop 1024+`. Desktop is a *derivative* of mobile —
same components, wider canvas, max content width (`tablet 620 · desktop 860`) to keep
lines readable. Mobile-first always.

---

## 5. Components & surface treatment

- **Cards**: warm-white (`surface`) on oat (`bg`), `RADIUS` 8, 1px `borderSub`,
  `padding base` (16). **Shadow is warm**, not gray: `shadowColor #5A4A3A`, offset
  (0,2), opacity 0.07, radius 6. Subtle elevation only.
- **Accent indicator**: a card carries meaning via an 8px **colored dot** in the title
  row — *not* a colored left border. (The old 4px left-border pattern was explicitly
  retired as "lazy.") The surface itself stays neutral; only the dot carries semantics.
- **Badges**: tinted background + matching status text color, uppercase semibold 12px,
  `RADIUS_SM`, padding 7×3.
- **Data tables (signature element)**: **solid near-black header row with white text**,
  then alternating warm-white / faint-gray body rows. This is the most recognizable
  graphic device across both the app and the brand documents.
- **Callout boxes** (from the brand doc, worth porting): pale-green tint for
  *insight/principle* notes, pale-cream/yellow tint for *risk/warning* notes — both with
  a bold lead-in word.

---

## 6. Logo & brand marks

Two marks coexist:

1. **WHAstudio** — the parent studio. Rendered as a simple uppercase/mixed wordmark,
   small, often paired with a thin sand rule as a document header/footer
   (`WHAstudio | Sistem Kontrol SAN | Spesifikasi Desain v3.0`).
2. **SANO** — the product. A custom **typographic logotype** (the letters S-A-N-O drawn
   as continuous geometric strokes — see `LOGO SANO.svg` / `SanoBrand.tsx`). It's a
   single SVG path system, recolorable via one fill:
   - on light → `#141210` (warm near-black)
   - on dark → `#FDFAF6` (warm near-white)
   - Native aspect ratio **315.66 × 87.26** (≈ 3.6:1). Default render width 160 (compact 100).
   - Optional subtitle beneath in `textSec` / 13px regular, or compact uppercase +0.4 tracking.

Brand mark rules: never recolor outside the palette, never add effects, keep clear
space, scale by the SVG's own ratio.

---

## 7. Layout & composition principles

- **Document-like structure**: numbered sections, sand rules, running header + footer,
  page-number / confidentiality line. The app inherits this "spec sheet" rigor.
- **Generous whitespace**, single-column mobile, content max-widths on desktop.
- **Hierarchy through weight + spacing + the sand accent**, not through many colors or
  boxes. The page is calm; emphasis is earned.
- **Tables over prose** for structured data; black header is the anchor.

---

## 8. Do / Don't (the brand's guardrails)

**Do**
- Tint every neutral warm (toward sand). Pure `#000`/`#FFF`/cold-gray is forbidden.
- Use one typeface (Space Grotesk) at varied weights.
- Reserve color for *status meaning* (the 5-flag ladder) and *accent* (sand).
- Use the black-header table as the primary data device.
- Keep shadows warm and subtle; keep radii soft (5/8/14).
- Honor 44dp touch targets and AA contrast.

**Don't**
- Don't introduce a second font family or a cold/blue SaaS palette.
- Don't use bright/neon stoplight status colors — use the darkened set.
- Don't carry meaning with colored card borders — use the dot.
- Don't decorate with color; if it isn't status or accent, it's neutral.
- Don't use pill buttons or 0px-sharp corners as the default.

---

## 9. Copy-paste tokens for the new app

```js
// SANO / WHAstudio design tokens — warm, grounded, precise
export const COLORS = {
  primary:   '#141210', accent: '#B29F86', accentDark: '#7A6B56',
  bg:        '#D2D0C4', bgOat: '#C6C1B6', surface: '#FDFAF6', surfaceAlt: '#F2EFE9',
  text:      '#141210', textSec: '#524E49', textMuted: '#847E78',
  border:    '#B5AFA8', borderSub: 'rgba(148,148,148,0.18)',
  ok: '#3D8B40', info: '#1565C0', warning: '#E65100', high: '#BF360C', critical: '#C62828',
  accentBg:  'rgba(178,159,134,0.10)',
  okBg: 'rgba(61,139,64,0.08)', infoBg: 'rgba(21,101,192,0.08)',
  warningBg: 'rgba(230,81,0,0.10)', highBg: 'rgba(191,54,12,0.10)', criticalBg: 'rgba(198,40,40,0.08)',
  textInverse: '#FDFAF6', textInverseSec: 'rgba(253,250,246,0.65)', textInverseMuted: 'rgba(253,250,246,0.40)',
};
export const FONT_FAMILY = 'Space Grotesk'; // weights 300/400/500/600/700
export const TYPE  = { xs:12, sm:13, base:15, md:16, lg:19, xl:24, xxl:30 };
export const SPACE = { xs:4, sm:8, md:12, base:16, lg:20, xl:24, xxl:32, xxxl:48 };
export const RADIUS = { sm:5, base:8, lg:14 };
export const TOUCH_TARGET = 44;
export const SHADOW = { color:'#5A4A3A', offset:{w:0,h:2}, opacity:0.07, radius:6 };
```

---

*Sources: `workflows/theme.ts`, `workflows/components/{SanoBrand,Card,Badge}.tsx`,
`LOGO SANO.svg`, `SANO_Onboarding.html`, and
`WHAstudio_SAN_Sistem_Kontrol_Spesifikasi_Desain_v3.0_ID.pdf`. Both the product and the
brand guideline resolve to the same palette/type/radius tokens — they are one system.*
