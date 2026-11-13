import { useEffect, useRef, useState } from "react";
import type { Priority, Status, Ticket } from "../domain/tickets.ts";
import { priorities, statuses } from "../domain/tickets.ts";

export function TicketDialog({
  ticket,
  assignees,
  onClose,
  onUpdate,
  onNote,
  storageWarning,
  initialNote,
  onDraft,
}: {
  ticket: Ticket;
  storageWarning: string;
  initialNote: string;
  onDraft: (note: string) => void;
  assignees: string[];
  onClose: () => void;
  onUpdate: (
    changes: Partial<Pick<Ticket, "status" | "priority" | "assignee">>,
  ) => void;
  onNote: (note: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState(initialNote);
  const [historyPage, setHistoryPage] = useState(0);
  const historySize = 50;
  const pageCount = Math.max(
    1,
    Math.ceil(ticket.activity.length / historySize),
  );
  const history = ticket.activity
    .slice(
      Math.max(0, ticket.activity.length - (historyPage + 1) * historySize),
      ticket.activity.length - historyPage * historySize,
    )
    .reverse();
  const dateFormat = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const [error, setError] = useState("");
  function update(
    changes: Partial<Pick<Ticket, "status" | "priority" | "assignee">>,
  ) {
    try {
      onUpdate(changes);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The request was not changed.",
      );
    }
  }
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
              onChange={(e) => update({ status: e.target.value as Status })}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={ticket.priority}
              onChange={(e) => update({ priority: e.target.value as Priority })}
            >
              {priorities.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignee
            <select
              value={ticket.assignee}
              onChange={(e) => update({ assignee: e.target.value })}
            >
              {assignees.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
        {storageWarning && (
          <p className="warning" role="status">
            {storageWarning}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <section aria-labelledby="activity-heading">
          <h3 id="activity-heading">Activity</h3>
          <ol className="activity">
            {history.map((a, index) => (
              <li key={`${a.at}-${index}`}>
                <span>{a.text}</span>
                <time dateTime={a.at}>
                  {dateFormat.format(new Date(a.at))} UTC
                </time>
              </li>
            ))}
          </ol>
          <p>
            {ticket.activity.length} activity entries. Page {historyPage + 1} of{" "}
            {pageCount}. Export includes the complete history.
          </p>
          {pageCount > 1 && (
            <div className="pagination">
              <button
                disabled={historyPage === 0}
                onClick={() => setHistoryPage((p) => p - 1)}
              >
                Newer activity
              </button>
              <button
                disabled={historyPage + 1 >= pageCount}
                onClick={() => setHistoryPage((p) => p + 1)}
              >
                Older activity
              </button>
            </div>
          )}
        </section>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) {
              try {
                onNote(note);
                setNote("");
                onDraft("");
                setHistoryPage(0);
                setError("");
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "The note was not added.",
                );
              }
            }
          }}
        >
          <label htmlFor="note">Internal note</label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              onDraft(e.target.value);
            }}
            maxLength={1000}
            placeholder="Add context for the next person…"
            rows={3}
          />
          <div className="note-actions">
            <span>
              {note.length}/1000 · Unsent draft stays in this tab when closed.
            </span>
            <button className="primary" disabled={!note.trim()}>
              Add note
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
