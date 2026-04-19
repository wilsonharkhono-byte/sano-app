import * as fs from 'fs';
import * as path from 'path';

let cached: string | null = null;

export function loadParserGuide(): string {
  if (cached != null) return cached;
  const guidePath = path.join(__dirname, '..', '..', '..', 'docs', 'PARSER_AI_GUIDE.md');
  cached = fs.readFileSync(guidePath, 'utf8');
  return cached;
}

export function __resetGuideCache(): void { cached = null; }
