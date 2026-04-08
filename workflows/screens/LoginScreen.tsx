import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  Animated, Dimensions, StatusBar, ScrollView, Easing,
} from 'react-native';
import { signIn, signUp } from '../../tools/auth';
import { SanoLogo } from '../components/SanoBrand';
import { COLORS, FONTS, TYPE, SPACE } from '../theme';

const { height: SH } = Dimensions.get('window');

// ── Brand panel height ──────────────────────────────────────────────────────
const PANEL_H = Math.max(280, Math.min(SH * 0.44, 350));

// ── Main screen ──────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [focused,  setFocused]  = useState<string | null>(null);

  // ── Entrance animations ───────────────────────────────────────────────────
  // Four independent tracks fire in parallel with staggered delays:
  //   0 ms  — panel slides down
  // 200 ms  — typographic logo materialises (scale + opacity)
  // 560 ms  — acronym + tagline fade in
  // 340 ms  — form rises from below
  const panelY    = useRef(new Animated.Value(-20)).current;
  const panelOp   = useRef(new Animated.Value(0)).current;
  const logoOp    = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.92)).current;
  const detailOp  = useRef(new Animated.Value(0)).current;
  const formY     = useRef(new Animated.Value(24)).current;
  const formOp    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);

    Animated.parallel([
      // 1 — Panel
      Animated.parallel([
        Animated.timing(panelY,  { toValue: 0, duration: 520, easing: ease, useNativeDriver: true }),
        Animated.timing(panelOp, { toValue: 1, duration: 520, easing: ease, useNativeDriver: true }),
      ]),
      // 2 — Logo materialises
      Animated.sequence([
        Animated.delay(200),
        Animated.parallel([
          Animated.timing(logoOp,    { toValue: 1, duration: 500, easing: ease, useNativeDriver: true }),
          Animated.timing(logoScale, { toValue: 1, duration: 500, easing: ease, useNativeDriver: true }),
        ]),
      ]),
      // 3 — Acronym + tagline
      Animated.sequence([
        Animated.delay(560),
        Animated.timing(detailOp, { toValue: 1, duration: 300, easing: ease, useNativeDriver: true }),
      ]),
      // 4 — Form (rises from below, starts while logo is still animating)
      Animated.sequence([
        Animated.delay(340),
        Animated.parallel([
          Animated.timing(formOp, { toValue: 1, duration: 480, easing: ease, useNativeDriver: true }),
          Animated.timing(formY,  { toValue: 0, duration: 480, easing: ease, useNativeDriver: true }),
        ]),
      ]),
    ]).start();
  }, []);

  // ── Sign-up name field slide-in ───────────────────────────────────────────
  const nameH = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(nameH, {
      toValue: isSignUp ? 1 : 0,
      duration: 260,
      useNativeDriver: false, // animates layout (maxHeight)
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan. Coba lagi.';
      Alert.alert('Gagal masuk', msg);
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

        {/* ── Brand panel — deep warm-black ── */}
        <Animated.View
          style={[
            styles.panel,
            { opacity: panelOp, transform: [{ translateY: panelY }] },
          ]}
        >
          {/* Corner mark — geometric detail, top-left */}
          <View style={styles.cornerMark} pointerEvents="none">
            <View style={styles.cornerLineL} />
            <View style={styles.cornerLineS} />
          </View>

          {/* ── Logo cluster — typographic mark → descriptor ── */}
          <View style={styles.logoGroup}>

            {/* Typographic SANO logo — the hero moment */}
            <Animated.View
              style={{
                opacity: logoOp,
                transform: [{ scale: logoScale }],
                marginBottom: 14,
              }}
            >
              <SanoLogo width={220} color={COLORS.accent} />
            </Animated.View>

            {/* Acronym + tagline — fade in after logo settles */}
            <Animated.View style={{ opacity: detailOp }}>
              <Text style={styles.acronym} accessibilityElementsHidden>
                STRUCTURED APPROVAL · NETWORK & OPERATIONS
              </Text>
              <View style={styles.taglineRow}>
                <View style={styles.taglineBar} />
                <Text style={styles.tagline}>
                  Operasi lapangan, persetujuan,{'\n'}dan kontrol proyek.
                </Text>
              </View>
            </Animated.View>

          </View>
        </Animated.View>

        {/* ── Accent stripe ── */}
        <View style={styles.accentStripe} />

        {/* ── Form area — warm near-white ── */}
        <KeyboardAvoidingView
          style={styles.formOuter}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                    outputRange: [0, 92],
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

              {/* Toggle sign-in / sign-up — only in dev; production is invite-only */}
              {__DEV__ && (
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
              )}
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

  // ── Brand panel ─────────────────────────────────────────────────────────

  panel: {
    height: PANEL_H,
    backgroundColor: COLORS.primary,   // #141210 — deep warm near-black
    paddingTop: 52,
    paddingBottom: 28,
    paddingHorizontal: SPACE.xl,
    justifyContent: 'flex-end',        // logo cluster anchored to bottom
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
    backgroundColor: COLORS.accent,
  },
  cornerLineS: {
    width: 16,
    height: 2.5,
    backgroundColor: COLORS.accent,
    opacity: 0.55,
  },

  // Logo cluster — typographic logo + descriptor
  logoGroup: {
    gap: 0,
  },

  // Acronym — single spaced line with center-dot separator
  acronym: {
    fontSize: 9,
    fontFamily: FONTS.medium,
    color: '#5C5650',
    letterSpacing: 2,
    lineHeight: 14,
    marginBottom: SPACE.sm + 2,
  },

  // Tagline row — left accent bar + descriptive copy
  taglineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  taglineBar: {
    width: 2,
    height: 36,
    backgroundColor: COLORS.accent,
    opacity: 0.5,
    marginTop: 2,
  },
  tagline: {
    fontSize: TYPE.base,               // 15 — comfortable on mobile
    fontFamily: FONTS.regular,
    color: '#7A746E',
    lineHeight: 22,
    flex: 1,
  },

  // ── Accent stripe ──────────────────────────────────────────────────────

  accentStripe: {
    height: 3,
    backgroundColor: COLORS.accent,
  },

  // ── Form area ──────────────────────────────────────────────────────────

  formOuter: {
    flex: 1,
    backgroundColor: COLORS.surface,  // #FDFAF6
  },
  scrollContent: {
    flexGrow: 1,
  },
  formInner: {
    paddingHorizontal: SPACE.xl,
    paddingTop: SPACE.xl + 4,          // 28 — generous top spacing
    paddingBottom: SPACE.xxl,
    gap: SPACE.lg,                     // 20 — roomier gaps between fields
  },

  // ── Field groups ───────────────────────────────────────────────────────

  fieldGroup: {
    gap: 8,                            // was 6 — more room label → input
  },
  fieldLabel: {
    fontSize: 11,                      // was 9 — readable on mobile
    fontFamily: FONTS.bold,
    color: COLORS.textSec,
    letterSpacing: 2,
  },

  // Underline-style input — with enough padding so the focus ring
  // doesn't clip into the text (the core fix for the overlap issue).
  input: {
    backgroundColor: 'transparent',
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.border,
    paddingVertical: 14,               // was 10 — taller for fat fingers
    paddingHorizontal: 6,              // was 0  — keeps text clear of focus ring
    fontSize: 18,                      // was 16 — clearly legible on phone
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  inputFocused: {
    borderBottomWidth: 2.5,
    borderBottomColor: COLORS.primary, // snaps to near-black on focus
  },

  // ── Submit button ──────────────────────────────────────────────────────

  btn: {
    backgroundColor: COLORS.primary,
    borderRadius: 2,
    paddingVertical: SPACE.base + 2,   // 18 — slightly taller
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,                     // was 52 — better touch target
    marginTop: SPACE.sm,
  },
  btnBusy: {
    opacity: 0.6,
  },
  btnText: {
    color: COLORS.accent,
    fontSize: 15,                      // was 13 — bolder on mobile
    fontFamily: FONTS.bold,
    letterSpacing: 4,
  },

  // ── Toggle ─────────────────────────────────────────────────────────────

  toggle: {
    alignItems: 'center',
    paddingVertical: SPACE.sm + 2,     // bigger touch target
    marginTop: SPACE.xs,
  },
  toggleText: {
    fontSize: 15,                      // was 13 — comfortable mobile size
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
  },
  toggleLink: {
    fontFamily: FONTS.semibold,
    color: COLORS.text,
    textDecorationLine: 'underline',
  },
});
