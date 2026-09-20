import { useId, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ListFilter,
} from "lucide-react";

export interface SidebarGroup {
  id: string;
  label: string;
  compact?: boolean;
  action?: ReactNode;
  content: ReactNode;
}

interface Preferences {
  order: string[];
  collapsed: string[];
}

function readPreferences(storageKey: string): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    const strings = (value: unknown): string[] =>
      Array.isArray(value)
        ? [
            ...new Set(
              value.filter((item): item is string => typeof item === "string"),
            ),
          ]
        : [];
    return {
      order: strings(saved?.order),
      collapsed: strings(saved?.collapsed),
    };
  } catch {
    return { order: [], collapsed: [] };
  }
}

export function SidebarGroups({
  groups,
  expanded,
  storageKey,
}: {
  groups: SidebarGroup[];
  expanded: boolean;
  storageKey: string;
}) {
  const [preferences, setPreferences] = useState(() =>
    readPreferences(storageKey),
  );
  const [organizing, setOrganizing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const prefix = useId();
  const order = [
    ...new Set([...preferences.order, ...groups.map((group) => group.id)]),
  ];
  const sorted = order.flatMap((id) =>
    groups.filter((group) => group.id === id),
  );

  function save(next: Preferences) {
    setPreferences(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setAnnouncement(
        "A organização foi aplicada, mas não pôde ser salva neste navegador.",
      );
    }
  }

  function move(group: SidebarGroup, direction: number) {
    const position = sorted.findIndex((item) => item.id === group.id);
    const neighbor = sorted[position + direction];
    if (!neighbor) return;
    const nextOrder = [...order];
    const from = nextOrder.indexOf(group.id);
    const to = nextOrder.indexOf(neighbor.id);
    [nextOrder[from], nextOrder[to]] = [nextOrder[to], nextOrder[from]];
    setAnnouncement(
      `${group.label}: posição ${position + direction + 1} de ${sorted.length}.`,
    );
    save({ ...preferences, order: nextOrder });
  }

  return (
    <>
      {expanded && (
        <div className="sidebar-organize">
          <button
            type="button"
            className="sidebar-more"
            aria-pressed={organizing}
            onClick={() => setOrganizing(!organizing)}
          >
            {organizing ? <Check size={14} /> : <ListFilter size={14} />}
            {organizing ? "Concluir organização" : "Organizar menu"}
          </button>
        </div>
      )}
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {sorted
        .filter((group) => expanded || group.compact)
        .map((group, index) => {
          const closed = expanded && preferences.collapsed.includes(group.id);
          const contentId = `${prefix}-${group.id}`;
          return (
            <section
              key={group.id}
              className="sidebar-group"
              aria-label={group.label}
            >
              {expanded && (
                <div className="sidebar-section-heading">
                  <button
                    type="button"
                    className="sidebar-group-toggle"
                    aria-expanded={!closed}
                    aria-controls={contentId}
                    onClick={() =>
                      save({
                        ...preferences,
                        collapsed: closed
                          ? preferences.collapsed.filter(
                              (id) => id !== group.id,
                            )
                          : [...preferences.collapsed, group.id],
                      })
                    }
                  >
                    {closed ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    <span className="sidebar-label">{group.label}</span>
                  </button>
                  {organizing ? (
                    <div className="sidebar-group-move">
                      <button
                        type="button"
                        className="icon-button small"
                        aria-label={`Mover ${group.label} para cima`}
                        title="Mover para cima"
                        aria-disabled={index === 0}
                        onClick={() => move(group, -1)}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button small"
                        aria-label={`Mover ${group.label} para baixo`}
                        title="Mover para baixo"
                        aria-disabled={index === sorted.length - 1}
                        onClick={() => move(group, 1)}
                      >
                        <ArrowDown size={15} />
                      </button>
                    </div>
                  ) : (
                    group.action
                  )}
                </div>
              )}
              <div id={contentId} hidden={closed}>
                {group.content}
              </div>
            </section>
          );
        })}
    </>
  );
}
