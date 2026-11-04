import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { mediaRef, mediaUrl } from "@/lib/media/index.ts";

const migration = await readFile(new URL("../db/migration/0012-media-refs/0001_media_refs.sql", import.meta.url), "utf8");
const DATABASE_URL = process.env.MEDIA_REFS_TEST_DATABASE_URL;
const BLOG_ID = "Canopy/production/blog/0b0c5d3e-2f4a-4b6c-9d8e-1f2a3b4c5d6e";
const legacyImage = { publicId: BLOG_ID, version: 7, format: "webp", width: 1600, height: 900, alt: "A", caption: "" };
const iconUrl = (cloud, version, id) =>
  `https://res.cloudinary.com/${encodeURIComponent(cloud)}/image/upload/f_png,c_fill,w_256,h_256,q_auto/v${version}/${id.split("/").map(encodeURIComponent).join("/")}.png`;
const document = () => ({
  title: "Post",
  coverImage: { ...legacyImage, src: "https://res.cloudinary.com/demo/x.webp" },
  content: {
    type: "doc",
    content: [{ type: "image", attrs: { ...legacyImage, displayWidth: 60, alignment: "left" } }],
  },
});

test(
  "media ref migration converts icons and blog images in place and reruns cleanly",
  { skip: DATABASE_URL ? false : "set MEDIA_REFS_TEST_DATABASE_URL to a disposable PostgreSQL database" },
  async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    const migrate = async () => {
      try {
        await client.query(migration);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    };
    try {
      await client.query("CREATE TEMP TABLE managed_tools (tool_id TEXT PRIMARY KEY, icon_url TEXT)");
      await client.query("CREATE TEMP TABLE blog_posts (id TEXT PRIMARY KEY, draft_document JSONB NOT NULL)");
      await client.query("CREATE TEMP TABLE blog_revisions (id TEXT PRIMARY KEY, document JSONB NOT NULL)");
      await client.query("SELECT set_config('canopy.cloudinary_cloud_name', 'demo', false)");
      await client.query("INSERT INTO managed_tools VALUES ('a', $1), ('b', NULL), ('c', 'https://example.com/x.svg')", [
        iconUrl("old-cloud", 12, "Canopy/icons/a b"),
      ]);
      await client.query("INSERT INTO blog_posts VALUES ('p', $1)", [document()]);
      await client.query("INSERT INTO blog_revisions VALUES ('r', $1)", [document()]);

      await expect(migrate()).rejects.toThrow(/cannot be converted: c/);
      await client.query("UPDATE managed_tools SET icon_url = NULL WHERE tool_id = 'c'");
      await migrate();

      const tools = (await client.query("SELECT * FROM managed_tools ORDER BY tool_id")).rows;
      expect(tools.map((row) => Object.keys(row))).toEqual([["tool_id", "icon"], ["tool_id", "icon"], ["tool_id", "icon"]]);
      const icon = mediaRef.parse(tools[0].icon);
      expect(icon.entry).toEqual({ cloudName: "old-cloud", publicId: "Canopy/icons/a b", version: 12 });
      expect(tools[1].icon).toBe(null);

      const [{ draft_document: draft }] = (await client.query("SELECT draft_document FROM blog_posts")).rows;
      const cover = mediaRef.parse(draft.coverImage.media);
      expect(Object.keys(draft.coverImage).sort()).toEqual(["alt", "caption", "media"]);
      expect(cover).toMatchObject({ provider: "cloudinary", format: "webp", width: 1600, height: 900 });
      expect(mediaUrl(cover)).toBe(`https://res.cloudinary.com/demo/image/upload/v7/${BLOG_ID}.webp`);
      expect(draft.content.content[0].attrs).toEqual({
        media: cover,
        alt: "A",
        caption: "",
        displayWidth: 60,
        alignment: "left",
      });
      const [{ document: revision }] = (await client.query("SELECT document FROM blog_revisions")).rows;
      expect(revision.coverImage.media.entry).toEqual(cover.entry);

      await migrate();
      expect((await client.query("SELECT draft_document FROM blog_posts")).rows[0].draft_document).toEqual(draft);
      expect((await client.query("SELECT icon FROM managed_tools WHERE tool_id = 'a'")).rows[0].icon).toEqual(icon);
    } finally {
      await client.end();
    }
  },
);
