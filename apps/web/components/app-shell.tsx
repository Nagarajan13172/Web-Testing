import { UserButton } from "@clerk/nextjs";
import { SidebarNav } from "@/components/sidebar-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/*
        sticky + h-screen keeps the sidebar in place while the page scrolls.
        Without it the aside is simply a tall column in a scrolling document and
        slides away with the content.
      */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border/60 bg-background md:flex">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
            <span className="font-mono text-[11px] font-semibold">wt</span>
          </div>
          <span className="text-sm font-semibold tracking-tight">webtesting</span>
        </div>

        <SidebarNav />

        <div className="shrink-0 border-t border-border/60 p-3">
          <div className="flex items-center justify-between">
            <UserButton afterSignOutUrl="/" />
            <span className="font-mono text-[11px] text-muted-foreground">v0.1.0</span>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1200px] px-6 py-8 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  );
}
