import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="relative flex min-h-screen flex-col">
      <header className="border-b border-border/60">
        <div className="container flex h-14 items-center">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
              <span className="font-mono text-[11px] font-semibold">wt</span>
            </div>
            <span className="text-sm font-semibold tracking-tight">webtesting</span>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Use your GitHub account to continue.
            </p>
          </div>

          <SignIn
            appearance={{
              elements: { rootBox: "w-full", card: "shadow-none border border-border bg-card" },
            }}
          />
        </div>
      </main>
    </div>
  );
}
