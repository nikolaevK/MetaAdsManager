import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, EmptyState } from "@/components/ui";
import { hasRole } from "@/lib/auth/session";
import { getTemplateEditorContext } from "@/lib/queries/settings";
import { getWorkspace } from "@/lib/workspace";
import { SettingsSkeleton } from "../../section-header";
import { editableConfig } from "../editable-config";
import { EditorHeader } from "../editor-header";
import { TemplateForm } from "../template-form";

export const metadata: Metadata = { title: "New launch template" };

export default function NewTemplatePage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <NewTemplate />
    </Suspense>
  );
}

async function NewTemplate() {
  const { user } = await getWorkspace();
  if (!hasRole(user, "admin")) {
    return (
      <Card>
        <EmptyState icon={Lock} title="Admins only">
          Only admins can create launch templates.
        </EmptyState>
      </Card>
    );
  }
  const { clients, accounts } = await getTemplateEditorContext();
  return (
    <div className="flex flex-col gap-5">
      <EditorHeader
        title="New template"
        description="Set the defaults every launch built from this template starts with. Launches keep their own frozen copy."
      />
      <TemplateForm
        template={{ name: "", clientId: null, config: editableConfig({}) }}
        clients={clients}
        accounts={accounts}
        canEdit
      />
    </div>
  );
}
