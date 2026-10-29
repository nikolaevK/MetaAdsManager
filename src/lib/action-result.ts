import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ForbiddenError } from "@/lib/auth/session";
import { ConfigError } from "@/lib/env";
import { MetaApiError, RateLimitedError } from "@/lib/meta/errors";

export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
} | null;

/** Converts thrown errors into a serialisable result; lets Next's redirect/notFound through. */
export function failure(err: unknown): ActionState {
  unstable_rethrow(err);
  if (err instanceof z.ZodError) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: z.flattenError(err).fieldErrors };
  }
  if (err instanceof ForbiddenError) return { ok: false, error: err.message };
  if (err instanceof MetaApiError) return { ok: false, error: `Meta: ${err.display}` };
  if (err instanceof RateLimitedError) {
    return { ok: false, error: `Meta rate limit reached. Try again after ${new Date(err.retryAt).toLocaleTimeString()}.` };
  }
  if (err instanceof UserError || err instanceof ConfigError) return { ok: false, error: err.message };
  console.error("[action] unexpected error", err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** An error whose message is safe to show to the user. */
export class UserError extends Error {}
