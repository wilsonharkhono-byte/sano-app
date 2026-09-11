// SANO - A4 QR label sheet.
//
// 3 × 3 labels per A4 page. Each label carries the QR, the room name, the
// floor, the project code, the room code as text and the full URL in small
// print - spec §8: "so a human can type it when a camera fails".
//
// The print path is the same popup + window.print() route the client report
// already uses (tools/clientReportHtml.ts:462-496); Expo web has no native
// print API and this one is proven in production here.
//
// DEPENDENCY DEVIATION. Spec §8 named react-native-qrcode-svg. That renders a
// react-native-svg component, which cannot be serialized into an HTML string
// without a renderer round-trip. `qrcode` returns the <svg> markup directly,
// which is what this sheet needs. Amend spec §8's dependency list accordingly.
//
// IMPORT SHAPE. `qrcode` is imported statically at module top even though it
// is only ever called from the web-only exportRoomLabelSheet below. This repo's
// metro.config.js uses expo/metro-config's default resolver.resolverMainFields
// = ['react-native', 'browser', 'main'] (verified 2026-09-11), applied to every
// platform - not just 'web'. qrcode's package.json has no "react-native" field
// but does have a "browser" field mapping "./lib/index.js" to "./lib/browser.js",
// so Metro resolves the Android/iOS bundle to browser.js too, never to the
// Node-only index.js that touches `fs`. browser.js has no top-level DOM or Node
// access - `document.createElement('canvas')` lives inside getCanvasElement(),
// which only toCanvas/toDataURL call; this file only ever calls
// QRCode.toString(...). So the static import is safe to bundle into the Android
// APK: it adds bytes, not behavior, on native.

import { Platform } from 'react-native';
import QRCode from 'qrcode';
import { buildRoomUrl } from './roomLinks';
import { markRoomsPrinted } from './rooms';
import type { Project, Room } from './types';

/** 3 columns × 3 rows. Changing this changes the page-break arithmetic below. */
export const LABELS_PER_PAGE = 9;

export interface RoomLabelSheetInput {
  projectName: string;
  projectCode: string;
  rooms: Room[];
  /** room.id → the <svg> markup for that room's QR. */
  qrSvgByRoomId: Record<string, string>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SHEET_CSS = `
@page { size: A4; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #141210; }
.page { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
        gap: 4mm; width: 194mm; height: 281mm; page-break-after: always; }
.page:last-child { page-break-after: auto; }
.label { border: 1px dashed #B5AFA8; border-radius: 3mm; padding: 4mm;
         display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
         text-align: center; overflow: hidden; }
.label .qr { width: 32mm; height: 32mm; margin-bottom: 2mm; }
.label .qr svg { width: 100%; height: 100%; }
.label .name { font-size: 11pt; font-weight: 700; line-height: 1.15; margin-top: 2mm; }
.label .floor { font-size: 9pt; color: #524E49; margin-top: 1mm; }
.label .code { font-size: 9pt; font-weight: 600; letter-spacing: .04em; margin-top: 2mm; }
.label .proj { font-size: 7pt; color: #847E78; letter-spacing: .08em; text-transform: uppercase; margin-top: 1mm; }
.label .url { font-size: 6pt; color: #847E78; margin-top: auto; word-break: break-all; line-height: 1.2; }
@media screen { body { background: #D2D0C4; padding: 8mm; } .page { background: #FDFAF6; margin: 0 auto 8mm; padding: 4mm; } }
`;

export function renderRoomLabelSheetHtml(input: RoomLabelSheetInput): string {
  const { projectName, projectCode, rooms, qrSvgByRoomId } = input;

  const pages: string[] = [];
  for (let i = 0; i < rooms.length; i += LABELS_PER_PAGE) {
    const labels = rooms.slice(i, i + LABELS_PER_PAGE).map((r) => {
      const svg = qrSvgByRoomId[r.id];
      if (svg === undefined) {
        // A blank tile ships a label with no QR and no signal that anything is
        // wrong (CLAUDE.md §12: refuse a number/output rather than fake one).
        throw new Error(`renderRoomLabelSheetHtml: missing QR svg for room ${r.id}`);
      }
      const url = buildRoomUrl(projectCode, r.room_code);
      return `
      <div class="label">
        <div class="qr">${svg}</div>
        <div class="name">${esc(r.room_name)}</div>
        <div class="floor">${esc(r.floor || '—')}</div>
        <div class="code">${esc(r.room_code)}</div>
        <div class="proj">${esc(projectCode)}</div>
        <div class="url">${esc(url)}</div>
      </div>`;
    }).join('');
    pages.push(`<div class="page">${labels}</div>`);
  }

  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>Label Ruangan - ${esc(projectName)}</title>
<style>${SHEET_CSS}</style>
</head><body>${pages.join('')}</body></html>`;
}

/**
 * Generate the QR codes, open the print popup, call print(), then ASK before
 * stamping qr_printed_at. print() returning is not proof the labels physically
 * left the system - it returns just as promptly if the user hits Cancel in the
 * print dialog - so the stamp (which freezes room_code per 096) waits on an
 * explicit confirmation in the main window instead of trusting print()'s return.
 */
export async function exportRoomLabelSheet(
  project: Pick<Project, 'id' | 'code' | 'name'>,
  rooms: Room[],
): Promise<void> {
  if (Platform.OS !== 'web') {
    throw new Error('Cetak label QR hanya tersedia di versi web. Buka SANO di browser kantor.');
  }
  if (rooms.length === 0) throw new Error('Tidak ada ruangan yang dipilih untuk dicetak.');

  const qrSvgByRoomId: Record<string, string> = {};
  for (const r of rooms) {
    qrSvgByRoomId[r.id] = await QRCode.toString(buildRoomUrl(project.code, r.room_code), {
      type: 'svg',
      errorCorrectionLevel: 'M', // survives a smudge on a site wall
      margin: 1, // one module of built-in quiet zone, so a scanner isn't confused by the label border
    });
  }

  const html = renderRoomLabelSheetHtml({
    projectName: project.name,
    projectCode: project.code,
    rooms,
    qrSvgByRoomId,
  });

  const win = window.open('', '_blank');
  if (!win) throw new Error('Popup diblokir. Izinkan popup untuk mencetak label.');
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Fidelity safeguard: wait for fonts before printing, same as the client
  // report (tools/clientReportHtml.ts:472-476).
  try {
    // @ts-ignore - document.fonts exists in browsers
    if (win.document.fonts?.ready) await win.document.fonts.ready;
  } catch { /* ignore font API gaps */ }
  win.focus();
  win.print();

  // print() returning is NOT proof the labels came out - it returns just as
  // promptly on Cancel. Ask in the main window before freezing room_code.
  if (!window.confirm('Label sudah selesai dicetak? Tekan OK bila sudah, Batal bila belum.')) return;

  const { error } = await markRoomsPrinted(rooms.map((r) => r.id));
  if (error) {
    throw new Error(`Label tercetak, tetapi penandaan "sudah dicetak" gagal: ${error}. Kode ruangan belum terkunci - coba cetak ulang.`);
  }
}
