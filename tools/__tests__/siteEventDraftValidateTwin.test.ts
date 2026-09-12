/**
 * tools/siteEventDraftValidate.ts is the source of truth. The edge function
 * carries a byte-identical copy because Deno cannot import from tools/ and
 * jest never runs supabase/functions/ (package.json testPathIgnorePatterns).
 * CI runs only tsc and jest (.github/workflows/ci.yml), so without this suite
 * the Deno copy could drift and production would validate AI drafts with rules
 * no test covers.
 *
 * Fix a failure with:
 *   cp tools/siteEventDraftValidate.ts supabase/functions/site-event-analyze/validate.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { AI_QUOTA_MESSAGE } from '../siteEventRules';

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'tools', 'siteEventDraftValidate.ts'), 'utf8');
const FUNCTION_DIR = path.join(ROOT, 'supabase', 'functions', 'site-event-analyze');
const readCopy = () => fs.readFileSync(path.join(FUNCTION_DIR, 'validate.ts'), 'utf8');

/** Set aside import and re-export lines, the only lines a runtime could ever force apart. */
function stripHeader(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*import\s/.test(line) && !/^\s*export\s+(type\s+)?\{[^}]*\}\s+from\s/.test(line))
    .join('\n');
}

function exportedFunctionNames(src: string): string[] {
  return [...src.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]).sort();
}

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`${name} missing`);
  const next = src.indexOf('\nexport ', start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}

describe('site-event-analyze/validate.ts is the validator, byte for byte', () => {
  it('has no imports in either file, so the same bytes run in Node and Deno', () => {
    expect(SOURCE).not.toMatch(/^\s*import\s/m);
    expect(readCopy()).not.toMatch(/^\s*import\s/m);
  });

  it('uses no Deno or React Native API', () => {
    for (const src of [SOURCE, readCopy()]) {
      expect(src).not.toMatch(/\bDeno\./);
      expect(src).not.toMatch(/react-native/);
    }
  });

  it('exports the same functions', () => {
    expect(exportedFunctionNames(SOURCE)).toEqual(['isLiteralQuote', 'normalizeForQuoteMatch', 'validateSiteEventDraft']);
    expect(exportedFunctionNames(readCopy())).toEqual(exportedFunctionNames(SOURCE));
  });

  it('has identical exported function bodies', () => {
    const copy = readCopy();
    for (const name of exportedFunctionNames(SOURCE)) {
      expect(functionBody(copy, name)).toBe(functionBody(SOURCE, name));
    }
  });

  it('is identical once import and re-export lines are set aside', () => {
    expect(stripHeader(readCopy())).toBe(stripHeader(SOURCE));
  });
});

/** Every quoted string inside one array literal, in source order. */
function quotedStrings(block: string): string[] {
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function knownKeys(src: string): string[] {
  const match = src.match(/const KNOWN_KEYS: ReadonlyArray<string> = \[([\s\S]*?)\];/);
  if (!match) throw new Error('KNOWN_KEYS not found in the validator');
  return quotedStrings(match[1]);
}

/** The draft tool's top-level `required` list, read as text like the rest of this suite. */
function draftToolRequired(promptSrc: string): string[] {
  const lists = [...promptSrc.matchAll(/required:\s*\[([\s\S]*?)\]/g)].map((m) => quotedStrings(m[1]));
  const top = lists.find((keys) => keys.includes('event_type'));
  if (!top) throw new Error('draft tool required list not found in prompt.ts');
  return top;
}

describe('the tool schema asks for exactly what the validator accepts', () => {
  it('requires every key in KNOWN_KEYS, and requires nothing the validator would drop', () => {
    const prompt = fs.readFileSync(path.join(FUNCTION_DIR, 'prompt.ts'), 'utf8');
    const required = draftToolRequired(prompt);
    const known = knownKeys(SOURCE);
    // Missing from `required` and the model may omit a field the confirm screen
    // needs; present in `required` but unknown to the validator and it is asked
    // for, generated, then silently dropped as an unknown key.
    expect(required.slice().sort()).toEqual(known.slice().sort());
  });
});

describe('messages the app matches on', () => {
  it('uses the same daily-quota message in the edge function and in siteEventRules', () => {
    const util = fs.readFileSync(path.join(FUNCTION_DIR, 'util.ts'), 'utf8');
    expect(util).toMatch(/export const AI_QUOTA_MESSAGE =/);
    expect(util).toContain(`'${AI_QUOTA_MESSAGE}'`);
  });
});
