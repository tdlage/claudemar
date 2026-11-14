export interface RemoteLinks {
  cloneUrl: string;
  webUrl: string | null;
  isGithub: boolean;
}

const SCP_REMOTE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/;

function webPath(path: string): string {
  return path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
}

// Remotos HTTP(S) e SSH: a URL de clone sai sem credenciais e a página web é derivada de host + caminho.
export function remoteLinks(remoteUrl: string): RemoteLinks | null {
  const raw = remoteUrl.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.username = "";
      url.password = "";
      const path = webPath(url.pathname);
      return {
        cloneUrl: url.toString(),
        webUrl: path ? `https://${url.host}/${path}` : null,
        isGithub: url.hostname === "github.com",
      };
    }
    if (url.protocol === "ssh:" || url.protocol === "git:") {
      const path = webPath(url.pathname);
      return {
        cloneUrl: raw,
        webUrl: path ? `https://${url.hostname}/${path}` : null,
        isGithub: url.hostname === "github.com",
      };
    }
  } catch {
    const scp = SCP_REMOTE.exec(raw);
    if (scp) {
      const path = webPath(scp[2]);
      return {
        cloneUrl: raw,
        webUrl: path ? `https://${scp[1]}/${path}` : null,
        isGithub: scp[1] === "github.com",
      };
    }
  }
  return { cloneUrl: raw, webUrl: null, isGithub: false };
}
