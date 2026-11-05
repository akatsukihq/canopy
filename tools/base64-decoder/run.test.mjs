import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { decodeToolShare, encodeToolShare } from "../../lib/tool-framework/toolShare.ts";
const definition = await toolSpec("base64-decoder");
import { run } from "./run.ts";

test("shared binary data URI recreates the same downloadable bytes and filename", async () => {
  const bytes = Uint8Array.from([0x00, 0xff, 0x80, 0x47, 0x49, 0x46, 0x00]);
  const original = {
    input: { text: `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}` },
    settings: {},
  };
  const encoded = encodeToolShare(definition, original);
  expect(encoded).toHaveProperty("hash");
  const decoded = decodeToolShare(definition, encoded.hash);
  expect(decoded).toEqual({ state: original });

  async function execute(state, jobId) {
    return run({
      ...state,
      input: { ...state.input, files: [] },
      signal: new AbortController().signal,
      progress() {},
      async writeArtifact(input) {
        const blob = new Blob([input.source], { type: input.mime });
        return {
          id: `${jobId}-decoded`,
          jobId,
          name: input.name,
          mime: input.mime,
          size: blob.size,
          createdAt: 0,
          storage: "blob",
          blob,
        };
      },
    });
  }

  const outputs = await Promise.all([execute(original, "sender"), execute(decoded.state, "recipient")]);
  for (const output of outputs) {
    expect(output.render).toBe("files");
    expect(output.files).toHaveLength(1);
    expect(output.files[0]).toMatchObject({
      name: "decoded.bin",
      mime: "application/octet-stream",
      size: bytes.length,
    });
    expect(new Uint8Array(await output.files[0].blob.arrayBuffer())).toEqual(bytes);
  }
});
