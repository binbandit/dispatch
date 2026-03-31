import type { IpcApi } from "@/shared/ipc";
import type { QueryKey } from "@tanstack/react-query";

import { useEffect, useEffectEvent, useRef } from "react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";

export type PrSearchRefreshRequest =
  | {
      method: "pr.list";
      args: IpcApi["pr.list"]["args"];
      queryKey: QueryKey;
    }
  | {
      method: "pr.listEnrichment";
      args: IpcApi["pr.listEnrichment"]["args"];
      queryKey: QueryKey;
    };

interface UsePrSearchRefreshOnMissOptions {
  requests: PrSearchRefreshRequest[];
  resultCount: number;
  scope: string;
  searchQuery: string;
}

async function refreshPrSearchRequest(request: PrSearchRefreshRequest): Promise<void> {
  if (request.method === "pr.list") {
    const data = await ipc("pr.list", { ...request.args, forceRefresh: true });
    queryClient.setQueryData(request.queryKey, data);
    return;
  }

  const data = await ipc("pr.listEnrichment", { ...request.args, forceRefresh: true });
  queryClient.setQueryData(request.queryKey, data);
}

export function usePrSearchRefreshOnMiss({
  requests,
  resultCount,
  scope,
  searchQuery,
}: UsePrSearchRefreshOnMissOptions): void {
  const lastRefreshRef = useRef("");
  const inFlightRefreshRef = useRef("");
  const hasSearch = searchQuery.trim().length > 0;
  const missKey = hasSearch ? `${scope}::miss` : "";

  const refreshOnMiss = useEffectEvent(
    async (key: string, nextRequests: PrSearchRefreshRequest[]) => {
      inFlightRefreshRef.current = key;

      try {
        await Promise.allSettled(nextRequests.map((request) => refreshPrSearchRequest(request)));
      } finally {
        if (inFlightRefreshRef.current === key) {
          inFlightRefreshRef.current = "";
        }
      }
    },
  );

  useEffect(() => {
    if (!missKey) {
      lastRefreshRef.current = "";
      inFlightRefreshRef.current = "";
      return;
    }

    if (resultCount > 0) {
      lastRefreshRef.current = "";
      return;
    }

    if (lastRefreshRef.current === missKey || inFlightRefreshRef.current === missKey) {
      return;
    }

    lastRefreshRef.current = missKey;
    void refreshOnMiss(missKey, requests);
  }, [missKey, refreshOnMiss, requests, resultCount]);
}
