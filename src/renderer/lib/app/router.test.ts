import { useRouterStore } from "@/renderer/lib/app/router";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/renderer/lib/app/posthog", () => ({
  trackPage: vi.fn(),
}));

describe("router history", () => {
  beforeEach(() => {
    useRouterStore.getState().reset({ view: "review", prNumber: null });
  });

  it("goes backward and forward through navigation history", () => {
    const router = useRouterStore.getState();

    router.navigate({ view: "workflows" });
    router.navigate({ view: "metrics" });

    expect(useRouterStore.getState().route).toEqual({ view: "metrics" });

    useRouterStore.getState().goBack();
    expect(useRouterStore.getState().route).toEqual({ view: "workflows" });

    useRouterStore.getState().goBack();
    expect(useRouterStore.getState().route).toEqual({ view: "review", prNumber: null });

    useRouterStore.getState().goForward();
    expect(useRouterStore.getState().route).toEqual({ view: "workflows" });

    useRouterStore.getState().goForward();
    expect(useRouterStore.getState().route).toEqual({ view: "metrics" });
  });

  it("clears forward history after a new navigation", () => {
    const router = useRouterStore.getState();

    router.navigate({ view: "workflows" });
    router.navigate({ view: "metrics" });
    useRouterStore.getState().goBack();

    expect(useRouterStore.getState().route).toEqual({ view: "workflows" });

    useRouterStore.getState().navigate({ view: "releases" });
    useRouterStore.getState().goForward();

    expect(useRouterStore.getState().route).toEqual({ view: "releases" });
  });

  it("returns from settings with toggleSettings and preserves history", () => {
    const router = useRouterStore.getState();

    router.navigate({ view: "workflows" });
    useRouterStore.getState().toggleSettings();

    expect(useRouterStore.getState().route).toEqual({ view: "settings" });

    useRouterStore.getState().toggleSettings();
    expect(useRouterStore.getState().route).toEqual({ view: "workflows" });

    useRouterStore.getState().goBack();
    expect(useRouterStore.getState().route).toEqual({ view: "settings" });
  });
});
