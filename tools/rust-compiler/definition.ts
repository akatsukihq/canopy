import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("rust-compiler", {
  name: "Rust Compiler",
  label: "Rust",
  mark: "RS",
  compiled: true,
  keywords: ["rust", "rustc", "rust compiler", "online rust", "run rust", "rust playground"],
  faq: {
    q: "Can I use crates from crates.io?",
    a: "No. Only the Rust standard library is available, because the sandbox has no network access and cargo cannot download crates.",
  },
});
