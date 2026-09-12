/**
 * Static guard for migration 100 (confirming a VO re-checks its evidence).
 *
 * Like the 088/092/095/096/097/099 suites this touches no database: migrations
 * are pasted into the Supabase Dashboard by hand, so the SQL text IS the
 * artifact under test. Guards read CODE, the file with every full-line comment
 * removed, so the header or the self-check footer can never satisfy a guard the
 * SQL itself fails.
 *
 *  • 097's confirm_site_event accepted a VO on the strength of the STORED
 *    ai_draft alone. The edge function checked the quotes against the
 *    transcript when it wrote them, and the form checks again (staleVoQuotes),
 *    but a direct RPC call, an older build or a future client is bound by
 *    neither. 100 moves the check inside the function, where it cannot be
 *    skipped. Every assertion below is that check or a piece of it.
 *  • The rule is the validator's own rule: a quote that no longer matches is
 *    DROPPED, and only a VO with nothing left standing is refused. So the
 *    survivors - not the stored list - reach the change_type keywords and the
 *    Catatan Perubahan row.
 *  • site_event_norm_quote() must fold exactly what normalizeForQuoteMatch()
 *    folds. That parity is checked by DERIVING the TypeScript side's code
 *    points (running it over every BMP code point) and comparing them with the
 *    character classes read out of the SQL text. Neither list is copied by
 *    hand, so the day one side gains a fold the other does not, this fails.
 *  • Everything else in confirm_site_event is 097's text verbatim: the suite
 *    peels the added lines off 100's body and asserts what remains is byte-for-
 *    byte 097's. A "tidy-up" that changes a refusal, the UPDATE list or the
 *    notification wrapper while re-creating the function is caught there.
 *  • The six parity fixtures in the footer are the six pairs asserted here, and
 *    the SQL literals are decoded and compared with the TypeScript strings, so
 *    the human's paste-and-check cannot drift from what CI proved.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DRAFT_QUOTE_MIN_CHARS,
  isLiteralQuote,
  normalizeForQuoteMatch,
} from '../siteEventDraftValidate';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '100_confirm_vo_evidence_recheck.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const read = (file: string): string => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');

const SQL = read(FILE);
const CODE = stripComments(SQL); // comments can never satisfy a guard
const CODE_097 = stripComments(read('097_site_events.sql'));

const CONFIRM_SIG =
  'confirm_site_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT)';
const HELPER_SIG = 'site_event_norm_quote(TEXT)';

/** A named function's text, from CREATE through the body terminator. */
function fnText(code: string, name: string, where: string): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\n\\$\\$;`);
  const m = code.match(re);
  if (!m) throw new Error(`${name} not found in ${where}`);
  return m[0];
}
const confirm = (): string => fnText(CODE, 'confirm_site_event', FILE);
const helper = (): string => fnText(CODE, 'site_event_norm_quote', FILE);
/** The p_vo_confirm branch only, so a guard cannot be satisfied elsewhere. */
const voBranch = (): string => {
  const b = confirm();
  const from = b.indexOf('IF p_vo_confirm THEN');
  const to = b.indexOf('v_vo_flag := CASE');
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return b.slice(from, to);
};
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('migration 100 - header states why, paste order and re-paste safety', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-10-room-site-events-design\.md/);
    expect(SQL).toMatch(/2026-09-10-site-event-capture-ai\.md/);
  });

  it('records whose decision this was, and when', () => {
    expect(SQL).toMatch(/Decision: the user's, 2026-09-12/);
  });

  it('names its place in the paste order, after 097, 098 and 099', () => {
    expect(SQL).toMatch(/PASTE ORDER/);
    expect(SQL).toMatch(/AFTER 097, 098 and 099/);
  });

  it('says why the rule is "at least one quote" and not "all quotes"', () => {
    expect(SQL).toMatch(/AT LEAST ONE.*NOT "ALL"|"AT LEAST ONE" AND NOT "ALL"/);
    expect(SQL).toMatch(/survivors/i);
  });

  it('says out loud that a re-paste of 097 silently reverts it', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/Re-pasting 097 after this file REVERTS the re-check/);
    expect(SQL).toMatch(/migration100\.test\.ts/);
  });

  it('promises no new error code, because the client maps on the CODE prefix', () => {
    expect(SQL).toMatch(/100 introduces no new SITE_EVENT_\* code\./);
  });

  it('carries a self-check a human can run after pasting', () => {
    expect(SQL).toMatch(/SELF-CHECK \(run after pasting/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(8);
  });
});

describe('migration 100 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('ends on a grid that shows the outcome without reading a notice', () => {
    expect(CODE.trimEnd()).toMatch(
      /SELECT proname, prosecdef, provolatile, has_function_privilege\('anon', oid, 'EXECUTE'\) AS anon_exec\s+FROM pg_proc\s+WHERE proname IN \('confirm_site_event', 'site_event_norm_quote'\)\s+ORDER BY proname;$/,
    );
  });
});

describe('migration 100 - a second paste cannot fail', () => {
  it('defines exactly the two functions it means to define', () => {
    const created = [...CODE.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map((m) => m[1]);
    expect(created).toEqual(['site_event_norm_quote', 'confirm_site_event']);
    expect(CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? []).toHaveLength(2);
  });

  it('drops confirm_site_event by full signature before re-creating it', () => {
    // CREATE OR REPLACE cannot change a parameter list, so the day the
    // signature moves the old overload would survive carrying the GRANT -
    // callable, and one rule short. 097 and 092 do the same.
    const drop = CODE.indexOf('DROP FUNCTION IF EXISTS confirm_site_event(');
    const create = CODE.indexOf('CREATE OR REPLACE FUNCTION confirm_site_event(');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
    expect(norm(CODE.slice(drop, create))).toContain(
      'DROP FUNCTION IF EXISTS confirm_site_event( UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT );',
    );
    expect(CODE.match(/\bDROP\s+FUNCTION\b/gi) ?? []).toHaveLength(1);
  });

  it('runs no DDL on any table, view, policy, trigger, index or type', () => {
    expect(CODE).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|VIEW|POLICY|TRIGGER|INDEX|TYPE)\b/i);
  });
});

describe('migration 100 - who may execute what', () => {
  it('revokes confirm_site_event from PUBLIC and anon, then grants it as 097 did', () => {
    const revoke = CODE.indexOf(`REVOKE ALL ON FUNCTION ${CONFIRM_SIG} FROM PUBLIC, anon;`);
    const grant = CODE.indexOf(`GRANT EXECUTE ON FUNCTION ${CONFIRM_SIG} TO authenticated, service_role;`);
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    // A DROP takes the function's privileges with it, so both must come AFTER
    // the CREATE, or the function ends up ungranted and the app cannot confirm.
    expect(CODE.indexOf('CREATE OR REPLACE FUNCTION confirm_site_event(')).toBeLessThan(revoke);
  });

  it('leaves the helper callable only by its owner - no grant at all', () => {
    // confirm_site_event is SECURITY DEFINER, so it runs as this function's
    // owner and needs no grant. A GRANT to authenticated would hand a client a
    // function it has no reason to call.
    expect(CODE).toContain(`REVOKE ALL ON FUNCTION ${HELPER_SIG} FROM PUBLIC, anon, authenticated;`);
    expect(CODE).not.toMatch(/GRANT[^\n]*site_event_norm_quote/i);
  });

  it('keeps confirm_site_event SECURITY DEFINER with search_path pinned', () => {
    expect(confirm()).toMatch(/LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public\nAS \$\$/);
  });

  it('locks the row before reading anything from it, as 097 does', () => {
    expect(confirm()).toMatch(/SELECT \* INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;/);
  });
});

describe('migration 100 - site_event_norm_quote is a pure text function', () => {
  it('is IMMUTABLE, SECURITY INVOKER, SQL, with search_path pinned', () => {
    const h = helper();
    expect(h).toMatch(/RETURNS TEXT\nLANGUAGE sql\nIMMUTABLE\nSECURITY INVOKER\nSET search_path = public\nAS \$\$/);
    expect(h).not.toMatch(/\bVOLATILE\b|\bSTABLE\b/);
    expect(h).not.toMatch(/SECURITY DEFINER/);
  });

  it('reads no table and takes exactly one text argument', () => {
    expect(helper()).toMatch(/CREATE OR REPLACE FUNCTION site_event_norm_quote\(p_text TEXT\)/);
    expect(helper()).not.toMatch(/\bFROM\s+\w/);
  });

  it('never returns NULL, so a NULL transcript cannot skip the comparison', () => {
    expect(helper()).toMatch(/normalize\(COALESCE\(p_text, ''\), NFC\)/);
  });

  it('nests the steps in the TypeScript order: NFC, folds, lower, collapse, trim', () => {
    const h = norm(helper());
    expect(h).toContain("btrim( regexp_replace( lower( regexp_replace(");
    expect(h).toContain("regexp_replace( normalize(COALESCE(p_text, ''), NFC),");
    // The collapse wraps lower(...) and btrim wraps the collapse, so the
    // case fold happens before the whitespace run is measured and the trim is
    // the last thing that happens.
    expect(h).toMatch(/regexp_replace\( lower\([\s\S]*'\[[^']*\]\+', ' ', 'g' \), ' ' \); \$\$;$/);
    expect((helper().match(/\blower\(/g) ?? [])).toHaveLength(1);
    expect((helper().match(/\bbtrim\(/g) ?? [])).toHaveLength(1);
    expect((helper().match(/\bnormalize\(/g) ?? [])).toHaveLength(1);
  });

  it('writes its classes in plain strings, so the escapes stay readable text', () => {
    // In an E'' string the parser turns \u200B into the character itself and
    // the file would carry an invisible byte no static test could read.
    expect(helper()).not.toMatch(/E'\[/);
    expect(helper()).not.toMatch(/[\u200B-\u200D\u00AD\u2060\u200E\u200F\u2018\u2019\u02BC\u201C\u201D\u2010-\u2015\u00A0\uFEFF]/);
  });
});

// ─── The parity that matters: the SQL folds exactly what the TS folds ────────

type Fold = 'strip' | 'space' | 'apos' | 'dquote' | 'dash' | 'none';

/**
 * What normalizeForQuoteMatch DOES to one code point, derived by running it.
 * Sentinels on both sides keep a stripped character apart from a trimmed one.
 */
function tsFold(cp: number): Fold {
  const out = normalizeForQuoteMatch(`a${String.fromCodePoint(cp)}b`);
  if (out === 'ab') return 'strip';
  if (out === 'a b') return 'space';
  if (out === "a'b") return 'apos';
  if (out === 'a"b') return 'dquote';
  if (out === 'a-b') return 'dash';
  return 'none';
}

/** The ASCII characters the folds map TO: they are results, not inputs. */
const FOLD_TARGETS: Record<Fold, number | null> = {
  apos: 0x27, dquote: 0x22, dash: 0x2d, strip: null, space: null, none: null,
};

function tsFoldSet(kind: Fold): Set<number> {
  const out = new Set<number>();
  for (let cp = 0; cp <= 0xffff; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogates
    if (cp === FOLD_TARGETS[kind]) continue;
    if (tsFold(cp) === kind) out.add(cp);
  }
  return out;
}

/** Expands a bracket class of \uXXXX escapes, refusing anything else in it. */
function classCodePoints(cls: string): Set<number> {
  expect(cls.startsWith('[')).toBe(true);
  expect(cls.endsWith(']')).toBe(true);
  const inner = cls.slice(1, -1);
  const tokens = inner.match(/\\u[0-9A-Fa-f]{4}(?:-\\u[0-9A-Fa-f]{4})?/g) ?? [];
  // Full consumption: a stray \s, a literal character or a negation would
  // otherwise widen the class past what the comparison below can see.
  expect(tokens.join('')).toBe(inner);
  const out = new Set<number>();
  for (const token of tokens) {
    const [from, to] = token.split('-').map((t) => parseInt(t.slice(2), 16));
    for (let cp = from; cp <= (to ?? from); cp += 1) out.add(cp);
  }
  return out;
}

/** The (class, replacement) pairs of the helper's regexp_replace calls, in file order. */
function helperClasses(): Array<{ cls: string; to: string }> {
  return [...helper().matchAll(/'(\[[^']*\]\+?)',\s*('(?:[^']|'')*'),\s*'g'/g)].map((m) => ({
    cls: m[1],
    to: m[2],
  }));
}

describe('migration 100 - the SQL normaliser folds exactly what the TS one folds', () => {
  const sorted = (s: Set<number>): string[] =>
    [...s].sort((a, b) => a - b).map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);

  it('performs exactly five character-class replacements, in the TS order', () => {
    const pairs = helperClasses();
    expect(pairs.map((p) => p.to)).toEqual(["''", "''''", "'\"'", "'-'", "' '"]);
  });

  it.each([
    ['strip', 0, 'strip' as Fold],
    ['apostrophes', 1, 'apos' as Fold],
    ['double quotes', 2, 'dquote' as Fold],
    ['dashes', 3, 'dash' as Fold],
  ])('folds the same code points as the TS regex for %s', (_label, index, kind) => {
    const pairs = helperClasses();
    expect(sorted(classCodePoints(pairs[index].cls))).toEqual(sorted(tsFoldSet(kind)));
  });

  it("collapses exactly JavaScript's \\s, spelled out rather than left to Postgres's locale", () => {
    // Postgres's \s is [[:space:]], which is locale-dependent: it has included
    // U+180E, which JavaScript's \s does not, and excludes U+00A0 and U+FEFF,
    // which JavaScript's \s includes. Either disagreement lets one side see a
    // word boundary the other does not.
    const pairs = helperClasses();
    const space = pairs[4];
    expect(space.cls.endsWith('+')).toBe(true);
    expect(sorted(classCodePoints(space.cls.slice(0, -1)))).toEqual(sorted(tsFoldSet('space')));
    expect(helper()).not.toMatch(/'\\s/);
  });

  it('folds nothing above the BMP on either side, so 4-hex escapes are enough', () => {
    for (const { cls } of helperClasses()) expect(cls).not.toMatch(/\\U|\\\+[0-9A-Fa-f]{6}/);
    for (const cp of [0x1d400, 0x1f600, 0xe0020]) expect(tsFold(cp)).toBe('none');
  });
});

describe('migration 100 - the six parity fixtures the footer asks a human to paste', () => {
  /** [TypeScript a, TypeScript b, the SQL literal for a, the SQL literal for b] */
  const FIXTURES: ReadonlyArray<readonly [string, string, string, string]> = [
    [
      'Pak owner bilang \u2018pindah\u2019 sekarang',
      "Pak owner bilang 'pindah' sekarang",
      "E'Pak owner bilang \\u2018pindah\\u2019 sekarang'",
      "'Pak owner bilang ''pindah'' sekarang'",
    ],
    [
      'pla\u200Bfon belum ditutup',
      'plafon belum ditutup',
      "E'pla\\u200Bfon belum ditutup'",
      "'plafon belum ditutup'",
    ],
    ['balok 2\u2013B dicor', 'balok 2-B dicor', "E'balok 2\\u2013B dicor'", "'balok 2-B dicor'"],
    ['OWNER Minta Dipindah', 'owner minta dipindah', "'OWNER Minta Dipindah'", "'owner minta dipindah'"],
    [
      'owner  minta\u00A0\tdipindah ',
      'owner minta dipindah',
      "E'owner  minta\\u00A0\\tdipindah '",
      "'owner minta dipindah'",
    ],
    ['peke\u0301rjaan ulang', 'pek\u00E9rjaan ulang', "E'peke\\u0301rjaan ulang'", "E'pek\\u00E9rjaan ulang'"],
  ];

  function decodeSqlLiteral(lit: string): string {
    const escaped = lit.startsWith("E'");
    let out = (escaped ? lit.slice(2, -1) : lit.slice(1, -1)).replace(/''/g, "'");
    if (escaped) {
      out = out
        .replace(/\\u([0-9A-Fa-f]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\t/g, '\t')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r');
    }
    return out;
  }

  it('has six of them, and the footer names them as the parity fixtures', () => {
    expect(FIXTURES).toHaveLength(6);
    expect(SQL).toMatch(/THE SIX PARITY FIXTURES/);
  });

  it.each(FIXTURES.map((f, i) => [i + 1, ...f] as const))(
    'fixture %i: the TS normaliser treats the pair as the same quote',
    (_n, a, b) => {
      expect(isLiteralQuote(a, [b])).toBe(true);
      expect(isLiteralQuote(b, [a])).toBe(true);
      expect(normalizeForQuoteMatch(a)).toBe(normalizeForQuoteMatch(b));
    },
  );

  it.each(FIXTURES.map((f, i) => [i + 1, ...f] as const))(
    'fixture %i: the SQL literals in the footer decode to exactly those strings',
    (_n, a, b, sqlA, sqlB) => {
      expect(SQL).toContain(`site_event_norm_quote(${sqlA})`);
      expect(SQL).toContain(`site_event_norm_quote(${sqlB})`);
      expect(decodeSqlLiteral(sqlA)).toBe(a);
      expect(decodeSqlLiteral(sqlB)).toBe(b);
    },
  );
});

// ─── The re-check itself ─────────────────────────────────────────────────────

describe('migration 100 - the VO evidence re-check', () => {
  it('keeps 097 first line of defence: flag, array type, then length', () => {
    const vo = voBranch();
    expect(vo).toMatch(
      /IF COALESCE\(v_ev\.ai_draft -> 'vo' ->> 'flag', 'none'\) <> 'suggested'\s+OR v_quotes IS NULL\s+OR jsonb_typeof\(v_quotes\) <> 'array' THEN\s+RAISE EXCEPTION 'SITE_EVENT_VO_NO_EVIDENCE:/,
    );
    expect(vo).toMatch(/IF jsonb_array_length\(v_quotes\) = 0 THEN\s+RAISE EXCEPTION 'SITE_EVENT_VO_NO_EVIDENCE:/);
    expect(vo.indexOf('jsonb_typeof(v_quotes)')).toBeLessThan(vo.indexOf('jsonb_array_length(v_quotes)'));
  });

  it('normalises BOTH sides through the one helper - haystacks and needle', () => {
    const vo = voBranch();
    expect(vo).toMatch(/v_hay_text := site_event_norm_quote\(COALESCE\(v_excerpt, ''\)\);/);
    expect(vo).toMatch(/v_hay_note := site_event_norm_quote\(COALESCE\(v_ev\.raw_text, ''\)\);/);
    expect(vo).toMatch(/site_event_norm_quote\(e\.quote\) AS needle/);
    // Exactly three calls: two haystacks and the needle. A fourth would mean a
    // second, differently-normalised comparison somewhere.
    expect(confirm().match(/site_event_norm_quote\(/g) ?? []).toHaveLength(3);
  });

  it('re-checks against the transcript this confirm is about to PERSIST', () => {
    // Not p_transcript_edited raw: a whitespace-only argument is NOT stored
    // (transcript_edited = COALESCE(v_edited, transcript_edited)), so checking
    // the parameter would refuse quotes that are still in the saved text.
    const vo = voBranch();
    expect(vo).toMatch(/v_excerpt := COALESCE\(v_edited, v_ev\.transcript_edited, v_ev\.transcript\);/);
    expect(confirm().match(/v_excerpt := /g) ?? []).toHaveLength(1);
    expect(vo.indexOf('v_excerpt :=')).toBeLessThan(vo.indexOf('v_hay_text :='));
    expect(vo).not.toMatch(/site_event_norm_quote\(COALESCE\(p_transcript_edited/);
    // The typed note is a SECOND haystack, never concatenated onto the first:
    // isLiteralQuote asks sources.some(), so a joined string would accept a
    // quote straddling the join that the validator and the form both reject.
    expect(vo).toMatch(/position\(k\.needle IN v_hay_text\) > 0 OR position\(k\.needle IN v_hay_note\) > 0/);
    expect(vo).not.toMatch(/v_ev\.raw_text[^\n]*\|\||\|\|[^\n]*v_ev\.raw_text/);
  });

  it('tests every quote, not just the first', () => {
    const vo = voBranch();
    expect(vo).toMatch(
      /FROM jsonb_array_elements_text\(v_quotes\) WITH ORDINALITY AS e\(quote, ord\)/,
    );
    expect(vo).not.toMatch(/v_quotes\s*->>?\s*\d/);
  });

  it('matches by substring position, with no LIKE pattern to escape', () => {
    const vo = voBranch();
    expect(vo).toMatch(/position\(k\.needle IN v_hay_text\)/);
    expect(vo).not.toMatch(/\bI?LIKE\b|\bSIMILAR TO\b|~~/);
  });

  it('applies the same minimum quote length the TS validator applies', () => {
    // isLiteralQuote refuses a needle shorter than DRAFT_QUOTE_MIN_CHARS on the
    // NORMALISED text, which also makes an empty needle - position('' IN x) = 1,
    // i.e. "matches everything" - impossible here.
    expect(voBranch()).toContain(`WHERE char_length(k.needle) >= ${DRAFT_QUOTE_MIN_CHARS}`);
  });

  it('keeps the survivors and refuses only when none survive', () => {
    const vo = voBranch();
    expect(vo).toMatch(/SELECT COALESCE\(jsonb_agg\(k\.quote ORDER BY k\.ord\), '\[\]'::jsonb\)\s+INTO v_kept/);
    expect(vo).toMatch(
      /IF jsonb_array_length\(v_kept\) = 0 THEN\s+RAISE EXCEPTION 'SITE_EVENT_VO_NO_EVIDENCE: VO hanya bisa dikonfirmasi bila ada kutipan dasar \(kutipan tidak lagi ada di transkrip\)';\s+END IF;/,
    );
    expect(vo).toMatch(/v_quotes := v_kept;/);
  });

  it('re-uses the existing error code, so RPC_ERROR_COPY still maps it', () => {
    // tools/siteEvents.ts matches on the `CODE:` prefix; the extension rides
    // after the existing sentence. A new code would reach the supervisor as
    // "Gagal menyimpan: SITE_EVENT_..." - the raw SQL string.
    const codes = [...CODE.matchAll(/RAISE EXCEPTION '(SITE_EVENT_\w+):/g)].map((m) => m[1]);
    const codes097 = [...CODE_097.matchAll(/RAISE EXCEPTION '(SITE_EVENT_\w+):/g)].map((m) => m[1]);
    expect(new Set(codes).size).toBeGreaterThan(0);
    expect([...new Set(codes)].filter((c) => !codes097.includes(c))).toEqual([]);
  });

  it('lets only the survivors reach change_type, the excerpt and the row', () => {
    const vo = voBranch();
    const survivors = vo.indexOf('v_quotes := v_kept;');
    expect(survivors).toBeGreaterThan(-1);
    expect(survivors).toBeLessThan(vo.indexOf('INTO v_evidence'));
    expect(survivors).toBeLessThan(vo.indexOf('v_change_type := CASE'));
    expect(survivors).toBeLessThan(vo.indexOf('INSERT INTO site_changes'));
    // The aggregate still reads v_quotes, which is now the survivor list.
    expect(vo).toMatch(/INTO v_evidence\s+FROM jsonb_array_elements_text\(v_quotes\) AS q;/);
  });

  it('runs the re-check before anything is written', () => {
    const b = confirm();
    expect(b.indexOf('v_quotes := v_kept;')).toBeLessThan(b.indexOf('INSERT INTO site_changes'));
    expect(b.indexOf('v_quotes := v_kept;')).toBeLessThan(b.indexOf('UPDATE site_events SET'));
  });
});

describe('migration 100 - everything else is 097 verbatim', () => {
  it('re-creates confirm_site_event with 097 body plus exactly the re-check', () => {
    // Peel the added declarations and the added span off 100's body; what is
    // left must be 097's function character for character (whitespace
    // collapsed). This is the guard that catches a "while I am in here"
    // change to a refusal, the UPDATE list, or the notification wrapper.
    const ADDED_DECLS = ['v_kept JSONB;', 'v_hay_text TEXT;', 'v_hay_note TEXT;'];
    const EXCERPT = 'v_excerpt := COALESCE(v_edited, v_ev.transcript_edited, v_ev.transcript);';
    const SPAN_END = 'v_quotes := v_kept;';

    let peeled = norm(confirm());
    for (const decl of ADDED_DECLS) {
      expect(peeled).toContain(decl);
      peeled = norm(peeled.replace(decl, ''));
    }
    const from = peeled.indexOf(EXCERPT);
    const to = peeled.indexOf(SPAN_END);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    peeled = norm(`${peeled.slice(0, from)} ${peeled.slice(to + SPAN_END.length)}`);

    // 097 assigns v_excerpt lower down, just above the INSERT; 100 moved that
    // one statement up so the re-check and the row's quoted excerpt read one
    // expression. Remove it from 097's side too and compare the rest.
    const original = norm(fnText(CODE_097, 'confirm_site_event', '097').replace(EXCERPT, ''));
    expect(peeled).toBe(original);
  });

  it('carries 097 refusals, in 097 order', () => {
    const codes = [...confirm().matchAll(/RAISE EXCEPTION '(SITE_EVENT_\w+):/g)].map((m) => m[1]);
    const original = [...fnText(CODE_097, 'confirm_site_event', '097').matchAll(/RAISE EXCEPTION '(SITE_EVENT_\w+):/g)]
      .map((m) => m[1]);
    // One extra SITE_EVENT_VO_NO_EVIDENCE, in the VO branch, and nothing else.
    expect(codes.filter((c) => c !== 'SITE_EVENT_VO_NO_EVIDENCE')).toEqual(
      original.filter((c) => c !== 'SITE_EVENT_VO_NO_EVIDENCE'),
    );
    expect(codes.filter((c) => c === 'SITE_EVENT_VO_NO_EVIDENCE')).toHaveLength(
      original.filter((c) => c === 'SITE_EVENT_VO_NO_EVIDENCE').length + 1,
    );
  });

  it('returns the same six keys 097 returned', () => {
    expect(confirm()).toMatch(
      /RETURN jsonb_build_object\(\s*'event_id', p_event_id,\s*'status', 'open',\s*'vo_flag', v_vo_flag,\s*'site_change_id', v_change_id,\s*'ai_used', v_ai_used,\s*'notified', v_notified\s*\);/,
    );
  });
});

describe('migration 100 - nothing later reverts it', () => {
  it('no migration above 100 redefines confirm_site_event or the helper', () => {
    const later = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 100);
    const touching = later.filter((f) =>
      /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+)FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(?:confirm_site_event|site_event_norm_quote)\b/i.test(
        stripComments(read(f)),
      ),
    );
    expect(touching).toEqual([]);
  });

  it('names the signatures this suite pins, so a changed one is a deliberate edit', () => {
    expect(CODE).toContain(CONFIRM_SIG);
    expect(CODE).toContain(HELPER_SIG.replace('(TEXT)', '(p_text TEXT)'));
  });
});
