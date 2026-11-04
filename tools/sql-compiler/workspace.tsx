"use client";

import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { CodeEditor } from "@/components/content/CodeEditor";
import { SplitStack } from "@/components/Stacks";
import { WorkspaceSurface } from "@/components/Surfaces";
import { readTextFileForEditor } from "@/lib/tool-framework/textFileInput";

import { downloadResultContent, ResultActions } from "@/components/ResultView";
import { ScrollRegion, Stack } from "@/components/Stacks";
import type { WorkspaceProps } from "@/components/ToolWorkspace";
import {
  Button,
  Muted,
  Select,
  Strong,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  ToolActionButton,
  toast,
} from "@/components/ui/index.tsx";
import type { ToolResult } from "@/lib/tool-framework/result";
import { prewarm } from "./run";
import { SQL_ENGINES, splitStatements, toEngine, type SqlEngine, type SqlOutcome, type SqlResultSet } from "./script";

function outcomeOf(result: ToolResult | null): SqlOutcome | null {
  if (result?.render !== "json-tree") return null;
  const value = result.value as Partial<SqlOutcome> | null;
  return value && Array.isArray(value.sets) && Array.isArray(value.writes) ? (value as SqlOutcome) : null;
}

/** EXPLAIN QUERY PLAN rows are [id, parent, notused, detail]; indent each step under its parent. */
function PlanView({ set }: { set: SqlResultSet }) {
  const t = useTranslations("Tool.runtime");
  const depth = new Map<string, number>([["0", -1]]);
  const steps = set.rows.map(([id, parent, , detail]) => {
    const level = (depth.get(parent ?? "0") ?? -1) + 1;
    depth.set(id ?? "", level);
    const text = detail ?? "";
    const [verb = "", target = ""] = text.split(" ");
    const clause = /\b(ORDER|GROUP|DISTINCT)\b/.exec(text)?.[1] ?? "";
    const gloss =
      verb === "SCAN"
        ? t("workspace.plan.scan", { target })
        : verb === "SEARCH"
          ? t("workspace.plan.search", { target })
          : text.startsWith("USE TEMP B-TREE")
            ? t("workspace.plan.temp", { clause })
            : null;
    return { level, text, gloss, key: id ?? "" };
  });
  return (
    <Stack className="min-h-0 flex-1" gap="sm">
      <Muted className="px-4 pt-3">{t("workspace.plan.summary", { count: steps.length })}</Muted>
      <ScrollRegion accessibleName={t("workspace.explainPlan")} className="min-h-0 flex-1">
        <ol className="space-y-2 px-4 pb-3">
          {steps.map((step, i) => (
            <li
              className="rounded-md border border-border bg-muted/30 px-3 py-2"
              key={`${step.key}-${i}`}
              style={{ marginLeft: `${step.level * 20}px` }}
            >
              <div className="flex items-baseline gap-2">
                <span aria-hidden="true" className="text-xs font-medium tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <code className="font-mono text-sm font-medium">{step.text}</code>
              </div>
              {step.gloss ? <Muted className="pl-4 pt-0.5">{step.gloss}</Muted> : null}
            </li>
          ))}
        </ol>
      </ScrollRegion>
    </Stack>
  );
}

/**
 * EXPLAIN text is one "QUERY PLAN" row per line: node lines (the first, then
 * "->" lines indented by depth) and detail lines such as "Filter: ..." under them.
 */
function PgPlanView({ set }: { set: SqlResultSet }) {
  const t = useTranslations("Tool.runtime");
  const steps: { level: number; text: string; details: string[]; gloss: string | null }[] = [];
  for (const [raw] of set.rows) {
    const line = String(raw ?? "");
    const arrow = line.indexOf("->");
    if (steps.length > 0 && arrow < 0) {
      steps[steps.length - 1].details.push(line.trim());
      continue;
    }
    const text = (arrow < 0 ? line : line.slice(arrow + 2)).replace(/\s+\(cost=.*$/, "").trim();
    const scan = /^Seq Scan on (\S+)/.exec(text);
    const search = /^(?:Index Scan|Index Only Scan|Bitmap Heap Scan)(?: using \S+)? on (\S+)/.exec(text);
    const gloss = scan
      ? t("workspace.plan.scan", { target: scan[1] })
      : search
        ? t("workspace.plan.search", { target: search[1] })
        : /^(?:Incremental )?Sort\b/.test(text)
          ? t("workspace.plan.temp", { clause: "ORDER" })
          : /^(?:HashAggregate|GroupAggregate)\b/.test(text)
            ? t("workspace.plan.temp", { clause: "GROUP" })
            : /^Unique\b/.test(text)
              ? t("workspace.plan.temp", { clause: "DISTINCT" })
              : null;
    steps.push({ level: arrow < 0 ? 0 : Math.round(arrow / 6) + 1, text, details: [], gloss });
  }
  return (
    <Stack className="min-h-0 flex-1" gap="sm">
      <Muted className="px-4 pt-3">{t("workspace.plan.pgSummary", { count: steps.length })}</Muted>
      <ScrollRegion accessibleName={t("workspace.explainPlan")} className="min-h-0 flex-1">
        <ol className="space-y-2 px-4 pb-3">
          {steps.map((step, i) => (
            <li
              className="rounded-md border border-border bg-muted/30 px-3 py-2"
              key={i}
              style={{ marginLeft: `${step.level * 20}px` }}
            >
              <div className="flex items-baseline gap-2">
                <span aria-hidden="true" className="text-xs font-medium tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <code className="font-mono text-sm font-medium">{step.text}</code>
              </div>
              {step.gloss ? <Muted className="pl-4 pt-0.5">{step.gloss}</Muted> : null}
              {step.details.map((detail, d) => (
                <code className="block pl-4 pt-0.5 font-mono text-xs text-muted-foreground" key={d}>
                  {detail}
                </code>
              ))}
            </li>
          ))}
        </ol>
      </ScrollRegion>
    </Stack>
  );
}

function ResultGrid({ set, index, engine }: { set: SqlResultSet; index: number; engine: SqlEngine }) {
  const t = useTranslations("Tool.runtime");
  const capped = set.totalRows > set.rows.length;
  if (set.explain === "plan" && set.rows.length > 0)
    return engine === "postgres" ? <PgPlanView set={set} /> : <PlanView set={set} />;
  return (
    <Stack className="min-h-0 flex-1" gap="sm">
      {capped ? (
        <Muted className="px-4 pt-3">
          {t("workspace.showing", {
            shown: set.rows.length,
            total: set.totalRows,
            csvRows: t(set.csvComplete ? "workspace.csvAll" : "workspace.csvPartial"),
          })}
        </Muted>
      ) : null}
      {set.explain === "bytecode" ? <Muted className="px-4 pt-3">{t("workspace.explainBytecodeHelp")}</Muted> : null}
      {set.rows.length === 0 ? <Muted className="px-4 pt-3">{t("sql.noRows")}</Muted> : null}
      {/* One native scroller for both axes: the shared ScrollArea hides horizontal overflow, and the table's own wrapper would put its scrollbar at the bottom of a tall table. */}
      <div
        aria-label={t("workspace.table", { n: index + 1, line: set.line })}
        className="min-h-0 flex-1 overflow-auto overscroll-contain [&_[data-slot=table-container]]:overflow-visible"
        role="region"
        tabIndex={0}
      >
        <Table className="min-w-full">
          <TableHeader>
            <TableRow>
              {set.columns.map((column, c) => (
                <TableHead key={c}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {set.rows.map((row, r) => (
              <TableRow key={r}>
                {row.map((cell, c) => (
                  <TableCell className="align-top whitespace-pre-wrap break-words" key={c}>
                    {cell === null ? (
                      <span className="text-muted-foreground italic">{t("workspace.nullCell")}</span>
                    ) : (
                      cell
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Stack>
  );
}

/** Same chrome as the other compilers' result panel; the header's left side holds one tab per result table. */
function SqlResults({ error, result, running, spec }: Pick<WorkspaceProps, "error" | "result" | "running" | "spec">) {
  const t = useTranslations("Tool.runtime");
  const w = useTranslations("Workbench");
  const [tab, setTab] = useState("0");
  const outcome = outcomeOf(result);
  const sets = outcome?.sets ?? [];
  const index = Math.min(Number(tab) || 0, Math.max(sets.length - 1, 0));
  const active = sets[index];
  const failed = result?.verdict?.level === "error";
  const state = result ? "ready" : error ? "error" : running ? "loading" : "empty";
  const changed = outcome?.writes.reduce((sum, write) => sum + write.rows, 0) ?? 0;
  const returned = sets.reduce((sum, set) => sum + set.totalRows, 0);
  const stats = outcome
    ? [
        { label: t("workspace.info.statements"), value: String(outcome.statements) },
        { label: t("workspace.info.time"), value: t("workspace.info.ms", { ms: Math.round(outcome.durationMs) }) },
        { label: t("workspace.info.returned"), value: String(returned) },
        ...(changed > 0 ? [{ label: t("workspace.info.changed"), value: String(changed) }] : []),
      ]
    : [];
  const csv = active
    ? ({ render: "text", text: active.csv, downloadName: `sql-result-${index + 1}.csv` } as const)
    : null;

  return (
    <Tabs className="h-full min-h-0" onValueChange={setTab} value={String(index)}>
      <WorkspaceSurface
        actions={
          result ? (
            <>
              {stats.length > 0 ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={stats.map((stat) => `${stat.label}: ${stat.value}`).join(", ")}
                        className="text-muted-foreground"
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <Info aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
                        {stats.map((stat) => (
                          <div className="contents" key={stat.label}>
                            <dt className="opacity-80">{stat.label}</dt>
                            <dd className="text-right font-medium">{stat.value}</dd>
                          </div>
                        ))}
                      </dl>
                      <div className="mt-2 max-w-64 space-y-1 opacity-80">
                        {outcome && outcome.setsOmitted > 0 ? (
                          <p>{t("sql.summaryOmitted", { count: outcome.setsOmitted })}</p>
                        ) : null}
                        {sets.length > 0 ? <p>{t("workspace.nullHint")}</p> : null}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
              <ResultActions canCopy canDownload result={csv} />
            </>
          ) : undefined
        }
        className="h-full"
        purpose="result"
        state={state}
        stateDescription={error ?? (running ? spec.labels.running : spec.labels.empty)}
        title={
          sets.length > 0 ? (
            <TabsList
              aria-label={t("workspace.tables")}
              className="h-[50px] gap-0 border-b-0 normal-case tracking-normal"
            >
              {sets.map((set, i) => (
                <TabsTrigger
                  className="h-full py-0 first:pl-0 group-data-[orientation=horizontal]/tabs:after:!bottom-0"
                  key={i}
                  value={String(i)}
                >
                  {`${w("result")} ${i + 1}`}
                  <span
                    aria-label={t("workspace.rowCount", { count: set.totalRows })}
                    className="rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground [[data-state=active]_&]:bg-success-soft [[data-state=active]_&]:text-success"
                  >
                    {set.totalRows}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          ) : (
            (spec.labels.result ?? w("result"))
          )
        }
      >
        {failed ? (
          <div className="space-y-1 px-4 pt-3">
            <Strong className="text-destructive">{result?.verdict?.label}</Strong>
            {result?.verdict?.detail ? <Muted>{result.verdict.detail}</Muted> : null}
          </div>
        ) : null}
        {result && !failed && sets.length === 0 ? (
          <Muted className="px-4 pt-3">
            {changed > 0 ? t("sql.noOutputChanged", { count: changed }) : t("sql.noOutput")}
          </Muted>
        ) : null}
        {active ? <ResultGrid engine={outcome?.engine ?? "sqlite"} index={index} set={active} /> : null}
      </WorkspaceSurface>
    </Tabs>
  );
}

export default function SqlCompilerWorkspace(props: WorkspaceProps) {
  const t = useTranslations("Tool.runtime");
  const w = useTranslations("Workbench");
  const { input, onInputChange, onSettingChange, primaryAction, onToolbarActionsChange } = props;
  const engine = toEngine(props.settings.engine);
  const engineField = props.spec.settings.fields.engine;
  const engineChoices = engineField?.kind === "select" ? engineField.choices : [];
  const seeded = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(input);
  latest.current = input;
  const actionRef = useRef(primaryAction);
  actionRef.current = primaryAction;
  const starter = props.spec.content.examples?.[0]?.text ?? "";
  const inputLabel = props.spec.input.kind === "text" ? props.spec.input.label : "SQL";
  const maxBytes = props.spec.input.kind === "text" ? (props.spec.input.maxLength ?? 65_536) : 65_536;
  const running = primaryAction?.running ?? false;
  const runnable = Boolean(primaryAction) && !primaryAction?.disabled;

  // The editor starts with a runnable script so the first click on Run works.
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (!latest.current.text && latest.current.files.length === 0) onInputChange({ ...latest.current, text: starter });
  }, [onInputChange, starter]);

  // Load the chosen engine once the page is idle so the first Run starts at once; failures surface on Run.
  useEffect(() => {
    const warm = () => prewarm(engine);
    const idle = (window as Partial<Window>).requestIdleCallback;
    if (idle) {
      const id = idle.call(window, warm);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 1_000);
    return () => window.clearTimeout(id);
  }, [engine]);

  // A scoped run travels in the input's secondary channel as "start:end"; the run waits for the input change to settle.
  const [pendingRun, setPendingRun] = useState(false);
  const runScope = (scope: string) => {
    if (actionRef.current?.disabled || actionRef.current?.running) return;
    onInputChange({ ...latest.current, files: [], secondary: scope });
    setPendingRun(true);
  };
  const run = () => runScope("");
  useEffect(() => {
    if (!pendingRun) return;
    setPendingRun(false);
    // One tick later: the runtime aborts any run started in the same commit as an input change.
    window.setTimeout(() => actionRef.current?.onRun(), 0);
  }, [pendingRun]);
  const cancel = () => actionRef.current?.onCancel?.();

  const verdictLine = !running && props.result?.verdict?.level === "ok" ? props.result.verdict.label : undefined;
  useEffect(() => {
    onToolbarActionsChange?.({
      primaryActionInWorkspace: true,
      status: verdictLine,
      before: running ? (
        <Button aria-busy="true" onClick={cancel} size="xs" type="button" variant="outline">
          {w("cancel")}
        </Button>
      ) : (
        <Button disabled={!runnable} onClick={run} size="xs" type="button">
          {props.spec.trigger.mode === "manual" ? props.spec.trigger.actionLabel : "Run"}
        </Button>
      ),
    });
    return () => onToolbarActionsChange?.(null);
    // run/cancel read the latest primaryAction through a ref.
  }, [onToolbarActionsChange, props.spec.trigger, running, runnable, verdictLine, w]);

  const upload = async (file: File) => {
    try {
      const loaded = await readTextFileForEditor(file, { maxEditableBytes: maxBytes, maxLength: maxBytes });
      onInputChange({ ...latest.current, files: [], text: loaded.text });
    } catch {
      toast.error(w("readFileFailed", { name: file.name }));
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDownCapture={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        event.stopPropagation();
        run();
      }}
    >
      <input
        accept=".sql,text/plain"
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
        ref={fileInput}
        tabIndex={-1}
        type="file"
      />
      <div aria-live="polite" className="sr-only" role="status">
        {running ? props.spec.labels.running : props.result?.verdict?.label}
      </div>
      <SplitStack className="min-h-0 flex-1" defaultSize={50} minSize={30} presentation>
        <WorkspaceSurface
          actions={
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToolActionButton
                    action="upload"
                    disabled={running}
                    iconOnly
                    onClick={() => fileInput.current?.click()}
                    type="button"
                  >
                    {w("upload")}
                  </ToolActionButton>
                </TooltipTrigger>
                <TooltipContent>{w("upload")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToolActionButton
                    action="download"
                    disabled={input.text === ""}
                    iconOnly
                    onClick={() => downloadResultContent(input.text, "text/plain", "query.sql")}
                    type="button"
                  >
                    {w("downloadFile")}
                  </ToolActionButton>
                </TooltipTrigger>
                <TooltipContent>{`${w("downloadFile")} (query.sql)`}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          className="h-full"
          meta={
            <div className="flex items-center gap-2">
              <Muted>query.sql</Muted>
              <Select
                aria-label={t("workspace.engine")}
                className="w-auto"
                disabled={running}
                onChange={(event) => onSettingChange("engine", toEngine(event.currentTarget.value))}
                size="xs"
                value={engine}
              >
                {SQL_ENGINES.map((value) => (
                  <option key={value} value={value}>
                    {engineChoices.find((choice) => choice.value === value)?.label ?? value}
                  </option>
                ))}
              </Select>
            </div>
          }
          purpose="editor"
          title={inputLabel}
        >
          <CodeEditor
            aria-label={inputLabel}
            className="h-full"
            ide
            language="sql"
            runActions={{
              find: (source) => splitStatements(source, engine).map(({ start, end }) => ({ from: start, to: end })),
              onRun: ({ from, to }) => runScope(`${from}:${to}`),
              onRunAll: run,
              onExplain: ({ from, to }, mode) => runScope(`${mode}:${from}:${to}`),
              labels: {
                run: t("workspace.runStatement"),
                runStatement: t("workspace.runStatement"),
                runSelection: t("workspace.runSelection"),
                runAll: t("workspace.runAll"),
                // PostgreSQL has no bytecode view; the menu then offers only the plan.
                explain: engine === "sqlite" ? t("workspace.explain") : undefined,
                explainPlan: t("workspace.explainPlan"),
                cut: t("workspace.cut"),
                copy: t("workspace.copy"),
                paste: t("workspace.paste"),
                selectAll: t("workspace.selectAll"),
              },
            }}
            maxLength={maxBytes}
            onChange={(text) => onInputChange({ ...latest.current, files: [], text })}
            showLineNumbers
            value={input.text}
          />
        </WorkspaceSurface>
        <SqlResults error={props.error} result={props.result} running={props.running} spec={props.spec} />
      </SplitStack>
    </div>
  );
}
