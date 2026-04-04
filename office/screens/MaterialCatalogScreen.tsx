import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import Badge from '../../workflows/components/Badge';
import { useProject } from '../../workflows/hooks/useProject';
import { useToast } from '../../workflows/components/Toast';
import { sanitizeText, isPositiveNumber } from '../../tools/validation';
import { supabase } from '../../tools/supabase';
import { COLORS, FONTS, RADIUS, SPACE, TYPE, BREAKPOINTS, MAX_CONTENT_WIDTH } from '../../workflows/theme';

interface MaterialEntry {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  tier: 1 | 2 | 3;
  unit: string;
  supplier_unit: string;
  created_at: string;
}

interface PriceEntry {
  id: string;
  material_id: string;
  vendor: string;
  unit_price: number;
  recorded_at: string;
}

const TIER_LABELS: Record<number, string> = {
  1: 'Tier 1 - Precise',
  2: 'Tier 2 - Bulk',
  3: 'Tier 3 - Consumables',
};

const TIER_FLAGS = { 1: 'OK', 2: 'INFO', 3: 'WARNING' } as const;

export default function MaterialCatalogScreen() {
  const { project, profile } = useProject();
  const { show: toast } = useToast();
  const { width } = useWindowDimensions();
  const isTablet  = width >= BREAKPOINTS.tablet;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const contentMaxWidth = isDesktop ? MAX_CONTENT_WIDTH.desktop : isTablet ? MAX_CONTENT_WIDTH.tablet : undefined;

  const [materials, setMaterials] = useState<MaterialEntry[]>([]);
  const [prices, setPrices] = useState<PriceEntry[]>([]);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPriceForm, setShowPriceForm] = useState<string | null>(null); // material id

  // Add material form
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newTier, setNewTier] = useState<string>('1');
  const [newUnit, setNewUnit] = useState('');

  // Add price form
  const [priceVendor, setPriceVendor] = useState('');
  const [priceValue, setPriceValue] = useState('');

  const loadMaterials = useCallback(async () => {
    const { data } = await supabase.from('material_catalog').select('*').order('tier').order('category').order('code').order('name');
    setMaterials((data as MaterialEntry[]) ?? []);
  }, []);

  const loadPrices = useCallback(async () => {
    if (!project) return;
    const { data } = await supabase.from('price_history').select('*').eq('project_id', project.id).order('recorded_at', { ascending: false });
    setPrices((data as PriceEntry[]) ?? []);
  }, [project]);

  useEffect(() => {
    loadMaterials();
    loadPrices();
  }, [loadMaterials, loadPrices]);

  const handleAddMaterial = async () => {
    if (!newCode.trim() || !newName.trim() || !newCategory.trim() || !newUnit.trim()) {
      toast('Kode, nama, kategori, dan satuan wajib diisi', 'critical'); return;
    }
    try {
      const cleanCode = sanitizeText(newCode).toUpperCase();
      const cleanUnit = sanitizeText(newUnit);
      const { error } = await supabase.from('material_catalog').insert({
        code: cleanCode,
        name: sanitizeText(newName),
        category: sanitizeText(newCategory),
        tier: parseInt(newTier) as 1 | 2 | 3,
        unit: cleanUnit,
        supplier_unit: cleanUnit,
      });
      if (error) throw error;
      toast('Material ditambahkan', 'ok');
      setNewCode(''); setNewName(''); setNewCategory(''); setNewTier('1'); setNewUnit('');
      setShowAddForm(false);
      loadMaterials();
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const handleAddPrice = async (materialId: string) => {
    if (!priceVendor.trim() || !isPositiveNumber(priceValue)) {
      toast('Vendor dan harga wajib diisi', 'critical'); return;
    }
    if (!project) return;
    try {
      const { error } = await supabase.from('price_history').insert({
        project_id: project.id,
        material_id: materialId,
        vendor: sanitizeText(priceVendor),
        unit_price: parseFloat(priceValue),
      });
      if (error) throw error;
      toast('Harga dicatat', 'ok');
      setPriceVendor(''); setPriceValue(''); setShowPriceForm(null);
      loadPrices();
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const filtered = materials.filter(m =>
    !search || [m.code, m.name, m.category].some(value => value?.toLowerCase().includes(search.toLowerCase()))
  );

  const canEdit = profile?.role === 'admin' || profile?.role === 'estimator';

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, contentMaxWidth != null && { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth }]}>
        <Text style={styles.sectionHead}>Material Master</Text>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={COLORS.textSec} style={{ marginLeft: 12 }} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Cari material..."
            placeholderTextColor={COLORS.textSec}
          />
        </View>

        {/* Add material button */}
        {canEdit && !showAddForm && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)}>
            <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
            <Text style={styles.addBtnText}>Tambah Material Master</Text>
          </TouchableOpacity>
        )}

        {/* Add material form */}
        {showAddForm && (
          <Card title="Material Baru" borderColor={COLORS.primary}>
            <Text style={styles.label}>Kode Material *</Text>
            <TextInput style={styles.input} value={newCode} onChangeText={setNewCode} placeholder="Contoh: REB-DE16" autoCapitalize="characters" />

            <Text style={styles.label}>Nama Material *</Text>
            <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Contoh: Bata Ringan 600x200x75" />

            <Text style={styles.label}>Kategori *</Text>
            <TextInput style={styles.input} value={newCategory} onChangeText={setNewCategory} placeholder="Contoh: Struktur, Dinding, Elektrikal" />

            <Text style={styles.label}>Tier</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={newTier} onValueChange={setNewTier}>
                <Picker.Item label={TIER_LABELS[1]} value="1" />
                <Picker.Item label={TIER_LABELS[2]} value="2" />
                <Picker.Item label={TIER_LABELS[3]} value="3" />
              </Picker>
            </View>

            <Text style={styles.label}>Satuan Unit *</Text>
            <TextInput style={styles.input} value={newUnit} onChangeText={setNewUnit} placeholder="m3, kg, zak..." />
            <Text style={styles.fieldHint}>Satuan supplier otomatis mengikuti satuan unit.</Text>

            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddForm(false)}>
                <Text style={styles.cancelText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddMaterial}>
                <Text style={styles.saveBtnText}>Simpan</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {/* Material list */}
        <Text style={styles.countHint}>{filtered.length} material ditemukan</Text>
        {filtered.map(m => {
          const latestPrice = prices.filter(p => p.material_id === m.id)[0];
          const isExpanded = showPriceForm === m.id;
          return (
            <Card key={m.id}>
              <View style={styles.matHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.matName}>{m.name}</Text>
                  {!!m.code && (
                    <Text style={styles.hint}>{m.code}{m.category ? ` · ${m.category}` : ''}</Text>
                  )}
                  <Text style={styles.hint}>{m.unit} · {TIER_LABELS[m.tier]}</Text>
                </View>
                <Badge flag={TIER_FLAGS[m.tier]} label={`T${m.tier}`} />
              </View>

              {latestPrice && (
                <Text style={styles.priceTag}>
                  Rp {latestPrice.unit_price.toLocaleString('id-ID')} / {m.unit} · {latestPrice.vendor}
                </Text>
              )}

              {canEdit && (
                <TouchableOpacity style={styles.priceBtn} onPress={() => setShowPriceForm(isExpanded ? null : m.id)}>
                  <Ionicons name={isExpanded ? 'chevron-up' : 'pricetag-outline'} size={14} color={COLORS.info} />
                  <Text style={[styles.hint, { color: COLORS.info }]}>{isExpanded ? 'Tutup' : 'Catat Harga'}</Text>
                </TouchableOpacity>
              )}

              {isExpanded && (
                <View style={styles.priceForm}>
                  <View style={styles.row2}>
                    <TextInput style={[styles.input, { flex: 1 }]} value={priceVendor} onChangeText={setPriceVendor} placeholder="Nama vendor / supplier" />
                    <TextInput style={[styles.input, { flex: 1 }]} value={priceValue} onChangeText={setPriceValue} keyboardType="numeric" placeholder="Harga / unit (Rp)" />
                  </View>
                  <TouchableOpacity style={styles.saveBtn} onPress={() => handleAddPrice(m.id)}>
                    <Text style={styles.saveBtnText}>Simpan Harga</Text>
                  </TouchableOpacity>
                </View>
              )}
            </Card>
          );
        })}

        {filtered.length === 0 && (
          <Card><Text style={styles.empty}>Tidak ada material ditemukan.</Text></Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  sectionHead: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: COLORS.textSec,
    marginBottom: SPACE.md - 2,
    marginTop: SPACE.xs,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    marginBottom: SPACE.md - 2,
  },
  searchInput: {
    flex: 1,
    padding: SPACE.md,
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm - 2,
    padding: SPACE.base - 2,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    borderStyle: 'dashed',
    marginBottom: SPACE.md - 2,
    backgroundColor: COLORS.surface,
  },
  addBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  countHint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginBottom: SPACE.sm },
  matHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  matName: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text },
  priceTag: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary, marginTop: 4 },
  priceBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.sm },
  priceForm: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  fieldHint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.sm },
  empty: {
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    textAlign: 'center',
    paddingVertical: SPACE.md,
  },
  label: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.medium,
    color: COLORS.text,
    marginBottom: 6,
    marginTop: SPACE.sm + 2,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: SPACE.md,
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface, overflow: 'hidden' },
  row2: { flexDirection: 'row', gap: SPACE.md - 2 },
  formActions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.base - 2 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: SPACE.md,
    alignItems: 'center',
  },
  cancelText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveBtnText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.textInverse,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
