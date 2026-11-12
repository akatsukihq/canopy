import { afterAll, expect, onTestFinished, test, vi } from "vitest";
import { DEFAULT_AUTH_ERROR } from "../app/auth/_lib/security.ts";

const state = { values: [], index: 0, toasts: [], calls: [] };
globalThis.__authFeedbackTest = state;

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal()),
  useId: () => "auth-test",
  useState: (initial) => {
    const s = globalThis.__authFeedbackTest;
    const i = s.index++;
    if (!(i in s.values)) s.values[i] = initial;
    return [
      s.values[i],
      (value) => {
        s.values[i] = typeof value === "function" ? value(s.values[i]) : value;
      },
    ];
  },
}));
vi.mock("@/components/ui/index.tsx", () => ({
  toast: {
    success(message) {
      globalThis.__authFeedbackTest.toasts.push(message);
    },
  },
  Caption: "Caption",
  Label: "Label",
  H1: "H1",
  P: "P",
  Strong: "Strong",
  Text: "Text",
  TextLink: "TextLink",
  AlertBanner: "AlertBanner",
  BackButton: "BackButton",
  Button: "Button",
  Card: "Card",
  CheckboxControl: "CheckboxControl",
  Field: "Field",
  FieldLegend: "FieldLegend",
  FieldSet: "FieldSet",
  Input: "Input",
  Separator: "Separator",
}));
vi.mock("../app/auth/_lib/authClient", () => {
  const request = async (body) => {
    const s = globalThis.__authFeedbackTest;
    s.calls.push(body);
    return s.respond();
  };
  return {
    authClient: {
      signUp: { email: request },
      signIn: { email: request, social: request },
      requestPasswordReset: request,
      sendVerificationEmail: request,
    },
  };
});

const { AuthPanel } = await import("../app/auth/AuthPanel.tsx");
afterAll(() => {
  delete globalThis.__authFeedbackTest;
});

const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : node?.props
      ? [node, ...walk(node.props.children), ...walk(node.props.action)]
      : [];
const text = (node) =>
  Array.isArray(node)
    ? node.map(text).join("")
    : node?.props
      ? text(node.props.children)
      : typeof node === "string"
        ? node
        : "";

test("auth successes toast while verification stays actionable, and failures remain safe and retryable", async () => {
  const formData = vi.spyOn(globalThis, "FormData").mockImplementation(function (form) {
    return form;
  });
  onTestFinished(() => formData.mockRestore());
  const event = {
    preventDefault() {},
    currentTarget: new Map([
      ["name", "Test User"],
      ["email", "USER@example.test"],
      ["password", "test-password-123"],
    ]),
  };
  let mode;
  const render = () => {
    state.index = 0;
    return walk(AuthPanel({ returnTo: "/paperwork", initialMode: mode }));
  };
  const button = (label) => render().find((node) => ["Button", "button"].includes(node.type) && text(node) === label);
  const alerts = () => render().filter((node) => node.type === "AlertBanner");
  const submit = () =>
    render()
      .find((node) => node.type === "form")
      .props.onSubmit(event);
  function reset(nextMode) {
    mode = nextMode;
    Object.assign(state, { values: [], toasts: [], calls: [], respond: async () => ({ error: null }) });
    if (mode === "sign-up")
      render()
        .find((node) => node.type === "CheckboxControl")
        .props.onCheckedChange(true);
  }
  const assertRetryable = () => {
    expect(
      render().find((node) => node.type === "FieldSet")?.props.disabled ?? button("Resend email")?.props.disabled,
    ).toBe(false);
    expect(state.toasts.length).toBe(0);
    expect(text(alerts().find((node) => node.props.variant === "error"))).toBe(DEFAULT_AUTH_ERROR);
  };

  reset("sign-up");
  await submit();
  expect(state.toasts.length).toBe(1);
  expect(alerts().some((node) => node.props.variant === "success")).toBe(false);
  expect(text(render()[0])).toMatch(/user@example\.test/);
  expect(render().some((node) => node.type === "form")).toBe(false);
  expect(button("Create account")).toBe(undefined);
  expect(button("Sign up with Google")).toBe(undefined);
  state.toasts = [];
  expect(button("Resend email").props.disabled).toBe(false);
  await button("Resend email").props.onClick();
  expect(state.toasts.length).toBe(1);
  expect(state.calls.at(-1).email).toBe("user@example.test");

  for (const respond of [
    async () => ({ error: { message: "private backend details" } }),
    async () => {
      throw new Error("private backend details");
    },
  ]) {
    state.respond = respond;
    state.toasts = [];
    await button("Resend email").props.onClick();
    assertRetryable();
    expect(button("Resend email").props.disabled).toBe(false);
  }
  button("Sign in").props.onClick();
  expect(button("Resend email")).toBe(undefined);
  expect(alerts().length).toBe(0);

  reset("forgot");
  await submit();
  expect(state.toasts.length).toBe(1);
  expect(alerts().length).toBe(0);

  for (const nextMode of ["forgot", "sign-up", "sign-in"]) {
    for (const reject of [false, true]) {
      reset(nextMode);
      state.respond = async () => {
        if (reject) throw new Error("private backend details");
        return { error: { message: "private backend details" } };
      };
      await submit();
      assertRetryable();
    }
  }
  reset("sign-in");
  state.respond = async () => {
    throw new Error("private backend details");
  };
  await button("Continue with Google").props.onClick();
  assertRetryable();

  reset("sign-in");
  state.respond = async () => ({ error: { code: "EMAIL_NOT_VERIFIED" } });
  await submit();
  expect(state.toasts.length).toBe(0);
  expect(button("Resend email").props.disabled).toBe(false);
  expect(render().some((node) => node.type === "form")).toBe(false);
  button("Sign in").props.onClick();
  expect(render().some((node) => node.type === "form")).toBe(true);
});
