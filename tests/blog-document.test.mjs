import { expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { blogFormattingExtensions } from "../app/admin/(protected)/blog/lib/formattingExtensions.ts";
import { BLOG_TITLE_WORD_LIMIT, blogTitleWordCount } from "../lib/blog/utils.ts";
import {
  assertBlogPublishable,
  blogDocumentHash,
  blogDocumentText,
  blogImageUrl,
  blogSlugFromTitle,
  createBlogDocument,
  renderBlogDocument,
  validateBlogDocument,
} from "../lib/blog/document.ts";

const paragraph = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const publicId = "smarttools/blog/95c40d91-c008-4474-965b-71ec2e4f2b81";
const image = {
  media: {
    v: 1,
    provider: "cloudinary",
    format: "webp",
    width: 800,
    height: 600,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    entry: { cloudName: "my-cloud", publicId, version: 1234 },
  },
  alt: "A useful diagram",
  caption: "Diagram caption",
};
const withMedia = (fields) => ({ ...image, media: { ...image.media, ...fields } });
const withEntry = (fields) => withMedia({ entry: { ...image.media.entry, ...fields } });
function article() {
  return {
    ...createBlogDocument(" My article "),
    excerpt: "A useful summary",
    category: { id: "category-1", label: "Guides" },
    body: { type: "doc", content: [paragraph("Hello world")] },
  };
}

test("draft creation is normalized and publication requires completed article fields", () => {
  const draft = createBlogDocument("  Hello & world  ");
  expect(draft.title).toBe("Hello & world");
  expect(draft.authorName).toBe("SmartTools Team");
  expect(() => assertBlogPublishable(draft)).toThrow(/excerpt/i);
  for (const [field, value] of [
    ["title", ""],
    ["excerpt", ""],
    ["authorName", ""],
    ["category", null],
  ]) {
    expect(() => assertBlogPublishable({ ...article(), [field]: value })).toThrow();
  }
  expect(() =>
    assertBlogPublishable({
      ...article(),
      body: { type: "doc", content: [{ type: "paragraph" }] },
    }),
  ).toThrow(/body/i);
  expect(() => assertBlogPublishable(validateBlogDocument(article()))).not.toThrow();
});

test("slugs use existing tool normalization, bounded lengths and Unicode fallback", () => {
  expect(blogSlugFromTitle("  PDFs & Images!  ")).toBe("pdfs-and-images");
  expect(blogSlugFromTitle("a".repeat(200)).length).toBe(160);
  expect(blogSlugFromTitle("हिन्दी")).toMatch(/^post-[a-f0-9]{8}$/);
  expect(() => createBlogDocument("   ")).toThrow(/title/i);
});

test("titles allow 20 words but reject 21 on creation and publication while preserving legacy reads", () => {
  expect(BLOG_TITLE_WORD_LIMIT).toBe(20);
  expect(blogTitleWordCount("")).toBe(0);
  expect(blogTitleWordCount(" \t\n\u00a0")).toBe(0);
  expect(blogTitleWordCount("  hello-world\tworld\nनमस्ते\u00a0again ")).toBe(4);
  const title = Array(20).fill("word").join(" \t\n ");
  expect(createBlogDocument(title).title).toBe(title);
  expect(() => assertBlogPublishable({ ...article(), title })).not.toThrow();
  const legacy = { ...article(), title: `${title} extra` };
  expect(() => createBlogDocument(legacy.title)).toThrow(/20 words/);
  expect(() => assertBlogPublishable(legacy)).toThrow(/20 words/);
  expect(validateBlogDocument(legacy).title).toBe(legacy.title);
  expect(renderBlogDocument(legacy).html).toBe("<p>Hello world</p>");
  expect(() => createBlogDocument("a".repeat(201))).toThrow(/200 characters/);
});

test("document hashes ignore property order and tag order, but preserve article edits", () => {
  const a = article();
  a.tags = [
    { id: "b", label: "B" },
    { id: "a", label: "A" },
  ];
  const b = Object.fromEntries(Object.entries(a).reverse());
  b.tags = [...a.tags].reverse();
  expect(blogDocumentHash(validateBlogDocument(a))).toBe(blogDocumentHash(validateBlogDocument(b)));
  expect(blogDocumentHash(a)).not.toBe(blogDocumentHash({ ...a, title: "Different" }));
});

test("unknown properties, prototype payloads, cycles and non-JSON input fail closed", () => {
  const polluted = JSON.parse(
    JSON.stringify(article()).replace('"schemaVersion":1', '"schemaVersion":1,"__proto__":{"polluted":true}'),
  );
  for (const value of [
    { ...article(), created_by: "forged" },
    polluted,
    { ...article(), category: new Date() },
    { ...article(), title: undefined },
  ]) {
    expect(() => validateBlogDocument(value)).toThrow();
  }
  const cycle = article();
  cycle.body.content.push(cycle.body);
  expect(() => validateBlogDocument(cycle)).toThrow(/JSON|cyclic|depth/i);
  const arrayWithSerializer = article();
  arrayWithSerializer.tags.toJSON = () => [];
  expect(() => validateBlogDocument(arrayWithSerializer)).toThrow(/JSON/i);
  expect(() => validateBlogDocument({ ...article(), title: "broken \ud800" })).toThrow(/text/i);
  expect(() =>
    validateBlogDocument({
      ...article(),
      body: { type: "doc", content: [{ type: "html", text: "<script>bad()</script>" }] },
    }),
  ).toThrow();
  expect({}.polluted).toBe(undefined);
});

test("normalization is idempotent and rendering supports every basic article block", () => {
  const value = article();
  value.body.content = [
    { type: "blockquote", content: [paragraph("A quotation")] },
    { type: "bulletList", content: [{ type: "listItem", content: [paragraph("A bullet")] }] },
    { type: "horizontalRule" },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Line one",
          marks: [{ type: "underline" }, { type: "italic" }, { type: "strike" }],
        },
        { type: "hardBreak" },
        { type: "text", text: "inline code", marks: [{ type: "code" }] },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Read more",
          marks: [{ type: "link", attrs: { href: "/blog/another", target: "_self", rel: "nofollow" } }],
        },
      ],
    },
  ];
  const normalized = validateBlogDocument(value);
  expect(validateBlogDocument(normalized)).toEqual(normalized);
  const { html } = renderBlogDocument(normalized);
  expect(html).toMatch(/<blockquote><p>A quotation<\/p><\/blockquote>/);
  expect(html).toMatch(/<ul><li><p>A bullet<\/p><\/li><\/ul>/);
  expect(html).toMatch(/<hr>/);
  expect(html).toMatch(/<br><code>inline code<\/code>/);
  expect(html).toMatch(/href="\/blog\/another" target="_self" rel="nofollow"/);
});

test("bounded fields, bytes, node count, depth and duplicate selections are enforced", () => {
  for (const [field, value] of [
    ["title", "a".repeat(201)],
    ["excerpt", "a".repeat(501)],
    ["seoTitle", "a".repeat(161)],
    ["seoDescription", "a".repeat(321)],
    ["tags", Array.from({ length: 21 }, (_, i) => ({ id: String(i), label: "Tag" }))],
    ["relatedToolIds", Array.from({ length: 13 }, (_, i) => `media.${i}`)],
  ]) {
    expect(() => validateBlogDocument({ ...article(), [field]: value })).toThrow();
  }
  expect(() =>
    validateBlogDocument({
      ...article(),
      body: { type: "doc", content: [paragraph("😀".repeat(300000))] },
    }),
  ).toThrow(/size|MiB/i);
  expect(() =>
    validateBlogDocument({
      ...article(),
      body: {
        type: "doc",
        content: Array.from({ length: 10001 }, () => ({ type: "paragraph" })),
      },
    }),
  ).toThrow(/nodes|complex/i);
  let nested = paragraph("deep");
  for (let i = 0; i < 33; i++) nested = { type: "blockquote", content: [nested] };
  expect(() => validateBlogDocument({ ...article(), body: { type: "doc", content: [nested] } })).toThrow(/depth/i);
  expect(() =>
    validateBlogDocument({
      ...article(),
      tags: [
        { id: "same", label: "A" },
        { id: "same", label: "B" },
      ],
    }),
  ).toThrow(/duplicate/i);
  expect(() => validateBlogDocument({ ...article(), relatedToolIds: ["media.a", "media.a"] })).toThrow(/duplicate/i);
});

test("malicious links and unsupported attributes cannot reach rendered HTML", () => {
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "//evil.example",
    "java\tscript:bad",
    "https://user:pass@example.com",
    "\\evil.example",
  ]) {
    const value = article();
    value.body.content[0].content[0].marks = [{ type: "link", attrs: { href } }];
    expect(() => validateBlogDocument(value)).toThrow(/link|URL/i);
  }
  const value = article();
  value.body.content[0].attrs = { onclick: "bad()" };
  expect(() => validateBlogDocument(value)).toThrow(/attribute|property/i);
});

test("links survive the installed editor schema and normalize without extra attributes", () => {
  const value = article();
  value.body.content[0].content[0].marks = [{ type: "link", attrs: { href: "https://example.com/guide" } }];
  const schema = getSchema([StarterKit]);
  value.body = schema.nodeFromJSON(value.body).toJSON();
  const normalized = validateBlogDocument(value);
  expect(normalized.body.content[0].content[0].marks).toEqual([
    {
      type: "link",
      attrs: {
        href: "https://example.com/guide",
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      },
    },
  ]);
  expect(validateBlogDocument({ ...normalized, body: schema.nodeFromJSON(normalized.body).toJSON() })).toEqual(
    normalized,
  );
  value.body.content[0].content[0].marks[0].attrs.title = "Unapproved tooltip";
  expect(() => validateBlogDocument(value)).toThrow(/unsupported attributes/i);
});

test("renderer safely escapes text, creates stable distinct headings, and protects outbound links", () => {
  const value = article();
  value.body.content = [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A & B" }] },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "A & B" }] },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: '<script>alert("x")</script>',
          marks: [
            { type: "bold" },
            {
              type: "link",
              attrs: { href: 'https://example.com/?a="quoted"&b=1', target: "_blank" },
            },
          ],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "javascript" },
      content: [{ type: "text", text: "<b>code</b>" }],
    },
  ];
  const output = renderBlogDocument(validateBlogDocument(value));
  expect(output.headings.length).toBe(2);
  expect(output.headings[0].id).not.toBe(output.headings[1].id);
  expect(output.html).toMatch(/&lt;script&gt;/);
  expect(output.html).not.toMatch(/<script>/);
  expect(output.html).toMatch(/rel="noopener noreferrer"/);
  expect(output.html).toMatch(/<pre><code class="language-javascript">&lt;b&gt;code&lt;\/b&gt;/);
  expect(output.readingMinutes).toBe(1);
  expect(blogDocumentText(value)).toMatch(/A & B\s+A & B/);
});

test("Cloudinary images use immutable stored-cloud URLs and require alt text on publication", () => {
  const value = { ...article(), coverImage: image };
  value.body.content.push({ type: "image", attrs: image });
  const normalized = validateBlogDocument(value);
  const output = renderBlogDocument(normalized);
  expect(
    output.html.includes(
      `src="https://res.cloudinary.com/my-cloud/image/upload/c_limit,w_800/q_auto/f_auto/v1234/${publicId}.webp"`,
    ),
  ).toBeTruthy();
  expect(
    output.html.includes(
      `srcset="${[320, 640, 800].map((width) => `https://res.cloudinary.com/my-cloud/image/upload/c_limit,w_${width}/q_auto/f_auto/v1234/${publicId}.webp ${width}w`).join(", ")}"`,
    ),
  ).toBeTruthy();
  expect(output.html).toMatch(/loading="lazy" decoding="async"/);
  expect(blogImageUrl(normalized.coverImage)).toBe(
    "https://res.cloudinary.com/my-cloud/image/upload/v1234/smarttools/blog/95c40d91-c008-4474-965b-71ec2e4f2b81.webp",
  );
  expect(output.html).toMatch(/<figcaption>Diagram caption<\/figcaption>/);
  expect(() => assertBlogPublishable(normalized)).not.toThrow();
  for (const attrs of [
    withEntry({ publicId: "../escape" }),
    withEntry({ version: 0 }),
    withEntry({ cloudName: "cloud/name" }),
    withMedia({ format: "svg" }),
    withMedia({ width: -1 }),
    withMedia({ uploadedAt: "yesterday" }),
    withMedia({ provider: "s3" }),
    withMedia({ extra: true }),
    { ...image, media: undefined },
    { ...image.media, alt: "", caption: "" },
    { ...image, src: "https://evil.example/image.webp" },
  ]) {
    expect(() => validateBlogDocument({ ...article(), coverImage: attrs })).toThrow();
  }
  expect(() => validateBlogDocument({ ...article(), coverImage: withMedia({ format: "svg" }) })).toThrow(
    /JPEG, PNG or WebP/,
  );
  const noAlt = validateBlogDocument({ ...value, coverImage: { ...image, alt: "" } });
  expect(() => assertBlogPublishable(noAlt)).toThrow(/alt/i);
});

test("environment-scoped blog assets retain immutable URLs in cover and body revisions", () => {
  for (const environment of ["production", "development", "test"]) {
    const asset = withEntry({ publicId: publicId.replace("smarttools", `Canopy/${environment}`) });
    const value = {
      ...article(),
      coverImage: asset,
      body: { type: "doc", content: [{ type: "image", attrs: asset }] },
    };
    const normalized = validateBlogDocument(JSON.parse(JSON.stringify(value)));
    expect(normalized.coverImage).toEqual(asset);
    expect(normalized.body.content[0].attrs.media).toEqual(asset.media);
    const url = `https://res.cloudinary.com/my-cloud/image/upload/v1234/${asset.media.entry.publicId}.webp`;
    expect(blogImageUrl(normalized.coverImage)).toBe(url);
    expect(
      renderBlogDocument(normalized).html.includes(
        `src="https://res.cloudinary.com/my-cloud/image/upload/c_limit,w_800/q_auto/f_auto/v1234/${asset.media.entry.publicId}.webp"`,
      ),
    ).toBeTruthy();
  }
});

test("body image layout survives document roundtrips without changing intrinsic dimensions or the cover", () => {
  for (const [alignment, marginLeft, marginRight] of [
    ["left", "0", "auto"],
    ["center", "auto", "auto"],
    ["right", "auto", "0"],
  ]) {
    for (const [displayWidth, desktopWidth] of [
      [10, 102],
      [55, 558],
      [100, 1015],
    ]) {
      const value = {
        ...article(),
        coverImage: image,
        body: {
          type: "doc",
          content: [{ type: "image", attrs: { ...image, displayWidth, alignment } }],
        },
      };
      const normalized = validateBlogDocument(value);
      expect(normalized.body.content[0].attrs).toEqual({ ...image, displayWidth, alignment });
      expect(normalized.coverImage).toEqual(image);
      expect(validateBlogDocument(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
      const { html } = renderBlogDocument(normalized);
      expect(
        html.includes(`width:${displayWidth}%;margin-left:${marginLeft};margin-right:${marginRight}`),
      ).toBeTruthy();
      expect(html).toMatch(/width="800" height="600"/);
      expect(html).toMatch(/style="width:100%;height:auto"/);
      expect(html.includes(`sizes="auto, (min-width: 1440px) ${desktopWidth}px, ${displayWidth}vw"`)).toBeTruthy();
    }
  }
});

test("legacy body images and empty editor layout defaults keep their full-width centered layout", () => {
  const legacy = {
    ...article(),
    body: { type: "doc", content: [{ type: "image", attrs: image }] },
  };
  const normalized = validateBlogDocument(legacy);
  expect(normalized.body.content[0].attrs).toEqual({
    ...image,
    displayWidth: 100,
    alignment: "center",
  });
  const defaults = {
    ...legacy,
    body: {
      type: "doc",
      content: [{ type: "image", attrs: { ...image, displayWidth: null, alignment: null } }],
    },
  };
  expect(validateBlogDocument(defaults)).toEqual(normalized);
  expect(renderBlogDocument(legacy).html).toBe(renderBlogDocument(normalized).html);
  expect(() => assertBlogPublishable(normalized)).not.toThrow();
  const resized = structuredClone(normalized);
  resized.body.content[0].attrs.displayWidth = 50;
  expect(blogDocumentHash(resized)).not.toBe(blogDocumentHash(normalized));
});

test("image layout rejects unsafe values and remains exclusive to body images", () => {
  for (const layout of [
    ...[0, 9, 101, 50.5, "50", "50%;color:red", true].map((displayWidth) => ({ displayWidth })),
    ...["justify", "left;color:red", "CENTER", 0, true].map((alignment) => ({ alignment })),
    { style: "width:50%" },
    { onclick: "alert(1)" },
  ]) {
    const value = {
      ...article(),
      body: { type: "doc", content: [{ type: "image", attrs: { ...image, ...layout } }] },
    };
    expect(() => validateBlogDocument(value)).toThrow();
    expect(() => renderBlogDocument(value)).toThrow();
  }
  for (const layout of [{ displayWidth: 50 }, { alignment: "right" }]) {
    expect(() => validateBlogDocument({ ...article(), coverImage: { ...image, ...layout } })).toThrow(
      /unsupported property/,
    );
  }
});

test("images cannot reference mutable Cloudinary assets outside the immutable blog namespace", () => {
  for (const badPublicId of [
    "smarttools/tool-icons/media.image-converter",
    "smarttools/blog/cover",
    "smarttools/blog/95c40d91-c008-1474-965b-71ec2e4f2b81",
    "smarttools/blog/95c40d91-c008-4474-765b-71ec2e4f2b81",
    "smarttools/blog/95C40D91-C008-4474-965B-71EC2E4F2B81",
    "smarttools/blog/95c40d91-c008-4474-965b-71ec2e4f2b81/suffix",
    "Canopy/production/tool-icons/95c40d91-c008-4474-965b-71ec2e4f2b81",
    "Canopy/preview/blog/95c40d91-c008-4474-965b-71ec2e4f2b81",
    "Canopy/production/blog/cover",
    "Canopy/production/blog/95c40d91-c008-1474-965b-71ec2e4f2b81",
    "Canopy/production/blog/95c40d91-c008-4474-765b-71ec2e4f2b81",
    "Canopy/production/blog/95c40d91-c008-4474-965b-71ec2e4f2b81/suffix",
    "Canopy/production/../development/blog/95c40d91-c008-4474-965b-71ec2e4f2b81",
  ]) {
    const bad = withEntry({ publicId: badPublicId });
    expect(() => validateBlogDocument({ ...article(), coverImage: bad })).toThrow(/immutable blog asset/);
    expect(() =>
      validateBlogDocument({
        ...article(),
        body: { type: "doc", content: [{ type: "image", attrs: bad }] },
      }),
    ).toThrow(/immutable blog asset/);
  }
});

test("table and list content models reject malformed structures and allow safe merges", () => {
  const cell = (text, attrs = {}) => ({ type: "tableCell", attrs, content: [paragraph(text)] });
  const valid = article();
  valid.body.content = [
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [{ type: "listItem", content: [paragraph("First")] }],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [cell("Wide", { colspan: 2, rowspan: 1, colwidth: [100, 100] })],
        },
        { type: "tableRow", content: [cell("Left"), cell("Right")] },
      ],
    },
  ];
  expect(renderBlogDocument(validateBlogDocument(valid)).html).toMatch(/<ol start="3">/);
  expect(renderBlogDocument(validateBlogDocument(valid)).html).toMatch(/colspan="2"/);
  const rowspan = {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [cell("Merged", { rowspan: 2, colspan: 2, colwidth: [0, 120] })],
      },
      { type: "tableRow", content: [] },
    ],
  };
  expect(
    renderBlogDocument(validateBlogDocument({ ...article(), body: { type: "doc", content: [rowspan] } })).html,
  ).toMatch(/rowspan="2"/);
  for (const node of [
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("A")] },
        { type: "tableRow", content: [cell("B"), cell("C")] },
      ],
    },
    { type: "table", content: [{ type: "tableRow", content: [cell("A", { rowspan: 2 })] }] },
    { type: "paragraph", content: [paragraph("Nested block")] },
    { type: "bulletList", content: [paragraph("Not a list item")] },
    { type: "heading", attrs: { level: 1 }, content: [] },
    { type: "codeBlock", content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }] },
  ])
    expect(() => validateBlogDocument({ ...article(), body: { type: "doc", content: [node] } })).toThrow();
});

test("table cell colors and alignment normalize and render without accepting arbitrary CSS", () => {
  for (const align of ["left", "center", "right"]) {
    const value = {
      ...article(),
      body: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    attrs: { align, backgroundColor: "#ABCDEF" },
                    content: [paragraph("Heading")],
                  },
                  {
                    type: "tableCell",
                    attrs: { align: null, backgroundColor: null },
                    content: [paragraph("Value")],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const normalized = validateBlogDocument(value);
    expect(normalized.body.content[0].content[0].content[0].attrs.backgroundColor).toBe("#abcdef");
    expect(validateBlogDocument(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
    expect(renderBlogDocument(normalized).html).toMatch(
      new RegExp(`style="text-align:${align};background-color:#abcdef"`),
    );
  }
  for (const attrs of [
    ...["justify", "center;color:red", true, 1].map((align) => ({ align })),
    ...["red", "#fff", "#ffffffff", "#ffffff;background:url(x)", "var(--primary)", true].map((backgroundColor) => ({
      backgroundColor,
    })),
    { style: "background:red" },
  ]) {
    const value = {
      ...article(),
      body: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [{ type: "tableCell", attrs, content: [paragraph("Value")] }],
              },
            ],
          },
        ],
      },
    };
    expect(() => validateBlogDocument(value)).toThrow();
    expect(() => renderBlogDocument(value)).toThrow();
  }
});

test("resized table columns retain widths through merged cells and rows in public HTML", () => {
  const cell = (text, attrs = {}) => ({ type: "tableCell", attrs, content: [paragraph(text)] });
  const value = {
    ...article(),
    body: {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                cell("Two rows", { rowspan: 2, colwidth: [120] }),
                cell("Two columns", { colspan: 2, colwidth: [180, 240] }),
              ],
            },
            { type: "tableRow", content: [cell("Middle"), cell("Right")] },
          ],
        },
      ],
    },
  };
  const { html } = renderBlogDocument(validateBlogDocument(value));
  expect(html).toMatch(
    /<colgroup><col style="width:120px"><col style="width:180px"><col style="width:240px"><\/colgroup>/,
  );
  expect(html).toMatch(/<table style="display:table;max-width:none;table-layout:fixed;width:540px">/);
  expect(html).toMatch(/colspan="2" rowspan="1"/);
  expect(html).toMatch(/role="region" aria-label="Scrollable table" tabindex="0"/);
  expect(html).toMatch(/max-width:100%;overflow-x:auto/);
  value.body.content[0].content[0].content[1].attrs.colwidth = [0, 0];
  value.body.content[0].content[1].content[0].attrs.colwidth = [180];
  value.body.content[0].content[1].content[1].attrs.colwidth = [240];
  expect(renderBlogDocument(value).html).toMatch(
    /<colgroup><col style="width:120px"><col style="width:180px"><col style="width:240px"><\/colgroup>/,
  );

  // Older snapshots may put widths only on later rows; zero leaves the column automatic.
  value.body.content[0].content = [
    { type: "tableRow", content: [cell("Auto"), cell("Resized")] },
    { type: "tableRow", content: [cell("Merged", { colspan: 2, colwidth: [0, 220] })] },
  ];
  const partial = renderBlogDocument(validateBlogDocument(value)).html;
  expect(partial).toMatch(/<colgroup><col><col style="width:220px"><\/colgroup>/);
  expect(partial).toMatch(/min-width:245px/);
  value.body.content[0].content.push({
    type: "tableRow",
    content: [cell("Auto"), cell("Legacy conflicting width", { colwidth: [300] })],
  });
  expect(renderBlogDocument(value).html).toMatch(/<colgroup><col><col style="width:220px"><\/colgroup>/);
});

test("legacy tables without column sizes retain automatic layout", () => {
  const value = {
    ...article(),
    body: {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [paragraph("First")] },
                { type: "tableCell", attrs: { colwidth: [0] }, content: [paragraph("Second")] },
              ],
            },
          ],
        },
      ],
    },
  };
  const { html } = renderBlogDocument(validateBlogDocument(value));
  expect(html).toMatch(/<table style="display:table;max-width:none">/);
  expect(html).not.toMatch(/<colgroup>|table-layout:fixed/);
});

test("editor formatting survives validation and renders safely in public articles", () => {
  const value = article();
  value.body.content = [
    {
      type: "paragraph",
      attrs: { textAlign: "center" },
      content: [
        {
          type: "text",
          text: "Highlighted",
          marks: [{ type: "highlight" }, { type: "superscript" }],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2, textAlign: "right" },
      content: [{ type: "text", text: "H2O", marks: [{ type: "subscript" }] }],
    },
    {
      type: "taskList",
      content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph("Done")] }],
    },
  ];
  const schema = getSchema([StarterKit, ...blogFormattingExtensions]);
  const body = schema.nodeFromJSON(value.body);
  body.check();
  const normalized = validateBlogDocument({ ...value, body: body.toJSON() });
  expect(validateBlogDocument(normalized)).toEqual(normalized);
  const { html } = renderBlogDocument(normalized);
  expect(html).toMatch(/text-align:center/);
  expect(html).toMatch(/<sup><mark>Highlighted<\/mark><\/sup>/);
  expect(html).toMatch(/text-align:right/);
  expect(html).toMatch(/<sub>H2O<\/sub>/);
  expect(html).toMatch(/role="checkbox" aria-readonly="true" aria-checked="true"/);
  expect(html).not.toMatch(/disabled/);
  for (const textAlign of ["center;color:red", "diagonal"]) {
    expect(() =>
      validateBlogDocument({
        ...article(),
        body: { type: "doc", content: [{ ...paragraph("Unsafe"), attrs: { textAlign } }] },
      }),
    ).toThrow();
  }
  value.body.content[2].content[0].attrs.checked = "yes";
  expect(() => validateBlogDocument(value)).toThrow();
});

test("highlight colors retain their value through editor, revision, and public rendering roundtrips", () => {
  const value = article();
  value.body.content[0].content[0].marks = [{ type: "highlight", attrs: { color: "#ABCDEF" } }];
  const schema = getSchema([StarterKit, ...blogFormattingExtensions]);
  const normalized = validateBlogDocument({
    ...value,
    body: schema.nodeFromJSON(value.body).toJSON(),
  });
  expect(normalized.body.content[0].content[0].marks).toEqual([{ type: "highlight", attrs: { color: "#abcdef" } }]);
  expect(validateBlogDocument(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
  expect(validateBlogDocument({ ...normalized, body: schema.nodeFromJSON(normalized.body).toJSON() })).toEqual(
    normalized,
  );
  expect(renderBlogDocument(normalized).html).toBe('<p><mark style="background-color:#abcdef">Hello world</mark></p>');
  const recolored = structuredClone(normalized);
  recolored.body.content[0].content[0].marks[0].attrs.color = "#123456";
  expect(blogDocumentHash(recolored)).not.toBe(blogDocumentHash(normalized));
});

test("legacy highlights retain their normalized document hash and yellow default rendering", () => {
  const legacy = article();
  legacy.body.content[0].content[0].marks = [{ type: "highlight" }];
  const normalized = validateBlogDocument(legacy);
  for (const attrs of [undefined, {}, { color: null }]) {
    const value = structuredClone(legacy);
    value.body.content[0].content[0].marks = [{ type: "highlight", ...(attrs === undefined ? {} : { attrs }) }];
    const schema = getSchema([StarterKit, ...blogFormattingExtensions]);
    const roundtrip = validateBlogDocument({
      ...value,
      body: schema.nodeFromJSON(value.body).toJSON(),
    });
    expect(roundtrip).toEqual(normalized);
    expect(blogDocumentHash(roundtrip)).toBe(blogDocumentHash(normalized));
    expect(renderBlogDocument(roundtrip).html).toBe("<p><mark>Hello world</mark></p>");
  }
});

test("highlight colors reject arbitrary CSS and duplicate or unsupported attributes", () => {
  for (const attrs of [
    ...[
      "red",
      "#fff",
      "#ffffffff",
      "#123456;background:url(x)",
      "var(--primary)",
      "url(javascript:alert(1))",
      "",
      true,
      1,
      [],
      {},
    ].map((color) => ({ color })),
    { color: "#abcdef", style: "color:red" },
    { onclick: "alert(1)" },
  ]) {
    const value = article();
    value.body.content[0].content[0].marks = [{ type: "highlight", attrs }];
    expect(() => validateBlogDocument(value)).toThrow();
    expect(() => renderBlogDocument(value)).toThrow();
  }
  const value = article();
  value.body.content[0].content[0].marks = [
    { type: "highlight", attrs: { color: "#abcdef" } },
    { type: "highlight", attrs: { color: "#123456" } },
  ];
  expect(() => validateBlogDocument(value)).toThrow(/Duplicate text marks/);
});
