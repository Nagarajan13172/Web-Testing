import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Webtesting — CI that writes the tests you don't have",
  description:
    "Connect a GitHub repo and get lint, build, and AI-generated tests on every push. CI for the projects that never wrote tests.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "hsl(262 83% 58%)",
          colorBackground: "hsl(240 10% 4%)",
          colorText: "hsl(0 0% 98%)",
          colorInputBackground: "hsl(240 4% 12%)",
          colorInputText: "hsl(0 0% 98%)",
          borderRadius: "0.5rem",
        },
        elements: {
          card: "shadow-none border border-border bg-card",
        },
      }}
    >
      <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
        <body className="min-h-screen bg-background font-sans text-foreground antialiased">
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
            {children}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
