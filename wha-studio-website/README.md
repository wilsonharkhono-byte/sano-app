# WHA Studio — Website Prototype

**Concept: “Drawn, Then Built.”**
Every element of the site enters as a drawing and resolves into built reality —
linework assembles into apertures, apertures open into imagery, typography
behaves like structure. It mirrors what makes WHA Studio different: one line
carried from the first sketch through construction and furniture fabrication.

Designing Excellence. Building Legacies.

---

## Run it locally

No build step, no server required:

1. **Quickest:** open `prototype.html` in any modern browser — it is fully
   self-contained (styles, script, and imagery inlined).
2. **Source version:** open `index.html` directly, or serve the folder
   (`npx serve .` / `python3 -m http.server`) for correct history/deep-link
   behavior on project URLs (`#/projects/<slug>` works either way).

Web fonts (Fraunces + Archivo) load from Google Fonts when online; the site
remains fully legible on the bundled fallback stacks when offline.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure, SEO/OG metadata, JSON-LD schema |
| `styles.css` | The complete design system (tokens, sections, responsive, reduced-motion) |
| `script.js` | Project data + all interactions, vanilla JS, no dependencies |
| `assets/` | Placeholder artwork (see below) |
| `prototype.html` | Generated single-file build — regenerate with `node tools/build-prototype.mjs` |
| `tools/generate-placeholders.mjs` | Regenerates the placeholder SVGs |

## Signature interactions

1. **Opening sequence** — the WHA letterform is drawn as linework, then the
   dark field opens like an aperture into the hero. Plays once per session,
   skippable by any input, disabled entirely under reduced motion.
2. **Project universe** — vertical scroll drives a horizontal project rail
   (drag and arrow keys also work); on touch/small screens it becomes a
   native swipeable, snap-aligned story rail. Progress line + index keep
   orientation at all times. Category filtering rebuilds the rail.
3. **Immersive project detail** — full-screen overlay with deep-linkable
   URLs (`#/projects/rm-residence`), browser back-button support, prev/next
   navigation (buttons or arrow keys), copy-link, focus trap, Escape to close.
4. **Process as spatial narrative** — a sticky four-phase sequence
   (Decode → Distill → Prototype → Realize) where scrolling advances the
   active phase, crossfades the visual field, and drives a progress meter.
5. **Pointer-responsive hero depth** — image, aperture inset, and title move
   on separate planes under a fine pointer (mouse only; inert on touch and
   under reduced motion).

Plus: scroll-adaptive navigation, page progress line, full-screen mobile menu
with numbered typography, reveal-on-scroll editorial lines, expandable founder
credentials, and a working inquiry form flow.

## Accessibility

- Semantic landmarks, heading hierarchy, skip link
- Keyboard: rail arrows, Enter to open, Escape closes overlay/menu, focus
  traps in both dialogs, visible focus rings
- `aria-expanded` / `aria-pressed` / `aria-modal` / live-region form status
- `prefers-reduced-motion` honored **and** a manual “Reduce motion” toggle in
  the footer (persisted); both collapse the scroll-driven sections into
  ordinary static/native-scroll layouts
- No information conveyed by motion or color alone; works fully without JS
  (static document with native scrolling; a `<noscript>` note covers the
  JS-built gallery)

## Performance

- Zero JS dependencies (~14 KB script, unminified); no framework
- SVG placeholder art is a few KB per image; real photography should be
  exported as AVIF/WebP with `srcset` (see below)
- Only the hero asset is preloaded; everything below the fold is `loading="lazy"`
- All animation uses `transform`/`opacity`; scroll work is rAF-throttled
- Ornamental animation pauses when the tab is hidden

## ⚠ Placeholder content — read before publishing

The environment this prototype was built in could not access
`www.whastudio.com` (network policy), so **no real photography or unpublished
copy could be pulled**. In line with the studio's no-invented-content rule:

- **All imagery** is generated abstract artwork, visibly captioned
  “Placeholder …” inside each file. Replace files under `assets/projects/<slug>/`
  (`cover`, `01`, `02` — any raster format; update paths in `script.js`).
- Items marked `[PLACEHOLDER]` in the `PROJECTS` array of `script.js`
  (AJ/AL Residence statements, some years, flagship location) need studio
  confirmation. Statements for RM/BS Residence and both Expat Roasters
  projects are paraphrased from the studio's published descriptions.
- The inquiry form has **no backend**: it validates, then copies an inquiry
  summary to the visitor's clipboard and points at live channels
  (Instagram @whastudio, whastudio.com/contact-us). Wire it to the studio
  inbox/WhatsApp in production. No fabricated email/phone was included.
- Founder credentials are exactly those supplied in the brief — nothing added.

## Suggested production stack

Next.js + TypeScript, Framer Motion (or GSAP for the rail/process
choreography), a headless CMS (Sanity/Payload) holding the same project
schema as `PROJECTS` in `script.js`, `next/image` for the responsive image
pipeline, deployed on Vercel. Keep this prototype as the interaction spec.

## Testing checklist

Verified at 360×800, 390×844, 430×932, 768×1024, 1024×768, 1280–1920 desktop:
no horizontal overflow, menu open/close/reopen, overlay Escape/back-button,
filters, keyboard rail navigation, reduced-motion mode, form validation.
