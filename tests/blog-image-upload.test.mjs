import { afterAll, afterEach, expect, test, vi } from "vitest";

const state = {};
globalThis.__blogDirectUploadTest = state;

vi.mock("@/app/admin/(protected)/blog/actions.ts", () => ({
  prepareBlogImageUploadAction: (...args) => globalThis.__blogDirectUploadTest.prepare(...args),
  completeBlogImageUploadAction: (...args) => globalThis.__blogDirectUploadTest.complete(...args),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: (error) => globalThis.__blogDirectUploadTest.errors.push(error),
}));

const { uploadBlogImageDirect } = await import("@/app/admin/(protected)/blog/lib/imageUpload.ts");
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(() => {
  delete globalThis.__blogDirectUploadTest;
});

const publicId = "production/blog/test";
const imageWith = ({ version = 1, format = "png", width = 640, height = 480, alt = "image" } = {}) => ({
  media: {
    v: 1,
    provider: "cloudinary",
    format,
    width,
    height,
    // The browser records the local file size and upload time.
    bytes: expect.any(Number),
    uploadedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    entry: { cloudName: "test-cloud", publicId, version },
  },
  alt,
  caption: "",
});
const image = imageWith();
const completion = {
  cloudName: "test-cloud",
  publicId,
  timestamp: 123,
  name: "image.png",
  size: 24,
  type: "image/png",
  token: "server-signed-token",
};
const prepared = {
  ok: true,
  data: {
    uploadUrl: "https://api.cloudinary.com/v1_1/test-cloud/image/upload",
    fields: { public_id: publicId, timestamp: "123", api_key: "public-key", signature: "signed-fields" },
    completion,
  },
};
const uploaded = {
  public_id: publicId,
  version: 1,
  format: "png",
  width: 640,
  height: 480,
  bytes: 128,
  resource_type: "image",
  type: "upload",
  secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v1/${publicId}.png`,
};
const response = () =>
  new Response(JSON.stringify({ ...uploaded, asset_id: "provider-extra-field", signature: "provider-signature" }));
function png(size = 24) {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  return new File([bytes], "image.png", { type: "image/png" });
}
function setup() {
  const calls = { prepare: [], complete: [], fetch: [] };
  state.errors = [];
  state.prepare = async (metadata) => {
    calls.prepare.push(metadata);
    return prepared;
  };
  state.complete = async (metadata) => {
    calls.complete.push(metadata);
    return { ok: true, data: image };
  };
  vi.stubGlobal("fetch", async (...args) => {
    calls.fetch.push(args);
    return response();
  });
  return calls;
}

test("a 1.51 MiB image uploads directly and forwards only image metadata with its completion ticket", async () => {
  const calls = setup();
  const file = png(Math.round(1.51 * 1024 * 1024));
  const result = await uploadBlogImageDirect(file);
  expect(result).toEqual({ ok: true, data: image });
  expect(result.data.media.bytes).toBe(file.size);
  expect(calls.prepare).toEqual([{ name: file.name, size: file.size, type: file.type }]);
  const [url, request] = calls.fetch[0];
  expect(url).toBe(prepared.data.uploadUrl);
  expect(request.method).toBe("POST");
  expect(request.credentials).toBe("omit");
  expect(request.redirect).toBe("error");
  expect(request.signal.aborted).toBe(false);
  expect(request.body.get("file")).toBe(file);
  expect(await request.body.get("file").arrayBuffer()).toEqual(await file.arrayBuffer());
  expect([...request.body.keys()].sort()).toEqual([...Object.keys(prepared.data.fields), "file"].sort());
  for (const [name, value] of Object.entries(prepared.data.fields)) expect(request.body.get(name)).toBe(value);
  expect(calls.complete).toEqual([{ ...completion, uploaded }]);
});

test("completion waits for a successful upload response", async () => {
  const calls = setup();
  let release;
  let entered;
  const uploading = new Promise((resolve) => {
    entered = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  vi.stubGlobal("fetch", () => {
    entered();
    return pending;
  });
  const result = uploadBlogImageDirect(png());
  await uploading;
  expect(calls.complete.length).toBe(0);
  release(response());
  expect(await result).toEqual({ ok: true, data: image });
  expect(calls.complete).toEqual([{ ...completion, uploaded }]);
});

test("invalid or mismatched files fail before signing", async () => {
  const calls = setup();
  for (const file of [
    new File([], "empty.png", { type: "image/png" }),
    png(5 * 1024 * 1024 + 1),
    new File(["script"], "image.svg", { type: "image/svg+xml" }),
    new File(["bad"], "image.png", { type: "image/png" }),
  ]) {
    expect((await uploadBlogImageDirect(file)).ok).toBe(false);
  }
  expect(calls.prepare.length).toBe(0);
  expect(calls.fetch.length).toBe(0);
});

for (const [name, provider, expected] of [
  [
    "network failure",
    () => {
      throw new Error("secret provider internals");
    },
    /connection/,
  ],
  ["rejected upload", () => new Response("secret provider internals", { status: 403 }), /rejected/],
  ["rate limit", () => new Response("secret provider internals", { status: 429 }), /busy/],
  ["provider outage", () => new Response("secret provider internals", { status: 503 }), /temporarily unavailable/],
  ["malformed JSON", () => new Response("secret provider internals"), /try uploading again/i],
  ["mismatched upload", () => new Response(JSON.stringify({ public_id: "different" })), /incomplete/],
]) {
  test(`${name} returns a friendly retry message without finalizing`, async () => {
    const calls = setup();
    vi.stubGlobal("fetch", provider);
    const result = await uploadBlogImageDirect(png());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(expected);
    expect(result.message).not.toMatch(/secret|internals/);
    expect(calls.complete.length).toBe(0);
  });
}

const invalidMetadata = [
  ["null response", null],
  ["array response", [uploaded]],
  ["empty response", {}],
  ...Object.keys(uploaded).map((field) => [
    `missing ${field}`,
    Object.fromEntries(Object.entries(uploaded).filter(([key]) => key !== field)),
  ]),
  ...[
    ["public_id", "different/image"],
    ["version", 0],
    ["version", 1.5],
    ["version", Number.MAX_SAFE_INTEGER + 1],
    ["version", "1"],
    ["format", "svg"],
    ["width", 0],
    ["width", 30_001],
    ["width", 1.5],
    ["width", "640"],
    ["height", 0],
    ["height", 30_001],
    ["height", 1.5],
    ["height", "480"],
    ["bytes", 0],
    ["bytes", 5 * 1024 * 1024 + 1],
    ["bytes", 1.5],
    ["bytes", "128"],
    ["resource_type", "video"],
    ["type", "private"],
    ["secure_url", uploaded.secure_url.replace("https:", "http:")],
    ["secure_url", uploaded.secure_url.replace("test-cloud", "other-cloud")],
    ["secure_url", uploaded.secure_url.replace("res.cloudinary.com", "res.cloudinary.com.invalid")],
    ["secure_url", uploaded.secure_url.replace("/v1/", "/v2/")],
    ["secure_url", uploaded.secure_url.replace("/upload/", "/upload/c_scale,w_20/")],
    ["secure_url", `${uploaded.secure_url}?download=true`],
    ["secure_url", `${uploaded.secure_url}#fragment`],
  ].map(([field, value]) => [`invalid ${field}: ${JSON.stringify(value)}`, { ...uploaded, [field]: value }]),
];

for (const [name, metadata] of invalidMetadata) {
  test(`${name} fails locally before background completion`, async () => {
    const calls = setup();
    vi.stubGlobal("fetch", (...args) => {
      calls.fetch.push(args);
      return new Response(JSON.stringify(metadata));
    });
    const result = await uploadBlogImageDirect(png());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/incomplete|invalid|try uploading again/i);
    expect(calls.fetch.length).toBe(1);
    expect(calls.complete.length).toBe(0);
    expect(state.errors.length).toBe(0);
  });
}

for (const metadata of [
  ...["png", "jpg", "jpeg", "webp"].map((format) => ({ ...uploaded, format })),
  { ...uploaded, version: Number.MAX_SAFE_INTEGER, width: 30_000, height: 30_000, bytes: 5 * 1024 * 1024 },
  { ...uploaded, width: 1, height: 1, bytes: 1 },
]) {
  const providerMetadata = {
    ...metadata,
    secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v${metadata.version}/${metadata.public_id}.${metadata.format}`,
  };
  test(`valid ${metadata.format} metadata accepts ${metadata.width}×${metadata.height} and ${metadata.bytes} bytes`, async () => {
    const calls = setup();
    vi.stubGlobal("fetch", () => new Response(JSON.stringify(providerMetadata)));
    expect(await uploadBlogImageDirect(png())).toEqual({
      ok: true,
      data: imageWith({
        version: metadata.version,
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
      }),
    });
    expect(calls.complete).toEqual([{ ...completion, uploaded: providerMetadata }]);
    expect(state.errors.length).toBe(0);
  });
}

test("a completion cloud that differs from the signed upload URL fails before uploading", async () => {
  const calls = setup();
  state.prepare = async () => ({
    ...prepared,
    data: { ...prepared.data, completion: { ...completion, cloudName: "other-cloud" } },
  });
  expect((await uploadBlogImageDirect(png())).ok).toBe(false);
  expect(calls.fetch.length).toBe(0);
  expect(calls.complete.length).toBe(0);
});

test("prepare failure remains a failure and does not upload or complete", async () => {
  const calls = setup();
  state.prepare = async () => ({ ok: false, message: "You do not have permission to upload images." });
  expect(await uploadBlogImageDirect(png())).toEqual({
    ok: false,
    message: "You do not have permission to upload images.",
  });
  expect(calls.fetch.length).toBe(0);
  expect(calls.complete.length).toBe(0);
  expect(state.errors.length).toBe(0);
});

for (const [name, complete] of [
  ["failed", async () => ({ ok: false, message: "private server failure" })],
  [
    "rejected",
    async () => {
      throw new Error("private server error");
    },
  ],
]) {
  test(`${name} background completion preserves the uploaded image and reports one generic error`, async () => {
    const calls = setup();
    state.complete = (...args) => {
      calls.complete.push(...args);
      return complete();
    };
    expect(await uploadBlogImageDirect(png())).toEqual({ ok: true, data: image });
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls.complete).toEqual([{ ...completion, uploaded }]);
    expect(state.errors.length).toBe(1);
    expect(state.errors[0]).toBeInstanceOf(Error);
    expect(state.errors[0].message).not.toMatch(/private|server failure|server error/);
  });
}

test("success uses verified provider metadata without a response signature or completion result", async () => {
  const calls = setup();
  vi.stubGlobal("fetch", (...args) => {
    calls.fetch.push(args);
    return new Response(JSON.stringify(uploaded));
  });
  state.complete = async (metadata) => {
    calls.complete.push(metadata);
    return { ok: true, data: { ...image, alt: "completion result must not replace the image", width: 1 } };
  };
  expect(await uploadBlogImageDirect(png())).toEqual({ ok: true, data: image });
  expect(calls.fetch.length).toBe(1);
  expect(calls.complete).toEqual([{ ...completion, uploaded }]);
  expect(state.errors.length).toBe(0);
});

for (const [name, alt] of [
  ["  article_header--final.png", "article header final"],
  ["notes.2026.JPEG", "notes.2026"],
  ["line\tbreak\u0000image.webp", "line break image"],
]) {
  test(`image alt text is normalized from the signed completion name ${JSON.stringify(name)}`, async () => {
    setup();
    state.prepare = async () => ({ ...prepared, data: { ...prepared.data, completion: { ...completion, name } } });
    expect(await uploadBlogImageDirect(png())).toEqual({ ok: true, data: { ...image, alt } });
  });
}

for (const stage of ["prepare", "fetch"]) {
  test(`120-second deadline bounds ${stage} and prevents late continuation or success`, async () => {
    const calls = setup();
    let expire;
    vi.stubGlobal("setTimeout", (callback, delay) => {
      expect(delay).toBe(120_000);
      expire = callback;
      return 1;
    });
    vi.stubGlobal("clearTimeout", () => {});
    let release;
    let entered;
    const reachedStage = new Promise((resolve) => {
      entered = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    if (stage === "fetch")
      vi.stubGlobal("fetch", (...args) => {
        calls.fetch.push(args);
        entered();
        return pending;
      });
    else {
      state[stage] = (...args) => {
        calls[stage].push(...args);
        entered();
        return pending;
      };
    }
    const result = uploadBlogImageDirect(png());
    await reachedStage;
    expire();
    const failed = await result;
    expect(failed.ok).toBe(false);
    expect(failed.message).toMatch(/timed out/);
    if (calls.fetch.length) expect(calls.fetch[0][1].signal.aborted).toBe(true);
    release(stage === "prepare" ? prepared : response());
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls.complete.length).toBe(0);
    if (stage === "prepare") expect(calls.fetch.length).toBe(0);
    expect(await result).toEqual(failed);
  });
}

for (const rejects of [false, true]) {
  test(`pending completion returns success, clears the deadline, and preserves success after a late ${rejects ? "rejection" : "failure"}`, async () => {
    const calls = setup();
    const timer = {};
    const cleared = [];
    vi.stubGlobal("setTimeout", (_callback, delay) => {
      expect(delay).toBe(120_000);
      return timer;
    });
    vi.stubGlobal("clearTimeout", (handle) => cleared.push(handle));
    let entered;
    const reachedCompletion = new Promise((resolve) => {
      entered = resolve;
    });
    let release;
    const pending = new Promise((resolve, reject) => {
      release = rejects ? reject : resolve;
    });
    state.complete = (metadata) => {
      calls.complete.push(metadata);
      entered();
      return pending;
    };
    const result = uploadBlogImageDirect(png());
    await reachedCompletion;
    const returned = await Promise.race([
      result,
      new Promise((resolve) => setImmediate(() => resolve("still waiting for completion"))),
    ]);
    expect(returned).toEqual({ ok: true, data: image });
    expect(cleared).toEqual([timer]);
    expect(state.errors.length).toBe(0);
    release(rejects ? new Error("private late rejection") : { ok: false, message: "private late failure" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(await result).toEqual(returned);
    expect(calls.fetch[0][1].signal.aborted).toBe(false);
    expect(calls.complete).toEqual([{ ...completion, uploaded }]);
    expect(state.errors.length).toBe(1);
    expect(state.errors[0]).toBeInstanceOf(Error);
    expect(state.errors[0].message).not.toMatch(/private|late rejection|late failure/);
    expect(cleared).toEqual([timer]);
  });
}
