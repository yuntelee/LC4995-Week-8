import { NextResponse } from "next/server";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const createFlavorSchema = z.object({
  name: z.string().trim().min(1, "Flavor name is required."),
  description: z.string().trim().optional().nullable(),
});

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { data, error } = await auth.supabase
    .from(TABLES.flavors)
    .select("id,name,description,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: `Failed to load flavors: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ flavors: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const parsed = createFlavorSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }

  const { name, description } = parsed.data;

  const { data, error } = await auth.supabase
    .from(TABLES.flavors)
    .insert({
      name,
      description: description || null,
    })
    .select("id,name,description,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to create flavor: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ flavor: data }, { status: 201 });
}
