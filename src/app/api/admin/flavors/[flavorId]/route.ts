import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const updateFlavorSchema = z.object({
  name: z.string().trim().min(1, "Flavor name is required."),
  description: z.string().trim().optional().nullable(),
});

function normalizeFlavorRow(row: Record<string, unknown>) {
  const id = String(row.id ?? row.flavor_id ?? "");
  const name =
    (typeof row.name === "string" && row.name) ||
    (typeof row.flavor_name === "string" && row.flavor_name) ||
    (typeof row.title === "string" && row.title) ||
    "Untitled flavor";
  const description =
    typeof row.description === "string"
      ? row.description
      : typeof row.details === "string"
        ? row.details
        : null;
  const createdAt =
    (typeof row.created_at === "string" && row.created_at) ||
    (typeof row.createdAt === "string" && row.createdAt) ||
    new Date(0).toISOString();
  const updatedAt =
    (typeof row.updated_at === "string" && row.updated_at) ||
    (typeof row.updatedAt === "string" && row.updatedAt) ||
    createdAt;

  return {
    id,
    name,
    description,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

async function getTableColumns(supabase: SupabaseClient, tableName: string) {
  const { data, error } = await supabase
    .schema("information_schema")
    .from("columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", tableName);

  if (error) {
    return null;
  }

  const columns = new Set((data ?? []).map((row) => String(row.column_name)));
  return columns;
}

function buildFlavorUpdatePayload(args: {
  name: string;
  description: string | null;
  userId: string;
  columns: Set<string> | null;
}) {
  const payload: Record<string, unknown> = {};

  const nameColumn = args.columns
    ? ["name", "flavor_name", "title"].find((column) => args.columns?.has(column))
    : "name";

  if (!nameColumn) {
    return null;
  }

  payload[nameColumn] = args.name;

  const descriptionColumn = args.columns
    ? ["description", "details"].find((column) => args.columns?.has(column))
    : "description";

  if (descriptionColumn) {
    payload[descriptionColumn] = args.description;
  }

  if (args.columns?.has("updated_by")) payload.updated_by = args.userId;

  return payload;
}

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
  const columns = await getTableColumns(auth.supabase, TABLES.flavors);
  const updatePayload = buildFlavorUpdatePayload({
    name,
    description: description || null,
    userId: auth.user.id,
    columns,
  });

  if (!updatePayload) {
    return NextResponse.json(
      { error: "Could not find a flavor name column (expected one of: name, flavor_name, title)." },
      { status: 500 },
    );
  }

  const { data, error } = await auth.supabase
    .from(TABLES.flavors)
    .update(updatePayload)
    .eq("id", flavorId)
    .select("*")
    .single();

  if (error) {
    const details = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    return NextResponse.json({ error: `Failed to update flavor: ${details}` }, { status: 500 });
  }

  return NextResponse.json({ flavor: normalizeFlavorRow((data ?? {}) as Record<string, unknown>) });
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
