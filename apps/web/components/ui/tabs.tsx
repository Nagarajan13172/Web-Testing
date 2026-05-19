"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export interface TabDef {
  id: string;
  label: string;
  badge?: { text: string; tone: "success" | "destructive" | "muted" } | null;
}

export function Tabs({ tabs, active }: { tabs: TabDef[]; active: string }) {
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(id: string) {
    const sp = new URLSearchParams(params);
    if (id === tabs[0]?.id) sp.delete("tab");
    else sp.set("tab", id);
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="flex items-center gap-1 border-b border-border">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={hrefFor(tab.id)}
            scroll={false}
            className={cn(
              "relative inline-flex items-center gap-2 px-3 py-2 text-sm transition-colors",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.badge && (
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 font-mono text-[10px]",
                  tab.badge.tone === "success" && "bg-success/15 text-success",
                  tab.badge.tone === "destructive" && "bg-destructive/15 text-destructive",
                  tab.badge.tone === "muted" && "bg-muted text-muted-foreground",
                )}
              >
                {tab.badge.text}
              </span>
            )}
            {isActive && (
              <span className="absolute inset-x-2 -bottom-px h-px bg-primary" aria-hidden />
            )}
          </Link>
        );
      })}
    </div>
  );
}
