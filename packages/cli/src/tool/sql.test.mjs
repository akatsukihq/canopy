import { expect, test } from "vitest";

import { jsonLiteral, releaseSql, text } from "./sql.mjs";

const row = {
  tool_id: "devtools.xml-formatter",
  app: "devtools",
  slug: "xml-formatter",
  name: "XML Formatter",
  description: "Format O'Reilly XML.",
  translations: { en: { status: "published", messages: { name: "XML Formatter" } }, hi: { status: "published" } },
  spec: { toolId: "devtools.xml-formatter", settings: { fields: { b: {}, a: {} } } },
};

test("text literals escape quotes and keep NULL", () => {
  expect(text("O'Reilly")).toBe("'O''Reilly'");
  expect(text(null)).toBe("NULL");
});

test("JSON literals pick a dollar tag absent from the value and keep key order", () => {
  expect(jsonLiteral({ b: 1, a: 2 }, "json")).toBe('$json${"b":1,"a":2}$json$::json');
  expect(jsonLiteral({ v: "$json$" }, "jsonb")).toBe('$json1${"v":"$json$"}$json1$::jsonb');
});

test("a new tool is inserted disabled with English only", () => {
  const sql = releaseSql(row, null);
  expect(sql).toContain("INSERT INTO managed_tools");
  expect(sql).toContain("'Format O''Reilly XML.'");
  expect(sql).toContain("false, false");
  expect(sql).not.toContain('"hi"');
  expect(sql).not.toContain("tool_content");
});

test("an update replaces spec and English, refuses a slug change, and leaves other rows alone", () => {
  const sql = releaseSql(row, null, { update: true });
  expect(sql).toContain("tool.slug IS NOT DISTINCT FROM 'xml-formatter'");
  expect(sql).toContain("RAISE EXCEPTION");
  expect(sql).not.toContain("INSERT");
});

test("a tool without a spec or English cannot be released", () => {
  expect(() => releaseSql({ ...row, spec: null }, null)).toThrow("no spec");
  expect(() => releaseSql({ ...row, translations: {} }, null)).toThrow("Publish English");
});
