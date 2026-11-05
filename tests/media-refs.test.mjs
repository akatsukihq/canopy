import { expect, test } from "vitest";
import { mediaAccount, mediaRef, mediaUrl, responsiveMedia } from "@/lib/media/index.ts";

const ref = {
  v: 1,
  provider: "cloudinary",
  format: "webp",
  width: 1500,
  height: 1000,
  uploadedAt: "2026-11-04T00:00:00Z",
  entry: { cloudName: "acct", publicId: "Canopy/production/blog/a b", version: 9 },
};
const base = "https://res.cloudinary.com/acct/image/upload";

test("cloudinary URLs come from the record's own account and keep the legacy shapes", () => {
  expect(mediaUrl(ref)).toBe(`${base}/v9/Canopy/production/blog/a%20b.webp`);
  expect(mediaUrl(ref, { width: 256, height: 256, fit: "fill", format: "png" })).toBe(
    `${base}/f_png,c_fill,w_256,h_256,q_auto/v9/Canopy/production/blog/a%20b.png`,
  );
  expect(mediaUrl(ref, { width: 640, fit: "limit", format: "auto" })).toBe(
    `${base}/c_limit,w_640/q_auto/f_auto/v9/Canopy/production/blog/a%20b.webp`,
  );
  expect(mediaAccount(ref)).toBe("cloudinary:acct");
});

test("responsive widths stop at the original width", () => {
  const { src, srcSet } = responsiveMedia(ref);
  expect(src).toContain("c_limit,w_1280/");
  expect(srcSet.split(", ").map((entry) => entry.split(" ")[1])).toEqual(["320w", "640w", "960w", "1280w", "1500w"]);
});

test("records from unknown providers or with unsafe entries are rejected", () => {
  expect(mediaRef.safeParse(ref).success).toBe(true);
  for (const bad of [
    { ...ref, provider: "s3" },
    { ...ref, v: 2 },
    { ...ref, format: "svg" },
    { ...ref, extra: true },
    { ...ref, entry: { ...ref.entry, cloudName: "a/b" } },
    { ...ref, entry: { ...ref.entry, publicId: "a/../b?x" } },
    { ...ref, entry: { ...ref.entry, publicId: "a//b" } },
    { ...ref, entry: { ...ref.entry, publicId: "a/../b" } },
    { ...ref, entry: { ...ref.entry, publicId: "./b" } },
    { ...ref, entry: { ...ref.entry, version: 0 } },
  ]) {
    expect(mediaRef.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  }
});
