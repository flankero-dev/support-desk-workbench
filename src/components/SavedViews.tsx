import { useEffect, useRef, useState } from "react";
import { addView, readViews, viewsKey } from "../domain/views.ts";
import type { QueueView } from "../domain/views.ts";
import { readFilters, writeFilters } from "../domain/tickets.ts";
import type { Filters } from "../domain/tickets.ts";

function load() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(viewsKey);
    return {
      views: readViews(raw),
      error: "",
      corruptRaw: null as string | null,
    };
  } catch {
    return {
      views: [] as QueueView[],
      corruptRaw: raw,
      error: "Saved views could not be loaded. Existing data has been kept.",
    };
  }
}

export function SavedViews({
  filters,
  onApply,
}: {
  filters: Filters;
  onApply: (filters: Filters) => void;
}) {
  const [state, setState] = useState(load);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const resetRef = useRef<HTMLDialogElement>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const [resetError, setResetError] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const focusAfterRemoval = useRef(false);
  const [lastUsedName, setLastUsedName] = useState<string | null>(
    () =>
      state.views.find((view) => view.search === writeFilters(filters))?.name ??
      null,
  );
  const search = writeFilters(filters);
  const active = state.views.find((view) => view.search === search);
  const filtersChanged =
    !active && state.views.some((view) => view.name === lastUsedName);
  useEffect(() => {
    if (focusAfterRemoval.current) {
      focusAfterRemoval.current = false;
      (selectRef.current ?? nameRef.current)?.focus();
    }
  }, [state.views]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === viewsKey || event.key === null)
      ) {
        setState(load());
        setMessage("Saved views updated from another tab.");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function persist(
    change: (views: QueueView[]) => QueueView[],
    success: string,
  ) {
    try {
      // Refresh before editing instead of saving the tab's possibly stale list.
      const views = change(readViews(localStorage.getItem(viewsKey)));
      localStorage.setItem(viewsKey, JSON.stringify({ version: 1, views }));
      setState({ views, error: "", corruptRaw: null });
      setMessage(success);
      return true;
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Storage is unavailable.";
      setState({ ...load(), error: `Could not save views. ${detail}` });
      setMessage("");
      return false;
    }
  }

  return (
    <div className="saved-views">
      <div className="saved-views-controls">
        {state.views.length > 0 ? (
          <>
            <label htmlFor="saved-view">Saved view</label>
            <select
              id="saved-view"
              ref={selectRef}
              value={active?.name ?? ""}
              onChange={(event) => {
                const view = state.views.find(
                  (item) => item.name === event.target.value,
                );
                if (view) {
                  onApply(readFilters(view.search));
                  setLastUsedName(view.name);
                  setMessage(`Applied ${view.name}.`);
                }
              }}
            >
              <option value="" disabled>
                Choose a view
              </option>
              {state.views.map((view) => (
                <option key={view.name} value={view.name}>
                  {view.name}
                </option>
              ))}
            </select>
            <button
              disabled={!active}
              aria-label={
                active
                  ? `Remove saved view ${active.name}`
                  : "Remove saved view"
              }
              onClick={() => {
                if (
                  active &&
                  persist(
                    (views) =>
                      views.filter((view) => view.name !== active.name),
                    `Removed ${active.name}.`,
                  )
                ) {
                  focusAfterRemoval.current = true;
                  setLastUsedName(null);
                }
              }}
            >
              Remove
            </button>
          </>
        ) : (
          <div className="views-empty">
            <strong>
              {state.corruptRaw !== null
                ? "Saved views unavailable"
                : "No saved views yet"}
            </strong>
            <p>
              {state.corruptRaw !== null
                ? "Reset the unreadable preferences to save views again."
                : "Save your current filters to use them again."}
            </p>
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              persist(
                (views) => addView(views, name, filters),
                `Saved ${name.trim()}.`,
              )
            ) {
              setLastUsedName(name.trim());
              setName("");
            }
          }}
        >
          <label className="sr-only" htmlFor="view-name">
            New view name
          </label>
          <input
            id="view-name"
            ref={nameRef}
            value={name}
            maxLength={40}
            placeholder="View name"
            onChange={(event) => setName(event.target.value)}
            required
          />
          <button type="submit">Save view</button>
        </form>
      </div>
      {state.error && (
        <p role="alert" className="view-error">
          {state.error}
        </p>
      )}
      {state.corruptRaw !== null && (
        <button
          ref={resetButtonRef}
          onClick={() => {
            setResetError("");
            resetRef.current?.showModal();
          }}
        >
          Reset saved views
        </button>
      )}
      <dialog
        ref={resetRef}
        className="reset-views-dialog"
        aria-labelledby="reset-views-heading"
        onClose={() => {
          (
            resetButtonRef.current ??
            selectRef.current ??
            nameRef.current
          )?.focus();
        }}
      >
        <h2 id="reset-views-heading">Reset saved views?</h2>
        <p>
          This discards the unreadable saved view preferences. Requests and
          current filters are kept.
        </p>
        {resetError && <p role="alert">{resetError}</p>}
        <button onClick={() => resetRef.current?.close()}>Cancel</button>
        <button
          onClick={() => {
            try {
              if (localStorage.getItem(viewsKey) !== state.corruptRaw) {
                setState(load());
                setMessage(
                  "Saved views changed in another tab. Inspect the refreshed list before resetting.",
                );
              } else {
                localStorage.removeItem(viewsKey);
                setState({ views: [], error: "", corruptRaw: null });
                setMessage("Saved views reset. You can save a new view.");
              }
              resetRef.current?.close();
            } catch {
              setResetError(
                "Could not reset saved views. Storage is unavailable; existing data has been kept.",
              );
            }
          }}
        >
          Discard saved views
        </button>
      </dialog>
      <p className="view-feedback" role="status">
        {filtersChanged
          ? "Filters changed. Choose a saved view to restore it."
          : message}
      </p>
    </div>
  );
}
