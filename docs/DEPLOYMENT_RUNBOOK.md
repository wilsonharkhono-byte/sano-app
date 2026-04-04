# SANO Contractor Supervisor - Deployment Runbook

This guide provides step-by-step instructions for deploying the SANO Contractor Supervisor app across development, preview, and production environments.

## Prerequisites

Before starting any deployment, ensure you have the following installed:

- **Node.js 20+** — Check with `node --version`
- **Expo CLI** — Install with `npm install -g expo-cli` (version 18.4.0+)
- **EAS CLI** — Install with `npm install -g eas-cli`
- **Supabase CLI** — Install with `npm install -g supabase` (optional but recommended for migrations)
- **Xcode** (for iOS) — Required to build for iOS
- **Android SDK** (for Android) — Required to build for Android

### Required Environment Variables

The app requires two Supabase credentials:
- `EXPO_PUBLIC_SUPABASE_URL` — Your Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — Your Supabase anonymous key

These are configured in:
- Local development: `.env` file in the project root
- EAS builds: Defined in `eas.json` build profiles (preview and production)

## Environment Setup

### 1. Local Development Environment

Create a `.env` file in the project root:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

**To get Supabase credentials:**
1. Go to your Supabase project dashboard
2. Navigate to Settings > API
3. Copy the Project URL and Anon Key
4. Paste them into `.env`

### 2. Verify Environment Variables

```bash
# Check that variables are loaded
cat .env

# Or source them and verify
source .env && echo "SUPABASE_URL=$EXPO_PUBLIC_SUPABASE_URL"
```

**Important:** Never commit `.env` to version control. It's in `.gitignore`.

## Local Development

### Starting the App Locally

```bash
# Install dependencies
npm install

# Start the Expo development server
npm start
# or
npx expo start
```

You'll see a menu with options:
- Press `i` for iOS simulator
- Press `a` for Android emulator
- Press `w` for web
- Scan QR code with Expo Go app on physical device

### Testing on Simulator/Emulator

**iOS Simulator:**
```bash
npm run ios
# Opens Xcode's iOS simulator automatically
```

**Android Emulator:**
```bash
npm run android
# Ensure Android emulator is already running
```

### Testing on Physical Device

1. Install the Expo Go app from App Store or Google Play
2. Run `npx expo start`
3. Scan the QR code with your phone camera (iOS) or Expo Go app (Android)
4. App loads directly on your device

**For testing features requiring authentication:**
- Use test credentials from your Supabase project
- Create test user accounts in Supabase Auth dashboard

## EAS Build

EAS (Expo Application Services) handles building signed APK/IPA files for distribution and app stores.

### Build Profiles

The `eas.json` file defines three profiles:

**development** — Development client for quick testing
```json
{
  "developmentClient": true,
  "distribution": "internal"
}
```

**preview** — Internal testing/QA builds
```json
{
  "distribution": "internal",
  "env": { "EXPO_PUBLIC_SUPABASE_URL": "...", "EXPO_PUBLIC_SUPABASE_ANON_KEY": "..." }
}
```

**production** — App Store/Play Store releases
```json
{
  "autoIncrement": true,
  "env": { "EXPO_PUBLIC_SUPABASE_URL": "...", "EXPO_PUBLIC_SUPABASE_ANON_KEY": "..." }
}
```

### Building for iOS

**Development client build (for testing):**
```bash
eas build --platform ios --profile development
```

**Preview build (for QA):**
```bash
eas build --platform ios --profile preview
```

**Production build (for App Store):**
```bash
eas build --platform ios --profile production
```

Monitor build progress on the EAS dashboard. Once complete, download the `.ipa` file or distribute to testers.

### Building for Android

**Development client build:**
```bash
eas build --platform android --profile development
```

**Preview build:**
```bash
eas build --platform android --profile preview
```

**Production build:**
```bash
eas build --platform android --profile production
```

Android builds generate signed `.apk` or `.aab` (Android App Bundle) files ready for Google Play.

### Checking Build Status

```bash
# List recent builds
eas build:list

# View build logs
eas build:view <build-id>

# Download build artifact
eas build:download <build-id>
```

## OTA Updates

OTA (Over-The-Air) updates allow deploying JS code changes without app store resubmission. Native code changes still require EAS builds.

### Update Channels

The app uses update channels for staged rollouts:
- **production** — Main production channel
- **staging** — Staging/QA channel
- **development** — Development channel

### Publishing an Update

```bash
# Publish to production channel
eas update --branch production

# Publish to staging channel
eas update --branch staging

# Publish with custom message
eas update --branch production --message "Fix: improved error handling in reports"
```

### Viewing Published Updates

```bash
# List recent updates
eas update:list

# View details of specific update
eas update:view <update-id>
```

### Rollback Procedure

If a bad update is released:

```bash
# View update history
eas update:list --branch production

# Rollback to previous version
eas update:rollback --branch production --version <version-number>
```

Users will receive the rolled-back version on next app launch (typically within 30 seconds).

**Note:** OTA updates only affect JS code. To rollback native code, users must update to an earlier app version from the app store.

## Supabase Migrations

Database schema changes are managed through Supabase migrations.

### Creating a New Migration

```bash
# Create migration locally
supabase migration new <migration_name>
# Example: supabase migration new add_audit_log_table
```

This creates a `.sql` file in `supabase/migrations/`.

### Writing Migration SQL

Edit the migration file and write your SQL:

```sql
-- Create new table
CREATE TABLE audit_logs (
  id BIGINT PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "Users can view their own audit logs"
  ON audit_logs FOR SELECT
  USING (auth.uid() = user_id);
```

### Testing Migrations Locally

```bash
# Pull latest schema from remote
supabase db pull

# Reset local database (removes all data)
supabase db reset

# Verify migration runs without errors
supabase migration list
```

### Pushing to Production

```bash
# Review changes
supabase migration list
git diff supabase/migrations/

# Push to production (requires Supabase credentials)
supabase db push --linked
```

**Important:** Always test migrations locally before pushing to production.

### Migration Rollback

To rollback a migration:

1. Create a new migration that undoes the changes:
   ```bash
   supabase migration new revert_audit_log_table
   ```

2. Write SQL to revert:
   ```sql
   DROP TABLE IF EXISTS audit_logs;
   ```

3. Push the revert migration:
   ```bash
   supabase db push --linked
   ```

**Note:** Never modify or delete migration files. Always create new migrations to undo changes.

## Pre-Deployment Checklist

Follow this checklist before deploying to preview or production:

### 1. Code Quality

- [ ] TypeScript check passes:
  ```bash
  npx -p typescript tsc --noEmit
  ```

- [ ] Linting passes (if configured):
  ```bash
  npm run lint  # or equivalent
  ```

- [ ] Tests pass:
  ```bash
  npm test
  ```

### 2. Version & Changelog

- [ ] Update version in `app.json` (e.g., "3.0.1")
- [ ] Update version in `package.json` to match
- [ ] Update `CHANGELOG.md` with changes:
  ```markdown
  ## 3.0.1 - 2026-04-05
  - Fixed: Improved error handling in reports module
  - Added: Health check endpoint for monitoring
  ```

### 3. Environment Configuration

- [ ] Verify `eas.json` has correct Supabase credentials for target environment
- [ ] Confirm build profile (development/preview/production) is correct
- [ ] Check that app version matches what you're deploying

### 4. Database

- [ ] All migrations tested locally
- [ ] Schema changes reviewed for RLS policies
- [ ] Backup of production database taken (if production deployment)

### 5. Secrets & Sensitive Data

- [ ] No API keys or tokens in code
- [ ] `.env` file not committed
- [ ] Sensitive credentials only in `eas.json` (or use EAS secrets)

### 6. Testing

- [ ] Manual testing on simulator/emulator completed
- [ ] Critical user flows tested (auth, main workflows)
- [ ] API integration tested
- [ ] Error states tested

### 7. Git Status

- [ ] All changes committed:
  ```bash
  git status
  ```

- [ ] Create a release branch (optional):
  ```bash
  git checkout -b release/3.0.1
  ```

## Pre-Deployment Commands

Run this script before deploying:

```bash
#!/bin/bash
set -e

echo "1. TypeScript check..."
npx -p typescript tsc --noEmit

echo "2. Running tests..."
npm test

echo "3. Checking git status..."
git status

echo "4. All checks passed! Ready to deploy."
```

## Rollback Procedures

### Rollback OTA Update

If a bad JS code update is released:

```bash
# View update history
eas update:list --branch production

# Rollback to previous version
eas update:rollback --branch production --version <version-number>
```

Users receive rolled-back code on next app launch.

### Rollback App Version (Native Code)

If a bad native code version is released, users must update from app store:

1. Identify the last good app version
2. Create a new build from the corresponding git tag:
   ```bash
   git checkout v3.0.0  # checkout last good version
   eas build --platform ios --profile production
   eas build --platform android --profile production
   ```
3. Submit builds to app stores with release notes explaining the fix
4. Users manually update from app store

**Prevention:** Always test builds on real devices before releasing to production.

### Rollback Supabase Migration

If a database migration causes issues:

1. Create a revert migration:
   ```bash
   supabase migration new revert_<migration_name>
   ```

2. Write SQL to undo the change:
   ```sql
   -- Revert table structure
   DROP TABLE IF EXISTS new_table;
   ```

3. Push to production:
   ```bash
   supabase db push --linked
   ```

4. Notify team of the rollback and impact

## Monitoring

### Expo Updates Dashboard

Monitor OTA updates:
1. Go to [https://expo.dev/projects](https://expo.dev/projects)
2. Select the SANO project
3. View "Updates" tab for all published versions
4. Monitor usage stats and errors

### Supabase Dashboard

Monitor database health:
1. Go to Supabase console for your project
2. Check "Database" > "Replication" for table health
3. Monitor "Auth" for user signups/logins
4. Check "Logs" for errors

### Error Tracking

Integrate error tracking (if configured):
- **Sentry** (popular choice for React Native):
  ```bash
  npm install @sentry/react-native
  ```
- **Expo ErrorRecovery** (built-in):
  ```typescript
  import * as ErrorRecovery from 'expo-error-recovery';
  ```

Monitor error logs regularly to catch issues early.

## Troubleshooting

### Build Failures

**Error: "Missing EXPO_PUBLIC_SUPABASE_URL"**
- Solution: Ensure environment variables are set in `eas.json` or `.env`
- Verify variable names (exact case required)

**Error: "Signing failed" (iOS)**
- Solution: Check Apple Developer account credentials in EAS
- Ensure signing certificate is not expired
- Run: `eas credentials`

**Error: "Build timed out"**
- Solution: Large builds sometimes timeout. Retry or split assets
- Check network connectivity
- Try again in 5-10 minutes

### OTA Update Issues

**Updates not installing on devices**
- Check device has internet connection
- Verify update published to correct branch
- Check `runtimeVersion` policy in `app.json` matches current build
- Restart app to force update check

**Rollback not working**
- Verify update version exists: `eas update:list`
- Check branch name is correct: `--branch production`
- Users must restart app to receive rollback

### Supabase Connection Issues

**Error: "Failed to connect to Supabase"**
- Check credentials in `.env` or `eas.json`
- Verify Supabase project is running (check Supabase dashboard)
- Test connection: `curl $EXPO_PUBLIC_SUPABASE_URL/rest/v1/`
- Check network firewall allows Supabase domain

**RLS (Row Level Security) blocking queries**
- Enable Supabase logs: Dashboard > SQL Editor > Logs
- Review RLS policies for the table
- Ensure user is authenticated with correct permissions
- Test without RLS temporarily to isolate issue

### Local Development Issues

**Error: "Cannot find module '@supabase/supabase-js'"**
- Solution: Run `npm install`

**Simulator/Emulator won't connect**
- Ensure development server is running: `npx expo start`
- Check device/simulator is on same network
- Try restarting Xcode/Android Studio
- Check firewall settings

**Hot reload not working**
- Refresh: `r` in Expo CLI
- Full reload: `Ctrl+Shift+R` or `Cmd+Shift+R`
- Restart Expo CLI: `Ctrl+C` then `npx expo start`

## Emergency Contacts & Escalation

For critical production issues:

1. **Immediate rollback** — Use OTA rollback procedure above
2. **Database emergency** — Contact Supabase support
3. **App store issues** — Apple App Store or Google Play support
4. **Team notification** — Slack #sano-deployment or email team

## Additional Resources

- [Expo Documentation](https://docs.expo.dev/)
- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [EAS Update Documentation](https://docs.expo.dev/eas-update/introduction/)
- [Supabase Documentation](https://supabase.com/docs)
- [React Native Debugging](https://reactnative.dev/docs/debugging)

## Deployment History

Keep a log of deployments (consider moving to a shared wiki):

| Date | Version | Environment | Changes | Status |
|------|---------|-------------|---------|--------|
| 2026-04-05 | 3.0.1 | production | Health check, error handling | ✓ |
| 2026-04-01 | 3.0.0 | production | Initial release | ✓ |
