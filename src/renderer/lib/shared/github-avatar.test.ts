import {
  buildGitHubAvatarUrl,
  getGitHubAvatarUrl,
  isEnterpriseManagedUserLogin,
  resizeGitHubAvatarUrl,
} from "@/renderer/lib/shared/github-avatar";
import { describe, expect, it } from "vite-plus/test";

describe("buildGitHubAvatarUrl", () => {
  it("uses the repo host instead of hardcoding github.com", () => {
    expect(
      buildGitHubAvatarUrl({ login: "octocat", size: 48, host: "github.enterprise.test" }),
    ).toBe("https://github.enterprise.test/octocat.png?size=48");
  });

  it("normalizes bot logins to the corresponding profile png URL", () => {
    expect(buildGitHubAvatarUrl({ login: "dispatch-bot[bot]", size: 32 })).toBe(
      "https://github.com/dispatch-bot.png?size=32",
    );
  });
});

describe("resizeGitHubAvatarUrl", () => {
  it("updates avatar CDN urls with the s query param", () => {
    expect(resizeGitHubAvatarUrl("https://avatars.githubusercontent.com/u/9919?v=4", 64)).toBe(
      "https://avatars.githubusercontent.com/u/9919?v=4&s=64",
    );
  });

  it("updates hosted profile png urls with the size query param", () => {
    expect(resizeGitHubAvatarUrl("https://github.enterprise.test/octocat.png", 80)).toBe(
      "https://github.enterprise.test/octocat.png?size=80",
    );
  });

  it("preserves invalid urls instead of throwing", () => {
    expect(resizeGitHubAvatarUrl("not-a-url", 80)).toBe("not-a-url");
  });
});

describe("isEnterpriseManagedUserLogin", () => {
  it("detects enterprise managed usernames on github.com", () => {
    expect(isEnterpriseManagedUserLogin("mona-cat_octo")).toBeTruthy();
  });

  it("ignores standard GitHub usernames", () => {
    expect(isEnterpriseManagedUserLogin("octocat")).toBeFalsy();
  });
});

describe("getGitHubAvatarUrl", () => {
  it("prefers a resolved API avatar url over the login png fallback", () => {
    expect(
      getGitHubAvatarUrl({
        login: "mona-cat_octo",
        size: 72,
        avatarUrl: "https://avatars.githubusercontent.com/u/123?v=4",
        resolvedAvatarUrl: "https://avatars.githubusercontent.com/u/456?v=4",
      }),
    ).toBe("https://avatars.githubusercontent.com/u/456?v=4&s=72");
  });

  it("falls back to the profile png url when no resolved avatar exists", () => {
    expect(
      getGitHubAvatarUrl({
        login: "octocat",
        size: 40,
        host: "github.com",
      }),
    ).toBe("https://github.com/octocat.png?size=40");
  });

  it("falls back to avatarUrl when resolvedAvatarUrl is null", () => {
    expect(
      getGitHubAvatarUrl({
        login: "octocat",
        size: 64,
        avatarUrl: "https://avatars.githubusercontent.com/u/123?v=4",
        resolvedAvatarUrl: null,
      }),
    ).toBe("https://avatars.githubusercontent.com/u/123?v=4&s=64");
  });

  it("uses default size of 64", () => {
    const url = getGitHubAvatarUrl({ login: "octocat" });
    expect(url).toContain("size=64");
  });

  it("defaults to github.com host", () => {
    const url = getGitHubAvatarUrl({ login: "octocat" });
    expect(url).toContain("github.com");
  });
});

describe("buildGitHubAvatarUrl — additional", () => {
  it("uses default size of 64", () => {
    expect(buildGitHubAvatarUrl({ login: "octocat" })).toBe(
      "https://github.com/octocat.png?size=64",
    );
  });

  it("encodes special characters in login", () => {
    const url = buildGitHubAvatarUrl({ login: "user name" });
    expect(url).toContain("user%20name");
  });

  it("normalizes empty host to github.com", () => {
    expect(buildGitHubAvatarUrl({ login: "test", host: "" })).toContain("github.com");
  });

  it("strips protocol from host", () => {
    expect(buildGitHubAvatarUrl({ login: "test", host: "https://gh.corp.com/" })).toContain(
      "gh.corp.com",
    );
  });
});

describe("isEnterpriseManagedUserLogin — additional", () => {
  it("requires underscore followed by 3-8 char suffix", () => {
    expect(isEnterpriseManagedUserLogin("user_abc")).toBeTruthy();
    expect(isEnterpriseManagedUserLogin("user_abcdefgh")).toBeTruthy();
  });

  it("rejects suffix too short", () => {
    expect(isEnterpriseManagedUserLogin("user_ab")).toBeFalsy();
  });

  it("rejects suffix too long", () => {
    expect(isEnterpriseManagedUserLogin("user_abcdefghi")).toBeFalsy();
  });

  it("ignores bot suffixes", () => {
    expect(isEnterpriseManagedUserLogin("renovate[bot]")).toBeFalsy();
  });

  it("rejects logins starting with underscore", () => {
    expect(isEnterpriseManagedUserLogin("_user_abc")).toBeFalsy();
  });
});

describe("resizeGitHubAvatarUrl — additional", () => {
  it("replaces existing size param", () => {
    expect(resizeGitHubAvatarUrl("https://github.com/test.png?size=32", 128)).toBe(
      "https://github.com/test.png?size=128",
    );
  });

  it("replaces existing s param on CDN URL", () => {
    expect(resizeGitHubAvatarUrl("https://avatars.githubusercontent.com/u/1?s=32&v=4", 96)).toBe(
      "https://avatars.githubusercontent.com/u/1?v=4&s=96",
    );
  });
});
