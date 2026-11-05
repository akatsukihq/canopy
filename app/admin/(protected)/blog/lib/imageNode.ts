import { Node } from "@tiptap/core";
import { z } from "zod";
import type { BlogImage } from "@/lib/blog/document";
import { BLOG_IMAGE_PUBLIC_ID } from "@/lib/blog/utils";
import { mediaRef, mediaUrl, type MediaRef } from "@/lib/media";

const safeText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const imageAttributes = z
  .object({
    media: mediaRef.refine((media) => BLOG_IMAGE_PUBLIC_ID.test(media.entry.publicId)),
    alt: safeText(500),
    caption: safeText(1000),
    displayWidth: z
      .number()
      .int()
      .min(10)
      .max(100)
      .nullish()
      .transform((value) => value ?? 100),
    alignment: z
      .enum(["left", "center", "right"])
      .nullish()
      .transform((value) => value ?? "center"),
  })
  .strict();

export function blogEditorImageSource(media: MediaRef): string {
  return mediaUrl(media);
}

/** Uploaded assets remain structured image nodes when copied or cut between editor positions. */
export const BlogImageNode = Node.create<{
  onUploadImage: (file: File) => Promise<BlogImage | null>;
}>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { onUploadImage: async () => null };
  },
  addAttributes() {
    const defaults = {
      media: null,
      alt: "",
      caption: "",
      displayWidth: 100,
      alignment: "center",
    };
    // The validated metadata is authoritative; raw figure attributes must not override it.
    return Object.fromEntries(
      Object.entries(defaults).map(([name, value]) => [
        name,
        { default: value, rendered: false, parseHTML: () => null },
      ]),
    );
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-blog-image]",
        getAttrs: (element) => {
          const metadata = element.getAttribute("data-blog-image");
          if (!metadata || metadata.length > 6144 || new TextEncoder().encode(metadata).length > 6144) return false;
          try {
            const input: unknown = JSON.parse(metadata);
            if (input && typeof input === "object" && Object.hasOwn(input, "__proto__")) return false;
            const parsed = imageAttributes.safeParse(input);
            if (
              !parsed.success ||
              element.querySelector("img")?.getAttribute("src") !== blogEditorImageSource(parsed.data.media)
            )
              return false;
            return parsed.data;
          } catch {
            return false;
          }
        },
      },
    ];
  },
  renderHTML({ node }) {
    const parsed = imageAttributes.safeParse(node.attrs);
    if (!parsed.success) return ["figure", {}];
    const attrs = parsed.data;
    return [
      "figure",
      {
        "data-blog-image": JSON.stringify(attrs),
        style: `width:${attrs.displayWidth}%;margin-left:${attrs.alignment === "left" ? "0" : "auto"};margin-right:${attrs.alignment === "right" ? "0" : "auto"}`,
      },
      [
        "img",
        {
          src: blogEditorImageSource(attrs.media),
          alt: attrs.alt,
          width: attrs.media.width,
          height: attrs.media.height,
          style: "width:100%;height:auto",
        },
      ],
      ["figcaption", {}, attrs.caption],
    ];
  },
});
