/**
 * Sync material_master.csv and material_aliases.csv into Supabase material_catalog.
 *
 * Usage:
 *   node tools/syncMaterialCatalog.mjs
 *   node tools/syncMaterialCatalog.mjs --watch
 *   node tools/syncMaterialCatalog.mjs --prune
 *
 * Notes:
 * - Requires SUPABASE_SERVICE_KEY. The script will also read .env automatically.
 * - `--watch` keeps syncing while the process is running.
 * - `--prune` removes catalog rows that no longer exist in material_master.csv.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const materialPath = path.join(projectRoot, 'assets/mock/material_master.csv');
const aliasPath = path.join(projectRoot, 'assets/mock/material_aliases.csv');

const args = new Set(process.argv.slice(2));
const watchMode = args.has('--watch');
const pruneMode = args.has('--prune');
const helpMode = args.has('--help') || args.has('-h');

function printHelp() {
  console.log(`
Sync material master CSV into Supabase material_catalog.

Usage:
  node tools/syncMaterialCatalog.mjs
  node tools/syncMaterialCatalog.mjs --watch
  node tools/syncMaterialCatalog.mjs --prune

Flags:
  --watch   Keep watching CSV files and sync on every save
  --prune   Delete material_catalog rows whose codes are no longer in material_master.csv
  --help    Show this message
`);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes) {
        if (next === '"') {
          current += '"';
          index += 1;
          continue;
        }

        if (next === ',' || next === undefined) {
          inQuotes = false;
          continue;
        }

        // Tolerate malformed CSV that uses inch marks inside quoted content.
        current += '"';
        continue;
      }

      if (current.length === 0) {
        inQuotes = true;
        continue;
      }

      // Treat bare quotes inside an unquoted field as a literal character.
      current += '"';
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells.map(cell => cell.replace(/^\uFEFF/, ''));
}

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

function normalizeHeader(header) {
  return header
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function headerIndexMap(headerRow) {
  const map = new Map();
  headerRow.forEach((header, index) => {
    map.set(normalizeHeader(header), index);
  });
  return map;
}

function findHeaderIndex(map, candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeHeader(candidate);
    if (map.has(normalized)) return map.get(normalized);
  }
  return -1;
}

function requiredValue(row, index, label) {
  const value = index >= 0 ? (row[index] ?? '').trim() : '';
  if (!value) throw new Error(`Missing required value for ${label}`);
  return value;
}

function optionalValue(row, index) {
  if (index < 0) return '';
  return (row[index] ?? '').trim();
}

function parseTier(rawTier) {
  const tier = Number.parseInt(String(rawTier).trim(), 10);
  if (![1, 2, 3].includes(tier)) {
    throw new Error(`Invalid tier "${rawTier}"`);
  }
  return tier;
}

function readMaterialRows() {
  if (!fs.existsSync(materialPath)) {
    throw new Error(`Material master file not found: ${materialPath}`);
  }

  const [headerRow, ...rows] = parseCsv(materialPath);
  const map = headerIndexMap(headerRow);
  const codeIndex = findHeaderIndex(map, ['Kode Material', 'code']);
  const nameIndex = findHeaderIndex(map, ['Nama Material', 'name']);
  const categoryIndex = findHeaderIndex(map, ['Kategori', 'category']);
  const tierIndex = findHeaderIndex(map, ['Tier']);
  const unitIndex = findHeaderIndex(map, ['Satuan Unit', 'unit']);
  const supplierUnitIndex = findHeaderIndex(map, ['Supplier Unit', 'supplier_unit']);

  return rows.map((row, rowOffset) => {
    try {
      const code = requiredValue(row, codeIndex, 'Kode Material');
      const name = requiredValue(row, nameIndex, 'Nama Material');
      const category = optionalValue(row, categoryIndex) || null;
      const unit = requiredValue(row, unitIndex, 'Satuan Unit');
      const supplierUnit = optionalValue(row, supplierUnitIndex) || unit;
      return {
        code,
        name,
        category,
        tier: parseTier(requiredValue(row, tierIndex, 'Tier')),
        unit,
        supplier_unit: supplierUnit,
      };
    } catch (error) {
      throw new Error(`material_master.csv row ${rowOffset + 2}: ${error.message}`);
    }
  });
}

function readAliasRows() {
  if (!fs.existsSync(aliasPath)) {
    return [];
  }

  const [headerRow, ...rows] = parseCsv(aliasPath);
  const map = headerIndexMap(headerRow);
  const aliasIndex = findHeaderIndex(map, ['Alias']);
  const codeIndex = findHeaderIndex(map, ['Kode Material', 'code']);

  return rows.map((row, rowOffset) => {
    try {
      return {
        alias: requiredValue(row, aliasIndex, 'Alias'),
        code: requiredValue(row, codeIndex, 'Kode Material'),
      };
    } catch (error) {
      throw new Error(`material_aliases.csv row ${rowOffset + 2}: ${error.message}`);
    }
  });
}

function normalizeAliasKey(materialId, alias) {
  return `${materialId}::${alias.trim().toLowerCase()}`;
}

const LEGACY_CODE_OVERRIDES = new Map([
  ['betonreadymixk250', 'CON-RM25'],
  ['betonreadymixk300', 'CON-RM30'],
  ['bataringan600x200x75', 'AAC-BL07'],
  ['besitulangan16', 'REB-DE16'],
  ['bajah300', 'STL-HB300'],
  ['bendrat', 'KWD-BDR01'],
]);

function normalizeMatchKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function addLookupValue(map, key, value) {
  if (!key) return;
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }
  map.set(key, new Set([value]));
}

function buildMatchIndex(catalogRows, aliases, desiredCodes) {
  const codedRows = (catalogRows ?? []).filter(row => row.code && desiredCodes.has(row.code));
  const codeToRow = new Map(codedRows.map(row => [row.code, row]));
  const idToRow = new Map(codedRows.map(row => [row.id, row]));
  const lookup = new Map();

  for (const row of codedRows) {
    addLookupValue(lookup, normalizeMatchKey(row.name), row.id);
  }

  for (const alias of aliases) {
    const row = codeToRow.get(alias.code);
    if (!row) continue;
    addLookupValue(lookup, normalizeMatchKey(alias.alias), row.id);
  }

  return { codeToRow, idToRow, lookup };
}

function isCompatibleMatch(source, target) {
  if (Number(source.tier) !== Number(target.tier)) return false;

  const sourceUnit = normalizeMatchKey(source.unit);
  const targetUnit = normalizeMatchKey(target.unit);
  if (sourceUnit && targetUnit && sourceUnit !== targetUnit) return false;

  const sourceCategory = normalizeMatchKey(source.category);
  const targetCategory = normalizeMatchKey(target.category);
  if (sourceCategory && targetCategory && sourceCategory !== targetCategory) return false;

  return true;
}

function resolveLegacyMaterialRemaps(uncodedRows, matchIndex) {
  const remaps = [];
  const unresolved = [];

  for (const row of uncodedRows) {
    const matchKey = normalizeMatchKey(row.name);
    const overrideCode = LEGACY_CODE_OVERRIDES.get(matchKey);
    if (overrideCode) {
      const overrideTarget = matchIndex.codeToRow.get(overrideCode);
      if (overrideTarget) {
        remaps.push({
          fromId: row.id,
          fromName: row.name,
          toId: overrideTarget.id,
          toCode: overrideTarget.code,
          toName: overrideTarget.name,
        });
        continue;
      }
    }

    const candidateIds = Array.from(matchIndex.lookup.get(matchKey) ?? []);
    const compatibleCandidates = candidateIds
      .map(id => matchIndex.idToRow.get(id))
      .filter(Boolean)
      .filter(candidate => isCompatibleMatch(row, candidate));

    if (compatibleCandidates.length === 1) {
      const target = compatibleCandidates[0];
      remaps.push({
        fromId: row.id,
        fromName: row.name,
        toId: target.id,
        toCode: target.code,
        toName: target.name,
      });
      continue;
    }

    unresolved.push({
      ...row,
      reason: compatibleCandidates.length > 1 ? 'ambiguous_match' : 'no_match',
    });
  }

  return { remaps, unresolved };
}

async function updateMaterialReferenceTable(supabase, table, column, fromId, toId) {
  const { error } = await supabase.from(table).update({ [column]: toId }).eq(column, fromId);
  if (error) {
    throw new Error(`Failed to remap ${table}.${column} from ${fromId} to ${toId}: ${error.message}`);
  }
}

async function remapLegacyMaterials(supabase, remaps) {
  const referenceTargets = [
    { table: 'material_aliases', column: 'material_id' },
    { table: 'material_specs', column: 'material_id' },
    { table: 'ahs_lines', column: 'material_id' },
    { table: 'project_material_master_lines', column: 'material_id' },
    { table: 'price_history', column: 'material_id' },
    { table: 'purchase_order_lines', column: 'material_id' },
    { table: 'material_request_lines', column: 'material_id' },
    { table: 'mtn_requests', column: 'material_id' },
  ];

  for (const remap of remaps) {
    for (const target of referenceTargets) {
      await updateMaterialReferenceTable(
        supabase,
        target.table,
        target.column,
        remap.fromId,
        remap.toId,
      );
    }
  }
}

function debounce(fn, delayMs) {
  let timer = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn().catch(error => {
        console.error(`❌ Sync failed: ${error.message}`);
      });
    }, delayMs);
  };
}

async function createSupabaseClient() {
  loadEnvFile(path.join(projectRoot, '.env'));

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_KEY or SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL. ' +
      'Add SUPABASE_SERVICE_KEY to your .env before running the sync.',
    );
  }

  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

async function syncOnce() {
  const materials = readMaterialRows();
  const aliases = readAliasRows();
  const supabase = await createSupabaseClient();
  const desiredCodes = new Set(materials.map(material => material.code));

  console.log(`\n🔄 Syncing material catalog at ${new Date().toLocaleString('en-SG')}`);
  console.log(`   Materials: ${materials.length}`);
  console.log(`   Aliases:   ${aliases.length}`);

  const { data: existingMaterials, error: fetchMaterialsError } = await supabase
    .from('material_catalog')
    .select('id, code, name, category, tier, unit, supplier_unit');

  if (fetchMaterialsError) {
    throw new Error(`Failed to fetch existing materials: ${fetchMaterialsError.message}`);
  }

  const existingByCode = new Map(
    (existingMaterials ?? [])
      .filter(row => row.code)
      .map(row => [row.code, row]),
  );

  const toInsert = [];
  const toUpdate = [];
  let unchangedCount = 0;

  for (const material of materials) {
    const existing = existingByCode.get(material.code);
    if (!existing) {
      toInsert.push(material);
      continue;
    }

    const changed =
      existing.name !== material.name ||
      (existing.category ?? null) !== material.category ||
      Number(existing.tier) !== material.tier ||
      existing.unit !== material.unit ||
      (existing.supplier_unit ?? '') !== material.supplier_unit;

    if (changed) {
      toUpdate.push({ id: existing.id, ...material });
    } else {
      unchangedCount += 1;
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('material_catalog').insert(toInsert);
    if (error) throw new Error(`Failed to insert materials: ${error.message}`);
  }

  for (const material of toUpdate) {
    const { id, ...payload } = material;
    const { error } = await supabase.from('material_catalog').update(payload).eq('id', id);
    if (error) throw new Error(`Failed to update material ${payload.code}: ${error.message}`);
  }

  let prunedCount = 0;
  if (pruneMode) {
    const extraIds = (existingMaterials ?? [])
      .filter(row => row.code && String(row.code).trim() && !desiredCodes.has(row.code))
      .map(row => row.id);

    if (extraIds.length > 0) {
      const { error } = await supabase.from('material_catalog').delete().in('id', extraIds);
      if (error) throw new Error(`Failed to prune materials: ${error.message}`);
      prunedCount = extraIds.length;
    }
  }

  const { data: catalogRows, error: refetchError } = await supabase
    .from('material_catalog')
    .select('id, code, name, category, tier, unit, supplier_unit');

  if (refetchError) {
    throw new Error(`Failed to refetch materials: ${refetchError.message}`);
  }

  const uncodedRows = (catalogRows ?? []).filter(row => !row.code || !String(row.code).trim());
  const matchIndex = buildMatchIndex(catalogRows ?? [], aliases, desiredCodes);
  const { remaps, unresolved } = resolveLegacyMaterialRemaps(uncodedRows, matchIndex);

  if (remaps.length > 0) {
    await remapLegacyMaterials(supabase, remaps);
  }

  let removedUncodedCount = 0;
  const blockedDeletions = [];
  for (const row of uncodedRows) {
    const { error } = await supabase.from('material_catalog').delete().eq('id', row.id);
    if (error) {
      blockedDeletions.push({
        id: row.id,
        name: row.name,
        reason: error.message,
      });
      continue;
    }
    removedUncodedCount += 1;
  }

  const codeToId = new Map(
    (catalogRows ?? [])
      .filter(row => row.code && desiredCodes.has(row.code))
      .map(row => [row.code, row.id]),
  );

  const { data: existingAliases, error: fetchAliasesError } = await supabase
    .from('material_aliases')
    .select('id, material_id, alias');

  if (fetchAliasesError) {
    throw new Error(`Failed to fetch aliases: ${fetchAliasesError.message}`);
  }

  const existingAliasKeys = new Set(
    (existingAliases ?? []).map(row => normalizeAliasKey(row.material_id, row.alias)),
  );

  const aliasInserts = [];
  let skippedAliases = 0;
  for (const alias of aliases) {
    const materialId = codeToId.get(alias.code);
    if (!materialId) {
      skippedAliases += 1;
      console.warn(`⚠️  Alias "${alias.alias}" skipped: material code "${alias.code}" not found in catalog`);
      continue;
    }

    const aliasKey = normalizeAliasKey(materialId, alias.alias);
    if (existingAliasKeys.has(aliasKey)) continue;

    existingAliasKeys.add(aliasKey);
    aliasInserts.push({
      material_id: materialId,
      alias: alias.alias,
    });
  }

  if (aliasInserts.length > 0) {
    const { error } = await supabase.from('material_aliases').insert(aliasInserts);
    if (error) throw new Error(`Failed to insert aliases: ${error.message}`);
  }

  console.log('✅ Material catalog sync complete');
  console.log(`   Inserted materials: ${toInsert.length}`);
  console.log(`   Updated materials:  ${toUpdate.length}`);
  console.log(`   Unchanged:          ${unchangedCount}`);
  console.log(`   Remapped legacy:    ${remaps.length}`);
  console.log(`   Removed uncoded:    ${removedUncodedCount}`);
  if (pruneMode) console.log(`   Pruned materials:   ${prunedCount}`);
  console.log(`   New aliases:        ${aliasInserts.length}`);
  console.log(`   Skipped aliases:    ${skippedAliases}`);
  if (unresolved.length > 0) {
    console.warn(`   Unresolved uncoded: ${unresolved.length}`);
    for (const row of unresolved.slice(0, 10)) {
      console.warn(`      - ${row.name} [${row.reason}]`);
    }
    if (unresolved.length > 10) {
      console.warn(`      ...and ${unresolved.length - 10} more`);
    }
  }
  if (blockedDeletions.length > 0) {
    console.warn(`   Blocked deletions:  ${blockedDeletions.length}`);
    for (const row of blockedDeletions.slice(0, 10)) {
      console.warn(`      - ${row.name}: ${row.reason}`);
    }
    if (blockedDeletions.length > 10) {
      console.warn(`      ...and ${blockedDeletions.length - 10} more`);
    }
  }
}

async function main() {
  if (helpMode) {
    printHelp();
    return;
  }

  await syncOnce();

  if (!watchMode) return;

  console.log('\n👀 Watching material_master.csv and material_aliases.csv for changes...');
  const rerun = debounce(syncOnce, 400);

  const watchFiles = [materialPath, aliasPath].filter(filePath => fs.existsSync(filePath));
  for (const filePath of watchFiles) {
    fs.watch(filePath, { persistent: true }, eventType => {
      if (eventType === 'rename' || eventType === 'change') {
        rerun();
      }
    });
  }
}

main().catch(error => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
