import { afterAll, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { cloudinaryFolder } from "../lib/cloudinary/paths.ts";

const originalEnv = Object.fromEntries(
  ["NODE_ENV", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].map((key) => [
    key,
    process.env[key],
  ]),
);
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
const uploads = vi.hoisted(() => []);
globalThis.__cloudinaryUploadTest = uploads;

vi.mock("cloudinary", () => ({
  v2: {
    config() {},
    uploader: {
      async upload(source, options) {
        uploads.push(options);
        return { public_id: options.public_id, version: 1, format: "png", width: 256, height: 256, bytes: 900, ...globalThis.__cloudinaryUploadResponse };
      },
    },
  },
}));

const { uploadToolIcon } = await import("@/lib/tool-framework/cloudinary.ts");
afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete globalThis.__cloudinaryUploadTest;
});

test("every environment keeps tool icon IDs and asset folders under its Canopy base", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const environment of ["production", "development", "test"]) {
    process.env.NODE_ENV = environment;
    const result = await uploadToolIcon("media.extract-pdf-pages", png, "image/png");
    expect(result.ok).toBe(true);
    const expectedFolder = `Canopy/${environment}/tool-icons`;
    expect(uploads.at(-1).asset_folder).toBe(expectedFolder);
    expect(uploads.at(-1).overwrite).toBe(true);
    expect(result.icon).toMatchObject({
      v: 1,
      provider: "cloudinary",
      format: "png",
      width: 256,
      height: 256,
      bytes: 900,
      entry: { cloudName: "test-cloud", publicId: `${expectedFolder}/media.extract-pdf-pages`, version: 1 },
    });
  }
  const count = uploads.length;
  delete process.env.NODE_ENV;
  await expect(uploadToolIcon("media.extract-pdf-pages", png, "image/png")).rejects.toThrow(/NODE_ENV/);
  expect(uploads.length).toBe(count);
});

test("upload folders require an environment and reject paths outside the base", () => {
  for (const environment of [undefined, "", "PROD", "../production"]) {
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
    expect(() => cloudinaryFolder("blog")).toThrow(/NODE_ENV/);
  }
  process.env.NODE_ENV = "production";
  expect(cloudinaryFolder("platform/assets/default/icons")).toBe("Canopy/production/platform/assets/default/icons");
  for (const folder of ["", "/blog", "../blog", "blog/../icons", "blog//icons", "blog\\icons"]) {
    expect(() => cloudinaryFolder(folder)).toThrow(/folder/);
  }
});

test("malformed Cloudinary responses never become saved icon URLs", async () => {
  process.env.NODE_ENV = "test";
  try {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const response of [
      { public_id: "other/icon" },
      { version: 0 },
      { version: "1" },
      { version: 1.5 },
      { version: Number.MAX_SAFE_INTEGER + 1 },
      { format: "svg" },
      { width: 0 },
    ]) {
      globalThis.__cloudinaryUploadResponse = response;
      expect(await uploadToolIcon("media.extract-pdf-pages", png, "image/png")).toEqual({
        ok: false,
        reason: "The icon could not be uploaded. Try again.",
      });
    }
  } finally {
    delete globalThis.__cloudinaryUploadResponse;
  }
});
