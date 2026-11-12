import { expect, test } from "vitest";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function exists(path) {
  try {
    await access(new URL(path, root));
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

test("SmartTools is a root-owned direct-layout Next.js application", async () => {
  const packageJson = await readJson("package.json");
  expect(packageJson.name).toBe("canopy");
  expect(packageJson.private).toBe(true);
  expect(typeof packageJson.dependencies.next).toBe("string");
  expect(await exists("apps")).toBe(false);
  expect(await exists("components/canopy/PublicInfoChrome.tsx")).toBe(true);
  expect(await exists("app/paperwork/components/App.tsx")).toBe(true);
  expect(await exists("app/(public)/[locale]/layout.tsx")).toBe(true);
  expect(await exists("src")).toBe(false);
});

test("root scripts run the root-owned application directly", async () => {
  const packageJson = await readJson("package.json");

  expect(packageJson.scripts.dev).toMatch(/\bnext dev -p 3000$/);
  expect(packageJson.scripts["test:media"]).toMatch(/\bvitest run\b/);
  // The media processing source lives in the tool framework; `app/media/` is
  // now only the route shell and holds nothing worth covering.
  expect(packageJson.scripts["test:media"]).toMatch(/lib\/tool-framework\/media/);
  expect(packageJson.scripts.dev).not.toMatch(/--filter/);
  expect(packageJson.scripts["test:media"]).not.toMatch(/--filter/);
  for (const script of ["dev:platform", "dev:paperwork", "dev:devtools", "dev:media", "dev:admin", "dev:auth"]) {
    expect(packageJson.scripts[script]).toBe(undefined);
  }
});

test("Paperwork navigation uses scoped paths without URL hashes", async () => {
  const navigationFiles = ["app/paperwork/components/App.tsx", "app/paperwork/components/RelatedTools.tsx"];
  const source = (await Promise.all(navigationFiles.map((path) => readFile(new URL(path, root), "utf8")))).join("\n");

  expect(source).not.toMatch(/window\.location\.hash|hashchange|href\s*=\s*["']#|\bhash:\s*["']#/);
  expect(source).toMatch(/["'`]\/paperwork/);
});

test("contact and privacy are global while Paperwork-owned information stays scoped", async () => {
  // Shared footer navigation lives in CanopyFooter (suite and company links only);
  // Paperwork-owned information pages keep their scoped route and chrome.
  const app = await readFile(new URL("components/canopy/CanopyFooter.tsx", root), "utf8");

  for (const slug of ["contact", "privacy"]) {
    const page = await readFile(new URL(`app/(public)/[locale]/${slug}/page.tsx`, root), "utf8");
    expect(app).toMatch(new RegExp(`href(?:=|:)\\s*["']/${slug}["']`));
    expect(page).toMatch(/PublicInfoChrome/);
    expect(app).not.toMatch(new RegExp(`/paperwork/${slug}`));
  }

  for (const slug of ["about", "terms"]) {
    const page = await readFile(new URL(`app/(public)/[locale]/paperwork/${slug}/page.tsx`, root), "utf8");
    expect(page).toMatch(/InformationPage/);
  }
});

test("Paperwork routes components from managed tool props", async () => {
  const source = await readFile(new URL("app/paperwork/components/App.tsx", root), "utf8");

  expect(source).toMatch(/componentKey/);
  expect(source).toMatch(/tools/);
  expect(source).toMatch(/templates/);
  expect(source).not.toMatch(/usePathname|useRouter/);
  expect(source).not.toMatch(/AdminAuthGate|TemplateService/);
});

test("legacy Paperwork template administration is removed", async () => {
  for (const path of [
    "app/paperwork/admin/[[...route]]/page.tsx",
    "app/api/paperwork/admin/verify/route.ts",
    "app/paperwork/components/admin/AdminAuthGate.tsx",
    "app/paperwork/components/admin/FormGroups.tsx",
    "app/paperwork/components/admin/FullPagePreviewer.tsx",
    "app/paperwork/components/admin/TemplateEditor.tsx",
    "app/paperwork/components/admin/TemplateListTable.tsx",
    "lib/paperwork/admin/session.ts",
    "lib/paperwork/templates/templateService.ts",
  ]) {
    expect(await exists(path), `${path} must stay removed`).toBe(false);
  }

  const [environment, bootstrap, schema] = await Promise.all([
    readFile(new URL(".env.example", root), "utf8"),
    readFile(new URL("db/bootstrap.ts", root), "utf8"),
    readFile(new URL("db/paperworkSchema.ts", root), "utf8"),
  ]);
  expect(environment).not.toMatch(/ADMIN_PASSCODE/);
  expect(bootstrap).not.toMatch(/admin_passcode|ADMIN_PASSCODE|invoice_templates/);
  expect(schema).not.toMatch(/appConfigTable|invoiceTemplatesTable/);
});

test("Paperwork exposes published templates through its scoped read-only API", async () => {
  const route = await readFile(new URL("app/api/paperwork/templates/route.ts", root), "utf8");

  expect(route).toMatch(/getPublishedTemplates/);
  expect(route).toMatch(/tool\.componentKey === componentKey/);
  expect(route).toMatch(/export\s+async\s+function\s+GET/);
  expect(route).not.toMatch(/export\s+async\s+function\s+POST/);
  expect(route).not.toMatch(/localStorage|invoiceTemplatesTable/);
});

test("Paperwork scoped persistence APIs check the owning tool", async () => {
  const [accessSource, storage, storedKey, vendors] = await Promise.all([
    readFile(new URL("lib/paperwork/toolAccess.ts", root), "utf8"),
    readFile(new URL("app/api/paperwork/storage/route.ts", root), "utf8"),
    readFile(new URL("app/api/paperwork/storage/[key]/route.ts", root), "utf8"),
    readFile(new URL("app/api/paperwork/vendors/route.ts", root), "utf8"),
  ]);

  expect(accessSource).toMatch(/getAvailableToolBySlug/);
  expect(storage).toMatch(/requireAvailableToolForStorageKey/);
  expect(storedKey).toMatch(/requireAvailableToolForStorageKey/);
  expect(vendors).toMatch(/requireAnyAvailablePaperworkTool/);
});

test("Admin and Media ordering use the shared accessible drag-and-drop list", async () => {
  const [editor, toolList, orderableList] = await Promise.all([
    readFile(new URL("app/admin/(protected)/templates/[id]/components/TemplateEditor.tsx", root), "utf8"),
    readFile(new URL("app/admin/(protected)/tools/components/ToolList.tsx", root), "utf8"),
    readFile(new URL("components/ui/components/OrderableList.tsx", root), "utf8"),
  ]);

  expect(editor).toMatch(/<OrderableList/);
  expect(editor).toMatch(/GripVertical/);
  expect(editor).not.toMatch(/moveSection|ArrowUp|ArrowDown/);
  expect(toolList).toMatch(/@\/components\/ui\/components\/OrderableList/);
  expect(orderableList).toMatch(/KeyboardSensor/);
  expect(orderableList).toMatch(/PointerSensor/);
  expect(orderableList).toMatch(/sortableKeyboardCoordinates/);
});
