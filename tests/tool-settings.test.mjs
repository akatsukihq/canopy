import { allToolSpecs } from "./helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePageSelection, parseSettings } from "../lib/tool-framework/settings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The closed union, read from the source rather than copied, so a new field
// kind cannot be added without this suite noticing.
const settingsSource = await readFile(path.join(ROOT, "lib/tool-framework/settings.ts"), "utf8");
const FIELD_KINDS = new Set(
  [
    ...(/export type FieldSpec =([\s\S]*?)\nexport type FieldKind/.exec(settingsSource)?.[1] ?? "").matchAll(
      /kind:\s*"([a-z]+)"/g,
    ),
  ].map((match) => match[1]),
);

/**
 * Inline fixture covering every field kind. Migrated tool specs are checked
 * against the same assertions below; this fixture is what gives the suite real
 * coverage before any tool has landed on the new contract.
 */
const FIXTURE = {
  fields: {
    title: { kind: "text", label: "Title", default: "Report", maxLength: 20 },
    notes: { kind: "textarea", label: "Notes", default: "" },
    secret: { kind: "password", label: "Secret", default: "" },
    copies: { kind: "number", label: "Copies", default: 3, min: 1, max: 10 },
    quality: { kind: "slider", label: "Quality", default: 80, min: 0, max: 100 },
    flatten: { kind: "toggle", label: "Flatten", default: true },
    format: {
      kind: "select",
      label: "Format",
      default: "png",
      choices: [
        { label: "PNG", value: "png" },
        { label: "JPEG", value: "jpeg" },
      ],
    },
    preset: {
      kind: "preset",
      label: "Preset",
      default: "web",
      choices: [
        { label: "Web", value: "web", detail: "72dpi" },
        { label: "Print", value: "print" },
      ],
    },
    tint: { kind: "color", label: "Tint", default: "#ff0000" },
    backdrop: {
      kind: "color",
      label: "Backdrop",
      default: "transparent",
      allowTransparent: true,
    },
    issued: { kind: "date", label: "Issued", default: "2026-01-31" },
    anchor: { kind: "position", label: "Anchor", default: "bottom-right" },
    pages: { kind: "pages", label: "Pages", default: "all" },
    subset: { kind: "pages", label: "Subset", default: [1, 3, 5] },
    // `visibleWhen` must point at a sibling key in the same spec.
    watermark: {
      kind: "text",
      label: "Watermark",
      default: "",
      visibleWhen: { key: "flatten", equals: true },
    },
    headers: {
      kind: "rows",
      label: "Headers",
      default: [{ key: "x", value: "1" }],
      keyLabel: "Key",
      valueLabel: "Value",
    },
  },
};

// ---------------------------------------------------------------------------
// Spec-shape invariants — run against the fixture and every migrated tool spec.
// ---------------------------------------------------------------------------

const migratedSpecs = (await allToolSpecs()).flatMap((spec) =>
  spec.settings ? [[spec.toolId.split(".")[1], spec.settings, spec.content?.examples ?? []]] : [],
);

const specsUnderTest = [["<fixture>", FIXTURE], ...migratedSpecs];

test("every field declares a kind from the closed union", () => {
  expect(FIELD_KINDS.size > 0, "FieldSpec union must be parseable").toBeTruthy();
  for (const [name, spec] of specsUnderTest) {
    for (const [key, field] of Object.entries(spec.fields)) {
      expect(FIELD_KINDS.has(field.kind), `${name}.${key}: unknown kind "${field.kind}"`).toBeTruthy();
    }
  }
  // The fixture must keep exercising the whole union.
  const covered = new Set(Object.values(FIXTURE.fields).map((field) => field.kind));
  expect(
    [...FIELD_KINDS].filter((kind) => !covered.has(kind)),
    "the fixture must cover every field kind",
  ).toEqual([]);
});

test("visibleWhen points at a key in the same spec", () => {
  for (const [name, spec] of specsUnderTest) {
    for (const [key, field] of Object.entries(spec.fields)) {
      if (!field.visibleWhen) continue;
      expect(
        Object.hasOwn(spec.fields, field.visibleWhen.key),
        `${name}.${key}: visibleWhen references unknown key "${field.visibleWhen.key}"`,
      ).toBeTruthy();
      expect(field.visibleWhen.key, `${name}.${key}: visibleWhen is self-referential`).not.toBe(key);
    }
  }
});

test("select and preset choices are non-empty and contain the default", () => {
  for (const [name, spec] of specsUnderTest) {
    for (const [key, field] of Object.entries(spec.fields)) {
      if (field.kind !== "select" && field.kind !== "preset") continue;
      expect(field.choices.length > 0, `${name}.${key}: choices must be non-empty`).toBeTruthy();
      expect(
        field.choices.some((choice) => choice.value === field.default),
        `${name}.${key}: default "${field.default}" is not among the choices`,
      ).toBeTruthy();
    }
  }
});

test("declared defaults round-trip through parseSettings unchanged", () => {
  for (const [name, spec] of specsUnderTest) {
    const defaults = Object.fromEntries(Object.entries(spec.fields).map(([key, field]) => [key, field.default]));
    expect(
      parseSettings(spec, defaults),
      `${name}: defaults must survive a parse (check maxLength truncation and min/max clamping)`,
    ).toEqual(defaults);
    // Absent input must produce the same settings as explicit defaults.
    expect(parseSettings(spec, {}), `${name}: empty input must yield defaults`).toEqual(defaults);
  }
});

test("example settings reference declared fields and survive parsing", () => {
  for (const [name, spec, examples] of migratedSpecs) {
    for (const example of examples) {
      if (!example.settings) continue;
      const parsed = parseSettings(spec, example.settings);
      for (const [key, value] of Object.entries(example.settings)) {
        expect(
          Object.hasOwn(spec.fields, key),
          `${name}: example "${example.label}" references unknown setting "${key}"`,
        ).toBeTruthy();
        expect(parsed[key], `${name}: example "${example.label}" has an invalid value for "${key}"`).toEqual(value);
      }
    }
  }
});

test("pages defaults parse", () => {
  for (const [name, spec] of specsUnderTest) {
    for (const [key, field] of Object.entries(spec.fields)) {
      if (field.kind !== "pages") continue;
      const parsed = parseSettings(spec, { [key]: field.default })[key];
      expect(
        parsed === "all" || (Array.isArray(parsed) && parsed.length > 0),
        `${name}.${key}: pages default did not parse`,
      ).toBeTruthy();
    }
  }
});

// ---------------------------------------------------------------------------
// Trust boundary. `raw` arrives from postMessage and HTTP.
// ---------------------------------------------------------------------------

const HOSTILE_ROOTS = [
  null,
  undefined,
  "not an object",
  42,
  true,
  [],
  [{ title: "x" }],
  Symbol.iterator,
  () => {},
  new Map([["title", "x"]]),
  { unknownKey: "ignored", anotherJunkKey: { nested: true } },
  JSON.parse('{"__proto__": {"polluted": true}}'),
];

test("parseSettings never throws on hostile input and always returns defaults", () => {
  const defaults = Object.fromEntries(Object.entries(FIXTURE.fields).map(([key, field]) => [key, field.default]));
  for (const raw of HOSTILE_ROOTS) {
    let parsed;
    expect(() => {
      parsed = parseSettings(FIXTURE, raw);
    }).not.toThrow();
    expect(Object.keys(parsed).sort(), `${String(raw)}: result must declare exactly the spec's keys`).toEqual(
      Object.keys(FIXTURE.fields).sort(),
    );
    expect(parsed, `${String(raw)}: must fall back to defaults`).toEqual(defaults);
  }
});

test("wrong-typed values fall back to the declared default", () => {
  const hostile = {
    title: 123,
    notes: [],
    secret: { toString: () => "leak" },
    copies: "not a number",
    quality: Number.NaN,
    flatten: "maybe",
    format: "gif",
    preset: "",
    tint: "red",
    backdrop: "#zzzzzz",
    issued: "31-01-2026",
    anchor: "outer-space",
    pages: {},
    subset: [0, -1],
    watermark: null,
    headers: [{ key: 1, value: 2 }],
  };
  const parsed = parseSettings(FIXTURE, hostile);
  for (const [key, field] of Object.entries(FIXTURE.fields)) {
    expect(parsed[key], `${key}: wrong type must fall back`).toEqual(field.default);
  }
});

test("numbers clamp to min and max instead of escaping the range", () => {
  const low = parseSettings(FIXTURE, { copies: -999, quality: -1 });
  expect(low.copies).toBe(1);
  expect(low.quality).toBe(0);

  const high = parseSettings(FIXTURE, { copies: 1e9, quality: 1000 });
  expect(high.copies).toBe(10);
  expect(high.quality).toBe(100);

  // Numeric strings from an HTML form or a query string are still clamped.
  expect(parseSettings(FIXTURE, { copies: "42" }).copies).toBe(10);
  // Non-finite input is not a number.
  expect(parseSettings(FIXTURE, { copies: Number.POSITIVE_INFINITY }).copies).toBe(3);
});

test("text is truncated to maxLength rather than rejected", () => {
  const long = "x".repeat(500);
  expect(parseSettings(FIXTURE, { title: long }).title.length).toBe(20);
  // textarea and password have no length bound and must not silently truncate.
  expect(parseSettings(FIXTURE, { notes: long }).notes.length).toBe(500);
});

test("out-of-choice select and preset values fall back", () => {
  expect(parseSettings(FIXTURE, { format: "jpeg" }).format).toBe("jpeg");
  expect(parseSettings(FIXTURE, { format: "exe" }).format).toBe("png");
  expect(parseSettings(FIXTURE, { preset: "print" }).preset).toBe("print");
  expect(parseSettings(FIXTURE, { preset: "__proto__" }).preset).toBe("web");
});

test("pages accepts expressions, lists and 'all', and rejects junk", () => {
  expect(parseSettings(FIXTURE, { pages: "all" }).pages).toBe("all");
  expect(parseSettings(FIXTURE, { pages: "1,3,5-7" }).pages).toEqual([1, 3, 5, 6, 7]);
  expect(parseSettings(FIXTURE, { pages: [2, 2, 4] }).pages).toEqual([2, 4]);
  expect(parseSettings(FIXTURE, { pages: "3-1" }).pages).toBe("all");
  expect(parseSettings(FIXTURE, { subset: [1.5] }).subset).toEqual([1, 3, 5]);
});

test("parsePageSelection is total over untrusted strings", () => {
  expect(parsePageSelection("all")).toBe("all");
  expect(parsePageSelection("")).toEqual([]);
  expect(parsePageSelection("   ")).toEqual([]);
  expect(parsePageSelection("banana")).toEqual([]);
  expect(parsePageSelection("0")).toEqual([]);
  expect(parsePageSelection("-1")).toEqual([]);
  expect(parsePageSelection("1-999999999"), "unbounded ranges must not allocate").toEqual([]);
  expect(parsePageSelection("1,1,2"), "duplicates collapse").toEqual([1, 2]);
  expect(parsePageSelection("odd"), "odd needs a page count").toEqual([]);
  expect(parsePageSelection("odd", 5)).toEqual([1, 3, 5]);
  expect(parsePageSelection("even", 5)).toEqual([2, 4]);
  expect(parsePageSelection("1-9", 5), "a range past the end is rejected").toEqual([]);
});

test("rows only accept well-formed key/value pairs", () => {
  expect(parseSettings(FIXTURE, { headers: [] }).headers).toEqual([]);
  expect(parseSettings(FIXTURE, { headers: [{ key: "a", value: "b" }] }).headers).toEqual([{ key: "a", value: "b" }]);
  expect(parseSettings(FIXTURE, { headers: ["a=b"] }).headers).toEqual([{ key: "x", value: "1" }]);
});

test("colors and dates are validated, not echoed", () => {
  expect(parseSettings(FIXTURE, { tint: "#0f0" }).tint).toBe("#0f0");
  expect(parseSettings(FIXTURE, { tint: "javascript:alert(1)" }).tint).toBe("#ff0000");
  expect(parseSettings(FIXTURE, { backdrop: "transparent" }).backdrop).toBe("transparent");
  expect(parseSettings(FIXTURE, { tint: "transparent" }).tint).toBe("#ff0000");
  expect(parseSettings(FIXTURE, { issued: "not-a-date" }).issued).toBe("2026-01-31");
  expect(parseSettings(FIXTURE, { issued: "2026-13-01" }).issued).toBe("2026-01-31");
  expect(parseSettings(FIXTURE, { issued: "2026-12-01" }).issued).toBe("2026-12-01");
});

test("settings.ts hardening", async (t) => {
  await (() => {
    // `Date.parse("2026-02-30")` rolls over to March 2 instead of returning
    // NaN, so the value has to be round-tripped to be rejected.
    expect(parseSettings(FIXTURE, { issued: "2026-02-30" }).issued).toBe("2026-01-31");
    expect(parseSettings(FIXTURE, { issued: "2025-02-29" }).issued).toBe("2026-01-31");
    expect(parseSettings(FIXTURE, { issued: "2026-04-31" }).issued).toBe("2026-01-31");
    expect(parseSettings(FIXTURE, { issued: "2024-02-29" }).issued).toBe("2024-02-29");
  })();
  await (() => {
    // A caller-constructed object with a poisoned prototype must not supply
    // values. Not reachable through postMessage or JSON.parse today (neither
    // preserves a prototype), so this is hardening, not a live hole.
    const poisoned = Object.create({ title: "injected", copies: 999 });
    expect(parseSettings(FIXTURE, poisoned).title).toBe(FIXTURE.fields.title.default);
    expect(parseSettings(FIXTURE, poisoned).copies).toBe(FIXTURE.fields.copies.default);
  })();
});

test("parseSettings does not mutate the spec or the raw input", () => {
  const raw = { title: "kept", copies: 999 };
  const snapshot = structuredClone(raw);
  const specSnapshot = structuredClone(FIXTURE);
  parseSettings(FIXTURE, raw);
  expect(raw).toEqual(snapshot);
  expect(FIXTURE).toEqual(specSnapshot);
});
