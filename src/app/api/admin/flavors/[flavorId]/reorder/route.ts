import { NextResponse } from "next/server";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const reorderSchema = z.object({
  orderedStepIds: z.array(z.string().uuid()).min(1),
});

type RouteContext = {
  params: Promise<{ flavorId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { flavorId } = await context.params;
  const parsed = reorderSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }

  const orderedStepIds = parsed.data.orderedStepIds;

  const { data: existingSteps, error: loadError } = await auth.supabase
    .from(TABLES.steps)
    .select("id")
    .eq("humor_flavor_id", flavorId);

  if (loadError) {
    return NextResponse.json({ error: `Failed to load steps: ${loadError.message}` }, { status: 500 });
  }

  const existingIds = new Set((existingSteps ?? []).map((row) => String(row.id)));
  if (existingIds.size !== orderedStepIds.length || orderedStepIds.some((id) => !existingIds.has(id))) {
    return NextResponse.json({ error: "Step reorder payload does not match flavor steps." }, { status: 400 });
  }

  const results = await Promise.all(
    orderedStepIds.map((stepId, index) =>
      auth.supabase.from(TABLES.steps).update({ order_index: index + 1 }).eq("id", stepId),
    ),
  );

  const updateError = results.find((result) => result.error)?.error;
  if (updateError) {
    return NextResponse.json({ error: `Failed to update step order: ${updateError.message}` }, { status: 500 });
  }

  const { data: updated, error: updatedError } = await auth.supabase
    .from(TABLES.steps)
    .select("id,humor_flavor_id,order_index,title,prompt_template,input_source,created_at,updated_at")
    .eq("humor_flavor_id", flavorId)
    .order("order_index", { ascending: true });

  if (updatedError) {
    return NextResponse.json({ error: `Failed to reload step order: ${updatedError.message}` }, { status: 500 });
  }

  return NextResponse.json({ steps: updated ?? [] });
}
