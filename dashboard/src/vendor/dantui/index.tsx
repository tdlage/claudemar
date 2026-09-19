import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";

export type Tone =
  "neutral" | "info" | "success" | "warning" | "danger" | "brand";
export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?:
    "default" | "primary" | "secondary" | "ghost" | "destructive" | "success";
  loading?: boolean;
  size?: "sm" | "md";
};
export function Button({
  variant = "secondary",
  loading = false,
  size = "md",
  children,
  className = "",
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  const labelId = useId();
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-labelledby={
        props["aria-labelledby"] ||
        (loading && !props["aria-label"] ? labelId : undefined)
      }
      className={`dt-button dt-button--${variant === "default" ? "secondary" : variant} dt-button--${size} ${className}`}
    >
      <span
        id={labelId}
        className="dt-button-label"
        style={loading ? { visibility: "hidden" } : undefined}
      >
        {children}
      </span>
      {loading && (
        <span className="dt-button-loader" aria-hidden="true">
          <Spinner />
        </span>
      )}
    </button>
  );
}
export function Spinner() {
  return <span className="dt-spinner" aria-hidden="true" />;
}
export function Input({
  className = "",
  ...props
}: ComponentPropsWithRef<"input">) {
  return <input {...props} className={`dt-input ${className}`} />;
}
export function Textarea({
  className = "",
  ...props
}: ComponentPropsWithRef<"textarea">) {
  return (
    <textarea {...props} className={`dt-input dt-textarea ${className}`} />
  );
}
export function Select({
  className = "",
  ...props
}: ComponentPropsWithRef<"select">) {
  return <select {...props} className={`dt-input dt-select ${className}`} />;
}
/** IDs and descriptions are supplied to a render prop so labels never guess their control. */
export function Field({
  label,
  hint,
  error,
  children,
  id: suppliedId,
}: {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
  }) => ReactNode;
}) {
  const generatedId = useId(),
    id = suppliedId || generatedId;
  return (
    <div className="dt-field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        "aria-describedby": error || hint ? `${id}-description` : undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {(error || hint) && (
        <p
          id={`${id}-description`}
          className={error ? "dt-field-error" : "dt-field-hint"}
        >
          {error ? `! ${error}` : hint}
        </p>
      )}
    </div>
  );
}
type CheckProps = Omit<ComponentPropsWithRef<"input">, "type"> & {
  label: string;
  hint?: string;
};
function Check({
  label,
  hint,
  className = "",
  id: suppliedId,
  kind,
  ...props
}: CheckProps & { kind: "checkbox" | "radio" | "switch" }) {
  const generatedId = useId(),
    id = suppliedId || generatedId;
  return (
    <div className="dt-check-field">
      <label className={`dt-check ${className}`} htmlFor={id}>
        <input
          {...props}
          id={id}
          aria-describedby={
            [props["aria-describedby"], hint ? `${id}-hint` : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
          type={kind === "radio" ? "radio" : "checkbox"}
          role={kind === "switch" ? "switch" : undefined}
          className={`dt-check-input dt-check-input--${kind}`}
        />
        <span>{label}</span>
      </label>
      {hint && (
        <p id={`${id}-hint`} className="dt-field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
export function Checkbox(props: CheckProps) {
  return <Check {...props} kind="checkbox" />;
}
export function Radio(props: CheckProps) {
  return <Check {...props} kind="radio" />;
}
export function Switch(props: CheckProps) {
  return <Check {...props} kind="switch" />;
}
export function Badge({
  tone = "neutral",
  variant = "outline",
  children,
  className = "",
  ...props
}: ComponentPropsWithRef<"span"> & {
  tone?: Tone;
  variant?: "solid" | "outline";
}) {
  return (
    <span
      {...props}
      className={`dt-badge dt-tone-${tone} dt-badge--${variant} ${className}`}
    >
      {children}
    </span>
  );
}
export function Card({
  title,
  eyebrow,
  footer,
  children,
  className = "",
  ...props
}: Omit<ComponentPropsWithRef<"section">, "title"> & {
  title?: string;
  eyebrow?: string;
  footer?: ReactNode;
}) {
  return (
    <section {...props} className={`dt-card ${className}`}>
      {eyebrow && <div className="dt-card-eyebrow">{eyebrow}</div>}
      <div className="dt-card-body">
        {title && <h3>{title}</h3>}
        {children}
      </div>
      {footer && <footer className="dt-card-footer">{footer}</footer>}
    </section>
  );
}
export function Alert({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  ...props
}: Omit<ComponentPropsWithRef<"div">, "title"> & {
  tone?: Tone;
  title: string;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  const symbol = {
    neutral: "·",
    info: "i",
    success: "✓",
    warning: "!",
    danger: "×",
    brand: "◇",
  }[tone];
  return (
    <div
      {...props}
      className={`dt-alert dt-tone-${tone} ${props.className || ""}`}
      role={props.role || (tone === "danger" ? "alert" : "status")}
    >
      <span className="dt-alert-icon" aria-hidden="true">
        {symbol}
      </span>
      <div className="dt-alert-copy">
        <strong>{title}</strong>
        {children && <div>{children}</div>}
      </div>
      {action}
      {onDismiss && (
        <Button
          variant="ghost"
          aria-label={`Dispensar: ${title}`}
          onClick={onDismiss}
        >
          ×
        </Button>
      )}
    </div>
  );
}
export function Progress({ value, label }: { value: number; label: string }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className="dt-progress">
      <label>
        {label}
        <progress aria-label={label} max={100} value={safe} />
      </label>
      <span>{Math.round(safe)}%</span>
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="dt-empty">
      <span aria-hidden="true">◇</span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
/** Native modal supplies inert background, focus containment and Escape behavior. */
export function Dialog({
  title,
  children,
  close,
  description,
  footer,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  description?: string;
  footer?: ReactNode;
}) {
  const id = useId(),
    ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dt-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) =>
            element.getClientRects().length > 0 && !element.closest("[hidden]"),
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <header className="dt-dialog-header">
        <h2 id={`${id}-title`}>{title}</h2>
        <Button variant="ghost" onClick={close} aria-label="Fechar janela">
          ×
        </Button>
      </header>
      {description && (
        <p className="dt-dialog-description" id={`${id}-description`}>
          {description}
        </p>
      )}
      <div className="dt-dialog-body">{children}</div>
      {footer && <footer className="dt-dialog-footer">{footer}</footer>}
    </dialog>
  );
}
export function Window({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
}) {
  const [minimized, setMinimized] = useState(false),
    [maximized, setMaximized] = useState(false);
  const id = useId();
  return (
    <section
      className={`dt-window ${maximized ? "dt-window--maximized" : ""}`}
      aria-label={title}
    >
      <header className="dt-window-header">
        <strong>{title}</strong>
        <div>
          <Button
            size="sm"
            aria-label={minimized ? "Restaurar conteúdo" : "Minimizar janela"}
            aria-expanded={!minimized}
            aria-controls={id}
            onClick={() => setMinimized(!minimized)}
          >
            −
          </Button>
          <Button
            size="sm"
            aria-label={maximized ? "Restaurar tamanho" : "Expandir janela"}
            aria-pressed={maximized}
            onClick={() => setMaximized(!maximized)}
          >
            □
          </Button>
          {onClose && (
            <Button size="sm" aria-label={`Fechar ${title}`} onClick={onClose}>
              ×
            </Button>
          )}
        </div>
      </header>
      <div id={id} hidden={minimized}>
        <div className="dt-window-body">{children}</div>
        {footer && <footer className="dt-window-footer">{footer}</footer>}
      </div>
    </section>
  );
}
export type TabItem = {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
};
export function Tabs({
  items,
  label,
  variant = "horizontal",
  defaultValue,
}: {
  items: TabItem[];
  label: string;
  variant?: "horizontal" | "segmented";
  defaultValue?: string;
}) {
  const id = useId(),
    [selected, setSelected] = useState(
      defaultValue || items.find((t) => !t.disabled)?.id,
    );
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const active =
    items.find((t) => t.id === selected && !t.disabled)?.id ||
    items.find((t) => !t.disabled)?.id;
  return (
    <div className={`dt-tabs dt-tabs--${variant}`}>
      <div className="dt-tablist" role="tablist" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node);
              else refs.current.delete(item.id);
            }}
            type="button"
            role="tab"
            id={`${id}-${item.id}`}
            aria-controls={`${id}-panel-${item.id}`}
            aria-selected={active === item.id}
            tabIndex={active === item.id ? 0 : -1}
            disabled={item.disabled}
            onClick={() => setSelected(item.id)}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const enabled = items.filter((t) => !t.disabled);
              const index = enabled.findIndex((t) => t.id === item.id);
              const next =
                enabled[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? enabled.length - 1
                      : (index +
                          (e.key === "ArrowRight" ? 1 : -1) +
                          enabled.length) %
                        enabled.length
                ];
              if (next) {
                setSelected(next.id);
                refs.current.get(next.id)?.focus();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          className="dt-tabpanel"
          key={item.id}
          id={`${id}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${id}-${item.id}`}
          tabIndex={0}
          hidden={active !== item.id}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
};
export function Table<T>({
  rows,
  columns,
  rowKey,
  caption,
  pageSize = 5,
  loading = false,
  emptyAction,
  selectable = false,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  caption: string;
  pageSize?: number;
  loading?: boolean;
  emptyAction?: ReactNode;
  selectable?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>(),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const size = Math.max(1, Math.floor(pageSize) || 5);
  const last = Math.max(0, Math.ceil(rows.length / size) - 1),
    current = Math.min(page, last);
  const column = columns.find((c) => c.key === sort?.key);
  const ordered = column?.sortValue
    ? [...rows].sort((a, b) => {
        const av = column.sortValue!(a),
          bv = column.sortValue!(b);
        return (
          (typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv))) * (sort?.desc ? -1 : 1)
        );
      })
    : rows;
  const visible = ordered.slice(current * size, (current + 1) * size);
  const rowKeysSignature = JSON.stringify(rows.map(rowKey));
  useEffect(() => {
    const keys = new Set<string>(JSON.parse(rowKeysSignature));
    setPage(0);
    setSelected(
      (previous) => new Set([...previous].filter((key) => keys.has(key))),
    );
  }, [rowKeysSignature]);
  return (
    <div className="dt-table-container" aria-busy={loading}>
      <div
        className="dt-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={caption}
      >
        <table className="dt-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              {selectable && <th scope="col">Seleção</th>}
              {columns.map((c) => (
                <th
                  scope="col"
                  key={c.key}
                  aria-sort={
                    c.sortValue
                      ? sort?.key === c.key
                        ? sort.desc
                          ? "descending"
                          : "ascending"
                        : "none"
                      : undefined
                  }
                >
                  {c.sortValue ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSort({
                          key: c.key,
                          desc: sort?.key === c.key ? !sort.desc : false,
                        });
                        setPage(0);
                      }}
                    >
                      {c.header}{" "}
                      {sort?.key === c.key ? (sort.desc ? "↓" : "↑") : "↕"}
                    </Button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)}>
                  <div className="dt-table-loading">
                    <Spinner /> Carregando registros…
                  </div>
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  data-selected={selected.has(rowKey(row)) || undefined}
                >
                  {selectable && (
                    <td>
                      <Checkbox
                        label={`Selecionar ${rowKey(row)}`}
                        checked={selected.has(rowKey(row))}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelected((prev) => {
                            const next = new Set(prev);
                            checked
                              ? next.add(rowKey(row))
                              : next.delete(rowKey(row));
                            return next;
                          });
                        }}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key}>{c.render(row)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && !rows.length && (
        <EmptyState title="Nenhum resultado encontrado" action={emptyAction}>
          Tente outro termo ou limpe os filtros.
        </EmptyState>
      )}
      <div className="dt-table-footer">
        <span>
          {rows.length
            ? `${current * size + 1}–${Math.min((current + 1) * size, rows.length)} de ${rows.length}`
            : "0 resultados"}
          {selectable && selected.size
            ? ` · ${selected.size} selecionados`
            : ""}
        </span>
        <div>
          <Button
            size="sm"
            disabled={current === 0 || loading}
            aria-label="Página anterior"
            onClick={() => setPage(current - 1)}
          >
            ←
          </Button>
          <span aria-live="polite">
            {current + 1} / {last + 1}
          </span>
          <Button
            size="sm"
            disabled={current === last || loading}
            aria-label="Próxima página"
            onClick={() => setPage(current + 1)}
          >
            →
          </Button>
        </div>
      </div>
    </div>
  );
}
export type LogEntry = {
  id: string;
  time: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};
export function LogStream({
  entries,
  label = "Registro de execução",
  maxEntries = 200,
}: {
  entries: LogEntry[];
  label?: string;
  maxEntries?: number;
}) {
  const ref = useRef<HTMLDivElement>(null),
    following = useRef(true);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (following.current && ref.current)
      ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries]);
  return (
    <div>
      <div
        ref={ref}
        className="dt-log"
        role="log"
        aria-label={label}
        aria-live="off"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 32;
          setPaused(!following.current);
        }}
      >
        {entries.slice(-Math.max(1, maxEntries)).map((e) => (
          <div
            key={e.id}
            className={`dt-log-line dt-tone-${e.level === "error" ? "danger" : e.level}`}
          >
            <time>{e.time}</time>
            <span>[{e.level.toUpperCase()}]</span>
            <span>{e.message}</span>
          </div>
        ))}
      </div>
      {paused && (
        <Button
          size="sm"
          onClick={() => {
            following.current = true;
            setPaused(false);
            if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
          }}
        >
          Ir para as últimas linhas ↓
        </Button>
      )}
    </div>
  );
}
/** Commands are handled by the consumer; this component never evaluates code or opens a network connection. */
export function Terminal({
  entries,
  onCommand,
  busy = false,
  label = "Terminal",
}: {
  entries: LogEntry[];
  onCommand: (command: string) => void;
  busy?: boolean;
  label?: string;
}) {
  const [command, setCommand] = useState(""),
    [history, setHistory] = useState<string[]>([]);
  const cursor = useRef(0);
  return (
    <div className="dt-terminal">
      <LogStream entries={entries} label={label} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!command.trim() || busy) return;
          const next = command.trim();
          setHistory((h) => [...h, next].slice(-50));
          cursor.current = 0;
          setCommand("");
          onCommand(next);
        }}
      >
        <span aria-hidden="true">›</span>
        <Input
          aria-label="Comando"
          autoComplete="off"
          spellCheck={false}
          placeholder="Digite help para começar"
          value={command}
          disabled={busy}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              cursor.current = Math.max(
                0,
                Math.min(
                  history.length,
                  cursor.current + (e.key === "ArrowUp" ? 1 : -1),
                ),
              );
              setCommand(
                cursor.current ? history[history.length - cursor.current] : "",
              );
            }
          }}
        />
        <Button type="submit" loading={busy} disabled={!command.trim()}>
          Executar ↵
        </Button>
      </form>
    </div>
  );
}
