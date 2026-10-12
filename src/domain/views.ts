import { readFilters, writeFilters } from "./tickets.ts";
import type { Filters } from "./tickets.ts";

export const viewsKey = "support-desk-views:v1";
export const viewLimit = 8;
export type QueueView = { name: string; search: string };

function validName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.trim() === name &&
    name.length > 0 &&
    name.length <= 40 &&
    !Array.from(name).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  );
}

export function readViews(raw: string | null): QueueView[] {
  if (raw === null) return [];
  if (raw.length > 50000) throw new Error("Saved views are too large.");
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) ||
    data.version !== 1 ||
    !("views" in data) ||
    !Array.isArray(data.views) ||
    data.views.length > viewLimit
  )
    throw new Error("Invalid saved views.");
  const names = new Set<string>();
  const searches = new Set<string>();
  return data.views.map((view: unknown) => {
    if (
      !view ||
      typeof view !== "object" ||
      !("name" in view) ||
      !validName(view.name) ||
      !("search" in view) ||
      typeof view.search !== "string" ||
      view.search.length > 6000 ||
      writeFilters(readFilters(view.search)) !== view.search ||
      names.has(view.name.toLowerCase()) ||
      searches.has(view.search)
    ) {
      throw new Error("Invalid saved view.");
    }
    names.add(view.name.toLowerCase());
    searches.add(view.search);
    return { name: view.name, search: view.search };
  });
}

export function addView(
  views: QueueView[],
  name: string,
  filters: Filters,
): QueueView[] {
  const trimmed = name.trim();
  if (!validName(trimmed)) throw new Error("Use a name of 1–40 characters.");
  if (views.some((view) => view.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("A view with this name already exists.");
  }
  const search = writeFilters(filters);
  if (views.some((view) => view.search === search)) {
    throw new Error("These filters are already saved.");
  }
  if (views.length >= viewLimit)
    throw new Error("You can save up to 8 views. Remove one first.");
  return [...views, { name: trimmed, search }];
}
