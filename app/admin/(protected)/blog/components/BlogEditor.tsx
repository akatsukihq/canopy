"use client";

import { appHref } from "@/lib/routing/subdomains.ts";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Crop, ExternalLink, EyeOff, CalendarX, RotateCw, Replace, Trash2 } from "lucide-react";
import { z } from "zod";
import { Node as TiptapNode, type JSONContent } from "@tiptap/core";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { codeLowlight } from "@/lib/markdown/codeHighlight";
import { normalizeBlogMath } from "@/lib/blog/math";
import { BlogInlineMath, BlogBlockMath } from "../lib/mathExtensions";
import "katex/dist/katex.min.css";
import {
  AlertBanner,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  BackButton,
  Button,
  DropdownMenuItem,
  FileUploadZone,
  Input,
  Label,
  Popover,
  Textarea,
  toast,
  Toaster,
} from "@/components/ui/index.tsx";
import { createToastManager } from "@/components/ui/components/toast";
import type { BlogDocument, BlogImage } from "@/lib/blog/document";
import { BLOG_TITLE_WORD_LIMIT, blogImageDelivery, blogTitleWordCount } from "@/lib/blog/utils";
import { mutateBlogAction } from "../actions";
import { uploadBlogImageDirect } from "../lib/imageUpload.ts";
import { BlogEditorShell } from "./BlogEditorShell";
import { BlogAssistantPanel } from "./BlogAssistantPanel";
import { BlogArticleOutline } from "./BlogArticleOutline";
import { BlogSelectionToolbar } from "./BlogSelectionToolbar";
import { BlogFormattingToolbar } from "./BlogFormattingToolbar";
import { BlogHistoryPanel } from "./BlogHistoryPanel";
import { BlogTableControls } from "./BlogTableControls";
import { BlogBlockControls } from "./BlogBlockControls";
import { BlogImageView } from "./BlogImageView";
import { BlogTaskItemView } from "./BlogTaskItemView";
import { BlogCodeBlockView } from "./BlogCodeBlockView";
import { BlogImageCropDialog } from "./BlogImageCropDialog";
import { mediaRef, mediaUrl } from "@/lib/media";
import { BlogImageNode as BaseBlogImageNode, blogEditorImageSource as imageSource } from "../lib/imageNode";
import { blogFormattingExtensions } from "../lib/formattingExtensions";
import { pasteBlogImages } from "../lib/imagePaste";
import { parseBlogClipboardText } from "../lib/markdownPaste.ts";
import { BlogTableCell, BlogTableHeader } from "../lib/tableEditing";
import { BlogPostSettings } from "./BlogPostSettings";
import { BlogPublishPanel, type BlogScheduleValue } from "./BlogPublishPanel";
import { createDraftPersistence, type DraftSaveState } from "../lib/draftPersistence";
import { useBlogTaxonomyOptions, type TaxonomyOptions } from "../lib/useBlogTaxonomyOptions";
import styles from "./BlogEditor.module.css";
import highlightStyles from "@/components/content/codeHighlight.module.css";
import contentStyles from "@/components/content/content.module.css";

function bodyImages(node: JSONContent): JSONContent[] {
  return node.type === "image" ? [node] : (node.content ?? []).flatMap(bodyImages);
}

const BlogImageNode = BaseBlogImageNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(BlogImageView);
  },
});

const BlogCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(BlogCodeBlockView);
  },
});

type EditableDocument = Omit<BlogDocument, "body"> & { body: JSONContent };
const backupImage = z
  .object({
    media: mediaRef,
    alt: z.string(),
    caption: z.string(),
  })
  .strict();
const backupTerm = z.object({ id: z.string(), label: z.string() }).strict();
const backupDocument = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string(),
    excerpt: z.string(),
    authorName: z.string(),
    body: z.custom<JSONContent>(
      (value) => !!value && typeof value === "object" && "type" in value && value.type === "doc",
    ),
    coverImage: backupImage.nullable(),
    category: backupTerm.nullable(),
    tags: z.array(backupTerm),
    seoTitle: z.string().nullable(),
    seoDescription: z.string().nullable(),
    relatedToolIds: z.array(z.string()),
  })
  .strict();
interface Props {
  actorId: string;
  publicPostHref?: string;
  initialAssistantReview?: boolean;
  post: {
    id: string;
    slug: string;
    version: number;
    draftDocument: BlogDocument;
    trashedAt: Date | null;
    publishedRevisionId: string | null;
    schedule: { scheduledAt: Date; lastErrorCode: string | null } | null;
  };
  categories: TaxonomyOptions;
  tags: TaxonomyOptions;
  tools: { id: string; name: string }[];
  canEdit: boolean;
  canPublish: boolean;
  canCreate: boolean;
}

export function BlogEditor({
  actorId,
  publicPostHref,
  initialAssistantReview = false,
  post,
  categories: initialCategories,
  tags: initialTags,
  tools,
  canEdit,
  canPublish,
  canCreate,
}: Props) {
  const router = useRouter();
  const categoryOptions = useBlogTaxonomyOptions(
    "category",
    initialCategories,
    post.draftDocument.category ? [post.draftDocument.category] : [],
  );
  const tagOptions = useBlogTaxonomyOptions("tag", initialTags, post.draftDocument.tags);
  const categories = categoryOptions.items;
  const tags = tagOptions.items;
  const [document, setDocument] = useState<EditableDocument>(() => ({
    ...post.draftDocument,
    body: normalizeBlogMath(post.draftDocument.body),
  }));
  const current = useRef<EditableDocument>(document);
  const inFlight = useRef(false);
  const [saveState, setSaveState] = useState<DraftSaveState>("idle");
  const [backupUnavailable, setBackupUnavailable] = useState(false);
  const [status, setStatus] = useState(
    post.publishedRevisionId
      ? "Published · Editing a private draft"
      : post.schedule
        ? "Scheduled · Editing a private draft"
        : "Draft loaded · Changes save automatically",
  );
  const [persistence] = useState(() =>
    createDraftPersistence<EditableDocument>({
      document,
      version: post.version,
      request: async (input) => {
        if (blogTitleWordCount(input.document.title) > BLOG_TITLE_WORD_LIMIT) {
          return {
            ok: false,
            code: "VALIDATION",
            message: `Use ${BLOG_TITLE_WORD_LIMIT} words or fewer for your title.`,
          };
        }
        const result = await mutateBlogAction("save", {
          postId: post.id,
          ...input,
        });
        if (result.ok && !("version" in result.data)) throw new Error("Unexpected save response");
        return result.ok
          ? {
              ok: true,
              data: { version: (result.data as { version: number }).version },
            }
          : result;
      },
      onState: (state, message) => {
        setSaveState(state);
        setStatus(message);
      },
      onBackupFailure: () => setBackupUnavailable(true),
    }),
  );
  useEffect(() => {
    persistence.start();
    return () => persistence.stop();
  }, [persistence]);
  const [review, setReview] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"post" | "seo">("post");
  const [returnSettingsOpen, setReturnSettingsOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [imageRequest, setImageRequest] = useState(0);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [schedule, setSchedule] = useState<BlogScheduleValue>({
    date: "",
    time: "09:00",
    timezone: "UTC",
  });
  const [publishError, setPublishError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publication, setPublication] = useState({
    published: !!post.publishedRevisionId,
    scheduled: !!post.schedule,
    scheduledAt: post.schedule?.scheduledAt ?? null,
    error: post.schedule?.lastErrorCode ?? null,
  });
  const [lifecycle, setLifecycle] = useState<"unpublish" | "cancelSchedule" | "retrySchedule" | null>(null);
  const [lifecycleError, setLifecycleError] = useState("");
  const [uploadTarget, setUploadTarget] = useState<"cover" | "body" | null>(null);
  const uploading = uploadTarget !== null;
  const uploadToastId = useId();
  const uploadActive = useRef(true);
  const [coverUploadPreview, setCoverUploadPreview] = useState<string | null>(null);
  const coverPreviewUrl = useRef<string | null>(null);
  function showUploadError(message: string) {
    if (!uploadActive.current) return;
    if (message) toast.error(message, { id: uploadToastId, duration: 6000, closeButton: true });
    else toast.dismiss(uploadToastId);
  }
  useEffect(() => {
    uploadActive.current = true;
    return () => {
      uploadActive.current = false;
      toast.dismiss(uploadToastId);
      if (coverPreviewUrl.current) URL.revokeObjectURL(coverPreviewUrl.current);
      coverPreviewUrl.current = null;
    };
  }, [uploadToastId]);
  const coverInput = useRef<HTMLInputElement>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  function openCoverSettings() {
    setCoverOpen(true);
    if (coverOpen) globalThis.document.getElementById("blog-cover-alt")?.focus();
  }
  const [coverCrop, setCoverCrop] = useState<BlogImage | null>(null);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const allowUnload = useRef(false);
  const [recoveryToasts] = useState(() => createToastManager());
  const [recovery, setRecovery] = useState<{
    document: EditableDocument;
    version: number;
  } | null>(null);
  const hasUnsavedChanges = ["dirty", "saving", "error", "conflict"].includes(saveState) || uploading;
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!allowUnload.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    function guardNavigation(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download"))
        return;
      const destination = new URL(anchor.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveHref(destination.pathname + destination.search + destination.hash);
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    globalThis.document.addEventListener("click", guardNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      globalThis.document.removeEventListener("click", guardNavigation, true);
    };
  }, [hasUnsavedChanges]);
  const editable = canEdit && !post.trashedAt;
  const titleWordCount = blogTitleWordCount(document.title);
  const titleTooLong = titleWordCount > BLOG_TITLE_WORD_LIMIT;

  function change(next: EditableDocument) {
    current.current = next;
    setDocument(next);
    persistence.change(next);
  }

  const editor = useEditor({
    extensions: [
      ...blogFormattingExtensions.map((extension) =>
        extension instanceof TiptapNode && extension.name === "taskItem"
          ? extension.extend({
              addNodeView() {
                return ReactNodeViewRenderer(BlogTaskItemView, { as: "li", attrs: { "data-type": "taskItem" } });
              },
            })
          : extension,
      ),
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [2, 3, 4, 5, 6] },
        link: { openOnClick: false },
        dropcursor: { color: "var(--success)", width: 2 },
      }),
      BlogCodeBlock.configure({ lowlight: codeLowlight }),
      BlogInlineMath,
      BlogBlockMath,
      TableKit.configure({ table: { resizable: true }, tableCell: false, tableHeader: false }),
      BlogTableCell,
      BlogTableHeader,
      BlogImageNode.configure({ onUploadImage: uploadInlineImage }),
    ],
    content: document.body,
    enablePasteRules: false,
    immediatelyRender: false,
    editable,
    editorProps: {
      clipboardTextParser: parseBlogClipboardText,
      handlePaste: (_view, event): boolean =>
        editor ? pasteBlogImages(editor, event, uploadInlineImage, showUploadError) : false,
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Article body",
        "aria-description": "Select text to format or improve it. Press Alt+F10 to focus selection tools.",
        class: `${highlightStyles.highlight} ${contentStyles.content} min-h-0 outline-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_a]:text-primary [&_a]:underline [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_img]:max-w-full [&_img]:h-auto`,
      },
    },
    onUpdate: ({ editor: changed }) => change({ ...current.current, body: changed.getJSON() }),
  });
  useEffect(() => {
    editor?.setEditable(editable && !publishing && !recovery);
    if (!editable || publishing || recovery) setCoverCrop(null);
  }, [editor, editable, publishing, recovery]);
  useEffect(() => {
    if (review || !focusTarget || !editor) return;
    const frame = requestAnimationFrame(() => {
      if (focusTarget === "body" || focusTarget === "images") {
        editor.commands.focus();
        if (focusTarget === "images") {
          let selected = false;
          editor.state.doc.descendants((node, position) => {
            if (!selected && node.type.name === "image" && !String(node.attrs.alt ?? "").trim()) {
              selected = true;
              editor.commands.setNodeSelection(position);
            }
            return !selected;
          });
          if (selected) setImageRequest((request) => request + 1);
        }
      } else if (focusTarget === "cover") {
        globalThis.document.getElementById("blog-edit-cover")?.scrollIntoView({ block: "center" });
        openCoverSettings();
      } else globalThis.document.getElementById(focusTarget)?.focus();
      setFocusTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [review, focusTarget, editor]);
  useEffect(() => {
    if (!editable || !editor) return;
    try {
      const stored = persistence.attachStorage(window.sessionStorage, `blog-draft:${actorId}:${post.id}`);
      if (!stored) return;
      const parsed = backupDocument.safeParse(stored.document);
      if (!parsed.success) {
        persistence.forgetBackup();
        return;
      }
      editor.schema.nodeFromJSON(parsed.data.body).check();
      if (JSON.stringify(parsed.data) === JSON.stringify(post.draftDocument)) {
        persistence.forgetBackup();
        return;
      }
      setRecovery({ document: parsed.data, version: stored.version });
    } catch {
      setBackupUnavailable(true);
    }
  }, [actorId, editable, editor, persistence, post.id, post.draftDocument]);

  useEffect(() => {
    if (!recovery || !editor) return;
    const id = recoveryToasts.add({
      title: "Recover unsaved edits?",
      timeout: 0,
      description: (
        <>
          This tab has a local draft from before you left.{" "}
          {recovery.version !== post.version
            ? "The saved article has changed; recovering keeps your local copy separate until you reload."
            : "Restore it to continue writing."}
          <span className="mt-3 flex flex-wrap gap-2">
            <Button
              size="xs"
              onClick={() => {
                const restored = {
                  ...recovery.document,
                  body: normalizeBlogMath(recovery.document.body as BlogDocument["body"]),
                };
                editor?.commands.setContent(restored.body, {
                  emitUpdate: false,
                });
                current.current = restored;
                setDocument(restored);
                persistence.restore(restored, recovery.version);
                setRecovery(null);
              }}
            >
              Recover local draft
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                persistence.forgetBackup();
                setRecovery(null);
              }}
            >
              Keep saved draft
            </Button>
          </span>
        </>
      ),
    });
    return () => recoveryToasts.close(id);
  }, [recovery, editor, persistence, post.version, recoveryToasts]);

  async function uploadImage(file: File, target: "cover" | "body"): Promise<BlogImage | null> {
    if (!editable || !uploadActive.current) return null;
    if (inFlight.current) {
      showUploadError("Another change is in progress. Wait for it to finish, then try the image again.");
      return null;
    }
    showUploadError("");
    inFlight.current = true;
    setUploadTarget(target);
    try {
      if (
        target === "cover" &&
        ["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
        file.size > 0 &&
        file.size <= 5 * 1024 * 1024
      ) {
        coverPreviewUrl.current = URL.createObjectURL(file);
        setCoverUploadPreview(coverPreviewUrl.current);
        setCoverOpen(false);
      }
      const result = await uploadBlogImageDirect(file);
      if (!uploadActive.current) return null;
      if (!result.ok) {
        showUploadError(result.message);
        return null;
      }
      return result.data;
    } catch {
      showUploadError("Couldn’t upload the image. Try a smaller image or try again.");
      return null;
    } finally {
      inFlight.current = false;
      if (target === "cover") {
        if (coverPreviewUrl.current) URL.revokeObjectURL(coverPreviewUrl.current);
        coverPreviewUrl.current = null;
        if (uploadActive.current) setCoverUploadPreview(null);
      }
      if (uploadActive.current) setUploadTarget(null);
    }
  }
  async function uploadCover(file: File) {
    const image = await uploadImage(file, "cover");
    if (image && uploadActive.current) {
      change({ ...current.current, coverImage: image });
    }
  }
  async function uploadInlineImage(file: File) {
    return uploadImage(file, "body");
  }

  async function applyCoverCrop(file: File) {
    function currentCover() {
      const cover = current.current.coverImage;
      if (
        !coverCrop ||
        !uploadActive.current ||
        !editor?.isEditable ||
        !cover ||
        mediaUrl(cover.media) !== mediaUrl(coverCrop.media)
      ) {
        throw new Error("The cover changed or editing is unavailable. Cancel and reopen Crop cover.");
      }
      return cover;
    }
    currentCover();
    const image = await uploadImage(file, "cover");
    if (!image) throw new Error("Couldn’t upload the crop. Your current cover is unchanged. Try again.");
    const cover = currentCover();
    change({
      ...current.current,
      coverImage: { ...image, alt: cover.alt, caption: cover.caption },
    });
    toast.success("Cover cropped. Changes save automatically.");
  }

  function closeCoverCrop() {
    setCoverCrop(null);
    globalThis.requestAnimationFrame?.(() => {
      globalThis.document?.getElementById(current.current.coverImage ? "blog-edit-cover" : "blog-add-cover")?.focus();
    });
  }

  async function save() {
    return editable && !inFlight.current ? persistence.save() : false;
  }

  async function openPreview() {
    if (saveState === "conflict" || inFlight.current) return;
    if (editable && (persistence.dirty || saveState === "saving" || saveState === "error")) {
      if (!(await save())) return;
    }
    router.refresh();
    router.push(appHref(`/admin/blog/${post.id}/preview`));
  }

  async function openReview() {
    if (saveState === "conflict" || inFlight.current) return;
    setSettingsTab("post");
    setReturnSettingsOpen(false);
    if (editable && (persistence.dirty || saveState === "saving" || saveState === "error")) {
      if (!(await save())) return;
    }
    setReview(true);
  }

  async function updatePublication() {
    if (!lifecycle || inFlight.current) return;
    inFlight.current = true;
    setPublishing(true);
    setLifecycleError("");
    try {
      if (editable && !(await persistence.save())) {
        setLifecycleError("Save or recover your draft before changing publication.");
        return;
      }
      const result = await mutateBlogAction(lifecycle, {
        postId: post.id,
        version: persistence.version,
      });
      if (!result.ok) {
        if (result.code === "CONFLICT") persistence.markConflict(result.message);
        setLifecycleError(result.message);
        return;
      }
      if (!("version" in result.data)) throw new Error("Unexpected publication response");
      persistence.version = result.data.version;
      setPublication({
        published: lifecycle === "retrySchedule" || (lifecycle !== "unpublish" && publication.published),
        scheduled: false,
        scheduledAt: null,
        error: null,
      });
      setStatus(
        `${lifecycle === "unpublish" ? "Unpublished" : lifecycle === "retrySchedule" ? "Scheduled revision published" : "Schedule cancelled"} · Draft preserved`,
      );
      setLifecycle(null);
    } catch {
      setLifecycleError("The request failed. Try again.");
    } finally {
      inFlight.current = false;
      setPublishing(false);
    }
  }

  async function publish() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPublishing(true);
    setPublishError("");
    try {
      if (editable && !(await persistence.save())) {
        setPublishError("Save or recover your draft before publishing.");
        return;
      }
      const input = { postId: post.id, version: persistence.version };
      const result =
        mode === "schedule"
          ? await mutateBlogAction("schedule", {
              ...input,
              scheduledAt: new Date(`${schedule.date}T${schedule.time}:00Z`).toISOString(),
            })
          : await mutateBlogAction("publish", input);
      if (!result.ok) {
        if (result.code === "CONFLICT") persistence.markConflict(result.message);
        setPublishError(result.message);
        return;
      }
      if (!("version" in result.data)) throw new Error("Unexpected publication response");
      persistence.version = result.data.version;
      setPublication(
        mode === "schedule"
          ? {
              ...publication,
              scheduled: true,
              scheduledAt: new Date(`${schedule.date}T${schedule.time}:00Z`),
              error: null,
            }
          : {
              published: true,
              scheduled: false,
              scheduledAt: null,
              error: null,
            },
      );
      setReview(false);
      setSaveState("saved");
      setStatus(
        mode === "schedule"
          ? `Scheduled · ${schedule.date} ${schedule.time} UTC`
          : "Published · Saved revision is live",
      );
    } catch {
      setPublishError("The request failed. Check the date and time, then try again.");
    } finally {
      inFlight.current = false;
      setPublishing(false);
    }
  }

  async function duplicate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPublishing(true);
    setLifecycleError("");
    try {
      if (editable && !(await persistence.save())) return;
      const result = await mutateBlogAction("duplicate", { postId: post.id });
      if (!result.ok) {
        setLifecycleError(result.message);
        return;
      }
      router.push(appHref(`/admin/blog/${result.data.id}`));
    } catch {
      setLifecycleError("Couldn’t duplicate this post. Try again.");
    } finally {
      inFlight.current = false;
      setPublishing(false);
    }
  }

  function downloadDraft() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(current.current, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = `${post.slug}-draft.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function fixPublishCheck(id: string) {
    const fields: Record<string, string> = {
      title: "blog-title",
      excerpt: "blog-excerpt",
      author: "blog-author",
      category: "blog-post-category",
    };
    setSettingsTab("post");
    setReturnSettingsOpen(["excerpt", "author", "category"].includes(id));
    setFocusTarget(fields[id] ?? id);
    setReview(false);
  }

  if (review)
    return (
      <div className={styles.review} data-schedule={mode === "schedule"}>
        <header className={styles.reviewHeader}>
          <BackButton
            label={mode === "schedule" ? "Back to review" : "Back to editor"}
            onClick={() => (mode === "schedule" ? setMode("now") : setReview(false))}
            disabled={publishing}
          />
          <h1 className={styles.title}>{document.title}</h1>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void openPreview();
            }}
            disabled={publishing}
          >
            Preview
          </Button>
        </header>
        <div className={styles.reviewWorkspace}>
          <div className={styles.recap}>
            <p className={`${styles.recapLabel} text-xs text-muted-foreground`}>
              {mode === "schedule" ? "POST TO SCHEDULE" : "YOUR POST"}
            </p>
            <h2 className={styles.recapTitle}>{document.title}</h2>
            <p className={styles.recapExcerpt}>{document.excerpt}</p>
            {document.coverImage && (
              <img
                {...blogImageDelivery(document.coverImage)}
                sizes="(max-width: 767px) calc(100vw - 32px), (max-width: 1100px) calc(100vw - 480px), calc(100vw - 600px)"
                alt={document.coverImage.alt}
                width={document.coverImage.media.width}
                height={document.coverImage.media.height}
                className={styles.recapCover}
              />
            )}
            <p className="text-[13px] text-muted-foreground">
              {document.authorName} · {document.category?.label ?? "No category"}
            </p>
            <p className={`${styles.recapLabel} text-xs text-muted-foreground`}>PUBLIC URL</p>
            <p className="break-all text-base text-primary">/blog/{post.slug}</p>
          </div>
          <BlogPublishPanel
            minimumDate={new Date().toISOString().slice(0, 10)}
            hasLiveVersion={publication.published}
            mode={mode}
            onModeChange={setMode}
            schedule={schedule}
            onScheduleChange={setSchedule}
            timezones={["UTC"]}
            checks={[
              {
                id: "title",
                label: "Article title",
                valid: !!document.title.trim(),
              },
              {
                id: "excerpt",
                label: "Article excerpt",
                valid: !!document.excerpt.trim(),
              },
              {
                id: "body",
                label: "Article body",
                valid:
                  !!editor?.getText().trim() ||
                  bodyImages(document.body).some((node) => !!String(node.attrs?.alt ?? "").trim()),
              },
              {
                id: "author",
                label: "Public byline",
                valid: !!document.authorName.trim(),
              },
              {
                id: "category",
                label: "Category selected",
                valid: !!document.category,
              },
              {
                id: "cover",
                label: "Cover description",
                valid: !document.coverImage || !!document.coverImage.alt.trim(),
              },
              {
                id: "images",
                label: "Inline image descriptions",
                valid: bodyImages(document.body).every((node) => !!String(node.attrs?.alt ?? "").trim()),
              },
            ]}
            searchPreview={{
              title: document.seoTitle || document.title,
              description: document.seoDescription || document.excerpt,
              url: `/blog/${post.slug}`,
            }}
            onFixCheck={fixPublishCheck}
            onEditSeo={() => {
              setSettingsTab("seo");
              setReturnSettingsOpen(true);
              setFocusTarget("blog-seo-title");
              setReview(false);
            }}
            onBack={() => setReview(false)}
            onSubmit={() => {
              void publish();
            }}
            canPublish={canPublish}
            pending={publishing}
            error={publishError}
          />
        </div>
      </div>
    );

  const coverPreview = coverUploadPreview ? (
    <span className={styles.coverUploadPreview} role="status">
      <img src={coverUploadPreview} alt="Selected cover preview" draggable={false} className={styles.cover} />
      <span className={styles.coverUploadStatus}>Uploading cover…</span>
    </span>
  ) : document.coverImage ? (
    <img
      {...blogImageDelivery(document.coverImage)}
      sizes="(max-width: 767px) calc(100vw - 32px), (max-width: 1056px) calc(100vw - 80px), 976px"
      alt={document.coverImage.alt}
      width={document.coverImage.media.width}
      height={document.coverImage.media.height}
      className={styles.cover}
    />
  ) : null;

  return (
    <BlogEditorShell
      initialAssistantOpen={initialAssistantReview}
      initialSettingsOpen={returnSettingsOpen}
      title={document.title}
      assistant={
        canEdit && !post.trashedAt
          ? (onClose) => (
              <BlogAssistantPanel
                key={`${actorId}:${post.id}`}
                initialReview={initialAssistantReview}
                postId={post.id}
                ownerId={actorId}
                onClose={onClose}
                editor={editor}
                document={document as BlogDocument}
                onReplaceDocument={(next) => {
                  editor?.commands.setContent(next.body, { emitUpdate: false });
                  change(next);
                }}
                onMetadata={(field, value) => change({ ...current.current, [field]: value })}
              />
            )
          : undefined
      }
      outline={<BlogArticleOutline editor={editor} title={document.title} />}
      status={status}
      saveState={saveState}
      busy={publishing || uploading || !!recovery}
      canEdit={editable}
      canPublish={canPublish && !post.trashedAt}
      onSave={() => {
        void save();
      }}
      onPreview={() => {
        void openPreview();
      }}
      onReview={() => {
        void openReview();
      }}
      publicationActions={
        publication.published ||
        (canCreate && !post.trashedAt) ||
        (canPublish && (publication.scheduled || publication.error)) ? (
          <>
            {publication.published && (
              <DropdownMenuItem asChild>
                <Link href={publicPostHref ?? `/blog/${post.slug}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden="true" />
                  View live
                </Link>
              </DropdownMenuItem>
            )}
            {canCreate && !post.trashedAt && (
              <DropdownMenuItem
                disabled={publishing || uploading || !!recovery || saveState === "conflict"}
                onSelect={() => {
                  void duplicate();
                }}
              >
                <Copy aria-hidden="true" />
                Duplicate
              </DropdownMenuItem>
            )}
            {canPublish && publication.published && (
              <DropdownMenuItem
                className="text-destructive data-[highlighted]:text-destructive"
                disabled={publishing || uploading || !!recovery}
                onSelect={() => {
                  setLifecycleError("");
                  setLifecycle("unpublish");
                }}
              >
                <EyeOff aria-hidden="true" />
                Unpublish
              </DropdownMenuItem>
            )}
            {canPublish && publication.scheduled && (
              <DropdownMenuItem
                disabled={publishing || uploading || !!recovery}
                onSelect={() => {
                  setLifecycleError("");
                  setLifecycle("cancelSchedule");
                }}
              >
                <CalendarX aria-hidden="true" />
                Cancel schedule
              </DropdownMenuItem>
            )}
            {canPublish && publication.error && (
              <DropdownMenuItem
                disabled={publishing || uploading || !!recovery}
                onSelect={() => {
                  setLifecycleError("");
                  setLifecycle("retrySchedule");
                }}
              >
                <RotateCw aria-hidden="true" />
                Retry scheduled publication
              </DropdownMenuItem>
            )}
          </>
        ) : null
      }
      history={
        <BlogHistoryPanel
          currentTitle={document.title}
          postId={post.id}
          version={persistence.version}
          publishedRevisionId={post.publishedRevisionId}
        />
      }
      toolbar={
        <BlogFormattingToolbar
          editor={editor}
          disabled={!editable || publishing || !!recovery}
          onUploadImage={uploadInlineImage}
          imageRequest={imageRequest}
          onImageRequestHandled={() => setImageRequest(0)}
        />
      }
      settings={
        <BlogPostSettings
          defaultTab={settingsTab}
          categories={categories}
          tags={tags}
          tools={tools}
          disabled={!editable || publishing || !!recovery}
          taxonomyHref={appHref(
            `/admin/blog/taxonomy?${new URLSearchParams({ returnTo: appHref(`/admin/blog/${post.id}`) })}`,
          )}
          categoryPagination={
            <>
              {categoryOptions.hasMore && (
                <Button
                  size="xs"
                  variant="ghost"
                  loading={categoryOptions.loading}
                  onClick={() => {
                    void categoryOptions.loadMore();
                  }}
                >
                  Load more categories
                </Button>
              )}
              {categoryOptions.error && (
                <p role="alert" className="text-xs text-destructive">
                  {categoryOptions.error}
                </p>
              )}
            </>
          }
          tagPagination={
            <>
              {tagOptions.hasMore && (
                <Button
                  size="xs"
                  variant="ghost"
                  loading={tagOptions.loading}
                  onClick={() => {
                    void tagOptions.loadMore();
                  }}
                >
                  Load more tags
                </Button>
              )}
              {tagOptions.error && (
                <p role="alert" className="text-xs text-destructive">
                  {tagOptions.error}
                </p>
              )}
            </>
          }
          value={{
            authorName: document.authorName,
            categoryId: document.category?.id ?? "",
            tagIds: document.tags.map((tag) => tag.id),
            excerpt: document.excerpt,
            seoTitle: document.seoTitle ?? "",
            seoDescription: document.seoDescription ?? "",
            relatedToolIds: document.relatedToolIds,
          }}
          onChange={(value) =>
            change({
              ...current.current,
              authorName: value.authorName,
              excerpt: value.excerpt,
              category:
                value.categoryId === current.current.category?.id
                  ? current.current.category
                  : categories.find((item) => item.id === value.categoryId)
                    ? {
                        id: value.categoryId,
                        label: categories.find((item) => item.id === value.categoryId)!.name,
                      }
                    : null,
              tags: value.tagIds.flatMap((id) => {
                const term = tags.find((tag) => tag.id === id);
                const existing = current.current.tags.find((tag) => tag.id === id);
                return term ? [{ id, label: term.name }] : existing ? [existing] : [];
              }),
              seoTitle: value.seoTitle || null,
              seoDescription: value.seoDescription || null,
              relatedToolIds: value.relatedToolIds,
            })
          }
        />
      }
    >
      {(saveState === "conflict" || (saveState === "error" && !titleTooLong)) && (
        <div className="mb-4">
          <p role="alert" className="text-sm text-destructive">
            {saveState === "conflict" ? "Another version was saved." : "Draft could not be saved."} Your local edits are
            preserved. Download a backup before leaving or reloading.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={downloadDraft}>
              Download local draft
            </Button>
            {saveState === "conflict" ? (
              <Button size="xs" variant="outline" onClick={() => setLeaveHref(appHref(`/admin/blog/${post.id}`))}>
                Reload saved version
              </Button>
            ) : (
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  void save();
                }}
              >
                Retry save
              </Button>
            )}
          </div>
        </div>
      )}
      {lifecycleError && !lifecycle && <AlertBanner variant="error">{lifecycleError}</AlertBanner>}
      {backupUnavailable && (
        <AlertBanner variant="warning">
          This browser couldn’t keep a local recovery copy. Wait for “All changes saved” before leaving the editor.
        </AlertBanner>
      )}
      {publication.scheduled && (
        <AlertBanner
          variant={publication.error ? "warning" : "info"}
          title={publication.error ? "Scheduled publication needs attention" : "A saved revision is scheduled"}
        >
          {publication.scheduledAt &&
            `${new Date(publication.scheduledAt).toISOString().slice(0, 16).replace("T", " ")} UTC. `}
          {publication.error
            ? "The last attempt failed. Retry the scheduled revision or review and schedule your current draft again."
            : "Later draft edits do not change this version. Use Review & publish to replace its schedule."}
        </AlertBanner>
      )}
      {post.trashedAt && (
        <AlertBanner title="This post is in trash">Restore it from the post list before editing.</AlertBanner>
      )}
      <Label htmlFor="blog-title" className="text-xs font-normal text-muted-foreground/90">
        TITLE
      </Label>
      <Textarea
        id="blog-title"
        placeholder="Give your story a title…"
        rows={1}
        value={document.title}
        maxLength={200}
        aria-describedby="blog-title-count"
        aria-invalid={titleTooLong}
        disabled={!editable || publishing || !!recovery}
        className={styles.postTitle}
        onChange={(event) => change({ ...current.current, title: event.target.value })}
      />
      <p
        id="blog-title-count"
        role={titleTooLong ? "alert" : undefined}
        className={`mt-2 text-xs ${titleTooLong ? "text-destructive" : "text-muted-foreground"}`}
      >
        {titleWordCount}/{BLOG_TITLE_WORD_LIMIT} words{titleTooLong ? " · Shorten your title to save." : ""}
      </p>
      <Textarea
        aria-label="Article summary"
        rows={1}
        maxLength={500}
        placeholder="Add a short summary that helps readers decide to read."
        value={document.excerpt}
        disabled={!editable || publishing || !!recovery}
        className={styles.excerpt}
        onChange={(event) => change({ ...current.current, excerpt: event.target.value })}
      />
      <div className="my-[22px] space-y-3">
        {!document.coverImage && coverUploadPreview && coverPreview}
        {document.coverImage && (
          <Popover.Root open={editable && !publishing && !recovery && coverOpen} onOpenChange={setCoverOpen}>
            <div>
              {editable ? (
                <Popover.Trigger asChild>
                  <Button
                    id="blog-edit-cover"
                    variant="ghost"
                    className="block h-auto w-full rounded-lg p-0 disabled:opacity-100"
                    aria-label="Edit cover image"
                    disabled={uploading || publishing || !!recovery}
                    onClick={(event) => {
                      event.preventDefault();
                      openCoverSettings();
                    }}
                  >
                    {coverPreview}
                  </Button>
                </Popover.Trigger>
              ) : (
                coverPreview
              )}
              {editable && !document.coverImage.alt.trim() && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="mt-2 font-normal text-destructive [@media(pointer:coarse)]:min-h-11"
                  disabled={uploading || publishing || !!recovery}
                  onClick={openCoverSettings}
                >
                  Alt text missing
                </Button>
              )}
            </div>
            <Popover.Portal>
              <Popover.Content
                className="z-[70] w-80 max-w-[var(--radix-popover-content-available-width)] rounded-xl border border-border bg-card text-foreground shadow-lg [@media(pointer:coarse)]:[&_button]:min-h-11 [@media(pointer:coarse)]:[&_input]:min-h-11"
                side="bottom"
                align="center"
                sideOffset={4}
                collisionPadding={12}
                aria-label="Cover image settings"
                onCloseAutoFocus={(event) => {
                  if (!current.current.coverImage) {
                    event.preventDefault();
                    globalThis.document.getElementById("blog-add-cover")?.focus();
                  }
                }}
              >
                <div className="max-h-[calc(var(--radix-popover-content-available-height)-2px)] space-y-3 overflow-y-auto overscroll-contain p-4">
                  <div className="space-y-1">
                    <Label htmlFor="blog-cover-alt">Alt text</Label>
                    <Input
                      id="blog-cover-alt"
                      size="sm"
                      maxLength={500}
                      aria-required="true"
                      aria-describedby="blog-cover-alt-help"
                      value={document.coverImage.alt}
                      disabled={uploading || publishing || !!recovery}
                      placeholder="Describe what the image shows"
                      onChange={(event) => {
                        const cover = current.current.coverImage;
                        if (cover)
                          change({
                            ...current.current,
                            coverImage: { ...cover, alt: event.target.value },
                          });
                      }}
                    />
                    <p id="blog-cover-alt-help" className="text-xs text-muted-foreground">
                      Describe the image for screen readers. Required before publishing; saves with your draft.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={uploading || publishing || !!recovery}
                      onClick={() => {
                        setCoverCrop(current.current.coverImage);
                        setCoverOpen(false);
                      }}
                    >
                      <Crop aria-hidden="true" />
                      Crop cover
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      loading={uploadTarget === "cover"}
                      disabled={uploading || publishing || !!recovery}
                      onClick={() => coverInput.current?.click()}
                    >
                      <Replace aria-hidden="true" />
                      Replace cover
                    </Button>
                    <Button
                      variant="danger-subtle"
                      size="sm"
                      disabled={uploading || publishing || !!recovery}
                      onClick={() => {
                        setCoverOpen(false);
                        change({ ...current.current, coverImage: null });
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      Remove cover
                    </Button>
                  </div>
                </div>
                <Popover.Arrow className="fill-card stroke-border" width={12} height={6} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        {editable && !document.coverImage && !coverUploadPreview && (
          <FileUploadZone
            id="blog-add-cover"
            className="min-h-[160px]"
            title="Add a cover image"
            description="JPG · PNG · WebP · Up to 5 MiB"
            hint="Browse files. Uploads are stored for publication."
            disabled={uploading || publishing || !!recovery}
            onClick={() => coverInput.current?.click()}
          />
        )}
        {editable && (
          <>
            <input
              ref={coverInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              aria-label="Cover image file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadCover(file);
              }}
            />
            {uploadTarget === "cover" && !coverUploadPreview && (
              <span role="status" className="text-[13px] text-muted-foreground">
                Uploading cover…
              </span>
            )}
          </>
        )}
      </div>
      {coverCrop && editable && !publishing && !recovery && (
        <BlogImageCropDialog
          src={imageSource(coverCrop.media)}
          format={coverCrop.media.format}
          title="Crop cover"
          isCover
          onApply={applyCoverCrop}
          onClose={closeCoverCrop}
        />
      )}
      <Toaster position="top-right" />
      <Toaster toastManager={recoveryToasts} position="bottom-right" dismissible={false} />
      {uploadTarget === "body" && (
        <p role="status" className="mb-2 text-[13px] text-muted-foreground">
          Uploading article image…
        </p>
      )}
      <EditorContent className={styles.editorBody} editor={editor} />
      <BlogSelectionToolbar
        editor={editor}
        disabled={!editable || publishing || uploading || !!recovery}
        postId={post.id}
      />
      <BlogBlockControls
        editor={editor}
        disabled={!editable || publishing || !!recovery}
        onUploadImage={uploadInlineImage}
      />
      <BlogTableControls editor={editor} disabled={!editable || publishing || uploading || !!recovery} />
      <AlertDialog
        open={lifecycle !== null}
        onOpenChange={(open) => {
          if (!open && !publishing) setLifecycle(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lifecycle === "unpublish"
                ? "Unpublish this post?"
                : lifecycle === "retrySchedule"
                  ? "Retry scheduled publication?"
                  : "Cancel scheduled publication?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lifecycle === "unpublish"
                ? "This removes the public article and cancels its schedule. Your draft and history are preserved."
                : lifecycle === "retrySchedule"
                  ? "Publish the saved scheduled revision now. Later draft changes are not included."
                  : "The scheduled version won’t publish. Any currently live article stays public, and your draft is preserved."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {lifecycleError && <AlertBanner variant="error">{lifecycleError}</AlertBanner>}
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" disabled={publishing}>
              Keep current state
            </AlertDialogCancel>
            <Button
              size="sm"
              variant={lifecycle === "retrySchedule" ? "default" : "destructive"}
              loading={publishing}
              onClick={() => {
                void updatePublication();
              }}
            >
              {lifecycle === "unpublish"
                ? "Unpublish"
                : lifecycle === "retrySchedule"
                  ? "Retry publication"
                  : "Cancel schedule"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={leaveHref !== null}
        onOpenChange={(open) => {
          if (!open) setLeaveHref(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your latest edits will be lost. Stay here and save your draft before leaving.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Keep editing</AlertDialogCancel>
            <Button size="sm" variant="outline" onClick={downloadDraft}>
              Download local draft
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={saveState === "saving" || uploading}
              onClick={() => {
                persistence.stop();
                persistence.forgetBackup();
                allowUnload.current = true;
                if (leaveHref === appHref(`/admin/blog/${post.id}`)) window.location.reload();
                else if (leaveHref) router.push(leaveHref);
                setLeaveHref(null);
              }}
            >
              Discard changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BlogEditorShell>
  );
}
