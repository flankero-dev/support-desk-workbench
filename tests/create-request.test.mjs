import test from "node:test";
import assert from "node:assert/strict";
import {
  appendRequest,
  emptyRequest,
  validateRequest,
} from "../src/domain/createRequest.ts";
import { createSeed } from "../src/domain/seed.ts";
import {
  exportTickets,
  parseImport,
  filterTickets,
  defaultFilters,
} from "../src/domain/tickets.ts";

const at = "2026-10-16T16:00:00.000Z";
const draft = {
  ...emptyRequest,
  title: "  Cannot update address  ",
  customer: "  Марія  ",
  category: "Orders",
  description: "First line\nSecond line",
};

test("creation preserves the schema, history, whitespace semantics and original records", () => {
  const source = createSeed();
  const before = JSON.stringify(source);
  const result = appendRequest(source, draft, at, "REQ-test");
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.tickets.length, 19);
  assert.equal(result.ticket.title, "Cannot update address");
  assert.equal(result.ticket.customer, "Марія");
  assert.equal(result.ticket.description, "First line\nSecond line");
  assert.equal(result.ticket.status, "Open");
  assert.equal(result.ticket.assignee, "Unassigned");
  assert.equal(result.ticket.createdAt, result.ticket.updatedAt);
  assert.deepEqual(result.ticket.activity, [{ at, text: "Request created" }]);
  assert.deepEqual(parseImport(exportTickets(result.tickets)), result.tickets);
});

test("required fields reject empty and whitespace-only values with specific errors", () => {
  for (const field of [
    "title",
    "customer",
    "category",
    "description",
    "assignee",
  ]) {
    for (const value of ["", " \n\t ", null, 42]) {
      const invalid = { ...draft, [field]: value };
      assert.ok(validateRequest(invalid)[field]);
      assert.throws(
        () => appendRequest(createSeed(), invalid, at, "REQ-test"),
        /Enter a/,
      );
    }
  }
});

test("field boundaries and invalid enums cannot bypass UI restrictions", () => {
  for (const field of [
    "title",
    "customer",
    "category",
    "assignee",
    "description",
  ]) {
    const limit = field === "description" ? 4000 : 200;
    assert.equal(
      validateRequest({ ...draft, [field]: "x".repeat(limit) })[field],
      undefined,
    );
    assert.ok(
      validateRequest({ ...draft, [field]: "x".repeat(limit + 1) })[field],
    );
  }
  assert.throws(
    () =>
      appendRequest(
        createSeed(),
        { ...draft, priority: "invalid" },
        at,
        "REQ-x",
      ),
    /priority/,
  );
});

test("duplicate IDs, bad IDs and dates fail without replacing anything", () => {
  const source = createSeed();
  const before = JSON.stringify(source);
  assert.throws(
    () => appendRequest(source, draft, at, source[0].id),
    /already exists/,
  );
  for (const id of ["", " ", "x".repeat(201)])
    assert.throws(() => appendRequest(source, draft, at, id), /invalid id/);
  assert.throws(
    () => appendRequest(source, draft, "invalid", "REQ-x"),
    /invalid date/,
  );
  assert.equal(JSON.stringify(source), before);
});

test("499 records can grow to 500; the next insert is rejected atomically", () => {
  const source = Array.from({ length: 499 }, (_, i) => ({
    ...createSeed()[0],
    id: `existing-${i}`,
  }));
  const result = appendRequest(source, draft, at, "REQ-500");
  assert.equal(result.tickets.length, 500);
  const before = exportTickets(result.tickets);
  assert.throws(
    () => appendRequest(result.tickets, draft, at, "REQ-501"),
    /500 requests/,
  );
  assert.equal(exportTickets(result.tickets), before);
});

test("UTF-8 workspace size is enforced, not only JavaScript string length", () => {
  const source = Array.from({ length: 499 }, (_, i) => ({
    ...createSeed()[0],
    id: `existing-${i}`,
    description: "界".repeat(1100),
    activity: [],
  }));
  // Grow the source to just below its byte limit using valid history entries.
  while (new TextEncoder().encode(exportTickets(source)).byteLength < 1_998_000)
    source[0].activity.push({ at, text: "x".repeat(1000) });
  parseImport(exportTickets(source));
  assert.ok(exportTickets(source).length < 2_000_000);
  assert.throws(
    () =>
      appendRequest(
        source,
        { ...draft, description: "界".repeat(4000) },
        at,
        "REQ-limit",
      ),
    /2 MB/,
  );
  assert.equal(source.length, 499);
});

test("new requests obey combined filters, priority and newest order", () => {
  const { tickets, ticket } = appendRequest(
    createSeed(),
    { ...draft, priority: "Urgent" },
    at,
    "REQ-visible",
  );
  for (const sort of ["priority", "newest"])
    assert.equal(
      filterTickets(tickets, { ...defaultFilters, sort })[0].id,
      ticket.id,
    );
  assert.equal(
    filterTickets(tickets, {
      ...defaultFilters,
      query: "марія",
      status: "Open",
      priority: "Urgent",
      assignee: "Unassigned",
    })[0].id,
    ticket.id,
  );
  assert.equal(
    filterTickets(tickets, { ...defaultFilters, status: "Resolved" }).some(
      (t) => t.id === ticket.id,
    ),
    false,
  );
});
