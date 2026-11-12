import { expect, test } from "vitest";
import {
  serializeJsonLd,
  siteStructuredData,
  suiteStructuredData,
  toolStructuredData,
} from "../lib/seo/structuredData.ts";
import { localizedAlternates } from "../lib/i18n/config.ts";

const appUrl = "https://smarttools.example";

test("tool pages describe a free web application linked to the site organization", () => {
  const data = toolStructuredData({
    suite: "devtools",
    suiteName: "Developer tools",
    name: "JSON Formatter",
    description: "Format JSON locally.",
    href: "/ja/devtools/json-formatter",
    locale: "ja",
    appUrl,
  });
  const [app, breadcrumbs] = data["@graph"];
  expect(app).toMatchObject({
    "@type": "WebApplication",
    url: "https://smarttools.example/ja/devtools/json-formatter",
    applicationCategory: "DeveloperApplication",
    isAccessibleForFree: true,
    offers: { price: "0" },
    inLanguage: "ja",
    publisher: { "@id": "https://smarttools.example/#organization" },
  });
  expect(breadcrumbs.itemListElement).toEqual([
    { "@type": "ListItem", position: 1, name: "SmartTools", item: "https://smarttools.example/ja" },
    { "@type": "ListItem", position: 2, name: "Developer tools", item: "https://smarttools.example/ja/devtools" },
    { "@type": "ListItem", position: 3, name: "JSON Formatter" },
  ]);
});

test("suite hubs list their tools in order", () => {
  const data = suiteStructuredData({
    suite: "media",
    name: "Media",
    description: "Image and PDF tools.",
    locale: "en",
    tools: [
      { name: "Compress PDF", href: "/media/compress-pdf" },
      { name: "Resize image", href: "/media/resize-image" },
    ],
    appUrl,
  });
  const page = data["@graph"][0];
  expect(page.url).toBe("https://smarttools.example/media");
  expect(page.mainEntity.numberOfItems).toBe(2);
  expect(page.mainEntity.itemListElement[1]).toEqual({
    "@type": "ListItem",
    position: 2,
    name: "Resize image",
    url: "https://smarttools.example/media/resize-image",
  });
});

test("the homepage graph declares one organization and a localized website", () => {
  const [organization, website] = siteStructuredData({ description: "Free tools.", locale: "fr", appUrl })["@graph"];
  expect(organization["@id"]).toBe("https://smarttools.example/#organization");
  expect(website).toMatchObject({ url: "https://smarttools.example/fr", inLanguage: "fr" });
  expect(website.publisher["@id"]).toBe(organization["@id"]);
});

test("JSON-LD stays inert inside a script element", () => {
  const json = serializeJsonLd({ name: "</script><script>alert(1)</script> " });
  expect(json).not.toMatch(/<\/?script/i);
  expect(json).not.toContain(" ");
  expect(JSON.parse(json).name).toBe("</script><script>alert(1)</script> ");
});

test("localized alternates cover every locale and point x-default at English", () => {
  const alternates = localizedAlternates("/devtools", "de");
  expect(alternates.canonical).toBe("/de/devtools");
  expect(alternates.languages).toMatchObject({
    en: "/devtools",
    de: "/de/devtools",
    "pt-BR": "/pt-BR/devtools",
    "x-default": "/devtools",
  });
});
