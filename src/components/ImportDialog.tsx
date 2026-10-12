import { useEffect, useRef, useState } from "react";
import { parseImport, workspaceByteLimit } from "../domain/tickets.ts";
import type { Ticket } from "../domain/tickets.ts";
export function ImportDialog({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (tickets: Ticket[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const readVersion = useRef(0);
  useEffect(() => {
    ref.current?.showModal();
    return () => {
      readVersion.current += 1;
    };
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="import-heading">
      <div className="dialog-body">
        <h2 id="import-heading">Restore workspace</h2>
        <p>
          Choose an exported JSON file or paste its contents. Valid data
          replaces all requests in this browser. Export a backup first to keep
          the current workspace. Limit: 500 requests and 2 MB of JSON.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              onImport(parseImport(text));
              ref.current?.close();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Import failed.");
            }
          }}
        >
          <label htmlFor="import-file">Exported workspace file</label>
          <input
            id="import-file"
            type="file"
            accept=".json,application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const version = ++readVersion.current;
              setText("");
              setFileName("");
              setError("");
              setBusy(true);
              try {
                if (file.size > workspaceByteLimit)
                  throw new Error(
                    "Workspace JSON is limited to 2 MB (2 million UTF-8 bytes).",
                  );
                const content = await file.text();
                parseImport(content);
                if (version === readVersion.current) {
                  setText(content);
                  setFileName(file.name);
                }
              } catch (cause) {
                if (version === readVersion.current)
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "The file could not be read.",
                  );
              } finally {
                if (version === readVersion.current) setBusy(false);
              }
            }}
          />
          {busy && <p role="status">Reading workspace file…</p>}
          {fileName && (
            <p role="status">
              Loaded {fileName}. Review the JSON below before replacing the
              workspace.
            </p>
          )}
          <label htmlFor="import-json">Workspace JSON</label>
          <textarea
            autoFocus
            id="import-json"
            value={text}
            disabled={busy}
            maxLength={2_000_001}
            onChange={(e) => {
              setText(e.target.value);
              setFileName("");
              setError("");
            }}
            rows={8}
            spellCheck={false}
          />
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <button className="primary" disabled={busy || !text.trim()}>
              Replace workspace
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
