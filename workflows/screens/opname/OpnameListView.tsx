import React from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../components/Card';
import Badge from '../../components/Badge';
import DateSelectField from '../../components/DateSelectField';
import { formatRp } from '../../../tools/opname';
import { kasbonStatusLabel } from '../../../tools/kasbon';
import { COLORS, FONTS, TYPE, SPACE, RADIUS_SM } from '../../theme';
import { styles } from './opnameStyles';
import type { UseOpnameReturn } from '../../hooks/useOpname';
import type { MandorContract, OpnameHeader } from '../../../tools/opname';

interface OpnameListViewProps {
  contracts: MandorContract[];
  selectedContract: MandorContract | null;
  setSelectedContract: (contract: MandorContract | null) => void;
  opnames: OpnameHeader[];
  showCreate: boolean;
  setShowCreate: (show: boolean) => void;
  newWeek: string;
  setNewWeek: (week: string) => void;
  newDate: string;
  setNewDate: (date: string) => void;
  newPaymentType: 'borongan' | 'harian';
  setNewPaymentType: (type: 'borongan' | 'harian') => void;
  loading: boolean;
  saving: boolean;
  kasbonEntries: any[];
  attendanceTotal: number;
  showKasbonForm: boolean;
  setShowKasbonForm: (show: boolean) => void;
  kasbonFormAmount: string;
  setKasbonFormAmount: (amount: string) => void;
  kasbonFormReason: string;
  setKasbonFormReason: (reason: string) => void;
  isAdmin: boolean;
  handleCreate: () => Promise<void>;
  openOpname: (opname: OpnameHeader) => Promise<void>;
  handleRequestKasbon: () => void;
  handleSubmitKasbonForm: () => Promise<void>;
  handleApproveKasbon: (kasbon: any) => Promise<void>;
}

const STATUS_CONFIG: Record<string, { color: string; label: string; flag: string }> = {
  DRAFT:     { color: COLORS.textSec,  label: 'Draft',     flag: 'INFO' },
  SUBMITTED: { color: COLORS.info,     label: 'Diajukan',  flag: 'INFO' },
  VERIFIED:  { color: COLORS.warning,  label: 'Terverif.', flag: 'WARNING' },
  APPROVED:  { color: COLORS.ok,       label: 'Disetujui', flag: 'OK' },
  PAID:      { color: COLORS.ok,       label: 'Dibayar',   flag: 'OK' },
};

export const OpnameListView: React.FC<OpnameListViewProps> = ({
  contracts,
  selectedContract,
  setSelectedContract,
  opnames,
  showCreate,
  setShowCreate,
  newWeek,
  setNewWeek,
  newDate,
  setNewDate,
  newPaymentType,
  setNewPaymentType,
  loading,
  saving,
  kasbonEntries,
  attendanceTotal,
  showKasbonForm,
  setShowKasbonForm,
  kasbonFormAmount,
  setKasbonFormAmount,
  kasbonFormReason,
  setKasbonFormReason,
  isAdmin,
  handleCreate,
  openOpname,
  handleRequestKasbon,
  handleSubmitKasbonForm,
  handleApproveKasbon,
}) => {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.sectionHead}>Opname Mingguan</Text>

      {/* Contract selector */}
      {contracts.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.contractScroll}>
          {contracts.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.contractChip, selectedContract?.id === c.id && styles.contractChipActive]}
              onPress={() => setSelectedContract(c)}
            >
              <Text style={[styles.contractChipText, selectedContract?.id === c.id && styles.contractChipTextActive]}>
                {c.mandor_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {contracts.length === 0 && (
        <Card>
          <Text style={styles.hint}>Belum ada kontrak mandor. Setup di Laporan → Mandor terlebih dahulu.</Text>
        </Card>
      )}

      {/* Create new */}
      {selectedContract && (
        <>
          {showCreate ? (
            <Card>
              <Text style={styles.fieldLabel}>Minggu ke-</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder="e.g. 11"
                placeholderTextColor={COLORS.textMuted}
                value={newWeek}
                onChangeText={setNewWeek}
              />
              <Text style={styles.fieldLabel}>Tanggal Opname</Text>
              <DateSelectField
                value={newDate}
                onChange={setNewDate}
                placeholder="Pilih tanggal opname"
              />
              {/* Payment type selector for campuran contracts */}
              {selectedContract.payment_mode === 'campuran' && (
                <>
                  <Text style={styles.fieldLabel}>Tipe Pembayaran Minggu Ini</Text>
                  <View style={{ flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.sm }}>
                    {(['borongan', 'harian'] as const).map(pt => (
                      <TouchableOpacity
                        key={pt}
                        style={[
                          { paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
                          newPaymentType === pt && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                        ]}
                        onPress={() => setNewPaymentType(pt)}
                      >
                        <Text style={[
                          { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
                          newPaymentType === pt && { color: COLORS.textInverse },
                        ]}>
                          {pt === 'borongan' ? 'Borongan' : 'Harian'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <View style={styles.rowBtns}>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate} disabled={saving}>
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Buat Opname</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setShowCreate(false)}>
                  <Text style={styles.ghostBtnText}>Batal</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ) : (
            <TouchableOpacity style={styles.newOpnameBtn} onPress={() => setShowCreate(true)}>
              <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
              <Text style={styles.newOpnameBtnText}>Opname Minggu Baru — {selectedContract.mandor_name}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Opname list */}
      {loading && <ActivityIndicator style={{ marginTop: SPACE.xl }} color={COLORS.primary} />}

      {opnames.map(op => {
        const cfg = STATUS_CONFIG[op.status] ?? STATUS_CONFIG.DRAFT;
        return (
          <Card key={op.id} borderColor={cfg.color}>
            <TouchableOpacity onPress={() => openOpname(op)}>
              <View style={styles.opnameRow}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                    <Text style={styles.opnameTitle}>Minggu {op.week_number} — {op.mandor_name}</Text>
                    {op.payment_type === 'harian' && (
                      <View style={{ paddingHorizontal: SPACE.sm, paddingVertical: 1, borderRadius: RADIUS_SM, backgroundColor: COLORS.infoBg }}>
                        <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.info }}>HARIAN</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.hint}>{new Date(op.opname_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                </View>
                <Badge flag={cfg.flag as any} label={cfg.label} />
              </View>
              {/* Payment summary */}
              <View style={styles.paymentSummary}>
                <View style={styles.paymentItem}>
                  <Text style={styles.paymentLabel}>Gross</Text>
                  <Text style={styles.paymentValue}>{formatRp(op.gross_total)}</Text>
                </View>
                <View style={styles.paymentItem}>
                  <Text style={styles.paymentLabel}>Net minggu ini</Text>
                  <Text style={[styles.paymentValue, { color: COLORS.ok }]}>{formatRp(op.net_this_week)}</Text>
                </View>
              </View>
            </TouchableOpacity>
          </Card>
        );
      })}

      {!loading && opnames.length === 0 && selectedContract && (
        <Card><Text style={styles.hint}>Belum ada opname untuk {selectedContract.mandor_name}.</Text></Card>
      )}

      {/* Kasbon ledger */}
      {selectedContract && (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.sectionHead}>Kasbon</Text>
            {!showKasbonForm && (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.xs }}
                onPress={handleRequestKasbon}
              >
                <Ionicons name="add-circle-outline" size={16} color={COLORS.accent} />
                <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.accent }}>Ajukan</Text>
              </TouchableOpacity>
            )}
          </View>

          {showKasbonForm && (
            <View style={{ marginBottom: SPACE.sm, paddingTop: SPACE.xs, borderTopWidth: 1, borderTopColor: COLORS.borderSub }}>
              <TextInput
                style={[styles.kasbonInput, { marginBottom: SPACE.xs, minWidth: 0, width: '100%', textAlign: 'left', borderBottomColor: COLORS.primary }]}
                placeholder="Jumlah (Rp)"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={kasbonFormAmount}
                onChangeText={setKasbonFormAmount}
              />
              <TextInput
                style={[styles.kasbonInput, { marginBottom: SPACE.sm, minWidth: 0, width: '100%', textAlign: 'left', borderBottomColor: COLORS.primary }]}
                placeholder="Alasan kasbon..."
                placeholderTextColor={COLORS.textMuted}
                value={kasbonFormReason}
                onChangeText={setKasbonFormReason}
              />
              <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, backgroundColor: COLORS.primary, alignItems: 'center' }}
                  onPress={handleSubmitKasbonForm}
                  disabled={saving}
                >
                  <Text style={{ fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse }}>
                    {saving ? 'Menyimpan...' : 'Kirim'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' }}
                  onPress={() => setShowKasbonForm(false)}
                >
                  <Text style={{ fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec }}>Batal</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {kasbonEntries.length === 0 && !showKasbonForm ? (
            <Text style={styles.hint}>Belum ada kasbon untuk kontrak ini.</Text>
          ) : (
            kasbonEntries.map(k => (
              <View key={k.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text }}>
                    {formatRp(k.amount)}
                  </Text>
                  <Text style={styles.hint}>{k.kasbon_date} · {k.reason ?? '-'}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                  <Badge flag={k.status === 'SETTLED' ? 'OK' : k.status === 'APPROVED' ? 'INFO' : 'WARNING'} label={kasbonStatusLabel(k.status)} />
                  {k.status === 'REQUESTED' && isAdmin && (
                    <TouchableOpacity onPress={() => handleApproveKasbon(k)}>
                      <Ionicons name="checkmark-circle" size={22} color={COLORS.ok} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}
        </Card>
      )}
    </ScrollView>
  );
};
