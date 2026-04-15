// Pure validation of Claude's structured output.
// Exported separately so it can be unit-tested without the full edge runtime.

export interface AiDraftCandidate {
  label: string;
  planned_date: string;
  boq_ids: string[];
  depends_on_labels: string[];
  confidence: number;
  explanation: string;
}

export interface ValidationResult {
  valid: AiDraftCandidate[];
  rejected: Array<{ candidate: unknown; reason: string }>;
}

export function validateDraftBatch(
  raw: unknown,
  validBoqIds: Set<string>,
  today: string, // ISO date
): ValidationResult {
  const result: ValidationResult = { valid: [], rejected: [] };

  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).milestones)) {
    return { valid: [], rejected: [{ candidate: raw, reason: 'payload missing "milestones" array' }] };
  }

  for (const c of (raw as { milestones: unknown[] }).milestones) {
    const reason = validateCandidate(c, validBoqIds, today);
    if (reason) {
      result.rejected.push({ candidate: c, reason });
    } else {
      const cast = c as AiDraftCandidate;
      result.valid.push({
        ...cast,
        boq_ids: cast.boq_ids.filter(id => validBoqIds.has(id)),
        confidence: Math.max(0, Math.min(1, cast.confidence)),
      });
    }
  }
  return result;
}

function validateCandidate(c: unknown, _validBoqIds: Set<string>, today: string): string | null {
  if (!c || typeof c !== 'object') return 'not an object';
  const obj = c as Record<string, unknown>;

  if (typeof obj.label !== 'string' || obj.label.trim().length === 0) return 'missing label';
  if (typeof obj.planned_date !== 'string') return 'missing planned_date';
  const date = obj.planned_date as string;
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return 'planned_date not ISO';
  if (date < today) return 'planned_date is in the past';

  if (!Array.isArray(obj.boq_ids)) return 'missing boq_ids array';
  if (!obj.boq_ids.every(x => typeof x === 'string')) return 'boq_ids must be strings';

  if (!Array.isArray(obj.depends_on_labels)) return 'missing depends_on_labels array';
  if (!obj.depends_on_labels.every(x => typeof x === 'string')) return 'depends_on_labels must be strings';

  if (typeof obj.confidence !== 'number' || Number.isNaN(obj.confidence)) return 'missing confidence';
  if (typeof obj.explanation !== 'string' || obj.explanation.trim().length === 0) return 'missing explanation';

  return null;
}

/**
 * Resolve depends_on_labels to depends_on (array of draft indices in the valid list),
 * then run a cycle check on the projected index graph. Returns the final drafts with
 * label references replaced by indices (still index-based until DB insert assigns UUIDs).
 */
export function resolveLabelRefs(
  valid: AiDraftCandidate[],
): Array<AiDraftCandidate & { depends_on_indices: number[] }> {
  const labelToIdx = new Map<string, number>();
  valid.forEach((v, i) => labelToIdx.set(v.label, i));

  return valid.map((v, idx) => {
    const indices = v.depends_on_labels
      .map(l => labelToIdx.get(l))
      .filter((x): x is number => x !== undefined && x !== idx);
    return { ...v, depends_on_indices: indices };
  });
}
