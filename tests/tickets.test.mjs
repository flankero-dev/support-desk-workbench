import test from "node:test";
import assert from "node:assert/strict";
import {
  addNote,
  defaultFilters,
  exportTickets,
  filterTickets,
  parseImport,
  readFilters,
  updateTickets,
  writeFilters,
} from "../src/domain/tickets.ts";
import { createSeed } from "../src/domain/seed.ts";
const tickets = createSeed();
const at = "2026-10-08T12:00:00.000Z";
test("search matches a customer, title and ID without case sensitivity", () => {
  for (const query of ["MAYA", "address edit", "SD-1042"])
    assert.equal(
      filterTickets(tickets, { ...defaultFilters, query })[0].id,
      "SD-1042",
    );
});
test("combines all filters, does not mutate input order", () => {
  const original = tickets.map((t) => t.id);
  const found = filterTickets(tickets, {
    ...defaultFilters,
    status: "Open",
    priority: "Urgent",
    assignee: "Alex",
  });
  assert.deepEqual(
    found.map((t) => t.id),
    ["SD-1042"],
  );
  assert.deepEqual(
    tickets.map((t) => t.id),
    original,
  );
});
test("priority order puts urgent before high and normal", () => {
  const found = filterTickets(tickets, defaultFilters);
  assert.equal(found[0].priority, "Urgent");
  assert.equal(found[1].priority, "Urgent");
  assert.equal(found[2].priority, "High");
});
test("newest sorting uses timestamps", () => {
  const found = filterTickets(tickets, { ...defaultFilters, sort: "newest" });
  assert.equal(found[0].id, "SD-1042");
  assert.equal(found.at(-1).id, "SD-1025");
});
test("filters round-trip Unicode, spaces and ampersands through URL", () => {
  const filters = {
    query: "Назар & Maya",
    status: "In progress",
    priority: "High",
    assignee: "Alex",
    sort: "newest",
  };
  assert.deepEqual(readFilters(writeFilters(filters)), filters);
});
test("unknown enum URL values fall back to safe defaults", () => {
  assert.deepEqual(
    readFilters("?status=Gone&priority=Wrong&sort=other"),
    defaultFilters,
  );
});
test("empty filters create a clean URL", () =>
  assert.equal(writeFilters(defaultFilters), ""));
test("bulk update only changes selected requests and appends audit entries", () => {
  const updated = updateTickets(
    tickets,
    ["SD-1042", "SD-1040"],
    { status: "Resolved" },
    at,
  );
  assert.equal(updated[0].status, "Resolved");
  assert.equal(updated[2].status, "Resolved");
  assert.equal(updated[0].activity.at(-1).text, "status: Resolved");
  assert.equal(updated[0].updatedAt, at);
  assert.equal(updated[1], tickets[1]);
  assert.equal(tickets[0].status, "Open");
});
test("a no-op update creates no audit noise", () =>
  assert.equal(
    updateTickets(tickets, ["SD-1042"], { status: "Open" }, at)[0],
    tickets[0],
  ));
test("notes are trimmed and bounded, without mutating original", () => {
  const updated = addNote(tickets, "SD-1042", "  Needs follow-up  ", at);
  assert.equal(updated[0].activity.at(-1).text, "Note: Needs follow-up");
  assert.equal(tickets[0].activity.length, 1);
  assert.throws(() => addNote(tickets, "SD-1042", " ", at));
  assert.throws(() => addNote(tickets, "SD-1042", "x".repeat(1001), at));
});
test("export/import preserves the complete workspace", () =>
  assert.deepEqual(parseImport(exportTickets(tickets)), tickets));
test("malformed JSON and wrong versions cannot replace workspace", () => {
  for (const input of [
    "{",
    '{"version":2,"tickets":[]}',
    '{"version":1,"tickets":[]}',
  ])
    assert.throws(() => parseImport(input));
});
test("duplicate IDs are rejected", () =>
  assert.throws(
    () => parseImport(exportTickets([tickets[0], tickets[0]])),
    /Duplicate/,
  ));
test("import rejects invalid enums, dates, missing fields and activity", () => {
  for (const changes of [
    { status: "Hacked" },
    { priority: "Impossible" },
    { createdAt: "yesterday" },
    { customer: "" },
    { activity: [{ at, text: 12 }] },
  ])
    assert.throws(() =>
      parseImport(exportTickets([{ ...tickets[0], ...changes }])),
    );
});
test("import picks known fields and renders literal text, not HTML", () => {
  const altered = {
    ...tickets[0],
    title: "<b>literal title</b>",
    extra: "ignored",
  };
  const result = parseImport(exportTickets([altered]))[0];
  assert.equal(result.title, "<b>literal title</b>");
  assert.equal("extra" in result, false);
});
test("import caps payload size and number of tickets", () => {
  assert.throws(() => parseImport("x".repeat(2_000_001)), /2 MB/);
  assert.throws(
    () =>
      parseImport(
        JSON.stringify({ version: 1, tickets: Array(501).fill(tickets[0]) }),
      ),
    /1–500/,
  );
});

test("maximum imported assignee length survives URL filters", () => {
  const assignee = "А".repeat(200);
  const imported = parseImport(exportTickets([{ ...tickets[0], assignee }]));
  const filters = { ...defaultFilters, assignee };
  assert.deepEqual(readFilters(writeFilters(filters)), filters);
  assert.equal(filterTickets(imported, readFilters(writeFilters(filters))).length, 1);
});

test("an imported assignee named All remains distinct from Anyone", () => {
  const filters = { ...defaultFilters, assignee: "All", assigneeIsExact: true };
  const imported = [{ ...tickets[0], assignee: "All" }, tickets[1]];
  assert.deepEqual(readFilters(writeFilters(filters)), filters);
  assert.equal(filterTickets(imported, filters).length, 1);
  assert.equal(filterTickets(imported, defaultFilters).length, 2);
});

test("imported history can grow beyond 500 entries and still reload", () => {
  const activity = Array.from({ length: 500 }, () => ({ at, text: "Imported history" }));
  const imported = parseImport(exportTickets([{ ...tickets[0], activity }]));
  const updated = addNote(imported, tickets[0].id, "Next note", at);
  const reloaded = parseImport(exportTickets(updated));
  assert.equal(reloaded[0].activity.length, 501);
  assert.equal(reloaded[0].activity.at(-1).text, "Note: Next note");
});
