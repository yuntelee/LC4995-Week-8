import { NextResponse } from "next/server";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";
import {
  mapDbStepRowToUi,
  normalizeFlavorId,
  normalizeOrderedStepIds,
  resolveStepForeignKeys,
} from "@/lib/server/humor-step-utils";

export const runtime = "nodejs";

const reorderSchema = z.object({
  orderedStepIds: z.array(z.union([z.number().int().positive(), z.string().regex(/^\d+$/)])).min(1),
});

type RouteContext = {
  params: Promise<{ flavorId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { flavorId: rawFlavorId } = await context.params;
  let flavorId: number;
  try {
    flavorId = normalizeFlavorId(rawFlavorId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid flavor id." }, { status: 400 });
  }

  const parsed = reorderSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }

  let orderedStepIds: number[];
  try {
    orderedStepIds = normalizeOrderedStepIds(parsed.data.orderedStepIds);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid step ids." }, { status: 400 });
  }

  let defaults;
  try {
    defaults = await resolveStepForeignKeys(auth.supabase);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to resolve step defaults." }, { status: 500 });
  }

  const { data: existingSteps, error: loadError } = await auth.supabase
    .from(TABLES.steps)
    .select("id")
    .eq("humor_flavor_id", flavorId);

  if (loadError) {
    return NextResponse.json({ error: `Failed to load steps: ${loadError.message}` }, { status: 500 });
  }

  const existingIds = new Set((existingSteps ?? []).map((row) => Number(row.id)));
  if (existingIds.size !== orderedStepIds.length || orderedStepIds.some((id) => !existingIds.has(id))) {
    return NextResponse.json({ error: "Step reorder payload does not match flavor steps." }, { status: 400 });
  }

  const results = await Promise.all(
    orderedStepIds.map((stepId, index) =>
      auth.supabase.from(TABLES.steps).update({ order_by: index + 1 }).eq("id", stepId),
    ),
  );

  const updateError = results.find((result) => result.error)?.error;
  if (updateError) {
    return NextResponse.json({ error: `Failed to update step order: ${updateError.message}` }, { status: 500 });
  }

  const { data: updated, error: updatedError } = await auth.supabase
    .from(TABLES.steps)
    .select(
      "id,humor_flavor_id,order_by,llm_input_type_id,llm_user_prompt,llm_system_prompt,description,created_datetime_utc,modified_datetime_utc",
    )
    .eq("humor_flavor_id", flavorId)
    .order("order_by", { ascending: true });

  if (updatedError) {
    return NextResponse.json({ error: `Failed to reload step order: ${updatedError.message}` }, { status: 500 });
  }

  const steps = (updated ?? []).map((row) => mapDbStepRowToUi(row as Record<string, unknown>, defaults.imageInputTypeId));

  return NextResponse.json({ steps });
}
