import { useEffect, useRef, useState } from "react";
import type { Priority, Status, Ticket } from "../domain/tickets.ts";
import { priorities, statuses } from "../domain/tickets.ts";

export function TicketDialog({
  ticket,
  assignees,
  onClose,
  onUpdate,
  onNote,
}: {
  ticket: Ticket;
  assignees: string[];
  onClose: () => void;
  onUpdate: (
    changes: Partial<Pick<Ticket, "status" | "priority" | "assignee">>,
  ) => void;
  onNote: (note: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="ticket-heading"
      className="ticket-dialog"
    >
      <header className="dialog-header">
        <span className="mono">{ticket.id}</span>
        <button
          autoFocus
          onClick={() => ref.current?.close()}
          aria-label="Close ticket"
        >
          Close <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="dialog-body">
        <p className="eyebrow">
          {ticket.category} / {ticket.customer}
        </p>
        <h2 id="ticket-heading">{ticket.title}</h2>
        <p className="description">{ticket.description}</p>
        <div className="detail-fields">
          <label>
            Status
            <select
              value={ticket.status}
              onChange={(e) => onUpdate({ status: e.target.value as Status })}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={ticket.priority}
              onChange={(e) =>
                onUpdate({ priority: e.target.value as Priority })
              }
            >
              {priorities.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Assignee
            <select
              value={ticket.assignee}
              onChange={(e) => onUpdate({ assignee: e.target.value })}
            >
              {assignees.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
        <section aria-labelledby="activity-heading">
          <h3 id="activity-heading">Activity</h3>
          <ol className="activity">
            {ticket.activity
              .slice()
              .reverse()
              .map((a, index) => (
                <li key={`${a.at}-${index}`}>
                  <span>{a.text}</span>
                  <time dateTime={a.at}>
                    {new Date(a.at).toLocaleString("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </time>
                </li>
              ))}
          </ol>
        </section>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) {
              onNote(note);
              setNote("");
            }
          }}
        >
          <label htmlFor="note">Internal note</label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="Add context for the next person…"
            rows={3}
          />
          <div className="note-actions">
            <span>{note.length}/1000</span>
            <button className="primary" disabled={!note.trim()}>
              Add note
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
