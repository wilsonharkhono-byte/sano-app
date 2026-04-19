import { tokenize } from '../formulaEval/tokenize';
import { parse } from '../formulaEval/parse';

describe('parse', () => {
  it('parses a bare cell ref', () => {
    const ast = parse(tokenize('=A1'));
    expect(ast).toEqual({ kind: 'ref', value: 'A1' });
  });

  it('respects precedence: * before +', () => {
    const ast = parse(tokenize('=A1+B1*C1'));
    expect(ast.kind).toBe('binop');
    if (ast.kind !== 'binop') throw new Error();
    expect(ast.op).toBe('+');
    expect(ast.left).toEqual({ kind: 'ref', value: 'A1' });
    expect(ast.right.kind).toBe('binop');
  });

  it('respects parentheses', () => {
    const ast = parse(tokenize('=(A1+B1)*C1'));
    expect(ast.kind).toBe('binop');
    if (ast.kind !== 'binop') throw new Error();
    expect(ast.op).toBe('*');
    expect(ast.left.kind).toBe('binop');
  });

  it('parses function call with args', () => {
    const ast = parse(tokenize('=SUM(A1,B1)'));
    expect(ast).toEqual({
      kind: 'fn',
      name: 'SUM',
      args: [ { kind: 'ref', value: 'A1' }, { kind: 'ref', value: 'B1' } ],
    });
  });

  it('parses unary minus', () => {
    const ast = parse(tokenize('=-A1'));
    expect(ast).toEqual({ kind: 'unary', op: '-', operand: { kind: 'ref', value: 'A1' } });
  });
});
