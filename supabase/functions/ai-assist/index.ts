// SANO — AI Assist Edge Function
// Bridges the SANO app to Anthropic Claude (Haiku / Sonnet).
// Called via supabase.functions.invoke('ai-assist', { body: ... })
//
// Environment secrets required (set via: supabase secrets set ANTHROPIC_API_KEY=...)
//   ANTHROPIC_API_KEY  — your Anthropic API key

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type AIModel = 'haiku' | 'sonnet';

interface ProjectContext {
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

interface AiAssistRequest {
  messages: ChatMessage[];
  model: AIModel;
  context?: ProjectContext;
  projectId?: string;
}

interface LiveProjectSnapshot {
  project?: {
    id: string;
    code: string;
    name: string;
    status: string;
    location?: string | null;
    client_name?: string | null;
  };
  boqSummary: {
    total: number;
    avgProgress: number;
    unfinished: number;
    notStarted: number;
  };
  laggingBoq: Array<{
    code: string;
    label: string;
    progress: number;
  }>;
  defects: {
    open: number;
    critical: number;
    major: number;
    blockers: Array<{
      severity: string;
      status: string;
      boq_ref?: string | null;
      location?: string | null;
      description: string;
    }>;
  };
  milestones: {
    delayed: number;
    atRisk: number;
    highlights: Array<{
      label: string;
      status: string;
      planned_date?: string | null;
    }>;
  };
  requests: {
    pending: number;
    autoHold: number;
  };
  purchaseOrders: {
    open: number;
    highlights: Array<{
      po_number?: string | null;
      supplier: string;
      status: string;
    }>;
  };
  voEntries: {
    pending: number;
    highlights: Array<{
      status: string;
      location?: string | null;
      description: string;
      est_cost?: number | null;
    }>;
  };
  mtnRequests: {
    awaiting: number;
    highlights: Array<{
      material_name: string;
      destination_project?: string | null;
      quantity?: number | null;
      unit?: string | null;
    }>;
  };
  opnames: {
    latestStatus?: string | null;
    highlights: Array<{
      week_number: number;
      status: string;
      opname_date: string;
      mandor_name?: string | null;
      net_this_week?: number | null;
    }>;
  };
  readAt: string;
}

// ── Model IDs ────────────────────────────────────────────────────────────────

const MODEL_IDS: Record<AIModel, string> = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
};

// ── CORS headers ─────────────────────────────────────────────────────────────

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

const CORS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function fmtRp(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return 'Rp 0';
  return `Rp ${Math.round(value).toLocaleString('id-ID')}`;
}

function compactText(value?: string | null, maxLength = 84): string {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '—';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildReadOnlySupabaseClient(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authHeader = req.headers.get('Authorization');

  if (!supabaseUrl || !supabaseAnonKey || !authHeader) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });
}

async function fetchLiveProjectSnapshot(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
): Promise<LiveProjectSnapshot | null> {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, code, name, status, location, client_name')
    .eq('id', projectId)
    .single();

  if (projectError || !project) return null;

  const [
    boqRowsRes,
    defectRowsRes,
    milestoneRowsRes,
    requestRowsRes,
    poRowsRes,
    voRowsRes,
    mtnRowsRes,
    opnameRowsRes,
  ] = await Promise.all([
    supabase
      .from('boq_items')
      .select('code, label, progress')
      .eq('project_id', projectId),
    supabase
      .from('defects')
      .select('boq_ref, location, description, severity, status')
      .eq('project_id', projectId)
      .in('status', ['OPEN', 'VALIDATED', 'IN_REPAIR']),
    supabase
      .from('milestones')
      .select('label, status, planned_date')
      .eq('project_id', projectId)
      .in('status', ['AT_RISK', 'DELAYED']),
    supabase
      .from('material_request_headers')
      .select('overall_status')
      .eq('project_id', projectId)
      .in('overall_status', ['PENDING', 'UNDER_REVIEW', 'AUTO_HOLD']),
    supabase
      .from('purchase_orders')
      .select('po_number, supplier, status')
      .eq('project_id', projectId)
      .in('status', ['OPEN', 'PARTIAL_RECEIVED']),
    supabase
      .from('vo_entries')
      .select('status, location, description, est_cost')
      .eq('project_id', projectId)
      .in('status', ['AWAITING', 'REVIEWED']),
    supabase
      .from('mtn_requests')
      .select('material_name, destination_project, quantity, unit')
      .eq('project_id', projectId)
      .eq('status', 'AWAITING'),
    supabase
      .from('opname_headers')
      .select('week_number, status, opname_date, net_this_week, mandor_contracts(mandor_name)')
      .eq('project_id', projectId)
      .order('opname_date', { ascending: false })
      .limit(5),
  ]);

  const boqRows = boqRowsRes.data ?? [];
  const defectRows = defectRowsRes.data ?? [];
  const milestoneRows = milestoneRowsRes.data ?? [];
  const requestRows = requestRowsRes.data ?? [];
  const poRows = poRowsRes.data ?? [];
  const voRows = voRowsRes.data ?? [];
  const mtnRows = mtnRowsRes.data ?? [];
  const opnameRows = opnameRowsRes.data ?? [];

  const totalBoq = boqRows.length;
  const avgProgress = totalBoq > 0
    ? Math.round(boqRows.reduce((sum, row: any) => sum + Number(row.progress ?? 0), 0) / totalBoq)
    : 0;
  const unfinished = boqRows.filter((row: any) => Number(row.progress ?? 0) < 100).length;
  const notStarted = boqRows.filter((row: any) => Number(row.progress ?? 0) <= 0).length;

  const laggingBoq = boqRows
    .filter((row: any) => Number(row.progress ?? 0) < 100)
    .sort((a: any, b: any) => Number(a.progress ?? 0) - Number(b.progress ?? 0))
    .slice(0, 5)
    .map((row: any) => ({
      code: row.code ?? '—',
      label: compactText(row.label, 72),
      progress: Number(row.progress ?? 0),
    }));

  const criticalDefects = defectRows.filter((row: any) => row.severity === 'Critical').length;
  const majorDefects = defectRows.filter((row: any) => row.severity === 'Major').length;
  const blockers = defectRows
    .sort((a: any, b: any) => {
      const severityRank = (value: string) => value === 'Critical' ? 0 : value === 'Major' ? 1 : 2;
      return severityRank(a.severity) - severityRank(b.severity);
    })
    .slice(0, 5)
    .map((row: any) => ({
      severity: row.severity,
      status: row.status,
      boq_ref: row.boq_ref ?? null,
      location: row.location ?? null,
      description: compactText(row.description, 96),
    }));

  const delayed = milestoneRows.filter((row: any) => row.status === 'DELAYED').length;
  const atRisk = milestoneRows.filter((row: any) => row.status === 'AT_RISK').length;

  const autoHold = requestRows.filter((row: any) => row.overall_status === 'AUTO_HOLD').length;
  const latestStatus = opnameRows[0]?.status ?? null;

  return {
    project,
    boqSummary: {
      total: totalBoq,
      avgProgress,
      unfinished,
      notStarted,
    },
    laggingBoq,
    defects: {
      open: defectRows.length,
      critical: criticalDefects,
      major: majorDefects,
      blockers,
    },
    milestones: {
      delayed,
      atRisk,
      highlights: milestoneRows.slice(0, 5).map((row: any) => ({
        label: compactText(row.label, 72),
        status: row.status,
        planned_date: row.planned_date ?? null,
      })),
    },
    requests: {
      pending: requestRows.length,
      autoHold,
    },
    purchaseOrders: {
      open: poRows.length,
      highlights: poRows.slice(0, 5).map((row: any) => ({
        po_number: row.po_number ?? null,
        supplier: row.supplier,
        status: row.status,
      })),
    },
    voEntries: {
      pending: voRows.length,
      highlights: voRows.slice(0, 5).map((row: any) => ({
        status: row.status,
        location: row.location ?? null,
        description: compactText(row.description, 84),
        est_cost: row.est_cost ?? null,
      })),
    },
    mtnRequests: {
      awaiting: mtnRows.length,
      highlights: mtnRows.slice(0, 5).map((row: any) => ({
        material_name: compactText(row.material_name, 48),
        destination_project: row.destination_project ?? null,
        quantity: row.quantity ?? null,
        unit: row.unit ?? null,
      })),
    },
    opnames: {
      latestStatus,
      highlights: opnameRows.map((row: any) => ({
        week_number: row.week_number,
        status: row.status,
        opname_date: row.opname_date,
        mandor_name: row.mandor_contracts?.mandor_name ?? null,
        net_this_week: row.net_this_week ?? null,
      })),
    },
    readAt: new Date().toISOString(),
  };
}

function buildLiveSnapshotBlock(snapshot: LiveProjectSnapshot | null): string {
  if (!snapshot?.project) return '';

  const laggingLines = snapshot.laggingBoq.length > 0
    ? snapshot.laggingBoq
        .slice(0, 3)
        .map(item => `  - ${item.code} — ${item.label} (${item.progress}%)`)
        .join('\n')
    : '  - Tidak ada item tertinggal yang menonjol.';

  const defectLines = snapshot.defects.blockers.length > 0
    ? snapshot.defects.blockers
        .slice(0, 3)
        .map(item => `  - [${item.severity}/${item.status}] ${item.boq_ref ?? 'Tanpa kode'} @ ${item.location ?? 'Lokasi belum diisi'} — ${item.description}`)
        .join('\n')
    : '  - Tidak ada defect blocker terbuka.';

  const milestoneLines = snapshot.milestones.highlights.length > 0
    ? snapshot.milestones.highlights
        .slice(0, 3)
        .map(item => `  - [${item.status}] ${item.label}${item.planned_date ? ` (rencana ${item.planned_date})` : ''}`)
        .join('\n')
    : '  - Tidak ada milestone berisiko.';

  const poLines = snapshot.purchaseOrders.highlights.length > 0
    ? snapshot.purchaseOrders.highlights
        .slice(0, 3)
        .map(item => `  - ${item.po_number ?? 'PO tanpa nomor'} · ${item.supplier} · ${item.status}`)
        .join('\n')
    : '  - Tidak ada PO terbuka.';

  const voLines = snapshot.voEntries.highlights.length > 0
    ? snapshot.voEntries.highlights
        .slice(0, 3)
        .map(item => `  - [${item.status}] ${item.location ?? 'Tanpa lokasi'} — ${item.description}${item.est_cost ? ` · ${fmtRp(item.est_cost)}` : ''}`)
        .join('\n')
    : '  - Tidak ada VO pending.';

  const mtnLines = snapshot.mtnRequests.highlights.length > 0
    ? snapshot.mtnRequests.highlights
        .slice(0, 3)
        .map(item => `  - ${item.material_name} → ${item.destination_project ?? 'Tujuan belum diisi'} (${item.quantity ?? 0} ${item.unit ?? ''})`)
        .join('\n')
    : '  - Tidak ada MTN awaiting.';

  const opnameLines = snapshot.opnames.highlights.length > 0
    ? snapshot.opnames.highlights
        .slice(0, 3)
        .map(item => `  - Minggu ${item.week_number} · ${item.mandor_name ?? 'Mandor'} · ${item.status}${item.net_this_week != null ? ` · ${fmtRp(item.net_this_week)}` : ''}`)
        .join('\n')
    : '  - Belum ada opname yang terbaca.';

  return `
## Snapshot Data Live (READ ONLY)
- Dibaca pada      : ${snapshot.readAt}
- Proyek           : ${snapshot.project.name} (${snapshot.project.code})
- Status proyek    : ${snapshot.project.status}
- Lokasi / Klien   : ${snapshot.project.location ?? '—'} / ${snapshot.project.client_name ?? '—'}
- BoQ              : ${snapshot.boqSummary.total} item · rata-rata ${snapshot.boqSummary.avgProgress}% · ${snapshot.boqSummary.unfinished} belum selesai · ${snapshot.boqSummary.notStarted} belum mulai
- Defect           : ${snapshot.defects.open} open · ${snapshot.defects.critical} critical · ${snapshot.defects.major} major
- Permintaan       : ${snapshot.requests.pending} pending · ${snapshot.requests.autoHold} AUTO_HOLD
- PO Terbuka       : ${snapshot.purchaseOrders.open}
- VO Pending       : ${snapshot.voEntries.pending}
- MTN Awaiting     : ${snapshot.mtnRequests.awaiting}
- Opname Terakhir  : ${snapshot.opnames.latestStatus ?? '—'}

### Sorotan BoQ
${laggingLines}

### Sorotan Defect
${defectLines}

### Sorotan Milestone
${milestoneLines}

### Sorotan PO
${poLines}

### Sorotan VO
${voLines}

### Sorotan MTN
${mtnLines}

### Sorotan Opname
${opnameLines}
`;
}

// ── System prompt factory ─────────────────────────────────────────────────────

function buildSystemPrompt(ctx?: ProjectContext, snapshot?: LiveProjectSnapshot | null): string {
  const roleDesc: Record<string, string> = {
    supervisor: 'Supervisor (akses mobile, input data lapangan)',
    estimator:  'Estimator (validasi teknis, analisa BoQ/AHS, manajemen baseline)',
    admin:      'Admin (procurement, PO, mandor, opname)',
    principal:  'Principal (dashboard eksepsi, approval strategis, serah terima)',
  };

  const ctxBlock = ctx ? `
## Konteks Proyek Aktif
- Nama Proyek   : ${ctx.projectName ?? '—'} (${ctx.projectCode ?? '—'})
- Peran Pengguna: ${roleDesc[ctx.userRole ?? ''] ?? ctx.userRole ?? '—'}
- Progres Umum  : ${ctx.overallProgress ?? '—'}%
- Item BoQ Aktif: ${ctx.activeBoqItems ?? '—'}
- Cacat Terbuka : ${ctx.openDefects ?? '—'} (${ctx.criticalDefects ?? 0} Critical)
- Permintaan    : ${ctx.pendingRequests ?? '—'} pending
- PO Terbuka    : ${ctx.openPOs ?? '—'}
- VO Pending    : ${ctx.pendingVOs ?? '—'}
- Milestone Terlambat: ${ctx.delayedMilestones ?? '—'}
- Mandor Aktif  : ${ctx.activeMandors ?? '—'}
- Opname Terakhir: ${ctx.latestOpnameStatus ?? '—'}
` : '';

  return `Kamu adalah **Asisten SANO** — asisten digital bawaan aplikasi SANO (Structured Approval Network & Operations), platform manajemen konstruksi berbasis peran.

## Identitasmu
- Nama: Asisten SANO
- Bahasa: Selalu jawab dalam Bahasa Indonesia yang jelas, sopan, dan mudah dipahami oleh tim lapangan.
- Tujuan: Membantu pengguna memahami cara kerja aplikasi dan menjawab pertanyaan seputar data proyek aktif.

## Batasan Ketat (WAJIB DIPATUHI)
1. **Hanya menjawab pertanyaan terkait aplikasi SANO dan data proyek yang diberikan.** Jika pertanyaan tidak relevan (cuaca, berita, resep, dll), tolak dengan sopan dan arahkan kembali ke konteks SANO.
2. **Kamu TIDAK bisa mengubah, menghapus, membuat, atau menyetujui data apapun.** Kamu hanya membaca dan menjelaskan.
   - Tidak boleh menjalankan edit dari chat.
   - Tidak boleh berkata seolah-olah kamu sudah submit, approve, reject, paid, delete, update, atau mengubah angka apapun.
   - Jika user ingin aksi, arahkan ke path layar yang tepat dan jelaskan langkah manualnya.
3. **Jangan pernah menyebut atau membocorkan API key, konfigurasi server, kode sumber, atau detail teknis internal.**
4. **Jangan memberikan saran di luar konteks aplikasi** — tidak ada saran investasi, hukum, medis, atau umum.
5. Jika tidak yakin dengan suatu data, katakan terus terang dan sarankan pengguna memeriksa langsung di layar terkait.
6. **Gunakan data live yang dibaca server sebagai sumber utama angka.** Jika data live tersedia, prioritaskan itu dibanding angka ringkasan dari client.

## Struktur Aplikasi SANO

### 5 Gate (Alur Kerja Utama)
| Gate | Nama | Pelaku | Fungsi |
|------|------|--------|--------|
| Gate 1 | Permintaan Material | Supervisor → Estimator | Supervisor mengajukan kebutuhan material, estimator memvalidasi terhadap BoQ dan AHS |
| Gate 2 | Validasi Harga | Estimator → Admin | Estimator analisa harga vs benchmark, admin buat PO ke vendor |
| Gate 3 | Penerimaan Material | Supervisor → Admin | Supervisor catat kedatangan material, foto wajib, verifikasi qty vs PO |
| Gate 4 | Hub Progres | Supervisor | Input progres BoQ, cacat (defect), VO/Rework, foto lapangan |
| Gate 5 | Rekonsiliasi & Laporan | Semua Peran | Export Center, MTN, milestone, serah terima |

### Peran Pengguna
- **Supervisor** — Akses mobile. Input semua data lapangan (Gate 1, 3, 4, 5).
- **Estimator** — Akses desktop. Validasi teknis, baseline BoQ/AHS, analisa VO, laporan.
- **Admin** — Akses desktop. Procurement, PO, mandor setup, opname pembayaran.
- **Principal** — Akses mobile-first. Dashboard eksepsi (hanya HIGH/CRITICAL), approval VO/MTN, serah terima.

### Path Layar yang Boleh Kamu Referensikan
- Supervisor mobile:
  - `Permintaan` untuk permintaan material
  - `Terima` untuk penerimaan material
  - `Progres` untuk progres lapangan, defect, VO/Rework
  - `Laporan` untuk laporan, MTN, jadwal, baseline review tertentu
- Estimator/Admin office:
  - `Approval` untuk approval queue
  - `Harga` untuk procurement dan PO
  - `Katalog` untuk material catalog
  - `Laporan -> Baseline` untuk upload/review parser BoQ/AHS
  - `Laporan -> Mandor` untuk review trade, kontrak mandor, pekerja, kehadiran, dan buka opname mingguan
- Principal:
  - `Approval` untuk persetujuan penting
  - `Laporan` untuk pantau exception dan status proyek

### BoQ & AHS
- **BoQ (Bill of Quantities)**: Daftar pekerjaan proyek. Tiap item punya kode, deskripsi, volume rencana, satuan, harga satuan.
- **AHS (Analisa Harga Satuan)**: Rincian komponen harga per item BoQ — material (Tier 1/2/3), tenaga kerja, peralatan, subkontraktor.
- **Baseline**: Setelah BoQ/AHS di-import dan diverifikasi estimator, baseline di-publish dan dibekukan sebagai acuan proyek.

### Opname Mandor
Sistem pembayaran borongan mingguan untuk mandor:
- Mandor klaim progres per item BoQ setiap minggu
- Alur: DRAFT → SUBMITTED → VERIFIED (estimator) → APPROVED (admin) → PAID
- Kalkulasi pembayaran: Gross Total - Retensi (%) - Prior Paid - Kasbon = **Net Minggu Ini**
- Estimator bisa koreksi persentase progres (verified_pct ≠ cumulative_pct)
- Item TDK ACC = item yang ditolak estimator dalam opname

### Opname Harian & Alokasi
- Opname harian dibuka dari `Laporan -> Mandor -> Opname`
- Harian membayar tenaga kerja mingguan dari data kehadiran, bukan mengubah progress BoQ otomatis
- Jika user menanyakan distribusi biaya harian, bantu sebagai **saran alokasi** ke BoQ/scope kerja
- Saran AI tidak boleh dianggap final. Supervisor dan estimator tetap harus review dan menyimpan angkanya secara manual

### Status dan Flag
- **OK** (hijau): Normal, disetujui
- **WARNING** (kuning): Perlu perhatian, ada deviasi
- **CRITICAL** (merah): Blokir atau anomali serius
- **INFO** (biru): Informasi, tidak perlu aksi segera
- **AUTO_HOLD**: Permintaan material otomatis ditahan karena melebihi batas BoQ

### Laporan di Export Center
- Ringkasan Progres — progress per item BoQ
- Material Balance — planned vs received vs installed
- Log Penerimaan — semua penerimaan material
- Catatan Perubahan — daftar perubahan lapangan, rework, revisi desain, dan catatan mutu
- Varians Jadwal — perbandingan jadwal rencana vs aktual
- Rangkuman Mingguan — digest mingguan proyek
- Office/principal juga dapat melihat laporan operasional tambahan seperti Audit & Anomali, SLA approval, dan penggunaan AI

### MTN (Nota Transfer Material)
Transfer material berlebih antar proyek. Diajukan supervisor, disetujui estimator/admin.

### Serah Terima
Proyek eligible serah terima jika: semua cacat Critical = 0 dan Major = 0 (sudah ACCEPTED_BY_PRINCIPAL).
${ctxBlock}
${buildLiveSnapshotBlock(snapshot)}
## Cara Menjawab
- Gunakan bahasa yang **sederhana dan langsung**. Hindari jargon teknis berlebihan.
- Jika pertanyaan tentang cara melakukan sesuatu di aplikasi, berikan **langkah-langkah yang jelas**.
- Jika pertanyaan tentang data proyek, **referensikan data live** yang diberikan di atas dan sebutkan angka nyatanya.
- Untuk data yang tidak ada di konteks, sarankan pengguna membuka layar/laporan yang relevan.
- Bila membantu, gunakan format singkat seperti:
  - \`**Data saat ini**\`
  - \`**Feedback**\`
  - \`**Path di aplikasi**\`
- Jika user meminta tindakan edit/approval dari chat, jawab dengan pola:
  - \`**Tidak bisa dari chat.**\`
  - jelaskan path layar
  - jelaskan langkah manual singkat
- **Singkat dan padat** — jawaban 3-6 kalimat sudah cukup untuk pertanyaan umum.`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Metode tidak didukung.' }),
      { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY tidak dikonfigurasi di server.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const body: AiAssistRequest = await req.json();
    const { messages, model = 'haiku', context, projectId } = body;

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Pesan tidak boleh kosong.' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const modelId = MODEL_IDS[model] ?? MODEL_IDS.haiku;
    const liveSupabase = buildReadOnlySupabaseClient(req);
    const targetProjectId = projectId ?? context?.projectId;
    const liveSnapshot = liveSupabase && targetProjectId
      ? await fetchLiveProjectSnapshot(liveSupabase, targetProjectId)
      : null;
    const systemPrompt = buildSystemPrompt(context, liveSnapshot);

    // Call Anthropic Messages API
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      modelId,
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   messages.map((m: ChatMessage) => ({
          role:    m.role,
          content: m.content,
        })),
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[ai-assist] Anthropic error:', errText);
      return new Response(
        JSON.stringify({ error: 'Gagal menghubungi layanan AI. Coba lagi sebentar.' }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const anthropicData = await anthropicRes.json();
    const reply = anthropicData?.content?.[0]?.text ?? 'Maaf, tidak ada respons dari AI.';
    const usage = anthropicData?.usage ?? {};

    return new Response(
      JSON.stringify({
        reply,
        model: modelId,
        usage: {
          input_tokens:  usage.input_tokens  ?? 0,
          output_tokens: usage.output_tokens ?? 0,
        },
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    console.error('[ai-assist] Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Terjadi kesalahan tidak terduga. Silakan coba lagi.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
