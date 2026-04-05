export const TABLES = {
  profiles: "profiles",
  flavors: "humor_flavors",
  steps: "humor_flavor_steps",
  history: "caption_history",
} as const;

export function getPublicSupabaseConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function getServiceSupabaseConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function getAlmostCrackdConfig() {
  return {
    baseUrl: process.env.ALMOSTCRACKD_API_BASE_URL ?? "https://api.almostcrackd.ai",
    executePath: process.env.ALMOSTCRACKD_API_EXECUTE_PATH ?? "/v1/generate",
    apiKey: process.env.ALMOSTCRACKD_API_KEY,
  };
}
