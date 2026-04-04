// SANO — Invite User Edge Function
// Creates a new user account via Supabase Admin API.
// Only callable by admin or principal roles.
//
// Called via supabase.functions.invoke('invite-user', { body: { email, password, full_name, role } })

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 1. Verify caller is admin or principal ──────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Tidak ada otorisasi.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error('[invite-user] Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY');
      return new Response(JSON.stringify({ error: 'Konfigurasi server tidak lengkap.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client with caller's JWT — to check their role
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser();
    if (authError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Sesi tidak valid.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single();

    if (!callerProfile || !['admin', 'principal'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Hanya admin atau principal yang bisa mengundang pengguna baru.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 2. Parse request body ───────────────────────────────────────
    const { email, password, full_name, role, project_id } = await req.json();

    if (!email || !password || !full_name) {
      return new Response(JSON.stringify({ error: 'Email, password, dan nama lengkap wajib diisi.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password minimal 8 karakter.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const validRoles = ['supervisor', 'estimator', 'admin', 'principal'];
    const targetRole = validRoles.includes(role) ? role : 'supervisor';

    // ── 3. Create user via Admin API (service role) ─────────────────
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // skip email verification for invites
      user_metadata: { full_name },
    });

    if (createError) {
      const msg = createError.message?.includes('already been registered')
        ? 'Email ini sudah terdaftar.'
        : createError.message ?? 'Gagal membuat akun.';
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 4. Set the role on the profile ──────────────────────────────
    // The handle_new_user trigger creates the profile with role='supervisor'.
    // Update if a different role was requested.
    if (targetRole !== 'supervisor') {
      await adminClient
        .from('profiles')
        .update({ role: targetRole })
        .eq('id', newUser.user.id);
    }

    // ── 5. Auto-assign to project if project_id provided ────────────
    if (project_id) {
      await adminClient
        .from('project_assignments')
        .insert({ project_id, user_id: newUser.user.id });
    }

    return new Response(
      JSON.stringify({
        user_id: newUser.user.id,
        email: newUser.user.email,
        full_name,
        role: targetRole,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message ?? 'Terjadi kesalahan.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
