import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../components/Card';
import { formatRp } from '../../../tools/opname';
import type { OpnameHeader } from '../../../tools/opname';
import { COLORS, FONTS, TYPE, SPACE } from '../../theme';
import { styles } from './opnameStyles';

interface OpnameActionButtonsProps {
  activeOpname: OpnameHeader;
  canDraftEditRole: boolean;
  isEstimator: boolean;
  isAdmin: boolean;
  role: string | null;
  saving: boolean;
  exporting: boolean;
  showApproveConfirm: boolean;
  setShowApproveConfirm: (show: boolean) => void;
  kasbonInput: string;
  paymentReference: string;
  setPaymentReference: (ref: string) => void;
  harianAllocationSummary: any;
  linesLength: number;
  handleSubmit: () => Promise<void>;
  handleVerify: () => Promise<void>;
  handleApprove: () => void;
  handleApproveConfirmed: () => Promise<void>;
  handleExport: () => Promise<void>;
  handleConfirmPayment: () => void;
  handleConfirmPaymentSubmit: () => Promise<void>;
}

export const OpnameActionButtons: React.FC<OpnameActionButtonsProps> = ({
  activeOpname,
  canDraftEditRole,
  isEstimator,
  isAdmin,
  role,
  saving,
  exporting,
  showApproveConfirm,
  setShowApproveConfirm,
  kasbonInput,
  paymentReference,
  setPaymentReference,
  harianAllocationSummary,
  linesLength,
  handleSubmit,
  handleVerify,
  handleApprove,
  handleApproveConfirmed,
  handleExport,
  handleConfirmPayment,
  handleConfirmPaymentSubmit,
}) => {
  return (
    <View style={styles.actionGroup}>
      {activeOpname.status === 'DRAFT' && canDraftEditRole && (
        <TouchableOpacity
          style={[styles.primaryBtn, (saving || (activeOpname.payment_type !== 'harian' && linesLength === 0)) && styles.disabledBtn]}
          onPress={handleSubmit}
          disabled={saving || (activeOpname.payment_type !== 'harian' && linesLength === 0)}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.primaryBtnText}>
                {role === 'supervisor' ? 'Ajukan ke Estimator' : 'Kirim Draft Opname'}
              </Text>}
        </TouchableOpacity>
      )}
      {activeOpname.status === 'SUBMITTED' && isEstimator && (
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            { backgroundColor: COLORS.warning },
            activeOpname.payment_type === 'harian' && harianAllocationSummary.remainingPct > 0.05 && styles.disabledBtn,
          ]}
          onPress={handleVerify}
          disabled={saving || (activeOpname.payment_type === 'harian' && harianAllocationSummary.remainingPct > 0.05)}
        >
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Verifikasi & Teruskan ke Admin</Text>}
        </TouchableOpacity>
      )}
      {activeOpname.status === 'VERIFIED' && isAdmin && !showApproveConfirm && (
        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.ok }]} onPress={handleApprove} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Setujui Pembayaran</Text>}
        </TouchableOpacity>
      )}
      {activeOpname.status === 'VERIFIED' && isAdmin && showApproveConfirm && (
        <Card borderColor={COLORS.ok}>
          <Text style={[styles.sectionHead, { marginTop: 0 }]}>Konfirmasi Persetujuan</Text>
          <Text style={styles.hint}>
            Kasbon: {formatRp(parseFloat(kasbonInput.replace(/[^\d.]/g, '')) || 0)} · Net bayar: {formatRp(Math.max(0, (activeOpname.net_this_week ?? 0) - (parseFloat(kasbonInput.replace(/[^\d.]/g, '')) || 0)))}
          </Text>
          <View style={styles.rowBtns}>
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.ok }]} onPress={handleApproveConfirmed} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Ya, Setujui</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setShowApproveConfirm(false)}>
              <Text style={styles.ghostBtnText}>Batal</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}
      {(activeOpname.status === 'APPROVED' || activeOpname.status === 'PAID') && isAdmin && (
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: COLORS.info }]}
          onPress={handleExport}
          disabled={exporting}
        >
          {exporting
            ? <ActivityIndicator size="small" color="#fff" />
            : <>
                <Ionicons name="download-outline" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>Export Excel Opname</Text>
              </>
          }
        </TouchableOpacity>
      )}
      {activeOpname.status === 'APPROVED' && isAdmin && !showApproveConfirm && (
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: COLORS.ok, marginTop: SPACE.sm }]}
          onPress={handleConfirmPayment}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <>
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>Konfirmasi Pembayaran</Text>
              </>
          }
        </TouchableOpacity>
      )}
      {activeOpname.status === 'APPROVED' && isAdmin && showApproveConfirm && (
        <Card borderColor={COLORS.ok}>
          <Text style={[styles.sectionHead, { marginTop: 0 }]}>Konfirmasi Pembayaran</Text>
          <Text style={styles.hint}>Jumlah: {formatRp(activeOpname.net_this_week)}</Text>
          <TextInput
            style={[styles.input, { marginTop: SPACE.sm }]}
            placeholder="No. referensi transfer (opsional)"
            placeholderTextColor={COLORS.textMuted}
            value={paymentReference}
            onChangeText={setPaymentReference}
          />
          <View style={styles.rowBtns}>
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.ok }]} onPress={handleConfirmPaymentSubmit} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Konfirmasi PAID</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setShowApproveConfirm(false)}>
              <Text style={styles.ghostBtnText}>Batal</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}
    </View>
  );
};
