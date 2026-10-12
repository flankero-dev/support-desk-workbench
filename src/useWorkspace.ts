import { useEffect, useRef, useState } from "react";
import { createSeed } from "./domain/seed.ts";
import {
  assertWorkspaceSize,
  exportTickets,
  parseImport,
} from "./domain/tickets.ts";
const storageKey = "support-desk-workbench:v1";
const conflictMessage =
  "Another tab changed this workspace. Saving here is paused to protect those changes. Export this tab if needed, then reload to use the saved workspace.";
function load() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(storageKey);
    return {
      tickets: saved ? parseImport(saved) : createSeed(),
      warning: "",
      saved,
    };
  } catch {
    return {
      tickets: createSeed(),
      saved,
      warning: saved
        ? "Saved workspace could not be loaded. Showing sample data. Editing or importing will replace the unreadable saved copy."
        : "Browser storage could not be read. Showing sample data; changes may only work in this tab.",
    };
  }
}
export function useWorkspace() {
  const [initial] = useState(load);
  const [tickets, commitTickets] = useState(initial.tickets);
  const currentTickets = useRef(initial.tickets);
  function setTickets(
    next: typeof tickets | ((current: typeof tickets) => typeof tickets),
  ) {
    const candidate =
      typeof next === "function" ? next(currentTickets.current) : next;
    if (candidate === currentTickets.current) return;
    // Reject growth before changing memory, so every browser copy remains restorable.
    try {
      assertWorkspaceSize(exportTickets(candidate));
    } catch {
      throw new Error(
        "This change would exceed the 2 MB workspace limit. Nothing was changed. Export a backup before replacing it with a smaller workspace.",
      );
    }
    currentTickets.current = candidate;
    commitTickets(candidate);
  }
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [storageConflict, setStorageConflict] = useState(false);
  const lastSaved = useRef(initial.saved);
  const blocked = useRef(false);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        (event.key === storageKey || event.key === null) &&
        event.storageArea === localStorage &&
        event.newValue !== lastSaved.current
      ) {
        blocked.current = true;
        setStorageConflict(true);
        setStorageWarning(conflictMessage);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    if (tickets === initial.tickets || blocked.current) return;
    try {
      // Recheck immediately before writing, even if the storage event has not arrived.
      if (localStorage.getItem(storageKey) !== lastSaved.current) {
        blocked.current = true;
        queueMicrotask(() => {
          setStorageConflict(true);
          setStorageWarning(conflictMessage);
        });
        return;
      }
      const saved = exportTickets(tickets);
      // Keep the saved copy readable by the same importer used on reload.
      parseImport(saved);
      localStorage.setItem(storageKey, saved);
      lastSaved.current = saved;
      queueMicrotask(() => setStorageWarning(""));
    } catch (error) {
      const warning =
        error instanceof Error &&
        error.message.startsWith("Workspace JSON is limited")
          ? "The workspace could not be saved within the 2 MB limit. The previous saved copy is unchanged."
          : "Browser storage is unavailable or full. Changes work in this tab only; export a backup.";
      queueMicrotask(() => setStorageWarning(warning));
    }
  }, [tickets, initial.tickets]);
  return { tickets, setTickets, storageWarning, storageConflict };
}
