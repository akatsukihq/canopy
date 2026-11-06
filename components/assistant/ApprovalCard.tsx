"use client";

import { useId, useState } from "react";
import { Button, CodeBlock, Field, Input } from "@/components/ui/index.tsx";
import { SyntaxHighlight } from "@/components/content/SyntaxHighlight";
import type { AssistantApproval } from "@/lib/assistant/types";

/** Shows the paused tool calls; the decision is recorded server-side, so the card survives reload. */
export function ApprovalCard({
  approval,
  pending,
  busy,
  onRespond,
}: {
  approval: AssistantApproval;
  /** False once the run is no longer waiting (decided, expired, or superseded). */
  pending: boolean;
  busy: boolean;
  onRespond: (approved: boolean, reason?: string) => void;
}) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const names = [...new Set(approval.calls.map((call) => call.toolName))].join(", ");
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-3" aria-label="Approval needed">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          {approval.decision === "approved"
            ? `You approved ${names}`
            : approval.decision === "rejected"
              ? `You rejected ${names}`
              : pending
                ? `The agent wants to run ${names}`
                : `${names} was not approved`}
        </p>
        <p className="text-caption text-muted-foreground">
          {approval.decision
            ? "The agent continued with your decision."
            : pending
              ? "It paused until you decide. Check the details below; nothing runs unless you approve."
              : "This request is no longer waiting. Ask again to retry."}
        </p>
      </div>
      {approval.calls.map((call) => (
        <div key={call.toolCallId} className="flex flex-col gap-1">
          <p className="text-caption text-muted-foreground">Details sent to {call.toolName}</p>
          <CodeBlock data-language="json">
            <SyntaxHighlight code={JSON.stringify(call.input ?? {}, null, 2)} language="json" />
          </CodeBlock>
        </div>
      ))}
      {pending && !approval.decision && (
        <>
          <Field htmlFor={reasonId} label="Reason (optional)" description="Shared with the agent if you reject.">
            <Input
              value={reason}
              maxLength={1000}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => onRespond(true)}>
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onRespond(false, reason)}>
              Reject
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
