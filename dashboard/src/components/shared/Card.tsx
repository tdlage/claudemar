interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className = "", onClick }: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-lg p-4 ${onClick ? "cursor-pointer hover:border-border-hover transition-colors" : ""} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
