import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReadOnlyNote } from "@/components/settings-ui";
import { Alert, Badge } from "@/components/ui";
import { hasRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { templateConfigSchema } from "@/lib/launch/spec";
import { getTemplateById, getTemplateEditorContext } from "@/lib/queries/settings";
import { getWorkspace } from "@/lib/workspace";
import { SettingsSkeleton } from "../../section-header";
import { editableConfig } from "../editable-config";
import { EditorHeader } from "../editor-header";
import { TemplateForm } from "../template-form";

export const metadata: Metadata = { title: "Launch template" };

export default function TemplatePage(props: PageProps<"/settings/templates/[id]">) {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <TemplateEditor params={props.params} />
    </Suspense>
  );
}

async function TemplateEditor({ params }: { params: PageProps<"/settings/templates/[id]">["params"] }) {
  const { id } = await params;
  const { user } = await getWorkspace();
  const canEdit = hasRole(user, "admin");
  const [template, { clients, accounts }] = await Promise.all([getTemplateById(id), getTemplateEditorContext()]);
  if (!template) notFound();
  const parsed = templateConfigSchema.safeParse(template.config);

  return (
    <div className="flex flex-col gap-5">
      <EditorHeader
        title={template.name}
        badge={
          parsed.success ? (
            <Badge tone="success" dot>
              Ready to launch
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              Incomplete
            </Badge>
          )
        }
        description={
          <>
            Last updated <span className="tabular">{formatDateTime(template.updatedAt)}</span>. Edits apply to future launches; existing
            launches keep their own frozen copy.
          </>
        }
      />
      {!canEdit && <ReadOnlyNote />}
      {!parsed.success && (
        <Alert tone="warning" title="This template is incomplete">
          It can&apos;t be used for launches until it&apos;s saved with valid settings: {parsed.error.issues[0]?.message}
        </Alert>
      )}
      <TemplateForm
        key={template.updatedAt}
        template={{ id: template.id, name: template.name, clientId: template.clientId, config: editableConfig(template.config) }}
        clients={clients}
        accounts={accounts}
        canEdit={canEdit}
      />
    </div>
  );
}
