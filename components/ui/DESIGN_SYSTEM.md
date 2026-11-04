# SmartTools Design System

`SegmentedControl size="field"` is the full-width setting selector: equal-width segments, 4px track inset, and 37px minimum segment height (45px total). Labels may wrap at narrow widths. Use it for field-sized segmented choices; existing `inline` and `navigation` sizes are unchanged. Image conversion uses the shared Select labeled “Output format” as its last setting, with alphabetically ordered format options.

`@/components/ui/index.tsx` — the shared visual layer for every SmartTools surface in this repo.

### Crop PDF control and completion patterns

- `Input variant="expression"` is the prominent expression-editing control: 68px high with centered 28px monospace text. It retains shared validation, focus, and disabled states; default inputs are unchanged. Use it for directly editable cron-style fields.
- `Input` accepts decorative `leadingIcon` and `suffix` slots. Keep a visible associated label; adornments are hidden from assistive technology. Compact workbench density preserves space for both slots.
- `DownloadResult variant="action"` is the flat, divided completion area below retained settings: success identity and metadata, then a full-width download action. The default `card` variant is unchanged.
- Crop PDF composes the shared PDF workspace/viewer, exact-point fields, review, generated PDF preview, and Edit crop / Crop another PDF recovery. Editing retains the source and settings; completing replaces the run action rather than adding another result panel.

**Status:** application-owned source under `components/ui`; no separate package or build step.
**Design source of truth:** `designs/design.pen` + `designs/SYSTEM.lib.pen` (Pencil).
**Code source of truth:** `components/ui`. Where the two disagree, `components/ui/design-system-manifest.ts` is the crosswalk that decides which design node maps to which component.

# Rules
- Design for normal desktop and laptop browser viewports first, not televisions, ultrawide monitors, or oversized presentation canvases. Unless the user explicitly requests another target, use **1366 × 768 CSS pixels** as the default desktop viewport for both `.pen` screen designs and implemented UI; also verify usability at **1280 × 720**. These are browser content dimensions, not physical display resolutions.

| Audience                    | Start here                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| Building a feature          | [Consuming the system](#1-consuming-the-system) → [Component inventory](#4-component-inventory) |
| Styling anything            | [Foundations](#3-foundations) — never write a raw hex                                           |
| Adding/changing a component | [Contributing](#8-contributing) → [Component contract](#5-component-contract)                   |
| Reviewing a PR              | [Review checklist](#7-governance) → [Verification](#9-verification)                             |

---

## 1. Consuming the system

```ts
// components
import { Button, Field, Input, ToolPageShell } from "@/components/ui/index.tsx";
// deep import when you need one file only
import { Button } from "@/components/ui/components/button.tsx";
import { cn } from "@/components/ui/lib/utils.ts";
```

```css
/* app/globals.css — this order is asserted by tests/frontend-config.test.mjs */
@import "tailwindcss";
@import "../components/ui/theme.css";
```

**Module facts**

|                  |                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Name             | `components/ui` (application-owned UI)                                                                                                 |
| Module type      | ESM TypeScript, compiled with the application                                                                                                    |
| Entry point      | `components/ui/index.tsx`; individual components and helpers can be imported directly                                                               |
| Internal imports | Relative imports within `components/ui`                                    |
| React            | Declared in the root application manifest                                                                                                                              |
| Runtime deps     | `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `motion`, `sonner`, `react-resizable-panels`, `@dnd-kit/*` |
| shadcn config    | Root `components.json` — style `new-york`, `rsc: true`, baseColor `slate`, `cssVariables: true`, icons `lucide`                                   |

**Exactly one `@import "tailwindcss"` may exist repo-wide.** `theme.css` opens with `@source ".";` so Tailwind scans the UI sources for class usage.

**Live specimen page:** `/admin/design-system` (`app/admin/(protected)/design-system/page.tsx`) renders every primitive, all five control sizes, and the page-level compositions. Use it to review a change visually before shipping.

**Assistant results:** `components/assistant/ChangeCard.tsx` composes shared Buttons and Tooltips for compact, summary, and expanded insertion/edit/deletion previews. `ReportView` presents report sections; `ChangesetPreview` presents complete proposed content with explicit approval and guarded undo. Integrations supply display data, current eligibility, and async application handlers. The Assistant panel, composer, history, sources, and run cards share these components across features. Canonical documents and editor commands remain in the owning feature. `components/content/MarkdownPreview.tsx` renders standalone Markdown, including validated images, independently of Assistant.

---

## 2. Principles

1. **Semantic over literal.** Consume `bg-card`, `text-muted-foreground`, `border-border`. A hex in a component file is a bug.
2. **One implementation per design node.** If `design.pen` has it, the manifest maps it to exactly one export. No lookalikes.
3. **Compose, don't fork.** New tool page = existing primitives arranged differently, not new styled markup.
4. **Extract at the third repetition** — not the first, not the tenth.
5. **Accessible by default.** Focus ring, label association, and keyboard operation live in the component, not in the caller.
6. **The system owns presentation only.** Copy, routes, status logic, and workflow behaviour stay in the consuming app.

---

## 3. Foundations

### 3.1 Token architecture

Tailwind v4, CSS-first. **There is no `tailwind.config.*` file** — do not create one.

`components/ui/theme.css` has two blocks:

- `@theme { … }` — static tokens (fonts, type scale, radius, shadow). Emitted as literal values.
- `@theme inline { … }` — maps the `--color-*` utility namespace onto bare `--*` variables declared in `:root`. Because it is `inline`, utilities emit `var(--background)` rather than a baked hex, so **any subtree can be re-themed by redeclaring the bare vars** (this is how `.platform-shell` and `.auth-shell` work).

```
:root { --primary: #0066ff }        ← the value
@theme inline { --color-primary: var(--primary) }   ← the utility namespace
→ class="bg-primary" emits background-color: var(--primary)
```

### 3.2 Color

35 semantic tokens. Every one has a matching `--color-*` utility. No orphans in either direction.

| Token                      | Value     | Use for                                          |
| -------------------------- | --------- | ------------------------------------------------ |
| `--background`             | `#f6f7f9` | Page ground                                      |
| `--foreground`             | `#1a1a1a` | Body text                                        |
| `--card`                   | `#ffffff` | Raised surface                                   |
| `--card-foreground`        | `#1a1a1a` | Text on a card                                   |
| `--popover`                | `#ffffff` | Overlay surface                                  |
| `--popover-foreground`     | `#1a1a1a` | Text on an overlay                               |
| `--primary`                | `#0066ff` | Primary action, active state                     |
| `--primary-foreground`     | `#ffffff` | Text on primary                                  |
| `--secondary`              | `#ffffff` | Secondary action fill                            |
| `--secondary-foreground`   | `#1a1a1a` | Text on secondary                                |
| `--muted`                  | `#f6f7f9` | Recessed fill, segmented shell                   |
| `--muted-foreground`       | `#666666` | Labels, helper text, metadata                    |
| `--accent`                 | `#e8f0ff` | Soft brand fill, hover, icon tiles               |
| `--accent-foreground`      | `#0066ff` | Text/icon on accent                              |
| `--destructive`            | `#dc2626` | Destructive action                               |
| `--destructive-foreground` | `#ffffff` | Text on destructive                              |
| `--destructive-soft`       | `#fde7e7` | Destructive background wash                      |
| `--success`                | `#12a150` | Success action/icon                              |
| `--success-foreground`     | `#ffffff` | Text on success                                  |
| `--success-soft`           | `#e6f6ec` | Success background wash                          |
| `--warning`                | `#b45309` | Warning action/icon                              |
| `--warning-foreground`     | `#ffffff` | Text on warning                                  |
| `--warning-soft`           | `#fbeedd` | Warning background wash                          |
| `--validation`             | `#e5484d` | Inline field error                               |
| `--status-warning`         | `#b7791f` | Status badge — warning                           |
| `--status-warning-soft`    | `#fef3e2` | Status badge — warning fill                      |
| `--status-danger`          | `#d64545` | Status badge — danger                            |
| `--status-danger-soft`     | `#fdecec` | Status badge — danger fill                       |
| `--surface-ink`            | `#111214` | Inverse surface: footer, toast, processing panel |
| `--on-ink`                 | `#ffffff` | Text on ink                                      |
| `--on-ink-muted`           | `#a7adb5` | Secondary text/links on ink                      |
| `--border`                 | `#eaecef` | Default hairline                                 |
| `--input`                  | `#d6d9de` | Control border (stronger than `--border`)        |
| `--ring`                   | `#0066ff` | Focus ring                                       |
| `--syntax-string`          | `#0a8040` | Code-editor string token                         |

**Semantic pairs.** `*` and `*-foreground` are a contract — use them together. `*-soft` is a background wash only; never put `*-foreground` text on a `*-soft` fill.

**Dark mode is deliberately off.** `:root` sets `color-scheme: only light`. There is no `.dark` block and no `@custom-variant dark`. Do not add `dark:` variants — they will never activate.

### 3.3 Typography

Five families, all loaded via `next/font/google` in `app/layout.tsx` (`display: "swap"`, `subsets: ["latin"]`) and exposed as CSS vars.

| Utility        | Token            | Stack       | Use for                            |
| -------------- | ---------------- | ----------- | ---------------------------------- |
| `font-sans`    | `--font-sans`    | Geist       | Body, controls (default on `body`) |
| `font-heading` | `--font-heading` | Inter       | `h1`–`h6` (applied automatically)  |
| `font-caption` | `--font-caption` | Funnel Sans | Labels, badges, metadata           |
| `font-script`  | `--font-script`  | Caveat      | Expressive endorsement only        |
| `font-mono`    | `--font-mono`    | Geist Mono  | Code, workbench status bar         |

**Named typography:** import `H1`–`H6`, `Display`, `P`, `Text`, `Lead`, `Large`, `Small`, `Muted`, `Caption`, `Overline`, `Metric`, `Strong`, `Blockquote`, `List`, `OrderedList`, `InlineCode`, `CodeBlock`, and `TextLink` from `@/components/ui/index.tsx`. Definitions live in `components/ui/components/typography.tsx`; every component has a fixed semantic element, native attributes/ref, and no `as` or `variant` prop.

| Components            | Size / line height             | Font / weight                 |
| --------------------- | ------------------------------ | ----------------------------- |
| Display               | 48px / 1.1                     | Inter / 700                   |
| H1                    | 32px / 1.2                     | Inter / 600                   |
| H2                    | 24px / 1.25                    | Inter / 600                   |
| H3                    | 20px / 1.3                     | Inter / 600                   |
| H4                    | 18px / 1.4                     | Inter / 600                   |
| H5                    | 16px / 1.5                     | Inter / 600                   |
| H6                    | 15px / 1.5                     | Inter / 600                   |
| P, Text               | 15px / 1.5                     | Geist / 400                   |
| Lead, Large           | 18px / 1.5                     | Geist / 400, 600              |
| Small, Caption        | 13px / 1.35                    | Funnel Sans / 500, 400        |
| Muted                 | 13px / 1.35                    | Geist / 400                   |
| Overline              | 11px / 16px                    | Funnel Sans / 600, uppercase  |
| Metric                | 32px / 1.2                     | Inter / 600, tabular numerals |
| Strong                | Inherited size and line height | Inherited family / 600        |
| InlineCode, CodeBlock | 12px / 1.55                    | Geist Mono                    |
| TextLink              | Inherited size and line height | Geist                         |

`Blockquote`, `List`, and `OrderedList` use the body recipe and native quote/list semantics. `CodeBlock` renders `pre > code`. No text component fixes its element height or adds page-level margins.

**Code snippets and outputs:** every displayed code chunk, generated snippet, command, and code-valued output must use the lightweight `SyntaxHighlight` from `components/content/SyntaxHighlight` with an explicit language. Compose it with `CodeBlock` for multiline blocks or `InlineCode` for inline code. Do not add a code editor just for syntax coloring. Keep copy/download values unchanged, preserve the shared safe fallback for unsupported languages or oversized content, and leave ordinary text and identifiers as plain text. Existing interactive code panes retain their own highlighting, search, folding, and virtualization.

**Code editors:** use `CodeEditor` from `components/content/CodeEditor` for editable code and scrollable code results. It lazy-loads CodeMirror and the selected language, reuses incremental syntax trees, and renders visible content with rainbow structural brackets. Brackets in strings and comments retain their syntax color. Subtle indentation guides show nested code blocks, with the active block emphasized while the editor has focus. Guides use bounded visible-line work and stop before wrapped continuation text; CSV and TSV retain their plain tabular layout. The folding gutter collapses supported multiline blocks in editable and read-only editors; click the arrow or the folded ellipsis to expand. Native folding shortcuts remain available, and search reveals matches inside folded blocks. The editor fills a bounded flex/grid container; use `min-h-0` and an explicit parent height so long documents remain virtualized. Set an accessible name, preserve Tab navigation, and use `readOnly` for selectable output. Single-textarea workspaces use the full input panel without an inner card or duplicate label. Boxed editors are reserved for workspaces with additional input fields. `SourceTextarea` selects this editor when given a `language`; text tool definitions declare `input.language` (or each multiline field's `language`) and `outputLanguage`. JSON, XML/HTML, YAML, JavaScript/TypeScript, CSS, shell, SQL, Markdown, CSV, TSV, and Mermaid have language support. Every CodeEditor language shows a top-right icon-only **Wrap lines** toggle with an accessible pressed state. CSV and TSV inputs start with wrapping on and their outputs start off; all other languages start off for both inputs and outputs. The on state uses `bg-accent` (`#e8f0ff`) with `text-accent-foreground`; the off state uses the muted input-icon color. Tooltips read **Text wrapping on · Click to disable** or **Text wrapping off · Click to enable**. The display choice lasts only for that editor instance; regenerated results reset to wrapping off. Copy/download continue to use the original result regardless of wrapping. Static inline samples can still compose `CodeBlock` with `SyntaxHighlight`; its 65,536-character plain-text fallback does not limit the CodeMirror editors.

Tool definitions can set `input.showLineNumbers` for the primary text input and `outputShowLineNumbers` for code results; omitted options preserve the workspace defaults (hidden for card inputs and code results).

Use language `unicode` to highlight `\uXXXX` and `\u{...}` escapes within plain text. Both `CodeEditor` and `SyntaxHighlight` color the escape sequences without decoding them or coloring surrounding prose.

Use language `url-encoded` for percent-encoded text. Both highlighters color `%HH` triplets, including consecutive UTF-8 bytes, while keeping ordinary URL text and literal `+` signs unchanged.

Use `CodeEditor` language `url` for URLs and query strings. It distinguishes the address, parameter names, values, separators, and percent escapes without decoding or changing the text. URL inputs wrap by default and do not load autocomplete.

Use language `robots` with `SyntaxHighlight` for robots.txt output. Directive names, values, and comments receive distinct colors while copy and download retain the original text.

**Editor loading and suggestions:** the editing core loads independently of autocomplete. Language support waits until the page finishes loading and the browser is idle, because some language packages include completion code. Suggestions initialize only after a supported editable editor receives focus, through the same cancellable idle boundary. Read-only editors never activate suggestions. Loading failures leave text editable; late features preserve the document, cursor and undo history. Keep future completion providers behind this shared boundary. Mermaid uses the community `codemirror-lang-mermaid` grammar for supported diagram families, basic viewport-only coloring for additional types, and a separate deferred keyword/snippet provider. Ctrl+Space opens suggestions; automatic suggestions are disabled for documents above 100,000 characters, retaining manual completion.

```tsx
<H1>Tool catalog</H1>
<Muted>Find, group, and publish tools.</Muted>
<H2>Documents</H2>
<H3>Tool settings</H3>
<Caption>6 tools</Caption>
```

Consumers use these components without font-size, font-family, font-weight, line-height, tracking or casing overrides. Layout, wrapping, alignment and contextual state colors remain with the owner. Do not change heading levels merely to obtain a smaller font. Keep phrasing content inside paragraphs (`Text`, `Caption`, `Strong`, `InlineCode`); `P`, `Lead`, `Muted`, and `Large` are block content.

Existing fields, buttons, inputs, selects, tables, navigation and state components own their typography internally. Use `Input code` or `Textarea code` for code content rather than caller font classes. `typographyStyles` is for component internals and imperative editor integrations; ordinary pages use the named components. Layered editors share the code recipe across source, gutter and syntax overlay. Document templates, printed previews and React-PDF use their existing configurable output typography, independently from app chrome.

The class-merging helper recognizes all semantic size tokens so adding a text color cannot silently remove a font size. `/admin/design-system` demonstrates the complete named set.

### 3.4 Radius

| Utility      | Value            |
| ------------ | ---------------- |
| `rounded-sm` | `0.25rem` (4px)  |
| `rounded-md` | `0.5rem` (8px)   |
| `rounded-lg` | `0.5rem` (8px)   |
| `rounded-xl` | `0.75rem` (12px) |

Convention: **4px** selection controls, **8px** inputs/buttons/alerts, **12px** cards and panels, `rounded-full` pills. `md` and `lg` are currently the same value — see [Known gaps](#10-known-gaps).

### 3.5 Elevation

| Utility     | Value                                        | Use for                                |
| ----------- | -------------------------------------------- | -------------------------------------- |
| `shadow-sm` | `0 1px 2px #0000000d`                        | Segmented active pill, media workbench |
| `shadow-md` | `0 2px 4px #00000008, 0 6px 16px #0000000f`  | Popovers, conversion workbench         |
| `shadow-lg` | `0 2px 4px #00000008, 0 12px 32px #0000000f` | Cards, workbench shell                 |

Three steps, no more. If a surface needs a fourth, it probably needs a border instead.

### 3.6 Base layer

`theme.css` `@layer base` sets, globally:

- `*` → `border-border outline-ring/50` (default border colour + focus outline)
- `body` → `bg-background font-sans text-foreground`
- `h1…h6` → `font-heading`

So headings and focus rings are correct without any class. Do not re-declare them.

### 3.7 Layout

- `AppContainer` is the page gutter: `max-w-[1328px]` (1200px content + 64px desktop edge).
- Card collections: 1 column small / 2 medium / 3 large, `gap-6` rhythm.
- **There are no spacing tokens.** Use Tailwind's default 4px-based scale.

---

## 4. Component inventory

60 design nodes are mapped to code in `components/ui/design-system-manifest.ts`. Grouped inventory below; variant lists are the authoritative option names.

### Shell & navigation

| Component                | Source         | Variants / key props                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppContainer`           | `index.tsx`    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `BrandLockup`            | `index.tsx`    | req `href`, `name`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ProductHeader`          | `index.tsx`    | `compact?: boolean` (72px vs 88px); main navbar uses `ScrollAwareHeader` to hide after 20px downward travel and reveal after 10px upward travel; stays visible within one header height of the top, during focus, and while a menu is expanded; 350ms gentle exit / 300ms entrance, immediate keyboard reveal and no animation with reduced motion; passive frame-batched scrolling updates only the header attribute, never rerendering children; nested tool scrolling and Admin chrome are unaffected |
| `AccountNavigation`      | `index.tsx`    | req `returnTo`, `user \| null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `UniversalProductHeader` | `patterns.tsx` | req `category`, `description`, `icon`, `title`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `InlineProductHeader`    | `patterns.tsx` | req `description`, `icon`, `title`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ToolPageShell`          | `index.tsx`    | req `category`, `categoryHref`, `description`, `productHref`, `productName`, `title`; `showIntro`, `showCategoryInBreadcrumb`                                                                                                                                                                                                                                                                                                                                                                                            |
| `ToolNav`                | `index.tsx`    | req `items[]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SidebarNavItem`         | `patterns.tsx` | `active?: boolean`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ProductFooter`          | `patterns.tsx` | req `brand`, `columns[]`, `copyright`, `description`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

`components/ui/theme.css` owns the header breakpoints through static theme tokens: `--breakpoint-compact: 36rem` (576px) and `--breakpoint-navigation: 62.5rem` (1000px). Use Tailwind's `compact:`, `max-compact:`, `navigation:`, and `max-navigation:` variants instead of repeating those values. JavaScript consumers use `matchBreakpoint({ min: "compact" })` from `components/ui/lib/breakpoints.ts`, which reads the same CSS tokens and returns a `MediaQueryList`; optional `min` and `max` accept either token name.

`ProductHeader` keeps its existing search icon and full-width mobile menu below `compact`. Between `compact` and `navigation`, the search field is centered and the existing menu icon remains on the right alongside account and page actions, opening a bounded popover below the header. The menu contains the same navigation, Saved tools, and account actions at both sizes. From `navigation`, the full navigation and standalone Saved action appear. Saved tools uses its mobile sheet below `compact` and its anchored popover from `compact`. Content grids and workspace breakpoints remain independent.

`GlobalToolSearchProvider` owns one shared search dialog for the header, `FamilyToolSearch` catalog forms, and Cmd/Ctrl+K. Keep it inside the locale and direction providers. Family forms open the dialog with their current query and a removable filter; the shortcut searches across families while preserving an open query. The dialog uses the shared controls and Radix modal focus handling, sits below the product header on mobile, and centers in the desktop viewport. Escape and backdrop dismissal restore the launch control. Search and the mobile navigation menu are mutually exclusive.

An empty query shows up to three recent searches and popular suggestions from the current public catalog: one per available family globally, or up to three within a family. Only activating a tool link saves history; removing an entry updates storage immediately. Storage failures do not prevent navigation. Query and suggestion requests carry the locale and optional family, ignore outdated responses, and preserve native links. Loading, results, empty, and retry states use a bounded scrolling card. Motion respects reduced-motion preferences; exiting controls become inert immediately.

### Layout & headings

| Component                                  | Source            | Variants                                    |
| ------------------------------------------ | ----------------- | ------------------------------------------- |
| `PageHero`                                 | `index.tsx`       | `align: left \| center`, `compact: boolean` |
| `ToolPageHeader`                           | `index.tsx`       | `inlineEyebrow: boolean`                    |
| `SectionHeading`                           | `index.tsx`       | —                                           |
| `ToolPageIntro`                            | `patterns.tsx`    | —                                           |
| `Separator`                                | `separator.tsx`   | `orientation`                               |
| `ScrollArea` / `ScrollBar`                 | `scroll-area.tsx` | `viewportClassName`, `viewportProps`        |
| `ResizablePanelGroup` / `Panel` / `Handle` | `resizable.tsx`   | `withHandle?: boolean`                      |

`ResizableHandle` uses a thin divider with a 24px pointer target and an optional 3 × 24px rounded grip mark centered on the line. The neutral mark has no surrounding box, border, shadow, or halo. The divider gains a faint primary tint on hover and keyboard focus (20% opacity), slightly stronger during dragging (30%); the small grip carries the full accent. Handles without a grip use a neutral keyboard focus indicator. `SplitStack` enables the grip on expanded resizable workspaces, except where the centered collapse control already occupies that position. Keep panel `defaultSize` values stable while mounted; resize through the panel API instead so active gestures are not interrupted.

Settings drawers must use `SettingsStack` from `components/Stacks.tsx` so their gear icon, accessible label, and collapse behavior stay consistent across tool families; use generic `SplitStack` for other pane relationships.

### Actions

| Component          | Source             | Variants                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`           | `button.tsx`       | `variant: default \| strong \| destructive \| outline \| secondary \| ghost \| input-icon \| danger-subtle \| link`<br>`size: default \| xs \| sm \| md \| lg \| icon \| icon-xs \| icon-sm \| icon-md \| icon-lg`<br>`asChild`; `disabled` preserves colors at 50% opacity; `loading` disables activation and shows a circular spinner with `aria-busy` |
| `BackButton` | `BackButton.tsx` | `href` for navigation with optional anchor `onClick`, or `onClick` with optional `disabled` for an in-page return; required accessible `label` and optional layout `className`. Always icon-only with a shared tooltip, a 28 × 20px long-shaft arrow, and a 36 × 36px hit target. Background stays transparent; arrow turns primary blue on hover, keyboard focus, and press, with 2px movement over 200ms. Respects reduced motion and RTL direction. Use `items-start pt-2` beside page headings; do not override the arrow geometry. |
| `ButtonGroup`      | `button-group.tsx` | `orientation: horizontal \| vertical`                                                                                                                                                                                                                                                                                                                    |
| `ActionMenuButton` | `ActionMenuButton.tsx` | Shared labeled menu trigger with optional `icon`, Button-derived `size: xs \| sm \| default \| md \| lg`, and `variant: default \| outline \| secondary`. Size defaults to the standard Button default. Its size type and control geometry come from `Button`/`buttonVariants`; the chevron cell uses the matching `icon-xs`, `icon-sm`, `icon`, `icon-md`, or `icon-lg` variant beside a full-height divider. Supply `DropdownMenuItem` children. Optional `primaryAction` renders a separate main action beside the menu arrow; `menuLabel` names that arrow accessibly. `disabled` guards the menu; `primaryAction.disabled` guards the main action. `loading` shows the main action's spinner; `contentProps` configures shared menu content and focus handoff. |
| `CreateMenuButton` | `ActionMenuButton.tsx` | Shared primary Create button with plus and a full-height divider separating the chevron cell. Inherits the Button-derived size type, `xs \| sm \| default \| md \| lg` tokens, standard default, and `buttonVariants` geometry from `ActionMenuButton`, including the matching icon-size variant for the chevron cell. No independent button pixel sizing. The whole button opens the action menu. Supply `DropdownMenuItem` children for creation choices. Templates use Simple / Advanced links; Categories & tags open a modal. Optional `label` defaults to Create; `disabled` blocks selection, while `triggerRef` and `onCloseAutoFocus` support modal focus handoff. |
| `CompactAction`    | `patterns.tsx`     | pre-bound `Button size="sm" variant="outline"` at 32px                                                                                                                                                                                                                                                                                                   |
| `RemoveFileAction` | `patterns.tsx`     | pre-bound icon button, `aria-label="Remove file"`                                                                                                                                                                                                                                                                                                        |

Neutral actions (`outline`, `secondary`, `ghost`, and `input-icon`) share the same hover and pressed colors: `accent` background with `accent-foreground` text and icons. This applies to media preview/remove controls, toolbar actions, and field icons. Keep these states in `Button`; do not override them in individual tools. `BackButton` centrally overrides these states to keep its background transparent and arrow blue. Primary and destructive actions retain their semantic colors, and clickable content surfaces use `card-action`.

### Compact control scale

Synced to `DAGXr` in `designs/design.pen`. Existing size names are unchanged; each tier steps down once, with XS reduced by 4px. Applies to Button (including icon-only), Input, SelectTrigger, CheckboxControl and RadioGroupItem.

| Size | Control height / icon-button square | Horizontal padding | Button type / icon | Input & select type / chevron | Checkbox / radio mark |
| --- | --- | --- | --- | --- | --- |
| `xs` | 28px | 8px | 11px / 12px | 11px / 12px | 12px |
| `sm` | 32px | 10px | 11px / 14px | 11px / 14px | 14px |
| `default` | 36px | 12px | 13px / 15px | 13px / 15px | 16px |
| `md` | 44px | 16px | 15px / 18px | 14px / 16px | 20px |
| `lg` | 48px | 18px | 15px / 18px | 15px / 18px | 22px |

Selection marks are not their hit areas: checkbox primitives retain at least 24px targets and radio primitives retain their expanded targets. Touch surfaces must retain 44px targets via layout or explicit sizing. Context-specific overrides (including the 32px workbench controls and mobile navigation) remain unchanged. Textarea geometry, general typography, field labels, and switch sizes are unchanged.

Select menus inherit the owning `SelectTrigger` size through React context, including portalled content and the native-option adapter. Option minimum row height, text, horizontal inset, selected check, group labels, and scroll controls follow the same table; changing the trigger size updates its open menu without per-item props. Menu surface inset stays 4px. Rows may grow for wrapped labels, and selected text uses `accent-text` on `accent` for contrast. Open-state Pencil examples live in `DAGXr → OjgK0`.

### Forms

`KeyValueFields` (`components/KeyValueFields.tsx`) is the controlled editor for repeated key/value inputs. Keep its Add action beside the compact group heading. Pairs share a row when the component is at least 24rem wide and stack below that width; column labels appear once on wider layouts and above every stacked input. Pass `rows`, `onChange`, and `label`; customize field labels, placeholders, add/remove labels, optional help, and per-row `errors`. Adding focuses the new key; removing focuses the next remaining key or the Add action after the final row. Errors are announced beside their row and associated with both fields. `SettingsPanel` rows and tool-owned parameter forms share this component. The Common fields showcase includes an interactive example.

`CanvasHandle` (`components/canvas-handle.tsx`) is the shared point control for image crops and shape editors: a 16px primary dot with a 2px white border inside an invisible 44px hit area. `selected` adds the selection ring; native button props and refs pass through. Callers provide an accessible name, position, pointer and keyboard behavior, and any selection or slider semantics. Focus and disabled styles stay in the control.

`variant="subtle"` uses an 8px neutral square and a 28px target for dense shape controls. Hover, keyboard focus, press, and `selected` highlight the marker with the primary color. Set `edge="top" | "right" | "bottom" | "left"` to center the marker on that edge while placing its hit area outside the preview, keeping neighboring horizontal and vertical handles separately reachable. Only colors transition; handle geometry follows input immediately.

`ColorControl` (`components/ColorControl.tsx`) combines a native visual color picker, CSS-text input, explicit opacity controls, and field validation. It accepts `value`, `onChange`, `label`, optional `disabled`, `compact`, and `layout: inline | stacked` (default `inline`). All layouts expose a named group using `label`.

The standard inline layout uses one row: a labeled color-text field with a circular, clickable native picker inside its left edge sits beside a separately labeled Opacity percent field. It omits the slider and standalone swatch. Use this default layout across tools, including Box Shadow, Palette, and Contrast. The explicit `layout="stacked"` legacy alternative retains an opacity slider, percent input, and checkerboard swatch. Its optional `compact` mode uses 8px gaps, places the opacity label, slider, and percent input together in one row below the color field, and omits the extra swatch.

Use one canonical color value in the tool runtime. It accepts standalone HEX, RGB, HSL, CSS names, and transparency; fine opacity edits retain decimal RGB alpha. Parser-owned CSS color settings must use text descriptors to avoid the generic HEX-only color-setting normalization. `ColorSwatch` is the labeled, non-interactive preview primitive. The admin component library demonstrates the default inline control and explicit legacy stacked layout alongside the standalone swatch.

Color & Design workspaces share `app/devtools/components/color-design/DesignWorkspace.tsx`: the operation-specific preview occupies the main surface, related settings are grouped in the right panel, and copy/download output sits below the preview. `compactOutput` caps the preview height to keep CSS export actions visible; `compactInput` leaves more room for conversion results. `DesignRange` pairs visual adjustment with an exact keyboard-editable number. The adjacent `ColorValueList` uses compact semantic rows and individually labeled copy buttons for picker, converter, and image-sampling values. Tool-specific canvases, spatial corner controls, palettes, and image sampling remain owned by each tool.

| Component                       | Source                 | Variants                                                                                                                                                                                             |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Field` (composition)           | `index.tsx`            | `variant: default \| auth`; req `htmlFor`, `label`, single-element `children`                                                                                                                        |
| `AuthField`                     | `index.tsx`            | `Field` with `variant="auth"` pre-bound                                                                                                                                                              |
| `FieldRoot` + parts             | `field.tsx`            | `variant: default \| auth`, `orientation: vertical \| horizontal \| responsive`                                                                                                                      |
| `Input`                         | `input.tsx`            | `size: xs \| sm \| default \| md \| lg` (native `size` omitted); native range controls have no text-input padding or border, including inside workbenches, so the thumb reaches both track endpoints |
| `Textarea`                      | `textarea.tsx`         | — (`min-h-[88px]`, `field-sizing-content`)                                                                                                                                                           |
| `InlineTextEditor`              | `InlineTextEditor.tsx` | controlled `value`, `onChange`, accessible `label`; `activation: click \| doubleClick` (default `doubleClick`), `multiline`, `required`, `maxLength`, `disabled`; inherits parent typography in display and editing states                                       |
| `Select` + parts                | `select.tsx`           | `SelectTrigger size: xs \| sm \| default \| md \| lg`; auto-bridges native `<option>` children                                                                                                       |
| `RadioGroup` / `RadioGroupItem` | `radio-group.tsx`      | `size: xs \| sm \| default \| md \| lg`                                                                                                                                                              |
| `Checkbox` (composition)        | `index.tsx`            | req `label`; wraps `CheckboxControl` in a `<label>`; optional `tooltip` uses shared Tooltip parts under a group-level `TooltipProvider`, with a focusable wrapper when disabled                      |
| `CheckboxControl`               | `checkbox.tsx`         | `size: xs \| sm \| default \| md \| lg`; default 16px mark; checked / indeterminate                                                                                                                                                              |
| `Switch`                        | `switch.tsx`           | `size: xs \| sm \| default \| lg`                                                                                                                                                                    |
| `Label`                         | `label.tsx`            | —                                                                                                                                                                                                    |

`Field` clones its child to inject `id`, `aria-describedby`, `aria-errormessage`, `aria-invalid`. **Use `Field` rather than pairing `Label` + `Input` by hand** — that is where the a11y wiring lives.

`AutocompleteInput` (`autocomplete.tsx`) adds Base UI suggestions to the shared `Input`. Pass controlled `value`, `onValueChange`, and prefiltered `suggestions`; free typing is always allowed. It forwards Input sizing, `code`, and accessibility props, so compose it inside `Field`. Arrow keys navigate, Enter or pointer selection accepts, and Escape dismisses; accepting a suggestion does not submit the form. The menu stays within the viewport and closes when no suggestions are available.

`Field required` and `FieldLabel required` show an asterisk in the validation color and retain the required-field description for screen readers. Keep the input's native `required` attribute where applicable.

Place `InlineTextEditor` inside the appropriate typography component, such as `H2` or `Muted`. Text activation defaults to double-click; use `activation="click"` for a title that should enter editing on one click, as in the advanced template editor. Use `showKeyboardHint={false}` in compact headers to hide the visible keyboard hint while preserving screen-reader instructions and visible validation errors. The pencil edit button and keyboard activation remain available in both modes. The form controls showcase uses click for its title and the double-click default for its description. Focus and press Enter to edit; Enter finishes both single-line and multiline editing, and Shift+Enter inserts a new line in multiline fields. Blur keeps the draft and Escape restores the value from before editing. The parent owns saving and toast feedback; finishing an edit does not persist it. The showcase also includes a disabled example.

### Content states

`ContentState` (`components/ui/components/ContentState.tsx`, Pencil `h8fIBJ`) is the shared presentational empty/error pattern. It composes the existing `Empty` primitives, has no client hooks or data dependencies, and is usable from server and client components. The existing public `EmptyState` export remains an alias, so all established collection/list callers use the same implementation without an API break.

- Required `title`; optional `description`, `icon`, `action`, `secondaryAction`.
- `state`: `empty`, `no-results`, `error`, `loading`, `unavailable`, `waiting`, `cancelled`, `complete`. Only error/loading supply a default icon; `icon={null}` explicitly omits it.
- `density`: `page` (bounded content), `section` (20px heading / 48px icon), `panel` (17px / 36px), `compact` (14px / 24px). Every density centers its content and actions by default. `align` can be `center` or `start` for an explicit contextual override.
- `headingLevel`: `h1`, `h2` (default), or `h3`; choose by document structure, not visual size.
- `announcement`: `off` (default), `polite`, or `assertive`, applied only to the message. Loading defaults to `polite`; omit duplicate announcements when the host already has a live region.
- Zero actions render no action area. States grow to center within the available page, list or panel area; their owning container supplies that area without viewport-height sizing inside nested panels. Long content keeps its natural height and remains scrollable. Actions wrap on desktop and stack with at least 44px height on mobile. Use shared `Button` instances; caller-owned pending actions use `loading`/`disabled`.

```tsx
<ContentState
  state="error"
  title="Couldn’t load posts"
  description="Try again in a moment."
  action={<Button loading={retrying} onClick={retry}>Try again</Button>}
  secondaryAction={<Button asChild variant="outline"><a href="/blog">All posts</a></Button>}
/>
```

Adopted through all existing `EmptyState` consumers and directly in route errors/not-found, workspace surfaces, result/cancellation messages, global search, Saved tools, PDF outline search and assistant history. The component never invents callbacks, navigation, save claims or downloads. A renderer failure preserves the generated artifact; pending input is not a successful empty collection. Only safe caller-defined operations retry; uncertain jobs keep their status-refresh/recovery flow.

Do **not** replace field errors, the upload/drop surface, cached data during background failure, account/permission screens, formula/code editors, or the provider-independent global crash fallback. The tool-registry empty state is actionless: its former registration-guide link opened a component showcase rather than a guide.

### Feedback

| Component                                   | Source             | Variants                                                                                           |
| ------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| `Alert` / `AlertTitle` / `AlertDescription` | `alert.tsx`        | `variant: default \| destructive`                                                                  |
| `AlertBanner`                               | `index.tsx`        | `variant: info \| success \| warning \| error`; `error` → `role="alert"`, others → `role="status"` |
| `AlertDialog` + parts                       | `alert-dialog.tsx` | `AlertDialogContent size: default \| sm`; `AlertDialogMedia` 64px icon slot                        |
| `Toaster` / `toast`                         | `sonner.tsx`       | ink surface; presets success/info/warning/error/loading                                            |
| `Tooltip` + parts                           | `tooltip.tsx`      | `delayDuration` 300, `sideOffset` 6                                                                |
| `ProcessingStatus`                          | `patterns.tsx`     | optional `progress` (clamped 0–100), `aria-live="polite"`                                          |
| `RightPanelProcessing`                      | `patterns.tsx`     | `progress` **required** here                                                                       |
| `Empty` + parts                             | `empty.tsx`        | `EmptyMedia variant: default \| icon`                                                              |
| `ContentState` / `EmptyState` alias         | `ContentState.tsx` | Optional icon, 0–2 actions; page/section/panel/compact density; caller-owned recovery                |
| `InlineGuidance`                            | `patterns.tsx`     | optional `icon` (default `Lightbulb`)                                                              |

### Surfaces & data

| Component                                                             | Source                         | Variants                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Card` + parts                                                        | `card.tsx`                     | —                                                                                                                                                                                                                                        |
| `Accordion` + `AccordionItem`, `AccordionTrigger`, `AccordionContent` | `accordion.tsx`                | shadcn/Radix pattern; `type: single \| multiple`; use `multiple` for independent settings groups. Keep form values controlled when collapsed content unmounts. Place account actions beside their description, never inside the trigger. |
| `SectionCard`                                                         | `index.tsx`                    | —                                                                                                                                                                                                                                        |
| `DangerZone`                                                          | `index.tsx`                    | —                                                                                                                                                                                                                                        |
| `CatalogCard` / `ToolCard`                                            | `index.tsx`                    | req `action`, `description`, `title`                                                                                                                                                                                                     |
| `Badge`                                                               | `badge.tsx`                    | `variant: default \| secondary \| destructive \| outline \| ghost \| tag \| link`, `asChild`                                                                                                                                             |
| `StatusBadge`                                                         | `index.tsx`                    | `variant: neutral \| info \| success \| warning \| danger \| archived`                                                                                                                                                                   |
| `Tag`                                                                 | `design-system-components.tsx` | `Badge` with `secondary` forced                                                                                                                                                                                                          |
| `Avatar` + `AvatarBadge` / `AvatarGroup` / `AvatarGroupCount`         | `avatar.tsx`                   | `size: default \| sm \| lg`                                                                                                                                                                                                              |
| `Table` + parts                                                       | `table.tsx`                    | `showColumnDividers?: boolean`; sticky `th`                                                                                                                                                                                              |
| `Tabs` + parts                                                        | `tabs.tsx`                     | `TabsList variant: default \| line \| segmented \| pills`                                                                                                                                                                                         |
| `SegmentedControl`                                                    | `design-system-components.tsx` | `size: inline \| navigation`; req `items[]`                                                                                                                                                                                              |
| `IconTile`                                                            | `patterns.tsx`                 | `size: sm \| default \| lg`, `tone: accent \| contrast \| success \| muted`                                                                                                                                                              |
| `MetricCard`                                                          | `patterns.tsx`                 | req `label`, `value`; optional `delta`                                                                                                                                                                                                   |

#### Selection highlight

Import `SelectionHighlight` from `@/components/ui/components/SelectionHighlight.tsx`. Wrap an existing container with `<SelectionHighlight asChild activeSelector='[aria-pressed="true"]'>` to glide one accent background and primary border behind its selected descendant. It measures the descendant's bounds and radius; CSS transitions animate the indicator and respect reduced motion. No per-item wrappers or render callbacks are required, and callers retain selection state, semantics, and event handlers.

The single `asChild` child must forward `className`, `style`, other DOM props, and its ref to its actual container. Keep selected backgrounds transparent while the container has `data-selection-highlight-ready="true"` so they do not cover the moving indicator; retain static selection styling as a fallback. `activeSelector` must identify one selected descendant. `disabled` suspends the indicator without disabling the controls. Without `asChild`, the component renders a `div`.

### Tool-page patterns

| Component                                                                 | Source                         | Variants                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkbenchShell`                                                          | `design-system-components.tsx` | `variant: json \| conversion \| media \| utility` (elevation only); req `toolbar`                                                                                         |
| `JsonFormatterWorkbench` / `DataConversionWorkbench` / `UtilityWorkbench` | same                           | pre-bound `WorkbenchShell` variants                                                                                                                                       |
| `ToolPageSystemControls`                                                  | same                           | all-optional slots: `children`, `preferences`, `actions`                                                                                                                  |
| `WorkspacePanelHeader` | `WorkspacePanelHeader.tsx` | Shared 51px panel toolbar and bottom divider. `children` supplies the leading title, status, or `FileChip`; optional `meta` and `actions` sit at the end. Accepts native header attributes. |
| `FileUploadZone`                                                          | `patterns.tsx`                 | req `title`; optional `description` for formats/limits and `hint` for browse/drop guidance; centered content, 240px minimum height (Pencil `oFvm5`); renders a `<button>` |
| `FileQueueItem`                                                           | `patterns.tsx`                 | req `metadata`, `name`                                                                                                                                                    |
| `FileChip` | `file-chip.tsx` | req `file` (name, size, type, lastModified), `onRemove`; optional `disabled`, `details`, `className`. Filename badge with cross; full metadata on hover and keyboard focus. Use only in tool toolbar headers; cards, file queues, settings, and fullscreen previews retain plain filenames and separate remove actions. Keep Upload and Paste actions unchanged. |
| `DownloadResult` / `RightPanelResult`                                     | `patterns.tsx`                 | req `metadata`, `title`                                                                                                                                                   |
| `ToolOptionsPanel`                                                        | `patterns.tsx`                 | `variant: card \| plain`                                                                                                                                                  |
| `HowItWorks`                                                              | `patterns.tsx`                 | req `steps[]` → numbered 3-col `<ol>`                                                                                                                                     |
| `ToolSupportSections`                                                     | `patterns.tsx`                 | req string `action`, `result`, `source`                                                                                                                                   |

`WorkbenchShell` force-downsizes descendant `[data-slot=button|input|select-trigger]` to 32px. Do not fight it with per-call size props — pass content and let the shell size it.

`WorkspacePanelHeader` owns the fixed 51px height, horizontal padding, single-row layout, and bottom divider for secondary workbench toolbars. `WorkspaceSurface` uses it for `variant="panel"`; compact source-file rows use the same component with `FileChip` as their leading content. Keep descriptions and instructions below the toolbar, never inside its title row. Leading content truncates as space narrows and actions stay on one row. Card headers keep their separate card layout. The Actions section of `/admin/design-system` shows paired input/output headers with helper text below the input divider.

Media file-processing and image-conversion workspaces keep both input and output mounted from the empty state through processing and completion, with options in the shared settings drawer so the two task surfaces retain useful width. Place the primary artifact's `ArtifactDownloadButton` with `variant="toolbar"` in the output header, leaving the body for the preview and progress; do not repeat the primary download in a footer card. Embedded `MediaOutputGallery` instances use `header="sr-only"`, `primaryOutputId` to omit the duplicated primary card download, and `disabled` while processing. Fullscreen previews and individual batch outputs retain their downloads. PDF editors with an options column retain a persistent processed-output section there, including recovery and individual-file downloads.

#### Focus mode

`WorkbenchShell` provides **Expand workspace / Exit focus mode** with maximize/minimize icons. Supply `workspaceTitle` for the expanded toolbar. It expands the existing DOM rather than opening a second editor or navigating: edits, undo history, settings and results remain mounted. Surrounding page content becomes inert and invisible; exiting restores scrolling and focus. Escape defers to open dialogs, menus and editor completions. Same-origin preview frames also support Escape.

Mark only a genuine input/preview `SplitStack` with `presentation`. Static two-pane grids can use `components/tool-workbench/WorkbenchPanes.tsx`. These register the centered **Input / Split / Preview** icon-and-label control. Do not register settings panels, two-input comparisons or single-surface tools as input/preview pairs. Settings remain independent. Below 1024px only Input and Preview are offered. The mode switch never clears or remounts the panes, and returning to Split restores the resized proportion.

Paperwork uses `PaperworkWorkspace` with the same presentation provider and controls, preserving its scrollable document forms and export actions. The compositions section of `/admin/design-system` includes an interactive focus-mode example.

#### Input workspace layout

- **One textarea:** fill the input panel directly. Do not add an inner input card, inset border, extra card padding, or a repeated visible label below the panel header. Keep an accessible label on the editor.
- **Multiple input fields in the same workspace:** retain individually labelled, boxed editors. A textarea plus a query, path, or column field counts as multiple inputs, as do JSON data plus schema.
- Count fields in the input workspace only. Settings in a separate panel and actions such as Paste, Upload, or the text-wrapping toggle do not turn a single textarea into a multi-input form.
- Apply this rule consistently to plain text and code editors, including CSV/TSV, regardless of the tool's input-spec representation. Keep the text-wrapping icon floating at the top right without reserving a toolbar row or extra top space; wrapping defaults are independent of card layout.

### Feature widgets

Stateful, own external dependency. Treat as leaf components; do not clone.

| Component             | Source                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChapterScrubber`     | `ChapterScrubber.tsx` | `motion/react` dock-wave; `density: compact \| default`, `side: left \| right`; hover previews stay open across the gap and select the chapter on click or Enter/Space; Escape dismisses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `OrderableList<Item>` | `OrderableList.tsx`   | `@dnd-kit`; `layout: grid \| vertical`; `dragSurface: handle` (default) or `card` (mouse drag / 200ms touch hold preserving swipe scrolling); full drag announcements + keyboard sensor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PdfViewer`           | `PdfViewer.tsx`       | composes `ChapterScrubber` + `Button`; outline starts collapsed, fits content up to 35% of viewer width, and uses a Morphicons hamburger-to-X toggle with a synchronized 280ms outline/PDF width transition with stable outline content (respects reduced motion); Show outline focuses search, Escape closes and restores toggle focus; 100% zoom fills available page width by default; `fit="page"` fits each complete page inside the viewport at 100%; zoom clamped 50–200, step 10; optional `pages` enables continuous scrolling with page/outline sync; `pageClassName` styles the clipping frame when a tool owns its page selection border; optional `onExpand` opens a caller-owned full-screen preview; `fileSize` adds size to page metadata and `rightChildren` places tool actions beside zoom controls |
| `MediaPreview`        | `MediaPreview.tsx`    | `Is1Pt`; controlled full-screen Radix dialog; media-agnostic `children`, optional header `actions` before Exit preview, `controls`, `status`, `hint` slots; Escape/exit, focus trap and return focus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

`OrderableList.selectedId` optionally marks the current item with an accent background and primary border while reserving the same border space on every row. It adds no selection behavior; the caller owns selection controls and their accessible state. Add `animateSelection` to glide that highlight between rows through the shared `SelectionHighlight`; dragging temporarily restores static selection so the indicator does not compete with drag transforms. Omit `selectedId` to retain the default unstyled row wrapper. Both standalone `asChild` buttons and a selectable, reorderable list are demonstrated on `/admin/design-system`.

### PDF file workspaces

`components/FileProcessorWorkspace.tsx` keeps the media input and output panes
mounted before and after processing. The shared panel headers align their
dividers; file-order guidance sits below the input toolbar. Progress,
cancellation, and recovery appear with the output. Single-PDF results use
`GeneratedPdfPreview` in the output pane, with the file's download action in the
output toolbar and a full-screen preview available from Expand.

`components/PdfFileWorkspace.tsx` supplies the shared Split PDF and Extract PDF
Pages shell: centered intake, source `PdfViewer`, right-side settings, and the
primary action above one plan/processing/download status slot. Tools supply the
plan and page overlays. `PdfPageSelectionOverlay` gives Extract and Watermark
the same whole-page selection button, primary outline, and small checkmark. A single
PDF uses `DownloadResult`; multiple PDFs keep individual downloads below the ZIP
download card. The card's download action stays inline with its metadata.
Page settings can opt into `presets` to use the shared `Select` for All pages,
Odd pages, Even pages, or Custom ranges, with a range input only for custom
selection. Watermark uses this pattern; preview selection updates the same value.

### Comparison workspaces

`DiffWorkspace` in `components/DiffWorkspace.tsx` shares the JSON Diff and Text
Diff workflow: equal source editors with individual Paste actions, an aligned
comparison with change counts, and an Edit action that restores the inputs and
focus. Tool definitions supply editor language and labels. Optional settings
remain in the collapsible side panel; copy/download use the original result.

### Generated value lists

`GeneratedList` in `components/Surfaces.tsx` lays out independent, copyable
results in an auto-fill grid sized from the longest value or caption line,
with room for numbering and copy controls. Short values share a row; longer
content receives wider columns, up to a full row. Incomplete rows retain the
same column widths instead of stretching their last items across unused space.
Items retain their source order, numbering, and copy controls. Multiline values
preserve line breaks, and long unbroken values wrap without horizontal overflow.
Only the results scroll; the result header and bulk actions stay visible.

Use `variant="text"` for prose such as generated paragraphs. It uses readable
body typography and one full-width card per item, with the same numbering,
wrapping, and copy actions. The default `code` variant keeps the compact grid
and code styling for generated strings and identifiers.

### Generated media output cards

`MediaOutputCard` matches the Nswh4/US7ym image cards: an inset, aspect-preserving
square preview, stacked filename/format/size, and always-visible top-right
Preview and Download (or Remove) icon buttons with shared accessible tooltips.
Its `children` supplies the preview; `onPreview`, `onDownload`, `onRemove`,
`disabled`, `downloading`, and `error` are caller-owned. Existing output callers
remain supported. Remove is disabled during processing; preview stays available.
Long filenames wrap rather than depending on native title attributes.

`components/MediaOutputGallery.tsx` exports `MediaOutputGallery({ files })` for
stored image artifacts and `MediaInputGallery({ files, onRemove, disabled? })`
for `readonly File[]`. Removal passes the original File object to its owner.
Both reuse the current full-screen preview dialog; source previews offer Remove,
not Download. HEIC/HEIF decoding is attempted natively; failures explain the
browser limitation without claiming the file cannot be converted. Failed previews
open the dialog for retry; failed downloads retain a retry action.
Only the grid scrolls; archive download and result facts remain outside it.
Thumbnails load near the viewport and retain URLs until unmount or file change;
all URLs are revoked on replacement, retry, or unmount, including dialog URLs. Per-file downloads use the actual generated bytes, not
thumbnail captures. Preview uses `MediaPreview` with a translucent blurred backdrop,
a scrollable square thumbnail rail, and view-only fit/zoom/pan controls. Rail labels
remain accessible without adding visible filenames or an Images toggle.

PDF-to-JPG retains individual generated artifacts alongside the archive using
`retainEntries` on its batch writer. Other batch users still return only their
archive by default. Output byte totals describe the primary downloadable archive,
not the extra browser storage occupied by individual preview/download artifacts.

### Full-screen preview usage

```tsx
import { MediaPreview } from "@/components/ui/index.tsx";

<MediaPreview
  open={previewOpen}
  onOpenChange={setPreviewOpen}
  title={file.name}
  description={fileDetails}
  controls={previewControls}
  status="Preview only"
>
  {previewContent}
</MediaPreview>;
```

`MediaPreview` is a viewport-filling modal, not the browser Fullscreen API and
not a media renderer. `children` may contain images, video, audio, a PDF viewer,
or another task surface. No MIME detection, source loading, zoom transforms,
playback controls, or file actions are inferred. The optional footer disappears
when `controls`, `status`, and `hint` are omitted. Supply only controls the child
actually implements; download actions remain in the underlying Media result panel.

The content area is scrollable. The caller controls child geometry (`m-auto` for
centered content with safe overflow, `w-full h-full min-h-0` for a full-size viewer,
or `max-w-full max-h-full object-contain` for an image). Lift any state that must
survive closing into the caller: dialog children unmount on exit. Caller-owned
loading/error states also belong in `children`.

Radix supplies modal focus containment, background scroll locking, and Escape.
Exit restores focus to the opening control when it still exists. Embedded
cross-origin frames and native PDF viewers may consume Escape inside their own
browsing context; the visible Exit preview button remains available. The wrapper
does not inspect their content or bypass their keyboard behavior.

Live example: `/admin/design-system`, Full-screen media preview specimen.

---

## 5. Component contract

Every shared UI component must:

1. **Merge classes with `cn()`** from `components/ui/lib/utils.ts` (`twMerge(clsx(...))`). Never `filter(Boolean).join(" ")` — asserted by `tests/ui-class-merging.test.mjs`.
2. **Accept and forward `className`** plus the native element props.
3. **Emit a `data-slot="<name>"`** so parents can target it structurally (`WorkbenchShell` relies on this).
4. **Express variants one of two ways, consistently:**
   - `cva()` when the variant changes many classes and callers need `VariantProps` — used by `button`, `badge`, `button-group`, `input`, `select`, `radio-group`, `tabs`, `alert`, `empty`, `field`.
   - plain prop → `data-*` attribute + `group-data-[…]` selectors — used by `switch`, `avatar`, `alert-dialog`, `IconTile`, `StatusBadge`, `AlertBanner`.
     Do not invent a third mechanism.
5. **Use only semantic tokens.** No hex, no `rgb()`, no arbitrary colour.
6. **Use relative imports within `components/ui`**; application consumers use the `@/components/ui` alias.
7. **Ship its accessibility**, per below.

### Accessibility baseline (WCAG 2.2 AA target)

- Interactive surfaces are real `<a>` / `<button>` — `CatalogCard` and `FileUploadZone` already are. A `div` with `onClick` is a defect.
- Focus is visible everywhere via the global `outline-ring/50`; never `outline: none` without a replacement.
- Labels are programmatic: use `Field` (it wires `id` / `aria-describedby` / `aria-errormessage` / `aria-invalid`).
- Live regions: errors `role="alert"`, progress/status `role="status"` + `aria-live="polite"` — `AlertBanner` and `ProcessingStatus` set these for you.
- Current page/state: `aria-current="page"` (`SidebarNavItem`, `ToolNav`).
- Drag-and-drop has a keyboard path (`OrderableList` ships a `KeyboardSensor` + announcements).
- Icon-only controls carry `aria-label` (`RemoveFileAction`).
- `ToolPageShell` renders a skip link (`Skip to tool workspace` → `#tool-workspace`).
- Respect `prefers-reduced-motion` — `app/globals.css` already collapses transitions; do not override it.

---

## 6. Composition patterns

Presentation rules only. Copy, routes, and status logic stay in the app.

**Cards.** `Card` for passive content, `SectionCard` for a grouped page section, `CatalogCard` when the whole surface is one destination. Shell is always `bg-card`, `border-border`, `rounded-xl`, `shadow-lg`, 24px padding. Structure: optional icon tile → title → short description → action. In equal-height grids use a column layout with `mt-auto` on the action; never fixed heights.

**Emphasized panels.** At most one per section. `bg-surface-ink` / `text-on-ink`, `rounded-3xl`, `p-8 md:p-10`, restrained shadow. Inner column narrower than the panel: optional eyebrow → headline → concise copy → scannable benefits → one primary action. Decorative shapes must be low contrast, behind content, `pointer-events-none`, `aria-hidden`.

**Footers.** `ProductFooter` only: `bg-surface-ink`, 56px top / 32px bottom, 300px brand column, labeled utility columns. `text-on-ink` for brand and headings, `text-on-ink-muted` for descriptions and links, 10% white divider above copyright. Stacks on narrow screens with real links and visible hover/focus.

**Tool pages.** `ToolPageShell` → `ToolPageIntro` → workbench card → `ToolSupportSections` / `HowItWorks` → related tools. The 4-part skeleton and per-family workbench specs are in `plans/tool-page-design-spec.md`.

---

## 7. Governance

### Ownership rule — what belongs here

A component belongs in `@/components/ui/index.tsx` when **the same presentation contract appears a third time** across product areas (paperwork / devtools / media / auth / admin). Below that bar it stays in the app's own component or route scope.

Currently app-local by decision:

- Paperwork editors, previews, editable financial rows, calculations, document workflows
- Devtools editor integrations and JSON workbench behaviour
- Auth account, session, and loading workflows
- Admin permissions, mutations, tables, and action groups

> The previous rule read "3 applications." The repo has one Next.js app (`app/`) using these shared components, so that bar could never be met. The threshold is **3 usages**, not 3 apps.

### Design ↔ code parity

`DESIGN_SYSTEM_COMPONENTS` in `components/ui/design-system-manifest.ts` is the canonical crosswalk: **60 reusable design nodes → 60 code implementations**, ids unique. Entry shape:

```ts
{ designId: "wm1rh", designName: "Button/Primary", implementation: "Button[default]" }
```

`implementation` uses three encodings: bare name (`IconTile`), `Component[variant]` (`Button[secondary]`), `Component[prop=value]` (`Input[size=lg]`).

Whenever a reusable design node is added, renamed, or replaced you must update the manifest **and** the hardcoded id list + count in `tests/design-system-alignment.test.mjs`. The parity detail table lives in `DESIGN_AUDIT.md`.

### Theming rule

App-specific content themes (e.g. invoice template colours) must not alter shared application chrome. Re-theme a subtree by redeclaring the bare `--*` vars on a scoped class — never by overriding `--color-*`.

### PR review checklist

- [ ] No hex / `rgb()` / arbitrary colour in the diff — semantic token used
- [ ] No new `tailwind.config.*`, no second `@import "tailwindcss"`
- [ ] Existing component reused rather than a lookalike rebuilt
- [ ] New shared component justified by 3 usages
- [ ] `cn()` used; `className` forwarded; `data-slot` set
- [ ] Variants via `cva` or `data-*`, matching the file's existing mechanism
- [ ] Interactive elements are real `<a>`/`<button>`, focus visible, labels wired via `Field`
- [ ] Manifest + alignment test updated if a design node changed
- [ ] `/admin/design-system` still renders the change correctly
- [ ] `pnpm test` and `pnpm lint` green

---

## 8. Contributing

### Add a component

1. Confirm it does not already exist — search `components/ui/index.tsx` exports and the manifest first.
2. Confirm the 3-usage bar. Below it, keep it app-local.
3. Create `components/ui/components/<name>.tsx`; follow the [component contract](#5-component-contract).
4. Export from `components/ui/index.tsx` (or import a rarely used component directly from its file).
5. Render it on `/admin/design-system` — every variant and every size.
6. If it maps to a `design.pen` node: add the manifest entry, bump the count and id list in `tests/design-system-alignment.test.mjs`, add the row to `DESIGN_AUDIT.md`.
7. `pnpm test` → `pnpm lint`.

### Add or change a token

1. Add the bare var to `:root` in `components/ui/theme.css`, **and** the matching `--color-*` alias in `@theme inline`. Both, always — the alignment test checks token declarations verbatim.
2. Name it by role (`--status-danger-soft`), never by appearance (`--light-red`).
3. Update the token table in this file.
4. Changing an existing value: grep for it in `tests/design-system-alignment.test.mjs` and update the assertion in the same commit.

### Change a design node

1. Edit in Pencil (`designs/design.pen` / `SYSTEM.lib.pen`) — never hand-edit `.pen` files.
2. Update the matching `implementation` string in the manifest.
3. Update `DESIGN_AUDIT.md` parity notes.
4. Re-run `pnpm test`, then eyeball `/admin/design-system`.

**Design frames are placeholders for styling, not a feature spec.** Restyle to match a frame; never delete working controls because a frame omits them.

### Deprecate

No published versions, so no semver dance: keep the old export re-exporting the new one for one migration pass, migrate call sites, then delete the alias and its manifest entry in a follow-up commit.

---

## 9. Verification

```bash
pnpm test       # node --test tests/*.test.mjs
pnpm lint       # tsc --noEmit  (type-check only — there is no ESLint)
pnpm test:e2e   # playwright; needs DATABASE_URL, boots pnpm dev
```

| Check                 | File                                       | Enforces                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token + geometry lock | `tests/design-system-alignment.test.mjs`   | 12 exact token declarations in `theme.css`; exact hover/active hexes and size classes in `button`, `checkbox`, `input`, `select`, `radio-group`, `switch`, `tabs`; all 5 control sizes present on the showcase page; 17 named exports in `patterns.tsx`; manifest = 60 unique ids incl. a hardcoded list; `ToolPageShell` composition rules |
| Theme wiring          | `tests/frontend-config.test.mjs`           | `exports["./theme.css"]`; `@source "."` + `@theme {` present; `globals.css` import order; exactly one `tailwindcss` import repo-wide                                                                                                                                                                                                        |
| Class merging         | `tests/ui-class-merging.test.mjs`          | `index.tsx` uses `cn`, not string joins                                                                                                                                                                                                                                                                                                     |
| Full-screen preview   | `tests/e2e/media-preview.spec.ts`          | Caller content, focus containment, Escape/exit, reopening and focus restoration on `/admin/design-system`                                                                                                                                                                                                                                   |
| Runtime behaviour     | `tests/e2e/design-system-scrubber.spec.ts` | `ChapterScrubber` Gaussian falloff maths, active tick colour `rgb(26,26,26)`, preview geometry, on `/admin/design-system`                                                                                                                                                                                                                   |

These are **source-text assertions**, not rendering tests. They pin token _definitions_; they cannot stop a hardcoded hex being written in an app file. That gap is covered by review, not tooling.

---

## 10. Known gaps

Documented so nobody rediscovers them. Fix opportunistically; none is a blocker.

| Gap                                         | Detail                                                                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No token-drift enforcement                  | No ESLint, no CI, no hardcoded-hex scanner. A raw hex in `app/` passes every check.                                                                                                                                                       |
| `app/auth/styles.css` is outside the system | ~490 lines of hand-written `.auth-*` CSS with untokenized shadows, `88px`/`72px` navbar heights, `140ms` transitions, and the only two keyframes in the repo (`auth-spin`, `auth-pulse`).                                                 |
| `.platform-shell` is redundant              | `app/globals.css` re-declares 15 colour vars with values identical to `:root`. Deleting it should be a no-op — verify before removing.                                                                                                    |
| `radius-md` == `radius-lg`                  | Both `0.5rem`, so the "8 vs 12" convention is carried by `rounded-xl` alone.                                                                                                                                                              |
| No spacing or motion tokens                 | Spacing rides Tailwind defaults; durations/easings are literals in component files.                                                                                                                                                       |
| No tier-1 primitives                        | Semantic tokens hold raw hex directly, so there is no palette layer to retheme from. A 3-tier split (primitive → semantic → component) is the standard upgrade path if a second brand or dark mode is ever needed.                        |
| No dark mode                                | `color-scheme: only light` by design. Revisit only alongside the tier-1 split above.                                                                                                                                                      |
| Manifest count is hand-maintained           | The 60-id list is duplicated between the manifest and the test; they drift independently.                                                                                                                                                 |
| Open design gaps                            | `plans/tool-page-design-spec.md` lists 13 confirmed parity gaps (`UniversalWorkbench`, `ToolPage`, `SettingsPanel`, `Surfaces.tsx`, `ResultView`, `SourceResultWorkspace`, `FileProcessorWorkspace.tsx`, 21 media tool specs). |

---

## Saved tools

`SavedToolsProvider` wraps the application once. `SavedToolsTrigger` opens a 400px anchored desktop popover or a modal mobile bottom sheet; opening Saved never changes the route. `SaveToolButton` accepts a tool `href` and supports an `iconOnly` catalog variant. Catalog cards keep the save button in the top-right corner, outside the destination link, with room reserved in the header. Saved buttons use an accent background, primary-colored icon and outline, and a filled bookmark alongside `aria-pressed`.

Rows show tool identity, then a **filled bookmark button** using the same saved styling as catalog cards, then an **open arrow**. Both actions use shared buttons and hover/focus tooltips. The popover and mobile sheet omit storage-location information. Escape/outside dismissal restores trigger focus; mobile traps focus. Removal offers Undo, and storage/network failures expose retry without claiming success.

Guests store identifiers under `canopy.saved-tools.v1`. At sign-in, pending guest IDs are staged locally for that account and unioned into `user_preferences` (`user_id`, `key = saved_tools`, JSONB `value`, `updated_at`). Confirmed imports are cleared locally; failed imports remain account-scoped for retry. Account lists are never copied into guest storage on sign-out. The authenticated API derives ownership from the server session and locks the preference row during read/modify/write.

Schema deployment: `db/migration/0001-baseline/0008_user_preferences.sql`, included in `pnpm db:migrate 0001-baseline`. No dedicated bookmarks table or Saved page is used.

### Dropdown menu

`DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, and `DropdownMenuSub` / `DropdownMenuSubTrigger` / `DropdownMenuSubContent` use the shadcn Radix composition for action menus and nested flyouts. Reuse these for pointer, touch, keyboard navigation, and viewport collision handling. Blog selection actions demonstrate the nested tone menu.

`ActionMenuButton` maps Button sizes to the shared menu tiers: `xs` and `sm` use compact menus, `default` uses the standard menu tier, and `md` and `lg` use medium menus. Compact menus use 32px desktop rows, 13px labels, 14px icons, and compact padding; mobile and touch rows retain 44px targets. Give creation choices meaningful icons alongside their labels.

Use `ActionMenuButton` from `components/ui/index.tsx` for labeled action menus. Supply `primaryAction` only when the main button performs an immediate action and the arrow offers related alternatives; without it, the entire button opens the menu. Use `CreateMenuButton` for creation menus. Both are implemented in `components/ui/components/ActionMenuButton.tsx` and shown in the component library's Actions section. Feature-owned menu items retain their navigation, dialogs, permissions, and pending state. When a creation choice opens a modal, suppress menu focus restoration with `onCloseAutoFocus`, focus the modal's input, and restore `triggerRef` when the modal closes.

### Pagination

`Pagination` is the shared default for paged lists, matching Pencil node `quHuq`: 32px chevron controls, 36px numbered buttons, 6px gaps, and a primary current-page state. It sticks to the bottom of its scroll container by default. Keep it outside horizontally scrolling table wrappers. Use `page`/`pageCount` with `getPageHref` or `onPageChange`; cursor-backed lists supply their available links without inventing a total. Use `sticky={false}` when a containing layout already anchors the footer, and for inline specimens. Incremental load-more controls and document-viewer navigation serve different interactions.

### Admin page chrome

Admin pages use `app/admin/(protected)/components/AdminPageHeader.tsx`, which composes `ToolPageHeader` with compact spacing and no eyebrow or bottom divider. `AdminFilters` renders controls directly on the page without an enclosing card, border, background, or padding. Preserve each input's own border and focus treatment.

The basic template editor, manage, and preview pages use the route-owned `app/admin/(protected)/templates/components/TemplatePageHeader.tsx` to match Manage navigation. It composes shared `BackButton`, `H1`, `StatusBadge`, and `Caption` with a title, status, description, and page-specific actions; the default back destination is Templates, with optional `backHref` and `backLabel` overrides. Import it directly from the templates route rather than the shared UI barrel. The component library's Actions section includes an actual instance.

Admin listings use `app/admin/(protected)/components/AdminListing.tsx` for the shared bordered surface, scrollable body, and separate pagination footer. The containing page supplies bounded height; pagination never overlays rows. Use shared table typography rather than page-specific uppercase headings or row padding. Numbered list queries return total/page/pageCount so both endpoints are actionable.

`TabsList variant="pills"` is the compact result-view switcher: a 28px muted track, rounded 24px tabs with extended pointer targets, and a solid primary fill with contrasting text for the selected view. Use it with `TabsContent` for CSV Raw/Table or generated HTML/Markdown Raw/Preview views; keyboard arrows switch the active tab. HTML table previews reuse the shared `Table`; Markdown results reuse `MarkdownPreview` and `RichContent`. Copy and download preserve the original source in either view.

Structured data results can supply `jsonPreview` to offer Raw/Tree using the shared read-only JSON renderer. The preview has no editing or separate export controls; the result header owns copy/download of the original format. Only structured values get a Tree tab. Bound large previews, label partial data, and omit the alternate view when it would lose numeric precision.

Markdown result previews retain document padding and normal wrapping by default. Table-only tools opt into flush edges, nonwrapping cells, and sticky headers within the table's scroll area with `previewLayout: "table"` in their own definition; do not change the shared default for one page.

For CSV to Table, **Raw** renders the generated HTML in `SandboxedHtmlPreview` with the browser's native table styling and nonwrapping cells; wide tables scroll horizontally. **Preview** uses the shared `Table`. Both views preserve the original HTML for copy and download, including the complete artifact when a large result is truncated.
