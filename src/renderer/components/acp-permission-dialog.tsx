/**
 * ACP Permission Dialog — shows when an agent requests permission for a tool call.
 *
 * Listens globally for acp:permission events, renders an AlertDialog with
 * the agent's requested action and permission options, sends the response back.
 */

import type { AcpPermissionEvent } from "../../shared/ipc";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ipc } from "../lib/ipc";

export function AcpPermissionListener() {
  const [pending, setPending] = useState<AcpPermissionEvent | null>(null);

  useEffect(() => {
    const cleanup = window.api.onAcpPermission((event: AcpPermissionEvent) => {
      setPending(event);
    });
    return cleanup;
  }, []);

  const respond = useCallback(
    (optionId: string) => {
      if (!pending) {
        return;
      }
      void ipc("acp.permission.respond", {
        requestId: pending.requestId,
        optionId,
      });
      setPending(null);
    },
    [pending],
  );

  if (!pending) {
    return null;
  }

  // Group options by kind for layout
  const allowOptions = pending.options.filter(
    (o) => o.kind === "allow_once" || o.kind === "allow_always",
  );
  const rejectOptions = pending.options.filter(
    (o) => o.kind === "reject_once" || o.kind === "reject_always",
  );

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Shield
              size={18}
              className="text-primary"
            />
            Agent Permission
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="text-text-primary font-medium">{pending.toolName}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter variant="bare">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
            {rejectOptions.map((opt) => (
              <Button
                key={opt.optionId}
                variant="outline"
                size="sm"
                onClick={() => respond(opt.optionId)}
              >
                {opt.name}
              </Button>
            ))}
            {allowOptions.map((opt) => (
              <Button
                key={opt.optionId}
                variant={opt.kind === "allow_always" ? "default" : "outline"}
                size="sm"
                className={
                  opt.kind === "allow_once"
                    ? "border-primary/30 text-primary hover:bg-primary/10"
                    : ""
                }
                onClick={() => respond(opt.optionId)}
              >
                {opt.name}
              </Button>
            ))}
            {/* Fallback if no grouped options match */}
            {allowOptions.length === 0 &&
              rejectOptions.length === 0 &&
              pending.options.map((opt) => (
                <Button
                  key={opt.optionId}
                  variant="outline"
                  size="sm"
                  onClick={() => respond(opt.optionId)}
                >
                  {opt.name}
                </Button>
              ))}
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
