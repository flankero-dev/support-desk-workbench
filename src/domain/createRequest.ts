import { validText } from "./text.ts";
import { exportTickets, parseImport, priorities } from "./tickets.ts";
import type { Ticket } from "./tickets.ts";

export type RequestDraft = Pick<
  Ticket,
  "title" | "customer" | "category" | "description" | "priority" | "assignee"
>;
export type DraftErrors = Partial<Record<keyof RequestDraft, string>>;
export const emptyRequest: RequestDraft = {
  title: "",
  customer: "",
  category: "",
  description: "",
  priority: "Normal",
  assignee: "Unassigned",
};

export function validateRequest(draft: RequestDraft): DraftErrors {
  const errors: DraftErrors = {};
  for (const [field, label] of [
    ["title", "Title"],
    ["customer", "Customer"],
    ["category", "Category"],
    ["description", "Description"],
    ["assignee", "Assignee"],
  ] as const) {
    const value = draft[field];
    const limit = field === "description" ? 4000 : 200;
    if (typeof value !== "string" || !validText(value))
      errors[field] = `Enter a ${label.toLowerCase()}.`;
    else if (value.trim().length > limit)
      errors[field] = `${label} must be ${limit} characters or fewer.`;
  }
  if (!priorities.includes(draft.priority))
    errors.priority = "Choose a valid priority.";
  return errors;
}

// UUID collisions (including imported IDs) must fail, never replace a request.
export function appendRequest(
  tickets: Ticket[],
  draft: RequestDraft,
  at: string,
  id: string,
): { tickets: Ticket[]; ticket: Ticket } {
  const errors = Object.values(validateRequest(draft));
  if (errors.length) throw new Error(errors[0]);
  if (tickets.length >= 500)
    throw new Error(
      "This workspace has 500 requests. Restore a smaller workspace before creating another request.",
    );
  if (tickets.some((ticket) => ticket.id === id))
    throw new Error(
      "The new request ID already exists. Try creating the request again.",
    );
  const ticket: Ticket = {
    id,
    title: draft.title.trim(),
    customer: draft.customer.trim(),
    category: draft.category.trim(),
    description: draft.description.trim(),
    assignee: draft.assignee.trim(),
    priority: draft.priority,
    status: "Open",
    createdAt: at,
    updatedAt: at,
    activity: [{ at, text: "Request created" }],
  };
  const next = [...tickets, ticket];
  // Use the existing import/export contract for IDs, dates, count and UTF-8 size.
  parseImport(exportTickets(next));
  return { tickets: next, ticket };
}
