import {
  normalizePhone,
  extractProjectCode,
  resolveProject,
  routeByConfidence,
  parseClaudeJson,
  buildClarificationMessage,
  buildConfirmationMessage,
  CandidateProject,
} from './parse';

const projects: CandidateProject[] = [
  { id: 'p-ga7', code: 'GA7', name: 'Rumah Citraland', client_name: 'Pak Andi' },
  { id: 'p-as3', code: 'AS3', name: 'Villa Alam Sutera', client_name: 'Bu Sinta' },
  { id: 'p-ga17', code: 'GA17', name: 'Ruko Graha', client_name: 'Pak Budi' },
];
const knownCodes = projects.map(p => p.code);
const knownById = new Map(projects.map(p => [p.id, p]));

describe('normalizePhone', () => {
  it('normalizes 08xx to 62xx', () => {
    expect(normalizePhone('081234567890')).toBe('6281234567890');
  });
  it('keeps 62xx', () => {
    expect(normalizePhone('+62 812-3456-7890')).toBe('6281234567890');
  });
  it('handles bare 8xx', () => {
    expect(normalizePhone('81234567890')).toBe('6281234567890');
  });
  it('empty -> empty', () => {
    expect(normalizePhone('')).toBe('');
  });
});

describe('extractProjectCode', () => {
  it('finds explicit leading code', () => {
    expect(extractProjectCode('GA7 keramik kamar mandi sudah dipilih', knownCodes)).toBe('GA7');
  });
  it('is case-insensitive but returns canonical casing', () => {
    expect(extractProjectCode('ga7 cat dinding', knownCodes)).toBe('GA7');
  });
  it('longest match wins (GA17 not GA1/GA7)', () => {
    expect(extractProjectCode('GA17 plafon gypsum', knownCodes)).toBe('GA17');
  });
  it('does not match substring inside a word', () => {
    expect(extractProjectCode('MEGA7TON beton', knownCodes)).toBeNull();
  });
  it('returns null when no code present', () => {
    expect(extractProjectCode('keramik sudah dipasang bos', knownCodes)).toBeNull();
  });
});

describe('resolveProject', () => {
  it('tier 1: explicit code resolves regardless of assignments', () => {
    const r = resolveProject({
      text: 'AS3 tile master bath approved',
      knownCodes, knownById, senderActiveProjects: [],
    });
    expect(r.status).toBe('resolved');
    expect(r.projectId).toBe('p-as3');
    expect(r.needsConfirm).toBe(false);
  });

  it('tier 1: unknown code rejects', () => {
    const r = resolveProject({
      text: 'ZZ9 sesuatu',
      knownCodes, knownById, senderActiveProjects: projects,
    });
    expect(r.status).toBe('reject');
  });

  it('tier 2: single active project defaults with confirm', () => {
    const r = resolveProject({
      text: 'keramik kamar mandi sudah dipilih',
      knownCodes, knownById, senderActiveProjects: [projects[0]],
    });
    expect(r.status).toBe('resolved');
    expect(r.projectId).toBe('p-ga7');
    expect(r.needsConfirm).toBe(true);
  });

  it('tier 2: multiple active projects -> ambiguous', () => {
    const r = resolveProject({
      text: 'cat dinding sudah',
      knownCodes, knownById, senderActiveProjects: [projects[0], projects[1]],
    });
    expect(r.status).toBe('ambiguous');
    expect(r.candidates).toHaveLength(2);
  });

  it('tier 3: no code + no assignments -> reject', () => {
    const r = resolveProject({
      text: 'halo',
      knownCodes, knownById, senderActiveProjects: [],
    });
    expect(r.status).toBe('reject');
  });
});

describe('routeByConfidence', () => {
  it('high above 0.85', () => expect(routeByConfidence(0.9)).toBe('high'));
  it('medium in [0.5, 0.85]', () => {
    expect(routeByConfidence(0.85)).toBe('medium');
    expect(routeByConfidence(0.5)).toBe('medium');
  });
  it('low below 0.5', () => expect(routeByConfidence(0.3)).toBe('low'));
  it('NaN -> low', () => expect(routeByConfidence(NaN)).toBe('low'));
});

describe('parseClaudeJson', () => {
  it('parses a bare JSON object', () => {
    const d = parseClaudeJson('{"project_code":"GA7","decision_type":"material","room":"kamar mandi","item_category":"keramik lantai","current_spec":null,"proposed_spec":"Roman 60x60","status":"confirmed","confidence":0.9}');
    expect(d).not.toBeNull();
    expect(d!.decision_type).toBe('material');
    expect(d!.status).toBe('confirmed');
    expect(d!.confidence).toBe(0.9);
  });

  it('parses JSON inside a code fence with prose', () => {
    const text = 'Berikut hasilnya:\n```json\n{"project_code":"AS3","decision_type":"vendor","room":null,"item_category":"granit","current_spec":null,"proposed_spec":"Vendor Maju Jaya","status":"pending","confidence":0.7}\n```\nSelesai.';
    const d = parseClaudeJson(text);
    expect(d!.decision_type).toBe('vendor');
    expect(d!.proposed_spec).toBe('Vendor Maju Jaya');
  });

  it('coerces unknown decision_type to material and clamps confidence', () => {
    const d = parseClaudeJson('{"decision_type":"banana","status":"weird","confidence":5}');
    expect(d!.decision_type).toBe('material');
    expect(d!.status).toBe('pending');
    expect(d!.confidence).toBe(1);
  });

  it('returns null on garbage', () => {
    expect(parseClaudeJson('no json here')).toBeNull();
  });
});

describe('reply builders', () => {
  it('clarification lists candidates with client names', () => {
    const msg = buildClarificationMessage([projects[0], projects[1]]);
    expect(msg).toContain('1) GA7 - Pak Andi');
    expect(msg).toContain('2) AS3 - Bu Sinta');
  });

  it('confirmation includes code, item, logger and WIB time', () => {
    const msg = buildConfirmationMessage({
      project: projects[0],
      decision: {
        project_code: 'GA7', decision_type: 'material', room: 'kamar mandi utama',
        item_category: 'keramik lantai', current_spec: null, proposed_spec: 'Roman 60x60',
        status: 'confirmed', confidence: 0.9,
      },
      loggedBy: 'Budi',
      at: new Date('2026-05-29T07:32:00Z'), // 14:32 WIB
      flagged: false,
    });
    expect(msg).toContain('Tercatat ✓ GA7');
    expect(msg).toContain('keramik lantai');
    expect(msg).toContain('Budi 14:32');
  });

  it('flagged confirmation uses the warning header', () => {
    const msg = buildConfirmationMessage({
      project: projects[0],
      decision: {
        project_code: 'GA7', decision_type: 'material', room: null,
        item_category: 'cat', current_spec: null, proposed_spec: null,
        status: 'pending', confidence: 0.6,
      },
      loggedBy: 'Sari', at: new Date('2026-05-29T03:00:00Z'), flagged: true,
    });
    expect(msg).toContain('Tercatat ⚠');
  });
});
