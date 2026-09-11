/**
 * The renderer is pure so the sheet can be asserted without a browser. The
 * things that actually go wrong on a printed sheet are: a room missing, a page
 * break in the wrong place, and a room name with a stray character breaking the
 * markup. All three are covered.
 */
// roomLabelsHtml imports ./rooms for markRoomsPrinted, which imports
// ./supabase - see the note in task 5.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

// exportRoomLabelSheet's own tests below replace ./rooms outright (no real
// Supabase round-trip) and stub qrcode and react-native's Platform, since
// exportRoomLabelSheet is the impure, browser-facing half of this module.
jest.mock('../rooms', () => ({ __esModule: true, markRoomsPrinted: jest.fn() }));
jest.mock('qrcode', () => ({ __esModule: true, default: { toString: jest.fn().mockResolvedValue('<svg/>') } }));
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { renderRoomLabelSheetHtml, LABELS_PER_PAGE, exportRoomLabelSheet } from '../roomLabelsHtml';
import { markRoomsPrinted } from '../rooms';
import QRCode from 'qrcode';
import { Platform } from 'react-native';
import type { Project, Room } from '../types';

const room = (i: number, over: Partial<Room> = {}): Room => ({
  id: `r${i}`, project_id: 'p1', room_code: `LT1-R${i}`, room_name: `Ruang ${i}`,
  floor: 'Lt. 1', area_sqm: null, area_type: 'general', sort_order: i,
  datum_area_id: null, qr_printed_at: null, active: true, created_by: null,
  created_at: '2026-09-10T00:00:00Z', ...over,
});

const svg = (id: string) => `<svg data-room="${id}"></svg>`;
const svgMap = (rooms: Room[]) => Object.fromEntries(rooms.map((r) => [r.id, svg(r.id)]));

const render = (rooms: Room[]) =>
  renderRoomLabelSheetHtml({
    projectName: 'Nusa Golf I4',
    projectCode: 'GA17',
    rooms,
    qrSvgByRoomId: svgMap(rooms),
  });

describe('renderRoomLabelSheetHtml', () => {
  it('emits one label per room, with its QR, name, floor, code and URL', () => {
    const rooms = [room(1), room(2)];
    const html = render(rooms);
    expect((html.match(/class="label"/g) ?? []).length).toBe(2);
    expect(html).toContain('data-room="r1"');
    expect(html).toContain('Ruang 1');
    expect(html).toContain('Lt. 1');
    expect(html).toContain('LT1-R1');
    expect(html).toContain('https://sano-app.vercel.app/r/GA17/LT1-R1');
  });

  it('prints the project code on every label so a stray sticker is traceable', () => {
    expect((render([room(1), room(2)]).match(/GA17/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('breaks a page every 9 labels', () => {
    expect(LABELS_PER_PAGE).toBe(9);
    const nine = render(Array.from({ length: 9 }, (_, i) => room(i)));
    const ten  = render(Array.from({ length: 10 }, (_, i) => room(i)));
    expect((nine.match(/class="page"/g) ?? []).length).toBe(1);
    expect((ten.match(/class="page"/g) ?? []).length).toBe(2);
  });

  it('carries A4 page geometry and a 3-column grid', () => {
    const html = render([room(1)]);
    expect(html).toMatch(/@page\s*\{[^}]*A4/);
    expect(html).toMatch(/grid-template-columns:\s*repeat\(3,/);
    expect(html).toMatch(/page-break-after:\s*always/);
  });

  it('gives the QR a bottom quiet-gap matching the top, in the print CSS', () => {
    expect(render([room(1)])).toMatch(/\.label \.qr\s*\{[^}]*margin-bottom:\s*2mm/);
  });

  it('escapes HTML in room and project names', () => {
    const html = renderRoomLabelSheetHtml({
      projectName: 'Nusa & <b>Golf</b>',
      projectCode: 'GA17',
      rooms: [room(1, { room_name: '<script>alert(1)</script>' })],
      qrSvgByRoomId: svgMap([room(1)]),
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Nusa &amp; &lt;b&gt;Golf&lt;/b&gt;');
  });

  it('does NOT escape the QR svg - it is markup we generated', () => {
    expect(render([room(1)])).toContain('<svg data-room="r1"></svg>');
  });

  it('renders an em-dash placeholder for a room with no floor', () => {
    expect(render([room(1, { floor: null })])).toContain('—');
  });

  it('handles an empty room list without emitting a page', () => {
    expect(render([])).not.toContain('class="page"');
  });

  it('throws, naming the room, rather than render a blank tile for a missing QR', () => {
    expect(() => renderRoomLabelSheetHtml({
      projectName: 'Nusa Golf I4',
      projectCode: 'GA17',
      rooms: [room(1), room(2)],
      qrSvgByRoomId: svgMap([room(1)]), // room 2's QR is missing
    })).toThrow(/r2/);
  });
});

describe('exportRoomLabelSheet', () => {
  const project: Pick<Project, 'id' | 'code' | 'name'> = { id: 'p1', code: 'GA17', name: 'Nusa Golf I4' };
  const rooms = [room(1), room(2)];

  let fakePopup: {
    document: { open: jest.Mock; write: jest.Mock; close: jest.Mock; fonts: { ready: Promise<void> } };
    focus: jest.Mock;
    print: jest.Mock;
  };
  // testEnvironment: node has no global.window, so it must be faked in and
  // torn back out per test rather than merely reset.
  const hadWindow = Object.prototype.hasOwnProperty.call(global, 'window');
  let originalWindow: unknown;

  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as any).OS = 'web';
    fakePopup = {
      document: {
        open: jest.fn(),
        write: jest.fn(),
        close: jest.fn(),
        fonts: { ready: Promise.resolve() },
      },
      focus: jest.fn(),
      print: jest.fn(),
    };
    originalWindow = (global as any).window;
    (global as any).window = {
      open: jest.fn(() => fakePopup),
      confirm: jest.fn(() => true),
    };
    (markRoomsPrinted as jest.Mock).mockResolvedValue({});
    (QRCode.toString as jest.Mock).mockResolvedValue('<svg/>');
  });

  afterEach(() => {
    if (hadWindow) {
      (global as any).window = originalWindow;
    } else {
      delete (global as any).window;
    }
  });

  it('rejects on native before touching window', async () => {
    (Platform as any).OS = 'android';
    await expect(exportRoomLabelSheet(project, rooms)).rejects.toThrow(
      'Cetak label QR hanya tersedia di versi web. Buka SANO di browser kantor.',
    );
    expect(global.window.open).not.toHaveBeenCalled();
    expect(markRoomsPrinted).not.toHaveBeenCalled();
  });

  it('rejects when there are no rooms selected', async () => {
    await expect(exportRoomLabelSheet(project, [])).rejects.toThrow(
      'Tidak ada ruangan yang dipilih untuk dicetak.',
    );
    expect(markRoomsPrinted).not.toHaveBeenCalled();
  });

  it('rejects when the popup is blocked, and never marks rooms printed', async () => {
    (global.window.open as jest.Mock).mockReturnValue(null);
    await expect(exportRoomLabelSheet(project, rooms)).rejects.toThrow(
      'Popup diblokir. Izinkan popup untuk mencetak label.',
    );
    expect(markRoomsPrinted).not.toHaveBeenCalled();
  });

  it('does not mark rooms printed, and does not throw, when the user says the labels are not printed yet', async () => {
    (global.window.confirm as jest.Mock).mockReturnValue(false);
    await expect(exportRoomLabelSheet(project, rooms)).resolves.toBeUndefined();
    expect(fakePopup.print).toHaveBeenCalled();
    expect(markRoomsPrinted).not.toHaveBeenCalled();
  });

  it('marks the printed rooms once the user confirms', async () => {
    (global.window.confirm as jest.Mock).mockReturnValue(true);
    await exportRoomLabelSheet(project, rooms);
    expect(markRoomsPrinted).toHaveBeenCalledWith(['r1', 'r2']);
  });

  it('throws a truthful error when printing succeeded but the stamp failed', async () => {
    (global.window.confirm as jest.Mock).mockReturnValue(true);
    (markRoomsPrinted as jest.Mock).mockResolvedValue({ error: 'RLS refused' });
    await expect(exportRoomLabelSheet(project, rooms)).rejects.toThrow(
      'Label tercetak, tetapi penandaan "sudah dicetak" gagal: RLS refused. Kode ruangan belum terkunci - coba cetak ulang.',
    );
  });
});
