// Pratt-style precedence parser over tokenize() output. Produces a minimal
// AST the evaluator can walk symbolically.

import type { Token } from './tokenize';

export type AstNode =
  | { kind: 'ref'; value: string }
  | { kind: 'num'; value: number }
  | { kind: 'binop'; op: '+' | '-' | '*' | '/'; left: AstNode; right: AstNode }
  | { kind: 'unary'; op: '-'; operand: AstNode }
  | { kind: 'fn'; name: string; args: AstNode[] };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

export function parse(tokens: Token[]): AstNode {
  const state = { i: 0, tokens };
  const node = parseExpression(state, 0);
  if (state.i !== tokens.length) {
    throw new Error(`parse: unexpected token at position ${state.i}: ${tokens[state.i]?.value}`);
  }
  return node;
}

type State = { i: number; tokens: Token[] };

function peek(s: State): Token | undefined {
  return s.tokens[s.i];
}

function consume(s: State): Token {
  const t = s.tokens[s.i];
  if (!t) throw new Error('parse: unexpected end of input');
  s.i++;
  return t;
}

function parseExpression(s: State, minPrec: number): AstNode {
  let left = parsePrimary(s);
  while (true) {
    const t = peek(s);
    if (!t || t.kind !== 'op') break;
    const prec = PRECEDENCE[t.value];
    if (prec === undefined || prec < minPrec) break;
    consume(s);
    const right = parseExpression(s, prec + 1);
    left = { kind: 'binop', op: t.value as '+' | '-' | '*' | '/', left, right };
  }
  return left;
}

function parsePrimary(s: State): AstNode {
  const t = peek(s);
  if (!t) throw new Error('parse: unexpected end of input');

  if (t.kind === 'op' && t.value === '-') {
    consume(s);
    const operand = parsePrimary(s);
    return { kind: 'unary', op: '-', operand };
  }

  if (t.kind === 'num') { consume(s); return { kind: 'num', value: Number(t.value) }; }
  if (t.kind === 'ref') { consume(s); return { kind: 'ref', value: t.value }; }

  if (t.kind === 'lparen') {
    consume(s);
    const node = parseExpression(s, 0);
    const close = consume(s);
    if (close.kind !== 'rparen') throw new Error('parse: expected closing paren');
    return node;
  }

  if (t.kind === 'fn') {
    consume(s);
    const open = consume(s);
    if (open.kind !== 'lparen') throw new Error('parse: expected ( after function name');
    const args: AstNode[] = [];
    if (peek(s)?.kind !== 'rparen') {
      args.push(parseExpression(s, 0));
      while (peek(s)?.kind === 'comma') {
        consume(s);
        args.push(parseExpression(s, 0));
      }
    }
    const close = consume(s);
    if (close.kind !== 'rparen') throw new Error('parse: expected ) to close function call');
    return { kind: 'fn', name: t.value, args };
  }

  throw new Error(`parse: unexpected token "${t.value}"`);
}
