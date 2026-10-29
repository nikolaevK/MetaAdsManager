import { BarChart3, FolderOpen, History, LayoutGrid, Rocket, Settings, ShieldAlert, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: "review" };

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Analyze",
    items: [{ href: "/overview", label: "Overview", icon: BarChart3 }],
  },
  {
    label: "Manage",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: LayoutGrid },
      { href: "/launches", label: "Launches", icon: Rocket },
      { href: "/library", label: "Creative library", icon: FolderOpen },
      { href: "/review", label: "Ad review", icon: ShieldAlert, badge: "review" },
      { href: "/history", label: "History", icon: History },
    ],
  },
  {
    label: "Configure",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

const LABELS: Record<string, string> = {
  overview: "Overview",
  campaigns: "Campaigns",
  launches: "Launches",
  new: "New",
  library: "Creative library",
  review: "Ad review",
  history: "History",
  settings: "Settings",
  clients: "Clients & accounts",
  templates: "Launch templates",
  naming: "Naming & UTM",
  users: "Users",
  system: "System",
};

/** "/settings/templates/abc" → [{Settings,/settings}, {Launch templates,/settings/templates}, {Template}] */
export function breadcrumbs(pathname: string): { label: string; href?: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((part, i) => {
    const href = "/" + parts.slice(0, i + 1).join("/");
    const label = LABELS[part] ?? (parts[i - 1] === "launches" ? "Launch" : parts[i - 1] === "templates" ? "Template" : part);
    return { label, href: i < parts.length - 1 ? href : undefined };
  });
}
