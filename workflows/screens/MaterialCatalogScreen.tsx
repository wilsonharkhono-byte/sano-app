import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card   from '../components/Card';
import Badge  from '../components/Badge';
import { useProject } from '../hooks/useProject';
import { useToast }   from '../components/Toast';
import { supabase }   from '../../tools/supabase';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, RADIUS_SM } from '../theme';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CatalogMaterial {
  id: string;
  code: string;
  name: string;
  category: string | null;
  tier: 1 | 2 | 3;
  unit: string;
  supplier_unit: string;
}

interface MaterialAlias {
  id: string;
  material_id: string;
  alias: string;
  created_at: string;
}

type ViewMode = 'catalog' | 'detail';

const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Tier 1 — Presisi',
  2: 'Tier 2 — Bulk',
  3: 'Tier 3 — Habis Pakai',
};

const TIER_COLORS: Record<1 | 2 | 3, { bg: string; text: string }> = {
  1: { bg: COLORS.infoBg,     text: COLORS.info },
  2: { bg: COLORS.warningBg,  text: COLORS.warning },
  3: { bg: COLORS.okBg,       text: COLORS.ok },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function MaterialCatalogScreen({ onBack }: { onBack: () => void }) {
  const { profile } = useProject();
  const { show: toast } = useToast();

  const [view, setView] = useState<ViewMode>('catalog');
  const [materials, setMaterials] = useState<CatalogMaterial[]>([]);
  const [aliases, setAliases] = useState<MaterialAlias[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterTier, setFilterTier] = useState<1 | 2 | 3 | null>(null);

  // Detail view state
  const [selectedMaterial, setSelectedMaterial] = useState<CatalogMaterial | null>(null);
  const [materialAliases, setMaterialAliases] = useState<MaterialAlias[]>([]);
  const [newAlias, setNewAlias] = useState('');
  const [saving, setSaving] = useState(false);

  const isEstimator = profile?.role === 'estimator' || profile?.role === 'admin';

  // ─── Fetch catalog ──────────────────────────────────────────────────────

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    const [matRes, aliasRes] = await Promise.all([
      supabase.from('material_catalog').select('*').order('code'),
      supabase.from('material_aliases').select('*').order('alias'),
    ]);

    if (matRes.data) setMaterials(matRes.data as CatalogMaterial[]);
    if (aliasRes.data) setAliases(aliasRes.data as MaterialAlias[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

  // ─── Filtered list ──────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = materials;
    if (filterTier) list = list.filter(m => m.tier === filterTier);
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchingAliasIds = new Set(
        aliases.filter(a => a.alias.toLowerCase().includes(q)).map(a => a.material_id)
      );
      list = list.filter(
        m => m.name.toLowerCase().includes(q)
          || (m.code && m.code.toLowerCase().includes(q))
          || matchingAliasIds.has(m.id)
      );
    }
    return list;
  }, [materials, aliases, search, filterTier]);

  // ─── Alias count per material ───────────────────────────────────────────

  const aliasCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of aliases) {
      map.set(a.material_id, (map.get(a.material_id) ?? 0) + 1);
    }
    return map;
  }, [aliases]);

  // ─── Open detail ────────────────────────────────────────────────────────

  const openDetail = useCallback((mat: CatalogMaterial) => {
    setSelectedMaterial(mat);
    setMaterialAliases(aliases.filter(a => a.material_id === mat.id));
    setNewAlias('');
    setView('detail');
  }, [aliases]);

  // ─── Add alias ──────────────────────────────────────────────────────────

  const addAlias = useCallback(async () => {
    if (!selectedMaterial || !newAlias.trim()) return;

    const trimmed = newAlias.trim();
    const exists = materialAliases.some(a => a.alias.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      toast('Alias ini sudah ada', 'warning');
      return;
    }

    setSaving(true);
    const { data, error } = await supabase
      .from('material_aliases')
      .insert({ material_id: selectedMaterial.id, alias: trimmed })
      .select()
      .single();

    if (error) {
      toast(`Gagal menambah alias: ${error.message}`, 'critical');
    } else if (data) {
      const newEntry = data as MaterialAlias;
      setMaterialAliases(prev => [...prev, newEntry]);
      setAliases(prev => [...prev, newEntry]);
      setNewAlias('');
      toast('Alias ditambahkan', 'ok');
    }
    setSaving(false);
  }, [selectedMaterial, newAlias, materialAliases, toast]);

  // ─── Remove alias ──────────────────────────────────────────────────────

  const removeAlias = useCallback(async (aliasId: string) => {
    Alert.alert('Hapus Alias', 'Yakin ingin menghapus alias ini?', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('material_aliases').delete().eq('id', aliasId);
          if (error) {
            toast(`Gagal menghapus: ${error.message}`, 'critical');
          } else {
            setMaterialAliases(prev => prev.filter(a => a.id !== aliasId));
            setAliases(prev => prev.filter(a => a.id !== aliasId));
            toast('Alias dihapus', 'ok');
          }
        },
      },
    ]);
  }, [toast]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.flex, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Memuat katalog material...</Text>
      </View>
    );
  }

  // ── Detail View ────────────────────────────────────────────────────────

  if (view === 'detail' && selectedMaterial) {
    const tierInfo = TIER_COLORS[selectedMaterial.tier];

    return (
      <View style={styles.flex}>
        <Header />
        <TouchableOpacity style={styles.backBtn} onPress={() => setView('catalog')}>
          <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
          <Text style={styles.backText}>Katalog</Text>
        </TouchableOpacity>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {/* Material info */}
          <Card>
            <View style={styles.detailHeader}>
              <Text style={styles.detailCode}>{selectedMaterial.code}</Text>
              <View style={[styles.tierPill, { backgroundColor: tierInfo.bg }]}>
                <Text style={[styles.tierText, { color: tierInfo.text }]}>
                  {TIER_LABELS[selectedMaterial.tier]}
                </Text>
              </View>
            </View>
            <Text style={styles.detailName}>{selectedMaterial.name}</Text>
            <View style={styles.detailMeta}>
              <Text style={styles.detailMetaItem}>Satuan: {selectedMaterial.unit}</Text>
              {selectedMaterial.supplier_unit && selectedMaterial.supplier_unit !== selectedMaterial.unit && (
                <Text style={styles.detailMetaItem}>Satuan supplier: {selectedMaterial.supplier_unit}</Text>
              )}
              {selectedMaterial.category && (
                <Text style={styles.detailMetaItem}>Kategori: {selectedMaterial.category}</Text>
              )}
            </View>
          </Card>

          {/* Alias management */}
          <Text style={styles.sectionHead}>
            Alias ({materialAliases.length})
          </Text>
          <Text style={styles.aliasHint}>
            Alias membantu parser mengenali nama material dari berbagai format BoQ Excel.
          </Text>

          {materialAliases.map(a => (
            <View key={a.id} style={styles.aliasRow}>
              <Ionicons name="link-outline" size={16} color={COLORS.textSec} />
              <Text style={styles.aliasText}>{a.alias}</Text>
              {isEstimator && (
                <TouchableOpacity onPress={() => removeAlias(a.id)} style={styles.aliasRemove}>
                  <Ionicons name="close-circle" size={18} color={COLORS.critical} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {materialAliases.length === 0 && (
            <Text style={styles.emptyText}>Belum ada alias untuk material ini.</Text>
          )}

          {/* Add alias */}
          {isEstimator && (
            <View style={styles.addAliasBox}>
              <TextInput
                style={styles.input}
                placeholder="Tambah alias baru..."
                placeholderTextColor={COLORS.textMuted}
                value={newAlias}
                onChangeText={setNewAlias}
                onSubmitEditing={addAlias}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[styles.addBtn, (!newAlias.trim() || saving) && styles.addBtnDisabled]}
                onPress={addAlias}
                disabled={!newAlias.trim() || saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color={COLORS.textInverse} />
                  : <Ionicons name="add" size={20} color={COLORS.textInverse} />
                }
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Catalog List View ──────────────────────────────────────────────────

  return (
    <View style={styles.flex}>
      <Header />
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
        <Text style={styles.backText}>Kembali</Text>
      </TouchableOpacity>

      {/* Search */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={COLORS.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari material atau alias..."
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={COLORS.textSec} />
          </TouchableOpacity>
        )}
      </View>

      {/* Tier filters */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, !filterTier && styles.filterChipActive]}
          onPress={() => setFilterTier(null)}
        >
          <Text style={[styles.filterText, !filterTier && styles.filterTextActive]}>Semua</Text>
        </TouchableOpacity>
        {([1, 2, 3] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.filterChip, filterTier === t && styles.filterChipActive]}
            onPress={() => setFilterTier(filterTier === t ? null : t)}
          >
            <Text style={[styles.filterText, filterTier === t && styles.filterTextActive]}>
              T{t}
            </Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.countText}>{filtered.length} material</Text>
      </View>

      {/* Material list */}
      <FlatList
        data={filtered}
        keyExtractor={m => m.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item: mat }) => {
          const aliasCount = aliasCountMap.get(mat.id) ?? 0;
          const tierInfo = TIER_COLORS[mat.tier];
          return (
            <TouchableOpacity style={styles.matCard} onPress={() => openDetail(mat)}>
              <View style={styles.matCardTop}>
                <Text style={styles.matCode}>{mat.code}</Text>
                <View style={[styles.tierDot, { backgroundColor: tierInfo.text }]} />
                <Text style={[styles.tierLabel, { color: tierInfo.text }]}>T{mat.tier}</Text>
                {aliasCount > 0 && (
                  <View style={styles.aliasCountBadge}>
                    <Ionicons name="link-outline" size={12} color={COLORS.textSec} />
                    <Text style={styles.aliasCountText}>{aliasCount}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} style={styles.chevron} />
              </View>
              <Text style={styles.matName} numberOfLines={1}>{mat.name}</Text>
              <Text style={styles.matUnit}>{mat.unit}</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>
              {search ? 'Tidak ditemukan material yang cocok.' : 'Katalog material kosong.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  center:  { alignItems: 'center', justifyContent: 'center' },

  loadingText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: SPACE.md,
  },

  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
  },
  backText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.primary,
  },

  sectionHead: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: COLORS.textSec,
    marginBottom: SPACE.sm,
    marginTop: SPACE.lg,
  },

  // Search
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    marginHorizontal: SPACE.base,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm + 2,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    fontSize: TYPE.md,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    paddingVertical: 0,
  },

  // Filters
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
  },
  filterChip: {
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs + 1,
    borderRadius: RADIUS_SM,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.textSec,
  },
  filterTextActive: {
    color: COLORS.textInverse,
  },
  countText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    marginLeft: 'auto',
  },

  // List
  listContent: {
    paddingHorizontal: SPACE.base,
    paddingBottom: SPACE.xxxl,
  },
  matCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
    padding: SPACE.md,
    marginBottom: SPACE.sm,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
  },
  matCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    marginBottom: SPACE.xs,
  },
  matCode: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    color: COLORS.textSec,
    letterSpacing: 0.5,
  },
  tierDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tierLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
  },
  aliasCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: SPACE.xs,
  },
  aliasCountText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
  },
  chevron: {
    marginLeft: 'auto',
  },
  matName: {
    fontSize: TYPE.base,
    fontFamily: FONTS.medium,
    color: COLORS.text,
    marginBottom: 2,
  },
  matUnit: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
  },

  // Detail
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACE.xs,
  },
  detailCode: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    color: COLORS.textSec,
    letterSpacing: 0.5,
  },
  tierPill: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: 3,
    borderRadius: RADIUS_SM,
  },
  tierText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.3,
  },
  detailName: {
    fontSize: TYPE.lg,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
    marginBottom: SPACE.sm,
  },
  detailMeta: {
    gap: SPACE.xs,
  },
  detailMetaItem: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
  },

  // Aliases
  aliasHint: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    marginBottom: SPACE.md,
    lineHeight: 17,
  },
  aliasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.sm + 2,
    paddingHorizontal: SPACE.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS_SM,
    marginBottom: SPACE.xs,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
  },
  aliasText: {
    flex: 1,
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  aliasRemove: {
    padding: SPACE.xs,
  },
  addAliasBox: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginTop: SPACE.md,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingVertical: SPACE.md - 1,
    paddingHorizontal: SPACE.md,
    fontSize: TYPE.md,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: COLORS.textMuted,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SPACE.xxxl,
    gap: SPACE.md,
  },
  emptyText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
