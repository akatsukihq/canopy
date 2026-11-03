/**
 * The closed, code-owned list of languages that may run on the execution
 * engine. The database never selects a language, version or limit: a tool
 * folder passes only its own `definitionKey` and this registry resolves it.
 */

/** Per-run limits sent to Piston. Absent fields fall back to the engine's own configuration. */
export type CodeLimits = {
  readonly runTimeoutMs?: number;
  readonly runCpuTimeMs?: number;
  readonly compileTimeoutMs?: number;
  readonly compileCpuTimeMs?: number;
  readonly runMemoryBytes?: number;
  readonly compileMemoryBytes?: number;
};

/** One runnable version: what the visitor picks and the exact Piston runtime it maps to. */
export type CodeVersion = {
  /** Stable id the browser sends (e.g. "3.14", "c++20"); never a Piston string. */
  readonly id: string;
  /** Shown in the version picker, after the language name. */
  readonly label: string;
  /** Piston runtime name or alias. */
  readonly language: string;
  /** Exact version; never a range. */
  readonly version: string;
  /** Set when the version belongs to the compiler/runtime, not the language (e.g. "GCC"). */
  readonly runtime?: string;
};

type CodeLanguageEntry = {
  readonly definitionKey: string;
  /** Every version this page can run, newest first; the first is the default. */
  readonly versions: readonly [CodeVersion, ...CodeVersion[]];
  readonly fileName: string;
  /** Language id understood by CodeEditor and SyntaxHighlight. */
  readonly editorLanguage: string;
  /** Reads stdin and prints, so Run works on first click. */
  readonly starter: string;
  readonly limits?: CodeLimits;
};

/** A registry entry resolved to one version (`versionId` and the Piston fields of that version). */
export type CodeLanguage = CodeLanguageEntry & Omit<CodeVersion, "id" | "label"> & { readonly versionId: string };

const v = (id: string, label: string, language: string, version: string, runtime?: string): CodeVersion => ({
  id,
  label,
  language,
  version,
  ...(runtime && { runtime }),
});

/** Engine defaults from design.md section 2, used only to word "limit reached" outcomes. */
export const DEFAULT_CODE_LIMITS = {
  runCpuTimeMs: 3_000,
  runTimeoutMs: 5_000,
  compileCpuTimeMs: 10_000,
  compileTimeoutMs: 15_000,
} as const;

// Every version must exist in the Piston image (scripts/piston); docs/code-execution.md lists them.
const ENTRIES: readonly CodeLanguageEntry[] = [
  {
    definitionKey: "python-compiler",
    versions: [
      v("3.15", "Python 3.15", "python", "3.15.2"),
      v("3.14", "Python 3.14", "python", "3.14.10"),
      v("3.13", "Python 3.13", "python", "3.13.18"),
      v("3.12", "Python 3.12", "python", "3.12.0"),
    ],
    fileName: "main.py",
    editorLanguage: "python",
    starter: `import sys

name = sys.stdin.readline().strip() or "world"
print(f"Hello, {name}!")
`,
  },
  {
    definitionKey: "javascript-compiler",
    versions: [
      v("26", "Node.js 26 (LTS)", "javascript", "26.13.0"),
      v("24", "Node.js 24 (LTS)", "javascript", "24.22.2"),
      v("22", "Node.js 22 (LTS)", "javascript", "22.23.4"),
    ],
    fileName: "main.js",
    editorLanguage: "javascript",
    starter: `const fs = require("fs");

const name = fs.readFileSync(0, "utf8").split("\\n")[0].trim() || "world";
console.log(\`Hello, \${name}!\`);
`,
  },
  {
    definitionKey: "typescript-compiler",
    versions: [
      v("7", "TypeScript 7.0", "typescript", "7.0.2"),
      v("6", "TypeScript 6.0", "typescript", "6.0.3"),
      v("5", "TypeScript 5.9", "typescript", "5.9.3"),
    ],
    fileName: "main.ts",
    editorLanguage: "typescript",
    // Unverified against the built image: task 2.2 must run this starter.
    starter: `import { readFileSync } from "fs";

const name: string = readFileSync(0, "utf8").split("\\n")[0].trim() || "world";
console.log(\`Hello, \${name}!\`);
`,
  },
  {
    definitionKey: "java-compiler",
    versions: [
      v("25", "Java 25 (LTS)", "java", "25.0.5"),
      v("21", "Java 21 (LTS)", "java", "21.0.13"),
      v("17", "Java 17 (LTS)", "java", "17.0.21"),
    ],
    fileName: "Main.java",
    editorLanguage: "java",
    starter: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        String name = in.hasNextLine() ? in.nextLine().trim() : "";
        System.out.println("Hello, " + (name.isEmpty() ? "world" : name) + "!");
    }
}
`,
  },
  {
    definitionKey: "c-compiler",
    versions: [
      v("c17", "C17 (GCC 12.2)", "c17", "12.2.0", "GCC"),
      v("c23", "C23 draft (GCC 12.2)", "c23", "12.2.0", "GCC"),
      v("c11", "C11 (GCC 12.2)", "c11", "12.2.0", "GCC"),
    ],
    fileName: "main.c",
    editorLanguage: "c",
    starter: `#include <stdio.h>
#include <string.h>

int main(void) {
    char name[256] = "";
    if (fgets(name, sizeof name, stdin)) name[strcspn(name, "\\r\\n")] = '\\0';
    printf("Hello, %s!\\n", name[0] ? name : "world");
    return 0;
}
`,
  },
  {
    definitionKey: "cpp-compiler",
    versions: [
      v("c++20", "C++20 (GCC 12.2)", "c++20", "12.2.0", "GCC"),
      v("c++23", "C++23 partial (GCC 12.2)", "c++23", "12.2.0", "GCC"),
      v("c++17", "C++17 (GCC 12.2)", "c++17", "12.2.0", "GCC"),
    ],
    fileName: "main.cpp",
    editorLanguage: "cpp",
    starter: `#include <iostream>
#include <string>

int main() {
    std::string name;
    std::getline(std::cin, name);
    if (name.empty()) name = "world";
    std::cout << "Hello, " << name << "!" << std::endl;
    return 0;
}
`,
  },
  {
    definitionKey: "csharp-compiler",
    versions: [
      v("14", "C# 14 (.NET 10 LTS)", "csharp", "10.0.403", ".NET"),
      v("12", "C# 12 (.NET 8 LTS)", "csharp", "8.0.427", ".NET"),
    ],
    fileName: "Program.cs",
    editorLanguage: "csharp",
    starter: `using System;

class Program
{
    static void Main()
    {
        string name = (Console.ReadLine() ?? "").Trim();
        if (name.Length == 0) name = "world";
        Console.WriteLine("Hello, " + name + "!");
    }
}
`,
  },
  {
    definitionKey: "go-compiler",
    versions: [v("1.27", "Go 1.27", "go", "1.27.3")],
    fileName: "main.go",
    editorLanguage: "go",
    starter: `package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func main() {
	line, _ := bufio.NewReader(os.Stdin).ReadString('\\n')
	name := strings.TrimSpace(line)
	if name == "" {
		name = "world"
	}
	fmt.Printf("Hello, %s!\\n", name)
}
`,
  },
  {
    definitionKey: "rust-compiler",
    versions: [v("1.99", "Rust 1.99 (2024 edition)", "rust", "1.99.1")],
    fileName: "main.rs",
    editorLanguage: "rust",
    starter: `use std::io;

fn main() {
    let mut line = String::new();
    io::stdin().read_line(&mut line).expect("failed to read stdin");
    let name = line.trim();
    let name = if name.is_empty() { "world" } else { name };
    println!("Hello, {}!", name);
}
`,
  },
  {
    definitionKey: "php-compiler",
    versions: [v("8.5", "PHP 8.5", "php", "8.5.12")],
    fileName: "main.php",
    editorLanguage: "php",
    starter: `<?php
$name = trim((string) fgets(STDIN));
echo "Hello, " . ($name === "" ? "world" : $name) . "!\\n";
`,
  },
  {
    definitionKey: "ruby-compiler",
    versions: [v("4.0", "Ruby 4.0", "ruby", "4.0.9"), v("3.4", "Ruby 3.4", "ruby", "3.4.12")],
    fileName: "main.rb",
    editorLanguage: "ruby",
    starter: `name = ($stdin.gets || "").strip
name = "world" if name.empty?
puts "Hello, #{name}!"
`,
  },
  {
    definitionKey: "kotlin-compiler",
    versions: [v("2.4", "Kotlin 2.4", "kotlin", "2.4.21")],
    fileName: "Main.kt",
    editorLanguage: "kotlin",
    starter: `fun main() {
    val name = (readLine() ?: "").trim()
    println("Hello, \${if (name.isEmpty()) "world" else name}!")
}
`,
  },
  {
    definitionKey: "bash-compiler",
    versions: [v("5.2", "Bash 5.2", "bash", "5.2.0")],
    fileName: "main.sh",
    editorLanguage: "bash",
    starter: `read -r name
echo "Hello, \${name:-world}!"
`,
  },
];

function resolve(entry: CodeLanguageEntry, { id, label: _label, ...runtime }: CodeVersion): CodeLanguage {
  return Object.freeze({ ...entry, ...runtime, versionId: id });
}

/** Each language resolved to its default (first) version. */
export const CODE_LANGUAGES: Readonly<Record<string, CodeLanguage>> = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.definitionKey, resolve(entry, entry.versions[0])])),
);

/**
 * Unknown keys and unknown version ids fail closed: returns null, never a guess.
 * Without `versionId` the default version is returned.
 */
export function getCodeLanguage(definitionKey: string, versionId?: string): CodeLanguage | null {
  if (!Object.hasOwn(CODE_LANGUAGES, definitionKey)) return null;
  const language = CODE_LANGUAGES[definitionKey];
  if (versionId === undefined || versionId === language.versionId) return language;
  const version = language.versions.find((entry) => entry.id === versionId);
  return version ? resolve(language, version) : null;
}
