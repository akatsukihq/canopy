import { expect, test } from "vitest";
import { blogImageDelivery } from "../lib/blog/utils.ts";

const publicId = "Canopy/production/blog/95c40d91-c008-4474-965b-71ec2e4f2b81";
const media = ({ cloudName = "my-cloud", version = 1234, ...fields } = {}) => ({
  v: 1,
  provider: "cloudinary",
  format: "webp",
  width: 2400,
  height: 1200,
  uploadedAt: "2026-01-01T00:00:00.000Z",
  ...fields,
  entry: { cloudName, publicId, version },
});

test("responsive image candidates stay within the source width and delivery cap without duplicates", () => {
  for (const [width, expected] of [
    [1, [1]],
    [319, [319]],
    [320, [320]],
    [640, [320, 640]],
    [800, [320, 640, 800]],
    [1280, [320, 640, 960, 1280]],
    [2400, [320, 640, 960, 1280, 1920, 2400]],
    [2560, [320, 640, 960, 1280, 1920, 2560]],
    [30000, [320, 640, 960, 1280, 1920, 2560]],
  ]) {
    const delivery = blogImageDelivery({ media: media({ width }) });
    const candidates = delivery.srcSet.split(", ").map((candidate) => {
      const [url, descriptor] = candidate.split(" ");
      const candidateWidth = Number.parseInt(descriptor, 10);
      expect(descriptor).toBe(`${candidateWidth}w`);
      expect(candidateWidth <= width).toBeTruthy();
      expect(url).toBe(
        `https://res.cloudinary.com/my-cloud/image/upload/c_limit,w_${candidateWidth}/q_auto/f_auto/v1234/${publicId}.webp`,
      );
      return candidateWidth;
    });
    expect(candidates, `source width ${width}`).toEqual(expected);
    expect(delivery.src).toBe(
      `https://res.cloudinary.com/my-cloud/image/upload/c_limit,w_${Math.min(width, 1280)}/q_auto/f_auto/v1234/${publicId}.webp`,
    );
  }
});

test("delivery preserves immutable versions and source formats while requesting automatic quality and format", () => {
  for (const format of ["jpg", "jpeg", "png", "webp"]) {
    const source = Object.freeze(media({ format, version: 987654321, cloudName: "cloud_2" }));
    const delivery = blogImageDelivery({ media: source });
    for (const url of [delivery.src, ...delivery.srcSet.split(", ").map((candidate) => candidate.split(" ")[0])]) {
      expect(url.endsWith(`/q_auto/f_auto/v987654321/${publicId}.${format}`)).toBeTruthy();
    }
    expect(source.format).toBe(format);
    expect(source.width).toBe(2400);
  }
});

test("delivery encodes individual public ID segments while retaining their folder path", () => {
  const delivery = blogImageDelivery({
    media: {
      ...media({ width: 320 }),
      entry: { cloudName: "my-cloud", publicId: "folder name/diagram #1+é", version: 1234 },
    },
  });
  expect(delivery.src).toBe(
    "https://res.cloudinary.com/my-cloud/image/upload/c_limit,w_320/q_auto/f_auto/v1234/folder%20name/diagram%20%231%2B%C3%A9.webp",
  );
  expect(delivery.srcSet).toBe(`${delivery.src} 320w`);
});

test("delivery uses the cloud stored with each image", () => {
  expect(blogImageDelivery({ media: media({ width: 320, cloudName: "other-cloud" }) }).src).toBe(
    `https://res.cloudinary.com/other-cloud/image/upload/c_limit,w_320/q_auto/f_auto/v1234/${publicId}.webp`,
  );
});
