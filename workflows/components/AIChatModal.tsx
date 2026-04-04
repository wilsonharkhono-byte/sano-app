// SANO — Asisten SANO Chat Modal
// In-app AI assistant powered by Anthropic Claude.
// Read-only: cannot create, modify, or delete any project data.
// Always responds in Bahasa Indonesia.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  askSanoAI,
  logAIUsage,
  type AIChatMessage,
  type AIModel,
  type ProjectAIContext,
  AI_MODEL_LABELS,
} from '../../tools/ai-assist';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, RADIUS_LG } from '../theme';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  projectId?: string;
  userId?: string;
  userRole?: string;
  context?: ProjectAIContext;
}

// ── Quick-suggestion chips shown in empty state ───────────────────────────────

const QUICK_QUESTIONS: string[] = [
  'Bagaimana cara mengajukan permintaan material?',
  'Apa arti status AUTO_HOLD?',
  'Bagaimana alur opname mandor?',
  'Apa saja jenis laporan yang tersedia?',
  'Kapan proyek eligible serah terima?',
];

interface MessageSegment {
  text: string;
  bold: boolean;
}

function parseMessageSegments(line: string, assistant: boolean): MessageSegment[] {
  const explicitBold = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  if (explicitBold.some(segment => /^\*\*[^*]+\*\*$/.test(segment))) {
    return explicitBold.map(segment => ({
      text: /^\*\*[^*]+\*\*$/.test(segment) ? segment.slice(2, -2) : segment,
      bold: /^\*\*[^*]+\*\*$/.test(segment),
    }));
  }

  if (assistant) {
    const trimmed = line.trim();
    const isListLine = /^([-*•]\s+|\d+\.\s+)/.test(trimmed);
    const leadInMatch = trimmed.match(/^([^:]{2,36}:)\s+(.+)$/);
    if (!isListLine && leadInMatch) {
      return [
        { text: `${leadInMatch[1]} `, bold: true },
        { text: leadInMatch[2], bold: false },
      ];
    }
  }

  return [{ text: line, bold: false }];
}

function isHierarchyLine(line: string, index: number, assistant: boolean): boolean {
  if (!assistant) return false;

  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^([-*•]\s+|\d+\.\s+)/.test(trimmed)) return false;
  if (/^\*\*[^*]+\*\*$/.test(trimmed)) return true;
  if (/^[A-ZÀ-ÿ][^.!?]{2,52}:$/.test(trimmed)) return true;
  if (index === 0 && trimmed.length <= 44 && !/[.!?]$/.test(trimmed)) return true;

  return false;
}

function FormattedMessage({
  content,
  role,
}: {
  content: string;
  role: AIChatMessage['role'];
}) {
  const assistant = role === 'assistant';
  const lines = content.split('\n');

  return (
    <View style={styles.messageBody}>
      {lines.map((line, index) => {
        if (!line.trim()) return <View key={`space-${index}`} style={styles.messageSpacer} />;

        const segments = parseMessageSegments(line, assistant);
        const strongLine = isHierarchyLine(line, index, assistant);

        return (
          <Text
            key={`line-${index}`}
            style={[
              styles.bubbleText,
              assistant ? styles.bubbleTextAssistant : styles.bubbleTextUser,
              assistant && strongLine && styles.bubbleTextAssistantStrong,
            ]}
          >
            {segments.map((segment, segmentIndex) => (
              <Text
                key={`segment-${index}-${segmentIndex}`}
                style={
                  segment.bold
                    ? assistant
                      ? styles.inlineStrongAssistant
                      : styles.inlineStrongUser
                    : undefined
                }
              >
                {segment.text}
              </Text>
            ))}
          </Text>
        );
      })}
    </View>
  );
}

// ── Animated typing dots ─────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  'Membaca data proyek...',
  'Menyusun jawaban...',
  'Menganalisis konteks...',
  'Memeriksa informasi...',
];

function TypingDots() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 350, useNativeDriver: true }),
        ]),
      );
    const anim = Animated.parallel([pulse(dot1, 0), pulse(dot2, 150), pulse(dot3, 300)]);
    anim.start();

    const interval = setInterval(() => {
      setMsgIndex(prev => (prev + 1) % LOADING_MESSAGES.length);
    }, 2800);

    return () => { anim.stop(); clearInterval(interval); };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.typingRow}>
      <View style={styles.dotsRow}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View key={i} style={[styles.dot, { opacity: dot, backgroundColor: COLORS.accent }]} />
        ))}
      </View>
      <Text style={styles.typingText}>{LOADING_MESSAGES[msgIndex]}</Text>
    </View>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AIChatModal({
  visible,
  onClose,
  projectId,
  userId,
  userRole,
  context,
}: Props) {
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<AIModel>('haiku');
  const [totalTokens, setTotalTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Scroll to bottom whenever messages change
  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const handleSend = useCallback(async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    setInput('');
    setError(null);

    const userMsg: AIChatMessage = { role: 'user', content: question };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);
    scrollToBottom();

    try {
      const res = await askSanoAI(next, model, context, projectId);

      const assistantMsg: AIChatMessage = { role: 'assistant', content: res.reply };
      setMessages(prev => [...prev, assistantMsg]);
      setTotalTokens(prev => prev + res.usage.input_tokens + res.usage.output_tokens);
      scrollToBottom();

      // Fire-and-forget usage log
      if (projectId && userId && userRole) {
        logAIUsage(projectId, userId, model, res.usage.input_tokens, res.usage.output_tokens, userRole);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Terjadi kesalahan. Silakan coba lagi.');
      // Remove the optimistic user message so they can retry
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, model, context, projectId, userId, userRole, scrollToBottom]);

  const handleClear = useCallback(() => {
    setMessages([]);
    setTotalTokens(0);
    setError(null);
  }, []);

  const toggleModel = useCallback(() => {
    setModel(prev => prev === 'haiku' ? 'sonnet' : 'haiku');
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Backdrop sits behind the sheet, full screen */}
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />

        {/* KAV wraps only the sheet so keyboard pushes it up correctly */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 10}
        >

        <View style={styles.sheet}>
          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.logoMark}>
                <Ionicons name="sparkles" size={14} color={COLORS.accent} />
              </View>
              <View>
                <Text style={styles.headerTitle}>Asisten SANO</Text>
                <Text style={styles.headerSub}>Hanya membaca data · Tidak bisa ubah data</Text>
              </View>
            </View>
            <View style={styles.headerRight}>
              {messages.length > 0 && (
                <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
                  <Ionicons name="refresh" size={14} color={COLORS.textSec} />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Ionicons name="close" size={18} color={COLORS.text} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Resource warning ── */}
          <View style={styles.warningBar}>
            <Ionicons name="alert-circle-outline" size={13} color={COLORS.warning} />
            <Text style={styles.warningText}>
              Asisten AI menggunakan sumber daya — gunakan secukupnya untuk pertanyaan penting.
              {totalTokens > 0 ? ` (${totalTokens.toLocaleString('id-ID')} token terpakai sesi ini)` : ''}
            </Text>
          </View>

          {/* ── Model switcher ── */}
          <View style={styles.modelRow}>
            <Text style={styles.modelLabel}>Model:</Text>
            <TouchableOpacity style={styles.modelToggle} onPress={toggleModel}>
              <View style={[styles.modelPill, model === 'haiku' && styles.modelPillActive]}>
                <Text style={[styles.modelPillText, model === 'haiku' && styles.modelPillTextActive]}>
                  {AI_MODEL_LABELS.haiku}
                </Text>
              </View>
              <View style={[styles.modelPill, model === 'sonnet' && styles.modelPillActive]}>
                <Text style={[styles.modelPillText, model === 'sonnet' && styles.modelPillTextActive]}>
                  {AI_MODEL_LABELS.sonnet}
                </Text>
              </View>
            </TouchableOpacity>
            {model === 'sonnet' && (
              <Text style={styles.sonnetNote}>⚡ Lebih lambat, lebih cermat</Text>
            )}
          </View>

          {/* ── Messages ── */}
          <ScrollView
            ref={scrollRef}
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="chatbubbles-outline" size={32} color={COLORS.accent} />
                </View>
                <Text style={styles.emptyTitle}>Ada yang bisa dibantu?</Text>
                <Text style={styles.emptyHint}>
                  Tanyakan cara penggunaan aplikasi atau status proyek.{'\n'}
                  Asisten tidak bisa mengubah data apapun.
                </Text>
                <View style={styles.chips}>
                  {QUICK_QUESTIONS.map((q, i) => (
                    <TouchableOpacity
                      key={i}
                      style={styles.chip}
                      onPress={() => handleSend(q)}
                    >
                      <Text style={styles.chipText}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              messages.map((msg, i) => (
                <View
                  key={i}
                  style={[
                    styles.bubble,
                    msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                  ]}
                >
                  {msg.role === 'assistant' && (
                    <View style={styles.assistantLabel}>
                      <Ionicons name="sparkles" size={10} color={COLORS.accent} />
                      <Text style={styles.assistantLabelText}>Asisten SANO</Text>
                    </View>
                  )}
                  <FormattedMessage content={msg.content} role={msg.role} />
                </View>
              ))
            )}

            {/* Loading bubble */}
            {loading && (
              <View style={[styles.bubble, styles.bubbleAssistant]}>
                <View style={styles.assistantLabel}>
                  <Ionicons name="sparkles" size={10} color={COLORS.accent} />
                  <Text style={styles.assistantLabelText}>Asisten SANO</Text>
                </View>
                <TypingDots />
              </View>
            )}

            {/* Error */}
            {error && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={14} color={COLORS.critical} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>

          {/* ── Input bar ── */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Ketik pertanyaan tentang SANO..."
              placeholderTextColor={COLORS.textSec}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={600}
              editable={!loading}
              onSubmitEditing={() => handleSend()}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
              onPress={() => handleSend()}
              disabled={!input.trim() || loading}
            >
              <Ionicons
                name="send"
                size={16}
                color={!input.trim() || loading ? COLORS.textSec : COLORS.textInverse}
              />
            </TouchableOpacity>
          </View>

          {/* ── Disclaimer ── */}
          <Text style={styles.disclaimer}>
            Asisten AI bisa keliru. Selalu verifikasi data penting langsung di aplikasi.
          </Text>
        </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const SCREEN_H   = Dimensions.get('window').height;
const SAFE_BOTTOM = Platform.OS === 'ios' ? 34 : 0;

const styles = StyleSheet.create({
  // Outer container — fills screen, positions sheet at bottom
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.40)',
  },

  sheet: {
    height: SCREEN_H * 0.87,        // explicit height so flex:1 children work
    maxHeight: SCREEN_H * 0.87,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    paddingBottom: SAFE_BOTTOM,      // respect iPhone home-bar area
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.base,
    paddingTop: SPACE.base,
    paddingBottom: SPACE.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  logoMark: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(178,159,134,0.19)',
  },
  headerTitle: {
    fontSize: TYPE.base,
    fontFamily: FONTS.bold,
    color: COLORS.text,
  },
  headerSub: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: 1,
  },
  clearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Resource warning bar
  warningBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.xs,
    backgroundColor: COLORS.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(230,81,0,0.15)',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
  },
  warningText: {
    flex: 1,
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.accentDark,
    lineHeight: 16,
  },

  // Model switcher
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  modelLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.textSec,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modelToggle: {
    flexDirection: 'row',
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  modelPill: {
    paddingHorizontal: SPACE.sm + 2,
    paddingVertical: 5,
    backgroundColor: 'transparent',
  },
  modelPillActive: {
    backgroundColor: COLORS.primary,
  },
  modelPillText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.textSec,
  },
  modelPillTextActive: {
    color: COLORS.textInverse,
  },
  sonnetNote: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.info,
  },

  // Messages — flex:1 fills remaining height inside the sheet after fixed chrome
  messages: { flex: 1 },
  messagesContent: { padding: SPACE.base, gap: SPACE.sm },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: SPACE.xl, paddingBottom: SPACE.md },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACE.md,
  },
  emptyTitle: {
    fontSize: TYPE.lg,
    fontFamily: FONTS.bold,
    color: COLORS.text,
    marginBottom: SPACE.xs,
  },
  emptyHint: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: SPACE.lg,
    paddingHorizontal: SPACE.base,
  },
  chips: { width: '100%', gap: SPACE.sm - 2 },
  chip: {
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accent,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md - 2,
    backgroundColor: COLORS.surface,
  },
  chipText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.medium,
    color: COLORS.text,
    lineHeight: 18,
  },

  // Chat bubbles
  bubble: {
    maxWidth: '88%',
    borderRadius: RADIUS_LG,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: RADIUS - 4,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    borderBottomLeftRadius: RADIUS - 4,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accent,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
    maxWidth: '92%',
  },
  assistantLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    marginBottom: SPACE.sm - 2,
  },
  assistantLabelText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    color: COLORS.accent,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  bubbleText: {
    fontSize: TYPE.sm,
    lineHeight: 20,
  },
  messageBody: {
    gap: 4,
  },
  messageSpacer: {
    height: 6,
  },
  bubbleTextUser: {
    fontFamily: FONTS.regular,
    color: COLORS.textInverse,
  },
  bubbleTextAssistant: {
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  bubbleTextAssistantStrong: {
    fontFamily: FONTS.bold,
    color: COLORS.accentDark,
    letterSpacing: 0.2,
  },
  inlineStrongAssistant: {
    fontFamily: FONTS.bold,
    color: COLORS.accentDark,
  },
  inlineStrongUser: {
    fontFamily: FONTS.bold,
    color: COLORS.textInverse,
  },

  // Loading — animated dots
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  dotsRow: { flexDirection: 'row', gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  typingText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.medium,
    color: COLORS.textSec,
    fontStyle: 'italic',
  },

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.xs,
    backgroundColor: COLORS.criticalBg,
    borderRadius: RADIUS,
    padding: SPACE.sm,
  },
  errorText: {
    flex: 1,
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.critical,
    lineHeight: 18,
  },

  // Input bar
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.base,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSub,
    backgroundColor: COLORS.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    backgroundColor: COLORS.surfaceAlt,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // Disclaimer
  disclaimer: {
    fontSize: TYPE.xs,  // was TYPE.xs-1 (10dp) — below mobile legibility floor
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    textAlign: 'center',
    paddingHorizontal: SPACE.base,
    paddingBottom: SPACE.sm,
    paddingTop: SPACE.xs,
    opacity: 0.7,
  },
});
