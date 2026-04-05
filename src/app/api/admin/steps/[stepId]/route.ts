import { NextResponse } from "next/server";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";
import {
  inputSourceToLlmInputTypeId,
  mapDbStepRowToUi,
  normalizeStepId,
  resolveStepForeignKeys,
} from "@/lib/server/humor-step-utils";

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

  const { stepId: rawStepId } = await context.params;
  let stepId: number;
  try {
    stepId = normalizeStepId(rawStepId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid step id." }, { status: 400 });
  }

  const parsed = updateStepSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }

  let defaults;
  try {
    defaults = await resolveStepForeignKeys(auth.supabase);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to resolve step defaults." }, { status: 500 });
  }

  const llmInputTypeId = inputSourceToLlmInputTypeId(parsed.data.input_source, defaults);

  const { data, error } = await auth.supabase
    .from(TABLES.steps)
    .update({
      description: parsed.data.title,
      llm_user_prompt: parsed.data.prompt_template,
      llm_input_type_id: llmInputTypeId,
      modified_by_user_id: auth.user.id,
      modified_datetime_utc: new Date().toISOString(),
    })
    .eq("id", stepId)
    .select(
      "id,humor_flavor_id,order_by,llm_input_type_id,llm_user_prompt,llm_system_prompt,description,created_datetime_utc,modified_datetime_utc",
    )
    .single();

  if (error) {
    const details = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    return NextResponse.json({ error: `Failed to update step: ${details}` }, { status: 500 });
  }

  const step = mapDbStepRowToUi((data ?? {}) as Record<string, unknown>, defaults.imageInputTypeId);

  return NextResponse.json({ step });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { stepId: rawStepId } = await context.params;
  let stepId: number;
  try {
    stepId = normalizeStepId(rawStepId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid step id." }, { status: 400 });
  }

  const { data: stepData, error: stepLoadError } = await auth.supabase
    .from(TABLES.steps)
    .select("id,humor_flavor_id")
    .eq("id", stepId)
    .single();

  if (stepLoadError) {
    return NextResponse.json({ error: `Failed to load step: ${stepLoadError.message}` }, { status: 500 });
  }

  const flavorId = Number(stepData.humor_flavor_id);

  const { error } = await auth.supabase.from(TABLES.steps).delete().eq("id", stepId);
  if (error) {
    return NextResponse.json({ error: `Failed to delete step: ${error.message}` }, { status: 500 });
  }

  const { data: remaining, error: remainError } = await auth.supabase
    .from(TABLES.steps)
    .select("id")
    .eq("humor_flavor_id", flavorId)
    .order("order_by", { ascending: true });

  if (remainError) {
    return NextResponse.json({ error: `Failed to reorder remaining steps: ${remainError.message}` }, { status: 500 });
  }

  const reorderResults = await Promise.all(
    (remaining ?? []).map((step, index) =>
      auth.supabase.from(TABLES.steps).update({ order_by: index + 1 }).eq("id", Number(step.id)),
    ),
  );

  const reorderError = reorderResults.find((result) => result.error)?.error;
  if (reorderError) {
    return NextResponse.json({ error: `Failed to normalize step order: ${reorderError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
