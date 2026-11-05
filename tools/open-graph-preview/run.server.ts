import type { ToolLinkPreviewImage, ToolLinkPreviewRender } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import { fetchPublicResource, parsePublicUrl } from "./fetchPage.ts";
import { parseMetadata } from "./metadata.ts";

type Settings = {};

function isRasterImage(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString());
  if (mime === "image/webp")
    return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  return (
    mime === "image/avif" &&
    bytes.subarray(4, 8).toString() === "ftyp" &&
    /avif|avis/.test(bytes.subarray(8, 32).toString())
  );
}

export async function inspectPage(
  value: string,
  signal: AbortSignal,
  network?: Parameters<typeof fetchPublicResource>[3],
): Promise<ToolLinkPreviewRender> {
  const requestedUrl = parsePublicUrl(value).href;
  const timedSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const page = await fetchPublicResource(requestedUrl, "html", timedSignal, network);
  const parsed = parseMetadata(page.bytes.toString("utf8"), page.url);
  const checks = [...parsed.checks];
  const images = new Map<string, Promise<ToolLinkPreviewImage>>();
  async function loadImage(image: ToolLinkPreviewImage | null): Promise<ToolLinkPreviewImage | null> {
    if (!image) return null;
    let pending = images.get(image.url);
    if (!pending) {
      pending = (async () => {
        try {
          const resource = await fetchPublicResource(image.url, "image", timedSignal, network);
          if (!isRasterImage(resource.bytes, resource.contentType))
            throw new ToolError(
              "unsupported-content",
              "The image response does not match its declared format.",
              undefined,
              { messageRef: { key: "errors.imageFormatMismatch" } },
            );
          return { ...image, previewUrl: `data:${resource.contentType};base64,${resource.bytes.toString("base64")}` };
        } catch (error) {
          signal.throwIfAborted();
          checks.push({
            property: "image:fetch",
            level: "warn",
            label: "Image preview unavailable",
            labelMessage: { key: "checks.imageUnavailable" },
            detailMessage: error instanceof ToolError ? error.details?.messageRef : { key: "checks.imageTimedOut" },
            detail:
              error instanceof ToolError
                ? error.message
                : "The image could not be downloaded within the preview time limit.",
          });
          return image;
        }
      })();
      images.set(image.url, pending);
    }
    const fetched = await pending;
    return { ...image, previewUrl: fetched.previewUrl };
  }
  const [image, twitterImage] = await Promise.all([
    loadImage(parsed.metadata.image),
    loadImage(parsed.metadata.twitter.image),
  ]);
  signal.throwIfAborted();
  return {
    render: "link-preview",
    requestedUrl,
    resolvedUrl: page.url,
    metadata: { ...parsed.metadata, image, twitter: { ...parsed.metadata.twitter, image: twitterImage } },
    tags: parsed.tags,
    checks,
    downloadName: "open-graph-tags.html",
  };
}

export const run: ToolRun<Settings> = (context) => inspectPage(context.input.text, context.signal);
export default run;
