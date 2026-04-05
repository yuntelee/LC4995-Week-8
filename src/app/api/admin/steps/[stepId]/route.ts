import { NextResponse } from "next/server";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const updateStepSchema = z.object({
  title: z.string().trim().min(1, "Step title is required."),
  prompt_template: z.string().trim().min(1, "Prompt template is required."),
  input_source: z.enum(["image", "previous_step"]),
});

type RouteContext = {
  params: Promise<{ stepId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { stepId } = await context.params;
  const parsed = updateStepSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from(TABLES.steps)
    .update(parsed.data)
    .eq("id", stepId)
    .select("id,humor_flavor_id,order_index,title,prompt_template,input_source,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to update step: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ step: data });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { stepId } = await context.params;

  const { data: stepData, error: stepLoadError } = await auth.supabase
    .from(TABLES.steps)
    .select("id,humor_flavor_id")
    .eq("id", stepId)
    .single();

  if (stepLoadError) {
    return NextResponse.json({ error: `Failed to load step: ${stepLoadError.message}` }, { status: 500 });
  }

  const flavorId = stepData.humor_flavor_id as string;

  const { error } = await auth.supabase.from(TABLES.steps).delete().eq("id", stepId);
  if (error) {
    return NextResponse.json({ error: `Failed to delete step: ${error.message}` }, { status: 500 });
  }

  const { data: remaining, error: remainError } = await auth.supabase
    .from(TABLES.steps)
    .select("id")
    .eq("humor_flavor_id", flavorId)
    .order("order_index", { ascending: true });

  if (remainError) {
    return NextResponse.json({ error: `Failed to reorder remaining steps: ${remainError.message}` }, { status: 500 });
  }

  const reorderResults = await Promise.all(
    (remaining ?? []).map((step, index) =>
      auth.supabase.from(TABLES.steps).update({ order_index: index + 1 }).eq("id", step.id as string),
    ),
  );

  const reorderError = reorderResults.find((result) => result.error)?.error;
  if (reorderError) {
    return NextResponse.json({ error: `Failed to normalize step order: ${reorderError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
