// @vitest-environment jsdom
import React, { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { ToolTranslationsForm } from "../app/admin/(protected)/tools/[toolId]/components/ToolTranslationsForm.tsx";
import { toast } from "../components/ui/index.tsx";
import {
  setupReactTools,
  mountTool,
  fill,
  button,
  click,
  waitFor,
  field as labelledField,
} from "./helpers/react-tools.mjs";
import { choose } from "./helpers/tool-workspace.mjs";

const save = vi.hoisted(() => vi.fn());
vi.mock("../app/admin/(protected)/tools/actions", () => ({ saveToolTranslationAction: (...args) => save(...args) }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("./helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

const english = {
  name: "Future tool",
  description: "Clean up your text",
  "input.label": "Source text",
  "runtime.greeting": "Hello {name}",
  "runtime.count": "{count, plural, one {# result} other {# results}}",
  "content.howToUse.0": "Add your text",
  seoTitle: "Free text tool",
};
const hindi = {
  name: "उपकरण",
  description: "अपना पाठ साफ करें",
  "input.label": "मूल पाठ",
  "runtime.count": "{count, plural, one {# परिणाम} other {# परिणाम}}",
  "content.howToUse.0": "अपना पाठ जोड़ें",
  seoTitle: "मुफ़्त पाठ उपकरण",
};
const initialVersion = "2026-09-30T00:00:00.000Z";
const savedVersion = "2026-09-30T00:00:01.000Z";

beforeEach(() => save.mockReset());
async function render(overrides = {}) {
  return mountTool(
    React.createElement(ToolTranslationsForm, {
      toolId: "devtools.future-tool",
      englishMessages: english,
      translations: {
        en: { status: "published", messages: english },
        hi: { status: "draft", messages: hindi },
      },
      updatedAt: initialVersion,
      enabled: true,
      ...overrides,
    }),
  );
}
function field(key) {
  // Placeholder-bearing fields are a chip editor (a nameless textarea in tests) found by its field id.
  return document.querySelector(
    `input:not([type="hidden"])[name="message:${key}"],textarea[name="message:${key}"],textarea[id="translation-${encodeURIComponent(key)}"]`,
  );
}
async function group(label) {
  const target = messageNavigation(label);
  await click(target);
  if (target.getAttribute("aria-expanded") === "false") await pressTreeKey(target, "ArrowRight");
}
function messageGroup(label) {
  return button(new RegExp(`^${label}(?:\\s|\\d|$)`), document.querySelector('[aria-label="Translation fields"]'));
}
function navigationTree() {
  return document.querySelector('[role="tree"][aria-label="Translation sections"]');
}
function messageNavigation(label) {
  return button(label, navigationTree());
}
async function pressTreeKey(target, key) {
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}
function expectTreeFocus(target) {
  expect(document.activeElement).toBe(target);
  expect([...navigationTree().querySelectorAll('[role="treeitem"]')].filter((row) => row.tabIndex === 0)).toEqual([
    target,
  ]);
}
async function expandMessageGroup(label) {
  const target = messageGroup(label);
  expect(target, `message group ${label}`).toBeTruthy();
  if (target.getAttribute("aria-expanded") === "false") await click(target);
  expect(target.getAttribute("aria-expanded")).toBe("true");
}
async function submit(label) {
  const target = button(label);
  expect(target, `submit action ${label}`).toBeTruthy();
  expect(target.disabled, `${label} must be available`).toBe(false);
  await act(() => target.form.requestSubmit(target));
}
function untranslatedFilter() {
  return button("Untranslated");
}
function succeeds(status = "published") {
  return { status: "success", message: "Saved", updatedAt: savedVersion, translationStatus: status };
}

test("the editor starts with tool details and reveals the selected group without losing submitted values", async () => {
  await render();
  expect(field("name").value).toBe(english.name);
  expect(field("description").value).toBe(english.description);
  expect(field("input.label")).toBe(null);
  expect(field("runtime.greeting")).toBe(null);
  expect(field("content.howToUse.0")).toBe(null);
  expect(field("seoTitle")).toBe(null);
  expect(button("Save draft")).toBeUndefined();
  expect(button("Publish changes").disabled).toBe(true);
  for (const [label, key] of [
    ["Inputs & settings", "input.label"],
    ["Messages & results", "runtime.greeting"],
    ["Page content", "content.howToUse.0"],
    ["Search & SEO", "seoTitle"],
  ]) {
    await group(label);
    expect(field(key), `editable field in ${label}`).toBeTruthy();
    expect(field(key).value).toBe(english[key]);
    expect(field("name")).toBe(null);
  }
});

test("per-language drafts preserve native ICU and dirty state while successful saves advance the version", async () => {
  save.mockResolvedValue(succeeds());
  const view = await render();
  await group("Messages & results");
  await fill(field("runtime.greeting"), "Welcome {name}");
  expect(view.container.textContent).toContain("Unsaved changes");
  await choose("Language to edit", "हिन्दी");
  expect(view.container.textContent).not.toContain("Unsaved changes");
  await group("Messages & results");
  await fill(field("runtime.greeting"), " \n ");
  expect(view.container.textContent).not.toContain("Unsaved changes");
  await fill(field("runtime.greeting"), "नमस्ते {name}");
  await choose("Language to edit", "English");
  await group("Messages & results");
  expect(field("runtime.greeting").value).toBe("Welcome {name}");
  expect(view.container.textContent).toContain("Unsaved changes");
  await choose("Language to edit", "हिन्दी");
  await group("Messages & results");
  expect(field("runtime.greeting").value).toBe("नमस्ते {name}");
  await submit("Publish translation");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const data = save.mock.calls[0][1];
  expect(data.get("locale")).toBe("hi");
  expect(data.get("message:runtime.greeting")).toBe("नमस्ते {name}");
  expect(data.get("message:runtime.count")).toBe(hindi["runtime.count"]);
  expect(data.get("status")).toBe("published");
  expect(data.get("updatedAt")).toBe(initialVersion);
  await waitFor(() => expect(view.container.textContent).not.toContain("Unsaved changes"));
  expect(button("Publish translation").disabled).toBe(true);
  await choose("Language to edit", "English");
  expect(view.container.textContent).toContain("Unsaved changes");
  await submit("Publish changes");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][1].get("updatedAt")).toBe(savedVersion);
  expect(save.mock.calls[1][1].get("message:runtime.greeting")).toBe("Welcome {name}");
});

test("search finds translated text, English text and keys across all groups and submits hidden values", async () => {
  save.mockResolvedValue(succeeds("draft"));
  await render();
  await choose("Language to edit", "हिन्दी");
  await fill(field("name"), "नया उपकरण");
  const search = labelledField("Search translations");
  await fill(search, "मुफ़्त");
  expect(field("seoTitle").value).toBe(hindi.seoTitle);
  await fill(field("seoTitle"), "अनुवादित शीर्षक");
  expect(field("seoTitle")?.value).toBe("अनुवादित शीर्षक");
  expect(field("name")).toBe(null);
  await fill(search, "Source text");
  expect(field("input.label").value).toBe(hindi["input.label"]);
  await fill(search, "runtime.count");
  expect(field("runtime.count").value).toBe(hindi["runtime.count"]);
  expect(field("seoTitle")).toBe(null);
  await submit("Save draft");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const data = save.mock.calls[0][1];
  for (const [key, value] of Object.entries({
    ...hindi,
    name: "नया उपकरण",
    seoTitle: "अनुवादित शीर्षक",
    "runtime.greeting": "",
  })) {
    expect(data.getAll(`message:${key}`), key).toEqual([value]);
  }
  expect(data.get("status")).toBe("draft");
});

test("untranslated filtering permits incomplete drafts while publication waits for every field", async () => {
  save.mockResolvedValue(succeeds("draft"));
  await render();
  await choose("Language to edit", "हिन्दी");
  await fill(field("name"), "साफ पाठ उपकरण");
  await group("Messages & results");
  expect(untranslatedFilter().getAttribute("aria-pressed")).toBe("false");
  await click(untranslatedFilter());
  expect(untranslatedFilter().getAttribute("aria-pressed")).toBe("true");
  expect(field("runtime.greeting").value).toBe("");
  expect(field("runtime.count")).toBe(null);
  expect(save).not.toHaveBeenCalled();
  await click(untranslatedFilter());
  expect(untranslatedFilter().getAttribute("aria-pressed")).toBe("false");
  expect(field("runtime.greeting").value).toBe("");
  expect(field("runtime.count").value).toBe(hindi["runtime.count"]);
  expect(save).not.toHaveBeenCalled();
  await click(untranslatedFilter());
  expect(untranslatedFilter().getAttribute("aria-pressed")).toBe("true");
  expect(save).not.toHaveBeenCalled();
  await fill(field("runtime.greeting"), "नमस्ते {name}");
  expect(field("runtime.greeting").value).toBe("नमस्ते {name}");
  expect(button("Publish translation").disabled).toBe(false);
  await fill(field("runtime.greeting"), "");
  expect(button("Publish translation").disabled).toBe(true);
  expect(button("Save draft").disabled).toBe(false);
  await submit("Save draft");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const data = save.mock.calls[0][1];
  expect(data.get("message:name")).toBe("साफ पाठ उपकरण");
  expect(data.get("message:runtime.count")).toBe(hindi["runtime.count"]);
  expect(data.get("message:runtime.greeting")).toBe("");
  expect(data.get("status")).toBe("draft");
});

test("nested message groups start collapsed and retain edited values through collapse and exact submission", async () => {
  save.mockResolvedValue(succeeds("draft"));
  const source = {
    ...english,
    "runtime.shared.app.title": "Application heading",
    "runtime.shared.app.greeting": "Welcome {name}",
    "runtime.shared.status.ready": "Ready to continue",
  };
  const translated = { ...source, name: "उपकरण" };
  await render({
    englishMessages: source,
    translations: { en: { status: "published", messages: source }, hi: { status: "draft", messages: translated } },
  });
  await choose("Language to edit", "हिन्दी");
  await group("Messages & results");
  expect(messageGroup("Shared").getAttribute("aria-expanded")).toBe("false");
  expect(messageGroup("Shared").textContent).toContain("3");
  await expandMessageGroup("Shared");
  expect(messageGroup("App").getAttribute("aria-expanded")).toBe("false");
  expect(messageGroup("App").textContent).toContain("2");
  await expandMessageGroup("App");
  await fill(field("runtime.shared.app.greeting"), "स्वागत {name}");
  expect(messageGroup("Status").getAttribute("aria-expanded")).toBe("false");
  const openData = new FormData(field("runtime.shared.app.greeting").form);
  for (const [key, value] of Object.entries({ ...translated, "runtime.shared.app.greeting": "स्वागत {name}" }))
    expect(openData.getAll(`message:${key}`), key).toEqual([value]);
  expect([...openData.keys()].filter((key) => key.startsWith("message:")).sort()).toEqual(
    Object.keys(source)
      .map((key) => `message:${key}`)
      .sort(),
  );
  await click(messageGroup("App"));
  expect(messageGroup("App").getAttribute("aria-expanded")).toBe("false");
  await expandMessageGroup("App");
  expect(field("runtime.shared.app.greeting").value).toBe("स्वागत {name}");
  await click(messageGroup("Shared"));
  expect(messageGroup("Shared").getAttribute("aria-expanded")).toBe("false");
  await group("Tool details");
  await fill(field("name"), "नया उपकरण");
  await group("Messages & results");
  expect(messageGroup("Shared").getAttribute("aria-expanded")).toBe("false");
  await submit("Save draft");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const data = save.mock.calls[0][1];
  for (const [key, value] of Object.entries({
    ...translated,
    name: "नया उपकरण",
    "runtime.shared.app.greeting": "स्वागत {name}",
  }))
    expect(data.getAll(`message:${key}`), key).toEqual([value]);
  expect([...data.keys()].filter((key) => key.startsWith("message:")).sort()).toEqual(
    Object.keys(source)
      .map((key) => `message:${key}`)
      .sort(),
  );
});

test("search and untranslated filters expose matching fields inside collapsed message ancestors", async () => {
  const source = {
    ...english,
    "runtime.shared.app.title": "Application heading",
    "runtime.shared.app.greeting": "Welcome {name}",
    "runtime.shared.status.ready": "Ready to continue",
  };
  await render({
    englishMessages: source,
    translations: {
      en: { status: "published", messages: source },
      hi: { status: "draft", messages: { ...source, "runtime.shared.app.greeting": "" } },
    },
  });
  await choose("Language to edit", "हिन्दी");
  await group("Messages & results");
  expect(messageGroup("Shared").getAttribute("aria-expanded")).toBe("false");
  await fill(labelledField("Search translations"), "Application heading");
  expect(field("runtime.shared.app.title").value).toBe("Application heading");
  expect(field("runtime.shared.status.ready")).toBe(null);
  await fill(labelledField("Search translations"), "");
  if (messageGroup("Shared").getAttribute("aria-expanded") === "true") await click(messageGroup("Shared"));
  await click(untranslatedFilter());
  expect(field("runtime.shared.app.greeting").value).toBe("");
  expect(field("runtime.shared.app.title")).toBe(null);
  await fill(field("runtime.shared.app.greeting"), "स्वागत {name}");
  expect(field("runtime.shared.app.greeting").value).toBe("स्वागत {name}");
});

test("nested sidebar selection shows the chosen subtree and preserves drafts, global search and complete saves", async () => {
  save.mockResolvedValue(succeeds("draft"));
  const source = {
    ...english,
    "runtime.shared.app.title": "Application heading",
    "runtime.shared.app.greeting": "Welcome {name}",
    "runtime.shared.status.ready": "Ready to continue",
    "runtime.receipt.title": "Receipt heading",
  };
  const translated = { ...source, name: "उपकरण" };
  await render({
    englishMessages: source,
    translations: { en: { status: "published", messages: source }, hi: { status: "draft", messages: translated } },
  });
  await choose("Language to edit", "हिन्दी");
  await group("Messages & results");
  expect(messageNavigation("Shared").getAttribute("aria-selected")).toBe("false");
  expect(messageNavigation("Shared").getAttribute("aria-expanded")).toBe("false");
  expect(messageNavigation("Receipt")).toBeTruthy();
  await click(messageNavigation("Shared"));
  expect(messageNavigation("Shared").getAttribute("aria-selected")).toBe("true");
  expect(messageNavigation("Shared").getAttribute("aria-expanded")).toBe("true");
  expect(messageNavigation("Shared · App")).toBeTruthy();
  expect(messageNavigation("Shared · Status")).toBeTruthy();
  expect(messageGroup("App")).toBeTruthy();
  expect(messageGroup("Receipt")).toBeUndefined();

  await click(messageNavigation("Shared · App"));
  expect(messageNavigation("Shared · App").getAttribute("aria-selected")).toBe("true");
  expect(messageNavigation("Shared · App").hasAttribute("aria-expanded")).toBe(false);
  expect(field("runtime.shared.app.title").value).toBe(source["runtime.shared.app.title"]);
  expect(field("runtime.shared.app.greeting").value).toBe(source["runtime.shared.app.greeting"]);
  expect(field("runtime.shared.status.ready")).toBe(null);
  expect(field("runtime.receipt.title")).toBe(null);
  await fill(field("runtime.shared.app.title"), "ऐप शीर्षक");
  await click(messageNavigation("Shared"));
  expect(messageNavigation("Shared").getAttribute("aria-selected")).toBe("true");
  expect(messageNavigation("Shared").getAttribute("aria-expanded")).toBe("false");
  expect(messageNavigation("Shared · App")).toBeUndefined();
  await click(messageNavigation("Shared"));
  expect(messageNavigation("Shared").getAttribute("aria-expanded")).toBe("true");
  await click(messageNavigation("Shared · App"));
  expect(field("runtime.shared.app.title").value).toBe("ऐप शीर्षक");
  await click(messageNavigation("Shared · Status"));
  expect(field("runtime.shared.status.ready").value).toBe(source["runtime.shared.status.ready"]);
  expect(field("runtime.shared.app.title")).toBe(null);
  await click(messageNavigation("Shared · App"));
  expect(field("runtime.shared.app.title").value).toBe("ऐप शीर्षक");

  await fill(labelledField("Search translations"), "Receipt heading");
  expect(field("runtime.receipt.title").value).toBe(source["runtime.receipt.title"]);
  expect(field("runtime.shared.app.title")).toBe(null);
  await fill(labelledField("Search translations"), "");
  expect(messageNavigation("Shared · App").getAttribute("aria-selected")).toBe("true");
  expect(field("runtime.shared.app.title").value).toBe("ऐप शीर्षक");
  expect(field("runtime.receipt.title")).toBe(null);

  await group("Tool details");
  expect(field("name").value).toBe(translated.name);
  await group("Messages & results");
  expect(messageNavigation("Shared").getAttribute("aria-selected")).toBe("false");
  expect(messageNavigation("Shared").getAttribute("aria-expanded")).toBe("true");
  expect(messageNavigation("Shared · App")).toBeTruthy();
  expect(messageGroup("Shared")).toBeTruthy();
  await click(messageNavigation("Shared · App"));
  expect(field("runtime.shared.app.title").value).toBe("ऐप शीर्षक");
  await submit("Save draft");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const data = save.mock.calls[0][1];
  for (const [key, value] of Object.entries({ ...translated, "runtime.shared.app.title": "ऐप शीर्षक" }))
    expect(data.getAll(`message:${key}`), key).toEqual([value]);
  expect([...data.keys()].filter((key) => key.startsWith("message:")).sort()).toEqual(
    Object.keys(source)
      .map((key) => `message:${key}`)
      .sort(),
  );
});

test("the translation tree supports roving keyboard focus and folder expansion without losing selected drafts", async () => {
  const source = {
    ...english,
    "runtime.shared.app.title": "Application heading",
    "runtime.shared.status.ready": "Ready to continue",
    "runtime.receipt.title": "Receipt heading",
  };
  await render({ englishMessages: source, translations: { en: { status: "published", messages: source } } });
  expect(navigationTree()).toBeTruthy();
  const details = messageNavigation("Tool details");
  expect(details.getAttribute("role")).toBe("treeitem");
  expect(details.getAttribute("aria-selected")).toBe("true");
  expect(details.getAttribute("aria-level")).toBe("1");
  expect(details.getAttribute("aria-posinset")).toBe("1");
  expect(details.getAttribute("aria-setsize")).toBe("5");
  await act(async () => details.focus());
  expectTreeFocus(details);
  await pressTreeKey(details, "ArrowDown");
  expectTreeFocus(messageNavigation("Inputs & settings"));
  await pressTreeKey(messageNavigation("Inputs & settings"), "ArrowDown");
  const messages = messageNavigation("Messages & results");
  expectTreeFocus(messages);
  expect(details.getAttribute("aria-selected")).toBe("true");
  if (messages.getAttribute("aria-expanded") === "true") await pressTreeKey(messages, "ArrowLeft");
  await pressTreeKey(messages, "ArrowRight");
  expect(messages.getAttribute("aria-expanded")).toBe("true");
  expectTreeFocus(messages);
  await pressTreeKey(messages, "ArrowRight");
  const shared = messageNavigation("Shared");
  expectTreeFocus(shared);
  expect(shared.getAttribute("aria-level")).toBe("2");
  expect(shared.getAttribute("aria-posinset")).toBe("1");
  expect(shared.getAttribute("aria-setsize")).toBe("2");
  await pressTreeKey(shared, "ArrowRight");
  expect(shared.getAttribute("aria-expanded")).toBe("true");
  expectTreeFocus(shared);
  await pressTreeKey(shared, "ArrowRight");
  let app = messageNavigation("Shared · App");
  expectTreeFocus(app);
  expect(app.getAttribute("aria-level")).toBe("3");
  expect(app.getAttribute("aria-posinset")).toBe("1");
  expect(app.getAttribute("aria-setsize")).toBe("2");
  expect(app.hasAttribute("aria-expanded")).toBe(false);
  expect(field("name").value).toBe(english.name);
  await pressTreeKey(app, "Enter");
  expect(app.getAttribute("aria-selected")).toBe("true");
  await fill(field("runtime.shared.app.title"), "Edited through the tree");
  await pressTreeKey(app, "ArrowDown");
  const status = messageNavigation("Shared · Status");
  expectTreeFocus(status);
  expect(app.getAttribute("aria-selected")).toBe("true");
  await pressTreeKey(status, " ");
  expect(status.getAttribute("aria-selected")).toBe("true");
  expect(field("runtime.shared.status.ready").value).toBe(source["runtime.shared.status.ready"]);
  await pressTreeKey(status, "ArrowLeft");
  expectTreeFocus(shared);
  await pressTreeKey(shared, "ArrowLeft");
  expect(shared.getAttribute("aria-expanded")).toBe("false");
  expect(messageNavigation("Shared · Status")).toBeUndefined();
  expect(field("runtime.shared.status.ready").value).toBe(source["runtime.shared.status.ready"]);
  expectTreeFocus(shared);
  await pressTreeKey(shared, "ArrowRight");
  expect(messageNavigation("Shared · Status").getAttribute("aria-selected")).toBe("true");
  await pressTreeKey(shared, "ArrowRight");
  app = messageNavigation("Shared · App");
  expectTreeFocus(app);
  await pressTreeKey(app, "Enter");
  expect(field("runtime.shared.app.title").value).toBe("Edited through the tree");
  await pressTreeKey(app, "Home");
  expectTreeFocus(details);
  expect(app.getAttribute("aria-selected")).toBe("true");
  await pressTreeKey(details, "End");
  expectTreeFocus(messageNavigation("Search & SEO"));
  await pressTreeKey(messageNavigation("Search & SEO"), "ArrowUp");
  expectTreeFocus(messageNavigation("Page content"));
  expect(field("runtime.shared.app.title").value).toBe("Edited through the tree");
});

test("server validation selects the nested RTL field from another group and retains unsaved edits", async () => {
  const nestedKey = "runtime.shared.app.greeting";
  const source = { ...english, [nestedKey]: "Hello {name}", "runtime.shared.status.ready": "Ready to continue" };
  save.mockResolvedValue({
    status: "error",
    message: "Fix the message",
    issues: [{ key: nestedKey, message: "Keep the {name} placeholder." }],
  });
  const view = await render({
    englishMessages: source,
    translations: {
      en: { status: "published", messages: source },
      ar: { status: "draft", messages: { ...source, name: "أداة" } },
    },
  });
  await choose("Language to edit", "العربية");
  expect(field("name").dir).toBe("rtl");
  await group("Messages & results");
  await click(messageNavigation("Shared"));
  await click(messageNavigation("Shared · App"));
  expect(field(nestedKey).closest("[dir]").dir).toBe("rtl");
  await fill(field(nestedKey), "مرحبا {wrong}");
  await click(messageNavigation("Shared · Status"));
  expect(messageNavigation("Shared · Status").getAttribute("aria-selected")).toBe("true");
  expect(field(nestedKey)).toBe(null);
  await fill(labelledField("Search translations"), "أداة");
  expect(field(nestedKey)).toBe(null);
  await submit("Publish translation");
  await waitFor(() => expect(field(nestedKey)?.getAttribute("aria-invalid")).toBe("true"));
  expect(messageNavigation("Shared").getAttribute("aria-expanded")).toBe("true");
  expect(messageNavigation("Shared · App").getAttribute("aria-selected")).toBe("true");
  expect(field("runtime.shared.status.ready")).toBe(null);
  const input = field(nestedKey);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("مرحبا {wrong}");
  expect(input.disabled).toBe(false);
  expect(input.closest("[dir]").dir).toBe("rtl");
  const description = [input.getAttribute("aria-describedby"), input.getAttribute("aria-errormessage")]
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");
  expect(description).toContain("Keep the {name} placeholder.");
  expect(view.container.textContent).toContain("Unsaved changes");
  await choose("Language to edit", "English");
  expect(view.container.textContent).not.toContain("Unsaved changes");
  await choose("Language to edit", "العربية");
  await group("Messages & results");
  await click(messageNavigation("Shared"));
  await click(messageNavigation("Shared · App"));
  expect(field(nestedKey).value).toBe("مرحبا {wrong}");
  expect(view.container.textContent).toContain("Unsaved changes");
});

function editableKeys(scope = document) {
  return [...scope.querySelectorAll('input:not([type="hidden"])[name^="message:"],textarea[name^="message:"]')].map(
    (element) => element.name.slice("message:".length),
  );
}
function semanticGroupName(element) {
  const labelledBy = element
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");
  return (
    element.getAttribute("aria-label") || labelledBy || element.querySelector(":scope > legend")?.textContent || ""
  );
}
function containingGroup(controls, excluded) {
  return [...document.querySelectorAll('fieldset,[role="group"]')].find(
    (element) =>
      controls.every((control) => element.contains(control)) &&
      (!excluded || !element.contains(excluded)) &&
      semanticGroupName(element).trim(),
  );
}

test("nested content arrays use numeric display order without renumbering sparse submitted keys", async () => {
  save.mockResolvedValue(succeeds());
  const source = {
    name: "Nested tool",
    "content.howToUse.10": "Finish the job",
    "content.howToUse.2": "Choose the options",
    "content.howToUse.0": "Add a file",
    "content.limitations.7": "Large files take longer",
    "content.limitations.1": "A modern browser is needed",
    "content.faq.4.a": "Use the download action",
    "content.faq.1.a": "Files stay on your device",
    "content.faq.4.q": "How do I save the result?",
    "content.faq.1.q": "Where are files processed?",
    "content.examples.9.label": "Large sample",
    "content.examples.3.label": "Small sample",
    "keywords.10": "offline",
    "keywords.2": "files",
  };
  await render({ englishMessages: source, translations: { en: { status: "published", messages: source } } });
  await group("Page content");
  const contentKeys = editableKeys();
  expect(contentKeys.filter((key) => key.startsWith("content.howToUse."))).toEqual([
    "content.howToUse.0",
    "content.howToUse.2",
    "content.howToUse.10",
  ]);
  expect(contentKeys.filter((key) => key.startsWith("content.limitations."))).toEqual([
    "content.limitations.1",
    "content.limitations.7",
  ]);
  expect(contentKeys.filter((key) => key.startsWith("content.examples."))).toEqual([
    "content.examples.3.label",
    "content.examples.9.label",
  ]);
  const howToGroup = containingGroup(
    [field("content.howToUse.0"), field("content.howToUse.10")],
    field("content.limitations.1"),
  );
  expect(howToGroup).toBeTruthy();
  expect(semanticGroupName(howToGroup)).toMatch(/how to use/i);
  const faqGroup = containingGroup([field("content.faq.1.q"), field("content.faq.1.a")], field("content.faq.4.q"));
  expect(faqGroup).toBeTruthy();
  expect(editableKeys(faqGroup)).toEqual(["content.faq.1.q", "content.faq.1.a"]);
  await group("Search & SEO");
  expect(editableKeys().filter((key) => key.startsWith("keywords."))).toEqual(["keywords.2", "keywords.10"]);
  await fill(field("keywords.2"), "edited files");
  await submit("Publish changes");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const data = save.mock.calls[0][1];
  for (const [key, value] of Object.entries({ ...source, "keywords.2": "edited files" }))
    expect(data.getAll(`message:${key}`), key).toEqual([value]);
  expect([...data.keys()].filter((key) => key.startsWith("message:")).sort()).toEqual(
    Object.keys(source)
      .map((key) => `message:${key}`)
      .sort(),
  );
});

test("nested choice context search retains declared choice order and encoded hidden sibling payloads", async () => {
  save.mockResolvedValue(succeeds("draft"));
  const source = {
    name: "Format tool",
    "settings.outputFormat.label": "Output format",
    "settings.outputFormat.help": "Choose the resulting file type",
    "settings.outputFormat.choices.10.label": "Plain text",
    "settings.outputFormat.choices.10.detail": "Readable in any editor",
    "settings.outputFormat.choices.2.label": "Compact",
    "settings.outputFormat.choices.2.detail": "Uses less space",
    "settings.outputFormat.choices.audio%2Fmp3%2Ev2.label": "MP3 v2",
    "settings.outputFormat.choices.audio%2Fmp3%2Ev2.detail": "Audio output",
    "runtime.custom.choices.alpha.label.help": "Alpha guidance",
    "runtime.custom.choices.beta.label": "Beta option",
    "runtime.custom.choices.beta.label.help": "Beta guidance",
    "content.howToUse.0": "Choose a format and run",
  };
  const translated = { ...source, name: "प्रारूप उपकरण" };
  await render({
    englishMessages: source,
    translations: { en: { status: "published", messages: source }, hi: { status: "draft", messages: translated } },
  });
  await choose("Language to edit", "हिन्दी");
  await group("Messages & results");
  await expandMessageGroup("Custom");
  expect(field("runtime.custom.choices.alpha.label")).toBe(null);
  for (const key of [
    "runtime.custom.choices.alpha.label.help",
    "runtime.custom.choices.beta.label",
    "runtime.custom.choices.beta.label.help",
  ])
    expect(field(key)?.value, key).toBe(source[key]);
  await fill(labelledField("Search translations"), "runtime.custom.choices");
  expect(field("runtime.custom.choices.alpha.label.help").value).toBe("Alpha guidance");
  expect(field("runtime.custom.choices.beta.label").value).toBe("Beta option");
  expect(field("runtime.custom.choices.beta.label.help").value).toBe("Beta guidance");
  await fill(field("runtime.custom.choices.alpha.label.help"), "अल्फ़ा जानकारी");
  await fill(field("runtime.custom.choices.beta.label"), "बीटा विकल्प");
  await fill(field("runtime.custom.choices.beta.label.help"), "बीटा जानकारी");
  await group("Inputs & settings");
  const choiceKeys = Object.keys(source).filter((key) => key.startsWith("settings.outputFormat.choices."));
  expect(editableKeys().filter((key) => key.includes(".choices."))).toEqual(choiceKeys);
  const choices = containingGroup(
    [field(choiceKeys[0]), field(choiceKeys.at(-1))],
    field("settings.outputFormat.label"),
  );
  expect(choices).toBeTruthy();
  expect(semanticGroupName(choices)).toMatch(/choices/i);
  const audioChoice = containingGroup(
    [
      field("settings.outputFormat.choices.audio%2Fmp3%2Ev2.label"),
      field("settings.outputFormat.choices.audio%2Fmp3%2Ev2.detail"),
    ],
    field("settings.outputFormat.choices.10.label"),
  );
  expect(audioChoice).toBeTruthy();
  await fill(labelledField("Search translations"), "Output format");
  expect(editableKeys().filter((key) => key.includes(".choices."))).toEqual(choiceKeys);
  await fill(labelledField("Search translations"), "MP3 v2");
  expect(field("settings.outputFormat.choices.audio%2Fmp3%2Ev2.detail").value).toBe("Audio output");
  expect(field("settings.outputFormat.choices.10.label")).toBe(null);
  await fill(field("settings.outputFormat.choices.audio%2Fmp3%2Ev2.detail"), "ऑडियो परिणाम");
  await submit("Save draft");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const data = save.mock.calls[0][1];
  for (const [key, value] of Object.entries({
    ...translated,
    "settings.outputFormat.choices.audio%2Fmp3%2Ev2.detail": "ऑडियो परिणाम",
    "runtime.custom.choices.alpha.label.help": "अल्फ़ा जानकारी",
    "runtime.custom.choices.beta.label": "बीटा विकल्प",
    "runtime.custom.choices.beta.label.help": "बीटा जानकारी",
  }))
    expect(data.getAll(`message:${key}`), key).toEqual([value]);
  expect(data.has("message:settings.outputFormat.choices.audio/mp3.v2.detail")).toBe(false);
});

function rawDialog() {
  return [...document.querySelectorAll('[role="dialog"]')].find(
    (element) => semanticGroupName(element) === "Raw JSON translations",
  );
}
async function openRawJson() {
  await click(button("Raw JSON"));
  await waitFor(() => expect(rawDialog()).toBeTruthy());
  const editor = labelledField("Translation JSON");
  expect(editor).toBeTruthy();
  return editor;
}
function completeMap(messages) {
  return Object.fromEntries(Object.keys(english).map((key) => [key, messages[key] ?? ""]));
}
function nestedMessages(messages) {
  return {
    name: messages.name ?? "",
    description: messages.description ?? "",
    input: { label: messages["input.label"] ?? "" },
    runtime: { greeting: messages["runtime.greeting"] ?? "", count: messages["runtime.count"] ?? "" },
    content: { howToUse: { 0: messages["content.howToUse.0"] ?? "" } },
    seoTitle: messages.seoTitle ?? "",
  };
}

test("raw JSON applies the full selected-language map locally and filtered saves submit every key once", async () => {
  save.mockResolvedValue(succeeds("draft"));
  const view = await render();
  await choose("Language to edit", "हिन्दी");
  await fill(field("name"), "नया उपकरण");
  await fill(labelledField("Search translations"), "seoTitle");
  const editor = await openRawJson();
  const initial = completeMap({ ...hindi, name: "नया उपकरण" });
  expect(JSON.parse(editor.value)).toEqual(nestedMessages(initial));
  const next = {
    ...initial,
    name: "JSON से नाम",
    "input.label": "",
    "runtime.greeting": "नमस्ते {name}",
    seoTitle: "नया खोज शीर्षक",
  };
  await fill(editor, JSON.stringify(nestedMessages(next)));
  await click(button("Apply changes", rawDialog()));
  await waitFor(() => expect(rawDialog()).toBeUndefined());
  expect(save).not.toHaveBeenCalled();
  expect(field("seoTitle").value).toBe(next.seoTitle);
  expect(view.container.textContent).toContain("Unsaved changes");
  await group("Tool details");
  expect(field("name").value).toBe(next.name);
  await group("Inputs & settings");
  expect(field("input.label").value).toBe("");
  expect(button("Publish translation").disabled).toBe(true);
  await fill(labelledField("Search translations"), "seoTitle");
  await submit("Save draft");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const data = save.mock.calls[0][1];
  expect(data.get("locale")).toBe("hi");
  expect(data.get("status")).toBe("draft");
  for (const [key, value] of Object.entries(next)) expect(data.getAll(`message:${key}`), key).toEqual([value]);
  expect([...data.keys()].filter((key) => key.startsWith("message:")).sort()).toEqual(
    Object.keys(next)
      .map((key) => `message:${key}`)
      .sort(),
  );
});

test("nested JSON round trips deep messages and encoded sparse object keys into the exact flat save payload", async () => {
  save.mockResolvedValue(succeeds());
  const source = {
    name: "Nested tool",
    "runtime.shared.app.greeting": "Hello {name}",
    "runtime.shared.app.count": "{count, plural, one {# result} other {# results}}",
    "settings.outputFormat.label": "Output format",
    "settings.outputFormat.choices.audio%2Fmp3%2Ev2.label": "MP3 v2",
    "settings.outputFormat.choices.audio%2Fmp3%2Ev2.detail": "Audio output",
    "settings.outputFormat.choices.10.label": "Ten",
    "settings.outputFormat.choices.2.label": "Two",
    "content.howToUse.2": "Finish the job",
    "content.howToUse.0": "Start the job",
    "keywords.10": "offline",
    "keywords.2": "audio",
  };
  const nested = {
    name: "Nested tool",
    runtime: {
      shared: { app: { greeting: "Hello {name}", count: "{count, plural, one {# result} other {# results}}" } },
    },
    settings: {
      outputFormat: {
        label: "Output format",
        choices: {
          "audio%2Fmp3%2Ev2": { label: "MP3 v2", detail: "Audio output" },
          10: { label: "Ten" },
          2: { label: "Two" },
        },
      },
    },
    content: { howToUse: { 0: "Start the job", 2: "Finish the job" } },
    keywords: { 2: "audio", 10: "offline" },
  };
  await render({ englishMessages: source, translations: { en: { status: "published", messages: source } } });
  const editor = await openRawJson();
  expect(JSON.parse(editor.value)).toEqual(nested);
  const edited = JSON.parse(JSON.stringify(nested));
  edited.runtime.shared.app.greeting = "Welcome {name}";
  edited.runtime.shared.app.count = "{count, plural, one {# document} other {# documents}}";
  edited.settings.outputFormat.choices["audio%2Fmp3%2Ev2"].detail = "Encoded choice description";
  edited.settings.outputFormat.choices["2"].label = "Option two";
  edited.content.howToUse["0"] = "Add a source";
  edited.content.howToUse["2"] = "Export the result";
  await fill(editor, JSON.stringify(edited));
  await click(button("Apply changes", rawDialog()));
  await waitFor(() => expect(rawDialog()).toBeUndefined());
  expect(save).not.toHaveBeenCalled();
  await fill(labelledField("Search translations"), "runtime.shared.app");
  expect(field("runtime.shared.app.greeting").value).toBe("Welcome {name}");
  expect(field("runtime.shared.app.count").value).toBe("{count, plural, one {# document} other {# documents}}");
  expect(JSON.parse((await openRawJson()).value)).toEqual(edited);
  expect(button("Apply changes", rawDialog()).disabled).toBe(true);
  await click(button("Cancel", rawDialog()));
  await submit("Publish changes");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const expected = {
    ...source,
    "runtime.shared.app.greeting": "Welcome {name}",
    "runtime.shared.app.count": "{count, plural, one {# document} other {# documents}}",
    "settings.outputFormat.choices.audio%2Fmp3%2Ev2.detail": "Encoded choice description",
    "settings.outputFormat.choices.2.label": "Option two",
    "content.howToUse.0": "Add a source",
    "content.howToUse.2": "Export the result",
  };
  const data = save.mock.calls[0][1];
  for (const [key, value] of Object.entries(expected)) expect(data.getAll(`message:${key}`), key).toEqual([value]);
  expect([...data.keys()].filter((key) => key.startsWith("message:")).sort()).toEqual(
    Object.keys(expected)
      .map((key) => `message:${key}`)
      .sort(),
  );
});

test("an empty runtime object in JSON does not create a message for a source without runtime fields", async () => {
  save.mockResolvedValue(succeeds());
  const source = { name: "Small tool", description: "A simple tool" };
  await render({ englishMessages: source, translations: { en: { status: "published", messages: source } } });
  const editor = await openRawJson();
  expect(JSON.parse(editor.value)).toEqual({ name: "Small tool", description: "A simple tool", runtime: {} });
  await fill(editor, JSON.stringify({ name: "Edited tool", description: "A simple tool", runtime: {} }));
  await click(button("Apply changes", rawDialog()));
  await waitFor(() => expect(rawDialog()).toBeUndefined());
  expect(field("name").value).toBe("Edited tool");
  await submit("Publish changes");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const data = save.mock.calls[0][1];
  expect([...data.entries()].filter(([key]) => key.startsWith("message:")).sort()).toEqual([
    ["message:description", "A simple tool"],
    ["message:name", "Edited tool"],
  ]);
});

test.each([
  [
    "parent before child",
    {
      name: "Ambiguous source",
      "runtime.foo": "Parent text",
      "runtime.foo-bar": "Unrelated sibling",
      "runtime.foo.text": "Child text",
    },
  ],
  [
    "child before parent",
    {
      name: "Ambiguous source",
      "runtime.foo.text": "Child text",
      "runtime.foo-bar": "Unrelated sibling",
      "runtime.foo": "Parent text",
    },
  ],
])("raw JSON refuses overlapping source paths with %s without losing current edits", async (_order, source) => {
  const error = vi.spyOn(toast, "error").mockImplementation(() => "source-error");
  await render({ englishMessages: source, translations: { en: { status: "published", messages: source } } });
  await fill(field("name"), "Pending field edit");
  await click(button("Raw JSON"));
  expect(rawDialog()).toBeUndefined();
  expect(error).toHaveBeenCalledTimes(1);
  expect(field("name").value).toBe("Pending field edit");
  expect(save).not.toHaveBeenCalled();
});

test("invalid raw JSON stays open with associated feedback and never partially changes or saves translations", async () => {
  const view = await render();
  await choose("Language to edit", "हिन्दी");
  const current = completeMap(hindi);
  const attempted = nestedMessages({ ...current, name: "This must not apply" });
  const { description: omitted, ...missing } = attempted;
  const cases = [
    ["malformed JSON", "{"],
    ["root array", "[]"],
    ["root null", "null"],
    ["number leaf", JSON.stringify({ ...attempted, description: 42 })],
    ["boolean leaf", JSON.stringify({ ...attempted, description: false })],
    ["null leaf", JSON.stringify({ ...attempted, description: null })],
    ["object leaf", JSON.stringify({ ...attempted, description: {} })],
    ["null branch", JSON.stringify({ ...attempted, input: null })],
    ["string branch", JSON.stringify({ ...attempted, input: "source" })],
    ["nested array", JSON.stringify({ ...attempted, content: { howToUse: ["First step"] } })],
    ["missing known key", JSON.stringify(missing)],
    ["missing nested key", JSON.stringify({ ...attempted, runtime: { count: attempted.runtime.count } })],
    ["empty known branch", JSON.stringify({ ...attempted, input: {} })],
    ["unknown root", JSON.stringify({ ...attempted, unexpected: "text" })],
    ["unknown empty root", JSON.stringify({ ...attempted, unexpected: {} })],
    ["unknown nested key", JSON.stringify({ ...attempted, runtime: { ...attempted.runtime, unknown: "text" } })],
    ["unknown empty branch", JSON.stringify({ ...attempted, runtime: { ...attempted.runtime, unknown: {} } })],
    ["dotted alias collision", JSON.stringify({ ...attempted, "input.label": "Ambiguous source" })],
    [
      "nested dotted alias",
      JSON.stringify({ ...attempted, content: { ...attempted.content, "howToUse.0": "Ambiguous step" } }),
    ],
    ...["__proto__", "constructor", "prototype"].map((key) => [
      `unsafe nested ${key}`,
      JSON.stringify({ ...attempted, runtime: { ...attempted.runtime, [key]: { polluted: "unsafe" } } }),
    ]),
    [
      "wrong ICU placeholder",
      JSON.stringify({ ...attempted, runtime: { ...attempted.runtime, greeting: "नमस्ते {wrong}" } }),
    ],
  ];
  const editor = await openRawJson();
  for (const [label, raw] of cases) {
    await fill(editor, raw);
    await click(button("Apply changes", rawDialog()));
    await waitFor(() => expect(editor.getAttribute("aria-invalid"), label).toBe("true"));
    expect(rawDialog(), label).toBeTruthy();
    const errorIds = editor.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
    expect(
      errorIds.some((id) => document.getElementById(id)?.textContent?.trim()),
      label,
    ).toBe(true);
    expect(field("name").value, label).toBe(hindi.name);
    expect(view.container.textContent, label).not.toContain("Unsaved changes");
    expect(save, label).not.toHaveBeenCalled();
  }
  await click(button("Cancel", rawDialog()));
  await waitFor(() => expect(rawDialog()).toBeUndefined());
  expect(JSON.parse((await openRawJson()).value)).toEqual(nestedMessages(current));
});

test("raw JSON dismissal discards edits while reopening follows current fields and keeps languages isolated", async () => {
  await render();
  let editor = await openRawJson();
  await fill(editor, JSON.stringify(nestedMessages({ ...english, name: "Canceled raw name" })));
  await click(button("Cancel", rawDialog()));
  await waitFor(() => expect(rawDialog()).toBeUndefined());
  expect(field("name").value).toBe(english.name);
  await fill(field("name"), "Latest English field edit");
  editor = await openRawJson();
  expect(JSON.parse(editor.value).name).toBe("Latest English field edit");
  await fill(editor, JSON.stringify(nestedMessages({ ...english, name: "Escaped raw name" })));
  await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await waitFor(() => expect(rawDialog()).toBeUndefined());
  expect(field("name").value).toBe("Latest English field edit");
  await choose("Language to edit", "हिन्दी");
  editor = await openRawJson();
  expect(JSON.parse(editor.value)).toEqual(nestedMessages(hindi));
  const hindiNext = { ...completeMap(hindi), name: "हिन्दी का नया नाम" };
  await fill(editor, JSON.stringify(nestedMessages(hindiNext)));
  await click(button("Apply changes", rawDialog()));
  await waitFor(() => expect(rawDialog()).toBeUndefined());
  expect(field("name").value).toBe(hindiNext.name);
  await choose("Language to edit", "English");
  editor = await openRawJson();
  expect(JSON.parse(editor.value).name).toBe("Latest English field edit");
  await fill(editor, JSON.stringify(nestedMessages({ ...english, name: "Closed raw name" })));
  await click(button("Close JSON editor", rawDialog()));
  await waitFor(() => expect(rawDialog()).toBeUndefined());
  expect(JSON.parse((await openRawJson()).value).name).toBe("Latest English field edit");
  expect(save).not.toHaveBeenCalled();
});

test("JSON language switching keeps Apply disabled until edited and initializes a missing language with blank values", async () => {
  await render();
  let editor = await openRawJson();
  expect(labelledField("Language")).toBeTruthy();
  expect(button("Apply changes", rawDialog()).disabled).toBe(true);
  const original = editor.value;
  await fill(editor, JSON.stringify(nestedMessages({ ...english, name: "Temporary raw edit" })));
  expect(button("Apply changes", rawDialog()).disabled).toBe(false);
  await fill(editor, original);
  expect(button("Apply changes", rawDialog()).disabled).toBe(true);
  await choose("Language", "हिन्दी");
  editor = labelledField("Translation JSON");
  expect(JSON.parse(editor.value)).toEqual(nestedMessages(hindi));
  expect(button("Apply changes", rawDialog()).disabled).toBe(true);
  await choose("Language", "العربية");
  editor = labelledField("Translation JSON");
  expect(JSON.parse(editor.value)).toEqual(nestedMessages({}));
  expect(button("Apply changes", rawDialog()).disabled).toBe(true);
  const arabic = { ...completeMap({}), name: "أداة جديدة" };
  await fill(editor, JSON.stringify(nestedMessages(arabic)));
  expect(button("Apply changes", rawDialog()).disabled).toBe(false);
  await click(button("Apply changes", rawDialog()));
  await waitFor(() => expect(rawDialog()).toBeUndefined());
  expect(field("name").value).toBe(arabic.name);
  expect(field("name").lang).toBe("ar");
  expect(save).not.toHaveBeenCalled();
  expect(JSON.parse((await openRawJson()).value)).toEqual(nestedMessages(arabic));
  expect(button("Apply changes", rawDialog()).disabled).toBe(true);
});

test("JSON language scratch applies multiple languages locally and preserves their exact separate save payloads", async () => {
  save.mockResolvedValueOnce(succeeds("draft")).mockResolvedValueOnce(succeeds());
  await render();
  await choose("Language to edit", "हिन्दी");
  let editor = await openRawJson();
  expect(JSON.parse(editor.value)).toEqual(nestedMessages(hindi));
  const hindiNext = { ...completeMap(hindi), name: "हिन्दी JSON नाम", "runtime.greeting": "नमस्ते {name}" };
  const englishNext = { ...english, name: "English JSON name", "runtime.greeting": "Welcome {name}" };
  await fill(editor, JSON.stringify(nestedMessages(hindiNext)));
  await choose("Language", "English");
  editor = labelledField("Translation JSON");
  expect(JSON.parse(editor.value)).toEqual(nestedMessages(english));
  await fill(editor, JSON.stringify(nestedMessages(englishNext)));
  await choose("Language", "हिन्दी");
  expect(JSON.parse(labelledField("Translation JSON").value)).toEqual(nestedMessages(hindiNext));
  await click(button("Apply changes", rawDialog()));
  await waitFor(() => expect(rawDialog()).toBeUndefined());
  expect(save).not.toHaveBeenCalled();
  expect(field("name").lang).toBe("hi");
  expect(field("name").value).toBe(hindiNext.name);
  await submit("Save draft");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await choose("Language to edit", "English");
  expect(field("name").value).toBe(englishNext.name);
  await submit("Publish changes");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  for (const [index, locale, messages] of [
    [0, "hi", hindiNext],
    [1, "en", englishNext],
  ]) {
    const data = save.mock.calls[index][1];
    expect(data.get("locale")).toBe(locale);
    for (const [key, value] of Object.entries(messages))
      expect(data.getAll(`message:${key}`), `${locale}:${key}`).toEqual([value]);
  }
});

test("an invalid JSON language is revealed without applying any language and modal dismissal discards every scratch buffer", async () => {
  await render();
  for (const dismissal of ["Cancel", "Escape", "Close JSON editor"]) {
    let editor = await openRawJson();
    expect(JSON.parse(editor.value)).toEqual(nestedMessages(english));
    const englishRaw = JSON.stringify(nestedMessages({ ...english, name: "Unapplied English name" }));
    await fill(editor, englishRaw);
    await choose("Language", "हिन्दी");
    editor = labelledField("Translation JSON");
    expect(JSON.parse(editor.value)).toEqual(nestedMessages(hindi));
    const invalidRaw =
      dismissal === "Cancel"
        ? '{ "name": "unfinished'
        : JSON.stringify({
            ...nestedMessages(hindi),
            runtime:
              dismissal === "Escape"
                ? { ...nestedMessages(hindi).runtime, greeting: "नमस्ते {wrong}" }
                : { ...nestedMessages(hindi).runtime, unexpected: {} },
          });
    await fill(editor, invalidRaw);
    await choose("Language", "English");
    expect(labelledField("Translation JSON").value).toBe(englishRaw);
    await click(button("Apply changes", rawDialog()));
    await waitFor(() => expect(labelledField("Translation JSON").getAttribute("aria-invalid")).toBe("true"));
    expect(labelledField("Translation JSON").value).toBe(invalidRaw);
    expect(field("name").value).toBe(english.name);
    expect(field("name").lang).toBe("en");
    expect(save).not.toHaveBeenCalled();
    await choose("Language", "English");
    expect(labelledField("Translation JSON").value).toBe(englishRaw);
    if (dismissal === "Escape") {
      await act(async () =>
        labelledField("Translation JSON").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
      );
    } else await click(button(dismissal, rawDialog()));
    await waitFor(() => expect(rawDialog()).toBeUndefined());
    expect(field("name").value).toBe(english.name);
  }
  expect(JSON.parse((await openRawJson()).value)).toEqual(nestedMessages(english));
  await choose("Language", "हिन्दी");
  expect(JSON.parse(labelledField("Translation JSON").value)).toEqual(nestedMessages(hindi));
  expect(button("Apply changes", rawDialog()).disabled).toBe(true);
});
