"use client";

import { SyntaxHighlight } from "@/components/content/SyntaxHighlight";
import { Button, Caption, CodeBlock, Field, Input, StatusBadge, toast } from "@/components/ui/index.tsx";
import type { ToolRunReport } from "@/lib/agents/toolRuntime";
import { useState } from "react";
import { testTool } from "../actions";
import { schemaTextError } from "./agentForm";
import { FormSection } from "./FormSection";
import { JsonEditor } from "./ToolDefinitionSections";
import { parseToolForm, type ToolForm } from "./toolForm";

const SCHEMA_TEXT = {
  freeform: "Freeform — no schema, the value was passed as-is.",
  passed: "Matched the output schema.",
  failed: "Did not match the output schema.",
} as const;

function Json({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const language = typeof value === "string" ? "text" : "json";
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <CodeBlock className="max-h-72 overflow-auto" data-language={language}>
        <SyntaxHighlight code={text} language={language} />
      </CodeBlock>
    </div>
  );
}

function Report({ report }: { report: ToolRunReport }) {
  const facts = [
    `${report.durationMs} ms`,
    report.httpStatus !== null ? `HTTP ${report.httpStatus}` : null,
    report.exitCode !== null ? `exit code ${report.exitCode}` : null,
  ].filter(Boolean);
  return (
    <div className="grid gap-3" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge variant={report.ok ? "success" : "danger"}>{report.ok ? "Succeeded" : "Failed"}</StatusBadge>
        <Caption className="text-muted-foreground">{facts.join(" · ")}</Caption>
      </div>
      <p className="text-sm">
        {report.ok
          ? "The model would receive the result below."
          : "The model would receive the error below and can retry or tell the person. Fix the setup if this is unexpected."}
      </p>
      {report.schema ? <p className="text-sm text-muted-foreground">{SCHEMA_TEXT[report.schema]}</p> : null}
      <Json label={report.ok ? "Result sent to the model" : "Error sent to the model"} value={report.result} />
      {report.parsed !== undefined ? (
        <Json label="Parsed value (before response path and schema)" value={report.parsed} />
      ) : null}
      {report.raw !== null ? <Json label="Raw response" value={report.raw} /> : null}
    </div>
  );
}

export function TestSection({
  form,
  canEdit,
  onInvalid,
  fields = form.inputs,
  toolId = null,
  shared = [],
}: {
  form: ToolForm;
  canEdit: boolean;
  onInvalid: (errors: Record<string, string>) => void;
  /** Input fields to fill in; an endpoint uses its connection's. */
  fields?: readonly { id: string; label: string; type: string; defaultValue: string | null }[];
  /** Saved tool whose stored shared secrets fill blank values. */
  toolId?: string | null;
  /** Secret ids with a shared value; blank uses it. */
  shared?: readonly string[];
}) {
  const [argsText, setArgsText] = useState("{}");
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ToolRunReport | null>(null);
  const argsError = schemaTextError(argsText);

  async function run() {
    const parsed = parseToolForm(form);
    if (!parsed.ok) {
      onInvalid(parsed.errors);
      toast.error("Fix the highlighted fields before testing.");
      return;
    }
    if (argsError) return;
    setRunning(true);
    try {
      const result = await testTool(parsed.input, { args: JSON.parse(argsText), inputs: values, toolId });
      if (result.ok) setReport(result.data);
      else {
        if (result.fieldErrors) onInvalid(result.fieldErrors);
        toast.error(result.error);
      }
    } catch {
      toast.error("The test could not run. Check your connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <FormSection
      description="Runs the form as it is now, unsaved changes included. Skips approval; values here are not stored."
      title="Test"
    >
      <Field
        description="Arguments as the model would send them."
        error={argsError}
        htmlFor="tool-test-args"
        label="Sample arguments"
      >
        <div>
          <JsonEditor
            className="h-36"
            disabled={!canEdit || running}
            label="Sample arguments"
            onChange={setArgsText}
            value={argsText}
          />
        </div>
      </Field>
      {fields.map((field, index) =>
        field.id ? (
          <Field
            description={
              shared.includes(field.id)
                ? "Blank uses the shared value."
                : field.defaultValue
                  ? `Blank uses the default: ${field.defaultValue}`
                  : undefined
            }
            htmlFor={`tool-test-input-${index}`}
            key={index}
            label={field.label || field.id}
          >
            <Input
              autoComplete="off"
              disabled={!canEdit || running}
              onChange={(e) => setValues({ ...values, [field.id]: e.target.value })}
              type={field.type === "secret" ? "password" : "text"}
              value={values[field.id] ?? ""}
            />
          </Field>
        ) : null,
      )}
      <div>
        <Button
          className="w-full"
          disabled={!canEdit || Boolean(argsError)}
          loading={running}
          onClick={run}
          type="button"
        >
          {running ? "Running…" : "Run test"}
        </Button>
      </div>
      {report ? <Report report={report} /> : null}
    </FormSection>
  );
}
