import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  Animated, Dimensions, StatusBar, ScrollView,
} from 'react-native';
import { signIn, signUp } from '../../tools/auth';
import { COLORS, FONTS, TYPE, SPACE } from '../theme';

const { height: SH } = Dimensions.get('window');

// ── Brand panel height ──────────────────────────────────────────────────────
// Scales with screen height but stays between comfortable bounds.
const PANEL_H = Math.max(260, Math.min(SH * 0.44, 340));

export default function LoginScreen() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [focused,  setFocused]  = useState<string | null>(null);

  // ── Entrance animations ───────────────────────────────────────────────────
  const panelY  = useRef(new Animated.Value(-16)).current;
  const panelOp = useRef(new Animated.Value(0)).current;
  const formY   = useRef(new Animated.Value(20)).current;
  const formOp  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(panelY,  { toValue: 0, duration: 480, useNativeDriver: true }),
        Animated.timing(panelOp, { toValue: 1, duration: 480, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(formY,  { toValue: 0, duration: 360, useNativeDriver: true }),
        Animated.timing(formOp, { toValue: 1, duration: 360, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  // ── Sign-up name field slide-in ───────────────────────────────────────────
  const nameH = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(nameH, {
      toValue: isSignUp ? 1 : 0,
      duration: 260,
      useNativeDriver: false, // layout prop — cannot use native driver
    }).start();
  }, [isSignUp]);

  // ── Auth handlers ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Kolom wajib', 'Email dan password wajib diisi.');
      return;
    }
    if (isSignUp && !fullName.trim()) {
      Alert.alert('Kolom wajib', 'Nama lengkap wajib diisi.');
      return;
    }
    setLoading(true);
    try {
      if (isSignUp) {
        await signUp(email.trim(), password, fullName.trim());
        Alert.alert('Akun dibuat', 'Silakan cek email untuk verifikasi.');
      } else {
        await signIn(email.trim(), password);
      }
    } catch (err: any) {
      Alert.alert('Gagal masuk', err.message ?? 'Terjadi kesalahan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => setIsSignUp(v => !v);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
      <View style={styles.root}>

        {/* ── Brand panel — deep warm-black, architectural ── */}
        <Animated.View
          style={[
            styles.panel,
            { opacity: panelOp, transform: [{ translateY: panelY }] },
          ]}
        >
          {/* Corner mark — two sand lines, top-left geometric detail */}
          <View style={styles.cornerMark} pointerEvents="none">
            <View style={styles.cornerLineL} />
            <View style={styles.cornerLineS} />
          </View>

          {/* Monumental wordmark */}
          <Text
            style={styles.wordmark}
            accessibilityRole="header"
            accessibilityLabel="SANO — Structured Approval Network and Operations"
          >
            SANO
          </Text>

          {/* Acronym — spaced, architectural */}
          <Text style={styles.acronym} accessibilityElementsHidden>
            STRUCTURED APPROVAL{'\n'}NETWORK & OPERATIONS
          </Text>

          {/* Tagline with sand accent bar */}
          <View style={styles.taglineRow}>
            <View style={styles.taglineBar} />
            <Text style={styles.tagline}>
              Operasi lapangan, persetujuan,{'\n'}dan kontrol proyek.
            </Text>
          </View>
        </Animated.View>

        {/* ── 3-point accent stripe ── */}
        <View style={styles.accentStripe} />

        {/* ── Form area — warm near-white ── */}
        <KeyboardAvoidingView
          style={styles.formOuter}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              style={[
                styles.formInner,
                { opacity: formOp, transform: [{ translateY: formY }] },
              ]}
            >
              {/* Name field — slides in for sign-up */}
              <Animated.View
                style={{
                  maxHeight: nameH.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 84],
                  }),
                  opacity: nameH,
                  overflow: 'hidden',
                }}
              >
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>NAMA LENGKAP</Text>
                  <TextInput
                    style={[styles.input, focused === 'name' && styles.inputFocused]}
                    placeholder="Nama lengkap Anda"
                    value={fullName}
                    onChangeText={setFullName}
                    autoCapitalize="words"
                    placeholderTextColor={COLORS.textMuted}
                    onFocus={() => setFocused('name')}
                    onBlur={() => setFocused(null)}
                    accessibilityLabel="Nama lengkap"
                    accessibilityHint="Masukkan nama lengkap Anda"
                  />
                </View>
              </Animated.View>

              {/* Email */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>EMAIL</Text>
                <TextInput
                  style={[styles.input, focused === 'email' && styles.inputFocused]}
                  placeholder="nama@perusahaan.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  placeholderTextColor={COLORS.textMuted}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                  accessibilityLabel="Alamat email"
                  accessibilityHint="Masukkan alamat email akun Anda"
                />
              </View>

              {/* Password */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>PASSWORD</Text>
                <TextInput
                  style={[styles.input, focused === 'pw' && styles.inputFocused]}
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  placeholderTextColor={COLORS.textMuted}
                  onFocus={() => setFocused('pw')}
                  onBlur={() => setFocused(null)}
                  accessibilityLabel="Password"
                  accessibilityHint="Masukkan password akun Anda"
                />
              </View>

              {/* Submit */}
              <TouchableOpacity
                style={[styles.btn, loading && styles.btnBusy]}
                onPress={handleSubmit}
                disabled={loading}
                accessibilityLabel={isSignUp ? 'Buat akun baru' : 'Masuk ke akun'}
                accessibilityRole="button"
                accessibilityState={{ disabled: loading, busy: loading }}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={COLORS.accent} />
                ) : (
                  <Text style={styles.btnText}>
                    {isSignUp ? 'DAFTAR' : 'MASUK'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Toggle sign-in / sign-up */}
              <TouchableOpacity
                onPress={toggleMode}
                style={styles.toggle}
                accessibilityLabel={
                  isSignUp ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'
                }
                accessibilityRole="button"
              >
                <Text style={styles.toggleText}>
                  {isSignUp ? 'Sudah punya akun?  ' : 'Belum punya akun?  '}
                  <Text style={styles.toggleLink}>
                    {isSignUp ? 'Masuk' : 'Daftar'}
                  </Text>
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>

      </View>
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },

  // ── Brand panel ────────────────────────────────────────────────────────

  panel: {
    height: PANEL_H,
    backgroundColor: COLORS.primary,   // #141210 — deep warm near-black
    paddingTop: 52,
    paddingBottom: 32,
    paddingHorizontal: SPACE.xl,
    justifyContent: 'flex-end',
  },

  // Geometric corner mark — two horizontal lines, top-left
  cornerMark: {
    position: 'absolute',
    top: 50,
    left: SPACE.xl,
    gap: 5,
  },
  cornerLineL: {
    width: 32,
    height: 2.5,
    backgroundColor: COLORS.accent,    // #B29F86 — sand
  },
  cornerLineS: {
    width: 16,
    height: 2.5,
    backgroundColor: COLORS.accent,
    opacity: 0.55,
  },

  // Monumental wordmark — the hero moment
  wordmark: {
    fontSize: 76,
    fontFamily: FONTS.bold,
    color: COLORS.accent,              // sand on dark — premium architectural feel
    letterSpacing: 10,
    lineHeight: 82,
    includeFontPadding: false,
    marginBottom: 6,
  },

  // Acronym — spaced micro text
  acronym: {
    fontSize: 8,
    fontFamily: FONTS.medium,
    color: '#5C5650',                  // warm mid-gray, legible on dark
    letterSpacing: 2,
    lineHeight: 14,
    marginBottom: SPACE.base,
  },

  // Tagline row — left accent bar + body text
  taglineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  taglineBar: {
    width: 2,
    height: 36,                        // matches two lines of tagline
    backgroundColor: COLORS.accent,
    opacity: 0.5,
    marginTop: 2,
  },
  tagline: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: '#7A746E',                  // warm lighter gray
    lineHeight: 20,
    flex: 1,
  },

  // ── Accent stripe ──────────────────────────────────────────────────────

  accentStripe: {
    height: 3,
    backgroundColor: COLORS.accent,   // sand divider — sharp, precise
  },

  // ── Form area ──────────────────────────────────────────────────────────

  formOuter: {
    flex: 1,
    backgroundColor: COLORS.surface,  // #FDFAF6 — warm near-white
  },
  scrollContent: {
    flexGrow: 1,
  },
  formInner: {
    paddingHorizontal: SPACE.xl,
    paddingTop: SPACE.xl,
    paddingBottom: SPACE.xxl,
    gap: SPACE.base,
  },

  // ── Field groups ───────────────────────────────────────────────────────

  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 9,
    fontFamily: FONTS.bold,
    color: COLORS.textSec,
    letterSpacing: 2,                  // spaced caps — architectural
  },

  // Underline-style input — editorial, not generic box
  input: {
    backgroundColor: 'transparent',
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.border,
    paddingVertical: SPACE.sm + 2,
    paddingHorizontal: 0,
    fontSize: TYPE.md,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  inputFocused: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary, // snaps to near-black on focus
  },

  // ── Submit button ──────────────────────────────────────────────────────

  btn: {
    backgroundColor: COLORS.primary,  // near-black
    borderRadius: 2,                   // sharp — architectural, not bubbly
    paddingVertical: SPACE.base,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: SPACE.sm,
  },
  btnBusy: {
    opacity: 0.6,
  },
  btnText: {
    color: COLORS.accent,              // sand — echoes the wordmark
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    letterSpacing: 4,                  // wide-spaced caps = commanding
  },

  // ── Toggle ─────────────────────────────────────────────────────────────

  toggle: {
    alignItems: 'center',
    paddingVertical: SPACE.sm,
    marginTop: SPACE.xs,
  },
  toggleText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
  },
  toggleLink: {
    fontFamily: FONTS.semibold,
    color: COLORS.text,
    textDecorationLine: 'underline',
  },
});
