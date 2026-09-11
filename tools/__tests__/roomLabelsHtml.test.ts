/**
 * The renderer is pure so the sheet can be asserted without a browser. The
 * things that actually go wrong on a printed sheet are: a room missing, a page
 * break in the wrong place, and a room name with a stray character breaking the
 * markup. All three are covered.
 */
// roomLabelsHtml imports ./rooms for markRoomsPrinted, which imports
// ./supabase - see the note in task 5.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { renderRoomLabelSheetHtml, LABELS_PER_PAGE } from '../roomLabelsHtml';
import type { Room } from '../types';

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
});
