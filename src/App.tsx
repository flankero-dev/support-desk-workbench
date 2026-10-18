import { RequestTable } from "./components/RequestTable.tsx";
import { QueueFilters } from "./components/QueueFilters.tsx";
import { SavedViews } from "./components/SavedViews.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addNote,
  defaultFilters,
  exportTickets,
  filterTickets,
  readFilters,
  statuses,
  updateTickets,
  writeFilters,
} from "./domain/tickets.ts";
import type { Filters, Status } from "./domain/tickets.ts";
import { createSeed } from "./domain/seed.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { TicketDialog } from "./components/TicketDialog.tsx";
import { ImportDialog } from "./components/ImportDialog.tsx";
import { ServerSnapshotDialog } from "./components/ServerSnapshotDialog.tsx";
import { CreateRequestDialog } from "./components/CreateRequestDialog.tsx";
import { appendRequest } from "./domain/createRequest.ts";
import "./styles.css";
import "./create-request.css";

const pageSize = 8;
export default function App() {
  const {
    tickets,
    setTickets,
    storageWarning,
    storageConflict,
    recoveryRequired,
    recoveryRaw,
    allowRecoveryReplacement,
    persistenceNotice,
  } = useWorkspace();
  const [filters, setFilters] = useState(() =>
    readFilters(window.location.search),
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [noteDrafts, setNoteDrafts] = useState(new Map<string, string>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const newRequestRef = useRef<HTMLButtonElement>(null);
  const [serverSnapshotOpen, setServerSnapshotOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<Status>("In progress");
  const [message, setMessage] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const resetRef = useRef<HTMLDialogElement>(null);
  const supportsServerSnapshots =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const [serverAvailable, setServerAvailable] = useState(false);
  useEffect(() => {
    if (!supportsServerSnapshots) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3000);
    fetch("/api/workspace", { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setServerAvailable(
          response.ok &&
            Boolean(
              response.headers
                .get("Content-Type")
                ?.startsWith("application/json"),
            ) &&
            /^"[1-9]\d*"$/.test(response.headers.get("ETag") ?? ""),
        );
      })
      .catch(() => {})
      .finally(() => window.clearTimeout(timer));
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [supportsServerSnapshots]);
  const openButtons = useRef(new Map<string, HTMLButtonElement>());
  const results = useMemo(
    () => filterTickets(tickets, filters),
    [tickets, filters],
  );
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = results.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const assignees = Array.from(
    new Set(["Unassigned", ...tickets.map((t) => t.assignee)]),
  ).sort();
  const active = tickets.find((t) => t.id === activeId);
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${writeFilters(filters)}${window.location.hash}`,
    );
  }, [filters]);
  useEffect(() => {
    const onPop = () => {
      setFilters(readFilters(window.location.search));
      setPage(1);
      setSelected([]);
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
        !target.isContentEditable &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  function changeFilters(next: Partial<Filters>) {
    setFilters((f) => {
      const updated = { ...f, ...next };
      if ("assignee" in next && !next.assigneeIsExact)
        delete updated.assigneeIsExact;
      return updated;
    });
    setPage(1);
    setSelected([]);
  }
  function exportData() {
    const url = URL.createObjectURL(
      new Blob([exportTickets(tickets)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "support-desk-workspace.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Workspace exported as JSON.");
  }
  const openCount = tickets.filter((t) => t.status === "Open").length;
  const urgentCount = tickets.filter(
    (t) => t.priority === "Urgent" && t.status !== "Resolved",
  ).length;
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <a
          href="?"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            changeFilters(defaultFilters);
            searchRef.current?.focus();
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            s.
          </span>
          <span>Support desk</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <button
          aria-pressed={filters.status === "All"}
          className={filters.status === "All" ? "nav active" : "nav"}
          onClick={() => changeFilters({ status: "All" })}
        >
          <span>All statuses</span>
          <span>{tickets.length}</span>
        </button>
        <button
          aria-pressed={filters.status === "Open"}
          className={filters.status === "Open" ? "nav active" : "nav"}
          onClick={() => changeFilters({ status: "Open" })}
        >
          <span>Open</span>
          <span>{openCount}</span>
        </button>
        <button
          aria-pressed={filters.status === "Waiting"}
          className={filters.status === "Waiting" ? "nav active" : "nav"}
          onClick={() => changeFilters({ status: "Waiting" })}
        >
          <span>Waiting</span>
          <span>{tickets.filter((t) => t.status === "Waiting").length}</span>
        </button>
        <button
          aria-pressed={filters.status === "Resolved"}
          className={filters.status === "Resolved" ? "nav active" : "nav"}
          onClick={() => changeFilters({ status: "Resolved" })}
        >
          <span>Resolved</span>
          <span>{tickets.filter((t) => t.status === "Resolved").length}</span>
        </button>
        <div className="sidebar-bottom">
          <span className="small-label">SAMPLE WORKSPACE</span>
          <p>Fictional requests. Changes stay in this browser.</p>
          <button onClick={() => resetRef.current?.showModal()}>
            Reset sample data
          </button>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        <div className="topbar">
          <span>
            Workspace <span className="slash">/</span> Requests
          </span>
          <span className="local-label">
            <span aria-hidden="true" />
            Local workspace
          </span>
        </div>
        <header className="page-header">
          <div>
            <p className="eyebrow">SUPPORT OPERATIONS</p>
            <h1>Request queue</h1>
            <p>
              Review sample requests, update their status and add internal
              notes.
            </p>
          </div>
          <div className="header-actions">
            {supportsServerSnapshots && (
              <button
                disabled={!serverAvailable}
                aria-describedby={
                  !serverAvailable ? "server-unavailable" : undefined
                }
                onClick={() => setServerSnapshotOpen(true)}
              >
                Server snapshot
              </button>
            )}
            <button onClick={() => setImporting(true)}>
              Restore workspace
            </button>
            <button onClick={exportData}>Export workspace</button>
          </div>
        </header>
        {supportsServerSnapshots && !serverAvailable && (
          <p id="server-unavailable" className="server-hint">
            Server snapshots need the local Node server. See the README for
            setup.
          </p>
        )}
        {storageWarning && (
          <p role="alert" className="warning">
            {storageWarning}
            {recoveryRequired && (
              <>
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([recoveryRaw ?? ""], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "support-desk-unreadable-backup.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Export unreadable saved data
                </button>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Allow the next edit or restore to replace the unreadable saved data? Export its raw backup first.",
                      )
                    )
                      allowRecoveryReplacement();
                  }}
                >
                  Allow replacement of unreadable data
                </button>
              </>
            )}
            {storageConflict && (
              <button onClick={() => window.location.reload()}>
                Reload saved workspace
              </button>
            )}
          </p>
        )}
        <section className="metrics" aria-label="Queue overview">
          <div>
            <span>Open</span>
            <strong>{openCount}</strong>
            <small>Open requests</small>
          </div>
          <div>
            <span>In progress</span>
            <strong>
              {tickets.filter((t) => t.status === "In progress").length}
            </strong>
            <small>Work underway</small>
          </div>
          <div>
            <span>Urgent attention</span>
            <strong>{urgentCount}</strong>
            <small>Unresolved urgent requests</small>
          </div>
          <div>
            <span>Resolved</span>
            <strong>
              {tickets.filter((t) => t.status === "Resolved").length}
            </strong>
            <small>Completed requests</small>
          </div>
        </section>
        <section className="queue" aria-labelledby="queue-heading">
          <div className="queue-heading">
            <h2 id="queue-heading">
              Requests <span>{results.length}</span>
            </h2>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:max-[480px]:w-full">
              <label className="sort-label tw:max-[480px]:min-w-0 tw:max-[480px]:flex-1">
                Sort by
                <select
                  value={filters.sort}
                  onChange={(e) => changeFilters({ sort: e.target.value })}
                >
                  <option value="priority">Priority first</option>
                  <option value="newest">Newest first</option>
                </select>
              </label>
              <button
                ref={newRequestRef}
                className="primary tw:min-h-[44px]"
                onClick={() => setCreating(true)}
              >
                New request
              </button>
            </div>
          </div>
          <QueueFilters
            filters={filters}
            changeFilters={changeFilters}
            assignees={assignees}
            searchRef={searchRef}
          />
          <SavedViews filters={filters} onApply={changeFilters} />
          <div role="status" className="announcement">
            {message}
          </div>
          {selected.length > 0 && (
            <div className="bulk-bar">
              <strong>{selected.length} selected</strong>
              <label className="sr-only" htmlFor="bulk-status">
                New status
              </label>
              <select
                id="bulk-status"
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value as Status)}
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                onClick={() => {
                  const changed = tickets.filter(
                    (ticket) =>
                      selected.includes(ticket.id) &&
                      ticket.status !== bulkStatus,
                  ).length;
                  try {
                    setTickets((ts) =>
                      updateTickets(
                        ts,
                        selected,
                        { status: bulkStatus },
                        new Date().toISOString(),
                      ),
                    );
                    setMessage(
                      changed
                        ? `Updated ${changed} of ${selected.length} selected ${selected.length === 1 ? "request" : "requests"} to ${bulkStatus}. ${persistenceNotice()}`
                        : selected.length === 1
                          ? `No changes: the selected request is already ${bulkStatus}.`
                          : `No changes: all ${selected.length} selected requests are already ${bulkStatus}.`,
                    );
                    setSelected([]);
                    searchRef.current?.focus();
                  } catch (error) {
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "No requests were changed.",
                    );
                  }
                }}
              >
                Apply status
              </button>
              <button
                onClick={() => {
                  setSelected([]);
                  searchRef.current?.focus();
                }}
              >
                Cancel selection
              </button>
            </div>
          )}
          <p className="selection-hint">
            Select all applies to this page. Selected requests stay selected
            when you change pages.
            <span className="table-mobile-hint">
              Scroll the table horizontally to see all fields.
            </span>
          </p>
          <RequestTable
            visible={visible}
            selected={selected}
            setSelected={setSelected}
            openButtons={openButtons}
            onOpen={setActiveId}
          />
          {!results.length && (
            <div className="empty">
              <h3>No matching requests</h3>
              <p>Try a different search or clear your filters.</p>
              <button onClick={() => changeFilters(defaultFilters)}>
                Clear filters
              </button>
            </div>
          )}
          <footer className="pagination">
            <span>
              {results.length
                ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, results.length)} of ${results.length} ${results.length === 1 ? "request" : "requests"}`
                : "0 of 0 requests"}
            </span>
            <div>
              <button
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </button>
              <span>{`Page ${currentPage} of ${totalPages}`}</span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          </footer>
        </section>
        <p className="workspace-footer">
          Sample workspace · Changes stay in this browser
          <a
            href="https://github.com/flankero-dev/support-desk-workbench"
            target="_blank"
            rel="noopener noreferrer"
          >
            View source on GitHub <span aria-hidden="true">↗</span>
          </a>
        </p>
      </main>
      {creating && (
        <CreateRequestDialog
          assignees={assignees}
          categories={Array.from(
            new Set(tickets.map((t) => t.category)),
          ).sort()}
          onClose={(openId) => {
            setCreating(false);
            newRequestRef.current?.focus();
            if (openId) setActiveId(openId);
          }}
          onCreate={(draft) => {
            const id = `REQ-${crypto.randomUUID()}`;
            const at = new Date().toISOString();
            const updated = setTickets(
              (current) => appendRequest(current, draft, at, id).tickets,
              { requirePersistence: true },
            );
            const ticket = updated[updated.length - 1];
            const matches = filterTickets(updated, filters);
            const index = matches.findIndex((match) => match.id === ticket.id);
            if (index >= 0) setPage(Math.floor(index / pageSize) + 1);
            setMessage(
              `Created ${ticket.id}. Saved in this browser.${index < 0 ? " Hidden by current search or filters." : ""}`,
            );
            return { ticket, matches: index >= 0 };
          }}
        />
      )}
      {active && (
        <TicketDialog
          key={active.id}
          ticket={active}
          storageWarning={storageWarning}
          initialNote={noteDrafts.get(active.id) ?? ""}
          onDraft={(note) => {
            setNoteDrafts((current) => {
              const next = new Map(current);
              if (note) next.set(active.id, note);
              else next.delete(active.id);
              return next;
            });
          }}
          assignees={assignees}
          onClose={() => {
            setActiveId(null);
            const trigger = openButtons.current.get(active.id);
            if (trigger) trigger.focus();
            else searchRef.current?.focus();
          }}
          onUpdate={(changes) => {
            const next = setTickets((ts) =>
              updateTickets(ts, [active.id], changes, new Date().toISOString()),
            );
            const matching = new Set(
              filterTickets(next, filters).map((t) => t.id),
            );
            setSelected((ids) => ids.filter((id) => matching.has(id)));
          }}
          onNote={(note) =>
            setTickets((ts) =>
              addNote(ts, active.id, note, new Date().toISOString()),
            )
          }
        />
      )}
      {serverSnapshotOpen && (
        <ServerSnapshotDialog
          tickets={tickets}
          onClose={() => setServerSnapshotOpen(false)}
          onLoad={(next) => {
            setTickets(next);
            setNoteDrafts(new Map());
            setSelected([]);
            setPage(1);
            setActiveId(null);
            setMessage(
              `Loaded server snapshot into this browser. ${persistenceNotice()}`,
            );
          }}
        />
      )}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImport={(next) => {
            setTickets(next);
            setNoteDrafts(new Map());
            setSelected([]);
            setPage(1);
            setActiveId(null);
            setMessage(
              `Imported ${next.length} ${next.length === 1 ? "request" : "requests"}. ${persistenceNotice()}`,
            );
          }}
        />
      )}
      <dialog ref={resetRef} aria-labelledby="reset-heading">
        <div className="dialog-body">
          <h2 id="reset-heading">Reset sample data?</h2>
          <p>
            This removes your local edits and restores the 18 sample requests.
            Export a backup first if you want to keep your changes.
          </p>
          <div className="dialog-actions">
            <button autoFocus onClick={() => resetRef.current?.close()}>
              Keep changes
            </button>
            <button
              className="primary"
              onClick={() => {
                try {
                  setTickets(createSeed());
                  setNoteDrafts(new Map());
                  setSelected([]);
                  changeFilters(defaultFilters);
                  setMessage(
                    `Sample workspace restored. ${persistenceNotice()}`,
                  );
                  resetRef.current?.close();
                } catch (error) {
                  setMessage(
                    error instanceof Error ? error.message : "Reset failed.",
                  );
                  resetRef.current?.close();
                }
              }}
            >
              Reset workspace
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
