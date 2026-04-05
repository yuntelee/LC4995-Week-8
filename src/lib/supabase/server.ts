import { createClient } from "@supabase/supabase-js";
import { getServiceSupabaseConfig } from "@/lib/config";

export function getServiceSupabaseClient() {
  const { url, serviceRoleKey } = getServiceSupabaseConfig();

  if (!url || !serviceRoleKey) {
    throw new Error("Missing server Supabase configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
