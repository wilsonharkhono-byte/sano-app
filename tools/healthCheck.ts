import * as Constants from 'expo-constants';
import { supabase } from './supabase';

/**
 * Health check result structure
 */
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: {
    supabase: { ok: boolean; latencyMs: number; error?: string };
    auth: { ok: boolean; hasSession: boolean; error?: string };
    env: { ok: boolean; missing: string[] };
  };
}

/**
 * Verify Supabase connection with a lightweight query
 */
async function checkSupabaseConnection(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    // Perform a lightweight query to verify connection
    // Using a minimal select to avoid data transfer
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    const latencyMs = Date.now() - startTime;

    if (error) {
      return {
        ok: false,
        latencyMs,
        error: `Supabase query failed: ${error.message}`,
      };
    }

    return {
      ok: true,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    return {
      ok: false,
      latencyMs,
      error: `Supabase connection error: ${errorMsg}`,
    };
  }
}

/**
 * Verify authentication session
 */
async function checkAuthSession(): Promise<{
  ok: boolean;
  hasSession: boolean;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      return {
        ok: false,
        hasSession: false,
        error: `Auth session check failed: ${error.message}`,
      };
    }

    const hasSession = data.session !== null;

    return {
      ok: true,
      hasSession,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    return {
      ok: false,
      hasSession: false,
      error: `Auth check error: ${errorMsg}`,
    };
  }
}

/**
 * Verify required environment variables
 */
function checkEnvironmentVariables(): {
  ok: boolean;
  missing: string[];
} {
  const required = [
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ];

  const missing: string[] = [];

  for (const varName of required) {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      missing.push(varName);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

/**
 * Get app version from expo-constants
 */
function getAppVersion(): string {
  try {
    // Try to get version from Constants
    // In development, this may return 'unknown'
    // In production builds, this will return the configured version
    const versionInfo = (Constants as any).nativeAppVersion || (Constants as any).appVersion;
    if (versionInfo) {
      return String(versionInfo);
    }
    // Fallback: use app.json version which is always available at build time
    return '3.0.0'; // Default to package.json version
  } catch (err) {
    return 'unknown';
  }
}

/**
 * Run comprehensive health check
 *
 * @returns HealthCheckResult with status and detailed check results
 *
 * @example
 * ```typescript
 * const health = await runHealthCheck();
 * console.log(`App status: ${health.status}`);
 * if (health.status === 'unhealthy') {
 *   console.error('Health check failed:', health.checks);
 * }
 * ```
 */
export async function runHealthCheck(): Promise<HealthCheckResult> {
  const timestamp = new Date().toISOString();
  const version = getAppVersion();

  // Run all checks in parallel
  const [supabaseCheck, authCheck, envCheck] = await Promise.all([
    checkSupabaseConnection(),
    checkAuthSession(),
    Promise.resolve(checkEnvironmentVariables()),
  ]);

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (!envCheck.ok) {
    // Missing env vars = unhealthy
    status = 'unhealthy';
  } else if (!supabaseCheck.ok) {
    // Cannot connect to database = unhealthy
    status = 'unhealthy';
  } else if (!authCheck.ok) {
    // Auth issues could be degraded (not all users authenticated)
    status = 'degraded';
  }

  const result: HealthCheckResult = {
    status,
    timestamp,
    version,
    checks: {
      supabase: supabaseCheck,
      auth: authCheck,
      env: envCheck,
    },
  };

  return result;
}

/**
 * Format health check result for logging
 *
 * @param result The health check result to format
 * @returns Formatted string for console/log output
 */
export function formatHealthCheckResult(result: HealthCheckResult): string {
  const lines = [
    `[${result.timestamp}] Health Check: ${result.status.toUpperCase()}`,
    `Version: ${result.version}`,
    '',
    'Checks:',
    `  Supabase: ${result.checks.supabase.ok ? 'OK' : 'FAILED'} (${result.checks.supabase.latencyMs}ms)`,
    result.checks.supabase.error
      ? `    Error: ${result.checks.supabase.error}`
      : '',
    `  Auth: ${result.checks.auth.ok ? 'OK' : 'FAILED'} (session: ${result.checks.auth.hasSession ? 'active' : 'none'})`,
    result.checks.auth.error ? `    Error: ${result.checks.auth.error}` : '',
    `  Environment: ${result.checks.env.ok ? 'OK' : 'FAILED'}`,
    result.checks.env.missing.length > 0
      ? `    Missing: ${result.checks.env.missing.join(', ')}`
      : '',
  ];

  return lines.filter((line) => line !== '').join('\n');
}
