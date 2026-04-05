import { getAlmostCrackdConfig } from "@/lib/config";

type ExecutePromptArgs = {
  imageUrl: string;
  prompt: string;
  inputText: string;
};

type ExecutePromptResult = {
  raw: unknown;
  outputText: string;
  captions: string[];
};

function pickString(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

function pickCaptionArray(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      const cleaned = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  }
  return [];
}

export async function executePromptStep(args: ExecutePromptArgs): Promise<ExecutePromptResult> {
  const cfg = getAlmostCrackdConfig();
  const endpoint = `${cfg.baseUrl}${cfg.executePath}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
    headers["x-api-key"] = cfg.apiKey;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      image_url: args.imageUrl,
      imageUrl: args.imageUrl,
      prompt: args.prompt,
      input: args.inputText,
      input_text: args.inputText,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`almostcrackd API failed (${res.status}): ${text || "no error body"}`);
  }

  const raw = (await res.json()) as unknown;
  const object = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const captions = pickCaptionArray(object, ["captions", "results", "choices"]);
  const outputText = pickString(object, ["output", "text", "result", "caption", "message"]);

  return {
    raw,
    outputText,
    captions,
  };
}
