# Design system

Modern, calm, data-dense. Think Linear / Vercel / Stripe dashboards: neutral surfaces, one confident brand
accent (indigo → violet), crisp 1px borders, soft elevation, generous but efficient spacing, first-class
light **and** dark themes.

## Tokens (src/app/globals.css)

Never use raw hex values or Tailwind palette colors (`bg-white`, `text-gray-500`, `#…`). Use semantic tokens:

| Role | Classes |
| --- | --- |
| App background | `bg-canvas` |
| Cards, popovers, inputs | `bg-surface` |
| Sunken areas (table header, input groups, segmented track, code) | `bg-surface-2` |
| Hover / subtle fill | `bg-hover` |
| Borders | `border-line` (structure), `border-line-soft` (row dividers, inner separators) |
| Text | `text-ink` (primary), `text-muted` (secondary), `text-faint` (tertiary, labels, icons) |
| Brand | `bg-primary`, `text-primary`, `bg-primary-soft` + `text-primary-ink` for tinted chips, gradient `from-brand-from to-brand-to`; text/icons on primary, brand or danger fills use `text-on-primary` |
| Status | `success`, `warning`, `danger` each with `-soft` (background) and `-ink` (text on soft) |
| Charts | `var(--chart-1)` (spend / primary series), `var(--chart-2)` (results), `var(--chart-3)`, gridlines `var(--chart-grid)`, axis labels `var(--faint)` |
| Elevation | `shadow-xs` (inputs, buttons), `shadow-card` (cards), `shadow-pop` (menus, dialogs, toasts), `shadow-glow` (brand CTA) |
| Focus | `focusRing` from ui.tsx (`focus-visible:ring-4 focus-visible:ring-[var(--ring)]`) on every custom control |

Opacity modifiers work on tokens (`bg-primary/10`, `ring-danger/20`). Dark mode is automatic through tokens;
only use the `dark:` variant for rare true exceptions. `text-faint` still meets 4.5:1 on canvas, surface, surface-2 and
hover in both themes, so it's fine for captions and timestamps.

Exception: the login page's hero panel is always dark (in both themes) and uses fixed colors (`bg-[#0b0b14]`,
`text-white/…`, light indigo/violet tints). Don't copy that pattern elsewhere.

## Type & spacing

- Font: Geist (sans) / Geist Mono. Base 14px. Use `tabular` class on numeric columns and KPI values.
- Page title `text-2xl font-semibold tracking-tight` (via `PageHeader`). Card titles `text-[14.5px] font-semibold`.
  Body `text-[13.5px]`, secondary `text-[13px] text-muted`, captions `text-xs text-faint`.
- Section labels: `text-[11px] font-medium uppercase tracking-wider text-faint`.
- Radii: cards `rounded-xl`, controls `rounded-lg`, pills `rounded-full`, small chips `rounded-md`.
- Page rhythm: sections separated by `gap-5`/`space-y-5`; card padding `p-5` (header `px-5 py-4`).

## Components (src/components/ui.tsx)

`Button`/`buttonClass(variant, size)` — variants `create` (brand gradient, the ONE main action per screen),
`primary`, `secondary`, `ghost`, `subtle`, `danger`; sizes `sm | md | lg | icon`. Icons inside buttons are
auto-sized.
`Input`, `Select`, `Textarea`, `Field`, `Label` · `Card`, `CardHeader({ title, description, actions, icon })`
· `Badge({ tone, dot })` (soft pill) · `StatusDot` · `Alert({ tone, title })` · `PageHeader({ eyebrow, title,
description, actions })` · `EmptyState({ icon, title, action })` · `Skeleton`, `PageSkeleton` · `Kbd` ·
`Avatar` · `Stat({ label, value, delta, footer, visual })` · `Segmented` + `segmentClass(active)` for
pill tabs.
Shell (sidebar, top bar with breadcrumbs, ⌘K palette, theme switch) lives in `src/components/shell/*`.
`toast(message, tone)` from `src/components/toast.tsx`.
Overlays: `Modal` / `useModal` from `src/components/modal.tsx` (focus in, Tab kept inside, Escape, scroll lock, focus
back to the trigger) and `useConfirm()` from `src/components/confirm-dialog.tsx` instead of `window.confirm`.
Settings forms end with `FormFooter` from `src/components/settings-ui.tsx` (destructive action left, primary right,
persistent error Alert, `sticky` on long forms).

## Patterns

- **Page**: `PageHeader` → optional KPI strip (`Stat` grid, `grid-cols-2 lg:grid-cols-4/5`) → toolbar → content cards.
  The top bar already shows breadcrumbs and the global "New campaign" CTA (the one `create` button on a screen).
- **Toolbar**: a single row (wraps on mobile) of search, filters (`Segmented` for 2–4 options, `Select` otherwise),
  and right-aligned date range / view actions.
- **Tables**: inside a `Card` with `overflow-hidden`; wrapper `overflow-x-auto`; header row `bg-surface-2`,
  `text-[12px] font-medium text-muted`, `border-b border-line`; rows `border-b border-line-soft`,
  `hover:bg-hover/60`; numeric cells right-aligned + `tabular`; first column shows primary text plus a muted
  secondary line. No zebra stripes.
- **Status**: `Badge` with `dot` for lifecycle states; `StatusDot` inline in dense tables.
- **Empty states**: always an icon, one-sentence explanation, and the next action.
- **Forms**: `Field` stacks; group related fields in `Card`s with `CardHeader icon`; two columns on `sm+`
  (`grid gap-4 sm:grid-cols-2`); primary submit right-aligned in a sticky footer on long forms.
- **Dialogs / popovers**: `rounded-2xl border border-line bg-surface shadow-pop animate-pop-in`, backdrop
  `bg-black/40 backdrop-blur-[2px]`.
- **Motion**: subtle only — `transition-colors`, `animate-pop-in` for overlays. Respect reduced motion (global).
- **Responsive**: must work at 390px wide with no horizontal page scroll; wide tables scroll inside their card.
- **Touch**: `hover:` never fires on touch screens. Hover-only reveals use `can-hover:opacity-0 can-hover:group-hover:opacity-100`
  (always visible on touch); small controls grow to a 40px target with `pointer-coarse:` (size, or an `after:` hit area).
  Keyboard hints (`Kbd`) hide with `pointer-coarse:hidden`; don't auto-focus text fields on touch (it pops the keyboard).
- **Charts**: SVG with token colors via CSS variables (`fill="var(--chart-1)"`), gridlines `var(--chart-grid)`,
  labels `var(--faint)`; rounded bar tops; hover tooltips styled like popovers.
