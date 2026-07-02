// SANO — Daily Site Log
// A once-a-day narrative site diary (weather, crew, highlights, photos) that
// feeds the client progress report. Separate from the quantitative
// progress_entries stream; linked optionally via highlight.boq_item_id.

import { supabase } from './supabase';

export interface DailyLogHighlight {
  id?: string;
  area: string;
  note: string;
  boq_item_id: string | null;
  sort_order: number;
}

export interface DailyLogPhoto {
  id?: string;
  storage_path: string;
  caption: string | null;
  is_featured: boolean;
  captured_at: string | null;
}

export interface DailySiteLog {
  id: string;
  project_id: string;
  log_date: string;              // YYYY-MM-DD
  weather: string | null;
  crew_total: number | null;
  crew_breakdown: string | null;
  safety_incidents: number;
  author_id: string | null;
  highlights: DailyLogHighlight[];
  photos: DailyLogPhoto[];
}

export interface DailySiteLogInput {
  project_id: string;
  log_date: string;
  weather: string | null;
  crew_total: number | null;
  crew_breakdown: string | null;
  safety_incidents: number;
  author_id: string | null;
  highlights: DailyLogHighlight[];
  photos: DailyLogPhoto[];
}

export interface PeriodAggregate {
  highlights: Array<DailyLogHighlight & { log_date: string }>;
  featuredPhotos: Array<DailyLogPhoto & { log_date: string }>;
  weather: string | null;
  crewTotal: number | null;
  crewBreakdown: string | null;
  safetyIncidents: number;
}

export async function getDailyLog(projectId: string, isoDate: string): Promise<DailySiteLog | null> {
  const { data: log, error } = await supabase
    .from('daily_site_logs')
    .select('id, project_id, log_date, weather, crew_total, crew_breakdown, safety_incidents, author_id')
    .eq('project_id', projectId)
    .eq('log_date', isoDate)
    .maybeSingle();
  if (error) throw error;
  if (!log) return null;

  const { data: highlights, error: hlErr } = await supabase
    .from('daily_log_highlights')
    .select('id, log_id, area, note, boq_item_id, sort_order')
    .eq('log_id', log.id)
    .order('sort_order', { ascending: true });
  if (hlErr) throw hlErr;

  const { data: photos, error: phErr } = await supabase
    .from('daily_log_photos')
    .select('id, log_id, storage_path, caption, is_featured, captured_at')
    .eq('log_id', log.id);
  if (phErr) throw phErr;

  return {
    ...log,
    highlights: (highlights ?? []) as DailyLogHighlight[],
    photos: (photos ?? []) as DailyLogPhoto[],
  } as DailySiteLog;
}

export async function upsertDailyLog(input: DailySiteLogInput): Promise<string> {
  const { data: log, error } = await supabase
    .from('daily_site_logs')
    .upsert(
      {
        project_id: input.project_id,
        log_date: input.log_date,
        weather: input.weather,
        crew_total: input.crew_total,
        crew_breakdown: input.crew_breakdown,
        safety_incidents: input.safety_incidents,
        author_id: input.author_id,
      },
      { onConflict: 'project_id,log_date' },
    )
    .select('id')
    .single();
  if (error || !log) throw error ?? new Error('Daily log upsert failed');

  // Replace-then-insert children (idempotent per save).
  const { error: delHlErr } = await supabase.from('daily_log_highlights').delete().eq('log_id', log.id);
  if (delHlErr) throw delHlErr;
  const { error: insHlErr } = await supabase.from('daily_log_highlights').insert(
    input.highlights.map((h, i) => ({
      log_id: log.id, area: h.area, note: h.note,
      boq_item_id: h.boq_item_id, sort_order: h.sort_order ?? i,
    })),
  );
  if (insHlErr) throw insHlErr;

  const { error: delPhErr } = await supabase.from('daily_log_photos').delete().eq('log_id', log.id);
  if (delPhErr) throw delPhErr;
  const { error: insPhErr } = await supabase.from('daily_log_photos').insert(
    input.photos.map((p) => ({
      log_id: log.id, storage_path: p.storage_path, caption: p.caption,
      is_featured: p.is_featured, captured_at: p.captured_at,
    })),
  );
  if (insPhErr) throw insPhErr;

  return log.id;
}

export async function aggregatePeriod(
  projectId: string,
  startIso: string,
  endIso: string,
): Promise<PeriodAggregate> {
  const { data: logs, error } = await supabase
    .from('daily_site_logs')
    .select('id, log_date, weather, crew_total, crew_breakdown, safety_incidents')
    .eq('project_id', projectId)
    .gte('log_date', startIso)
    .lte('log_date', endIso)
    .order('log_date', { ascending: true });
  if (error) throw error;

  const rows = logs ?? [];
  if (rows.length === 0) {
    return { highlights: [], featuredPhotos: [], weather: null, crewTotal: null, crewBreakdown: null, safetyIncidents: 0 };
  }

  const logIds = rows.map((r: any) => r.id);
  const dateById = new Map<string, string>(rows.map((r: any) => [r.id, r.log_date]));
  const orderIndex = new Map<string, number>(rows.map((r: any, i: number) => [r.id, i])); // by log_date asc
  const latest = rows[rows.length - 1]; // most recent in range

  const { data: highlights, error: hlErr } = await supabase
    .from('daily_log_highlights')
    .select('id, log_id, area, note, boq_item_id, sort_order')
    .in('log_id', logIds)
    .order('sort_order', { ascending: true });
  if (hlErr) throw hlErr;

  const { data: photos, error: phErr } = await supabase
    .from('daily_log_photos')
    .select('id, log_id, storage_path, caption, is_featured, captured_at')
    .in('log_id', logIds)
    .eq('is_featured', true);
  if (phErr) throw phErr;

  const sortedHighlights = (highlights ?? [])
    .map((h: any) => ({ ...h, log_date: dateById.get(h.log_id) ?? '' }))
    .sort((a: any, b: any) => {
      const oa = orderIndex.get(a.log_id) ?? 0;
      const ob = orderIndex.get(b.log_id) ?? 0;
      return oa !== ob ? oa - ob : (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });

  const featuredPhotos = (photos ?? [])
    .map((p: any) => ({ ...p, log_date: dateById.get(p.log_id) ?? '' }))
    .sort((a: any, b: any) => (orderIndex.get(b.log_id) ?? 0) - (orderIndex.get(a.log_id) ?? 0)); // newest first

  return {
    highlights: sortedHighlights,
    featuredPhotos,
    weather: latest.weather ?? null,
    crewTotal: latest.crew_total ?? null,
    crewBreakdown: latest.crew_breakdown ?? null,
    safetyIncidents: rows.reduce((s: number, r: any) => s + (r.safety_incidents ?? 0), 0),
  };
}
