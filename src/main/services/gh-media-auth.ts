import { session } from "electron";

import { trackFromMain } from "./analytics";
import { execFile } from "./shell";

/** Cache of hostname → token so we don't shell out on every request. */
const tokenCache = new Map<string, { token: string | null; fetchedAt: number }>();
// 5 minutes.
const TOKEN_TTL = 300_000;

function resolveGitHubHost(hostname: string): string {
  const normalized = hostname.toLowerCase();
  const isGitHubCdnHost =
    normalized === "github.com" ||
    normalized.endsWith(".github.com") ||
    normalized.endsWith(".githubusercontent.com") ||
    normalized.endsWith(".githubassets.com") ||
    (normalized.endsWith(".amazonaws.com") && normalized.includes("github"));

  if (isGitHubCdnHost) {
    return "github.com";
  }

  return hostname;
}

function isGitHubMediaRequest(resourceType: string, url: URL): boolean {
  const path = url.pathname.toLowerCase();
  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp"];
  const videoExtensions = [".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi"];
  const isMediaResourceType = resourceType === "image" || resourceType === "media";
  const hasMediaExtension = [...imageExtensions, ...videoExtensions].some((extension) =>
    path.endsWith(extension),
  );

  return (
    isMediaResourceType ||
    hasMediaExtension ||
    path.includes("/avatars/") ||
    path.includes("/storage/") ||
    path.includes("/user-attachments/")
  );
}

async function getGhToken(host: string): Promise<string | null> {
  const cached = tokenCache.get(host);
  if (cached && Date.now() - cached.fetchedAt < TOKEN_TTL) {
    return cached.token;
  }

  try {
    const { stdout } = await execFile("gh", ["auth", "token", "--hostname", host], {
      timeout: 5000,
    });
    const token = stdout.trim() || null;
    tokenCache.set(host, { token, fetchedAt: Date.now() });
    return token;
  } catch (error) {
    tokenCache.set(host, { token: null, fetchedAt: Date.now() });
    const message = String((error as Error)?.message ?? "");
    if (!message.includes("ENOENT")) {
      trackFromMain("gh_cli_error", {
        subcommand: "auth",
        category: "token_fetch",
      });
    }
  }

  return null;
}

export function setupMediaAuth(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://*/*"] },
    (details, callback) => {
      const targetUrl = (() => {
        try {
          return new URL(details.url);
        } catch {
          return null;
        }
      })();

      if (!targetUrl || !isGitHubMediaRequest(details.resourceType, targetUrl)) {
        callback({ cancel: false });
        return;
      }

      const tokenHost = resolveGitHubHost(targetUrl.hostname);

      getGhToken(tokenHost)
        .then((token) => {
          if (token) {
            callback({
              cancel: false,
              requestHeaders: {
                ...details.requestHeaders,
                Authorization: `token ${token}`,
              },
            });
          } else {
            callback({ cancel: false });
          }
        })
        .catch(() => {
          callback({ cancel: false });
        });
    },
  );
}
