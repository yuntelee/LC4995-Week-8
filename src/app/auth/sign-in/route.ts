import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function getSiteUrl(requestUrl: URL) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (siteUrl) {
    return siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;
  }

  return requestUrl.origin;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const supabase = await createSupabaseServerClient();
  const origin = getSiteUrl(requestUrl);
  const redirectTo = new URL("/auth/callback", origin).toString();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error || !data?.url) {
    return NextResponse.redirect(new URL("/auth/error", requestUrl.origin));
  }

  return NextResponse.redirect(data.url);
}
