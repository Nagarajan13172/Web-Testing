import { createAppAuth } from "@octokit/auth-app";

function privateKey(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new Error("GITHUB_APP_PRIVATE_KEY is not set");
  return raw.replace(/\\n/g, "\n");
}

function appId(): number {
  const v = process.env.GITHUB_APP_ID;
  if (!v) throw new Error("GITHUB_APP_ID is not set");
  return Number(v);
}

export async function installationAccessToken(installationId: number): Promise<string> {
  const auth = createAppAuth({ appId: appId(), privateKey: privateKey() });
  const result = await auth({ type: "installation", installationId });
  return result.token;
}

/**
 * Convert a public github.com URL to one git can clone with installation
 * credentials. Returns the original URL unchanged for non-github targets so
 * local fixtures (file://, http://) keep working.
 */
export function tokenizedCloneUrl(repoUrl: string, token: string): string {
  if (!repoUrl.startsWith("https://github.com/")) return repoUrl;
  return repoUrl.replace(
    "https://github.com/",
    `https://x-access-token:${token}@github.com/`,
  );
}
