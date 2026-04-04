// SANO — AI Assist Client Service
// Calls the ai-assist Supabase Edge Function with bundled project context.
// The Edge Function holds the Anthropic API key — never exposed to the client.

import { supabase } from './supabase';
import type { HarianAllocationBoqCandidate, HarianAllocationScope, HarianCostAllocation } from './opname';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Switch between cost-efficient Haiku and higher-capability Sonnet */
export type AIModel = 'haiku' | 'sonnet';

export const AI_MODEL_LABELS: Record<AIModel, string> = {
  haiku:  'Haiku (Cepat)',
  sonnet: 'Sonnet (Lebih Pintar)',
};

/**
 * Project context bundled with every request.
 * Read-only summary fetched from the active project in useProject().
 * NEVER contains raw entry data — only aggregated statistics.
 */
export interface ProjectAIContext {
  projectId?: string;
  projectName?: string;
  projectCode?: string;
  userRole?: string;
  overallProgress?: number;
  openDefects?: number;
  criticalDefects?: number;
  pendingRequests?: number;
  openPOs?: number;
  pendingVOs?: number;
  delayedMilestones?: number;
  activeBoqItems?: number;
  activeMandors?: number;
  latestOpnameStatus?: string;
}

export interface AIAssistResponse {
  reply: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface MaterialNamingAISuggestion {
  summary: string;
  suggested_code: string;
  suggested_name: string;
  suggested_category: string;
  suggested_tier: 1 | 2 | 3;
  suggested_unit: string;
  confidence: 'high' | 'medium' | 'low';
  note: string;
  existing_catalog_id: string | null;
  rawReply: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface HarianAllocationSuggestion {
  allocation_scope: HarianAllocationScope;
  boq_item_id: string | null;
  suggested_pct: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface HarianAllocationSuggestionResult {
  summary: string;
  suggestions: HarianAllocationSuggestion[];
  rawReply: string;
  usage: { input_tokens: number; output_tokens: number };
}

interface HarianAllocationAIInput {
  projectId: string;
  contractName: string;
  paymentWeek: number;
  weekStart?: string | null;
  weekEnd?: string | null;
  grossTotal: number;
  userRole?: string;
  candidates: HarianAllocationBoqCandidate[];
  currentAllocations: HarianCostAllocation[];
  attendanceEntries: Array<{
    workerName: string;
    date: string;
    isPresent: boolean;
    overtimeHours: number;
    dayTotal: number;
    workDescription?: string | null;
  }>;
  context?: ProjectAIContext;
  model?: AIModel;
}

interface MaterialNamingAIInput {
  rawMaterialName: string;
  currentUnit?: string;
  projectId?: string;
  userRole?: string;
  context?: ProjectAIContext;
  model?: AIModel;
  localCatalogMatches: Array<{
    id: string;
    code: string | null;
    name: string;
    unit: string;
    category: string | null;
    tier: 1 | 2 | 3 | null;
    score: number;
  }>;
}

// ── Main call ─────────────────────────────────────────────────────────────────

/**
 * Send a conversation to the SANO AI assistant.
 *
 * @param messages  Full conversation history (user + assistant turns)
 * @param model     'haiku' (default, cheaper) or 'sonnet' (more capable)
 * @param context   Live project statistics — read-only, never modified by AI
 * @returns         The assistant's Indonesian reply
 */
export async function askSanoAI(
  messages: AIChatMessage[],
  model: AIModel = 'haiku',
  context?: ProjectAIContext,
  projectId?: string,
): Promise<AIAssistResponse> {
  const { data, error } = await supabase.functions.invoke<AIAssistResponse>('ai-assist', {
    body: { messages, model, context, projectId: projectId ?? context?.projectId },
  });

  if (error) {
    // Surface a user-friendly Indonesian error
    const message = (error as any)?.message ?? 'Gagal terhubung ke Asisten SANO.';
    throw new Error(message);
  }

  if (!data) {
    throw new Error('Tidak ada respons dari server.');
  }

  return data;
}

function extractJsonBlock(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1).trim();
  }

  return null;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function normalizeScope(value: unknown): HarianAllocationScope | null {
  return value === 'boq_item'
    || value === 'general_support'
    || value === 'rework'
    || value === 'site_overhead'
    ? value
    : null;
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

function normalizeTier(value: unknown): 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3
    ? value
    : 3;
}

export async function suggestHarianAllocation(
  input: HarianAllocationAIInput,
): Promise<HarianAllocationSuggestionResult> {
  const candidateRows = input.candidates.map(candidate => ({
    boq_item_id: candidate.id,
    boq_code: candidate.code,
    boq_label: candidate.label,
    unit: candidate.unit,
    planned: candidate.planned,
    field_progress_pct: candidate.progress,
    labor_rate_per_unit: candidate.labor_rate_per_unit,
  }));

  const currentAllocations = input.currentAllocations.map(allocation => ({
    allocation_scope: allocation.allocation_scope,
    boq_item_id: allocation.boq_item_id,
    boq_code: allocation.boq_code ?? '',
    boq_label: allocation.boq_label ?? '',
    allocation_pct: allocation.allocation_pct,
    supervisor_note: allocation.supervisor_note ?? '',
    estimator_note: allocation.estimator_note ?? '',
  }));

  const attendanceRows = input.attendanceEntries.map(entry => ({
    worker_name: entry.workerName,
    date: entry.date,
    present: entry.isPresent,
    overtime_hours: entry.overtimeHours,
    day_total: entry.dayTotal,
    work_description: entry.workDescription ?? '',
  }));

  const instruction = [
    'Bantu supervisor dan estimator SANO mengalokasikan biaya harian mingguan ke item BoQ atau scope support.',
    'Ini READ ONLY. Kamu tidak boleh mengubah progress fisik atau menyatakan seolah-olah data sudah diubah.',
    'Tujuanmu hanya memberi saran distribusi biaya tenaga kerja berdasarkan kehadiran, uraian kerja, trade mandor, dan kandidat BoQ yang tersedia.',
    'Gunakan hanya target yang ada di daftar kandidat berikut, atau salah satu scope non-BoQ ini: general_support, rework, site_overhead.',
    'Jangan mengarang target baru.',
    'Jumlah suggested_pct harus total 100.',
    'Jika data kurang yakin, alokasikan sebagian ke general_support atau rework daripada memaksa ke BoQ yang salah.',
    'Kembalikan JSON SAJA dengan schema:',
    '{',
    '  "summary": "ringkasan singkat 1-2 kalimat",',
    '  "suggestions": [',
    '    {',
    '      "allocation_scope": "boq_item | general_support | rework | site_overhead",',
    '      "boq_item_id": "uuid atau null untuk non-BoQ",',
    '      "suggested_pct": 0-100,',
    '      "confidence": "high | medium | low",',
    '      "reason": "alasan singkat"',
    '    }',
    '  ]',
    '}',
    '',
    `Kontrak: ${input.contractName}`,
    `Minggu: ${input.paymentWeek}`,
    `Periode: ${input.weekStart ?? '-'} s/d ${input.weekEnd ?? '-'}`,
    `Gross harian minggu ini: ${input.grossTotal}`,
    `Peran pengguna yang meminta saran: ${input.userRole ?? '-'}`,
    '',
    'Kandidat target:',
    JSON.stringify(candidateRows, null, 2),
    '',
    'Alokasi final yang sudah ada saat ini:',
    JSON.stringify(currentAllocations, null, 2),
    '',
    'Data kehadiran dan deskripsi kerja minggu ini:',
    JSON.stringify(attendanceRows, null, 2),
  ].join('\n');

  const response = await askSanoAI(
    [{ role: 'user', content: instruction }],
    input.model ?? 'haiku',
    input.context,
    input.projectId,
  );

  const jsonBlock = extractJsonBlock(response.reply);
  if (!jsonBlock) {
    throw new Error('Respons AI belum terbaca sebagai JSON. Coba generate ulang.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    throw new Error('Format saran AI belum valid. Coba generate ulang.');
  }

  const candidateIds = new Set(candidateRows.map(candidate => candidate.boq_item_id));
  const suggestions: HarianAllocationSuggestion[] = [];

  for (const rawSuggestion of Array.isArray(parsed?.suggestions) ? parsed.suggestions : []) {
    const scope = normalizeScope(rawSuggestion?.allocation_scope);
    if (!scope) continue;

    const boqItemId = rawSuggestion?.boq_item_id == null || rawSuggestion?.boq_item_id === ''
      ? null
      : String(rawSuggestion.boq_item_id);

    if (scope === 'boq_item' && (!boqItemId || !candidateIds.has(boqItemId))) continue;
    if (scope !== 'boq_item' && boqItemId !== null) continue;

    const pct = clampPct(Number(rawSuggestion?.suggested_pct ?? 0));
    const confidence = rawSuggestion?.confidence === 'high'
      || rawSuggestion?.confidence === 'medium'
      || rawSuggestion?.confidence === 'low'
      ? rawSuggestion.confidence
      : 'medium';
    const reason = String(rawSuggestion?.reason ?? '').trim();

    if (pct <= 0 || !reason) continue;

    suggestions.push({
      allocation_scope: scope,
      boq_item_id: boqItemId,
      suggested_pct: pct,
      confidence,
      reason,
    });
  }

  if (!suggestions.length) {
    throw new Error('AI belum menghasilkan saran alokasi yang bisa dipakai.');
  }

  const totalPct = suggestions.reduce((sum, suggestion) => sum + suggestion.suggested_pct, 0);
  if (Math.abs(totalPct - 100) > 1) {
    throw new Error('Saran AI belum genap 100%. Coba generate ulang.');
  }

  return {
    summary: String(parsed?.summary ?? '').trim() || 'Saran alokasi AI siap direview.',
    suggestions,
    rawReply: response.reply,
    usage: response.usage,
  };
}

export async function suggestMaterialNaming(
  input: MaterialNamingAIInput,
): Promise<MaterialNamingAISuggestion> {
  const instruction = [
    'Bantu standardisasi penamaan material baru di aplikasi SANO.',
    'Ini READ ONLY. Kamu tidak boleh menyatakan bahwa material sudah dibuat, diubah, atau tersimpan.',
    'Tujuanmu hanya memberi usulan nama baku, kode material, kategori, tier, dan unit agar user lebih konsisten saat input material baru.',
    'Jika salah satu kandidat katalog yang ada sebenarnya sudah cukup cocok, arahkan untuk memakai kandidat itu daripada membuat nama baru.',
    'Jika belum ada kandidat yang cocok, usulkan kode baru yang ringkas, uppercase, dan memakai pola katalog SANO (contoh: AAC-BL07, CON-RM30, PPR-34).',
    'Kembalikan JSON SAJA dengan schema:',
    '{',
    '  "summary": "ringkasan singkat 1-2 kalimat",',
    '  "existing_catalog_id": "uuid kandidat katalog yang sebaiknya dipakai, atau null",',
    '  "suggested_code": "kode material usulan",',
    '  "suggested_name": "nama material baku usulan",',
    '  "suggested_category": "kategori usulan",',
    '  "suggested_tier": 1 | 2 | 3,',
    '  "suggested_unit": "satuan usulan",',
    '  "confidence": "high | medium | low",',
    '  "note": "catatan singkat untuk estimator/user"',
    '}',
    '',
    `Nama material mentah dari user: ${input.rawMaterialName}`,
    `Unit yang sudah diisi user: ${input.currentUnit ?? '-'}`,
    `Peran user: ${input.userRole ?? '-'}`,
    '',
    'Kandidat katalog lokal yang paling dekat:',
    JSON.stringify(input.localCatalogMatches, null, 2),
  ].join('\n');

  const response = await askSanoAI(
    [{ role: 'user', content: instruction }],
    input.model ?? 'haiku',
    input.context,
    input.projectId ?? input.context?.projectId,
  );

  const jsonBlock = extractJsonBlock(response.reply);
  if (!jsonBlock) {
    throw new Error('Respons AI belum terbaca sebagai JSON. Coba ulangi usulan nama.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    throw new Error('Format saran AI untuk nama material belum valid.');
  }

  const validCatalogIds = new Set(input.localCatalogMatches.map(match => match.id));
  const existingCatalogId = parsed?.existing_catalog_id
    && validCatalogIds.has(String(parsed.existing_catalog_id))
    ? String(parsed.existing_catalog_id)
    : null;

  const suggestedName = String(parsed?.suggested_name ?? '').trim();
  const suggestedCode = String(parsed?.suggested_code ?? '').trim().toUpperCase();
  const suggestedCategory = String(parsed?.suggested_category ?? '').trim();
  const suggestedUnit = String(parsed?.suggested_unit ?? '').trim();

  if (!suggestedName || !suggestedCode) {
    throw new Error('AI belum memberi nama baku atau kode material yang bisa dipakai.');
  }

  return {
    summary: String(parsed?.summary ?? '').trim() || 'AI sudah menyiapkan usulan penamaan material.',
    suggested_code: suggestedCode,
    suggested_name: suggestedName,
    suggested_category: suggestedCategory,
    suggested_tier: normalizeTier(Number(parsed?.suggested_tier ?? 3)),
    suggested_unit: suggestedUnit,
    confidence: normalizeConfidence(parsed?.confidence),
    note: String(parsed?.note ?? '').trim(),
    existing_catalog_id: existingCatalogId,
    rawReply: response.reply,
    usage: response.usage,
  };
}

// ── Usage logging ─────────────────────────────────────────────────────────────

/**
 * Records each AI interaction for usage tracking and audit.
 * Silently fails — logging failure must never block the user.
 */
export async function logAIUsage(
  projectId: string,
  userId: string,
  model: AIModel,
  inputTokens: number,
  outputTokens: number,
  userRole: string,
): Promise<void> {
  try {
    await supabase.from('ai_chat_log').insert({
      project_id:    projectId,
      user_id:       userId,
      model,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      user_role:     userRole,
    });
  } catch {
    // intentional no-op — logging must not disrupt chat flow
  }
}
