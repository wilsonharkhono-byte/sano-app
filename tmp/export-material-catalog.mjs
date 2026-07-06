import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import ExcelJS from 'exceljs';

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// Pull the full catalog (paginate to beat the 1000-row default cap)
async function fetchAll(table, columns, orderBy) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

const catalog = await fetchAll(
  'material_catalog',
  'id, code, name, category, tier, unit, supplier_unit, base_qty_per_supplier_unit, created_at',
  'name'
);
const aliases = await fetchAll('material_aliases', 'material_id, alias', 'material_id');

// Group aliases by material
const aliasByMaterial = new Map();
for (const a of aliases) {
  if (!aliasByMaterial.has(a.material_id)) aliasByMaterial.set(a.material_id, []);
  aliasByMaterial.get(a.material_id).push(a.alias);
}

const workbook = new ExcelJS.Workbook();
const ws = workbook.addWorksheet('Material Catalog');
ws.columns = [
  { header: 'Code', key: 'code', width: 14 },
  { header: 'Name', key: 'name', width: 40 },
  { header: 'Category', key: 'category', width: 20 },
  { header: 'Tier', key: 'tier', width: 6 },
  { header: 'Unit', key: 'unit', width: 10 },
  { header: 'Supplier Unit', key: 'supplier_unit', width: 14 },
  { header: 'Base Qty per Supplier Unit', key: 'base_qty_per_supplier_unit', width: 22 },
  { header: 'Aliases', key: 'aliases', width: 50 },
];
ws.getRow(1).font = { bold: true };
ws.views = [{ state: 'frozen', ySplit: 1 }];

for (const m of catalog) {
  ws.addRow({
    code: m.code ?? '',
    name: m.name,
    category: m.category ?? '',
    tier: m.tier,
    unit: m.unit,
    supplier_unit: m.supplier_unit ?? '',
    base_qty_per_supplier_unit: m.base_qty_per_supplier_unit ?? '',
    aliases: (aliasByMaterial.get(m.id) ?? []).join(', '),
  });
}

const outPath = './assets/BOQ/Material Catalog.xlsx';
await workbook.xlsx.writeFile(outPath);
console.log(`Wrote ${catalog.length} materials to ${outPath}`);
