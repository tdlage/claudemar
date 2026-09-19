import { Button as DantButton } from "../../vendor/dantui";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <DantButton
      variant={variant === "danger" ? "destructive" : variant}
      size={size === "lg" ? "md" : size}
      className={`${size === "lg" ? "min-h-12 px-5" : ""} ${className}`}
      {...props}
    >
      {children}
    </DantButton>
  );
}
