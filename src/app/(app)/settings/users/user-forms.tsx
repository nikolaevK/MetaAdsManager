"use client";

import { KeyRound, UserPlus } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { FormFooter, useSettingsAction } from "@/components/settings-ui";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { SectionHeader } from "../section-header";
import { changeMyPassword, createUser, resetUserPassword, setUserDisabled, setUserRole } from "./actions";

type Errors = Record<string, string[] | undefined>;
const ROLE_OPTIONS = [
  { value: "admin", label: "Admin — settings, users, approve launches" },
  { value: "buyer", label: "Buyer — build launches, edit campaigns" },
  { value: "viewer", label: "Viewer — read only" },
];

/** Section header with the "Add user" action; the create form opens as a card below it. */
export function CreateUserForm({ minLength, title, description }: { minLength: number; title: string; description: string }) {
  const empty = { email: "", name: "", role: "buyer", password: "" };
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(empty);
  const [errors, setErrors] = useState<Errors>({});
  const { pending, run, error } = useSettingsAction({ inlineErrors: true });

  return (
    <>
      <SectionHeader
        title={title}
        description={description}
        actions={
          !open && (
            <Button variant="primary" onClick={() => setOpen(true)}>
              <UserPlus /> Add user
            </Button>
          )
        }
      />
      {open && (
        <Card className="animate-pop-in overflow-hidden">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              run(() => createUser(value), {
                onOk: () => {
                  setValue(empty);
                  setOpen(false);
                },
                onError: (s) => setErrors(s?.fieldErrors ?? {}),
              });
            }}
          >
            <CardHeader icon={UserPlus} title="Add a user" description="They can sign in right away with the temporary password you set here." />
            <div className="grid grid-cols-1 gap-4 p-5 @xl:grid-cols-2">
              <Field label="Name" htmlFor="nu-name" error={errors.name}>
                <Input id="nu-name" value={value.name} onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))} required maxLength={120} />
              </Field>
              <Field label="Email" htmlFor="nu-email" error={errors.email}>
                <Input id="nu-email" type="email" autoComplete="off" value={value.email} onChange={(e) => setValue((v) => ({ ...v, email: e.target.value }))} required />
              </Field>
              <Field label="Role" htmlFor="nu-role" error={errors.role}>
                <Select id="nu-role" value={value.role} onChange={(e) => setValue((v) => ({ ...v, role: e.target.value }))}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Temporary password" htmlFor="nu-password" hint={`At least ${minLength} characters. Share it securely.`} error={errors.password}>
                <Input
                  id="nu-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={minLength}
                  value={value.password}
                  onChange={(e) => setValue((v) => ({ ...v, password: e.target.value }))}
                  required
                />
              </Field>
            </div>
            <FormFooter error={error}>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                Create user
              </Button>
            </FormFooter>
          </form>
        </Card>
      )}
    </>
  );
}

export function UserRowActions({
  user,
  isSelf,
  minLength,
}: {
  user: { id: string; name: string; role: string; disabled: boolean };
  isSelf: boolean;
  minLength: number;
}) {
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const { pending, run } = useSettingsAction();
  const confirm = useConfirm();

  if (isSelf) return <span className="block text-right text-xs text-faint">Your account</span>;

  if (resetting) {
    return (
      <form
        className="flex w-full items-center justify-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => resetUserPassword({ id: user.id, password: newPassword }), {
            onOk: () => {
              setResetting(false);
              setNewPassword("");
            },
          });
        }}
      >
        <Input
          autoFocus
          type="password"
          aria-label={`New password for ${user.name}`}
          placeholder={`New password (${minLength}+ chars)`}
          autoComplete="new-password"
          minLength={minLength}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="h-8 min-w-0 flex-1 text-[13px] @3xl:w-56 @3xl:flex-none"
        />
        <Button type="submit" size="sm" variant="primary" disabled={pending || newPassword.length < minLength}>
          Set
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setResetting(false)}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <div className="w-28 shrink-0">
        <Select
          aria-label={`Role for ${user.name}`}
          value={user.role}
          disabled={pending}
          onChange={(e) => run(() => setUserRole({ id: user.id, role: e.target.value }))}
          className="h-8 text-[13px]"
        >
          <option value="admin">Admin</option>
          <option value="buyer">Buyer</option>
          <option value="viewer">Viewer</option>
        </Select>
      </div>
      <Button
        size="icon"
        variant="ghost"
        disabled={pending}
        onClick={() => setResetting(true)}
        aria-label={`Reset password for ${user.name}`}
        title="Reset password"
      >
        <KeyRound />
      </Button>
      <Button
        size="sm"
        variant={user.disabled ? "secondary" : "ghost"}
        disabled={pending}
        className={user.disabled ? undefined : "hover:bg-danger-soft hover:text-danger-ink"}
        onClick={async () => {
          const ok =
            user.disabled ||
            (await confirm({ title: `Disable ${user.name}?`, body: "They're signed out right away and can't log in until enabled again.", confirmLabel: "Disable user", tone: "danger" }));
          if (ok) run(() => setUserDisabled({ id: user.id, disabled: !user.disabled }));
        }}
      >
        {user.disabled ? "Enable" : "Disable"}
      </Button>
    </div>
  );
}

export function ChangePasswordForm({ minLength }: { minLength: number }) {
  const empty = { current: "", next: "", confirm: "" };
  const [value, setValue] = useState(empty);
  const [errors, setErrors] = useState<Errors>({});
  const { pending, run, error } = useSettingsAction({ inlineErrors: true });
  const mismatch = value.confirm.length > 0 && value.confirm !== value.next;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (mismatch) return;
        setErrors({});
        run(() => changeMyPassword({ current: value.current, next: value.next }), {
          onOk: () => setValue(empty),
          onError: (s) => setErrors(s?.fieldErrors ?? {}),
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 p-5 @2xl:grid-cols-3">
        <Field label="Current password" htmlFor="cp-current" error={errors.current}>
          <Input id="cp-current" type="password" autoComplete="current-password" value={value.current} onChange={(e) => setValue((v) => ({ ...v, current: e.target.value }))} required />
        </Field>
        <Field label="New password" htmlFor="cp-next" hint={`At least ${minLength} characters.`} error={errors.next}>
          <Input id="cp-next" type="password" autoComplete="new-password" minLength={minLength} value={value.next} onChange={(e) => setValue((v) => ({ ...v, next: e.target.value }))} required />
        </Field>
        <Field label="Confirm new password" htmlFor="cp-confirm" error={mismatch ? "Passwords don't match" : undefined}>
          <Input id="cp-confirm" type="password" autoComplete="new-password" value={value.confirm} onChange={(e) => setValue((v) => ({ ...v, confirm: e.target.value }))} required />
        </Field>
      </div>
      <FormFooter error={error}>
        <Button type="submit" variant="primary" disabled={pending || mismatch}>
          Change password
        </Button>
      </FormFooter>
    </form>
  );
}
