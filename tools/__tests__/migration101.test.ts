/**
 * Static guard for migration 101 (gate labels + descriptions).
 *
 * Like the 088/092/095/096/099 suites this touches no database: migrations
 * are pasted into the Supabase Dashboard, so the SQL text IS the artifact
 * under test.
 *
 *  • Exactly eight UPDATE statements, one per code A-H, and each touches only
 *    name_id, short_label and description - never code (096's
 *    gate_refs_immutable_code trigger would refuse it anyway), sort_order,
 *    active or datum_gate_code.
 *  • No INSERT and no DELETE anywhere in the file: 096 already seeded the
 *    eight rows, and gate_refs has no delete policy.
 *  • No write to gate_step_refs at all - DATUM shares the A-H codes and the
 *    step table is untouched by this rename.
 *  • lock_timeout brackets every statement, matching 096-100.
 *  • Each new name matches the office's requested copy, verbatim.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '101_gate_labels_descriptions.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const CODE = stripComments(SQL); // comments can never satisfy a guard

const NEW_NAMES: Record<string, string> = {
  A: 'MEP rough-in + persiapan sipil',
  B: 'Waterproofing + kamar mandi',
  C: 'Plafon + benangan',
  D: 'Lantai + kusen',
  E: 'Cat + ironwork',
  F: 'Built-in & interior',
  G: 'MEP fit-out',
  H: 'Cleaning + dekoratif',
};

describe('migration 101 - header states why, paste order and re-paste safety', () => {
  it('names its place in the paste order, after 100', () => {
    expect(SQL).toMatch(/PASTE ORDER/);
    expect(SQL).toMatch(/After 100/);
  });

  it('says out loud that it must be re-paste safe', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
  });

  it('carries a self-check a human can run after pasting', () => {
    expect(SQL).toMatch(/SELF-CHECK \(run after pasting/);
    expect(SQL.match(/EXPECTED/g) ?? []).not.toHaveLength(0);
  });
});

describe('migration 101 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('ends its DML on a grid that shows the outcome', () => {
    expect(CODE).toMatch(/SELECT code, short_label, description FROM gate_refs ORDER BY sort_order;/);
  });
});

describe('migration 101 - exactly eight UPDATEs, one per code, touching only three columns', () => {
  const updateBlocks = [...CODE.matchAll(/UPDATE gate_refs SET\s+([\s\S]*?)WHERE code = '([A-Z])';/g)];

  it('has exactly eight UPDATE gate_refs statements', () => {
    expect(updateBlocks).toHaveLength(8);
  });

  it('covers each of A-H exactly once', () => {
    const codes = updateBlocks.map((m) => m[2]).sort();
    expect(codes).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('runs no INSERT or DELETE anywhere in the file', () => {
    expect(CODE).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(CODE).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('never writes gate_step_refs', () => {
    expect(CODE).not.toMatch(/UPDATE\s+gate_step_refs/i);
    expect(CODE).not.toMatch(/INTO\s+gate_step_refs/i);
  });

  it.each(updateBlocks.map((m) => [m[2], m[1]] as const))(
    'gate %s: SET clause touches only name_id, short_label and description',
    (_code, setClause) => {
      const fields = [...setClause.matchAll(/^\s*([a-z_]+)\s*=/gm)].map((m) => m[1]);
      expect(fields).toEqual(['name_id', 'short_label', 'description']);
    },
  );

  it('never sets code, sort_order, active, datum_gate_code or created_at', () => {
    for (const [, setClause] of updateBlocks) {
      expect(setClause).not.toMatch(/\bcode\s*=/);
      expect(setClause).not.toMatch(/\bsort_order\s*=/);
      expect(setClause).not.toMatch(/\bactive\s*=/);
      expect(setClause).not.toMatch(/\bdatum_gate_code\s*=/);
      expect(setClause).not.toMatch(/\bcreated_at\s*=/);
    }
  });

  it.each(Object.entries(NEW_NAMES))('gate %s: name_id and short_label both become the requested name', (code, name) => {
    const block = updateBlocks.find((m) => m[2] === code)?.[1] ?? '';
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(block).toMatch(new RegExp(`name_id\\s*=\\s*'${escaped}'`));
    expect(block).toMatch(new RegExp(`short_label\\s*=\\s*'${escaped}'`));
  });

  it('every gate gets a non-empty description', () => {
    for (const [, setClause] of updateBlocks) {
      expect(setClause).toMatch(/description\s*=\s*'[^']+'/);
    }
  });
});

describe('migration 101 - nothing later reverts it', () => {
  it('no later migration writes gate_refs.short_label/name_id/description', () => {
    const later = fs.readdirSync(MIGRATIONS)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 101);
    const touching = later.filter((f) =>
      /UPDATE\s+gate_refs\s+SET[\s\S]*?(name_id|short_label|description)/i
        .test(stripComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))),
    );
    expect(touching).toEqual([]);
  });
});
