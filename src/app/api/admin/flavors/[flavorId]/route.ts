import { NextResponse } from "next/server";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const updateFlavorSchema = z.object({
  name: z.string().trim().min(1, "Flavor name is required."),
  description: z.string().trim().optional().nullable(),
});

type RouteContext = {
  params: Promise<{ flavorId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { flavorId } = await context.params;
  const parsed = updateFlavorSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }

  const { name, description } = parsed.data;

  const { data, error } = await auth.supabase
    .from(TABLES.flavors)
    .update({
      name,
      description: description || null,
    })
    .eq("id", flavorId)
    .select("id,name,description,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to update flavor: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ flavor: data });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { flavorId } = await context.params;

  const { error } = await auth.supabase.from(TABLES.flavors).delete().eq("id", flavorId);
  if (error) {
    return NextResponse.json({ error: `Failed to delete flavor: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
