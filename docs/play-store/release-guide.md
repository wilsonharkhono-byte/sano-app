# SANO on Google Play — release guide (Internal testing)

Same Play developer account as SanLog. Staff install from Play via an invite
link; Play then keeps the app updated. Do the parts in order.

## Part 1 — Create the app (owner, 5 min)

1. https://play.google.com/console → **Create app**. Answers: `listing.md` → "Create app".
2. Package name is set by the first upload: `com.sancontractor.supervisor`.

## Part 2 — Use the EXISTING signing key (owner, 15 min)

Why: phones already have the SANO APK signed with this key. If Play uses the
same key, Play simply **updates** those phones; nobody uninstalls, nothing
waiting offline is lost, and room-QR links keep working.

1. Install Java once (Google's tool needs it):
   ```bash
   brew install --cask temurin
   ```
2. Download the key EAS uses — in a terminal in a SANO folder:
   ```bash
   npx eas-cli credentials -p android
   ```
   Choose profile **production** → **Keystore: Manage everything needed to build
   your project** → **Download existing keystore**. It saves a `.jks` file and
   prints the **keystore password, key alias and key password**. Keep them
   private (don't paste them in chat); you need them in step 4.
3. Play Console → SANO → **Test and release → App integrity → App signing**
   (or the "Choose signing key" prompt on the first release) → **Use a different
   key** → **Export and upload a key from Java keystore**. Download
   **`pepk.jar`** and the **encryption public key** (`encryption_public_key.pem`)
   into Downloads.
4. In Terminal (replace the alias; it asks for the two passwords):
   ```bash
   cd ~/Downloads
   ```
   ```bash
   java -jar pepk.jar --keystore=<the .jks file> --alias=<key alias> --output=sano-signing-key.zip --include-cert --rsa-aes-encryption --encryption-key-path=encryption_public_key.pem
   ```
5. Upload `sano-signing-key.zip` on that Play page → **Save**.
6. Same page: copy the **App signing key certificate → SHA-256** and send it to
   Claude. It must be
   `C7:E1:A8:88:67:58:33:68:98:07:C0:74:F2:CD:24:BD:5D:4C:92:C2:F6:24:8E:6B:4B:DE:F0:82:AB:4B:FF:29`.
7. Delete the downloaded `.jks` and `.zip` from Downloads (EAS keeps the key).

## Part 3 — Build (Claude)

From a clean worktree on `origin/main` (private untracked files must not be
uploaded):
```bash
npx eas-cli build -p android --profile production --non-interactive --no-wait
```
Produces an `.aab`, version 3.2.0, runtime 3.2.0, channel `production`.
Before the first Play build, EAS channel `production` is pointed at branch
`preview` (`npx eas-cli channel:edit production --branch preview`) so one
`eas update --branch preview` reaches APK and Play phones alike.

## Part 4 — Internal testing release (owner, 10 min)

1. **Test and release → Testing → Internal testing → Testers** tab → tick the
   existing SanLog tester email list (lists are shared across the account) or
   create one → **Save**.
2. **Releases** → **Create new release** → **Add from library** (or upload the
   `.aab` downloaded from the EAS build page) → release notes, e.g.
   `Notifikasi HP dan angka di ikon aplikasi.` → **Next** → **Save** →
   **Start rollout to Internal testing**.
3. Testers tab → **Copy link** ("Join on the web"). Send it to staff.

If Play blocks the rollout asking for an "App content" item, the answers are in
`listing.md`.

## Part 5 — Staff install (each tester)

1. On the phone, open the link while signed in to Play with the **email that
   is on the tester list** → **Accept invite** → **Download it on Google Play**.
2. Phones that already have the SANO APK see **Update**; others see **Install**.
3. Open SANO → allow notifications → Lainnya → Notifikasi HP = **Aktif**.

## Later releases (routine)

- **JS-only changes:** Claude publishes an OTA (`eas update --branch preview`);
  APK and Play phones get it on the next app start.
- **Native changes** (app.json, new native packages): bump `version` in
  app.json, Claude builds a new `.aab` (production profile), owner adds it via
  **Internal testing → Create new release → Add from library** → rollout.
- Never sideload a `preview` APK over a Play install after this; use Play.
