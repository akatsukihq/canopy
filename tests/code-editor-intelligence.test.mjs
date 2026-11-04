import { test, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";

import { loadCodeEditorLanguage } from "../components/content/codeEditorLanguages.ts";
import { LANGUAGE_DATA } from "../components/content/codeLanguageData.ts";
import { callAt, indexSymbols, symbolCompletionSource } from "../components/content/codeSymbols.ts";

async function stateFor(code, language) {
  return EditorState.create({ doc: code, extensions: [await loadCodeEditorLanguage(language)] });
}

async function symbolsFor(code, language) {
  const symbols = indexSymbols(await stateFor(code, language), LANGUAGE_DATA[language]);
  return Object.fromEntries(symbols.map((symbol) => [symbol.name, symbol]));
}

test("Python indexes functions with docstrings, parameters, classes and assignments, not comment text", async () => {
  const symbols = await symbolsFor(
    `import sys\n\n# def fake(): commented out\ndef greet(name, punctuation="!"):\n    """Builds a greeting."""\n    message = f"Hi {name}"\n    return message\n\nclass Person:\n    pass\n`,
    "python",
  );
  expect(symbols.greet.kind).toBe("function");
  expect(symbols.greet.docs).toBe("Builds a greeting.");
  expect(symbols.greet.signature).toBe('def greet(name, punctuation="!")');
  expect(symbols.name.kind).toBe("variable");
  expect(symbols.punctuation.kind).toBe("variable");
  expect(symbols.message.kind).toBe("variable");
  expect(symbols.Person.kind).toBe("class");
  expect(symbols.sys.kind).toBe("namespace");
  expect(symbols.fake).toBeUndefined();
});

test("C-family languages take the declared name from `type name` and keep doc comments", async () => {
  const java = await symbolsFor(
    `public class Main {\n  /** Adds two numbers. */\n  static int add(int left, int right) {\n    return left + right;\n  }\n  public static void main(String[] args) {\n    Scanner input = new Scanner(System.in);\n    for (String word : args) {}\n  }\n}\n`,
    "java",
  );
  expect(java.Main.kind).toBe("class");
  expect(java.add.docs).toBe("Adds two numbers.");
  expect(java.left.kind).toBe("variable");
  expect(java.input.kind).toBe("variable");
  expect(java.word.kind).toBe("variable");
  expect(java.return).toBeUndefined();

  const cpp = await symbolsFor(
    `#define LIMIT 10\nstruct Point { int x; };\nint square(int value) {\n  return value * value;\n}\n`,
    "cpp",
  );
  expect(cpp.LIMIT.kind).toBe("constant");
  expect(cpp.Point.kind).toBe("class");
  expect(cpp.square.kind).toBe("function");
  expect(cpp.value.kind).toBe("variable");
});

test("Go, Rust, PHP and Bash declarations are indexed by their own syntax", async () => {
  const go = await symbolsFor(`package main\n\nfunc sum(values []int) int {\n\ttotal := 0\n\treturn total\n}\n`, "go");
  expect(go.sum.kind).toBe("function");
  expect(go.total.kind).toBe("variable");
  const rust = await symbolsFor(`fn main() {\n    let mut count = 0;\n}\nstruct Point;\n`, "rust");
  expect(rust.count.kind).toBe("variable");
  expect(rust.Point.kind).toBe("class");
  const php = await symbolsFor(`<?php\nfunction greet($name) { $text = "hi"; }\n`, "php");
  expect(php.greet.kind).toBe("function");
  expect(php.$text.kind).toBe("variable");
  const bash = await symbolsFor(`#!/bin/bash\nshout() {\n  echo "$1"\n}\nread -r first last\n`, "bash");
  expect(bash.shout.kind).toBe("function");
  expect(bash.first.kind).toBe("variable");
  expect(bash.last.kind).toBe("variable");
});

test("call detection reports the callee and the argument under the cursor", () => {
  expect(callAt("print(a, b")).toEqual({ callee: "print", argument: 1 });
  expect(callAt("fmt.Println(x, f(y), ")).toEqual({ callee: "fmt.Println", argument: 2 });
  expect(callAt("std::max(items[0], ")).toEqual({ callee: "std::max", argument: 1 });
  expect(callAt("foo(a);\nbar")).toBeNull();
  expect(callAt("if (ready) {\n  x")).toBeNull();
});

test("completion offers file symbols, built-ins and module members", async () => {
  const data = LANGUAGE_DATA.python;
  const source = symbolCompletionSource(data);
  const code = "def compute_total(items):\n    return sum(items)\n\ncomp";
  const state = await stateFor(code, "python");
  const result = await source(new CompletionContext(state, code.length, false));
  const labels = result.options.map((option) => option.label);
  expect(labels).toContain("compute_total");
  expect(labels).toContain("print");
  expect(labels).toContain("def");

  const members = "import sys\nsys.st";
  const memberResult = await source(new CompletionContext(await stateFor(members, "python"), members.length, false));
  expect(memberResult.from).toBe(members.length - 2);
  expect(memberResult.options.map((option) => option.label)).toContain("stdin");
});
