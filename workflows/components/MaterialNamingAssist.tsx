import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  logAIUsage,
  suggestMaterialNaming,
  type MaterialNamingAISuggestion,
} from '../../tools/ai-assist';
import {
  findCatalogMaterialSuggestions,
  normalizeMaterialNamingInput,
  type MaterialNamingCatalogEntry,
} from '../../tools/materialNaming';
import { COLORS, FONTS, RADIUS, RADIUS_SM, SPACE, TYPE } from '../theme';

const namingSuggestionCache = new Map<string, MaterialNamingAISuggestion>();

interface MaterialNamingAssistProps {
  materialName: string;
  materialId?: string | null;
  currentUnit?: string;
  catalog: MaterialNamingCatalogEntry[];
  projectId?: string;
  projectName?: string;
  projectCode?: string;
  userId?: string;
  userRole?: string;
  onSelectCatalogMaterial: (material: MaterialNamingCatalogEntry) => void | Promise<void>;
  onApplyAiSuggestion: (suggestion: MaterialNamingAISuggestion) => void | Promise<void>;
}

export default function MaterialNamingAssist({
  materialName,
  materialId,
  currentUnit,
  catalog,
  projectId,
  projectName,
  projectCode,
  userId,
  userRole,
  onSelectCatalogMaterial,
  onApplyAiSuggestion,
}: MaterialNamingAssistProps) {
  const [aiSuggestion, setAiSuggestion] = useState<MaterialNamingAISuggestion | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const normalizedName = useMemo(
    () => normalizeMaterialNamingInput(materialName),
    [materialName],
  );

  const localSuggestions = useMemo(
    () => findCatalogMaterialSuggestions(materialName, catalog, 3),
    [catalog, materialName],
  );

  const strongestLocalSuggestion = localSuggestions[0] ?? null;
  const shouldFetchAi = !materialId && normalizedName.length >= 4 && (strongestLocalSuggestion?.score ?? 0) < 0.9;
  const cacheKey = `${normalizedName}|${normalizeMaterialNamingInput(currentUnit ?? '')}`;

  useEffect(() => {
    let cancelled = false;

    if (!shouldFetchAi) {
      setAiLoading(false);
      setAiError(null);
      setAiSuggestion(null);
      return () => {
        cancelled = true;
      };
    }

    const cached = namingSuggestionCache.get(cacheKey);
    if (cached) {
      setAiSuggestion(cached);
      setAiError(null);
      setAiLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(async () => {
      setAiLoading(true);
      setAiError(null);
      try {
        const result = await suggestMaterialNaming({
          projectId,
          rawMaterialName: materialName,
          currentUnit,
          userRole,
          context: projectId ? {
            projectId,
            projectName,
            projectCode,
            userRole,
          } : undefined,
          localCatalogMatches: localSuggestions.map(suggestion => ({
            id: suggestion.entry.id,
            code: suggestion.entry.code ?? null,
            name: suggestion.entry.name,
            unit: suggestion.entry.unit,
            category: suggestion.entry.category ?? null,
            tier: suggestion.entry.tier ?? null,
            score: suggestion.score,
          })),
          model: 'haiku',
        });

        if (cancelled) return;

        namingSuggestionCache.set(cacheKey, result);
        setAiSuggestion(result);

        if (projectId && userId && userRole) {
          await logAIUsage(
            projectId,
            userId,
            'haiku',
            result.usage.input_tokens,
            result.usage.output_tokens,
            userRole,
          );
        }
      } catch (error: any) {
        if (cancelled) return;
        setAiSuggestion(null);
        setAiError(error?.message ?? 'Saran AI belum tersedia.');
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    cacheKey,
    currentUnit,
    localSuggestions,
    materialName,
    projectCode,
    projectId,
    projectName,
    shouldFetchAi,
    userId,
    userRole,
    refreshTick,
  ]);

  const existingCatalogTarget = aiSuggestion?.existing_catalog_id
    ? catalog.find(material => material.id === aiSuggestion.existing_catalog_id) ?? null
    : null;

  if (materialId || normalizedName.length < 3) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Ionicons name="sparkles-outline" size={15} color={COLORS.primary} />
        <Text style={styles.title}>Saran standarisasi material</Text>
      </View>
      <Text style={styles.note}>
        Gunakan katalog bila ada yang cocok. AI hanya memberi usulan nama baku dan kode material baru, tidak mengubah data otomatis.
      </Text>

      {localSuggestions.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Paling mirip di katalog</Text>
          {localSuggestions.map(suggestion => (
            <TouchableOpacity
              key={suggestion.entry.id}
              style={styles.catalogChip}
              onPress={() => void onSelectCatalogMaterial(suggestion.entry)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.catalogCode}>
                  {suggestion.entry.code ?? 'NO-CODE'} · {Math.round(suggestion.score * 100)}% mirip
                </Text>
                <Text style={styles.catalogName}>{suggestion.entry.name}</Text>
                <Text style={styles.catalogMeta}>
                  {suggestion.entry.unit}
                  {suggestion.entry.category ? ` · ${suggestion.entry.category}` : ''}
                  {suggestion.entry.tier ? ` · Tier ${suggestion.entry.tier}` : ''}
                </Text>
              </View>
              <Ionicons name="arrow-forward-circle-outline" size={18} color={COLORS.primary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {shouldFetchAi && (
        <View style={styles.block}>
          <View style={styles.aiHeaderRow}>
            <Text style={styles.blockTitle}>Usulan AI untuk penamaan</Text>
            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={() => {
                namingSuggestionCache.delete(cacheKey);
                setRefreshTick(value => value + 1);
              }}
            >
              <Ionicons name="refresh" size={14} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          {aiLoading ? (
            <View style={styles.aiLoadingRow}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.aiLoadingText}>AI sedang menyiapkan nama baku dan kode material...</Text>
            </View>
          ) : aiSuggestion ? (
            <View style={styles.aiCard}>
              <Text style={styles.aiSummary}>{aiSuggestion.summary}</Text>
              <View style={styles.aiMetaGrid}>
                <Text style={styles.aiMetaLabel}>Kode usulan</Text>
                <Text style={styles.aiMetaValue}>{aiSuggestion.suggested_code}</Text>
                <Text style={styles.aiMetaLabel}>Nama baku</Text>
                <Text style={styles.aiMetaValue}>{aiSuggestion.suggested_name}</Text>
                <Text style={styles.aiMetaLabel}>Kategori</Text>
                <Text style={styles.aiMetaValue}>{aiSuggestion.suggested_category || '—'}</Text>
                <Text style={styles.aiMetaLabel}>Tier</Text>
                <Text style={styles.aiMetaValue}>Tier {aiSuggestion.suggested_tier}</Text>
                <Text style={styles.aiMetaLabel}>Unit</Text>
                <Text style={styles.aiMetaValue}>{aiSuggestion.suggested_unit || '—'}</Text>
                <Text style={styles.aiMetaLabel}>Confidence</Text>
                <Text style={styles.aiMetaValue}>{aiSuggestion.confidence.toUpperCase()}</Text>
              </View>
              {aiSuggestion.note ? (
                <Text style={styles.aiNote}>{aiSuggestion.note}</Text>
              ) : null}
              <Text style={styles.aiFootnote}>
                Jika material ini perlu kontrol envelope, harga, atau reuse lintas proyek, estimator tetap perlu menambahkannya ke katalog memakai usulan AI ini.
              </Text>

              {existingCatalogTarget ? (
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => void onSelectCatalogMaterial(existingCatalogTarget)}
                >
                  <Text style={styles.primaryBtnText}>
                    Pakai Katalog {existingCatalogTarget.code ?? existingCatalogTarget.name}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => void onApplyAiSuggestion(aiSuggestion)}
                >
                  <Text style={styles.primaryBtnText}>Pakai Nama AI</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : aiError ? (
            <Text style={styles.aiError}>{aiError}</Text>
          ) : (
            <Text style={styles.aiIdleText}>AI belum perlu dipanggil karena nama sudah cukup dekat dengan katalog.</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: SPACE.sm,
    padding: SPACE.md,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
    backgroundColor: COLORS.primary + '09',
    gap: SPACE.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
  },
  title: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    color: COLORS.text,
  },
  note: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    lineHeight: 18,
    color: COLORS.textSec,
  },
  block: {
    gap: SPACE.xs,
  },
  blockTitle: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    color: COLORS.textSec,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  catalogChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS_SM,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  catalogCode: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    color: COLORS.primary,
  },
  catalogName: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.medium,
    color: COLORS.text,
    marginTop: 2,
  },
  catalogMeta: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  aiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refreshBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
  },
  aiLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.xs,
  },
  aiLoadingText: {
    flex: 1,
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
  },
  aiCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS_SM,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    padding: SPACE.md,
    gap: SPACE.sm,
  },
  aiSummary: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.medium,
    color: COLORS.text,
    lineHeight: 20,
  },
  aiMetaGrid: {
    gap: 3,
  },
  aiMetaLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    color: COLORS.textSec,
    marginTop: 2,
  },
  aiMetaValue: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  aiNote: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    lineHeight: 18,
  },
  aiFootnote: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  primaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS_SM,
    paddingVertical: SPACE.sm,
  },
  primaryBtnText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    color: COLORS.textInverse,
  },
  aiError: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.critical,
    lineHeight: 18,
  },
  aiIdleText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
  },
});
