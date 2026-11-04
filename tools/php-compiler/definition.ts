import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("php-compiler", {
  name: "PHP Compiler",
  label: "PHP",
  mark: "PHP",
  compiled: false,
  keywords: ["php", "php compiler", "online php", "run php", "php interpreter", "php playground"],
  faq: {
    q: "Do I need the opening PHP tag?",
    a: "Yes. Start the file with <?php. Read input with fgets(STDIN) or stream_get_contents(STDIN).",
  },
});
