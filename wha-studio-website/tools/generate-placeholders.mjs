#!/usr/bin/env node
/**
 * Generates clearly-labeled placeholder artwork for the WHA Studio prototype.
 *
 * These SVGs stand in for real project photography, which must be exported
 * from the studio's own archive (see README.md → "Replacing placeholder
 * imagery"). Each file carries a visible caption so it can never be mistaken
 * for a finished photograph.
 *
 * Run:  node tools/generate-placeholders.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------------------------------------------------------- helpers */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function svgDoc({ w, h, id, title, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-t">
<title id="${id}-t">${esc(title)} — placeholder artwork, awaiting WHA Studio photography</title>
<desc>Abstract architectural placeholder. Replace with real project photography.</desc>
${body}
</svg>\n`;
}

function grain(id, w, h, opacity = 0.05) {
  return `<filter id="${id}-n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
<rect width="${w}" height="${h}" filter="url(#${id}-n)" opacity="${opacity}"/>`;
}

function caption(text, w, h, light) {
  const fill = light ? 'rgba(244,241,234,0.5)' : 'rgba(20,20,18,0.45)';
  const fs = Math.max(14, Math.round(w * 0.0085));
  return `<text x="${Math.round(w * 0.03)}" y="${h - Math.round(w * 0.022)}" font-family="Helvetica, Arial, sans-serif" font-size="${fs}" letter-spacing="${(fs * 0.14).toFixed(1)}" fill="${fill}">${esc(text.toUpperCase())}</text>`;
}

function lines(w, h, n, color, op, vertical = false) {
  let out = `<g stroke="${color}" stroke-width="1" opacity="${op}">`;
  for (let i = 1; i < n; i++) {
    const p = Math.round((vertical ? w : h) * (i / n));
    out += vertical
      ? `<line x1="${p}" y1="0" x2="${p}" y2="${h}"/>`
      : `<line x1="0" y1="${p}" x2="${w}" y2="${p}"/>`;
  }
  return out + '</g>';
}

/* Architectural gesture per motif ---------------------------------------- */

function motif(kind, w, h, ink, tone, accent) {
  switch (kind) {
    case 'linear': // long horizontal strata — RM Residence's 78 m spine
      return `
<rect x="0" y="${h * 0.42}" width="${w}" height="${h * 0.16}" fill="${tone}" opacity="0.9"/>
<rect x="${w * 0.12}" y="${h * 0.30}" width="${w * 0.62}" height="${h * 0.12}" fill="${accent}" opacity="0.85"/>
<rect x="${w * 0.55}" y="${h * 0.58}" width="${w * 0.45}" height="${h * 0.1}" fill="${ink}" opacity="0.5"/>
<line x1="0" y1="${h * 0.42}" x2="${w}" y2="${h * 0.42}" stroke="${accent}" stroke-width="3"/>
${lines(w, h, 22, tone, 0.14)}`;
    case 'triptych': // three masses around a void — BS Residence
      return `
<rect x="${w * 0.08}" y="${h * 0.2}" width="${w * 0.22}" height="${h * 0.6}" fill="${tone}" opacity="0.85"/>
<rect x="${w * 0.38}" y="${h * 0.12}" width="${w * 0.24}" height="${h * 0.76}" fill="${accent}" opacity="0.8"/>
<rect x="${w * 0.7}" y="${h * 0.2}" width="${w * 0.22}" height="${h * 0.6}" fill="${tone}" opacity="0.6"/>
<rect x="${w * 0.38}" y="${h * 0.62}" width="${w * 0.24}" height="${h * 0.1}" fill="${ink}" opacity="0.55"/>
${lines(w, h, 16, tone, 0.12, true)}`;
    case 'court': // frame around a courtyard void
      return `
<rect x="${w * 0.14}" y="${h * 0.14}" width="${w * 0.72}" height="${h * 0.72}" fill="none" stroke="${accent}" stroke-width="4"/>
<rect x="${w * 0.3}" y="${h * 0.3}" width="${w * 0.4}" height="${h * 0.4}" fill="${tone}" opacity="0.85"/>
<line x1="${w * 0.14}" y1="${h * 0.14}" x2="${w * 0.3}" y2="${h * 0.3}" stroke="${tone}" stroke-width="2" opacity="0.6"/>
<line x1="${w * 0.86}" y1="${h * 0.86}" x2="${w * 0.7}" y2="${h * 0.7}" stroke="${tone}" stroke-width="2" opacity="0.6"/>
${lines(w, h, 18, tone, 0.1)}`;
    case 'stair': // stepped section
      { let steps = '';
        for (let i = 0; i < 7; i++) {
          steps += `<rect x="${w * (0.15 + i * 0.1)}" y="${h * (0.72 - i * 0.08)}" width="${w * 0.1}" height="${h * (0.08 + i * 0.08)}" fill="${i % 2 ? tone : accent}" opacity="${0.9 - i * 0.06}"/>`;
        }
        return steps + lines(w, h, 20, tone, 0.12); }
    case 'terrazzo': // scattered aggregate — Mori Tower's green terrazzo
      { let chips = '';
        const pts = [[0.12,0.2,52],[0.3,0.36,34],[0.24,0.66,44],[0.48,0.18,28],[0.55,0.5,58],[0.44,0.82,36],[0.72,0.3,42],[0.8,0.66,50],[0.66,0.72,26],[0.88,0.16,30],[0.15,0.45,24],[0.9,0.45,36],[0.35,0.55,20],[0.6,0.9,30],[0.82,0.88,22]];
        pts.forEach(([x, y, r], i) => {
          const cx = w * x, cy = h * y;
          chips += `<polygon points="${cx},${cy - r} ${cx + r * 0.9},${cy - r * 0.2} ${cx + r * 0.5},${cy + r} ${cx - r * 0.7},${cy + r * 0.6}" fill="${i % 3 === 0 ? accent : tone}" opacity="${i % 2 ? 0.75 : 0.5}"/>`;
        });
        return chips + `<rect x="0" y="${h * 0.78}" width="${w}" height="${h * 0.22}" fill="${ink}" opacity="0.35"/>` + lines(w, h, 14, tone, 0.08); }
    case 'shaft': // vertical light shaft — narrow-plot flagship
      return `
<rect x="${w * 0.42}" y="0" width="${w * 0.16}" height="${h}" fill="${accent}" opacity="0.8"/>
<rect x="${w * 0.42}" y="0" width="${w * 0.16}" height="${h}" fill="url(#shaftGrad)" opacity="0.9"/>
<rect x="${w * 0.12}" y="${h * 0.15}" width="${w * 0.3}" height="${h * 0.14}" fill="${tone}" opacity="0.7"/>
<rect x="${w * 0.58}" y="${h * 0.38}" width="${w * 0.3}" height="${h * 0.14}" fill="${tone}" opacity="0.7"/>
<rect x="${w * 0.12}" y="${h * 0.61}" width="${w * 0.3}" height="${h * 0.14}" fill="${tone}" opacity="0.7"/>
${lines(w, h, 5, tone, 0.35)}`;
    case 'grid': // drafting grid + one bold arc
      return `
${lines(w, h, 14, tone, 0.2)}${lines(w, h, 14, tone, 0.2, true)}
<path d="M ${w * 0.1} ${h * 0.85} Q ${w * 0.5} ${h * 0.05} ${w * 0.9} ${h * 0.85}" fill="none" stroke="${accent}" stroke-width="5"/>
<circle cx="${w * 0.5}" cy="${h * 0.45}" r="${Math.min(w, h) * 0.16}" fill="${tone}" opacity="0.5"/>`;
    case 'monogram': // studio portrait placeholder
      return `
<circle cx="${w * 0.5}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.2}" fill="none" stroke="${accent}" stroke-width="3"/>
<line x1="${w * 0.2}" y1="${h * 0.78}" x2="${w * 0.8}" y2="${h * 0.78}" stroke="${tone}" stroke-width="2" opacity="0.7"/>
${lines(w, h, 12, tone, 0.1)}`;
    default:
      return lines(w, h, 18, tone, 0.15);
  }
}

function makeImage({ file, w, h, title, ink, tone, accent, kind, label }) {
  const id = file.replace(/[^a-z0-9]/gi, '');
  const body = `
<defs>
  <linearGradient id="${id}-g" x1="0" y1="0" x2="0.85" y2="1">
    <stop offset="0" stop-color="${ink}"/>
    <stop offset="1" stop-color="${shade(ink, 18)}"/>
  </linearGradient>
  <linearGradient id="shaftGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#F4F1EA" stop-opacity="0.55"/>
    <stop offset="1" stop-color="#F4F1EA" stop-opacity="0"/>
  </linearGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#${id}-g)"/>
${motif(kind, w, h, ink, tone, accent)}
${grain(id, w, h)}
${caption(label, w, h, true)}`;
  writeFileSync(join(ROOT, 'assets', file), svgDoc({ w, h, id, title, body }));
  console.log('wrote assets/' + file);
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + amt), g = Math.min(255, ((n >> 8) & 255) + amt), b = Math.min(255, (n & 255) + amt);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/* ------------------------------------------------------------------ spec */

const PROJECTS = [
  { slug: 'rm-residence',   ink: '#26251F', tone: '#C9C2B4', accent: '#A8875A', kind: 'linear'   },
  { slug: 'bs-residence',   ink: '#23261F', tone: '#A9AC96', accent: '#7A7E6A', kind: 'triptych' },
  { slug: 'aj-residence',   ink: '#2B2723', tone: '#C4B49A', accent: '#B0906A', kind: 'court'    },
  { slug: 'al-residence',   ink: '#282623', tone: '#BDB6A8', accent: '#8B877E', kind: 'stair'    },
  { slug: 'expat-mori',     ink: '#1F2422', tone: '#8FA093', accent: '#5F7566', kind: 'terrazzo' },
  { slug: 'expat-flagship', ink: '#28211A', tone: '#B98F5A', accent: '#D8C4A0', kind: 'shaft'    },
];

for (const p of PROJECTS) {
  mkdirSync(join(ROOT, 'assets', 'projects', p.slug), { recursive: true });
  makeImage({ file: `projects/${p.slug}/cover.svg`,  w: 1200, h: 1500, title: p.slug, ...p, label: `Placeholder · ${p.slug.replace(/-/g, ' ')} photography` });
  makeImage({ file: `projects/${p.slug}/01.svg`,     w: 2000, h: 1250, title: p.slug, ...p, label: `Placeholder · ${p.slug.replace(/-/g, ' ')} photography` });
  makeImage({ file: `projects/${p.slug}/02.svg`,     w: 1200, h: 1500, title: p.slug, ...p, kind: 'grid', label: `Placeholder · drawing / detail` });
}

makeImage({ file: 'hero.svg', w: 2400, h: 1500, title: 'hero', ink: '#1E1D1A', tone: '#C9C2B4', accent: '#A8875A', kind: 'linear', label: 'Placeholder · replace with signature project photograph' });
makeImage({ file: 'hero-aperture.svg', w: 1000, h: 1250, title: 'hero detail', ink: '#26251F', tone: '#A9AC96', accent: '#A8875A', kind: 'shaft', label: 'Placeholder · detail crop' });

const PROCESS = [
  { file: 'process/decode.svg',    kind: 'grid',     ink: '#1E1D1A', tone: '#8B877E', accent: '#C9C2B4', label: 'Placeholder · site study' },
  { file: 'process/distill.svg',   kind: 'linear',   ink: '#26251F', tone: '#C9C2B4', accent: '#A8875A', label: 'Placeholder · concept drawing' },
  { file: 'process/prototype.svg', kind: 'court',    ink: '#23261F', tone: '#A9AC96', accent: '#7A7E6A', label: 'Placeholder · mock-up / detail' },
  { file: 'process/realize.svg',   kind: 'shaft',    ink: '#28211A', tone: '#B98F5A', accent: '#D8C4A0', label: 'Placeholder · site photograph' },
];
for (const s of PROCESS) makeImage({ w: 1600, h: 1200, title: s.file, ...s });

makeImage({ file: 'studio/wilson.svg',  w: 1000, h: 1250, title: 'Wilson Harkhono',  ink: '#26251F', tone: '#C9C2B4', accent: '#A8875A', kind: 'monogram', label: 'Placeholder · portrait, Wilson Harkhono' });
makeImage({ file: 'studio/carissa.svg', w: 1000, h: 1250, title: 'Carissa Tjondro', ink: '#23261F', tone: '#A9AC96', accent: '#7A7E6A', kind: 'monogram', label: 'Placeholder · portrait, Carissa Tjondro' });

console.log('done');
