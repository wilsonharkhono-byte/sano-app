import type { BoqItem, ProjectMaterialMasterLine } from './types';
import { sanitizeText } from './validation';

type ScopeBoqItem = Pick<BoqItem, 'id' | 'code' | 'label' | 'chapter' | 'parent_code' | 'element_code'>;

export interface MaterialScopeCandidate {
  scope_tag: string;
  chapter: string | null;
  total_planned_quantity: number;
  boq_item_ids: string[];
  boq_codes: string[];
}

export type MaterialScopeIndex = Map<string, MaterialScopeCandidate[]>;

export interface AutomaticScopeTagInput {
  boqMode: 'single' | 'multi' | 'general';
  selectedBoqItem?: ScopeBoqItem | null;
  draftBoqSummary?: string;
  materialId?: string | null;
  materialScopeIndex?: MaterialScopeIndex;
  fallbackBoqRef?: string | null;
}

const GENERAL_SCOPE_TAG = 'STOK UMUM';
const UNMAPPED_SCOPE_TAG = 'BELUM TERPETAKAN';

function cleanScopePart(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned.length > 0 ? cleaned : null;
}

function inferCodeGroup(code: string | null | undefined): string | null {
  const cleaned = cleanScopePart(code);
  if (!cleaned) return null;

  const compact = cleaned.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const alphaPrefix = compact.match(/^[A-Z]+/);
  if (alphaPrefix) return alphaPrefix[0];

  const firstToken = cleaned.split(/[\s./]+/).find(Boolean) ?? null;
  return cleanScopePart(firstToken);
}

export function buildBoqScopeTag(item: Pick<ScopeBoqItem, 'code' | 'label' | 'chapter' | 'parent_code' | 'element_code'>): string {
  const chapter = cleanScopePart(item.chapter);
  const codeGroup = inferCodeGroup(item.code);
  const elementCode = cleanScopePart(item.element_code);
  const parentCode = cleanScopePart(item.parent_code);
  const label = cleanScopePart(item.label);
  const code = cleanScopePart(item.code);

  const secondary = codeGroup ?? elementCode ?? parentCode ?? code ?? label;
  if (chapter && secondary && chapter.toLowerCase() !== secondary.toLowerCase()) {
    return `${chapter} · ${secondary}`;
  }

  return chapter ?? secondary ?? UNMAPPED_SCOPE_TAG;
}

export function buildMaterialScopeIndex(
  masterLines: Array<Pick<ProjectMaterialMasterLine, 'material_id' | 'boq_item_id' | 'planned_quantity'>>,
  boqItems: ScopeBoqItem[],
): MaterialScopeIndex {
  const boqById = new Map(boqItems.map(item => [item.id, item]));
  const grouped = new Map<string, Map<string, MaterialScopeCandidate>>();

  for (const line of masterLines) {
    if (!line.material_id) continue;
    const boqItem = boqById.get(line.boq_item_id);
    if (!boqItem) continue;

    const scopeTag = buildBoqScopeTag(boqItem);
    const materialBuckets = grouped.get(line.material_id) ?? new Map<string, MaterialScopeCandidate>();
    const bucket = materialBuckets.get(scopeTag) ?? {
      scope_tag: scopeTag,
      chapter: cleanScopePart(boqItem.chapter),
      total_planned_quantity: 0,
      boq_item_ids: [],
      boq_codes: [],
    };

    bucket.total_planned_quantity += Number(line.planned_quantity ?? 0);
    if (!bucket.boq_item_ids.includes(boqItem.id)) bucket.boq_item_ids.push(boqItem.id);
    if (!bucket.boq_codes.includes(boqItem.code)) bucket.boq_codes.push(boqItem.code);

    materialBuckets.set(scopeTag, bucket);
    grouped.set(line.material_id, materialBuckets);
  }

  const result: MaterialScopeIndex = new Map();
  for (const [materialId, buckets] of grouped.entries()) {
    result.set(
      materialId,
      Array.from(buckets.values()).sort((a, b) => b.total_planned_quantity - a.total_planned_quantity),
    );
  }
  return result;
}

export function normalizeBoqRefToScopeTag(boqRef: string | null | undefined): string | null {
  const cleaned = cleanScopePart(boqRef);
  if (!cleaned) return null;
  if (/^stok umum$/i.test(cleaned)) return GENERAL_SCOPE_TAG;

  if (/^multi-boq\b/i.test(cleaned)) {
    const parts = cleaned.split('·').map(part => cleanScopePart(part)).filter(Boolean) as string[];
    if (parts.length > 1) return parts.slice(1).join(' · ');
    return 'MULTI-BOQ';
  }

  return cleaned;
}

function summarizeMixedMaterialScope(candidates: MaterialScopeCandidate[]): string {
  const topScopes = candidates.slice(0, 2).map(candidate => candidate.scope_tag);
  return `MULTI-BOQ · ${topScopes.join(' / ')}`;
}

export function deriveAutomaticScopeTag(input: AutomaticScopeTagInput): string {
  if (input.boqMode === 'general') return GENERAL_SCOPE_TAG;

  if (input.selectedBoqItem) {
    return buildBoqScopeTag(input.selectedBoqItem);
  }

  const candidates = input.materialId
    ? input.materialScopeIndex?.get(input.materialId) ?? []
    : [];

  if (candidates.length === 1) {
    return candidates[0].scope_tag;
  }

  if (candidates.length > 1) {
    const totalQuantity = candidates.reduce((sum, candidate) => sum + candidate.total_planned_quantity, 0);
    const dominant = candidates[0];
    if (dominant && totalQuantity > 0 && dominant.total_planned_quantity / totalQuantity >= 0.6) {
      return dominant.scope_tag;
    }

    const chapters = Array.from(
      new Set(candidates.map(candidate => cleanScopePart(candidate.chapter)).filter(Boolean)),
    ) as string[];
    if (chapters.length === 1) {
      return chapters[0];
    }

    return summarizeMixedMaterialScope(candidates);
  }

  const summary = cleanScopePart(input.draftBoqSummary);
  if (summary) return `MULTI-BOQ · ${sanitizeText(summary)}`;

  return normalizeBoqRefToScopeTag(input.fallbackBoqRef) ?? UNMAPPED_SCOPE_TAG;
}
