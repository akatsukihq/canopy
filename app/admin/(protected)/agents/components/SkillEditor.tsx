"use client";

import { Field, Input, SectionCard, Textarea, toast, Toaster } from "@/components/ui/index.tsx";
import { skillInputSchema, type Skill } from "@/lib/agents/types.ts";
import { appHref } from "@/lib/routing/subdomains.ts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteSkill, saveSkill } from "../actions";
import { DeleteButton } from "./DeleteButton";
import { EditorHeader } from "./EditorHeader";
import { SaveActions } from "./SaveActions";

type SkillForm = { key: string; name: string; description: string; body: string };

export function SkillEditor({ skill, canEdit }: { skill: Skill | null; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState<SkillForm>({
    key: skill?.key ?? "",
    name: skill?.name ?? "",
    description: skill?.description ?? "",
    body: skill?.body ?? "",
  });
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<SkillForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const disabled = !canEdit || saving;

  async function save() {
    const parsed = skillInputSchema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      toast.error("Some fields need attention. See the messages beside each field.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveSkill(skill?.id ?? null, parsed.data);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success("Skill saved.");
      if (!skill) {
        router.replace(appHref(`/admin/agents/skills/${(result.data as Skill).id}`));
        return;
      }
      setSaved(form);
      router.refresh();
    } catch {
      toast.error("Unable to save the skill. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<string | null> {
    if (!skill) return null;
    const result = await deleteSkill(skill.id);
    if (!result.ok) return result.error;
    router.replace(appHref("/admin/agents/skills"));
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <Toaster position="top-right" />
      <EditorHeader
        actions={
          canEdit ? (
            <SaveActions
              dirty={dirty}
              onDiscard={() => {
                setForm(saved);
                setErrors({});
              }}
              onSave={save}
              saving={saving}
            >
              {skill ? (
                <DeleteButton
                  description="This permanently deletes the skill. It cannot be deleted while an agent uses it."
                  label="Delete skill"
                  name={skill.name}
                  onConfirm={remove}
                />
              ) : null}
            </SaveActions>
          ) : null
        }
        backHref={appHref("/admin/agents/skills")}
        backLabel="Back to skills"
        description={canEdit ? undefined : "You can view this skill but not change it."}
        title={skill ? skill.name : "New skill"}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        <SectionCard>
          <Field
            description="Shown in lists and pickers."
            error={errors.name}
            htmlFor="skill-name"
            label="Name"
            required
          >
            <Input
              disabled={disabled}
              maxLength={80}
              onChange={(e) => set({ name: e.target.value })}
              value={form.name}
            />
          </Field>
          <Field
            description="Lowercase letters, numbers and hyphens. The agent uses it to load this skill."
            error={errors.key}
            htmlFor="skill-key"
            label="Key"
            required
          >
            <Input disabled={disabled} maxLength={64} onChange={(e) => set({ key: e.target.value })} value={form.key} />
          </Field>
          <Field
            description={`${form.description.length}/300 — agents always see this. Say when the skill is useful so they know when to load it.`}
            error={errors.description}
            htmlFor="skill-description"
            label="Description"
            required
          >
            <Textarea
              className="min-h-[72px]"
              disabled={disabled}
              maxLength={300}
              onChange={(e) => set({ description: e.target.value })}
              value={form.description}
            />
          </Field>
          <Field
            description="Full instructions in Markdown. Loaded only when the agent asks for them."
            error={errors.body}
            htmlFor="skill-body"
            label="Body"
            required
          >
            <Textarea
              className="min-h-80"
              code
              disabled={disabled}
              onChange={(e) => set({ body: e.target.value })}
              value={form.body}
            />
          </Field>
        </SectionCard>
      </div>
    </div>
  );
}
