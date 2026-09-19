import { Badge as DantBadge, type Tone } from "../../vendor/dantui";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "accent" | "info";
}

export function Badge({ children, variant = "default" }: BadgeProps) {
  const tone: Tone =
    variant === "default"
      ? "neutral"
      : variant === "accent"
        ? "brand"
        : variant;
  return <DantBadge tone={tone}>{children}</DantBadge>;
}
