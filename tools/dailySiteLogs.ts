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
  await supabase.from('daily_log_highlights').delete().eq('log_id', log.id);
  await supabase.from('daily_log_highlights').insert(
    input.highlights.map((h, i) => ({
      log_id: log.id, area: h.area, note: h.note,
      boq_item_id: h.boq_item_id, sort_order: h.sort_order ?? i,
    })),
  );

  await supabase.from('daily_log_photos').delete().eq('log_id', log.id);
  await supabase.from('daily_log_photos').insert(
    input.photos.map((p) => ({
      log_id: log.id, storage_path: p.storage_path, caption: p.caption,
      is_featured: p.is_featured, captured_at: p.captured_at,
    })),
  );

  return log.id;
}
