import { useState, type ReactNode } from "react";

interface DropdownProps {
  triggerContent: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  align?: "left" | "right";
  direction?: "up" | "down";
  menuClassName?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}

export function Dropdown({
  triggerContent,
  triggerClassName,
  triggerTitle,
  align = "left",
  direction = "down",
  menuClassName,
  children,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} title={triggerTitle} className={triggerClassName}>
        {triggerContent}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div
            className={`absolute ${direction === "up" ? "bottom-full mb-1" : "top-full mt-1"} ${
              align === "right" ? "right-0" : "left-0"
            } rounded-md border border-border bg-surface shadow-lg z-20 py-1 ${menuClassName ?? ""}`}
          >
            {typeof children === "function" ? children(close) : children}
          </div>
        </>
      )}
    </div>
  );
}
