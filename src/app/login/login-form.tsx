"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { login } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, null);
  // React resets the form after the action runs. Keeping the submitted email as the field's default brings it
  // back after a failed attempt (the password clears), and leaves browser autofill in charge of the live value.
  const [email, setEmail] = useState("");
  return (
    <form action={action} onSubmit={(e) => setEmail(String(new FormData(e.currentTarget).get("email") ?? ""))} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@company.com"
          required
          autoFocus
          defaultValue={email}
          className="h-10"
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-10" />
      </Field>
      {state?.error && <Alert>{state.error}</Alert>}
      <Button type="submit" variant="create" size="lg" disabled={pending} className="mt-1 w-full">
        {pending ? <Loader2 className="animate-spin" /> : null}
        {pending ? "Logging in…" : "Log in"}
        {!pending && <ArrowRight />}
      </Button>
    </form>
  );
}
