import type { SupabaseClient } from "@supabase/supabase-js";
import type { HumorFlavorStep, StepInputSource } from "@/types/humor";
import { TABLES } from "@/lib/config";

type LookupRow = Record<string, unknown>;

type StepForeignKeys = {
  imageInputTypeId: number;
  previousInputTypeId: number;
  defaultOutputTypeId: number;
  defaultModelId: number;
  defaultStepTypeId: number;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }

  return null;
}

function readLabel(row: LookupRow) {
  const candidates = [
    row.name,
    row.slug,
    row.title,
    row.label,
    row.description,
    row.type,
    row.input_type,
    row.output_type,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.toLowerCase();
    }
  }

  return "";
}

function pickIdByKeyword(rows: LookupRow[], keywords: string[]) {
  for (const row of rows) {
    const label = readLabel(row);
    if (!label) {
      continue;
    }

    if (keywords.some((keyword) => label.includes(keyword))) {
      const id = toNumber(row.id);
      if (id !== null) {
        return id;
      }
    }
  }

  return null;
}

function firstId(rows: LookupRow[]) {
  for (const row of rows) {
    const id = toNumber(row.id);
    if (id !== null) {
      return id;
    }
  }
  return null;
}

async function loadLookupRows(supabase: SupabaseClient, tableName: string) {
  const { data, error } = await supabase.from(tableName).select("*").order("id", { ascending: true });
  if (error) {
    throw new Error(`Failed to load ${tableName}: ${error.message}`);
  }

  const rows = (data ?? []) as LookupRow[];
  if (!rows.length) {
    throw new Error(`No rows found in ${tableName}.`);
  }

  return rows;
}

export async function resolveStepForeignKeys(supabase: SupabaseClient): Promise<StepForeignKeys> {
  const inputRows = await loadLookupRows(supabase, "llm_input_types");
  const outputRows = await loadLookupRows(supabase, "llm_output_types");
  const modelRows = await loadLookupRows(supabase, "llm_models");
  const stepTypeRows = await loadLookupRows(supabase, "humor_flavor_step_types");

  const imageInputTypeId =
    pickIdByKeyword(inputRows, ["image", "photo", "picture"]) ?? firstId(inputRows);

  const previousInputTypeId =
    pickIdByKeyword(inputRows, ["text", "previous", "caption", "description", "prompt"]) ??
    inputRows.map((row) => toNumber(row.id)).find((id) => id !== null && id !== imageInputTypeId) ??
    imageInputTypeId;

  const defaultOutputTypeId =
    pickIdByKeyword(outputRows, ["caption", "text", "string"]) ?? firstId(outputRows);

  const defaultModelId = firstId(modelRows);

  const defaultStepTypeId =
    pickIdByKeyword(stepTypeRows, ["caption", "default", "prompt", "step"]) ?? firstId(stepTypeRows);

  if (
    imageInputTypeId === null ||
    previousInputTypeId === null ||
    defaultOutputTypeId === null ||
    defaultModelId === null ||
    defaultStepTypeId === null
  ) {
    throw new Error("Could not resolve required foreign keys for humor_flavor_steps.");
  }

  return {
    imageInputTypeId,
    previousInputTypeId,
    defaultOutputTypeId,
    defaultModelId,
    defaultStepTypeId,
  };
}

export function inputSourceToLlmInputTypeId(
  source: StepInputSource,
  defaults: StepForeignKeys,
) {
  return source === "image" ? defaults.imageInputTypeId : defaults.previousInputTypeId;
}

export function mapDbStepRowToUi(
  row: Record<string, unknown>,
  imageInputTypeId: number,
): HumorFlavorStep {
  const id = String(row.id ?? "");
  const humorFlavorId = String(row.humor_flavor_id ?? "");
  const orderIndex = toNumber(row.order_by) ?? 0;
  const llmInputTypeId = toNumber(row.llm_input_type_id);

  const titleRaw =
    (typeof row.description === "string" && row.description) ||
    `Step ${orderIndex || "?"}`;

  const promptTemplate =
    (typeof row.llm_user_prompt === "string" && row.llm_user_prompt) ||
    (typeof row.llm_system_prompt === "string" && row.llm_system_prompt) ||
    "";

  const inputSource: StepInputSource = llmInputTypeId === imageInputTypeId ? "image" : "previous_step";

  return {
    id,
    humor_flavor_id: humorFlavorId,
    order_index: orderIndex,
    title: titleRaw,
    prompt_template: promptTemplate,
    input_source: inputSource,
    created_at:
      (typeof row.created_datetime_utc === "string" && row.created_datetime_utc) ||
      (typeof row.created_at === "string" && row.created_at) ||
      undefined,
    updated_at:
      (typeof row.modified_datetime_utc === "string" && row.modified_datetime_utc) ||
      (typeof row.updated_at === "string" && row.updated_at) ||
      undefined,
  };
}

export function normalizeStepId(stepId: string) {
  const value = Number.parseInt(stepId, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid step id.");
  }
  return value;
}

export function normalizeFlavorId(flavorId: string) {
  const value = Number.parseInt(flavorId, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid flavor id.");
  }
  return value;
}

export function normalizeOrderedStepIds(stepIds: Array<string | number>) {
  const ids = stepIds.map((id) => {
    if (typeof id === "number") {
      return id;
    }

    const parsed = Number.parseInt(id, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("Invalid step id in reorder payload.");
    }

    return parsed;
  });

  return ids;
}

export async function countFlavorSteps(supabase: SupabaseClient, flavorId: number) {
  const { count, error } = await supabase
    .from(TABLES.steps)
    .select("id", { count: "exact", head: true })
    .eq("humor_flavor_id", flavorId);

  if (error) {
    throw new Error(`Failed to compute step order: ${error.message}`);
  }

  return count ?? 0;
}
