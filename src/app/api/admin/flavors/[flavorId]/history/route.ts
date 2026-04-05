import { NextResponse } from "next/server";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ flavorId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { flavorId } = await context.params;
  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 10;

  const { data, error } = await auth.supabase
    .from(TABLES.history)
    .select("id,humor_flavor_id,image_url,captions,trace,created_at")
    .eq("humor_flavor_id", flavorId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: `Failed to load caption history: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ history: data ?? [] });
}
