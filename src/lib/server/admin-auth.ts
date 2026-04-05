import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { TABLES } from "@/lib/config";
import { getServiceSupabaseClient } from "@/lib/supabase/server";

type AdminAuthSuccess = {
  supabase: SupabaseClient;
  user: User;
};

type AdminAuthFailure = {
  response: NextResponse;
};

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure;

function unauthorized(message: string, status: 401 | 403 = 401) {
  return {
    response: NextResponse.json({ error: message }, { status }),
  } satisfies AdminAuthFailure;
}

export async function requireAdmin(request: Request): Promise<AdminAuthResult> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return unauthorized("Missing bearer token.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    return unauthorized("Missing bearer token.");
  }

  let supabase: SupabaseClient;
  try {
    supabase = getServiceSupabaseClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server auth configuration error.";
    return {
      response: NextResponse.json({ error: message }, { status: 500 }),
    };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return unauthorized("Invalid or expired session.");
  }

  const { data: profile, error: profileError } = await supabase
    .from(TABLES.profiles)
    .select("is_superadmin,is_matrix_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    return {
      response: NextResponse.json(
        { error: `Failed to verify admin role: ${profileError.message}` },
        { status: 500 },
      ),
    };
  }

  const authorized = Boolean(profile?.is_superadmin || profile?.is_matrix_admin);
  if (!authorized) {
    return unauthorized("Access denied: admin role required.", 403);
  }

  return {
    supabase,
    user: userData.user,
  };
}
