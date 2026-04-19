import { tokenize } from '../formulaEval/tokenize';

describe('tokenize', () => {
  it('strips leading =', () => {
    expect(tokenize('=A1').map(t => t.kind)).toEqual(['ref']);
  });

  it('handles cell ref with absolute markers', () => {
    const t = tokenize('=$A$1');
    expect(t).toEqual([{ kind: 'ref', value: '$A$1' }]);
  });

  it('handles cross-sheet ref with quoted sheet name', () => {
    const t = tokenize("='REKAP RAB'!$O$4");
    expect(t).toEqual([{ kind: 'ref', value: "'REKAP RAB'!$O$4" }]);
  });

  it('handles cross-sheet ref without quotes', () => {
    const t = tokenize('=Analisa!$F$82');
    expect(t).toEqual([{ kind: 'ref', value: 'Analisa!$F$82' }]);
  });

  it('handles operators + - * / and parens', () => {
    const kinds = tokenize('=(A1+B1)*C1').map(t => t.kind);
    expect(kinds).toEqual(['lparen','ref','op','ref','rparen','op','ref']);
  });

  it('handles numeric literals including decimals', () => {
    const t = tokenize('=1.5*A1');
    expect(t).toEqual([{ kind: 'num', value: '1.5' }, { kind: 'op', value: '*' }, { kind: 'ref', value: 'A1' }]);
  });

  it('handles function calls with args', () => {
    const kinds = tokenize('=SUM(A1,B1)').map(t => t.kind);
    expect(kinds).toEqual(['fn','lparen','ref','comma','ref','rparen']);
  });

  it('handles range reference inside SUM', () => {
    const t = tokenize('=SUM(F13:F18)');
    expect(t.map(x => x.value)).toEqual(['SUM','(','F13:F18',')']);
  });
});
