/**
 * Backward-compatible wrapper for the material catalog sync.
 *
 * Prefer:
 *   node tools/syncMaterialCatalog.mjs
 *   node tools/syncMaterialCatalog.mjs --watch
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const scriptPath = path.join(__dirname, 'syncMaterialCatalog.mjs');
const result = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
