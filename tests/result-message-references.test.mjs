import { toolSpec } from "./helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React from "react";
import { expect, test, vi } from "vitest";
import { ResultView, ResultActions } from "../components/ResultView.tsx";
const definition = await toolSpec("json-formatter");
import { setupReactTools, mountTool, click, waitFor } from "./helpers/react-tools.mjs";
setupReactTools();
const messages = { "runtime.status": "स्थिति", "runtime.ok": "सफल", "runtime.retry": "फिर प्रयास करें" };

test.each([
  [
    {
      render: "table",
      columns: ["Status"],
      rows: [["ok"]],
      columnMessages: [{ key: "status" }],
      rowMessages: [[{ key: "ok" }]],
    },
    "Status\nok",
    ["स्थिति", "सफल"],
  ],
  [{ render: "list", items: ["retry"], itemMessages: [{ key: "retry" }] }, "retry", ["फिर प्रयास करें"]],
  [
    {
      render: "key-value",
      entries: [{ label: "Status", value: "ok", labelMessage: { key: "status" }, valueMessage: { key: "ok" } }],
    },
    "Status: ok",
    ["स्थिति", "सफल"],
  ],
])("native message references localize the view and preserve copied result bytes: %j", async (result, raw, labels) => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
  const original = structuredClone(result);
  const view = await mountTool(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(ResultView, { result }),
      React.createElement(
        "div",
        { "data-testid": "result-actions" },
        React.createElement(ResultActions, { result, canCopy: true, canDownload: false }),
      ),
    ),
    { spec: definition, locale: "hi", messages },
  );
  for (const label of labels) expect(view.container.textContent).toContain(label);
  await click(view.container.querySelector('[data-testid="result-actions"] button'));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(raw));
  expect(result).toEqual(original);
});
