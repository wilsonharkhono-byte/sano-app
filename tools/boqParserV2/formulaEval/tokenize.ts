// Tokenizer for the subset of Excel formula syntax used by Indonesian RAB
// workbooks. Supports cell refs (optional sheet prefix, absolute markers),
// numeric literals, the four arithmetic operators, parentheses, commas,
// ranges (A1:B2), and function calls like SUM/SUMIFS/VLOOKUP.

export type TokenKind =
  | 'ref' | 'num' | 'op' | 'lparen' | 'rparen' | 'comma' | 'fn' | 'colon';

export interface Token {
  kind: TokenKind;
  value: string;
}

const FN_NAME_RE = /^[A-Z][A-Z0-9]*/;
const CELL_ADDR_RE = /^\$?[A-Z]+\$?\d+/;
const NUM_RE = /^\d+(?:\.\d+)?/;
const SHEET_QUOTED_RE = /^'([^']+)'!/;
const SHEET_BARE_RE = /^([A-Za-z_][A-Za-z0-9_\- .]*)!/;

export function tokenize(input: string): Token[] {
  let s = input.trim();
  if (s.startsWith('=')) s = s.slice(1).trim();
  const out: Token[] = [];

  while (s.length > 0) {
    if (/^\s/.test(s)) { s = s.trimStart(); continue; }

    let m = s.match(SHEET_QUOTED_RE);
    if (m) {
      const prefix = m[0];
      const rest = s.slice(prefix.length);
      const rangeMatch = rest.match(/^(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/);
      if (rangeMatch) {
        out.push({ kind: 'ref', value: prefix + rangeMatch[0] });
        s = rest.slice(rangeMatch[0].length);
        continue;
      }
    }

    m = s.match(SHEET_BARE_RE);
    if (m) {
      const prefix = m[0];
      const rest = s.slice(prefix.length);
      const rangeMatch = rest.match(/^(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/);
      if (rangeMatch) {
        out.push({ kind: 'ref', value: prefix + rangeMatch[0] });
        s = rest.slice(rangeMatch[0].length);
        continue;
      }
    }

    m = s.match(FN_NAME_RE);
    if (m && s[m[0].length] === '(') {
      out.push({ kind: 'fn', value: m[0] });
      s = s.slice(m[0].length);
      continue;
    }

    m = s.match(CELL_ADDR_RE);
    if (m) {
      const first = m[0];
      const rest = s.slice(first.length);
      const rangeMatch = rest.match(/^:(\$?[A-Z]+\$?\d+)/);
      if (rangeMatch) {
        out.push({ kind: 'ref', value: first + rangeMatch[0] });
        s = rest.slice(rangeMatch[0].length);
      } else {
        out.push({ kind: 'ref', value: first });
        s = rest;
      }
      continue;
    }

    m = s.match(NUM_RE);
    if (m) {
      out.push({ kind: 'num', value: m[0] });
      s = s.slice(m[0].length);
      continue;
    }

    const c = s[0];
    if (c === '(') { out.push({ kind: 'lparen', value: c }); s = s.slice(1); continue; }
    if (c === ')') { out.push({ kind: 'rparen', value: c }); s = s.slice(1); continue; }
    if (c === ',') { out.push({ kind: 'comma', value: c }); s = s.slice(1); continue; }
    if ('+-*/'.includes(c)) { out.push({ kind: 'op', value: c }); s = s.slice(1); continue; }

    throw new Error(`tokenize: unexpected character "${c}" in formula "${input}"`);
  }

  return out;
}
