"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GitBranch, LayoutDashboard, Settings, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Repositories", icon: LayoutDashboard },
  { href: "/runs", label: "Recent runs", icon: GitBranch },
  { href: "/docs", label: "Documentation", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Sidebar navigation, split out of AppShell so the shell can stay a server
 * component — only the active-route highlight needs the client.
 */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
      {navItems.map((item) => {
        // Nested routes keep their section lit: /runs/<id> highlights "Recent
        // runs". The prefix needs the trailing slash so /runs doesn't also
        // match a hypothetical /runs-archive.
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4" strokeWidth={active ? 2 : 1.5} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
