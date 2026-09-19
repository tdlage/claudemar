# DANTUI

Owned, dependency-light React interface library for Day & Night. The ten DAN-151
reference sheets define its visual vocabulary: warm white, lilac focus, mint/sand/coral
states, monospaced content, thin rails, native controls and compact windows.

## Consume

```tsx
import { Button, Field, Input, Card } from "@dayandnight/dantui";
import "@dayandnight/dantui/styles.css";

<Card title="Project">
  <Field label="Name" hint="Choose a recognizable name.">
    {(props) => <Input {...props} required />}
  </Field>
  <Button type="submit" variant="primary">
    Save
  </Button>
</Card>;
```

React 19 is a peer, not bundled. CSS has no global reset; selectors use `dt-`.
Set `data-theme="paper"` on the document or `data-dantui-theme="paper"` on a subtree.
Default is Bridge. Override `--dt-*` semantic variables for a host theme. The font
stack uses the host's Plex Mono when loaded and system monospace otherwise.

`npm run build --workspace @dayandnight/dantui` produces an ESM entry and TypeScript
declarations. `npm pack --workspace @dayandnight/dantui` produces an installable
archive; this task does not publish to an external registry. Consumers import only
needed exports; React is external and bundlers can tree-shake unused components.
The product's catalog is lazy-loaded at `#/dantui`.

## API and ownership

| Family   | Exports / behavior                                                                               |
| -------- | ------------------------------------------------------------------------------------------------ |
| Actions  | `Button`, `Spinner`; primary/secondary/ghost/destructive/success, sm/md, loading                 |
| Fields   | `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`; native props and refs     |
| Cards    | `Card`, `EmptyState`, `Progress`; title, eyebrow, footer and content slots                       |
| Windows  | `Window`; local minimize/restore, expand to containing grid, optional close callback             |
| Alerts   | `Alert`; six semantic tones, action slot, optional dismiss callback                              |
| Tabs     | `Tabs`; IDs, labels, mounted panels, disabled items, arrow/Home/End navigation                   |
| Badges   | `Badge`; neutral/info/success/warning/danger/brand; solid or outline                             |
| Tables   | `Table<T>`, `Column<T>`; stable row keys, sorting, pagination, optional selection, loading/empty |
| Dialogs  | `Dialog`; mount to open, close callback unmounts, native modal and focus restoration             |
| Terminal | `Terminal`, `LogStream`, `LogEntry`; literal command callback, 50-command history, bounded logs  |

Keep business rules, persistence and network calls in the consumer. Callbacks never
perform server actions. Examples are explicitly local/demo. Windows expand in their
parent grid, not fullscreen, and are not a draggable desktop/window manager.
Tables paginate client-side; use stable row IDs and controlled filtering upstream.
For very large remote datasets, fetch bounded pages upstream rather than passing an
entire database. Selection is local presentation state and is pruned when rows leave
the input dataset. No bulk mutation semantics are implied.

LogStream renders at most 200 entries (configurable); producers must also cap their
buffers. It follows new entries only while the reader remains at the bottom and
provides a resume action. `aria-live=off` deliberately avoids flooding screen readers;
the log is labeled and keyboard scrollable. Terminal never evaluates shell or JS.

Field's render prop wires a unique ID and hint/error description. Supply meaningful
labels, recovery copy and an accessible name for icon-only buttons. Native required,
input type and constraint validation remain available. Loading buttons retain label
geometry and block duplicate submissions. Callers should provide surrounding live
feedback for long actions. Radio inputs in a group must share a name.

## Design and verification

Spacing: 4/8/12/16/24/32. Desktop controls: 40px (32px compact); mobile: 44px.
Body: 14px; mobile inputs: 16px. Focus: 2px lilac with 3px offset. Corners: 4px
controls, 8px cards/dialogs, square windows. Motion is limited to a spinner and stops
for reduced motion. Reference border and secondary colors were lifted where needed
for readable controls; Bridge and Paper use separate semantic colors.

`src/ui/dantui.test.tsx` exercises behavioral contracts. Browser evidence and rendered
contrast results are linked from `docs/tasks/TASK-DAN-151.md`. Existing Central/chat
consume this package via the compatibility facade at `src/ui`, retaining their domain
layout. The library replaces the former WebTUI dependency.
