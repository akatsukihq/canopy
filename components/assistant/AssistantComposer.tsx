"use client";

import { createContext, useContext, useId, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Node, type JSONContent } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Bold, Bot, Italic, Link2, List, ListOrdered, TextCursorInput, X } from "lucide-react";
import { Button, Popover, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/index.tsx";
import { parseComposerContent } from "@/lib/assistant/composerDocument";
import type { AssistantAgent } from "./types";
import { AssistantEditorLinkForm } from "./AssistantLinkForm";
import styles from "./Assistant.module.css";

const AgentCatalog = createContext<readonly AssistantAgent[]>([]);

function AgentMention({ node, deleteNode, selected }: NodeViewProps) {
  const agent = useContext(AgentCatalog).find((entry) => entry.id === node.attrs.agentId);
  return (
    <NodeViewWrapper as="span" contentEditable={false} className={styles.agentSelection} data-selected={selected}>
      <Bot className="size-3.5" aria-label="Agent" />
      <span>{agent?.name ?? "Unavailable agent"}</span>
      <Button variant="ghost" size="icon-xs" aria-label="Remove agent" onClick={deleteNode}>
        <X aria-hidden="true" />
      </Button>
    </NodeViewWrapper>
  );
}

/** Same chip as an agent; the type icon (field vs bot) tells them apart. */
function FieldMentionView({ node, deleteNode, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" contentEditable={false} className={styles.agentSelection} data-selected={selected}>
      <TextCursorInput className="size-3.5" aria-label="Field" />
      <span>{node.attrs.label}</span>
      <Button variant="ghost" size="icon-xs" aria-label={`Remove field ${node.attrs.label}`} onClick={deleteNode}>
        <X aria-hidden="true" />
      </Button>
    </NodeViewWrapper>
  );
}

/** Agents add no text; a field mention reads as `@id` so the message names the field. */
function leafText(node: ProseMirrorNode) {
  if (node.type.name === "hardBreak") return "\n";
  if (node.type.name === "fieldMention") return `@${node.attrs.id}`;
  return "";
}

/** Agent labels are UI metadata, not part of the instruction sent to AI. */
function readDocument(doc: ProseMirrorNode) {
  const text = doc.textBetween(0, doc.content.size, "\n", leafText);
  let agentId: string | undefined;
  let agentOffset: number | undefined;
  doc.descendants((node, position) => {
    if (node.type.name === "agentMention") {
      agentId = node.attrs.agentId;
      agentOffset = textOffset(doc, position);
    }
  });
  return { text, agentId, agentOffset, content: doc.toJSON() as JSONContent };
}

function inlineText(text: string): JSONContent[] {
  return text
    .split("\n")
    .flatMap((line, index) => [
      ...(index ? [{ type: "hardBreak" }] : []),
      ...(line ? [{ type: "text", text: line }] : []),
    ]);
}

function documentContent(text: string, agentId?: string, agentOffset = 0): JSONContent {
  const offset = Math.max(0, Math.min(agentOffset, text.length));
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: agentId
          ? [
              ...inlineText(text.slice(0, offset)),
              { type: "agentMention", attrs: { agentId } },
              ...inlineText(text.slice(offset)),
            ]
          : inlineText(text),
      },
    ],
  };
}

function textOffset(doc: ProseMirrorNode, position: number) {
  return doc.textBetween(0, position, "\n", leafText).length;
}

function documentPosition(doc: ProseMirrorNode, offset: number, afterAgent = true) {
  let result = 1;
  doc.descendants((node, position) => {
    if (node.isTextblock && textOffset(doc, position + 1) <= offset) result = position + 1;
    if (node.isText) {
      const start = textOffset(doc, position);
      if (start <= offset) result = position + Math.min(offset - start, node.nodeSize);
    } else if (node.type.name === "hardBreak" && textOffset(doc, position + 1) <= offset) result = position + 1;
    else if (node.type.name === "fieldMention" && textOffset(doc, position) < offset) result = position + 1;
    else if (node.type.name === "agentMention" && textOffset(doc, position) <= offset)
      result = position + (afterAgent ? 1 : 0);
  });
  return result;
}

const ComposerDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "block+",
  addOptions() {
    return { onInvalid: () => {} };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (transaction) => {
          const valid =
            !transaction.docChanged ||
            (readDocument(transaction.doc).text.length <= 8000 && !!parseComposerContent(transaction.doc.toJSON()));
          if (!valid) queueMicrotask(this.options.onInvalid);
          return valid;
        },
      }),
    ];
  },
});
const Agent = Node.create({
  name: "agentMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ agentId: { default: null } }),
  // Agent identity can only be inserted through our picker, never from pasted HTML.
  parseHTML: () => [],
  renderHTML: ({ node }) => ["span", { "data-agent-id": node.attrs.agentId }, "Agent"],
  addNodeView: () => ReactNodeViewRenderer(AgentMention),
});

/** A field named with `@`: shows its label, reads as `@id` in the message. Only our picker inserts it. */
const FieldMention = Node.create({
  name: "fieldMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ id: { default: null }, label: { default: null } }),
  parseHTML: () => [],
  renderHTML: ({ node }) => ["span", { "data-field": node.attrs.id }, node.attrs.label],
  renderText: ({ node }) => `@${node.attrs.id}`,
  addNodeView: () => ReactNodeViewRenderer(FieldMentionView),
});

export type AssistantComposerHandle = {
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
  insertAgent: (id: string, start?: number, end?: number) => void;
  /** Replaces the typed `@query` (text offsets) with a field chip followed by a space. */
  insertMention: (id: string, label: string, start: number, end: number) => void;
  readonly value: string;
};

type Props = {
  ref?: Ref<AssistantComposerHandle>;
  id: string;
  commandsId: string;
  agents: readonly AssistantAgent[];
  value: string;
  content?: JSONContent;
  agentId?: string;
  agentOffset?: number;
  placeholder: string;
  expanded: boolean;
  activeDescendant?: string;
  describedBy?: string;
  onChange: (value: ReturnType<typeof readDocument>) => void;
  onCaret: (offset: number) => void;
  onKeyDown: (event: KeyboardEvent) => void;
};

export function AssistantComposer(props: Props) {
  const limitId = useId();
  const [linkOpen, setLinkOpen] = useState(false);
  const [limitError, setLimitError] = useState(false);
  const syncing = useRef(false);
  const syncedProps = useRef("");
  const current = useRef(props);
  current.current = props;
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        document: false,
        blockquote: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        link: { openOnClick: false },
        underline: false,
        trailingNode: false,
      }),
      ComposerDocument.configure({ onInvalid: () => setLimitError(true) }),
      Agent,
      FieldMention,
    ],
    content: parseComposerContent(props.content) ?? documentContent(props.value, props.agentId, props.agentOffset),
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (event.isComposing) return true;
        current.current.onKeyDown(event);
        return event.defaultPrevented;
      },
    },
    onUpdate: ({ editor }) => {
      if (!syncing.current) {
        setLimitError(false);
        current.current.onChange(readDocument(editor.state.doc));
      }
    },
    onSelectionUpdate: ({ editor }) =>
      current.current.onCaret(textOffset(editor.state.doc, editor.state.selection.from)),
  });

  useEffect(() => {
    if (!editor) return;
    const signature = JSON.stringify([props.value, props.agentId, props.agentOffset, props.content]);
    if (signature !== syncedProps.current) {
      syncedProps.current = signature;
      // Tiptap node views call flushSync, which React forbids inside an effect.
      queueMicrotask(() => {
        if (editor.isDestroyed) return;
        syncing.current = true;
        let state = readDocument(editor.state.doc);
        if (!props.value && !props.agentId && !props.content) {
          editor.chain().setMeta("addToHistory", false).setContent(documentContent(""), { emitUpdate: false }).run();
          state = readDocument(editor.state.doc);
        }
        const stored = parseComposerContent(props.content);
        if (stored && JSON.stringify(stored) !== JSON.stringify(state.content)) {
          const restored = editor.schema.nodeFromJSON(stored);
          const saved = readDocument(restored);
          if (
            saved.text === props.value &&
            saved.agentId === props.agentId &&
            (!props.agentId || saved.agentOffset === (props.agentOffset ?? 0))
          ) {
            editor.chain().setMeta("addToHistory", false).setContent(stored, { emitUpdate: false }).run();
            state = readDocument(editor.state.doc);
          }
        }
        if (state.text !== props.value) {
          // External actions can append slash queries or restore text without discarding existing marks.
          let start = 0;
          while (start < state.text.length && start < props.value.length && state.text[start] === props.value[start])
            start++;
          let oldEnd = state.text.length,
            newEnd = props.value.length;
          while (oldEnd > start && newEnd > start && state.text[oldEnd - 1] === props.value[newEnd - 1]) {
            oldEnd--;
            newEnd--;
          }
          editor
            .chain()
            .setMeta("addToHistory", false)
            .insertContentAt(
              {
                from: documentPosition(editor.state.doc, start),
                to: documentPosition(editor.state.doc, oldEnd),
              },
              inlineText(props.value.slice(start, newEnd)),
              { updateSelection: false },
            )
            .run();
          state = readDocument(editor.state.doc);
        }
        if (
          state.agentId !== props.agentId ||
          (props.agentId && state.agentOffset !== Math.min(props.agentOffset ?? 0, props.value.length))
        ) {
          const transaction = editor.state.tr.setMeta("addToHistory", false);
          editor.state.doc.descendants((node, position) => {
            if (node.type.name === "agentMention")
              transaction.delete(transaction.mapping.map(position), transaction.mapping.map(position + node.nodeSize));
          });
          if (props.agentId)
            transaction.insert(
              documentPosition(transaction.doc, props.agentOffset ?? 0),
              editor.schema.nodes.agentMention.create({ agentId: props.agentId }),
            );
          editor.view.dispatch(transaction);
        }
        syncing.current = false;
        const canonical = readDocument(editor.state.doc);
        if (
          (canonical.text || canonical.agentId || props.content) &&
          JSON.stringify(canonical.content) !== JSON.stringify(props.content)
        )
          current.current.onChange(canonical);
      });
    }
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          id: props.id,
          role: "combobox",
          "aria-label": "Message to assistant",
          "aria-multiline": "true",
          "aria-autocomplete": "list",
          "aria-expanded": String(props.expanded),
          ...(props.expanded ? { "aria-controls": props.commandsId } : {}),
          ...(props.activeDescendant ? { "aria-activedescendant": props.activeDescendant } : {}),
          "aria-describedby": [props.describedBy, limitError ? limitId : ""].filter(Boolean).join(" "),
          "data-empty-text": String(!props.value),
          "data-placeholder": props.placeholder,
          class: styles.inlineAgentComposer,
          style: `--composer-placeholder: ${JSON.stringify(props.placeholder)}`,
        },
      },
    });
  }, [
    editor,
    props.id,
    props.commandsId,
    limitId,
    props.value,
    props.content,
    props.agentId,
    props.agentOffset,
    props.expanded,
    props.activeDescendant,
    props.describedBy,
    props.placeholder,
    limitError,
  ]);

  useImperativeHandle(
    props.ref,
    () => ({
      focus: () => {
        editor?.commands.focus();
      },
      get value() {
        return editor ? readDocument(editor.state.doc).text : current.current.value;
      },
      setSelectionRange: (start, end) => {
        if (editor)
          editor.commands.setTextSelection({
            from: documentPosition(editor.state.doc, start),
            to: documentPosition(editor.state.doc, end),
          });
      },
      insertAgent: (id, start, end) => {
        if (!editor) return;
        const offset = start ?? textOffset(editor.state.doc, editor.state.selection.from);
        const transaction = closeHistory(editor.state.tr);
        if (start !== undefined && end !== undefined)
          transaction.delete(documentPosition(editor.state.doc, start), documentPosition(editor.state.doc, end));
        const mentions: number[] = [];
        transaction.doc.descendants((node, position) => {
          if (node.type.name === "agentMention") mentions.push(position);
        });
        for (const position of mentions.reverse()) transaction.delete(position, position + 1);
        const position = documentPosition(transaction.doc, offset);
        transaction.insert(position, editor.schema.nodes.agentMention.create({ agentId: id }));
        transaction.setSelection(TextSelection.create(transaction.doc, position + 1));
        editor.view.dispatch(transaction);
        editor.commands.focus();
      },
      insertMention: (id, label, start, end) => {
        if (!editor) return;
        const from = documentPosition(editor.state.doc, start);
        const transaction = closeHistory(editor.state.tr).delete(from, documentPosition(editor.state.doc, end));
        transaction.insert(from, [editor.schema.nodes.fieldMention.create({ id, label }), editor.schema.text(" ")]);
        transaction.setSelection(TextSelection.create(transaction.doc, from + 2));
        editor.view.dispatch(transaction);
        editor.commands.focus();
      },
    }),
    [editor],
  );

  return (
    <AgentCatalog.Provider value={props.agents}>
      <EditorContent editor={editor} />
      {limitError && (
        <p id={limitId} role="status" className="text-caption text-destructive">
          Shorten the message to 8,000 characters or simplify its formatting.
        </p>
      )}
      {editor && (
        <BubbleMenu
          editor={editor}
          pluginKey="composerFormatting"
          options={{ placement: "top", offset: 8 }}
          shouldShow={({ state, editor, element }) =>
            (editor.isFocused || element.contains(globalThis.document.activeElement) || linkOpen) &&
            !props.expanded &&
            !state.selection.empty &&
            !!state.doc.textBetween(state.selection.from, state.selection.to).trim()
          }
          className={styles.composerFormatting}
          role="toolbar"
          aria-label="Message formatting"
        >
          {[
            { label: "Bold", icon: Bold, action: () => editor.chain().focus().toggleBold().run() },
            { label: "Italic", icon: Italic, action: () => editor.chain().focus().toggleItalic().run() },
            { label: "Bullet list", icon: List, action: () => editor.chain().focus().toggleBulletList().run() },
            {
              label: "Numbered list",
              icon: ListOrdered,
              action: () => editor.chain().focus().toggleOrderedList().run(),
            },
          ].map(({ label, icon: Icon, action }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={label}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={action}
                >
                  <Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
          <Popover.Root
            open={linkOpen}
            onOpenChange={(open) => {
              if (open) {
                const { from, to } = editor.state.selection;
                editor.view.dispatch(
                  editor.state.tr.setSelection(
                    TextSelection.between(editor.state.doc.resolve(from), editor.state.doc.resolve(to)),
                  ),
                );
              }
              setLinkOpen(open);
            }}
          >
            <Popover.Trigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Edit message link"
                onMouseDown={(event) => event.preventDefault()}
              >
                <Link2 />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="z-50 w-72 rounded-lg border border-border bg-card p-3 shadow-md"
                side="top"
                sideOffset={8}
              >
                <AssistantEditorLinkForm editor={editor} onClose={() => setLinkOpen(false)} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </BubbleMenu>
      )}
    </AgentCatalog.Provider>
  );
}
