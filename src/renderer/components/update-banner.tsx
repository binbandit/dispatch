import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Auto-update notification banner — Phase 4 §A2
 *
 * Shows when an update has been downloaded and is ready to install.
 * Slides down from the top with accent styling.
 */

export function UpdateBanner() {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Listen for update-downloaded event from main process
    const handler = (_event: unknown, version: string) => {
      setUpdateVersion(version);
      setDismissed(false);
    };

    // electron preload exposes window.api — check if on() exists
    const api = (globalThis as unknown as { api?: { on?: (channel: string, cb: unknown) => void } })
      .api;
    if (api?.on) {
      api.on("update-downloaded", handler);
    }
  }, []);

  if (!updateVersion || dismissed) {
    return null;
  }

  return (
    <div
      className="bg-accent-muted text-accent-text flex h-8 items-center justify-center gap-3 px-4 text-xs"
      style={{ transition: "max-height 300ms var(--ease-out)" }}
    >
      <Download size={13} />
      <span>Update v{updateVersion} ready — restart to apply</span>
      <Button
        size="sm"
        variant="ghost"
        className="text-accent-text hover:bg-primary/20 h-5 text-[11px]"
        onClick={() => {
          // Tell main process to quit and install
          window.api?.invoke("app.restart", null);
        }}
      >
        Restart now
      </Button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-accent-text/60 hover:text-accent-text cursor-pointer p-0.5"
      >
        <X size={12} />
      </button>
    </div>
  );
}
