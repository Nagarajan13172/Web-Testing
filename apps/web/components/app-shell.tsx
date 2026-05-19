import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { GitBranch, LayoutDashboard, Settings, BookOpen } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Repositories", icon: LayoutDashboard },
  { href: "/runs", label: "Recent runs", icon: GitBranch },
  { href: "/docs", label: "Documentation", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-border/60 md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-border/60 px-5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
            <span className="font-mono text-[11px] font-semibold">wt</span>
          </div>
          <span className="text-sm font-semibold tracking-tight">webtesting</span>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <item.icon className="h-4 w-4" strokeWidth={1.5} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="border-t border-border/60 p-3">
          <div className="flex items-center justify-between">
            <UserButton afterSignOutUrl="/" />
            <span className="font-mono text-[11px] text-muted-foreground">v0.1.0</span>
          </div>
        </div>
      </aside>

      <main className="flex-1">
        <div className="mx-auto max-w-[1200px] px-6 py-8 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  );
}
