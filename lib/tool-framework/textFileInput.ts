import { getRuntimeLimits } from "./limits.ts";

export type TextFileReadResult = {
  readonly large: boolean;
  readonly text: string;
};

export async function readTextFileForEditor(
  file: File,
  options: {
    readonly maxEditableBytes?: number;
    readonly maxLength?: number;
    readonly previewBytes?: number;
  } = {},
): Promise<TextFileReadResult> {
  const { largeTextPreviewBytes, maxEditableTextChars } = getRuntimeLimits();
  const maxEditableBytes = Math.max(0, Math.min(options.maxEditableBytes ?? maxEditableTextChars, maxEditableTextChars));
  const large = file.size > maxEditableBytes;
  if (!large) {
    const text = await file.text();
    return {
      large: false,
      text: options.maxLength === undefined ? text : text.slice(0, Math.max(0, options.maxLength)),
    };
  }

  const previewBytes = Math.max(
    0,
    Math.min(options.previewBytes ?? largeTextPreviewBytes, largeTextPreviewBytes),
  );
  return {
    large: true,
    text: await readUtf8Prefix(file, previewBytes),
  };
}

async function readUtf8Prefix(file: File, limit: number): Promise<string> {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, limit)).arrayBuffer());
  const end = Math.min(limit, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let length = end; length >= Math.max(0, end - 3); length -= 1) {
    try {
      return decoder.decode(bytes.subarray(0, length));
    } catch {
      // The byte boundary may bisect a multi-byte UTF-8 code point.
    }
  }
  return new TextDecoder().decode(bytes.subarray(0, end));
}

export function isLargeTextFile(file: File | undefined, maxEditableBytes = getRuntimeLimits().maxEditableTextChars): boolean {
  return Boolean(file && file.size > maxEditableBytes);
}
