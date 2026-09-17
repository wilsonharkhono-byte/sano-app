// tools/analytics/diaryActivity.ts
// SANO — Aktivitas lapangan (spec 2026-09-17 §5.3.3): what the daily reports
// record per week. Work mix, crew, and working days without a report. Pure.
import { addCalendarDays } from '../timeWindow';
import { weekOf, weeksBetween } from './weekBuckets';
import { workTypeOfLine, type WorkType } from './workType';

export interface DiaryReport {
  id: string;
  report_no: number;
  revision: number | null;
  /** The report's first day, YYYY-MM-DD. */
  period_start: string;
  crewTotal: number | null;
  updates: Array<{ area?: string | null; note?: string | null }>;
}

export interface DiaryWeek {
  week: string;
  reports: number;
  /** Average tukang per report that gave a crew count; null when none did. */
  crewAvg: number | null;
  /** Sum of the crew counts: tukang-days as far as the reports say. */
  crewDays: number;
  lines: number;
  linkedLines: number;
  mix: Partial<Record<WorkType, number>>;
  /** Monday to Saturday, up to today, with no report. */
  daysWithoutReport: number;
}

export interface DiaryActivity {
  weeks: string[];
  byWeek: DiaryWeek[];
  reportCount: number;
  /** Share of lines sorted by keyword rather than a confirmed link, 0–100. */
  keywordShare: number;
  /** First report date each kind of work shows up. */
  firstMentions: Map<WorkType, string>;
}

export function buildDiaryActivity(input: { today: string; reports: DiaryReport[]; links: ReadonlyMap<string, string | null> }): DiaryActivity {
  const latest = new Map<number, number>();
  for (const r of input.reports) latest.set(r.report_no, Math.max(latest.get(r.report_no) ?? 0, r.revision ?? 1));
  const reports = input.reports.filter((r) => (r.revision ?? 1) === latest.get(r.report_no)).sort((a, b) => a.period_start.localeCompare(b.period_start));
  if (reports.length === 0) return { weeks: [], byWeek: [], reportCount: 0, keywordShare: 0, firstMentions: new Map() };

  const weeks = weeksBetween(weekOf(reports[0].period_start), weekOf(reports[reports.length - 1].period_start));
  const reportDays = new Set(reports.map((r) => r.period_start));
  const firstMentions = new Map<WorkType, string>();
  let keywordLines = 0;
  let totalLines = 0;

  const byWeek = weeks.map((week): DiaryWeek => {
    const inWeek = reports.filter((r) => weekOf(r.period_start) === week);
    const crews = inWeek.map((r) => r.crewTotal).filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
    const mix: Partial<Record<WorkType, number>> = {};
    let lines = 0;
    let linkedLines = 0;
    for (const r of inWeek) {
      r.updates.forEach((u, index) => {
        const text = `${u.area ?? ''} ${u.note ?? ''}`.trim();
        if (!text) return;
        const { type, source } = workTypeOfLine(input.links.get(`${r.id}:${index}`), text);
        lines += 1;
        if (source === 'link') linkedLines += 1; else keywordLines += 1;
        if (type !== 'LAINNYA') {
          mix[type] = (mix[type] ?? 0) + 1;
          if (!firstMentions.has(type)) firstMentions.set(type, r.period_start);
        }
      });
    }
    totalLines += lines;
    let daysWithoutReport = 0;
    for (let i = 0; i < 6; i += 1) {
      const day = addCalendarDays(week, i);
      if (day >= reports[0].period_start && day <= input.today && !reportDays.has(day)) daysWithoutReport += 1;
    }
    return {
      week, reports: inWeek.length, lines, linkedLines, mix, daysWithoutReport,
      crewAvg: crews.length > 0 ? Math.round(crews.reduce((a, b) => a + b, 0) / crews.length) : null,
      crewDays: crews.reduce((a, b) => a + b, 0),
    };
  });
  return { weeks, byWeek, reportCount: reports.length, keywordShare: totalLines > 0 ? Math.round((100 * keywordLines) / totalLines) : 0, firstMentions };
}
