// workflows/components/analytics/ApprovalFlowCard.tsx
// SANO — Alur persetujuan (spec 2026-09-17 §5.3.4).
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import StackedBarChart from '../charts/StackedBarChart';
import { buildApprovalFlow, type RequestHeader } from '../../../tools/analytics/approvalFlow';
import { todayIsoWIB } from '../../../tools/timeWindow';
import { COLORS } from '../../theme';
import LoadBody from './LoadBody';
import { a } from './analyticsStyles';
import { useLoad } from './useLoad';

interface Props { loadHeaders: () => Promise<RequestHeader[]>; today?: string }

export default function ApprovalFlowCard({ loadHeaders, today = todayIsoWIB() }: Props) {
  const state = useLoad(loadHeaders);
  const flow = useMemo(() => (state.status === 'ready' ? buildApprovalFlow({ today, headers: state.data }) : null), [state.status, state.data, today]);

  return (
    <LoadBody status={state.status} error={state.error} onRetry={state.reload} label="Alur persetujuan">
      {flow && (flow.total === 0 ? (
        <Text style={a.hint}>Belum ada permintaan material untuk proyek ini.</Text>
      ) : (
        <View>
          <View style={a.tiles}>
            <View style={a.tile}><Text style={a.tileLabel}>Median ke keputusan</Text><Text style={a.tileValue}>{flow.medianDaysToDecision === null ? '—' : `${flow.medianDaysToDecision} hari`}</Text></View>
            <View style={a.tile}><Text style={a.tileLabel}>Menunggu keputusan</Text><Text style={a.tileValue}>{String(flow.pending)}</Text></View>
            <View style={a.tile}><Text style={a.tileLabel}>Tertua menunggu</Text><Text style={a.tileValue}>{flow.oldestPendingDays === null ? '—' : `${flow.oldestPendingDays} hari`}</Text></View>
            <View style={a.tile}><Text style={a.tileLabel}>Ditolak</Text><Text style={a.tileValue}>{flow.rejectedPct === null ? '—' : `${flow.rejectedPct}%`}</Text></View>
          </View>
          {flow.pending > 0 && (
            <>
              <Text style={a.subhead}>Permintaan yang menunggu, menurut umur</Text>
              <StackedBarChart
                height={130}
                labels={flow.pendingByAge.map((b) => b.label)}
                accessibilityLabel="Jumlah permintaan material yang menunggu keputusan menurut umur"
                series={[{ key: 'pending', label: 'Menunggu', color: COLORS.warning, values: flow.pendingByAge.map((b) => b.count) }]}
              />
            </>
          )}
          <Text style={a.hint}>{`Sumber: ${flow.total} permintaan material, ${flow.decided} sudah diputuskan. Hari dihitung dari tanggal permintaan dibuat sampai diputuskan.`}</Text>
        </View>
      ))}
    </LoadBody>
  );
}
