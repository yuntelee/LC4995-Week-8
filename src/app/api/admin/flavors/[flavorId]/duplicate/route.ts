import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";
import { normalizeFlavorId } from "@/lib/server/humor-step-utils";

export const runtime = "nodejs";

const duplicateFlavorSchema = z.object({
  name: z.string().trim().min(1, "Flavor name is required.").optional(),
});

const NAME_COLUMNS = ["slug", "name", "flavor_name", "title", "flavor", "humor_flavor", "humor_flavor_name", "label"] as const;
const DESCRIPTION_COLUMNS = ["description", "details", "flavor_description", "summary"] as const;
const ID_COLUMNS = ["id", "flavor_id", "humor_flavor_id"] as const;

function normalizeFlavorRow(row: Record<string, unknown>) {
  const id = String(row.id ?? row.flavor_id ?? row.humor_flavor_id ?? "");
  const name =
    (typeof row.slug === "string" && row.slug) ||
    (typeof row.name === "string" && row.name) ||
    (typeof row.flavor_name === "string" && row.flavor_name) ||
    (typeof row.title === "string" && row.title) ||
    "Untitled flavor";

  return {
    id,
    name,
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

function sanitizeStepRowForInsert(step: Record<string, unknown>, args: { newFlavorId: number; userId: string }) {
  const payload: Record<string, unknown> = {
    ...step,
    humor_flavor_id: args.newFlavorId,
  };

  delete payload.id;
  delete payload.created_at;
  delete payload.updated_at;
  delete payload.created_datetime_utc;
  delete payload.modified_datetime_utc;

  if ("created_by_user_id" in payload) {
    payload.created_by_user_id = args.userId;
  }

  if ("modified_by_user_id" in payload) {
    payload.modified_by_user_id = args.userId;
  }

  if ("created_datetime_utc" in step) {
    payload.created_datetime_utc = new Date().toISOString();
  }

  if ("modified_datetime_utc" in step) {
    payload.modified_datetime_utc = new Date().toISOString();
  }

  return payload;
}

function deriveUniqueName(existingNames: string[], requestedName?: string, sourceName?: string) {
  const used = new Set(existingNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const base = (requestedName?.trim() || `${sourceName || "Flavor"} Copy`).trim();

  if (!used.has(base.toLowerCase())) {
    return base;
  }

  for (let i = 2; i <= 500; i += 1) {
    const candidate = `${base} ${i}`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${base} ${Date.now()}`;
}

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

  const parsed = duplicateFlavorSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }

  const nameColumn = await findFirstExistingColumn(auth.supabase, TABLES.flavors, NAME_COLUMNS);
  const descriptionColumn = await findFirstExistingColumn(auth.supabase, TABLES.flavors, DESCRIPTION_COLUMNS);
  const idColumns = await findExistingColumns(auth.supabase, TABLES.flavors, ID_COLUMNS);

  if (!nameColumn) {
    return NextResponse.json(
      {
        error:
          "Failed to duplicate flavor: no supported flavor name column found. Expected one of: slug, name, flavor_name, title, flavor, humor_flavor, humor_flavor_name, label.",
      },
      { status: 500 },
    );
  }

  if (!idColumns.length) {
    return NextResponse.json(
      { error: "Failed to duplicate flavor: no supported flavor id column found." },
      { status: 500 },
    );
  }

  let sourceFlavor: Record<string, unknown> | null = null;
  for (const idColumn of idColumns) {
    const { data, error } = await auth.supabase
      .from(TABLES.flavors)
      .select("*")
      .eq(idColumn, flavorId)
      .maybeSingle();

    if (!error && data) {
      sourceFlavor = data as Record<string, unknown>;
      break;
    }
  }

  if (!sourceFlavor) {
    return NextResponse.json({ error: "Source flavor not found." }, { status: 404 });
  }

  const { data: allFlavorRows, error: allFlavorError } = await auth.supabase.from(TABLES.flavors).select("*");
  if (allFlavorError) {
    return NextResponse.json({ error: `Failed to inspect existing flavors: ${allFlavorError.message}` }, { status: 500 });
  }

  const source = normalizeFlavorRow(sourceFlavor);
  const existingNames = (allFlavorRows ?? [])
    .map((row) => normalizeFlavorRow(row as Record<string, unknown>).name)
    .filter(Boolean);

  const uniqueName = deriveUniqueName(existingNames, parsed.data.name, source.name);

  const insertPayload: Record<string, unknown> = {
    ...sourceFlavor,
    [nameColumn]: nameColumn === "slug" ? slugifyFlavorName(uniqueName) : uniqueName,
  };

  delete insertPayload.id;
  delete insertPayload.flavor_id;
  delete insertPayload.humor_flavor_id;
  delete insertPayload.created_at;
  delete insertPayload.updated_at;
  delete insertPayload.created_datetime_utc;
  delete insertPayload.modified_datetime_utc;

  if (descriptionColumn && !(descriptionColumn in insertPayload)) {
    insertPayload[descriptionColumn] = null;
  }

  if ("created_by_user_id" in insertPayload) {
    insertPayload.created_by_user_id = auth.user.id;
  }

  if ("modified_by_user_id" in insertPayload) {
    insertPayload.modified_by_user_id = auth.user.id;
  }

  if ("created_datetime_utc" in sourceFlavor) {
    insertPayload.created_datetime_utc = new Date().toISOString();
  }

  if ("modified_datetime_utc" in sourceFlavor) {
    insertPayload.modified_datetime_utc = new Date().toISOString();
  }

  let createdFlavor: Record<string, unknown> | null = null;
  let createdName = uniqueName;
  let createError = "Failed to create duplicated flavor.";

  for (let i = 0; i < 6; i += 1) {
    const candidateName = i === 0 ? uniqueName : `${uniqueName} ${i + 1}`;
    insertPayload[nameColumn] = nameColumn === "slug" ? slugifyFlavorName(candidateName) : candidateName;

    const { data, error } = await auth.supabase
      .from(TABLES.flavors)
      .insert(insertPayload)
      .select("*")
      .maybeSingle();

    if (!error && data) {
      createdFlavor = data as Record<string, unknown>;
      createdName = candidateName;
      break;
    }

    if (error) {
      createError = [error.message, error.details, error.hint].filter(Boolean).join(" | ") || error.message;
      const isUniqueViolation = error.code === "23505" || /unique/i.test(error.message);
      if (!isUniqueViolation) {
        break;
      }
    }
  }

  if (!createdFlavor) {
    return NextResponse.json({ error: createError }, { status: 500 });
  }

  const newFlavorIdRaw = createdFlavor.id ?? createdFlavor.flavor_id ?? createdFlavor.humor_flavor_id;
  const newFlavorId = Number.parseInt(String(newFlavorIdRaw), 10);

  if (!Number.isFinite(newFlavorId) || newFlavorId <= 0) {
    return NextResponse.json({ error: "Duplicated flavor created but could not resolve its id." }, { status: 500 });
  }

  const { data: sourceSteps, error: sourceStepsError } = await auth.supabase
    .from(TABLES.steps)
    .select("*")
    .eq("humor_flavor_id", flavorId)
    .order("order_by", { ascending: true });

  if (sourceStepsError) {
    return NextResponse.json({ error: `Failed to load source steps: ${sourceStepsError.message}` }, { status: 500 });
  }

  const stepRows = (sourceSteps ?? []) as Record<string, unknown>[];
  if (stepRows.length > 0) {
    const insertSteps = stepRows.map((step) => sanitizeStepRowForInsert(step, { newFlavorId, userId: auth.user.id }));

    const { error: insertStepsError } = await auth.supabase.from(TABLES.steps).insert(insertSteps);
    if (insertStepsError) {
      for (const idColumn of idColumns) {
        const { error: cleanupError } = await auth.supabase
          .from(TABLES.flavors)
          .delete()
          .eq(idColumn, newFlavorId);
        if (!cleanupError) {
          break;
        }
      }

      return NextResponse.json({ error: `Failed to duplicate steps and rolled back flavor copy: ${insertStepsError.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({
    flavor: {
      ...normalizeFlavorRow(createdFlavor),
      name: createdName,
    },
    duplicated_steps: stepRows.length,
  }, { status: 201 });
}
