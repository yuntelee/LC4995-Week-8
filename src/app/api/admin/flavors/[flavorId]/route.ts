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

const NAME_COLUMNS = [
  "name",
  "flavor_name",
  "title",
  "flavor",
  "humor_flavor",
  "humor_flavor_name",
  "label",
] as const;
const DESCRIPTION_COLUMNS = ["description", "details", "flavor_description", "summary"] as const;
const ID_COLUMNS = ["id", "flavor_id", "humor_flavor_id"] as const;

type FlavorColumnHints = {
  nameColumn: string | null;
  descriptionColumn: string | null;
};

function normalizeFlavorRow(row: Record<string, unknown>) {
  const id = String(row.id ?? row.flavor_id ?? row.humor_flavor_id ?? "");
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

function inferFlavorColumnHintsFromRow(row: Record<string, unknown>): FlavorColumnHints {
  const keys = new Set(Object.keys(row));
  return {
    nameColumn: NAME_COLUMNS.find((column) => keys.has(column)) ?? null,
    descriptionColumn: DESCRIPTION_COLUMNS.find((column) => keys.has(column)) ?? null,
  };
}

async function loadFlavorById(
  supabase: SupabaseClient,
  flavorId: string,
) {
  for (const idColumn of ID_COLUMNS) {
    const { data, error } = await supabase
      .from(TABLES.flavors)
      .select("*")
      .eq(idColumn, flavorId)
      .maybeSingle();

    if (!error && data) {
      return {
        row: data as Record<string, unknown>,
        idColumn,
      };
    }
  }

  return null;
}

function buildFlavorUpdatePayloads(args: {
  name: string;
  description: string | null;
  userId: string;
  hints: FlavorColumnHints | null;
}) {
  const payloads: Record<string, unknown>[] = [];

  const candidateNameColumns = args.hints?.nameColumn
    ? [args.hints.nameColumn, ...NAME_COLUMNS.filter((column) => column !== args.hints?.nameColumn)]
    : [...NAME_COLUMNS];

  const candidateDescriptionColumns = args.hints?.descriptionColumn
    ? [args.hints.descriptionColumn, ...DESCRIPTION_COLUMNS.filter((column) => column !== args.hints?.descriptionColumn)]
    : [...DESCRIPTION_COLUMNS];

  for (const nameColumn of candidateNameColumns) {
    const base: Record<string, unknown> = {
      [nameColumn]: args.name,
    };

    payloads.push(base);
    payloads.push({ ...base, updated_by: args.userId });

    for (const descriptionColumn of candidateDescriptionColumns) {
      payloads.push({
        ...base,
        [descriptionColumn]: args.description,
      });
      payloads.push({
        ...base,
        [descriptionColumn]: args.description,
        updated_by: args.userId,
      });
    }
  }

  const seen = new Set<string>();
  return payloads.filter((payload) => {
    const key = JSON.stringify(payload);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
  const loaded = await loadFlavorById(auth.supabase, flavorId);
  const hints = loaded ? inferFlavorColumnHintsFromRow(loaded.row) : null;
  const idColumns = loaded ? [loaded.idColumn, ...ID_COLUMNS.filter((column) => column !== loaded.idColumn)] : [...ID_COLUMNS];

  const updatePayloads = buildFlavorUpdatePayloads({
    name,
    description: description || null,
    userId: auth.user.id,
    hints,
  });

  let updatedFlavor: Record<string, unknown> | null = null;
  let lastErrorMessage = "Unable to update flavor with available column mappings.";
  const missingColumns = new Set<string>();

  const payloadHasMissingColumn = (payload: Record<string, unknown>) =>
    Object.keys(payload).some((key) => missingColumns.has(key));

  const rememberMissingColumn = (message: string) => {
    const match = message.match(/Could not find the '([^']+)' column/i);
    if (match?.[1]) {
      missingColumns.add(match[1]);
    }
  };

  for (const payload of updatePayloads) {
    if (payloadHasMissingColumn(payload)) {
      continue;
    }

    for (const idColumn of idColumns) {
      const { data, error } = await auth.supabase
        .from(TABLES.flavors)
        .update(payload)
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
        rememberMissingColumn(lastErrorMessage);
      }
    }

    if (updatedFlavor) {
      break;
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
  const loaded = await loadFlavorById(auth.supabase, flavorId);
  const idColumns = loaded ? [loaded.idColumn, ...ID_COLUMNS.filter((column) => column !== loaded.idColumn)] : [...ID_COLUMNS];

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
