import { NextResponse } from "next/server";
import { z } from "zod";
import { executePromptStep } from "@/lib/almostcrackd";
import { TABLES } from "@/lib/config";
import { requireAdmin } from "@/lib/server/admin-auth";
import type { ExecutionTrace, HumorFlavorStep } from "@/types/humor";

export const runtime = "nodejs";

const requestSchema = z.object({
  flavorId: z.string().uuid(),
  imageUrl: z.string().url(),
});

function renderPrompt(template: string, inputText: string, imageUrl: string) {
  return template
    .replaceAll("{{input}}", inputText)
    .replaceAll("{{previous_output}}", inputText)
    .replaceAll("{{image_url}}", imageUrl);
}

function inferCaptionsFromText(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-*\d.\s]+/, ""))
    .filter(Boolean)
    .slice(0, 5);
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

    const { flavorId, imageUrl } = parsed.data;
    const supabase = auth.supabase;

    const { data: stepsData, error: stepsError } = await supabase
      .from(TABLES.steps)
      .select("id,humor_flavor_id,order_index,title,prompt_template,input_source")
      .eq("humor_flavor_id", flavorId)
      .order("order_index", { ascending: true });

    if (stepsError) {
      return NextResponse.json(
        {
          error: `Failed to load steps: ${stepsError.message}`,
        },
        { status: 500 },
      );
    }

    const steps = (stepsData ?? []) as HumorFlavorStep[];
    if (steps.length === 0) {
      return NextResponse.json(
        {
          error: "No steps exist for this humor flavor.",
        },
        { status: 400 },
      );
    }

    let previousOutput = "";
    let finalCaptions: string[] = [];
    const trace: ExecutionTrace[] = [];

    for (const step of steps) {
      const inputText = step.input_source === "image" ? imageUrl : previousOutput;
      const prompt = renderPrompt(step.prompt_template, inputText, imageUrl);
      const response = await executePromptStep({
        imageUrl,
        prompt,
        inputText,
      });

      const outputText = response.outputText || JSON.stringify(response.raw);
      const captions = response.captions;

      if (captions.length > 0) {
        finalCaptions = captions;
      }

      previousOutput = captions.length > 0 ? captions.join("\n") : outputText;

      trace.push({
        stepId: step.id,
        stepTitle: step.title,
        prompt,
        inputText,
        outputText,
        captions,
      });
    }

    if (finalCaptions.length === 0) {
      finalCaptions = inferCaptionsFromText(previousOutput);
    }

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
