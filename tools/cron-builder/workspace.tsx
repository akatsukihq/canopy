"use client";
import { useLocale, useTranslations as useToolTranslations } from "next-intl";

import { useId } from "react";

import { SyntaxHighlight } from "@/components/content/SyntaxHighlight";
import { ResultSurface } from "@/components/ResultSurface";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SplitStack, Stack } from "@/components/Stacks";
import type { WorkspaceProps } from "@/components/ToolWorkspace";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Field,
  H2,
  Input,
  Muted,
  P,
  ToolOptionsPanel,
} from "@/components/ui/index.tsx";
import { CRON_FIELDS, getCronFieldError, getScheduleSummary } from "./configuration";

const SYNTAX_EXAMPLES = [
  ["*", "Every minute"],
  ["1,15", "At minutes 1 and 15"],
  ["1-5", "At minutes 1 through 5"],
  ["*/15", "At minutes 0, 15, 30 and 45"],
] as const;

export default function CronBuilderWorkspace(props: WorkspaceProps) {
  const toolText = useToolTranslations("Tool.runtime");
  const locale = useLocale();
  const id = useId();
  const value = (key: (typeof CRON_FIELDS)[number]["key"]) =>
    String(props.settings[key] ?? props.spec.settings.fields[key]?.default ?? "*");
  const settingsSpec = {
    ...props.spec.settings,
    fields: Object.fromEntries(
      Object.entries(props.spec.settings.fields).filter(([key]) => !CRON_FIELDS.some((field) => field.key === key)),
    ),
  };

  return (
    <SplitStack className="h-full" defaultSize={75} minSize={75}>
      <Stack className="h-full overflow-y-auto">
        <Stack aria-label={toolText("workspace.edit_cron_schedule_7fdbcb")} className="shrink-0 px-6 pt-6" gap="md">
          <Stack aria-live="polite" aria-atomic="true" gap="xs">
            <H2 className="text-[28px] font-medium leading-tight">
              {getScheduleSummary(props.settings, toolText, locale)}
            </H2>
            <P className="text-muted-foreground">{toolText("workspace.in_the_timezone_f954eb")}</P>
          </Stack>

          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-5">
            {CRON_FIELDS.map(({ key, range }) => {
              const field = props.spec.settings.fields[key];
              const error = getCronFieldError(key, value(key), toolText, field.label);
              return (
                <Field
                  className="min-w-0"
                  description={error ? undefined : key === "dayOfWeek" ? toolText("workspace.weekdayRange") : range}
                  error={error}
                  htmlFor={`${id}-${key}`}
                  key={key}
                  label={field.label}
                >
                  <Input
                    autoCapitalize="off"
                    autoComplete="off"
                    disabled={props.disabled}
                    maxLength={"maxLength" in field ? field.maxLength : undefined}
                    onChange={(event) => props.onSettingChange(key, event.target.value)}
                    spellCheck={false}
                    value={value(key)}
                    variant="expression"
                  />
                </Field>
              );
            })}
          </div>

          <Accordion collapsible type="single">
            <AccordionItem value="syntax-help">
              <AccordionTrigger>{toolText("workspace.syntax_help_d0ddb5")}</AccordionTrigger>
              <AccordionContent>
                <Stack gap="sm">
                  <Muted>{toolText("workspace.in_the_minute_830478")}</Muted>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    {SYNTAX_EXAMPLES.map(([expression], index) => (
                      <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-3" key={expression}>
                        <dt className="font-mono text-code">
                          <SyntaxHighlight code={expression} language="cron" />
                        </dt>
                        <dd>
                          <P>{toolText(`workspace.syntax.${index}`)}</P>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Stack>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Stack>

        <div className="min-h-48 flex-1">
          <ResultSurface
            error={props.error}
            result={props.result}
            running={props.running}
            spec={props.spec}
            title={props.spec.labels.result}
            variant="panel"
          />
        </div>
      </Stack>

      <ToolOptionsPanel
        className="h-full overflow-y-auto bg-card p-[18px]"
        title={props.spec.optionsPanel?.title ?? toolText("workspace.settings")}
        variant="plain"
      >
        <SettingsPanel
          disabled={props.disabled}
          layout={props.spec.optionsPanel?.layout}
          onChange={props.onSettingChange}
          spec={settingsSpec}
          values={props.settings}
        />
        {props.spec.optionsPanel?.note ? <Muted>{props.spec.optionsPanel.note}</Muted> : null}
      </ToolOptionsPanel>
    </SplitStack>
  );
}
