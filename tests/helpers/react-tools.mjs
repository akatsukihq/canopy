import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { getCommonMessages } from "../../lib/i18n/messages.ts";
import { extractToolMessages, toolMessageTree } from "../../lib/tool-framework/translations.ts";

const mounted = new Set();

// jsdom has no layout engine. These shims cover observation APIs only;
// inputs, React state, callbacks, and tool execution remain real.
export function setupReactTools() {
  let hadScrollIntoView;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    }));
    hadScrollIntoView = typeof HTMLElement.prototype.scrollIntoView === "function";
    if (hadScrollIntoView) vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    else HTMLElement.prototype.scrollIntoView = () => {};
  });
  afterEach(async () => {
    for (const view of [...mounted]) await view.unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (!hadScrollIntoView) delete HTMLElement.prototype.scrollIntoView;
  });
}

export async function mountTool(element, { spec, locale = "en", messages = {} } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const dictionary = {
    ...getCommonMessages(locale),
    ...(spec ? { Tool: toolMessageTree({ ...extractToolMessages(spec), ...messages }) } : {}),
  };
  const view = {
    container,
    async rerender(next) {
      await act(async () =>
        root.render(
          React.createElement(NextIntlClientProvider, { locale, messages: dictionary, timeZone: "UTC" }, next),
        ),
      );
    },
    async unmount() {
      if (!mounted.delete(view)) return;
      await act(async () => root.unmount());
      container.remove();
    },
  };
  mounted.add(view);
  await view.rerender(element);
  return view;
}

export async function fill(element, value) {
  if (!element) throw new Error("Cannot fill a missing input");
  if (element.disabled || element.readOnly || element.closest("[inert]"))
    throw new Error("Cannot fill an unavailable input");
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, String(value));
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

export async function click(element) {
  if (!element) throw new Error("Cannot click a missing control");
  if (element.closest("[inert]")) throw new Error("Cannot click an inert control");
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

export function button(name, scope = document) {
  return [...scope.querySelectorAll('button, [role="button"]')].find((element) => {
    const label = element.getAttribute("aria-label") ?? element.textContent.trim();
    return name instanceof RegExp ? name.test(label) : label === name;
  });
}

export function field(name, scope = document) {
  const labels = [...scope.querySelectorAll("label")];
  const label = labels.find((node) =>
    name instanceof RegExp ? name.test(node.textContent) : node.textContent.trim() === name,
  );
  if (label?.htmlFor) return document.getElementById(label.htmlFor);
  return [...scope.querySelectorAll("input, textarea, select, [role='textbox']")].find((element) => {
    const value = element.getAttribute("aria-label") ?? "";
    return name instanceof RegExp ? name.test(value) : value === name;
  });
}

export async function waitFor(check, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  let failure;
  do {
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      return await check();
    } catch (error) {
      failure = error;
    }
  } while (Date.now() < deadline);
  throw failure;
}

// The editor itself has separate tests. A textarea preserves its public
// controlled-input contract while avoiding CodeMirror's layout measurements.
export function TextEditorBoundary({
  value,
  onChange,
  readOnly,
  disabled,
  placeholder,
  ariaLabel,
  label,
  editorRef,
  ...props
}) {
  const element = React.useRef(null);
  React.useImperativeHandle(editorRef, () => ({
    focus: () => element.current?.focus(),
    insertText: (text) => onChange?.(`${element.current?.value ?? ""}${text}`),
  }));
  return React.createElement("textarea", {
    ref: element,
    value: value ?? "",
    readOnly,
    disabled,
    placeholder,
    id: props.id,
    "aria-labelledby": props["aria-labelledby"],
    "aria-describedby": props["aria-describedby"],
    "aria-invalid": props["aria-invalid"],
    "aria-label": ariaLabel ?? props["aria-label"] ?? label ?? "Code editor",
    onChange: (event) => onChange?.(event.target.value),
  });
}
