import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import SelectSheet from '../components/SelectSheet';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { pickAndUploadPhoto, resolvePhotoUrl } from '../../tools/storage';
import {
  assembleClientReportDraft,
  issueClientReport,
  computeWeeklyProgressDelta,
  listClientReports,
  getClientReportSnapshot,
  nextRevisionNo,
  type ClientReportDraft,
  type ClientReportPhoto,
  type IssuedClientReport,
} from '../../tools/clientReport';
import { exportClientReportPdf } from '../../tools/clientReportHtml';
import { withFreshPhotoUrls } from '../../tools/clientReportPhotos';
import ReportLinesCard from './clientReport/ReportLinesCard';
import { backlinkReports, invokeReportLink, listUnlinkedReports, type BacklinkCandidate } from '../../tools/clientReportLines';
import { formatRoomLabel } from '../../tools/clientReportRooms';
import { listRooms } from '../../tools/rooms';
import { AREA_UMUM_CODE, AREA_UMUM_NAME } from '../../tools/constants';
import type { Room } from '../../tools/types';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

function isoNDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayIso(): string { return isoNDaysAgo(0); }

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function todayShort(): string {
  const d = new Date();
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}
function fmtIssuedAt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function reportLabel(r: IssuedClientReport): string {
  const no = `#${String(r.report_no).padStart(2, '0')}`;
  const rev = r.revision > 1 ? ` · R${r.revision}` : '';
  const kind = r.kind === 'harian' ? 'Harian' : 'Mingguan';
  return `${no}${rev} · ${kind}`;
}

export default function ClientReportBuilderScreen({ onBack }: { onBack: () => void }) {
  const { project, profile, milestones, boqItems } = useProject();
  const { show: toast } = useToast();

  const [kind, setKind] = useState<'harian' | 'mingguan'>('mingguan');
  const [draft, setDraft] = useState<ClientReportDraft | null>(null);
  const [weeklyDelta, setWeeklyDelta] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Fills the per-line room picker in a room phase. Read once when the draft is
  // generated, from the same source and with the same `includeInactive` as
  // assembly, so a line re-filed here gets exactly the label assembly would
  // have stamped — a different string would open a second room head.
  const [rooms, setRooms] = useState<Room[]>([]);

  // Issued-report archive (Riwayat Laporan). Reports are immutable once
  // issued — viewing re-renders the frozen snapshot; a correction issues a
  // new revision of the same number.
  const [history, setHistory] = useState<IssuedClientReport[]>([]);
  const [viewing, setViewing] = useState<{ meta: IssuedClientReport; snapshot: ClientReportDraft } | null>(null);

  // Admin and estimator may link reports issued before Plan A (spec §8,
  // back-linking); the principal reads results and never triggers AI spend.
  const canBacklink = profile?.role === 'admin' || profile?.role === 'estimator';
  const [unlinked, setUnlinked] = useState<BacklinkCandidate[]>([]);
  const [backlinking, setBacklinking] = useState<{ done: number; total: number } | null>(null);
  const cancelBacklink = useRef(false);
  // The AI link run started right after issuing, tied to that report only:
  // its card shows a banner meanwhile, any other report's card is unaffected,
  // and the card reloads when the token moves.
  const [linkingReportId, setLinkingReportId] = useState<string | null>(null);
  const [linesToken, setLinesToken] = useState(0);

  useEffect(() => () => { cancelBacklink.current = true; }, []);

  const loadHistory = useCallback(async () => {
    if (!project) return;
    try { setHistory(await listClientReports(project.id)); } catch { /* list is non-critical */ }
    if (!canBacklink) return;
    try { setUnlinked(await listUnlinkedReports(project.id)); } catch { setUnlinked([]); }
  }, [project?.id, canBacklink]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const kindOptions = useMemo(() => ([
    { value: 'harian', label: 'Laporan Harian' },
    { value: 'mingguan', label: 'Laporan Mingguan' },
  ]), []);

  const generate = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const periodEnd = todayIso();
      const periodStart = kind === 'harian' ? periodEnd : isoNDaysAgo(6);
      const d = await assembleClientReportDraft({
        projectId: project.id,
        kind,
        periodStart,
        periodEnd,
        projectName: project.name,
        clientName: project.client_name ?? null,
        milestoneStatuses: milestones.map((m) => m.status),
        // Falls back to the database default until migration 096 is pasted:
        // select('*') on a projects row with no phase column yields undefined
        // at runtime, even though Project.phase is typed required. Same guard
        // RoomsAdminScreen.tsx:41 and RoomDetailScreen.tsx:34 use.
        phase: project.phase ?? 'STRUKTUR',
      });
      setDraft(d);
      setViewing(null);
      // Only in a room phase, and never fatal: without the list the curator
      // still edits every line, a new one simply stays under Area Umum.
      if (d.phase === 'FINISHING' || d.phase === 'SERAH_TERIMA') {
        try { setRooms(await listRooms(project.id, { includeInactive: true })); } catch { setRooms([]); }
      } else {
        setRooms([]);
      }
      toast('Draf laporan dibuat — silakan tinjau & lengkapi', 'ok');
      if (kind === 'mingguan') {
        try {
          const delta = await computeWeeklyProgressDelta(
            project.id,
            boqItems.map((b) => ({ id: b.id, planned: b.planned })),
            periodStart,
            periodEnd,
          );
          setWeeklyDelta(delta);
        } catch {
          setWeeklyDelta(null);
        }
      } else {
        setWeeklyDelta(null);
      }
    } catch (err: any) {
      toast(err.message ?? 'Gagal membuat draf', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const patch = (p: Partial<ClientReportDraft>) => setDraft((prev) => (prev ? { ...prev, ...p } : prev));

  // ── Update Lapangan editing ────────────────────────────────────────────────
  const patchUpdate = (i: number, p: Partial<{ area: string; note: string }>) => {
    if (!draft) return;
    patch({ updates: draft.updates.map((u, idx) => (idx === i ? { ...u, ...p } : u)) });
  };
  // A new line starts untagged, which files it under Area Umum; the curator
  // picks a room from the row's own picker if it belongs to one. Identical in
  // both phases — section 01 prints this list either way.
  const addUpdate = () => {
    if (!draft) return;
    patch({ updates: [...draft.updates, { date: todayShort(), area: '', note: '' }] });
  };
  const removeUpdate = (i: number) => {
    if (!draft) return;
    patch({ updates: draft.updates.filter((_, idx) => idx !== i) });
  };

  // ── Room filing (room phases only) ────────────────────────────────────────
  const roomMode = draft?.phase === 'FINISHING' || draft?.phase === 'SERAH_TERIMA';

  // The real Area Umum room already labels itself "Area Umum", so the bare
  // fallback option is offered only when the project has no such room — one
  // "Area Umum" entry either way.
  const roomOptions = useMemo(() => {
    const opts = rooms.map((r) => ({ value: r.id, code: r.room_code, label: formatRoomLabel(r) }));
    const hasUmum = rooms.some((r) => (r.room_code ?? '').toUpperCase() === AREA_UMUM_CODE);
    return hasUmum ? opts : [{ value: '', code: undefined, label: AREA_UMUM_NAME }, ...opts];
  }, [rooms]);

  /**
   * Re-file one line. The label is composed here rather than carried from the
   * draft so it matches assembly's exactly, and the gate chip is dropped: the
   * old room's chip would be wrong under the new head, and the renderer takes
   * the chip from whichever line in that room still carries one. A room with
   * no other line prints no chip, which is the honest answer — we do not know
   * its gate.
   */
  const setUpdateRoom = (i: number, roomId: string) => {
    if (!draft) return;
    const room = rooms.find((r) => r.id === roomId);
    patch({
      updates: draft.updates.map((u, idx) => (idx === i
        ? { ...u, roomId: room ? room.id : null, roomLabel: room ? formatRoomLabel(room) : null, gateLabel: null }
        : u)),
    });
  };

  // ── Dokumentasi editing ───────────────────────────────────────────────────
  // The draft stores hero + thumbs; edit them as one list where index 0 = hero.
  const photoList: ClientReportPhoto[] = draft ? (draft.hero ? [draft.hero, ...draft.thumbs] : draft.thumbs) : [];
  const setPhotoList = (list: ClientReportPhoto[]) => patch({ hero: list[0] ?? null, thumbs: list.slice(1) });

  const addPhoto = async () => {
    if (!project) return;
    try {
      const path = await pickAndUploadPhoto(`client-report/${project.id}`);
      if (!path) return;
      const url = await resolvePhotoUrl(path);
      // `path` is what survives the 7-day signed URL (spec §5.2).
      setPhotoList([...photoList, { url, path, caption: '', date: todayShort() }]);
      toast('Foto ditambahkan', 'ok');
    } catch (err: any) {
      toast(err.message ?? 'Gagal menambah foto', 'critical');
    }
  };
  const patchPhoto = (i: number, p: Partial<ClientReportPhoto>) =>
    setPhotoList(photoList.map((ph, idx) => (idx === i ? { ...ph, ...p } : ph)));
  const makeHero = (i: number) => {
    if (i === 0) return;
    const next = [...photoList];
    const [chosen] = next.splice(i, 1);
    setPhotoList([chosen, ...next]);
  };
  const removePhoto = (i: number) => setPhotoList(photoList.filter((_, idx) => idx !== i));

  // ── View / revise issued reports ─────────────────────────────────────────
  const openReport = async (meta: IssuedClientReport) => {
    try {
      const raw = await getClientReportSnapshot(meta.id);
      if (!raw) { toast('Snapshot laporan tidak ditemukan', 'critical'); return; }
      // Stored URLs expire after 7 days; re-sign from the storage path
      // (recovered from the URL on snapshots frozen before Plan A).
      const snapshot = await withFreshPhotoUrls(raw);
      setViewing({ meta, snapshot });
      setDraft(null);
    } catch (err: any) {
      toast(err.message ?? 'Gagal membuka laporan', 'critical');
    }
  };

  // Task 3.7: `viewing.meta` is whichever history row the user tapped — NOT
  // necessarily the highest revision for that report_no (a user can open an
  // older revision from Riwayat Laporan). Trusting `viewing.meta.revision +
  // 1` there could recreate a revision number that already exists. Query the
  // true max(revision) for this report_no instead.
  const startRevision = async () => {
    if (!viewing || !project) return;
    try {
      const rev = await nextRevisionNo(project.id, viewing.meta.report_no);
      setDraft({ ...viewing.snapshot, reportNo: viewing.meta.report_no, revision: rev });
      setViewing(null);
      setWeeklyDelta(null);
      toast(`Draf revisi R${rev} dari Laporan #${String(viewing.meta.report_no).padStart(2, '0')}`, 'ok');
    } catch (err: any) {
      toast(err.message ?? 'Gagal membuat revisi', 'critical');
    }
  };

  const exportPdf = async (d: ClientReportDraft) => {
    try {
      await exportClientReportPdf(await withFreshPhotoUrls(d));
    } catch (err: any) {
      toast(err.message ?? 'Gagal mencetak', 'critical');
    }
  };

  const issue = async () => {
    if (!draft || !project || !profile) return;
    setBusy(true);
    // Toast the number ACTUALLY issued (returned by issueClientReport),
    // not draft.reportNo/draft.revision — a lost numbering race + retry
    // inside issueClientReport can bump either past what the draft held,
    // and toasting the stale pre-retry value tells the user the wrong
    // report number was issued. Same return covers both the new-issue and
    // "Buat Revisi" paths.
    let result: Awaited<ReturnType<typeof issueClientReport>>;
    try {
      result = await issueClientReport(draft, project.id, profile.id);
    } catch (err: any) {
      toast(err.message ?? 'Gagal menerbitkan', 'critical');
      setBusy(false);
      return;
    }
    const issued = result;

    // The report is issued. These updates land in one batch, so the new card
    // never renders its empty "Buat tautan (AI)" state, and `busy` is released
    // exactly once: the link run below must not re-enable a button that a
    // later generate or issue has taken.
    const rev = issued.revision > 1 ? ` (R${issued.revision})` : '';
    // issueClientReport may have bumped the number after a numbering race;
    // the stored snapshot carries the real one, so the view must too.
    const issuedDraft: ClientReportDraft = { ...draft, reportNo: issued.reportNo, revision: issued.revision };
    setDraft(null);
    setViewing({
      meta: {
        id: issued.id, report_no: issued.reportNo, revision: issued.revision, kind: issuedDraft.kind,
        period_start: issuedDraft.periodStart, period_end: issuedDraft.periodEnd,
        issued_at: new Date().toISOString(), issued_by_name: profile.full_name ?? null,
      },
      snapshot: issuedDraft,
    });
    setLinkingReportId(issued.id);
    setBusy(false);
    toast(`Laporan #${String(issued.reportNo).padStart(2, '0')}${rev} diterbitkan`, 'ok');

    // Spec §6.1: suggest links right after issue. Never blocks the report —
    // the card shows a banner while this runs and offers a retry if it fails.
    // invokeReportLink and loadHistory never throw.
    try {
      await loadHistory();
      const link = await invokeReportLink(issued.id);
      if (link.ok) {
        toast(link.code === 'LINKED' ? `AI menyarankan ${link.suggested ?? 0} tautan — silakan konfirmasi` : 'Laporan terbit; tidak ada baris untuk ditautkan', 'ok');
      } else {
        toast(link.error ?? 'Tautan AI belum bisa dibuat; jalankan dari kartu Tautan Progres', 'critical');
      }
    } finally {
      // Only clear the flag if it still points at this report.
      setLinkingReportId((current) => (current === issued.id ? null : current));
      setLinesToken((t) => t + 1);
      await loadHistory();
    }
  };

  // The loop itself lives in tools/clientReportLines.ts (sequential,
  // cap-aware, stops on run-level errors); this only drives the button.
  const backlink = async () => {
    if (!project || unlinked.length === 0) return;
    cancelBacklink.current = false;
    const total = unlinked.length;
    setBacklinking({ done: 0, total });
    try {
      const res = await backlinkReports(unlinked, {
        onProgress: (done) => setBacklinking({ done, total }),
        shouldStop: () => cancelBacklink.current,
      });
      const summary = `${res.ok}/${total} laporan lama ditautkan${res.skipped > 0 ? `, ${res.skipped} sedang diproses` : ''}`;
      if (res.stoppedBy && res.stoppedBy !== 'CANCELLED') toast(`${summary} — berhenti: ${res.firstError ?? res.stoppedBy}`, 'critical');
      else if (res.failed > 0) toast(`${summary} — ${res.failed} gagal: ${res.firstError ?? ''}`, 'critical');
      else toast(summary, 'ok');
    } finally {
      setBacklinking(null);
      await loadHistory();
    }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={onBack} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={COLORS.textSec} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>
        <Text style={styles.head}>Laporan Progres Klien (Blueprint)</Text>

        <Card title="Periode">
          <Text style={styles.label}>Jenis</Text>
          <SelectSheet value={kind} options={kindOptions} onChange={(v) => setKind(v as any)} title="Jenis laporan" />
          <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={generate}>
            <Text style={styles.btnText}>{busy ? 'Memproses...' : 'Buat Draf'}</Text>
          </TouchableOpacity>
        </Card>

        {/* Riwayat Laporan — issued reports stay accessible, frozen as sent. */}
        <Card title="Riwayat Laporan" subtitle="Laporan terbit tersimpan permanen. Ketuk untuk melihat atau membuat revisi.">
          {history.length === 0 && <Text style={styles.hint}>Belum ada laporan terbit.</Text>}
          {canBacklink && unlinked.length > 0 && (
            <TouchableOpacity
              style={[styles.secondaryBtn, { alignSelf: 'flex-start', marginBottom: SPACE.sm }, backlinking && { opacity: 0.6 }]}
              disabled={!!backlinking}
              onPress={backlink}
            >
              <Ionicons name="sparkles-outline" size={16} color={COLORS.primary} />
              <Text style={styles.secondaryText}>
                {backlinking ? `Menautkan ${backlinking.done}/${backlinking.total}…` : `Tautkan laporan lama (${unlinked.length})`}
              </Text>
            </TouchableOpacity>
          )}
          {history.map((r) => (
            <TouchableOpacity key={r.id} style={styles.histRow} onPress={() => openReport(r)}>
              <Ionicons name="document-text-outline" size={18} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.histTitle}>{reportLabel(r)}</Text>
                <Text style={styles.histMeta}>
                  Terbit {fmtIssuedAt(r.issued_at)}{r.issued_by_name ? ` · ${r.issued_by_name}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textSec} />
            </TouchableOpacity>
          ))}
        </Card>

        {/* View mode: re-render the frozen snapshot; never editable in place. */}
        {viewing && (
          <>
          <Card
            title={`Laporan ${reportLabel(viewing.meta)}`}
            subtitle={`Terbit ${fmtIssuedAt(viewing.meta.issued_at)}${viewing.meta.issued_by_name ? ` oleh ${viewing.meta.issued_by_name}` : ''}. Isi terkunci sesuai yang dikirim ke klien.`}
          >
            <View style={styles.viewMetaRow}>
              <Text style={styles.viewMetaLabel}>Status</Text>
              <Text style={styles.viewMetaValue}>{viewing.snapshot.statusLabel}</Text>
            </View>
            <View style={styles.viewMetaRow}>
              <Text style={styles.viewMetaLabel}>Update Lapangan</Text>
              <Text style={styles.viewMetaValue}>{viewing.snapshot.updates.length} baris</Text>
            </View>
            <View style={styles.viewMetaRow}>
              <Text style={styles.viewMetaLabel}>Foto</Text>
              <Text style={styles.viewMetaValue}>
                {(viewing.snapshot.hero ? 1 : 0) + viewing.snapshot.thumbs.length} foto
              </Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => exportPdf(viewing.snapshot)}>
                <Ionicons name="print-outline" size={16} color={COLORS.primary} />
                <Text style={styles.secondaryText}>Cetak / PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={startRevision}>
                <Ionicons name="git-branch-outline" size={16} color={COLORS.primary} />
                <Text style={styles.secondaryText}>Buat Revisi</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={() => setViewing(null)}>
                <Text style={styles.btnText}>Tutup</Text>
              </TouchableOpacity>
            </View>
          </Card>
          <ReportLinesCard
            key={viewing.meta.id}
            reportId={viewing.meta.id}
            boqItems={boqItems}
            toast={toast}
            linking={linkingReportId === viewing.meta.id}
            reloadToken={linesToken}
            canRunAi={profile?.role !== 'principal'}
          />
          </>
        )}

        {draft && (
          <>
            {(draft.revision ?? 1) > 1 && (
              <View style={styles.revisionBanner}>
                <Ionicons name="git-branch-outline" size={14} color={COLORS.accentDark} />
                <Text style={styles.revisionText}>
                  Revisi R{draft.revision} dari Laporan #{String(draft.reportNo).padStart(2, '0')} — revisi lama tetap tersimpan.
                </Text>
              </View>
            )}

            <Card title="Lengkapi Naratif" subtitle="Isi field yang tidak bisa diambil otomatis.">
              <Text style={styles.label}>Sub-judul (mis. Finishing Interior)</Text>
              <TextInput placeholderTextColor={COLORS.textMuted} style={styles.input} value={draft.subtitle} onChangeText={(v) => patch({ subtitle: v })} placeholder="Lingkup pekerjaan" />
              <Text style={styles.label}>Klien</Text>
              <TextInput placeholderTextColor={COLORS.textMuted} style={styles.input} value={draft.clientName ?? ''} onChangeText={(v) => patch({ clientName: v })} placeholder="Nama klien" />
              <Text style={styles.label}>Cuaca</Text>
              <TextInput placeholderTextColor={COLORS.textMuted} style={styles.input} value={draft.weather ?? ''} onChangeText={(v) => patch({ weather: v })} placeholder="Cerah" />
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Tenaga Kerja (orang)</Text>
                  <TextInput placeholderTextColor={COLORS.textMuted}
                    style={styles.input}
                    keyboardType="numeric"
                    value={draft.crewTotal != null ? String(draft.crewTotal) : ''}
                    onChangeText={(v) => {
                      const n = parseInt(v, 10);
                      patch({ crewTotal: Number.isFinite(n) ? n : null });
                    }}
                    placeholder="8"
                  />
                </View>
                <View style={{ flex: 2 }}>
                  <Text style={styles.label}>Rincian Tenaga Kerja</Text>
                  <TextInput placeholderTextColor={COLORS.textMuted}
                    style={styles.input}
                    value={draft.crewBreakdown ?? ''}
                    onChangeText={(v) => patch({ crewBreakdown: v || null })}
                    placeholder="3 tukang · 2 kenek · 1 mandor"
                  />
                </View>
              </View>
              <Text style={styles.label}>Status</Text>
              <TextInput style={styles.input} value={draft.statusLabel} onChangeText={(v) => patch({ statusLabel: v })} />
              {weeklyDelta !== null && (
                <Text style={styles.deltaHint}>
                  Progres minggu ini: {weeklyDelta >= 0 ? '+' : ''}{Math.round(weeklyDelta)}% · acuan status (tidak dicetak)
                </Text>
              )}
              <Text style={styles.label}>Rencana Periode Berikutnya</Text>
              <TextInput placeholderTextColor={COLORS.textMuted} style={[styles.input, styles.textarea]} value={draft.nextPlan} onChangeText={(v) => patch({ nextPlan: v })} multiline placeholder="Rencana pekerjaan berikutnya..." />
            </Card>

            <Card
              title={`Update Lapangan (${draft.updates.length})`}
              subtitle={roomMode
                ? 'Deskripsi pekerjaan yang tampil di laporan, dikelompokkan per ruangan. Diisi otomatis dari Log Harian; bisa ditambah/diedit di sini.'
                : 'Deskripsi pekerjaan yang tampil di laporan. Diisi otomatis dari Log Harian; bisa ditambah/diedit di sini.'}
            >
              {draft.updates.map((u, i) => (
                <View key={i} style={styles.updBlock}>
                  <View style={styles.updHead}>
                    <Text style={styles.updDate}>{u.date}</Text>
                    <TouchableOpacity onPress={() => removeUpdate(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle-outline" size={18} color={COLORS.critical} />
                    </TouchableOpacity>
                  </View>
                  {roomMode && (
                    <View style={{ marginBottom: SPACE.xs + 2 }}>
                      <Text style={styles.label}>Ruangan</Text>
                      <SelectSheet
                        value={u.roomId ?? ''}
                        options={roomOptions}
                        onChange={(v) => setUpdateRoom(i, v)}
                        title="Pilih ruangan"
                        placeholder={AREA_UMUM_NAME}
                        emptyText="Belum ada ruangan pada proyek ini."
                        accessibilityLabel="Ruangan untuk update ini"
                      />
                    </View>
                  )}
                  <TextInput placeholderTextColor={COLORS.textMuted}
                    style={styles.input}
                    value={u.area}
                    onChangeText={(v) => patchUpdate(i, { area: v })}
                    placeholder="Area (mis. Tangga)"
                  />
                  <TextInput placeholderTextColor={COLORS.textMuted}
                    style={[styles.input, styles.textareaSm, { marginTop: SPACE.xs + 2 }]}
                    value={u.note}
                    onChangeText={(v) => patchUpdate(i, { note: v })}
                    multiline
                    placeholder="Deskripsi pekerjaan..."
                  />
                </View>
              ))}
              <TouchableOpacity style={styles.addRow} onPress={addUpdate}>
                <Ionicons name="add" size={16} color={COLORS.primary} />
                <Text style={styles.addText}>Tambah update</Text>
              </TouchableOpacity>
            </Card>

            <Card
              title={`Dokumentasi (${photoList.length})`}
              subtitle="Foto lapangan untuk klien. Foto pertama menjadi foto utama laporan."
            >
              {photoList.map((ph, i) => (
                <View key={`${ph.url}-${i}`} style={styles.photoRow}>
                  {ph.url ? (
                    <Image source={{ uri: ph.url }} style={styles.photoThumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.photoThumb, styles.photoThumbFallback]}>
                      <Ionicons name="image-outline" size={20} color={COLORS.textSec} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={styles.photoHead}>
                      {i === 0 ? (
                        <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>UTAMA</Text></View>
                      ) : (
                        <TouchableOpacity onPress={() => makeHero(i)}>
                          <Text style={styles.makeHeroText}>Jadikan utama</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={() => removePhoto(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle-outline" size={18} color={COLORS.critical} />
                      </TouchableOpacity>
                    </View>
                    <TextInput placeholderTextColor={COLORS.textMuted}
                      style={[styles.input, { marginTop: SPACE.xs }]}
                      value={ph.caption}
                      onChangeText={(v) => patchPhoto(i, { caption: v })}
                      placeholder="Keterangan foto..."
                    />
                  </View>
                </View>
              ))}
              <TouchableOpacity style={styles.addRow} onPress={addPhoto}>
                <Ionicons name="camera-outline" size={16} color={COLORS.primary} />
                <Text style={styles.addText}>Tambah foto lapangan</Text>
              </TouchableOpacity>
            </Card>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => exportPdf(draft)}>
                <Ionicons name="print-outline" size={16} color={COLORS.primary} />
                <Text style={styles.secondaryText}>Cetak / PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { flex: 1 }, busy && { opacity: 0.6 }]} disabled={busy} onPress={issue}>
                <Text style={styles.btnText}>Terbitkan & Simpan</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxl },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
  head: { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: SPACE.md },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: SPACE.xs + 2, marginTop: SPACE.md },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  textareaSm: { minHeight: 56, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: SPACE.md - 2 },
  btn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' },
  btnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.base, paddingHorizontal: SPACE.base },
  secondaryText: { color: COLORS.primary, fontSize: TYPE.sm, fontFamily: FONTS.semibold },
  actions: { flexDirection: 'row', gap: SPACE.md - 2, alignItems: 'center', marginTop: SPACE.md },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  deltaHint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },

  histRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md - 2, paddingVertical: SPACE.md - 2, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  histTitle: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  histMeta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },

  viewMetaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  viewMetaLabel: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  viewMetaValue: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },

  revisionBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2, backgroundColor: COLORS.accentBg, borderRadius: RADIUS, padding: SPACE.md, marginBottom: SPACE.sm },
  revisionText: { flex: 1, fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.accentDark },

  updBlock: { borderBottomWidth: 1, borderBottomColor: COLORS.borderSub, paddingBottom: SPACE.md, marginBottom: SPACE.sm },
  updHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACE.sm, marginBottom: SPACE.xs + 2 },
  updDate: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.accent },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingVertical: SPACE.sm, marginTop: SPACE.xs },
  addText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },

  photoRow: { flexDirection: 'row', gap: SPACE.md - 2, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub, alignItems: 'flex-start' },
  photoThumb: { width: 72, height: 72, borderRadius: RADIUS, backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.borderSub },
  photoThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  photoHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroBadge: { backgroundColor: COLORS.accentBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  heroBadgeText: { fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 0.8, color: COLORS.accentDark },
  makeHeroText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary },
});
