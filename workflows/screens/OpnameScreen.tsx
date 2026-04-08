/**
 * OpnameScreen
 *
 * Weekly progress payment workflow:
 *   DRAFT     → Supervisor/estimator/admin prepares claim percentages
 *   SUBMITTED → Submitted for estimator verification
 *   VERIFIED  → Estimator adjusted %s, flagged TDK ACC lines
 *   APPROVED  → Admin confirmed kasbon, released payment
 *   PAID      → Excel export generated, opname closed
 *
 * Roles:
 *   supervisor — proposes progress claim percentages
 *   estimator  — can prepare draft, verify, adjust % and flag TDK ACC
 *   admin      — approves (sets kasbon, releases)
 */

import React, { useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Badge from '../components/Badge';
import { useOpname } from '../hooks/useOpname';
import { recomputeHarianOpname } from '../../tools/workerAttendance';
import { OpnameListView } from './opname/OpnameListView';
import { HarianDetailSection } from './opname/HarianDetailSection';
import { BoronganLinesSection } from './opname/BoronganLinesSection';
import { OpnameActionButtons } from './opname/OpnameActionButtons';
import { styles } from './opname/opnameStyles';
import { COLORS } from '../theme';

const STATUS_CONFIG: Record<string, { color: string; label: string; flag: string }> = {
  DRAFT:     { color: COLORS.textSec,  label: 'Draft',     flag: 'INFO' },
  SUBMITTED: { color: COLORS.info,     label: 'Diajukan',  flag: 'INFO' },
  VERIFIED:  { color: COLORS.warning,  label: 'Terverif.', flag: 'WARNING' },
  APPROVED:  { color: COLORS.ok,       label: 'Disetujui', flag: 'OK' },
  PAID:      { color: COLORS.ok,       label: 'Dibayar',   flag: 'OK' },
};

export default function OpnameScreen({
  onBack,
  initialContractId,
}: {
  onBack: () => void;
  initialContractId?: string;
}) {
  const opname = useOpname({ onBack, initialContractId });

  return (
    <View style={styles.flex}>
      <Header />

      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
        <Text style={styles.backText}>{opname.view === 'list' ? 'Kembali' : 'Daftar Opname'}</Text>
      </TouchableOpacity>

      {/* LIST VIEW */}
      {opname.view === 'list' && (
        <OpnameListView
          contracts={opname.contracts}
          selectedContract={opname.selectedContract}
          setSelectedContract={opname.setSelectedContract}
          opnames={opname.opnames}
          showCreate={opname.showCreate}
          setShowCreate={opname.setShowCreate}
          newWeek={opname.newWeek}
          setNewWeek={opname.setNewWeek}
          newDate={opname.newDate}
          setNewDate={opname.setNewDate}
          newPaymentType={opname.newPaymentType}
          setNewPaymentType={opname.setNewPaymentType}
          loading={opname.loading}
          saving={opname.saving}
          kasbonEntries={opname.kasbonEntries}
          attendanceTotal={opname.attendanceTotal}
          showKasbonForm={opname.showKasbonForm}
          setShowKasbonForm={opname.setShowKasbonForm}
          kasbonFormAmount={opname.kasbonFormAmount}
          setKasbonFormAmount={opname.setKasbonFormAmount}
          kasbonFormReason={opname.kasbonFormReason}
          setKasbonFormReason={opname.setKasbonFormReason}
          isAdmin={opname.isAdmin}
          handleCreate={opname.handleCreate}
          openOpname={opname.openOpname}
          handleRequestKasbon={opname.handleRequestKasbon}
          handleSubmitKasbonForm={opname.handleSubmitKasbonForm}
          handleApproveKasbon={opname.handleApproveKasbon}
        />
      )}

      {/* LINES/DETAIL VIEW */}
      {opname.view === 'lines' && opname.activeOpname && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.sectionHead}>
            Minggu {opname.activeOpname.week_number} — {opname.activeOpname.mandor_name}
          </Text>

          {/* Status badge */}
          <View style={styles.statusRow}>
            <Badge flag={STATUS_CONFIG[opname.activeOpname.status]?.flag as any} label={STATUS_CONFIG[opname.activeOpname.status]?.label} />
            <Text style={styles.opnameDate}>
              {new Date(opname.activeOpname.opname_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>

          {opname.loading && <ActivityIndicator style={{ marginTop: 24 }} color={COLORS.primary} />}

          {/* Harian section */}
          {opname.activeOpname.payment_type === 'harian' && (
            <HarianDetailSection
              activeOpname={opname.activeOpname}
              harianEntries={opname.harianEntries}
              harianAllocations={opname.harianAllocations}
              harianAllocationCandidates={opname.harianAllocationCandidates}
              allocationInputs={opname.allocationInputs}
              showAddAllocation={opname.showAddAllocation}
              setShowAddAllocation={opname.setShowAddAllocation}
              addAllocationScope={opname.addAllocationScope}
              setAddAllocationScope={opname.setAddAllocationScope}
              addAllocationBoqItemId={opname.addAllocationBoqItemId}
              setAddAllocationBoqItemId={opname.setAddAllocationBoqItemId}
              addAllocationPct={opname.addAllocationPct}
              setAddAllocationPct={opname.setAddAllocationPct}
              addAllocationAmount={opname.addAllocationAmount}
              setAddAllocationAmount={opname.setAddAllocationAmount}
              addSupervisorNote={opname.addSupervisorNote}
              setAddSupervisorNote={opname.setAddSupervisorNote}
              addEstimatorNote={opname.addEstimatorNote}
              setAddEstimatorNote={opname.setAddEstimatorNote}
              aiAllocating={opname.aiAllocating}
              aiAllocationSummary={opname.aiAllocationSummary}
              savingAllocationId={opname.savingAllocationId}
              deletingAllocationId={opname.deletingAllocationId}
              harianAllocationSummary={opname.harianAllocationSummary}
              addAllocationPreviewPct={opname.addAllocationPreviewPct}
              canEditHarianAllocation={opname.canEditHarianAllocation}
              canEditEstimatorAllocationNote={opname.canEditEstimatorAllocationNote}
              isEstimator={opname.isEstimator}
              loading={opname.loading}
              handleAllocationInputChange={opname.handleAllocationInputChange}
              handleAllocationSave={opname.handleAllocationSave}
              handleDeleteAllocationRow={opname.handleDeleteAllocationRow}
              handleUseAiSuggestion={opname.handleUseAiSuggestion}
              handleAddAllocation={opname.handleAddAllocation}
              handleGenerateAiAllocation={opname.handleGenerateAiAllocation}
              resetHarianAllocationForm={opname.resetHarianAllocationForm}
              refreshActiveOpname={async () => {
                // This is handled internally by the hook - just a placeholder
              }}
              loadHarianDetail={async () => {
                // This is handled internally by the hook - just a placeholder
              }}
              toast={opname.toast}
            />
          )}

          {/* Borongan section */}
          {opname.activeOpname.payment_type !== 'harian' && (
            <BoronganLinesSection
              activeOpname={opname.activeOpname}
              lines={opname.lines}
              progressFlags={opname.progressFlags}
              lineInputs={opname.lineInputs}
              previewLines={opname.previewLines}
              previewGrossTotal={opname.previewGrossTotal}
              previewRetentionAmount={opname.previewRetentionAmount}
              previewNetToDate={opname.previewNetToDate}
              previewKasbon={opname.previewKasbon}
              previewNetThisWeek={opname.previewNetThisWeek}
              kasbonInput={opname.kasbonInput}
              setKasbonInput={opname.setKasbonInput}
              attendanceTotal={opname.attendanceTotal}
              canDraftEditRole={opname.canDraftEditRole}
              isEstimator={opname.isEstimator}
              isAdmin={opname.isAdmin}
              canImportProgress={opname.canImportProgress}
              tdkAccLineId={opname.tdkAccLineId}
              setTdkAccLineId={opname.setTdkAccLineId}
              tdkAccReason={opname.tdkAccReason}
              setTdkAccReason={opname.setTdkAccReason}
              importingProgress={opname.importingProgress}
              exportingTemplate={opname.exportingTemplate}
              verifyNotes={opname.verifyNotes}
              setVerifyNotes={opname.setVerifyNotes}
              handleLineInputText={opname.handleLineInputText}
              handleLineCommit={opname.handleLineCommit}
              handleTdkAcc={opname.handleTdkAcc}
              handleTdkAccSubmit={opname.handleTdkAccSubmit}
              handleImportProgress={opname.handleImportProgress}
              handleDownloadProgressTemplate={opname.handleDownloadProgressTemplate}
            />
          )}

          {/* Action buttons */}
          <OpnameActionButtons
            activeOpname={opname.activeOpname}
            canDraftEditRole={opname.canDraftEditRole}
            isEstimator={opname.isEstimator}
            isAdmin={opname.isAdmin}
            role={opname.role}
            saving={opname.saving}
            exporting={opname.exporting}
            showApproveConfirm={opname.showApproveConfirm}
            setShowApproveConfirm={opname.setShowApproveConfirm}
            kasbonInput={opname.kasbonInput}
            paymentReference={opname.paymentReference}
            setPaymentReference={opname.setPaymentReference}
            harianAllocationSummary={opname.harianAllocationSummary}
            linesLength={opname.lines.length}
            handleSubmit={opname.handleSubmit}
            handleVerify={opname.handleVerify}
            handleApprove={opname.handleApprove}
            handleApproveConfirmed={opname.handleApproveConfirmed}
            handleExport={opname.handleExport}
            handleConfirmPayment={opname.handleConfirmPayment}
            handleConfirmPaymentSubmit={opname.handleConfirmPaymentSubmit}
          />
        </ScrollView>
      )}
    </View>
  );
}
