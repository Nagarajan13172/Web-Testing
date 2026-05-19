import Link from "next/link";
import { ArrowRight, Github, Sparkles, ShieldCheck, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <BackgroundGrid />

      <header className="relative z-10 border-b border-border/60">
        <div className="container flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark />
            <span className="text-sm font-semibold tracking-tight">webtesting</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/sign-in">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        <section className="container flex flex-col items-center pt-24 pb-20 text-center md:pt-32 md:pb-28">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="h-3 w-3 text-primary" strokeWidth={1.75} />
            <span>AI-generated tests, on every push</span>
          </div>

          <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-6xl">
            CI that writes the tests
            <br />
            <span className="text-muted-foreground">you don&apos;t have.</span>
          </h1>

          <p className="mt-6 max-w-xl text-balance text-base text-muted-foreground md:text-lg">
            Connect a GitHub repo. We lint, type-check, build, and run your tests in
            isolated sandboxes — then generate the ones you&apos;re missing.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/sign-in">
                <Github strokeWidth={1.75} />
                Connect a GitHub repo
                <ArrowRight strokeWidth={1.75} />
              </Link>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <Link href="#how">How it works</Link>
            </Button>
          </div>

          <p className="mt-6 font-mono text-xs text-muted-foreground/70">
            Free while in beta · No card required
          </p>
        </section>

        <section id="how" className="container pb-32">
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
            <FeatureCard
              icon={<Activity strokeWidth={1.5} />}
              title="Multi-language CI"
              body="JS/TS, Python, Java, Go. Vitest, pytest, JUnit, go test — auto-detected per repo."
            />
            <FeatureCard
              icon={<Sparkles strokeWidth={1.5} />}
              title="AI test generation"
              body="No tests yet? We read your code and open a PR with the suite it needs."
            />
            <FeatureCard
              icon={<ShieldCheck strokeWidth={1.5} />}
              title="Sandboxed runs"
              body="Every run executes in an isolated Docker container with a per-repo secrets vault."
            />
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border/60">
        <div className="container flex h-14 items-center justify-between text-xs text-muted-foreground">
          <span>© 2026 webtesting</span>
          <span className="font-mono">v0.1.0</span>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-6 backdrop-blur transition-colors hover:border-border/80">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-primary">
        {icon}
      </div>
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function LogoMark() {
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
      <span className="font-mono text-[11px] font-semibold">wt</span>
    </div>
  );
}

function BackgroundGrid() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.04] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="pointer-events-none absolute left-1/2 top-0 z-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
    </>
  );
}
