# SANO on Google Play (Internal testing) — Design

**Date:** 2026-10-06
**Scope:** Staff-only distribution through the Play Console **Internal testing**
track. No public listing.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Audience | Internal testing track, staff emails only | Internal tool; no full review, live within a day |
| Developer account | Existing account that already publishes SanLog (`com.sanstudio.sanlog`, production since 2026-06-24) | Proven account; no 12-tester rule |
| Upload | Manual in Play Console ("Add from library"), same as SanLog | First upload must be manual anyway; EAS Submit can come later |
| App signing key | **Reuse the EAS keystore** as Play's app signing key (PEPK upload) | Play updates the sideloaded 3.2.0 APK in place (no uninstall, no lost offline queue); `assetlinks.json` fingerprint `C7:E1:…:FF:29` stays valid |
| Self sign-up | **Removed** | Accounts are created by admins; removes Play's in-app account-deletion requirement and closes an open door |
| Company / contact | PT Saranah Arsitek Nugraha, wilsonharkhono@gmail.com | Same as the SanLog listing; owner to confirm |

## Changes in the repo

1. `workflows/screens/LoginScreen.tsx`: login only — remove the sign-up mode,
   full-name field and "Belum punya akun? Daftar" toggle; add a hint "Akun dibuat
   oleh admin. Hubungi admin jika belum punya akun."
2. `tools/auth.ts`: remove the now-unused `signUp`.
3. `public/privacy.html`: static Indonesian privacy policy, served by the Vercel
   web build at `https://sano-app.vercel.app/privacy.html` (Vercel serves files
   before the SPA rewrite, as it already does for `assetlinks.json`). Covers:
   identity data, site photos, GPS, voice notes, push token, processors
   (Supabase, Anthropic, OpenAI transcription, Expo + Google FCM), retention,
   UU PDP rights, contact.
4. `docs/play-store/listing.md` + `docs/play-store/icon-512.png`: copy-paste
   answers for Play Console (name, descriptions, category, content rating,
   Data safety, app access, privacy URL) and the 512×512 icon.
5. `docs/play-store/release-guide.md`: step-by-step owner guide — create app,
   PEPK key upload, verify fingerprint, build AAB, upload to Internal testing,
   add testers, roll out; plus the routine for later releases.

## Operations (not code)

- **One OTA stream:** point EAS channel `production` at branch `preview`
  (`eas channel:edit production --branch preview`) so `eas update --branch preview`
  reaches both sideloaded APKs and Play installs.
- **Build:** `eas build -p android --profile production` from a clean worktree
  on `origin/main` (untracked private files in the main checkout must not be
  uploaded). Version stays 3.2.0 / runtime 3.2.0; EAS auto-increments versionCode
  above the APK's, so Play can update it.
- **Optional hardening:** turn off "Allow new users to sign up" in Supabase Auth
  (admin creation and invites keep working).

## Out of scope

Public listing, screenshots/feature graphic, EAS Submit automation, iOS.
