import { CheckCircle2, XCircle, Loader2, Clock, CircleSlash } from "lucide-react";
import { cn } from "@/lib/utils";

export type RunStatus = "queued" | "running" | "success" | "failure" | "cancelled";

const config: Record<RunStatus, { label: string; classes: string; Icon: typeof CheckCircle2 }> = {
  queued: {
    label: "Queued",
    classes: "bg-muted text-muted-foreground",
    Icon: Clock,
  },
  running: {
    label: "Running",
    classes: "bg-primary/15 text-primary",
    Icon: Loader2,
  },
  success: {
    label: "Passed",
    classes: "bg-success/15 text-success",
    Icon: CheckCircle2,
  },
  failure: {
    label: "Failed",
    classes: "bg-destructive/15 text-destructive",
    Icon: XCircle,
  },
  cancelled: {
    label: "Cancelled",
    classes: "bg-muted text-muted-foreground",
    Icon: CircleSlash,
  },
};

export function RunStatusPill({ status }: { status: RunStatus }) {
  const { label, classes, Icon } = config[status];
  const spinning = status === "running";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
        classes,
      )}
    >
      <Icon className={cn("h-3 w-3", spinning && "animate-spin")} strokeWidth={1.75} />
      {label}
    </span>
  );
}
