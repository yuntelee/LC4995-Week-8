import { NextResponse } from "next/server";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";
import {
  countFlavorSteps,
  inputSourceToLlmInputTypeId,
  mapDbStepRowToUi,
  normalizeFlavorId,
  resolveStepForeignKeys,
} from "@/lib/server/humor-step-utils";

export const runtime = "nodejs";

const createStepSchema = z.object({
  title: z.string().trim().min(1, "Step title is required."),
  prompt_template: z.string().trim().min(1, "Prompt template is required."),
  input_source: z.enum(["image", "previous_step"]),
  order_index: z.number().int().positive().optional(),
});

type RouteContext = {
  params: Promise<{ flavorId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
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

  let defaults;
  try {
    defaults = await resolveStepForeignKeys(auth.supabase);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to resolve step defaults." }, { status: 500 });
  }

  const { data, error } = await auth.supabase
    .from(TABLES.steps)
    .select(
      "id,humor_flavor_id,order_by,llm_input_type_id,llm_user_prompt,llm_system_prompt,description,created_datetime_utc,modified_datetime_utc",
    )
    .eq("humor_flavor_id", flavorId)
    .order("order_by", { ascending: true });

  if (error) {
    return NextResponse.json({ error: `Failed to load steps: ${error.message}` }, { status: 500 });
  }

  const steps = (data ?? []).map((row) => mapDbStepRowToUi(row as Record<string, unknown>, defaults.imageInputTypeId));

  return NextResponse.json({ steps });
}

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

  const parsed = createStepSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }

  const payload = parsed.data;

  let defaults;
  try {
    defaults = await resolveStepForeignKeys(auth.supabase);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to resolve step defaults." }, { status: 500 });
  }

  let orderIndex = payload.order_index;
  if (!orderIndex) {
    try {
      const count = await countFlavorSteps(auth.supabase, flavorId);
      orderIndex = count + 1;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to compute step order." },
        { status: 500 },
      );
    }
  }

  const llmInputTypeId = inputSourceToLlmInputTypeId(payload.input_source, defaults);

  const { data, error } = await auth.supabase
    .from(TABLES.steps)
    .insert({
      humor_flavor_id: flavorId,
      order_by: orderIndex,
      llm_input_type_id: llmInputTypeId,
      llm_output_type_id: defaults.defaultOutputTypeId,
      llm_model_id: defaults.defaultModelId,
      humor_flavor_step_type_id: defaults.defaultStepTypeId,
      llm_temperature: null,
      llm_system_prompt: null,
      llm_user_prompt: payload.prompt_template,
      description: payload.title,
      created_by_user_id: auth.user.id,
      modified_by_user_id: auth.user.id,
    })
    .select(
      "id,humor_flavor_id,order_by,llm_input_type_id,llm_user_prompt,llm_system_prompt,description,created_datetime_utc,modified_datetime_utc",
    )
    .single();

  if (error) {
    const details = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    return NextResponse.json({ error: `Failed to create step: ${details}` }, { status: 500 });
  }

  const step = mapDbStepRowToUi((data ?? {}) as Record<string, unknown>, defaults.imageInputTypeId);

  return NextResponse.json({ step }, { status: 201 });
}
