import type { CropBox } from "@/components/CropFrame";
import type { MediaFormat } from "@/lib/media";

type Bounds = { width: number; height: number };

export function validateCropDimensions({ width, height }: Bounds): void {
  if (
    ![width, height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 30000) ||
    width * height > 40_000_000
  ) {
    throw new Error(
      "This image is too large to crop here. Replace it with an image up to 40 megapixels and 30,000 pixels per side.",
    );
  }
}

export function fitCropRatio(bounds: Bounds, ratio: number | null): CropBox {
  const width = ratio ? Math.min(bounds.width, bounds.height * ratio) : bounds.width;
  const height = ratio ? width / ratio : bounds.height;
  return {
    x: Math.round((bounds.width - width) / 2),
    y: Math.round((bounds.height - height) / 2),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

// CropFrame's corner handle resizes from the top-left; movement keeps its size.
export function resizeCrop(next: CropBox, previous: CropBox, bounds: Bounds, ratio: number | null): CropBox {
  if (!ratio || (next.width === previous.width && next.height === previous.height)) return next;
  const widthChange = Math.abs(next.width - previous.width);
  const heightChange = Math.abs(next.height - previous.height) * ratio;
  const requestedWidth = widthChange >= heightChange ? next.width : next.height * ratio;
  const width = Math.max(1, Math.min(requestedWidth, bounds.width - next.x, (bounds.height - next.y) * ratio));
  return { ...next, width: Math.round(width), height: Math.max(1, Math.round(width / ratio)) };
}

export async function cropBlogImage(image: HTMLImageElement, box: CropBox, format: MediaFormat): Promise<File> {
  validateCropDimensions({ width: image.naturalWidth, height: image.naturalHeight });
  if (
    ![box.x, box.y, box.width, box.height].every(Number.isSafeInteger) ||
    box.x < 0 ||
    box.y < 0 ||
    box.width < 1 ||
    box.height < 1 ||
    box.x + box.width > image.naturalWidth ||
    box.y + box.height > image.naturalHeight
  ) {
    throw new Error("Choose a crop area within the image, then try again.");
  }
  const mime = format === "jpg" || format === "jpeg" ? "image/jpeg" : `image/${format}`;
  const canvas = document.createElement("canvas");
  try {
    canvas.width = box.width;
    canvas.height = box.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare the crop. Try again.");
    context.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      try {
        canvas.toBlob(resolve, mime, 0.92);
      } catch {
        reject(new Error("Could not crop this image. Reload it or replace it, then try again."));
      }
    });
    if (!blob?.size) throw new Error("Could not create the cropped image. Try again.");
    if (blob.type !== mime)
      throw new Error(
        `This browser does not support ${format.toUpperCase()} export. Try another browser or replace the image with a PNG.`,
      );
    if (blob.size > 5 * 1024 * 1024)
      throw new Error("The cropped image exceeds 5 MiB. Select a smaller area or replace it with a smaller image.");
    return new File([blob], `blog-image-crop.${format}`, { type: mime });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
