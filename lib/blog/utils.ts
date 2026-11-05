import type { BlogImage } from "./document.ts";
import { responsiveMedia } from "../media/index.ts";

/** Public IDs that blog uploads produce (legacy `smarttools/` and `cloudinaryFolder("blog")`). */
export const BLOG_IMAGE_PUBLIC_ID = /^(?:smarttools|Canopy\/(?:production|development|test))\/blog\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const BLOG_TITLE_WORD_LIMIT = 20;

export function blogTitleWordCount(title: string): number {
  return title.match(/\S+/gu)?.length ?? 0;
}

/** Responsive delivery for validated images; stored metadata and originals stay unchanged. */
export function blogImageDelivery(image: Pick<BlogImage, "media">): { src: string; srcSet: string } {
  return responsiveMedia(image.media);
}
