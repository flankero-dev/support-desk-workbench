import { useEffect, useRef, useState } from "react";
import { exportTickets, parseImport } from "../domain/tickets.ts";
import type { Ticket } from "../domain/tickets.ts";
export function ServerSnapshotDialog({
  tickets,
  onLoad,
  onClose,
}: {
  tickets: Ticket[];
  onLoad: (tickets: Ticket[]) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<{
    tickets: Ticket[];
    etag: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, []);
  async function request(save: boolean) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 10000);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/workspace", {
        method: save ? "PUT" : "GET",
        headers: save
          ? { "Content-Type": "application/json", "If-Match": snapshot!.etag }
          : {},
        ...(save ? { body: exportTickets(tickets) } : {}),
        signal: abort.signal,
      });
      if (response.status === 412) {
        setSnapshot(null);
        throw new Error(
          "The server copy changed. Refresh it and compare before saving again. Your browser copy is unchanged.",
        );
      }
      if (!response.ok)
        throw new Error(
          `Server returned ${response.status}. Run npm run start locally to use server snapshots.`,
        );
      const etag = response.headers.get("ETag");
      if (!etag || !/^"[1-9]\d*"$/.test(etag))
        throw new Error("The server did not provide a valid revision.");
      const next = parseImport(await response.text());
      if (abort.signal.aborted) return;
      setSnapshot({ tickets: next, etag });
      setMessage(
        save
          ? "Saved to SQLite. Browser changes are not automatically synced."
          : "Server copy loaded for comparison. Your browser copy is unchanged.",
      );
    } catch (cause) {
      if (controller.current === abort)
        setError(
          abort.signal.aborted
            ? "Request timed out or was cancelled. Retry when the server is available."
            : cause instanceof Error
              ? cause.message
              : "Unable to contact the server.",
        );
    } finally {
      window.clearTimeout(timer);
      if (controller.current === abort) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="server-heading"
      className="ticket-dialog"
    >
      <header className="dialog-header">
        <h2 id="server-heading">Server snapshot</h2>
        <button
          autoFocus
          onClick={() => dialog.current?.close()}
          aria-label="Close server snapshot"
        >
          Close ×
        </button>
      </header>
      <div className="dialog-body">
        <p>
          Optional local server backup. Refresh to compare a saved revision,
          then save this browser copy or replace it with the server copy.
        </p>
        <p>
          The hosted GitHub Pages demo has browser storage only. Server
          snapshots require the included Node.js server.
        </p>
        <p>
          Browser copy: {tickets.length} requests.{" "}
          {snapshot && (
            <>
              Server copy: {snapshot.tickets.length} requests · revision{" "}
              {snapshot.etag.replaceAll('"', "")}.
            </>
          )}
        </p>
        {snapshot && (
          <p>
            Server statuses:{" "}
            {snapshot.tickets.filter((t) => t.status === "Open").length} open,{" "}
            {snapshot.tickets.filter((t) => t.status === "Resolved").length}{" "}
            resolved.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <div className="header-actions">
          <button disabled={busy} onClick={() => void request(false)}>
            Refresh server copy
          </button>
          <button
            disabled={busy || !snapshot}
            onClick={() => void request(true)}
          >
            Save browser copy to server
          </button>
        </div>
        <p>
          Replacing the browser copy discards its current edits. Export a backup
          first.
        </p>
        <button
          disabled={busy || !snapshot}
          onClick={() => {
            if (snapshot) {
              try {
                onLoad(snapshot.tickets);
                dialog.current?.close();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Browser copy was not replaced.",
                );
              }
            }
          }}
        >
          Replace browser copy with server copy
        </button>
        {busy && <p role="status">Contacting server…</p>}
      </div>
    </dialog>
  );
}
