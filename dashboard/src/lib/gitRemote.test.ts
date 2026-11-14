import { describe, expect, it } from "vitest";
import { remoteLinks } from "./gitRemote";

describe("remoteLinks", () => {
  it("derives the GitHub page from SSH and HTTPS remotes", () => {
    expect(remoteLinks("git@github.com:wink/app.git")).toEqual({
      cloneUrl: "git@github.com:wink/app.git",
      webUrl: "https://github.com/wink/app",
      isGithub: true,
    });
    expect(remoteLinks("https://github.com/wink/app.git")).toEqual({
      cloneUrl: "https://github.com/wink/app.git",
      webUrl: "https://github.com/wink/app",
      isGithub: true,
    });
    expect(remoteLinks("ssh://git@github.com/wink/app.git")?.webUrl).toBe(
      "https://github.com/wink/app",
    );
  });

  it("removes credentials embedded in HTTPS remotes", () => {
    const links = remoteLinks(
      "https://x-access-token:ghp_secret@github.com/wink/app.git",
    );
    expect(links?.cloneUrl).toBe("https://github.com/wink/app.git");
    expect(links?.webUrl).toBe("https://github.com/wink/app");
  });

  it("handles other hosts and empty remotes", () => {
    expect(remoteLinks("git@gitlab.com:group/sub/proj.git")).toEqual({
      cloneUrl: "git@gitlab.com:group/sub/proj.git",
      webUrl: "https://gitlab.com/group/sub/proj",
      isGithub: false,
    });
    expect(remoteLinks("")).toBeNull();
    expect(remoteLinks("/srv/git/local.git")).toEqual({
      cloneUrl: "/srv/git/local.git",
      webUrl: null,
      isGithub: false,
    });
  });
});
