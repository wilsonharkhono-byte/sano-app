// SANO - Detail and Beranda-card rules (pure).

import type { DraftEventSummary } from '../../../tools/siteEvents';
import type { SiteEvent } from '../../../tools/types';

export interface DetailActions {
  canClose: boolean;
  canOpenConfirm: boolean;
}

/** routeNames: the navigator's registered routes; only the supervisor navigator has SiteEventConfirm. */
export function detailActions(ev: Pick<SiteEvent, 'status'>, routeNames: ReadonlyArray<string>): DetailActions {
  return {
    canClose: ev.status === 'open',
    canOpenConfirm: (ev.status === 'pending_analysis' || ev.status === 'draft') && routeNames.includes('SiteEventConfirm'),
  };
}

export function isOverdue(ev: Pick<SiteEvent, 'status' | 'due_date'>, today: string): boolean {
  return ev.status === 'open' && !!ev.due_date && ev.due_date < today;
}

export function voStatusText(ev: Pick<SiteEvent, 'vo_flag'>): string | null {
  if (ev.vo_flag === 'confirmed') return 'VO dikonfirmasi. Catatan Perubahan menunggu review estimator.';
  if (ev.vo_flag === 'rejected') return 'Usulan VO dari AI tidak dilanjutkan.';
  if (ev.vo_flag === 'suggested') return 'AI mengusulkan VO; belum dikonfirmasi.';
  return null;
}

export type DraftTone = 'info' | 'warning' | 'ok';

export function draftCardLine(
  item: Pick<DraftEventSummary, 'status' | 'draft_title' | 'last_error' | 'room_name'>,
): { title: string; line: string; tone: DraftTone } {
  const room = item.room_name ?? 'Ruangan';
  if (item.status === 'draft') {
    return { title: item.draft_title ?? 'Draf AI siap', line: `${room} · siap dikonfirmasi`, tone: 'ok' };
  }
  if (item.last_error) {
    return { title: 'Analisis belum berhasil', line: `${room} · ${item.last_error}`, tone: 'warning' };
  }
  return { title: 'Menunggu analisis AI', line: `${room} · sedang dianalisis`, tone: 'info' };
}
