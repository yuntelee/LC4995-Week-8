import { getAlmostCrackdConfig } from "@/lib/config";

const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
]);

type PipelineCaptionResult = {
  captions: string[];
  imageId: string;
  uploadedCdnUrl: string;
  raw: unknown;
  warning?: string;
};

type PresignedResponse = {
  presignedUrl: string;
  cdnUrl: string;
};

type RegisterImageResponse = {
  imageId: string;
};

function normalizeContentType(contentType: string) {
  return contentType.split(";")[0].trim().toLowerCase();
}

function inferContentTypeFromUrl(imageUrl: string) {
  const lower = imageUrl.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".heic")) {
    return "image/heic";
  }
  return null;
}

async function readErrorBody(response: Response) {
  const text = await response.text();
  return text || "no error body";
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function pickString(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function extractCaptionsFromPipelineResponse(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const fromArray = raw
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }

        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          return pickString(obj, ["caption", "text", "content", "output"]);
        }

        return "";
      })
      .filter((item) => item.length > 0);

    if (fromArray.length > 0) {
      return fromArray;
    }
  }

  if (!raw || typeof raw !== "object") {
    return [];
  }

  const object = raw as Record<string, unknown>;
  const candidates = [
    parseStringArray(object.captions),
    parseStringArray(object.results),
    parseStringArray(object.choices),
    parseStringArray(object.data),
  ];

  for (const option of candidates) {
    if (option.length > 0) {
      return option;
    }
  }

  const single = pickString(object, ["caption", "text", "content", "output", "message"]);
  return single ? [single] : [];
}

async function generatePresignedUrl(token: string, contentType: string): Promise<PresignedResponse> {
  const cfg = getAlmostCrackdConfig();
  const response = await fetch(`${cfg.baseUrl}/pipeline/generate-presigned-url`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contentType }),
  });

  if (!response.ok) {
    throw new Error(`generate-presigned-url failed (${response.status}): ${await readErrorBody(response)}`);
  }

  const payload = (await response.json()) as Partial<PresignedResponse>;
  if (!payload.presignedUrl || !payload.cdnUrl) {
    throw new Error("generate-presigned-url returned invalid payload.");
  }

  return {
    presignedUrl: payload.presignedUrl,
    cdnUrl: payload.cdnUrl,
  };
}

async function registerImageUrl(token: string, imageUrl: string): Promise<RegisterImageResponse> {
  const cfg = getAlmostCrackdConfig();
  const response = await fetch(`${cfg.baseUrl}/pipeline/upload-image-from-url`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imageUrl,
      isCommonUse: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`upload-image-from-url failed (${response.status}): ${await readErrorBody(response)}`);
  }

  const payload = (await response.json()) as Partial<RegisterImageResponse>;
  if (!payload.imageId) {
    throw new Error("upload-image-from-url returned invalid payload.");
  }

  return {
    imageId: payload.imageId,
  };
}

async function generateCaptions(token: string, imageId: string, humorFlavorId?: string) {
  const cfg = getAlmostCrackdConfig();
  const response = await fetch(`${cfg.baseUrl}/pipeline/generate-captions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imageId,
      ...(humorFlavorId ? { humorFlavorId } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`generate-captions failed (${response.status}): ${await readErrorBody(response)}`);
  }

  return response.json();
}

export async function runCaptionPipelineFromImageUrl(args: {
  token: string;
  sourceImageUrl: string;
  humorFlavorId?: string;
}): Promise<PipelineCaptionResult> {
  const imageResponse = await fetch(args.sourceImageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download source image (${imageResponse.status}).`);
  }

  const detectedContentType = normalizeContentType(
    imageResponse.headers.get("content-type") ?? inferContentTypeFromUrl(args.sourceImageUrl) ?? "",
  );

  if (!SUPPORTED_IMAGE_CONTENT_TYPES.has(detectedContentType)) {
    throw new Error(
      `Unsupported image content type: ${detectedContentType || "unknown"}. Allowed: ${Array.from(SUPPORTED_IMAGE_CONTENT_TYPES).join(
        ", ",
      )}`,
    );
  }

  const bytes = await imageResponse.arrayBuffer();

  const { presignedUrl, cdnUrl } = await generatePresignedUrl(args.token, detectedContentType);

  const uploadResponse = await fetch(presignedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": detectedContentType,
    },
    body: bytes,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Presigned upload failed (${uploadResponse.status}): ${await readErrorBody(uploadResponse)}`);
  }

  const { imageId } = await registerImageUrl(args.token, cdnUrl);

  let raw: unknown;
  let warning: string | undefined;

  try {
    raw = await generateCaptions(args.token, imageId, args.humorFlavorId);
  } catch (error) {
    if (args.humorFlavorId) {
      raw = await generateCaptions(args.token, imageId);
      warning =
        error instanceof Error
          ? `Flavor-specific generation failed, returned default captions. ${error.message}`
          : "Flavor-specific generation failed, returned default captions.";
    } else {
      throw error;
    }
  }

  const captions = extractCaptionsFromPipelineResponse(raw);

  return {
    captions,
    imageId,
    uploadedCdnUrl: cdnUrl,
    raw,
    warning,
  };
}

export function getSupportedImageContentTypes() {
  return Array.from(SUPPORTED_IMAGE_CONTENT_TYPES);
}
