import { BarChart3, Rocket, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandMark } from "@/components/shell/sidebar-content";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

const FEATURES = [
  { icon: Rocket, title: "Template-driven launches", text: "Paused builds, real placement previews and one-click approval." },
  { icon: BarChart3, title: "Instant dashboards", text: "Insights synced in the background, so every view loads fast." },
  { icon: ShieldCheck, title: "Review alerts", text: "Rejections and delivery issues surface the moment they happen." },
];

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="grid grid-cols-1 min-h-full lg:grid-cols-[1.05fr_1fr]">
      {/* Always-dark brand hero in both themes, so it uses fixed colors instead of tokens (documented exception). */}
      <section className="relative hidden overflow-hidden bg-[#0b0b14] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* Soft brand glow */}
        <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 size-[36rem] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.45),transparent_65%)] blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 right-[-10rem] size-[34rem] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.35),transparent_65%)] blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]" />

        <div className="relative flex items-center gap-2.5">
          <BrandMark />
          <span className="text-[15px] font-semibold tracking-tight">Ads Manager</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-[34px] font-semibold leading-[1.1] tracking-tight">
            Run Meta ads with{" "}
            <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
              less clicking
            </span>{" "}
            and more control.
          </h2>
          <ul className="mt-10 space-y-6">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5">
                  <Icon className="size-[18px] text-indigo-200" />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-0.5 text-[13.5px] text-white/60">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">Internal tool · access is limited to invited team members.</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[360px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark />
            <span className="text-[15px] font-semibold tracking-tight">Ads Manager</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mb-7 mt-1.5 text-[13.5px] text-muted">Log in with your team account to continue.</p>
          <Suspense>
            <LoginFormWithNext searchParams={props.searchParams} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function LoginFormWithNext({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const next = (await searchParams).next;
  return <LoginForm next={typeof next === "string" ? next : undefined} />;
}
