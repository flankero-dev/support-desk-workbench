import type { Dispatch, SetStateAction, RefObject } from "react";
import type { Ticket } from "../domain/tickets.ts";
const cls = (text: string) => text.toLowerCase().replaceAll(" ", "-");
export function RequestTable({
  visible,
  selected,
  setSelected,
  openButtons,
  onOpen,
}: {
  visible: Ticket[];
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
  openButtons: RefObject<Map<string, HTMLButtonElement>>;
  onOpen: (id: string) => void;
}) {
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label="Request table"
      tabIndex={0}
    >
      <table>
        <caption className="sr-only">
          Filtered customer requests. Open a request to view details and update
          it.
        </caption>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                aria-label="Select visible requests"
                disabled={!visible.length}
                ref={(input) => {
                  if (input)
                    input.indeterminate =
                      visible.some((t) => selected.includes(t.id)) &&
                      !visible.every((t) => selected.includes(t.id));
                }}
                checked={
                  visible.length > 0 &&
                  visible.every((t) => selected.includes(t.id))
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? Array.from(
                          new Set([...selected, ...visible.map((t) => t.id)]),
                        )
                      : selected.filter(
                          (id) => !visible.some((t) => t.id === id),
                        ),
                  )
                }
              />
            </th>
            <th scope="col">Request</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Assignee</th>
            <th scope="col">Created (UTC)</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((t) => (
            <tr key={t.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select ${t.id}`}
                  checked={selected.includes(t.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, t.id]
                        : ids.filter((id) => id !== t.id),
                    )
                  }
                />
              </td>
              <td>
                <div className="request-line">
                  <span className="mono">{t.id}</span>
                  <button
                    ref={(el) => {
                      if (el) openButtons.current.set(t.id, el);
                      else openButtons.current.delete(t.id);
                    }}
                    className="request-title"
                    onClick={() => onOpen(t.id)}
                  >
                    {t.title}
                  </button>
                </div>
                <div className="request-meta">
                  {t.customer}
                  <span>·</span>
                  {t.category}
                </div>
              </td>
              <td>
                <span className={`status ${cls(t.status)}`}>
                  <span aria-hidden="true" />
                  {t.status}
                </span>
              </td>
              <td>
                <span className={`priority ${cls(t.priority)}`}>
                  <span aria-hidden="true">
                    {t.priority === "Urgent" ? "!" : "▰"}
                  </span>
                  {t.priority}
                </span>
              </td>
              <td>
                <span className="assignee">
                  {t.assignee !== "Unassigned" && (
                    <span className="avatar" aria-hidden="true">
                      {t.assignee.slice(0, 1)}
                    </span>
                  )}
                  {t.assignee}
                </span>
              </td>
              <td>
                <time dateTime={t.createdAt}>
                  {new Date(t.createdAt).toLocaleDateString("en-GB", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
