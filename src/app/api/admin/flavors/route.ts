import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const createFlavorSchema = z.object({
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

function buildFlavorInsertPayload(args: {
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

  if (args.columns?.has("created_by")) payload.created_by = args.userId;
  if (args.columns?.has("updated_by")) payload.updated_by = args.userId;
  if (args.columns?.has("user_id")) payload.user_id = args.userId;
  if (args.columns?.has("owner_id")) payload.owner_id = args.userId;

  return payload;
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const attemptOrdered = await auth.supabase
    .from(TABLES.flavors)
    .select("*")
    .order("created_at", { ascending: false });

  if (!attemptOrdered.error) {
    const rows = (attemptOrdered.data ?? []).map((row) => normalizeFlavorRow(row as Record<string, unknown>));
    return NextResponse.json({ flavors: rows });
  }

  const fallback = await auth.supabase.from(TABLES.flavors).select("*");
  if (fallback.error) {
    return NextResponse.json({ error: `Failed to load flavors: ${fallback.error.message}` }, { status: 500 });
  }

  const rows = (fallback.data ?? []).map((row) => normalizeFlavorRow(row as Record<string, unknown>));
  return NextResponse.json({ flavors: rows });
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
  const columns = await getTableColumns(auth.supabase, TABLES.flavors);
  const insertPayload = buildFlavorInsertPayload({
    name,
    description: description || null,
    userId: auth.user.id,
    columns,
  });

  if (!insertPayload) {
    return NextResponse.json(
      { error: "Could not find a flavor name column (expected one of: name, flavor_name, title)." },
      { status: 500 },
    );
  }

  const { data, error } = await auth.supabase
    .from(TABLES.flavors)
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    const details = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    return NextResponse.json({ error: `Failed to create flavor: ${details}` }, { status: 500 });
  }

  return NextResponse.json({ flavor: normalizeFlavorRow((data ?? {}) as Record<string, unknown>) }, { status: 201 });
}
