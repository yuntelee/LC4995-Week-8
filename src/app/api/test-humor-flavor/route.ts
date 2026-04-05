import { NextResponse } from "next/server";
import { z } from "zod";
import { runCaptionPipelineFromImageUrl } from "@/lib/almostcrackd";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";
import { normalizeFlavorId } from "@/lib/server/humor-step-utils";
import type { ExecutionTrace } from "@/types/humor";

export const runtime = "nodejs";

const requestSchema = z.object({
  flavorId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  imageUrl: z.string().url(),
});

function renderPrompt(template: string, inputText: string, imageUrl: string) {
  return template
    .replaceAll("{{input}}", inputText)
    .replaceAll("{{previous_output}}", inputText)
    .replaceAll("{{image_url}}", imageUrl);
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ("response" in auth) {
      return auth.response;
    }

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload.",
          details: parsed.error.issues,
        },
        { status: 400 },
      );
    }

    const { imageUrl } = parsed.data;
    const flavorId =
      typeof parsed.data.flavorId === "number"
        ? parsed.data.flavorId
        : normalizeFlavorId(parsed.data.flavorId);

    const supabase = auth.supabase;

    const { data: stepsData, error: stepsError } = await supabase
      .from(TABLES.steps)
      .select("id,humor_flavor_id,order_by,llm_user_prompt,llm_system_prompt,description,llm_input_type_id")
      .eq("humor_flavor_id", flavorId)
      .order("order_by", { ascending: true });

    if (stepsError) {
      return NextResponse.json(
        {
          error: `Failed to load steps: ${stepsError.message}`,
        },
        { status: 500 },
      );
    }

    const steps = (stepsData ?? []) as Array<Record<string, unknown>>;
    if (steps.length === 0) {
      return NextResponse.json(
        {
          error: "No steps exist for this humor flavor.",
        },
        { status: 400 },
      );
    }

    const stepPrompts = steps.map((step, index) => ({
      stepId: String(step.id ?? ""),
      stepTitle: (typeof step.description === "string" && step.description) || `Step ${index + 1}`,
      renderedPrompt: renderPrompt(
        ((typeof step.llm_user_prompt === "string" && step.llm_user_prompt) ||
          (typeof step.llm_system_prompt === "string" && step.llm_system_prompt) ||
          "") as string,
        index === 0 ? imageUrl : `{{step_${Math.max(1, index)}_output}}`,
        imageUrl,
      ),
    }));

    const pipelineResult = await runCaptionPipelineFromImageUrl({
      token: auth.accessToken,
      sourceImageUrl: imageUrl,
      humorFlavorId: String(flavorId),
    });

    const trace: ExecutionTrace[] = [
      {
        stepId: "pipeline-generate-presigned-url",
        stepTitle: "Generate presigned upload URL",
        prompt: "POST /pipeline/generate-presigned-url",
        inputText: imageUrl,
        outputText: pipelineResult.uploadedCdnUrl,
        captions: [],
      },
      {
        stepId: "pipeline-upload-image-bytes",
        stepTitle: "Upload image bytes to presigned URL",
        prompt: "PUT <presignedUrl>",
        inputText: pipelineResult.uploadedCdnUrl,
        outputText: "Upload completed",
        captions: [],
      },
      {
        stepId: "pipeline-register-image",
        stepTitle: "Register image URL in pipeline",
        prompt: "POST /pipeline/upload-image-from-url",
        inputText: pipelineResult.uploadedCdnUrl,
        outputText: pipelineResult.imageId,
        captions: [],
      },
      {
        stepId: "pipeline-generate-captions",
        stepTitle: "Generate captions",
        prompt: "POST /pipeline/generate-captions",
        inputText: pipelineResult.imageId,
        outputText: JSON.stringify(pipelineResult.raw),
        captions: pipelineResult.captions,
      },
      ...stepPrompts.map((item) => ({
        stepId: item.stepId,
        stepTitle: item.stepTitle,
        prompt: item.renderedPrompt,
        inputText: imageUrl,
        outputText: "Managed in API pipeline via humorFlavorId",
        captions: [],
      })),
    ];

    const finalCaptions = pipelineResult.captions;

    const { error: historyError } = await supabase.from(TABLES.history).insert({
      humor_flavor_id: flavorId,
      image_url: imageUrl,
      captions: finalCaptions,
      trace,
    });

    if (historyError) {
      return NextResponse.json(
        {
          captions: finalCaptions,
          trace,
          warning: `History save failed: ${historyError.message}`,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({
      captions: finalCaptions,
      trace,
      ...(pipelineResult.warning ? { warning: pipelineResult.warning } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected server error.",
      },
      { status: 500 },
    );
  }
}
