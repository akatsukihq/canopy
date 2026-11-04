import { expect, test } from "@playwright/test";

import { enabledTools } from "../helpers/toolSpec.mjs";

const DEVTOOLS_URL = "http://localhost:3000/devtools";

// The public catalogue is the enabled rows of the dev database the server reads.
const DEVTOOLS = (await enabledTools("devtools")) as { slug: string; spec: { category: string } }[];
const AVAILABLE_DEVTOOL_HREFS = DEVTOOLS.map((tool) => `/${tool.slug}`).sort();
const DEVTOOLS_CATEGORY_COUNT = new Set(DEVTOOLS.map((tool) => tool.spec.category)).size;

test.describe("Devtools catalog navigation", () => {
  test("homepage uses public availability language", async ({ page }) => {
    await page.goto(DEVTOOLS_URL);

    const facts = page.getByRole("region", { name: "Devtools facts" });
    await expect(facts.getByText("Available tools", { exact: true })).toBeVisible();
    await expect(facts.getByText("Enabled tools", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /\b\d+ available\b/i })).toHaveCount(DEVTOOLS_CATEGORY_COUNT);
    await expect(page.getByRole("link", { name: /\b\d+ enabled\b/i })).toHaveCount(0);
  });

  test("Popular Tools View all opens one complete All Tools listing", async ({ page }) => {
    await page.goto(DEVTOOLS_URL);

    await expect(page.getByRole("heading", { name: "Popular Tools", exact: true })).toBeVisible();
    const viewAll = page.getByRole("link", { name: "View all", exact: true });
    await expect(viewAll).toBeVisible();
    await viewAll.click();

    await expect(page).toHaveURL((url) => url.pathname === "/devtools" && url.searchParams.get("view") === "all");
    await expect(page.getByRole("heading", { name: "All Tools", exact: true })).toBeVisible();

    const toolLinks = page.getByRole("main").getByRole("link").filter({ hasText: "Open tool →" });
    await expect(toolLinks).toHaveCount(AVAILABLE_DEVTOOL_HREFS.length);
    const actualHrefs = await toolLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")).sort());
    expect(actualHrefs).toEqual(AVAILABLE_DEVTOOL_HREFS);
  });

  for (const { category, slug, title } of [
    {
      category: "JSON Tools",
      slug: "json-to-csv",
      title: "JSON to CSV",
    },
    {
      category: "JSON Tools",
      slug: "json-viewer",
      title: "JSON Viewer",
    },
    {
      category: "Text Tools",
      slug: "word-counter",
      title: "Word Counter",
    },
  ]) {
    test(`${title} breadcrumb links to All Tools and its category listing`, async ({ page }) => {
      const toolUrl = `${DEVTOOLS_URL}/${slug}`;
      await page.goto(toolUrl);

      const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
      await expect(breadcrumb).toBeVisible();
      const allTools = breadcrumb.getByRole("link", {
        name: "All tools",
        exact: true,
      });
      await expect(allTools).toHaveAttribute("href", "/?view=all");

      const categoryLink = breadcrumb.getByRole("link", {
        name: category,
        exact: true,
      });
      await expect(categoryLink).toHaveAttribute("href", `/?category=${encodeURIComponent(category)}`);

      const currentTool = breadcrumb.getByText(title, { exact: true });
      await expect(currentTool).toBeVisible();
      await expect(currentTool).toHaveAttribute("aria-current", "page");
      await expect(breadcrumb).toContainText(new RegExp(`All tools\\s*/\\s*${category}\\s*/\\s*${title}`));

      await allTools.click();
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === "/devtools" && url.searchParams.get("view") === "all" && !url.searchParams.has("category"),
      );
      await expect(page.getByRole("heading", { name: "All Tools", exact: true })).toBeVisible();

      await page.goto(toolUrl);
      await page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("link", { name: category, exact: true })
        .click();
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === "/devtools" &&
          !url.searchParams.has("view") &&
          url.searchParams.get("category") === category,
      );
      await expect(page.getByText(`Tools in ${category}.`, { exact: true })).toBeVisible();
    });
  }
});

test("anonymous visitors can discover and use the public tools", async ({ context, page }) => {
  await page.goto("http://localhost:3000");
  await expect(page.getByRole("heading", { name: "Less time between need and done." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await page.goto("http://localhost:3000/paperwork");
  await expect(page.getByRole("heading", { name: "Choose the paperwork tool for the job." })).toBeVisible();
  await page.getByRole("link", { name: /Invoice Generator/ }).click();
  await expect(page).toHaveURL("http://localhost:3000/paperwork/invoice-generator");
  await expect(
    page.getByRole("heading", {
      name: "Free Invoice Generator for Contractors & Small Businesses",
    }),
  ).toBeVisible();

  await page.goto("http://localhost:3000/devtools");
  await expect(page.getByRole("heading", { name: "Free developer tools that run in your browser." })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search developer tools" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Popular Tools" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recently Added Tools" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Browse by Category" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Why use SmartTools?" })).toBeVisible();
  await page
    .getByRole("link", { name: /JSON to CSV/ })
    .first()
    .click();
  await expect(page).toHaveURL("http://localhost:3000/devtools/json-to-csv");
  await page.getByRole("button", { name: "Load example" }).click();
  await expect(page.getByRole("textbox", { name: "CSV output" })).toHaveValue("id,name\n1,Alice\n2,Bob");

  await page.goto("http://localhost:3000/devtools/csv-to-json");
  await page.getByRole("button", { name: "Load example" }).click();
  await expect(page.getByRole("textbox", { name: "JSON output" })).toHaveValue(
    '[\n  {\n    "id": "1",\n    "name": "Alice"\n  },\n  {\n    "id": "2",\n    "name": "Bob"\n  }\n]',
  );

  await page.goto("http://localhost:3000/devtools/json-viewer");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://localhost:3000",
  });
  await page.getByRole("button", { name: "Load example" }).click();
  const jsonTree = page.getByRole("region", { name: "JSON tree" });
  await expect(jsonTree).toContainText("CodeUtilityKit");
  const collapseTools = jsonTree.getByRole("button", { name: "Collapse tools" });
  await expect(collapseTools).toHaveAttribute("aria-expanded", "true");
  await collapseTools.click();
  await expect(jsonTree.getByRole("button", { name: "Expand tools" })).toHaveAttribute("aria-expanded", "false");
  await expect(jsonTree.getByText('"json-viewer"', { exact: true })).toHaveCount(0);
  await jsonTree.getByRole("button", { name: "Expand tools" }).click();
  await expect(jsonTree.getByText('"json-viewer"', { exact: true })).toBeVisible();

  const copyName = jsonTree.getByRole("button", { name: "Copy name value" }).first();
  await copyName.locator("..").hover();
  await expect(copyName).toHaveCSS("opacity", "1");
  await copyName.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('"CodeUtilityKit"');

  await page.goto("http://localhost:3000/devtools/json-formatter");
  await page.getByRole("button", { name: "Clear JSON input" }).click();
  await page.getByRole("textbox", { name: "JSON input", exact: true }).fill('{"ready":true}');
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByRole("status")).toContainText("JSON is valid.");
});

test("JSON formatter skip link focuses the editor", async ({ page }) => {
  await page.goto(`${DEVTOOLS_URL}/json-formatter`);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to JSON input" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "JSON input", exact: true })).toBeFocused();
});

test("developer tool variants share the canonical responsive workspace", async ({ context, page }, testInfo) => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const { columnNumber, lineNumber, url } = message.location();
      if (url.endsWith("/favicon.ico") && message.text().includes("404")) return;
      consoleErrors.push(`${message.text()}${url ? ` (${url}:${lineNumber}:${columnNumber})` : ""}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  const isMobile = testInfo.project.name.includes("mobile");
  await page.setViewportSize(isMobile ? { height: 844, width: 390 } : { height: 982, width: 1512 });

  const framedTools: Record<
    string,
    {
      category: string;
      description: string;
      footer?: string;
      support: string;
      title: string;
    }
  > = {
    "html-viewer": {
      category: "Web & Markup Tools",
      description: "Preview HTML code",
      support: "Private by default",
      title: "HTML Viewer",
    },
    "json-to-csv": {
      category: "JSON Tools",
      description: "Convert JSON to CSV",
      support: "Private by default",
      title: "JSON to CSV",
    },
    "json-formatter": {
      category: "JSON Tools",
      description: "Beautify & format JSON",
      support: "Private by default",
      title: "JSON Formatter",
    },
    "json-validator": {
      category: "JSON Tools",
      description: "Validate JSON syntax",
      support: "Private by default",
      title: "JSON Validator",
    },
    "json-viewer": {
      category: "JSON Tools",
      description: "Explore nested JSON in a searchable tree without uploading your data.",
      support: "Private by default",
      title: "JSON Viewer",
    },
    "password-generator": {
      category: "Text Tools",
      description: "Generate secure passwords",
      support: "Private by default",
      title: "Password Generator",
    },
    "qr-code-generator": {
      category: "Encoding & Decoding",
      description: "Generate QR codes",
      support: "Private by default",
      title: "QR Code Generator",
    },
    "text-diff-checker": {
      category: "Text Tools",
      description: "Compare two texts",
      support: "Private by default",
      title: "Text Diff Checker",
    },
    "word-counter": {
      category: "Text Tools",
      description: "Count words & characters",
      support: "Private by default",
      title: "Word Counter",
    },
  };

  async function expectRoundedThemeFrame(workspace: ReturnType<typeof page.getByTestId>) {
    const frameStyle = await workspace.evaluate((element) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context is unavailable");
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = style.borderTopColor;
      context.fillRect(0, 0, 1, 1);
      return {
        alpha: context.getImageData(0, 0, 1, 1).data[3],
        color: style.borderTopColor,
        radii: [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ].map((radius) => Number.parseFloat(radius)),
        style: style.borderTopStyle,
        width: Number.parseFloat(style.borderTopWidth),
      };
    });
    expect(Math.min(...frameStyle.radii)).toBeGreaterThan(0);
    expect(frameStyle.width).toBeGreaterThan(0);
    expect(frameStyle.style).toBe("solid");
    expect(frameStyle.color).not.toBe("transparent");
    expect(frameStyle.alpha).toBeGreaterThan(0);
  }

  async function openWorkspace(slug: string, dense = false) {
    await page.goto(`http://localhost:3000/devtools/${slug}`);
    const workspace = page.getByTestId("tool-workspace");
    const toolbar = workspace.getByTestId("tool-action-toolbar");
    const content = workspace.getByTestId("tool-workspace-content");
    await expect(workspace).toBeVisible();
    await expect(toolbar).toBeVisible();
    await expect(content).toBeAttached();
    await expect(workspace.getByTestId("tool-status-line")).toBeAttached();
    await expectRoundedThemeFrame(workspace);
    const overflow = await workspace.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    const frame = framedTools[slug];
    if (frame) {
      const main = page.locator("main");
      const siteHeader = page.locator("header").first();
      const breadcrumb = main.getByRole("navigation", { name: "Breadcrumb" });
      const title = main.getByRole("heading", {
        level: 1,
        name: frame.title,
        exact: true,
      });
      const description = main.getByText(frame.description, { exact: true });
      const support = main.getByRole("heading", { name: frame.support, exact: true });
      const runsLocallyTag = main.getByText("Runs locally", { exact: true });
      const categoryLabels = main.getByText(frame.category, { exact: true });
      const categoryTag = categoryLabels.last();
      const allToolsCrumb = breadcrumb.getByRole("link", {
        name: "All tools",
        exact: true,
      });
      const categoryCrumb = breadcrumb.getByRole("link", {
        name: frame.category,
        exact: true,
      });
      const currentToolCrumb = breadcrumb.getByText(frame.title, { exact: true });
      await expect(siteHeader).toContainText("Devtools");
      await expect(siteHeader).toContainText("by SmartTools");
      await expect(siteHeader.getByRole("link", { name: "Sign in" })).toBeVisible();
      await expect(allToolsCrumb).toHaveAttribute("href", "/?view=all");
      await expect(categoryCrumb).toHaveAttribute("href", `/?category=${encodeURIComponent(frame.category)}`);
      await expect(currentToolCrumb).toHaveAttribute("aria-current", "page");
      await expect(runsLocallyTag).toBeVisible();
      await expect(categoryLabels).toHaveCount(2);
      await expect(categoryTag).toBeVisible();
      await expect(title).toBeVisible();
      await expect(description).toBeVisible();
      await expect(support).toBeVisible();
      if (frame.footer) {
        await expect(page.locator("footer")).toContainText(frame.footer);
      } else {
        await expect(page.locator("footer")).toHaveCount(0);
      }

      const viewport = page.viewportSize();
      const bounds = await workspace.boundingBox();
      const breadcrumbBounds = await breadcrumb.boundingBox();
      const titleBounds = await title.boundingBox();
      const descriptionBounds = await description.boundingBox();
      const runsLocallyBounds = await runsLocallyTag.boundingBox();
      const categoryTagBounds = await categoryTag.boundingBox();
      const pageHeaderDivider = await title.evaluate((heading) => {
        const header = heading.closest("header");
        if (!(header instanceof HTMLElement)) {
          throw new Error("Tool page heading must be inside its semantic header");
        }
        return getComputedStyle(header).borderBottomWidth;
      });
      const workspaceStyle = await workspace.evaluate((element) => {
        const style = getComputedStyle(element);
        return { boxShadow: style.boxShadow };
      });
      expect(viewport).not.toBeNull();
      expect(bounds).not.toBeNull();
      expect(breadcrumbBounds).not.toBeNull();
      expect(titleBounds).not.toBeNull();
      expect(descriptionBounds).not.toBeNull();
      expect(runsLocallyBounds).not.toBeNull();
      expect(categoryTagBounds).not.toBeNull();
      expect(Math.abs(bounds!.x - breadcrumbBounds!.x)).toBeLessThan(2);
      expect(Math.abs(titleBounds!.x - breadcrumbBounds!.x)).toBeLessThan(2);
      expect(Math.abs(descriptionBounds!.x - breadcrumbBounds!.x)).toBeLessThan(2);
      expect(Math.abs(viewport!.width - bounds!.x - bounds!.width - breadcrumbBounds!.x)).toBeLessThan(2);
      expect(bounds!.y).toBeGreaterThan(descriptionBounds!.y + descriptionBounds!.height);
      expect(pageHeaderDivider).toBe("0px");
      expect(workspaceStyle).toEqual({ boxShadow: "none" });
      if (isMobile) {
        expect(viewport!.width).toBe(390);
        for (const elementBounds of [titleBounds!, runsLocallyBounds!, categoryTagBounds!]) {
          expect(elementBounds.x).toBeGreaterThanOrEqual(-1);
          expect(elementBounds.x + elementBounds.width).toBeLessThanOrEqual(viewport!.width + 1);
        }
      } else {
        expect(viewport!.width).toBe(1512);
        for (const tagBounds of [runsLocallyBounds!, categoryTagBounds!]) {
          const verticalOverlap =
            Math.min(titleBounds!.y + titleBounds!.height, tagBounds.y + tagBounds.height) -
            Math.max(titleBounds!.y, tagBounds.y);
          expect(verticalOverlap).toBeGreaterThan(0);
        }
        expect(descriptionBounds!.y).toBeGreaterThan(
          Math.max(
            titleBounds!.y + titleBounds!.height,
            runsLocallyBounds!.y + runsLocallyBounds!.height,
            categoryTagBounds!.y + categoryTagBounds!.height,
          ),
        );
      }
      const pageOverflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(pageOverflow.clientWidth + 1);
      if (!isMobile) {
        const toolbarBounds = await toolbar.boundingBox();
        const contentBounds = await content.boundingBox();
        const statusBounds = await workspace.getByTestId("tool-status-line").boundingBox();
        expect(toolbarBounds).not.toBeNull();
        expect(contentBounds).not.toBeNull();
        expect(statusBounds).not.toBeNull();
        if (dense) expect(toolbarBounds!.height).toBeLessThanOrEqual(72);
        expect(contentBounds!.height).toBeGreaterThan(400);
        expect(Math.abs(statusBounds!.y + statusBounds!.height - bounds!.y - bounds!.height)).toBeLessThan(2);
      }
    }
    return { content, toolbar, workspace };
  }

  async function expectPanels(
    content: ReturnType<typeof page.getByTestId>,
    names: Array<"input" | "output" | "details">,
  ) {
    const panels = Object.fromEntries(names.map((name) => [name, content.locator(`[data-workspace-panel="${name}"]`)]));
    for (const panel of Object.values(panels)) await expect(panel).toBeAttached();
    const bounds = await Promise.all(
      names.map(async (name) => {
        const box = await panels[name].boundingBox();
        expect(box).not.toBeNull();
        return box!;
      }),
    );
    if (isMobile) {
      for (let index = 1; index < bounds.length; index += 1) {
        expect(bounds[index].y).toBeGreaterThanOrEqual(bounds[index - 1].y + bounds[index - 1].height - 2);
      }
    } else {
      for (let index = 1; index < bounds.length; index += 1) {
        expect(Math.abs(bounds[index].y - bounds[0].y)).toBeLessThan(2);
        expect(bounds[index].x).toBeGreaterThanOrEqual(bounds[index - 1].x + bounds[index - 1].width - 2);
      }
    }
  }

  async function expectNoFormatterChrome(toolbar: ReturnType<typeof page.getByTestId>, allowed: string[] = []) {
    for (const name of ["Format", "Minify", "Validate"]) {
      if (!allowed.includes(name)) {
        await expect(toolbar.getByRole("button", { name, exact: true })).toHaveCount(0);
      }
    }
  }

  await test.step("canonical JSON formatter", async () => {
    const { content, toolbar, workspace } = await openWorkspace("json-formatter");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://localhost:3000",
    });
    for (const name of ["Format", "Minify", "Validate"]) {
      await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible();
    }
    const copy = toolbar.getByRole("button", { name: "Copy formatted JSON" });
    const clear = toolbar.getByRole("button", { name: "Clear JSON input" });
    await expect(copy).toBeVisible();
    await expect(clear).toBeVisible();
    await expectPanels(content, ["input", "output", "details"]);
    const statusLine = workspace.getByTestId("tool-status-line");
    await expect(statusLine).toContainText("Valid JSON");
    await expect(statusLine).toContainText("UTF-8");

    const outputPanel = content.locator(':scope > [data-workspace-panel="output"]');
    await expect(
      outputPanel.getByRole("textbox", {
        name: "Formatted JSON output",
        exact: true,
      }),
    ).toHaveCount(0);
    const tree = outputPanel.getByRole("tree", { name: "JSON tree" });
    const inspector = workspace.getByRole("complementary", {
      name: "JSON inspector",
    });
    const preview = inspector.getByRole("table", { name: "Data Preview" });
    async function expectNodeMetadata(key: string, type: string, previewText: string[]) {
      await expect(inspector.getByText(`"${key}"`, { exact: true })).toBeVisible();
      await expect(inspector.getByText(type, { exact: true })).toBeVisible();
      for (const text of previewText) await expect(preview).toContainText(text);
    }

    const root = tree.getByRole("treeitem", { name: "root", exact: true });
    await expect(root).toHaveAttribute("aria-selected", "true");
    await expectNodeMetadata("root", "Object {4}", ["id", '"12345"', "name", '"Project Apollo"']);

    const details = tree.getByRole("treeitem", { name: "details", exact: true });
    await details.focus();
    await expect(details).toHaveAttribute("aria-selected", "true");
    await expectNodeMetadata("details", "Object {2}", ["tasks", "[…]", "metadata"]);

    const tasks = tree.getByRole("treeitem", { name: "tasks", exact: true });
    await tasks.click();
    await expect(tasks).toHaveAttribute("aria-selected", "true");
    await expect(tasks).toHaveAttribute("aria-expanded", "true");
    await expectNodeMetadata("tasks", "Array [2]", ["0", "{…}", "1"]);

    const firstTask = tree.getByRole("treeitem", { name: "[0]", exact: true });
    await firstTask.click();
    await expect(firstTask).toHaveAttribute("aria-selected", "true");
    await expect(firstTask).toHaveAttribute("aria-expanded", "true");
    await expectNodeMetadata("0", "Object {3}", ["id", "1", "title", '"Design System"']);

    const title = tree.getByRole("treeitem", { name: "title", exact: true });
    await title.focus();
    await page.keyboard.press("Enter");
    await expect(title).toHaveAttribute("aria-selected", "true");
    await expectNodeMetadata("title", "string", ["value", '"Design System"']);

    const completed = tree.getByRole("treeitem", { name: "completed", exact: true });
    await completed.focus();
    await page.keyboard.press("Space");
    await expect(completed).toHaveAttribute("aria-selected", "true");
    await expectNodeMetadata("completed", "boolean", ["value", "true"]);

    const input = page.getByRole("textbox", { name: "JSON input", exact: true });
    const inputDocument = await input.textContent();
    expect(inputDocument).not.toBeNull();
    const expectedFormatted = JSON.stringify(JSON.parse(inputDocument!), null, 2);
    const minify = toolbar.getByRole("button", { name: "Minify", exact: true });
    const format = toolbar.getByRole("button", { name: "Format", exact: true });
    await minify.click();
    await expect(minify).toHaveAttribute("aria-pressed", "true");
    await expect(statusLine).toContainText("Output minified.");
    await format.click();
    await expect(format).toHaveAttribute("aria-pressed", "true");
    await expect(statusLine).toContainText("Output formatted.");
    await toolbar.getByRole("button", { name: "Validate", exact: true }).click();
    await expect(statusLine).toContainText("JSON is valid.");
    await copy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedFormatted);

    await input.fill('{"broken":}');
    await expect(outputPanel.getByRole("tree", { name: "JSON tree" })).toHaveCount(0);
    await expect(outputPanel.getByText("JSON needs attention", { exact: true })).toBeVisible();
    await expect(statusLine).toContainText("Invalid JSON");
    await clear.click();
    await expect(outputPanel.getByRole("tree", { name: "JSON tree" })).toHaveCount(0);
    await expect(outputPanel.getByText("Ready for JSON", { exact: true })).toBeVisible();
  });

  await test.step("two-pane converter", async () => {
    const { content, toolbar, workspace } = await openWorkspace("json-to-csv", true);
    await expectNoFormatterChrome(toolbar);
    await expectPanels(content, ["input", "output"]);
    await expect(content.locator(':scope > [data-workspace-panel="input"] > header')).toContainText(/input/i);
    await expect(content.locator(':scope > [data-workspace-panel="output"] > header')).toContainText(/output/i);
    const clear = toolbar.getByRole("button", { name: "Clear", exact: true });
    await expect(clear).toBeDisabled();
    await expect(workspace.getByRole("button", { name: "Copy CSV output" })).toBeDisabled();
    await expect(workspace.getByRole("button", { name: "Download CSV output" })).toBeDisabled();
    await toolbar.getByRole("button", { name: "Load example" }).click();
    await expect(page.getByRole("textbox", { name: "CSV output" })).toHaveValue("id,name\n1,Alice\n2,Bob");
    await expect(clear).toBeEnabled();
    await expect(workspace.getByRole("button", { name: "Copy CSV output" })).toBeEnabled();
    await expect(workspace.getByRole("button", { name: "Download CSV output" })).toBeEnabled();
  });

  await test.step("live single-input tool", async () => {
    const { content, toolbar, workspace } = await openWorkspace("word-counter", true);
    await expectNoFormatterChrome(toolbar);
    await expectPanels(content, ["input", "output"]);
    await expect(content.locator(':scope > [data-workspace-panel="input"] > header')).toContainText("Input");
    await expect(content.locator(':scope > [data-workspace-panel="output"] > header')).toContainText("Output");
    await expect(toolbar.getByRole("button", { name: "Count", exact: true })).toBeEnabled();
    await expect(toolbar.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
    await expect(workspace.getByRole("button", { name: "Copy output" })).toBeDisabled();
    await toolbar.getByRole("button", { name: "Load example" }).click();
    await expect(page.getByRole("textbox", { name: "Word Counter output" })).toHaveValue(/Words: 12/);
    await expect(workspace.getByRole("button", { name: "Copy output" })).toBeEnabled();
  });

  await test.step("dual-input comparison", async () => {
    const { content, toolbar, workspace } = await openWorkspace("text-diff-checker", true);
    await expectNoFormatterChrome(toolbar);
    await expectPanels(content, ["input", "output"]);
    await expect(workspace.getByTestId("utility-input-panel").getByRole("textbox")).toHaveCount(2);
    const run = toolbar.getByRole("button", { name: "Compare text", exact: true });
    await expect(run).toBeEnabled();
    await expect(toolbar.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
    await expect(workspace.getByRole("button", { name: "Copy output" })).toBeDisabled();
    await toolbar.getByRole("button", { name: "Load example" }).click();
    await run.click();
    await expect(page.getByRole("textbox", { name: "Text Diff Checker output" })).not.toHaveValue("");
  });

  await test.step("generator", async () => {
    const { content, toolbar, workspace } = await openWorkspace("password-generator", true);
    await expectNoFormatterChrome(toolbar);
    await expectPanels(content, ["input", "output"]);
    const generate = toolbar.getByRole("button", { name: "Generate", exact: true });
    const clear = toolbar.getByRole("button", { name: "Clear", exact: true });
    await expect(generate).toBeEnabled();
    await expect(clear).toBeDisabled();
    await expect(workspace.getByRole("button", { name: "Copy output" })).toBeDisabled();
    await generate.click();
    await expect(page.getByRole("textbox", { name: "Password Generator output" })).toHaveValue(/.+/);
    await expect(clear).toBeEnabled();
    await expect(workspace.getByRole("button", { name: "Copy output" })).toBeEnabled();
  });

  await test.step("single-input validator", async () => {
    const { content, toolbar, workspace } = await openWorkspace("json-validator", true);
    await expectNoFormatterChrome(toolbar, ["Validate"]);
    await expectPanels(content, ["input", "output"]);
    const validate = toolbar.getByRole("button", { name: "Validate", exact: true });
    await expect(validate).toBeEnabled();
    await expect(toolbar.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
    await expect(workspace.getByRole("button", { name: "Copy output" })).toBeDisabled();
    await toolbar.getByRole("button", { name: "Load example" }).click();
    await validate.click();
    await expect(page.getByRole("textbox", { name: "JSON Validator output" })).toHaveValue(/Valid JSON/);
  });

  await test.step("sandboxed HTML preview", async () => {
    const { content, toolbar, workspace } = await openWorkspace("html-viewer", true);
    await expectNoFormatterChrome(toolbar);
    await expectPanels(content, ["input", "output"]);
    await expect(toolbar.getByRole("button", { name: "Preview HTML", exact: true })).toBeEnabled();
    await expect(toolbar.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
    await expect(workspace.getByRole("button", { name: "Copy output" })).toBeDisabled();
    await toolbar.getByRole("button", { name: "Load example" }).click();
    const preview = page.locator('iframe[title="HTML Viewer preview"]');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("sandbox", "");
    await expect(page.frameLocator('iframe[title="HTML Viewer preview"]').locator("body")).toContainText("Hello");
    await expect(workspace.getByRole("button", { name: "Copy output" })).toBeEnabled();
  });

  await test.step("image preview", async () => {
    const { content, toolbar, workspace } = await openWorkspace("qr-code-generator", true);
    await expectNoFormatterChrome(toolbar);
    await expectPanels(content, ["input", "output", "details"]);
    const generate = toolbar.getByRole("button", { name: "Generate QR code", exact: true });
    await expect(generate).toBeEnabled();
    await expect(toolbar.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
    await expect(workspace.getByRole("button", { name: "Copy output" })).toBeDisabled();
    await toolbar.getByRole("button", { name: "Load example" }).click();
    await generate.click();
    const image = page.getByRole("img", { name: "QR Code Generator result" });
    await expect(image).toBeVisible();
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  });

  await test.step("JSON Viewer", async () => {
    const { content, toolbar, workspace } = await openWorkspace("json-viewer");
    await expectNoFormatterChrome(toolbar, ["Minify"]);
    await expectPanels(content, ["input", "output"]);
    for (const name of ["Load example", "Load broken example", "Beautify", "Minify", "Repair & clean"]) {
      await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible();
    }
    const clear = toolbar.getByRole("button", { name: "Clear", exact: true });
    await expect(clear).toBeEnabled();
    const renderer = workspace.getByTestId("json-result-renderer");
    await expect(renderer).toContainText("CodeUtilityKit");
    await expect(renderer.getByRole("button", { name: "Copy JSON result" })).toBeEnabled();
    await expect(renderer.getByRole("button", { name: "Download JSON result" })).toBeEnabled();
    await expect(workspace.getByTestId("tool-workbench-rail")).toHaveCount(0);
  });

  expect({ consoleErrors, failedResponses }).toEqual({
    consoleErrors: [],
    failedResponses: [],
  });
});

test("invoice workflow exposes protected actions and supporting content", async ({ page }, testInfo) => {
  await page.goto("http://localhost:3000/paperwork/invoice-generator");

  await expect(page.getByRole("heading", { name: "Frequently Asked Questions" })).toBeVisible();
  await expect(
    page.locator("#related-tools-block").getByRole("link", {
      name: /Invoice Generator/,
    }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /Join Waiting List/ }).click();
  const waitlist = page.getByRole("dialog", { name: "Join the Paperwork Pro waitlist" });
  await expect(waitlist).toBeVisible();
  await waitlist.getByLabel("Email address").fill("owner@example.com");
  await waitlist.getByRole("button", { name: "Join waiting list" }).click();
  await expect(page.getByRole("status")).toContainText("interest saved in this browser");

  await page.getByRole("button", { name: "Load sample" }).click();
  const sampleConfirmation = page.getByRole("dialog", {
    name: "Load sample invoice?",
  });
  await expect(sampleConfirmation).toBeVisible();
  await sampleConfirmation.getByRole("button", { name: "Load sample invoice" }).click();
  await expect(page.getByRole("status")).toContainText("Sample invoice loaded");

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  const clearConfirmation = page.getByRole("dialog", {
    name: "Clear this invoice draft?",
  });
  await expect(clearConfirmation).toBeVisible();
  await clearConfirmation.getByRole("button", { name: "Clear invoice draft" }).click();
  await expect(page.getByRole("status")).toContainText("Invoice draft cleared");
  await page.getByRole("button", { name: "Download PDF" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "highlighted fields before exporting" })).toBeVisible();

  if (testInfo.project.name.includes("mobile")) {
    await expect(page.getByRole("tab", { name: "Edit details" })).toBeVisible();
    await page.getByRole("tab", { name: "Live preview" }).click();
    await expect(page.locator("#preview-panel")).toBeVisible();
    await expect(page.locator("#mobile-invoice-actions")).toBeVisible();
  }
});

test("header menus include every document tool and valid category filters", async ({ request }) => {
  const { TOOL_CATEGORIES } = await import("../../lib/tool-framework/categories");
  const response = await request.get("http://localhost:3000/api/tools/ecosystem");
  expect(response.ok()).toBe(true);
  const { groups } = await response.json();
  const documents = groups.find((group: { id: string }) => group.id === "documents");
  expect(documents.tools.length).toBe(documents.count);
  expect(new Set(documents.tools.map((tool: { href: string }) => tool.href)).size).toBe(documents.count);
  for (const id of ["developer", "media"]) {
    const group = groups.find((item: { id: string }) => item.id === id);
    expect(group.categories.length).toBeGreaterThan(0);
    for (const category of group.categories) {
      const key = new URL(category.href, "http://localhost:3000").searchParams.get("category");
      expect(Object.keys(TOOL_CATEGORIES)).toContain(key);
      const definition = TOOL_CATEGORIES[key as keyof typeof TOOL_CATEGORIES];
      expect(definition.label).toBe(category.label);
      expect(definition.app).toBe(id === "developer" ? "devtools" : "media");
    }
  }
});
