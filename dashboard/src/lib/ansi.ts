const ANSI_COLORS: Record<number, string> = {
  30: "#1e1e1e", 31: "#f87171", 32: "#4ade80", 33: "#facc15",
  34: "#60a5fa", 35: "#c084fc", 36: "#22d3ee", 37: "#e4e4e7",
  90: "#71717a", 91: "#fca5a5", 92: "#86efac", 93: "#fde68a",
  94: "#93c5fd", 95: "#d8b4fe", 96: "#67e8f9", 97: "#ffffff",
};

export function ansiToHtml(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  let openSpans = 0;

  html = html.replace(/\x1b\[([0-9;]*)m/g, (_, codes: string) => {
    if (!codes || codes === "0") {
      const close = "</span>".repeat(openSpans);
      openSpans = 0;
      return close;
    }

    const parts = codes.split(";").map(Number);
    const styles: string[] = [];

    for (const code of parts) {
      if (code === 1) styles.push("font-weight:bold");
      else if (code === 2) styles.push("opacity:0.7");
      else if (code === 3) styles.push("font-style:italic");
      else if (code === 4) styles.push("text-decoration:underline");
      else if (ANSI_COLORS[code]) styles.push(`color:${ANSI_COLORS[code]}`);
    }

    if (styles.length === 0) return "";

    openSpans++;
    return `<span style="${styles.join(";")}">`;
  });

  html += "</span>".repeat(openSpans);

  return html;
}
