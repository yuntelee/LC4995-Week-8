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

const NAME_COLUMNS = ["slug", "name", "flavor_name", "title", "flavor", "humor_flavor", "humor_flavor_name", "label"] as const;
const DESCRIPTION_COLUMNS = ["description", "details", "flavor_description", "summary"] as const;
const ID_COLUMNS = ["id", "flavor_id", "humor_flavor_id"] as const;

type FlavorColumnHints = {
  nameColumn: string | null;
  descriptionColumn: string | null;
  modifiedByUserIdColumn: string | null;
  modifiedDatetimeUtcColumn: string | null;
};

function normalizeFlavorRow(row: Record<string, unknown>) {
  const id = String(row.id ?? row.flavor_id ?? row.humor_flavor_id ?? "");
  const name =
    (typeof row.slug === "string" && row.slug) ||
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
    (typeof row.created_datetime_utc === "string" && row.created_datetime_utc) ||
    (typeof row.created_at === "string" && row.created_at) ||
    (typeof row.createdAt === "string" && row.createdAt) ||
    new Date(0).toISOString();
  const updatedAt =
    (typeof row.modified_datetime_utc === "string" && row.modified_datetime_utc) ||
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

function slugifyFlavorName(name: string) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "flavor";
}

async function columnExists(supabase: SupabaseClient, table: string, column: string) {
  const { error } = await supabase.from(table).select(column).limit(1);
  return !error;
}

async function findFirstExistingColumn(
  supabase: SupabaseClient,
  table: string,
  candidates: readonly string[],
) {
  for (const candidate of candidates) {
    if (await columnExists(supabase, table, candidate)) {
      return candidate;
    }
  }
  return null;
}

async function findExistingColumns(
  supabase: SupabaseClient,
  table: string,
  candidates: readonly string[],
) {
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await columnExists(supabase, table, candidate)) {
      existing.push(candidate);
    }
  }
  return existing;
}

async function inferFlavorColumnHints(supabase: SupabaseClient): Promise<FlavorColumnHints> {
  const nameColumn = await findFirstExistingColumn(supabase, TABLES.flavors, NAME_COLUMNS);
  const descriptionColumn = await findFirstExistingColumn(supabase, TABLES.flavors, DESCRIPTION_COLUMNS);
  const modifiedByUserIdColumn = (await columnExists(supabase, TABLES.flavors, "modified_by_user_id"))
    ? "modified_by_user_id"
    : null;
  const modifiedDatetimeUtcColumn = (await columnExists(supabase, TABLES.flavors, "modified_datetime_utc"))
    ? "modified_datetime_utc"
    : null;

  return {
    nameColumn,
    descriptionColumn,
    modifiedByUserIdColumn,
    modifiedDatetimeUtcColumn,
  };
}

function buildFlavorUpdatePayload(args: {
  name: string;
  description: string | null;
  userId: string;
  hints: FlavorColumnHints;
}) {
  if (!args.hints.nameColumn) {
    return null;
  }

  const payload: Record<string, unknown> = {
    [args.hints.nameColumn]: args.hints.nameColumn === "slug" ? slugifyFlavorName(args.name) : args.name,
  };

  if (args.hints.descriptionColumn) {
    payload[args.hints.descriptionColumn] = args.description;
  }

  if (args.hints.modifiedByUserIdColumn) {
    payload[args.hints.modifiedByUserIdColumn] = args.userId;
  }

  if (args.hints.modifiedDatetimeUtcColumn) {
    payload[args.hints.modifiedDatetimeUtcColumn] = new Date().toISOString();
  }

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
  const hints = await inferFlavorColumnHints(auth.supabase);
  if (!hints.nameColumn) {
    return NextResponse.json(
      {
        error:
          "Failed to update flavor: no supported flavor name column found. Expected one of: slug, name, flavor_name, title, flavor, humor_flavor, humor_flavor_name, label.",
      },
      { status: 500 },
    );
  }

  const idColumns = await findExistingColumns(auth.supabase, TABLES.flavors, ID_COLUMNS);
  if (!idColumns.length) {
    return NextResponse.json(
      { error: "Failed to update flavor: no supported flavor id column found." },
      { status: 500 },
    );
  }

  const updatePayload = buildFlavorUpdatePayload({
    name,
    description: description || null,
    userId: auth.user.id,
    hints,
  });

  if (!updatePayload) {
    return NextResponse.json({ error: "Failed to build update payload for flavor." }, { status: 500 });
  }

  let updatedFlavor: Record<string, unknown> | null = null;
  let lastErrorMessage = "Unable to update flavor.";

  for (const idColumn of idColumns) {
    const { data, error } = await auth.supabase
      .from(TABLES.flavors)
      .update(updatePayload)
      .eq(idColumn, flavorId)
      .select("*")
      .maybeSingle();

    if (!error && data) {
      updatedFlavor = data as Record<string, unknown>;
      break;
    }

    if (error) {
      const details = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
      lastErrorMessage = details || error.message;
    }
  }

  if (!updatedFlavor) {
    return NextResponse.json({ error: `Failed to update flavor: ${lastErrorMessage}` }, { status: 500 });
  }

  return NextResponse.json({ flavor: normalizeFlavorRow(updatedFlavor) });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const { flavorId } = await context.params;
  const idColumns = await findExistingColumns(auth.supabase, TABLES.flavors, ID_COLUMNS);
  if (!idColumns.length) {
    return NextResponse.json(
      { error: "Failed to delete flavor: no supported flavor id column found." },
      { status: 500 },
    );
  }

  let deleted = false;
  let lastErrorMessage = "Unable to delete flavor.";

  for (const idColumn of idColumns) {
    const { error } = await auth.supabase.from(TABLES.flavors).delete().eq(idColumn, flavorId);
    if (!error) {
      deleted = true;
      break;
    }

    const details = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    lastErrorMessage = details || error.message;
  }

  if (!deleted) {
    return NextResponse.json({ error: `Failed to delete flavor: ${lastErrorMessage}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
