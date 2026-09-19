import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label =
    theme === "bridge"
      ? "Usar tema claro (Paper)"
      : "Usar tema escuro (Bridge)";
  return (
    <button
      type="button"
      className="icon-button"
      onClick={toggle}
      title={label}
      aria-label={label}
    >
      {theme === "bridge" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
