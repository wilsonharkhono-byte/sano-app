// SANO — AI Draft Milestones Edge Function
// Spec: docs/superpowers/specs/2026-04-15-jadwal-milestone-authoring-design.md §6
// Pinned to claude-sonnet-4-6; no rate limiting; validates output strictly.
//
// Environment secrets required (set via: supabase secrets set ANTHROPIC_API_KEY=...)
//   ANTHROPIC_API_KEY          — Anthropic API key
//   SUPABASE_URL               — provided automatically in Supabase runtime
//   SUPABASE_SERVICE_ROLE_KEY  — service role for server-side writes
//   AI_DRAFT_MODEL             — optional override, defaults to claude-sonnet-4-6

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { validateDraftBatch, resolveLabelRefs } from './validate.ts';

const MODEL = Deno.env.get('AI_DRAFT_MODEL') ?? 'claude-sonnet-4-6';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DraftRequest {
  project_id: string;
  user_id: string;
  parameters: {
    project_type: string;
    duration_months: number;
    mandor_count: number;
    shift_mode: '1_shift' | '2_shift' | 'harian';
    site_notes?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!ANTHROPIC_API_KEY) {
    return json({ success: false, error: 'ANTHROPIC_API_KEY tidak dikonfigurasi di server.' }, 500);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ success: false, error: 'Supabase service credentials tidak dikonfigurasi.' }, 500);
  }

  try {
    const body: DraftRequest = await req.json();
    const { project_id, user_id, parameters } = body;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 0. Idempotency: suppress duplicate triggers within 30s ───────
    const thirtySecAgo = new Date(Date.now() - 30_000).toISOString();
    const { data: recent } = await supabase
      .from('ai_draft_runs')
      .select('id, committed_milestone_ids, response_summary, completed_at')
      .eq('project_id', project_id)
      .eq('user_id', user_id)
      .gte('created_at', thirtySecAgo)
      .order('created_at', { ascending: false })
      .limit(1);
    if (recent && recent[0] && recent[0].completed_at) {
      return json({
        success: true,
        reused: true,
        summary: recent[0].response_summary,
        committed_milestone_ids: recent[0].committed_milestone_ids,
      });
    }

    // ── 1. Fetch published BoQ ──────────────────────────────────────
    const { data: boqItems } = await supabase
      .from('boq_items')
      .select('id, code, label, unit, chapter, sort_order')
      .eq('project_id', project_id)
      .order('sort_order');

    if (!boqItems || boqItems.length === 0) {
      return json({ success: false, error: 'Baseline belum dipublikasi.' }, 400);
    }

    // ── 2. Reference-class lookup (top-3 similar past projects) ─────
    const references = await fetchReferenceClass(supabase, project_id, boqItems);

    // ── 3. Build prompt and call Claude ─────────────────────────────
    const prompt = buildPrompt(parameters, boqItems, references);
    const promptHash = await hashString(prompt);

    // Insert audit row (pending)
    const { data: runRow, error: runErr } = await supabase
      .from('ai_draft_runs')
      .insert({
        project_id,
        user_id,
        parameters,
        prompt_hash: promptHash,
        response_summary: { status: 'pending' },
        model: MODEL,
      })
      .select()
      .single();
    if (runErr || !runRow) {
      return json({ success: false, error: 'Gagal menyimpan audit run.' }, 500);
    }

    const claudeResult = await callClaudeWithRetry(prompt, 1);
    if (!claudeResult.ok) {
      await supabase.from('ai_draft_runs').update({
        response_summary: { status: 'failed', error: claudeResult.error },
        completed_at: new Date().toISOString(),
      }).eq('id', runRow.id);
      return json({ success: false, error: 'AI tidak dapat membuat draf. Silakan coba lagi atau buat milestone manual.' }, 500);
    }

    // ── 4. Validate + resolve label refs ─────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const validBoqIdSet = new Set<string>(boqItems.map((b: { id: string }) => b.id));
    const validation = validateDraftBatch(claudeResult.parsed, validBoqIdSet, today);
    const resolved = resolveLabelRefs(validation.valid);

    if (resolved.length === 0) {
      await supabase.from('ai_draft_runs').update({
        response_summary: {
          status: 'failed',
          proposed: validation.valid.length + validation.rejected.length,
          rejected: validation.rejected.length,
        },
        completed_at: new Date().toISOString(),
      }).eq('id', runRow.id);
      return json({ success: false, error: 'Semua usulan AI tidak valid.' }, 500);
    }

    // ── 5. Persist drafts (two-pass: insert then patch depends_on) ──
    const firstPass = resolved.map(r => ({
      project_id,
      label: r.label,
      planned_date: r.planned_date,
      boq_ids: r.boq_ids,
      depends_on: [],
      proposed_by: 'ai',
      confidence_score: r.confidence,
      ai_explanation: r.explanation,
      author_status: 'draft',
      status: 'ON_TRACK',
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('milestones')
      .insert(firstPass)
      .select();
    if (insertErr || !inserted) {
      return json({ success: false, error: insertErr?.message ?? 'Gagal menyimpan draf.' }, 500);
    }

    // Patch depends_on with actual UUIDs now that rows have IDs.
    // resolved[i] maps to inserted[i] by position since we inserted in order.
    for (let i = 0; i < resolved.length; i++) {
      const idxDeps = resolved[i].depends_on_indices;
      if (idxDeps.length === 0) continue;
      const predIds = idxDeps.map(idx => inserted[idx].id);
      await supabase
        .from('milestones')
        .update({ depends_on: predIds })
        .eq('id', inserted[i].id);
    }

    // ── 6. Finalize audit row ────────────────────────────────────────
    await supabase.from('ai_draft_runs').update({
      committed_milestone_ids: inserted.map((r: { id: string }) => r.id),
      response_summary: {
        status: 'ok',
        proposed: validation.valid.length + validation.rejected.length,
        rejected: validation.rejected.length,
        committed: inserted.length,
      },
      completed_at: new Date().toISOString(),
    }).eq('id', runRow.id);

    return json({
      success: true,
      committed_milestone_ids: inserted.map((r: { id: string }) => r.id),
      summary: {
        proposed: validation.valid.length + validation.rejected.length,
        rejected: validation.rejected.length,
        committed: inserted.length,
      },
    });
  } catch (err) {
    console.error('ai-draft-milestones error:', err);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

async function hashString(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Reference-class lookup (§6 step 2) ───────────────────────────────

async function fetchReferenceClass(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  boqItems: Array<{ id: string; code: string; label: string }>,
): Promise<Array<{ project_id: string; milestones: Array<{ label: string; offset_days: number }> }>> {
  // Minimal v1: pull the 3 most recently created projects (excluding current)
  // that have at least one confirmed, non-deleted milestone and share ≥1 BoQ code.
  // Spec 2 will replace this with proper AHS/BoQ similarity scoring.

  const codes = new Set(boqItems.map(b => b.code));

  const { data: candidateProjects } = await supabase
    .from('projects')
    .select('id, created_at')
    .neq('id', projectId)
    .order('created_at', { ascending: false })
    .limit(20);

  const results: Array<{ project_id: string; milestones: Array<{ label: string; offset_days: number }> }> = [];
  for (const p of (candidateProjects ?? []) as Array<{ id: string }>) {
    if (results.length >= 3) break;

    const { data: pBoq } = await supabase
      .from('boq_items')
      .select('code')
      .eq('project_id', p.id)
      .limit(200);

    const overlap = ((pBoq ?? []) as Array<{ code: string }>).filter(b => codes.has(b.code)).length;
    if (overlap < 3) continue;

    const { data: pMs } = await supabase
      .from('milestones')
      .select('label, planned_date')
      .eq('project_id', p.id)
      .eq('author_status', 'confirmed')
      .is('deleted_at', null)
      .order('planned_date');

    const pMsTyped = (pMs ?? []) as Array<{ label: string; planned_date: string }>;
    if (pMsTyped.length === 0) continue;
    const firstDate = new Date(pMsTyped[0].planned_date).getTime();
    results.push({
      project_id: p.id,
      milestones: pMsTyped.map(m => ({
        label: m.label,
        offset_days: Math.round((new Date(m.planned_date).getTime() - firstDate) / 86400000),
      })),
    });
  }
  return results;
}

// ── Prompt builder (§6 step 3) ───────────────────────────────────────

function buildPrompt(
  params: DraftRequest['parameters'],
  boqItems: Array<{ code: string; label: string; chapter: string | null; unit: string }>,
  references: Array<{ project_id: string; milestones: Array<{ label: string; offset_days: number }> }>,
): string {
  const boqByChapter = new Map<string, Array<{ code: string; label: string; unit: string }>>();
  for (const b of boqItems) {
    const ch = b.chapter ?? 'Tanpa Chapter';
    if (!boqByChapter.has(ch)) boqByChapter.set(ch, []);
    boqByChapter.get(ch)!.push({ code: b.code, label: b.label, unit: b.unit });
  }

  const boqBlock = Array.from(boqByChapter.entries())
    .map(([ch, items]) => `${ch}:\n${items.map(i => `  ${i.code} — ${i.label} (${i.unit})`).join('\n')}`)
    .join('\n\n');

  const refBlock = references.length === 0
    ? 'Tidak ada proyek referensi — andalkan parameter dan struktur BoQ saja.'
    : references.map((r, i) => `Proyek referensi ${i + 1}:\n${r.milestones.map(m => `  +${m.offset_days}hari: ${m.label}`).join('\n')}`).join('\n\n');

  return `Anda adalah Claude bertugas sebagai prior elicitor (Role 7) untuk sistem penjadwalan proyek konstruksi Indonesia.

TUGAS: Buatkan draf milestone untuk proyek ini. Output HARUS mengikuti skema JSON yang diminta, dengan confidence (0..1) dan explanation untuk setiap milestone.

PARAMETER PROYEK:
- Jenis: ${params.project_type}
- Durasi target: ${params.duration_months} bulan
- Jumlah mandor aktif: ${params.mandor_count}
- Shift: ${params.shift_mode}
${params.site_notes ? `- Catatan site: ${params.site_notes}` : ''}

BOQ YANG DIPUBLIKASI (gunakan boq_ids yang SAMA PERSIS dengan code di bawah):
${boqBlock}

REFERENSI DARI PROYEK SEBELUMNYA:
${refBlock}

INSTRUKSI:
1. Susun 6–12 milestone yang mencerminkan fase kerja realistis.
2. Setiap milestone boleh (tapi tidak wajib) terhubung ke item BoQ.
3. Gunakan depends_on_labels untuk menyatakan dependensi antar-milestone dalam set yang Anda usulkan.
4. planned_date harus ≥ hari ini dan logis vs durasi proyek.
5. confidence = seberapa yakin Anda (0..1). explanation = alasan singkat 1-2 kalimat.

OUTPUT SCHEMA (wajib persis):
{
  "milestones": [
    {
      "label": string,
      "planned_date": "YYYY-MM-DD",
      "boq_ids": [string],
      "depends_on_labels": [string],
      "confidence": number,
      "explanation": string
    }
  ]
}

Kembalikan HANYA JSON tanpa prose apapun.`;
}

// ── Claude call with one retry (§6 step 5) ───────────────────────────

async function callClaudeWithRetry(
  prompt: string,
  retries: number,
): Promise<{ ok: true; parsed: unknown } | { ok: false; error: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const systemNote = attempt === 0
      ? 'Output MUST be valid JSON matching the requested schema.'
      : 'CRITICAL: Output MUST match the schema exactly. Return only JSON. No prose.';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          system: systemNote,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        if (attempt === retries) return { ok: false, error: `Claude API ${resp.status}` };
        continue;
      }
      const data = await resp.json();
      const text = data?.content?.[0]?.text ?? '';
      try {
        const parsed = JSON.parse(extractJson(text));
        return { ok: true, parsed };
      } catch {
        if (attempt === retries) return { ok: false, error: 'Could not parse Claude JSON' };
        continue;
      }
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) return { ok: false, error: (err as Error).message };
    }
  }
  return { ok: false, error: 'Retry loop exhausted' };
}

function extractJson(text: string): string {
  // Claude sometimes wraps in ```json ... ``` blocks. Strip them.
  const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
  if (match) return match[1];
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1);
  return text;
}
