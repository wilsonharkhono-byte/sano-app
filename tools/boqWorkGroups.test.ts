import { classifyBoqWorkGroup, buildWorkGroups } from './boqWorkGroups';
import type { BoqItem } from './types';

let idc = 0;
function item(label: string, chapter: string | null = null, overrides: Partial<BoqItem> = {}): BoqItem {
  idc += 1;
  return {
    id: `boq_${idc}`,
    project_id: 'p1',
    code: overrides.code ?? `C.${idc}`,
    label,
    unit: 'm3',
    tier1_material: null,
    tier2_material: null,
    progress: 0,
    planned: 1,
    installed: 0,
    parent_code: null,
    chapter,
    sub_chapter: null,
    sort_order: overrides.sort_order ?? idc,
    element_code: null,
    composite_factors: null,
    cost_breakdown: null,
    client_unit_price: null,
    internal_unit_price: null,
    superseded_at: null,
    ...overrides,
  };
}

describe('classifyBoqWorkGroup', () => {
  it('merges Poer and Sloof into one Struktur Pondasi group', () => {
    const poer = classifyBoqWorkGroup(item('Poer PC.1', 'PEKERJAAN STRUKTUR'));
    const sloof = classifyBoqWorkGroup(item('Sloof S1', 'PEKERJAAN STRUKTUR'));
    const pilecap = classifyBoqWorkGroup(item('Pile cap PC.3', 'PEKERJAAN STRUKTUR'));
    expect(poer.label).toBe('Struktur Pondasi');
    expect(sloof.label).toBe('Struktur Pondasi');
    expect(pilecap.label).toBe('Struktur Pondasi');
    expect(poer.key).toBe(sloof.key);
  });

  it('separates Kolom from Balok & Plat, suffixed by floor', () => {
    const kol = classifyBoqWorkGroup(item('Kolom K1 Lantai 1', 'PEKERJAAN STRUKTUR'));
    const bp = classifyBoqWorkGroup(item('Balok B24 Lantai 1', 'PEKERJAAN STRUKTUR'));
    expect(kol.label).toBe('Kolom Lantai 1');
    expect(bp.label).toBe('Balok & Plat Lantai 1');
    expect(kol.key).not.toBe(bp.key);
  });

  it('splits the same element type across floors', () => {
    const k1 = classifyBoqWorkGroup(item('Kolom K1 Lantai 1'));
    const k2 = classifyBoqWorkGroup(item('Kolom K1 Lantai 2'));
    expect(k1.label).toBe('Kolom Lantai 1');
    expect(k2.label).toBe('Kolom Lantai 2');
    expect(k1.key).not.toBe(k2.key);
  });

  it('routes masonry mentioning "kolom praktis" to Pasangan Dinding, not Kolom', () => {
    const c = classifyBoqWorkGroup(item(
      'Pasangan dinding bata merah tebal 20 cm; termasuk kolom praktis, balok praktis, dan balok latei',
      'PEKERJAAN PASANGAN DINDING',
    ));
    expect(c.label).toMatch(/^Pasangan Dinding/);
  });

  it('routes plaster of columns to Plesteran & Acian, not Kolom', () => {
    const c = classifyBoqWorkGroup(item('Plesteran kolom dan dinding beton', 'PEKERJAAN PASANGAN DINDING BATA MERAH'));
    expect(c.label).toMatch(/^Plesteran & Acian/);
  });

  it('keeps a floorless group when no floor is present in the source', () => {
    const c = classifyBoqWorkGroup(item('Kolom K4-1', 'PEKERJAAN STRUKTUR'));
    expect(c.label).toBe('Kolom');
    expect(c.floor).toBeNull();
  });

  it('honors umbrella chapters (Pekerjaan Persiapan) over label keywords', () => {
    const c = classifyBoqWorkGroup(item('Bowplank / pengukuran', 'PEKERJAAN PERSIAPAN'));
    expect(c.label).toBe('Pekerjaan Persiapan');
  });

  it('classifies component-level rows via sub_chapter (element only in sub-chapter)', () => {
    const beton = classifyBoqWorkGroup({ label: '- Beton', chapter: 'PEKERJAAN FISIK LANTAI 1', sub_chapter: '- Poer PC.1' });
    const besi = classifyBoqWorkGroup({ label: '- Besi D13', chapter: 'PEKERJAAN FISIK LANTAI 1', sub_chapter: '- Poer PC.1' });
    expect(beton.label).toBe('Struktur Pondasi');
    expect(besi.label).toBe('Struktur Pondasi');
    expect(beton.key).toBe(besi.key);
  });

  it('falls back to the chapter name, else Lainnya, for unmatched rows', () => {
    const withChapter = classifyBoqWorkGroup(item('Pekerjaan anti rayap', 'PEKERJAAN ANTI RAYAP'));
    expect(withChapter.label).toBe('PEKERJAAN ANTI RAYAP');
    const noChapter = classifyBoqWorkGroup(item('Sesuatu yang aneh', null));
    expect(noChapter.label).toBe('Lainnya');
  });
});

describe('buildWorkGroups', () => {
  const items = [
    item('Poer PC.1', 'PEKERJAAN STRUKTUR', { sort_order: 10 }),
    item('Sloof S1', 'PEKERJAAN STRUKTUR', { sort_order: 11 }),
    item('Kolom K1 Lantai 1', 'PEKERJAAN STRUKTUR', { sort_order: 20 }),
    item('Kolom K2 Lantai 1', 'PEKERJAAN STRUKTUR', { sort_order: 21 }),
    item('Balok B1 Lantai 1', 'PEKERJAAN STRUKTUR', { sort_order: 22 }),
    item('Pasangan dinding bata merah; termasuk kolom praktis', 'PEKERJAAN DINDING', { sort_order: 40 }),
  ];

  it('partitions every item into exactly one group (no loss, no duplication)', () => {
    const groups = buildWorkGroups(items);
    const total = groups.reduce((s, g) => s + g.itemIds.length, 0);
    expect(total).toBe(items.length);
    const allIds = groups.flatMap(g => g.itemIds);
    expect(new Set(allIds).size).toBe(items.length);
  });

  it('groups Poer+Sloof together and Kolom items together', () => {
    const groups = buildWorkGroups(items);
    const pondasi = groups.find(g => g.label === 'Struktur Pondasi');
    const kolom = groups.find(g => g.label === 'Kolom Lantai 1');
    expect(pondasi?.itemCount).toBe(2);
    expect(kolom?.itemCount).toBe(2);
  });

  it('orders groups by their minimum member sort_order', () => {
    const groups = buildWorkGroups(items);
    const orders = groups.map(g => g.sortOrder);
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b));
    expect(groups[0].label).toBe('Struktur Pondasi');
  });

  it('is deterministic', () => {
    const a = JSON.stringify(buildWorkGroups(items));
    const b = JSON.stringify(buildWorkGroups(items));
    expect(a).toBe(b);
  });
});
