export const statuses = ["Open", "In progress", "Waiting", "Resolved"] as const;
export const priorities = ["Urgent", "High", "Normal", "Low"] as const;
export type Status = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export type Ticket = {
  id: string;
  title: string;
  customer: string;
  category: string;
  status: Status;
  priority: Priority;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  activity: { at: string; text: string }[];
};
export type Filters = {
  query: string;
  status: string;
  priority: string;
  assignee: string;
  sort: string;
  assigneeIsExact?: boolean;
};
export const defaultFilters: Filters = {
  query: "",
  status: "All",
  priority: "All",
  assignee: "All",
  sort: "priority",
};

export function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const allowed = (key: string, values: readonly string[]) =>
    values.includes(params.get(key) ?? "") ? params.get(key)! : "All";
  return {
    query: (params.get("q") ?? "").slice(0, 200),
    status: allowed("status", statuses),
    priority: allowed("priority", priorities),
    assignee: (params.get("assignee") ?? "All").slice(0, 200),
    ...(params.get("assignee") === "All" ? { assigneeIsExact: true } : {}),
    sort: params.get("sort") === "newest" ? "newest" : "priority",
  };
}
export function writeFilters(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  for (const key of ["status", "priority", "assignee"] as const)
    if (
      filters[key] !== "All" ||
      (key === "assignee" && filters.assigneeIsExact)
    )
      params.set(key, filters[key]);
  if (filters.sort !== "priority") params.set("sort", filters.sort);
  return params.toString() ? `?${params}` : "";
}
export function filterTickets(tickets: Ticket[], filters: Filters): Ticket[] {
  const query = filters.query.trim().toLowerCase();
  return tickets
    .filter(
      (t) =>
        (!query ||
          `${t.id} ${t.title} ${t.customer}`.toLowerCase().includes(query)) &&
        (filters.status === "All" || t.status === filters.status) &&
        (filters.priority === "All" || t.priority === filters.priority) &&
        ((filters.assignee === "All" && !filters.assigneeIsExact) ||
          t.assignee === filters.assignee),
    )
    .sort((a, b) => {
      if (filters.sort === "priority") {
        const diff =
          priorities.indexOf(a.priority) - priorities.indexOf(b.priority);
        if (diff) return diff;
      }
      return (
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        a.id.localeCompare(b.id)
      );
    });
}
export function updateTickets(
  tickets: Ticket[],
  ids: string[],
  changes: Partial<Pick<Ticket, "status" | "priority" | "assignee">>,
  at: string,
): Ticket[] {
  const selected = new Set(ids);
  return tickets.map((ticket) => {
    if (!selected.has(ticket.id)) return ticket;
    const entries = Object.entries(changes).filter(
      ([key, value]) => ticket[key as keyof Ticket] !== value,
    );
    if (!entries.length) return ticket;
    return {
      ...ticket,
      ...changes,
      updatedAt: at,
      activity: [
        ...ticket.activity,
        {
          at,
          text: entries.map(([key, value]) => `${key}: ${value}`).join(" · "),
        },
      ],
    };
  });
}
export function addNote(
  tickets: Ticket[],
  id: string,
  note: string,
  at: string,
): Ticket[] {
  const text = note.trim();
  if (!text || text.length > 1000)
    throw new Error("Notes must contain 1–1000 characters.");
  return tickets.map((t) =>
    t.id === id
      ? {
          ...t,
          updatedAt: at,
          activity: [...t.activity, { at, text: `Note: ${text}` }],
        }
      : t,
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseImport(input: string): Ticket[] {
  if (
    input.length > 2_000_000 ||
    new TextEncoder().encode(input).byteLength > 2_000_000
  )
    throw new Error("Import is limited to 2 MB of JSON.");
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("Invalid JSON. Paste a file exported from this workspace.");
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.tickets) ||
    !value.tickets.length ||
    value.tickets.length > 500
  )
    throw new Error("Expected version 1 and 1–500 tickets.");
  const ids = new Set<string>();
  return value.tickets.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Ticket ${index + 1} is invalid.`);
    for (const field of [
      "id",
      "title",
      "customer",
      "category",
      "assignee",
      "description",
      "createdAt",
      "updatedAt",
    ] as const) {
      if (
        typeof item[field] !== "string" ||
        !item[field].trim() ||
        item[field].length > (field === "description" ? 4000 : 200)
      )
        throw new Error(`Ticket ${index + 1}: invalid ${field}.`);
    }
    if (ids.has(item.id as string))
      throw new Error(`Duplicate ticket ID: ${item.id}.`);
    ids.add(item.id as string);
    if (
      !statuses.includes(item.status as Status) ||
      !priorities.includes(item.priority as Priority)
    )
      throw new Error(`Ticket ${index + 1}: invalid status or priority.`);
    if (
      !Number.isFinite(Date.parse(item.createdAt as string)) ||
      !Number.isFinite(Date.parse(item.updatedAt as string))
    )
      throw new Error(`Ticket ${index + 1}: invalid date.`);
    if (
      !Array.isArray(item.activity) ||
      item.activity.some(
        (a) =>
          !isRecord(a) ||
          typeof a.text !== "string" ||
          !a.text.trim() ||
          a.text.length > 1200 ||
          typeof a.at !== "string" ||
          !Number.isFinite(Date.parse(a.at)),
      )
    )
      throw new Error(`Ticket ${index + 1}: invalid activity.`);
    // Pick known fields; imported JSON never defines HTML, routes or executable code.
    return {
      id: item.id as string,
      title: item.title as string,
      customer: item.customer as string,
      category: item.category as string,
      assignee: item.assignee as string,
      description: item.description as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
      status: item.status as Status,
      priority: item.priority as Priority,
      activity: item.activity.map((a) => ({
        at: a.at as string,
        text: a.text as string,
      })),
    };
  });
}
export function exportTickets(tickets: Ticket[]): string {
  return JSON.stringify({ version: 1, tickets });
}
