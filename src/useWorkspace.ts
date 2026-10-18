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
const recoveryMessage =
  "Saved workspace could not be loaded. Showing sample data. Export the unreadable saved data before explicitly allowing its replacement.";
function load() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(storageKey);
    return {
      tickets: saved !== null ? parseImport(saved) : createSeed(),
      warning: "",
      saved,
      recovery: false,
    };
  } catch {
    return {
      tickets: createSeed(),
      saved,
      recovery: saved !== null,
      warning:
        saved !== null
          ? recoveryMessage
          : "Browser storage could not be read. Showing sample data; changes may only work in this tab.",
    };
  }
}
export function useWorkspace() {
  const [initial] = useState(load);
  const [tickets, commitTickets] = useState(initial.tickets);
  const currentTickets = useRef(initial.tickets);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [storageConflict, setStorageConflict] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(initial.recovery);
  const recovery = useRef(initial.recovery);
  const lastSaved = useRef(initial.saved);
  const blocked = useRef(false);
  const lastMutationSaved = useRef(true);
  const [unsaved, setUnsaved] = useState(false);
  function setTickets(
    next: typeof tickets | ((current: typeof tickets) => typeof tickets),
    options?: { requirePersistence: boolean },
  ) {
    const candidate =
      typeof next === "function" ? next(currentTickets.current) : next;
    if (candidate === currentTickets.current) return candidate;
    const saved = exportTickets(candidate);
    try {
      assertWorkspaceSize(saved);
    } catch {
      throw new Error(
        "This change would exceed the 2 MB workspace limit. Nothing was changed. Export a backup before replacing it with a smaller workspace.",
      );
    }
    parseImport(saved);
    if (recovery.current) throw new Error(recoveryMessage);
    let warning = "";
    try {
      if (
        blocked.current ||
        localStorage.getItem(storageKey) !== lastSaved.current
      ) {
        blocked.current = true;
        setStorageConflict(true);
        throw new Error(conflictMessage);
      }
      localStorage.setItem(storageKey, saved);
      lastSaved.current = saved;
      lastMutationSaved.current = true;
      setUnsaved(false);
    } catch {
      lastMutationSaved.current = false;
      warning = blocked.current
        ? conflictMessage
        : "Browser storage is unavailable or full. Changes work in this tab only; not saved. Export a backup before leaving.";
      setStorageWarning(warning);
      if (options?.requirePersistence)
        throw new Error(
          blocked.current
            ? conflictMessage
            : "The request could not be saved in this browser. Storage may be unavailable or full. Your form is unchanged; free space or export a backup before trying again.",
        );
      setUnsaved(true);
    }
    setStorageWarning(warning);
    currentTickets.current = candidate;
    commitTickets(candidate);
    return candidate;
  }
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
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  function allowRecoveryReplacement() {
    recovery.current = false;
    setRecoveryRequired(false);
    setStorageWarning(
      "Replacement allowed. The unreadable saved copy remains unchanged until your next successful edit or restore.",
    );
  }
  const persistenceNotice = () =>
    lastMutationSaved.current
      ? "Saved in this browser."
      : "Not saved: this tab only. Export a backup before leaving.";
  return {
    tickets,
    setTickets,
    storageWarning,
    storageConflict,
    recoveryRequired,
    recoveryRaw: initial.saved,
    allowRecoveryReplacement,
    persistenceNotice,
  };
}
