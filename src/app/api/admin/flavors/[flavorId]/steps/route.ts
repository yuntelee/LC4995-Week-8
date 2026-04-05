import { NextResponse } from "next/server";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";

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

  const { flavorId } = await context.params;

  const { data, error } = await auth.supabase
    .from(TABLES.steps)
    .select("id,humor_flavor_id,order_index,title,prompt_template,input_source,created_at,updated_at")
    .eq("humor_flavor_id", flavorId)
    .order("order_index", { ascending: true });

  if (error) {
    return NextResponse.json({ error: `Failed to load steps: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ steps: data ?? [] });
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { flavorId } = await context.params;
  const parsed = createStepSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }

  const payload = parsed.data;

  let orderIndex = payload.order_index;
  if (!orderIndex) {
    const { count, error: countError } = await auth.supabase
      .from(TABLES.steps)
      .select("id", { count: "exact", head: true })
      .eq("humor_flavor_id", flavorId);

    if (countError) {
      return NextResponse.json({ error: `Failed to compute step order: ${countError.message}` }, { status: 500 });
    }

    orderIndex = (count ?? 0) + 1;
  }

  const { data, error } = await auth.supabase
    .from(TABLES.steps)
    .insert({
      humor_flavor_id: flavorId,
      title: payload.title,
      prompt_template: payload.prompt_template,
      input_source: payload.input_source,
      order_index: orderIndex,
    })
    .select("id,humor_flavor_id,order_index,title,prompt_template,input_source,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to create step: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ step: data }, { status: 201 });
}
