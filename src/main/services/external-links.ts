import { shell } from "electron";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

export function getExternalUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsedUrl.protocol)) {
      return null;
    }
    return parsedUrl.toString();
  } catch {
    return null;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  const externalUrl = getExternalUrl(url);
  if (!externalUrl) {
    throw new Error("Invalid external URL.");
  }

  await shell.openExternal(externalUrl);
}
