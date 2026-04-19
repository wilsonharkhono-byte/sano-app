import * as fs from 'fs';
import * as path from 'path';

describe('PARSER_AI_GUIDE.md', () => {
  const guidePath = path.join(__dirname, '..', '..', '..', 'docs', 'PARSER_AI_GUIDE.md');
  const content = fs.readFileSync(guidePath, 'utf8');

  it('contains all six required sections', () => {
    expect(content).toMatch(/##\s+A\.\s+Schema reference/i);
    expect(content).toMatch(/##\s+B\.\s+Known formula patterns/i);
    expect(content).toMatch(/##\s+C\.\s+Data gotchas/i);
    expect(content).toMatch(/##\s+D\.\s+Decision rules/i);
    expect(content).toMatch(/##\s+E\.\s+Output JSON schemas/i);
    expect(content).toMatch(/##\s+F\.\s+Anti-patterns/i);
  });

  it('mentions the canonical column layout', () => {
    expect(content).toMatch(/URAIAN/);
    expect(content).toMatch(/HARGA SATUAN/);
    expect(content).toMatch(/Material.*Upah.*Peralatan/s);
  });

  it('documents the AF composite pattern', () => {
    expect(content).toMatch(/R\s*\+\s*V\s*\*\s*W\s*\+\s*Z\s*\*\s*AA/);
  });

  it('has output JSON schema examples', () => {
    expect(content).toMatch(/```json/);
    expect(content).toMatch(/confidence/);
  });
});
