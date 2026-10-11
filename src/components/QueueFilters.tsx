import type { RefObject } from "react";
import {
  defaultFilters,
  priorities,
  statuses,
  writeFilters,
} from "../domain/tickets.ts";
import type { Filters } from "../domain/tickets.ts";
export function QueueFilters({
  filters,
  changeFilters,
  assignees,
  searchRef,
}: {
  filters: Filters;
  changeFilters: (filters: Partial<Filters>) => void;
  assignees: string[];
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="filters">
      <div className="search">
        <label className="sr-only" htmlFor="search">
          Search requests
        </label>
        <input
          id="search"
          ref={searchRef}
          value={filters.query}
          onChange={(e) => changeFilters({ query: e.target.value })}
          placeholder="Search title, customer or ID…"
          maxLength={200}
        />
        <kbd aria-hidden="true">/</kbd>
      </div>
      <label>
        Status
        <select
          value={filters.status}
          onChange={(e) => changeFilters({ status: e.target.value })}
        >
          <option value="All">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select
          value={filters.priority}
          onChange={(e) => changeFilters({ priority: e.target.value })}
        >
          <option value="All">All priorities</option>
          {priorities.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        Assignee
        <select
          value={filters.assignee}
          onChange={(e) => changeFilters({ assignee: e.target.value })}
        >
          <option value="All">Anyone</option>
          {!assignees.includes(filters.assignee) &&
            filters.assignee !== "All" && <option value={filters.assignee}>{filters.assignee}</option>}
          {assignees.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>
      <button
        className="clear"
        onClick={() => changeFilters(defaultFilters)}
        disabled={writeFilters(filters) === ""}
      >
        Clear
      </button>
    </div>
  );
}
