# Tool Architecture

## Scope

These instructions apply to `tools/**`.

`tools/` is the flat, application-owned home for every non-Paperwork tool:

```text
tools/<definition-key>/
```

Do not add app, category, or route nesting such as `tools/devtools/` or
`tools/media/`. The immediate folder name is the stable `definitionKey`.
Paperwork is separate and must not depend on this architecture.

Use `tools/json-viewer/` as the current reference for ownership and runtime
wiring, not as a template for every layout or local CSS class.

## Architecture

The reusable architecture is:

1. `components/UniversalWorkbench.tsx` for runtime-backed text/field tools, or
   `app/media/components/MediaWorkbench.tsx` for binary Media jobs.
2. The tool runtime for lifecycle, execution, validation, feedback, and
   recovery.
3. Flat reusable composition in `components/Stacks.tsx` and
   `components/Surfaces.tsx`, plus shared renderers, fields, and design-system
   controls.
4. A complete operation-specific workspace owned by each tool.

Do not create fixed layouts for every input/result permutation. A tool composes
small reusable stacks and surfaces into the workspace its operation actually
requires. Tool-specific editors, previews, comparisons, collections, and
direct-manipulation UI are allowed.

Media tools keep the proven worker/controller lifecycle shared and pass their
complete left workspace plus settings UI through `renderWorkspace` and
`renderOptions`. Do not create a provider, hook, execution file, or result file
per Media tool when the shared Media controller already owns that
responsibility.

Before implementation, identify the tool’s primary verb, manipulated object,
natural interaction, content geometry, settings, recovery path, result, and
final action. Do not default to JSON Viewer’s split view.

## Ownership

### Tool folder

The tool owns:

- stable `definitionKey`, `toolId`, and fallback `iconKey`;
- app, capabilities, input/settings contracts, and processing defaults;
- validation and execution logic;
- typed results, artifacts, and facts;
- commands such as format, repair, rotate, reorder, or generate;
- the complete workspace inside the universal workbench;
- operation-specific toolbar content and optional custom renderers;
- focused parity fixtures when needed.

### Platform

The platform owns:

- route composition and trusted definition resolution;
- product chrome, workbench frame, footer, and supporting sections;
- viewport height, outer responsive behaviour, and common boundaries;
- lifecycle transitions and visibility;
- debounce, cancellation, stale-result prevention, status, confirmation, undo,
  and recovery;
- reusable settings fields and result actions;
- accessibility and analytics conventions.

A tool workspace must not render another page shell, product header, footer,
support section, related-tools section, status bar, or viewport-height wrapper.

Do not add tool-specific branches, copy, URLs, or result assumptions to
`UniversalWorkbench`. Existing JSON-specific content there is transitional.
Generalize it through typed props or resolved page data before another tool
depends on it.

### Database and control plane

The database owns public slug, display name, description, effective `iconKey`,
category, keywords, catalog order, visibility, SEO, page copy, examples, FAQ,
limitations, privacy copy, and related tool IDs.

The tool spec (identity, input and settings metadata, labels, trigger, page
copy, examples) lives in `managed_tools.spec` and is edited in Admin. There is
no `definition.ts`. Every load and save passes `parseToolSpec`
(`lib/tool-framework/specSchema.ts`), and `clampSpecLimits` caps sizes to
`system_limits`; a row with an invalid spec drops out of the public catalogue.

`iconKey` is a validated string from a closed shared icon registry, never a
React component or arbitrary import name. Unknown keys fail validation and fall
back safely.

Code owns executable and security-sensitive behaviour. The run file is chosen
by the folder (`tools/<definitionKey>/run*.ts`), never by stored data. Database
data must never select a React component, import path, runner, renderer, or
executable expression.

### Public translations

Store authored translations on the existing `managed_tools.translations` JSONB
record. The public resolver returns only a complete, published locale and sends
only that tool's selected messages to its client provider.

Spec labels, options, page copy and SEO fields are extracted automatically.
For custom UI, declare English messages in the spec's `messages`, then use
`useTranslations("Tool.runtime")` in the workspace. Use native ICU `{name}` and
plural messages; keep complete sentences together. Execution adapters can return
`labelMessage`, `detailMessage`, `titleMessage`, or structured `ToolError` details
so the shared host formats display metadata after execution. Never translate
identifiers, enum values, source code, user data, or artifact bytes, and never
branch on a translated label.

Message keys change with the spec in Admin; saving it syncs English and sends
other languages whose key set changed back to draft. Admin's translation editor
picks up the current contract automatically; no per-tool editor is needed.
Translations live only in the database — there are no `translations.json` files
for tools.

## Identity and Resolution

Keep these separate:

- `definitionKey`: immutable, code-owned, equal to the folder name;
- `toolId`: immutable cross-system identity;
- `publicSlug`: database-owned route value within an app.

Resolution is:

```text
app + publicSlug
  -> control-plane record
  -> trusted definitionKey
  -> registered tools/<definitionKey>
```

Never dynamically import from a database slug, assume the slug equals the
definition key, rename a folder after a slug change, or branch on a tool key in
an app route.

Until generated registries replace the bridge, register client tools explicitly
in `tools/client-registry.ts` by `definitionKey`. The registry contains imports
and lookup only—no routing, metadata, execution, or feature logic.

## Folder Responsibilities

Use only the files the tool needs:

```text
tools/<definition-key>/
  run.ts | run.worker.ts | run.server.ts
  icon.svg
  execution.ts
  result.ts
  workspace.tsx
  <ToolName>Tool.tsx
```

This is a responsibility map, not mandatory scaffolding. Do not create empty
files, one-use wrappers, local barrels, or speculative adapters.

### `execution.ts`

- Contains pure logic or a narrow environment-specific adapter.
- Accepts typed input/settings and returns a typed result.
- Does not import React, workspaces, runtime hooks, or presentation state.
- Does not return JSX, CSS classes, layout data, or visibility flags.
- Validates untrusted input at its system boundary.
- Honours `AbortSignal` when its async work is cancellable.

### `result.ts`

- Defines the smallest truthful result contract.
- Uses discriminated unions when success and domain failures differ.
- Avoids `any`, `details?: unknown`, arbitrary renderer payloads, and UI-shaped
  data.
- Types artifacts, facts, warnings, and recovery information explicitly.

### `workspace.tsx`

- Owns the complete operation workspace.
- Reads and updates state through `useToolRuntime`, or through the
  `MediaWorkspaceController` render argument for Media tools.
- Composes shared stacks, surfaces, renderers, fields, and UI components.
- May contain operation-specific UI when generic fields cannot represent the
  real interaction.
- Does not import `execution.ts`; it invokes runtime commands.
- Does not duplicate lifecycle, result, error, confirmation, or undo state.
- May keep transient presentation state such as selection or an open search.
- A Media tool normally composes `MediaWorkbench` directly in this file; it
  does not need a separate `<ToolName>Tool.tsx` wrapper.

### `<ToolName>Tool.tsx`

- Is the client composition boundary.
- Builds the typed `ToolRuntimeSpec`.
- Wires definition, execution, commands, toolbar, workspace, and optional status
  metadata into `UniversalWorkbench`.
- Verifies the expected `definitionKey`.
- Does not recreate route or page-shell logic.

## Runtime Rules

Use the shared lifecycle:

- `empty`;
- `ready`;
- `invalid`;
- `running`;
- `failed`;
- `completed`.

Extend it only for a real cross-tool state that cannot fit this contract.

The runtime spec declares initial values, emptiness, validation, live/manual
trigger, debounce, execution, and commands. The provider owns aborting previous
runs, ignoring stale completions, clearing obsolete results, transitions,
notices, errors, facts, artifacts, confirmation, and undo.

Tools declare capabilities and return typed outcomes. Do not add per-tool
`showDownload`, `showProgress`, `showError`, or `showResult` flags. Visibility
comes from lifecycle, capabilities, and compatible result data.

Use runtime commands for source mutations. Destructive commands require shared
confirmation and recovery; do not use `window.confirm` or a tool-local modal.
Validation issues should identify their target and, when applicable, field ID,
line, and column.

## Workspace Composition

Prefer:

- `Stack` for row or column flow, spacing, alignment, and wrapping;
- `SplitStack` only for accessible, resizable two-pane regions;
- `GridStack` for responsive repeated items;
- `OverlayStack` for a base layer plus interactive overlays;
- `ScrollRegion` for explicit bounded scroll ownership;
- `WorkspaceSurface` configured as `source`, `editor`, `result`, `preview`, or
  `inspector`, with shared empty/loading/error states;
- `FileIntakeSurface`, `FileQueueSurface`, `CollectionSurface`,
  `CanvasSurface`, `NavigatorSurface`, and `GeneratedListSurface` when their
  reusable behaviour is required.

Stacks own geometry, overflow, and responsive rearrangement. Surfaces own panel
semantics, headings, actions, and boundaries. Neither owns tool logic.

Do not create separate `RowStack` and `ColumnStack` components; configure
`Stack.direction`. A static two-column arrangement can also use `Stack`.
`SplitStack` remains separate because it composes the shared shadcn Resizable
primitives with constraints, collapse/restore, responsive fallback, and
optional size persistence. Do not recreate pointer or keyboard resizing.

Add a shared stack or surface only for repeated geometry. Do not encode one
tool’s arrangement as a generic component or add boolean combinations that
recreate a layout catalogue.

The workspace must show the real source, editor, comparison, preview,
collection, canvas, or result. It fills the parent with `h-full`/`min-h-0` and
owns its scroll regions. Do not add `100vh`, `100dvh`, or navigation-height
calculations inside a tool.

Persistent processing options belong to the shared settings boundary when a
typed field can represent them. Direct controls may remain in the workspace
when they manipulate the visible object, such as tree expansion, crop handles,
or selection tools.

For Media tools, `MediaWorkbench` owns the one `ToolOptionsPanel` container.
`renderOptions` returns flat option content only: fields, checkboxes, compact
field grids, and `MediaOptionMessage` copy. It must not render another `Card`,
`ToolOptionsPanel`, `AlertBanner`, border, background, or padded panel. Job
errors, processing state, and results remain outside the options panel and are
rendered by the shared controller.

## Design System

Use `@/components/ui/index.tsx`, semantic tokens, the component showcase, and
`components/ui/DESIGN_SYSTEM.md`.

The design system owns control typography, dimensions, padding, radius, border,
colour, icon size, and interaction states. Tool code supplies label, icon,
handler, state, semantic variant, placement, and responsive visibility.

Resolve a definition or database `iconKey` through one shared typed icon
registry. Do not import Lucide components into every catalog, route, admin
screen, or tool definition and rebuild separate `TOOL_ICONS` maps.

Do not reconstruct a shared button, input, select, textarea, badge, card, or
other control with local utility classes.

Before writing an interactive primitive, check the installed
`components/ui/components` controls and the shadcn registry. Add the official
shadcn component to `@/components/ui/index.tsx` when it already provides the required
behaviour. Current examples are Resizable for split panes, Scroll Area for
bounded scrolling, and Alert Dialog for destructive confirmation.

Button rules:

- text buttons are content-width;
- do not give text buttons fixed widths to equalize labels;
- icon-only buttons may use fixed square dimensions;
- full width is allowed only when the flow requires it;
- compact toolbar actions use the shared compact-action pattern;
- local classes control placement or wrapping, not visual styling.

If the approved design needs a missing semantic pattern, add or update it in the
shared design system and its showcase before consuming it. Do not patch each
tool separately. Promote a repeated pattern only when both appearance and
responsibility match.

## Accessibility and Responsive Behaviour

- Name every workspace region and icon-only action accurately.
- Use toolbar semantics for grouped tool actions.
- Connect errors to inputs and move focus to actionable problems.
- Preserve keyboard access, sensible focus restoration, and recovery.
- Keep compact visible controls accessible without visually inflating them.
- Define one scroll owner per bounded region.
- Prevent horizontal page overflow.
- Preserve operation order, status, and final actions after reflow.

Do not hide required functionality on small screens without an equivalent
reachable control.

## Migration

Migrate one tool vertically:

1. Inventory legacy inputs, settings, behaviour, output, errors, and actions.
2. Define the operation model and ownership.
3. Create `tools/<definition-key>/`.
4. Move pure logic and add typed input/settings/result contracts.
5. Compose the truthful tool-owned workspace.
6. Register by stable `definitionKey`.
7. Prove legacy parity with focused fixtures.
8. Verify all lifecycle, responsive, and recovery states.
9. Remove that tool’s legacy branch after cutover.

Do not leave two editable sources of truth. Any temporary compatibility path
must be explicit, tested, and removed at cutover. Do not broaden one migration
into unrelated cleanup.

## Verification

Every migrated tool needs focused coverage for:

- folder, `definitionKey`, and `toolId` alignment;
- required `iconKey` validity and shared-registry resolution;
- server-safe definition imports;
- pure execution and edge cases;
- validation and settings normalization;
- trigger behaviour and stale-run protection;
- typed results, facts, and artifacts;
- required interactions, recovery, and final actions;
- no tool-specific route dispatch;
- no executor import from the workspace;
- legacy parity until old code is removed.

For materially changed UI, inspect current screenshots and run the repo-local
`ui_validator` and `end_user_validator`. Resolve findings and re-run them.

Before handoff, follow the root requirements for relevant tests, `pnpm test`,
`pnpm lint`, `pnpm build` when applicable, `git diff --check`, and
`git status --short`.

## Completion Checklist

- Flat folder named by stable `definitionKey`.
- Required fallback `iconKey` resolves through the shared registry.
- Trusted route-to-definition resolution.
- Execution separated from React.
- Strongly typed result.
- Tool owns the real workspace, not the page shell.
- No new tool branch in the universal workbench or route.
- Shared runtime owns lifecycle and recovery.
- Shared controls are used without local visual reconstruction.
- Text buttons remain auto-width.
- Empty, invalid, running, failed, completed, and recovery paths work.
- Metadata and related tools use resolved database content.
- Paperwork remains untouched.
- Parity, repository, UI, and end-user checks pass.
