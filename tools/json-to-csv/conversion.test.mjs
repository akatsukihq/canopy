import { expect, test } from "vitest";
import { convertJsonToCsv } from "../../lib/devtools/shared/csv.ts";
import { run } from "./run.ts";

const convert = (text, settings = {}) =>
  run({
    input: { text, files: [] },
    settings: { delimiter: ",", repairMode: "off", ...settings },
    signal: new AbortController().signal,
  });

test("JSON to CSV preserves the CSV artifact and provides matching table cells", () => {
  const result = convert('[{"name":"Ada","active":false},{"name":"Lin","count":0}]');

  expect(result.render).toBe("text");
  expect(result.downloadName).toBe("data.csv");
  expect(result.text).toBe("name,active,count\nAda,false,\nLin,,0");
  expect(result.tablePreview).toEqual({
    render: "table",
    columns: ["name", "active", "count"],
    rows: [
      ["Ada", "false", ""],
      ["Lin", "", "0"],
    ],
    showColumnDividers: true,
    truncated: false,
  });
  expect(result.stats).toEqual([
    { label: "Rows", labelMessage: { key: "execution.rows" }, value: "2" },
    { label: "Columns", labelMessage: { key: "execution.columns" }, value: "3" },
  ]);
});

test("JSON to CSV previews quoted values and line breaks for every delimiter", () => {
  for (const delimiter of [",", ";", "\t", "|"]) {
    const column = `name${delimiter}label`;
    const value = `  Ada${delimiter}\"Lovelace\"\nnext\r\nline  `;
    const result = convert(JSON.stringify([{ [column]: value, plain: "end" }]), { delimiter });

    expect(result.text).toBe(
      `"${column}"${delimiter}plain\n"  Ada${delimiter}\"\"Lovelace\"\"\nnext\r\nline  "${delimiter}end`,
    );
    expect(result.tablePreview.columns).toEqual([column, "plain"]);
    expect(result.tablePreview.rows).toEqual([[value, "end"]]);
  }
});

test("JSON to CSV retains all-empty rows in both artifact and preview", () => {
  const result = convert('[{"note":""},{"note":null},{}]');

  expect(result.text).toBe("note\n\n\n");
  expect(result.tablePreview.rows).toEqual([[""], [""], [""]]);
  expect(result.stats[0].value).toBe("3");
});

test("JSON to CSV shares flattened and JSON-encoded cell values with its preview", () => {
  const result = convertJsonToCsv(
    JSON.stringify([
      { profile: { city: "Pune" }, tags: ["a", { b: [2] }], empty: {} },
      { tags: [], active: false, count: 0 },
    ]),
  );

  expect(result.ok).toBe(true);
  expect(result.columns).toEqual(["profile.city", "tags", "empty", "active", "count"]);
  expect(result.rows).toEqual([
    ["Pune", '["a",{"b":[2]}]', "{}", "", ""],
    ["", "[]", "", "false", "0"],
  ]);
  expect(result.output).toBe('profile.city,tags,empty,active,count\nPune,"[""a"",{""b"":[2]}]",{},,\n,[],,false,0');
});

test("JSON to CSV applies repair mode to both representations", () => {
  const source = '[{"name":"Ada","age":}]';
  const removed = convert(source, { repairMode: "remove" });
  const nulled = convert(source, { repairMode: "null" });

  expect(removed.text).toBe("name\nAda");
  expect(removed.tablePreview.columns).toEqual(["name"]);
  expect(removed.tablePreview.rows).toEqual([["Ada"]]);
  expect(nulled.text).toBe("name,age\nAda,");
  expect(nulled.tablePreview.columns).toEqual(["name", "age"]);
  expect(nulled.tablePreview.rows).toEqual([["Ada", ""]]);
  expect(nulled.stats.at(-1)).toEqual({
    label: "Repaired",
    labelMessage: { key: "execution.repaired" },
    value: "Yes",
    valueMessage: { key: "execution.yes" },
  });
  expect(() => convert(source)).toThrow(expect.objectContaining({ code: "syntax" }));
});

test("JSON to CSV keeps zero-column inputs successful", () => {
  for (const [source, rowCount] of [
    ["[]", 0],
    ["{}", 1],
    ["[{},{}]", 2],
  ]) {
    const result = convert(source);

    expect(result.text).toBe("");
    expect(result.tablePreview.columns).toEqual([]);
    expect(result.tablePreview.truncated).toBe(false);
    expect(result.stats[0].value).toBe(String(rowCount));
    expect(result.stats[1].value).toBe("0");
  }
});

test("JSON to CSV bounds preview rows without shortening the CSV artifact or counts", () => {
  for (const count of [1000, 1001]) {
    const result = convert(JSON.stringify(Array.from({ length: count }, (_, id) => ({ id }))));

    expect(result.tablePreview.rows.length).toBe(1000);
    expect(result.tablePreview.truncated).toBe(count > 1000);
    expect(result.text.split("\n").length).toBe(count + 1);
    expect(result.stats[0].value).toBe(String(count));
    expect(result.text.endsWith(`\n${count - 1}`)).toBeTruthy();
  }
});

test("JSON to CSV bounds wide previews by cell count while retaining at least one row", () => {
  for (const [columnCount, rowCount, previewRows] of [
    [25, 401, 400],
    [10001, 2, 1],
  ]) {
    const record = Object.fromEntries(Array.from({ length: columnCount }, (_, index) => [`c${index}`, index]));
    const result = convert(JSON.stringify(Array.from({ length: rowCount }, () => record)));

    expect(result.tablePreview.columns.length).toBe(columnCount);
    expect(result.tablePreview.rows.length).toBe(previewRows);
    expect(result.tablePreview.truncated).toBe(true);
    expect(result.text.split("\n").length).toBe(rowCount + 1);
    expect(result.stats[0].value).toBe(String(rowCount));
    expect(result.stats[1].value).toBe(String(columnCount));
  }
});
