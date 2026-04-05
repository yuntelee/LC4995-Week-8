import { NextResponse } from "next/server";
import { z } from "zod";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const createFlavorSchema = z.object({
  name: z.string().trim().min(1, "Flavor name is required."),
  description: z.string().trim().optional().nullable(),
});

const NAME_COLUMNS = ["name", "flavor_name", "title"] as const;
const DESCRIPTION_COLUMNS = ["description", "details"] as const;
const OWNER_COLUMNS = ["created_by", "user_id", "owner_id"] as const;

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

function buildFlavorInsertPayloads(args: {
  name: string;
  description: string | null;
  userId: string;
}) {
  const payloads: Record<string, unknown>[] = [];

  for (const nameColumn of NAME_COLUMNS) {
    const base: Record<string, unknown> = {
      [nameColumn]: args.name,
    };

    payloads.push(base);

    for (const descriptionColumn of DESCRIPTION_COLUMNS) {
      payloads.push({
        ...base,
        [descriptionColumn]: args.description,
      });
    }

    for (const ownerColumn of OWNER_COLUMNS) {
      payloads.push({
        ...base,
        [ownerColumn]: args.userId,
      });
      payloads.push({
        ...base,
        [ownerColumn]: args.userId,
        updated_by: args.userId,
      });
    }

    for (const descriptionColumn of DESCRIPTION_COLUMNS) {
      for (const ownerColumn of OWNER_COLUMNS) {
        payloads.push({
          ...base,
          [descriptionColumn]: args.description,
          [ownerColumn]: args.userId,
        });
        payloads.push({
          ...base,
          [descriptionColumn]: args.description,
          [ownerColumn]: args.userId,
          updated_by: args.userId,
        });
      }
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
  const insertPayloads = buildFlavorInsertPayloads({
    name,
    description: description || null,
    userId: auth.user.id,
  });

  let createdFlavor: Record<string, unknown> | null = null;
  let lastErrorMessage = "Unable to create flavor with available column mappings.";

  for (const payload of insertPayloads) {
    const { data, error } = await auth.supabase
      .from(TABLES.flavors)
      .insert(payload)
      .select("*")
      .single();

    if (!error && data) {
      createdFlavor = data as Record<string, unknown>;
      break;
    }

    if (error) {
      const details = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
      lastErrorMessage = details || error.message;
    }
  }

  if (!createdFlavor) {
    return NextResponse.json(
      {
        error: `Failed to create flavor: ${lastErrorMessage}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ flavor: normalizeFlavorRow(createdFlavor) }, { status: 201 });
}
