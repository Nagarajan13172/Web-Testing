import crypto from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

function privateKey(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new Error("GITHUB_APP_PRIVATE_KEY is not set");
  // Some hosting platforms (Vercel etc.) require literal \n escapes — normalize back.
  return raw.replace(/\\n/g, "\n");
}

function appId(): number {
  const v = process.env.GITHUB_APP_ID;
  if (!v) throw new Error("GITHUB_APP_ID is not set");
  return Number(v);
}

/** Octokit authenticated as the GitHub App itself (for `/app/...` endpoints). */
export function appOctokit(): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: appId(), privateKey: privateKey() },
  });
}

/** Octokit authenticated as a specific installation (for repo-level reads). */
export function installationOctokit(installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: appId(), privateKey: privateKey(), installationId },
  });
}

/** Mint a short-lived installation access token (1h) — use for `git clone`. */
export async function installationAccessToken(installationId: number): Promise<string> {
  const auth = createAppAuth({ appId: appId(), privateKey: privateKey() });
  const result = await auth({ type: "installation", installationId });
  return result.token;
}

/** Constant-time HMAC-SHA256 verification of GitHub webhook signatures. */
export function verifyWebhookSignature(payload: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  const expected = `sha256=${hmac.digest("hex")}`;

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** URL the user is redirected to in order to install the GitHub App. */
export function installUrl(state?: string): string {
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) throw new Error("GITHUB_APP_SLUG is not set");
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
