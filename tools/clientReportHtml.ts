// SANO — Client Progress Report HTML render
// Ports the "Blueprint Precision" template VERBATIM (assets/Client Progress
// Report Template/SANO_Laporan_Harian-Mingguan_Blueprint.html). Only the
// screen-only .toolbar is removed and placeholders are substituted. CSS values
// are NOT re-authored (spec §1.2 fidelity contract).

import { Platform } from 'react-native';
import type { ClientReportDraft } from './clientReport';

export function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// VERBATIM from the blueprint HTML <style> block (lines 11–148). Do not edit values.
const BLUEPRINT_CSS = `
  /* ============================================================
     SANO — Laporan Harian / Mingguan · "Blueprint Precision"
     Base: variant A. Monochrome + sand accent, near-white paper,
     corner registration marks, A4 single page.
     ============================================================ */
  :root{
    --ink:#16130f; --ink-2:#57514a; --ink-3:#8c857a;
    --paper:#FDFCF9; --paper-2:#F4F1EA;
    --sand:#7A6B56; --sand-lt:#C9B79A;
    --line:#16130f; --line-sub:#dcd6ca;
  }
  *{box-sizing:border-box}
  html{ -webkit-text-size-adjust:100%; }
  body{
    margin:0; background:#cfccc2; color:var(--ink);
    font-family:"Space Grotesk", system-ui, sans-serif;
    font-size:12px; line-height:1.4; font-weight:400; -webkit-font-smoothing:antialiased;
  }

  /* ---- screen-only toolbar ----------------------------------- */
  .toolbar{
    position:sticky; top:0; z-index:50; display:flex; align-items:center; justify-content:space-between;
    gap:14px; padding:9px 18px; background:rgba(207,204,194,.94);
    backdrop-filter:saturate(120%) blur(4px); border-bottom:1px solid #b9b5a9; font-size:12px; color:var(--ink-2);
  }
  .toolbar .grp{ display:flex; align-items:center; gap:10px; }
  .seg{ display:inline-flex; border:1px solid var(--ink); border-radius:7px; overflow:hidden; }
  .seg button{
    appearance:none; border:0; background:transparent; color:var(--ink); font-family:inherit;
    font-size:10px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; padding:6px 12px; cursor:pointer;
  }
  .seg button.on{ background:var(--ink); color:var(--paper); }
  .btn{
    appearance:none; border:1px solid var(--ink); background:var(--ink); color:var(--paper); font-family:inherit;
    font-size:11px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; padding:8px 16px; border-radius:7px; cursor:pointer;
  }
  .btn:hover{ opacity:.88 }

  /* ---- A4 sheet ---------------------------------------------- */
  .sheet{
    position:relative; width:210mm; min-height:297mm; max-width:calc(100% - 24px); margin:20px auto;
    background:var(--paper); color:var(--ink);
    box-shadow:0 2px 6px rgba(70,58,44,.08), 0 18px 50px rgba(70,58,44,.12);
    padding:16mm 15mm 12mm; display:flex; flex-direction:column;
  }
  /* corner registration marks */
  .mark{ position:absolute; width:13px; height:13px; pointer-events:none; }
  .mark.tl{ top:9mm; left:9mm; border-left:1.4px solid var(--ink); border-top:1.4px solid var(--ink); }
  .mark.tr{ top:9mm; right:9mm; border-right:1.4px solid var(--ink); border-top:1.4px solid var(--ink); }
  .mark.bl{ bottom:9mm; left:9mm; border-left:1.4px solid var(--ink); border-bottom:1.4px solid var(--ink); }
  .mark.br{ bottom:9mm; right:9mm; border-right:1.4px solid var(--ink); border-bottom:1.4px solid var(--ink); }

  /* ---- masthead --------------------------------------------- */
  .top{ display:flex; align-items:flex-start; justify-content:space-between; }
  .brand{ display:flex; align-items:center; gap:9px; }
  .brand .logo{ font-weight:700; font-size:19px; letter-spacing:.14em; }
  .brand .tick{ width:18px; height:1.4px; background:var(--ink); }
  .top .hdrmeta{ text-align:right; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3); line-height:1.7; }
  .top .hdrmeta b{ color:var(--ink-2); font-weight:600; }

  .kicker{ margin-top:14px; font-size:10px; letter-spacing:.26em; text-transform:uppercase; color:var(--sand); font-weight:600; }
  h1{ font-size:34px; font-weight:700; letter-spacing:-.015em; line-height:1; margin:6px 0 0; }
  .subtitle{ margin-top:5px; font-size:13px; color:var(--ink-2); }

  /* ---- metadata strip --------------------------------------- */
  .strip{
    margin-top:13px; border-top:1.4px solid var(--line); border-bottom:1.4px solid var(--line);
    display:grid; grid-template-columns:1.15fr 1.15fr .8fr 1.5fr 1.1fr;
  }
  .strip .cell{ padding:9px 13px; border-right:1px solid var(--line-sub); }
  .strip .cell:last-child{ border-right:0; }
  .strip .lab{ font-size:8.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3); }
  .strip .val{ margin-top:4px; font-size:13px; font-weight:600; }
  .strip .val.accent{ color:var(--sand); }
  .strip .crew{ margin-top:3px; font-size:9.5px; font-weight:400; color:var(--ink-2); line-height:1.45; }

  /* ---- sections --------------------------------------------- */
  section{ margin-top:13px; }
  .sec-head{ display:flex; align-items:baseline; gap:9px; }
  .sec-head .no{ font-size:11px; font-weight:700; letter-spacing:.1em; color:var(--sand); }
  .sec-head h2{ font-size:12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; margin:0; }

  /* update list */
  .updates{ margin-top:7px; }
  .row{ display:grid; grid-template-columns:64px 200px 1fr; gap:14px; align-items:baseline;
        padding:6px 0; border-bottom:1px solid var(--line-sub); }
  .row:first-child{ border-top:1px solid var(--line-sub); }
  .row .date{ font-size:9.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--sand); }
  .row .area{ font-size:12.5px; font-weight:600; }
  .row .note{ font-size:12px; color:var(--ink-2); }

  /* documentation */
  .hero{ margin-top:9px; position:relative; border:1px solid var(--ink); }
  .ph{ display:flex; align-items:center; justify-content:center; width:100%;
    background:repeating-linear-gradient(135deg, rgba(122,107,86,.06) 0 11px, rgba(122,107,86,.12) 11px 22px), var(--paper-2);
    color:var(--sand); letter-spacing:.22em; text-transform:uppercase; }
  .hero .ph{ height:50mm; font-size:10px; }
  .hero .cap{ position:absolute; left:0; right:0; bottom:0; background:var(--ink); color:var(--paper);
    font-size:10.5px; padding:7px 12px; display:flex; gap:9px; align-items:center; }
  .hero .cap .d{ color:var(--sand-lt); font-weight:600; letter-spacing:.08em; text-transform:uppercase; font-size:9px; }
  .thumbs{ margin-top:9px; display:grid; grid-template-columns:repeat(3,1fr); gap:9px; }
  figure{ margin:0; }
  figure .ph{ height:26mm; font-size:8.5px; border:1px solid var(--line-sub); }
  figcaption{ margin-top:5px; font-size:9.5px; color:var(--ink-2); }
  figcaption .d{ color:var(--sand); font-weight:600; letter-spacing:.08em; text-transform:uppercase; }

  /* ---- footer block ----------------------------------------- */
  .closing{ margin-top:auto; padding-top:14px; }
  .plan{ display:flex; justify-content:space-between; align-items:flex-start; gap:30px;
    border-top:1.4px solid var(--line); padding-top:11px; }
  .plan .body{ max-width:74%; }
  .plan .body .no{ font-size:11px; font-weight:700; letter-spacing:.1em; color:var(--sand); }
  .plan .body h2{ display:inline; font-size:12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; margin:0 0 0 6px; }
  .plan .body p{ margin:7px 0 0; font-size:12px; color:var(--ink-2); }
  .plan .safety{ text-align:right; white-space:nowrap; }
  .plan .safety .lab{ font-size:8.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3); }
  .plan .safety .num{ font-size:20px; font-weight:700; margin-top:2px; }
  .plan .safety .sub{ font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); }

  .runfoot{ margin-top:12px; border-top:1px solid var(--line-sub); padding-top:7px;
    display:flex; justify-content:space-between; font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); }
  .dimline{ text-align:center; margin-top:4px; font-size:8px; letter-spacing:.3em; text-transform:uppercase; color:var(--ink-3); }

  /* ---- print ------------------------------------------------- */
  @media print{
    @page{ size:A4; margin:0; }
    body{ background:var(--paper); }
    .toolbar{ display:none !important; }
    .sheet{ width:auto; min-height:auto; max-width:none; margin:0; box-shadow:none; padding:13mm 14mm; }
    section, .hero, figure, .row, .plan{ break-inside:avoid; }
  }
  @media (max-width:680px){
    .sheet{ min-height:0; padding:18px 16px; }
    .strip{ grid-template-columns:1fr 1fr; }
    .strip .cell{ border-bottom:1px solid var(--line-sub); }
    h1{ font-size:30px; } .row{ grid-template-columns:54px 1fr; } .row .note{ grid-column:1 / -1; }
    .thumbs{ grid-template-columns:1fr 1fr; }
  }
`;

export function fmtPeriodLong(kind: string, start: string, end: string): string {
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const p = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
  const a = p(start), b = p(end);
  if (kind === 'harian' || start === end) return `${a.d} ${months[a.m - 1]} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${months[a.m - 1]} ${a.y} – ${b.d} ${months[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${months[a.m - 1]} – ${b.d} ${months[b.m - 1]} ${b.y}`;
  return `${a.d} – ${b.d} ${months[b.m - 1]} ${b.y}`;
}

export function fmtPeriodShort(kind: string, start: string, end: string): string {
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const p = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
  const a = p(start), b = p(end);
  if (kind === 'harian' || start === end) return `${a.d} ${months[a.m - 1]} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${months[a.m - 1]} ${a.y}–${b.d} ${months[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${months[a.m - 1]}–${b.d} ${months[b.m - 1]} ${b.y}`;
  return `${a.d}–${b.d} ${months[b.m - 1]} ${b.y}`;
}

export function renderClientReportHtml(draft: ClientReportDraft): string {
  const kicker = draft.kind === 'harian' ? 'Laporan Harian' : 'Laporan Mingguan';
  const periodeLong = fmtPeriodLong(draft.kind, draft.periodStart, draft.periodEnd);
  const periodeShort = fmtPeriodShort(draft.kind, draft.periodStart, draft.periodEnd);
  const reportTag = `Laporan #${String(draft.reportNo).padStart(2, '0')}`;

  const crewCell = draft.crewTotal != null
    ? `<div class="val">${esc(draft.crewTotal)} orang</div>${draft.crewBreakdown ? `<div class="crew">${esc(draft.crewBreakdown)}</div>` : ''}`
    : `<div class="val">—</div>`;

  const updateRows = draft.updates.map((u) => `
      <div class="row"><span class="date">${esc(u.date)}</span><span class="area">${esc(u.area)}</span><span class="note">${esc(u.note)}</span></div>`).join('');

  const hero = draft.hero
    ? `<div class="hero">
        <div class="ph" style="background-image:url('${esc(draft.hero.url)}');background-size:cover;background-position:center;height:50mm;"></div>
        <div class="cap"><span class="d">${esc(draft.hero.date)}</span><span>${esc(draft.hero.caption)}</span></div>
      </div>`
    : '';

  const thumbs = draft.thumbs.length
    ? `<div class="thumbs">${draft.thumbs.map((t) => `
        <figure><div class="ph" style="background-image:url('${esc(t.url)}');background-size:cover;background-position:center;height:26mm;"></div><figcaption><span class="d">${esc(t.date)}</span> · ${esc(t.caption)}</figcaption></figure>`).join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SANO · ${esc(draft.projectName)} — ${esc(reportTag)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
<style>${BLUEPRINT_CSS}</style></head>
<body>
  <div class="sheet">
    <span class="mark tl"></span><span class="mark tr"></span><span class="mark bl"></span><span class="mark br"></span>
    <div class="top">
      <div class="brand"><span class="logo">SANO</span><span class="tick"></span></div>
      <div class="hdrmeta">Konfidensial<br><b>${esc(reportTag)}</b><br><span>${esc(periodeShort)}</span></div>
    </div>
    <div class="kicker">${esc(kicker)}</div>
    <h1>${esc(draft.projectName)}</h1>
    <div class="subtitle">${esc(draft.subtitle)}</div>
    <div class="strip">
      <div class="cell"><div class="lab">Klien</div><div class="val">${esc(draft.clientName ?? '—')}</div></div>
      <div class="cell"><div class="lab">Periode</div><div class="val">${esc(periodeLong)}</div></div>
      <div class="cell"><div class="lab">Cuaca</div><div class="val">${esc(draft.weather ?? '—')}</div></div>
      <div class="cell"><div class="lab">Tenaga Kerja</div>${crewCell}</div>
      <div class="cell"><div class="lab">Status</div><div class="val accent">${esc(draft.statusLabel)}</div></div>
    </div>
    <section>
      <div class="sec-head"><span class="no">01</span><h2>Update Lapangan</h2></div>
      <div class="updates">${updateRows}</div>
    </section>
    <section>
      <div class="sec-head"><span class="no">02</span><h2>Dokumentasi Lapangan</h2></div>
      ${hero}
      ${thumbs}
    </section>
    <div class="closing">
      <div class="plan">
        <div class="body"><span class="no">03</span><h2>Rencana Periode Berikutnya</h2><p>${esc(draft.nextPlan)}</p></div>
        <div class="safety"><div class="lab">Keselamatan</div><div class="num">${esc(draft.safetyIncidents)} Insiden</div><div class="sub">Lingkungan Aman</div></div>
      </div>
      <div class="runfoot">
        <span>WHAstudio © 2026 · Konfidensial</span>
        <span>${esc(draft.projectName)} · ${esc(reportTag)}</span>
        <span>Hal. 1 / 1</span>
      </div>
      <div class="dimline">A4 · 210 × 297 mm</div>
    </div>
  </div>
</body></html>`;
}

export async function exportClientReportPdf(draft: ClientReportDraft): Promise<void> {
  if (Platform.OS !== 'web') {
    throw new Error('Export PDF laporan klien hanya tersedia di versi web untuk saat ini.');
  }
  const html = renderClientReportHtml(draft);
  const win = window.open('', '_blank');
  if (!win) throw new Error('Popup diblokir. Izinkan popup untuk mencetak laporan.');
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Fidelity safeguard: wait for Space Grotesk before printing (spec §1.2).
  try {
    // @ts-ignore - document.fonts exists in browsers
    if (win.document.fonts?.ready) await win.document.fonts.ready;
  } catch { /* ignore font API gaps */ }
  win.focus();
  win.print();
}
