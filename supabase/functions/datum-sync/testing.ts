// SANO - datum-sync: in-memory fakes for the Deno tests. Never imported by
// index.ts, so never deployed as code that runs.
//
// fakeDatum() serves DATUM's five routes from memory, behind the same
// bearer, and makes one card per SANO event. Task 8 adds FakeStore and the
// shared world.

// ─── A DATUM that answers the five routes from memory ────────────────────────

export interface FakeDatumState {
  secret: string;
  projects: Array<{ id: string; project_code: string; project_name: string }>;
  areas: Array<{ id: string; project_id: string; area_code: string; area_name: string; floor: string | null; area_type: string; sort_order: number; tracked: boolean }>;
  gates: Array<{ code: string; name: string; description: string | null; sort_order: number }>;
  statuses: Array<{ project_id: string; area_id: string; gate_code: string; status: string; stale: boolean; last_recomputed_at: string | null; updated_at: string | null }>;
  staff: Array<{ id: string; full_name: string; active: boolean }>;
  cards: Array<{ id: string; sano_event_id: string; area_id: string; author: string; slug: string }>;
  systemStaffId: string;
  /** Route path (e.g. 'areas', 'staff') to answer with this status instead. */
  failRoute: Record<string, number>;
  calls: Array<{ method: string; path: string; body: unknown }>;
}

export function fakeDatum(seed: Partial<FakeDatumState> = {}): { state: FakeDatumState; fetch: typeof fetch } {
  const state: FakeDatumState = {
    secret: 'datum-secret', projects: [], areas: [], gates: [], statuses: [], staff: [], cards: [],
    systemStaffId: 'staff-system', failRoute: {}, calls: [], ...seed,
  };
  let seq = 0;
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const route = (input: string | URL | Request, init?: RequestInit): Response => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/api\/integrations\/sano\//, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, path, body });
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== `Bearer ${state.secret}`) return reply(401, { ok: false, code: 'UNAUTHORIZED', error: 'Kunci integrasi SANO tidak cocok.' });
    if (state.failRoute[path]) return reply(state.failRoute[path], { ok: false, code: 'DB_ERROR', error: 'fake failure' });

    const projectCode = (method === 'GET' ? url.searchParams.get('project_code') : body?.project_code) ?? '';
    const project = state.projects.find((p) => p.project_code === String(projectCode).trim().toUpperCase());
    const unknown = () => reply(404, { ok: false, code: 'UNKNOWN_PROJECT', error: `Proyek DATUM dengan kode ${projectCode} tidak ada.` });

    if (path === 'staff' && method === 'GET') {
      return reply(200, { ok: true, staff: state.staff.filter((s) => s.active).map(({ id, full_name }) => ({ id, full_name })) });
    }
    if (path === 'areas' && method === 'GET') {
      if (!project) return unknown();
      const areas = state.areas.filter((a) => a.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order)
        .map(({ id, area_code, area_name, floor, area_type, sort_order }) => ({ id, area_code, area_name, floor, area_type, sort_order }));
      return reply(200, { ok: true, project, areas });
    }
    if (path === 'gate-status' && method === 'GET') {
      if (!project) return unknown();
      const statuses = state.statuses.filter((s) => s.project_id === project.id).map(({ project_id: _p, ...s }) => s);
      return reply(200, { ok: true, gates: state.gates, statuses, read_at: new Date().toISOString() });
    }
    if (path === 'areas' && method === 'POST') {
      if (!project) return unknown();
      const out: Array<{ area_code: string; id: string; created: boolean }> = [];
      for (const item of body.areas as Array<{ area_code: string; area_name: string; floor: string | null; area_type: string; tracked: boolean }>) {
        const known = state.areas.find((a) => a.project_id === project.id && a.area_code === item.area_code);
        if (known) {
          out.push({ area_code: item.area_code, id: known.id, created: false });
          continue;
        }
        seq += 1;
        const id = `area-new-${seq}`;
        const sort = Math.max(-1, ...state.areas.filter((a) => a.project_id === project.id).map((a) => a.sort_order)) + 1;
        state.areas.push({ id, project_id: project.id, ...item, sort_order: sort });
        out.push({ area_code: item.area_code, id, created: true });
      }
      return reply(200, { ok: true, areas: out, errors: [] });
    }
    if (path === 'escalate' && method === 'POST') {
      if (!project) return unknown();
      const found = state.cards.find((c) => c.sano_event_id === body.sano_event_id);
      const author = (id: string) => (id === state.systemStaffId ? 'system' : 'linked');
      if (found) {
        return reply(200, { ok: true, card_id: found.id, card_url: `https://datum.test/project/x/cards/${found.slug}`, created: false, author: author(found.author) });
      }
      seq += 1;
      const staffOk = state.staff.some((s) => s.id === body.author_staff_id && s.active);
      const card = { id: `card-${seq}`, sano_event_id: body.sano_event_id, area_id: body.area_id, author: staffOk ? body.author_staff_id : state.systemStaffId, slug: `kartu-${seq}` };
      state.cards.push(card);
      return reply(200, { ok: true, card_id: card.id, card_url: `https://datum.test/project/x/cards/${card.slug}`, created: true, author: author(card.author) });
    }
    return reply(404, { ok: false, code: 'NOT_FOUND', error: 'no route' });
  };
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => Promise.resolve(route(input, init));
  return { state, fetch: fetchImpl as typeof fetch };
}
