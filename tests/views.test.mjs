import test from "node:test";
import assert from "node:assert/strict";
import { addView, readViews } from "../src/domain/views.ts";
import { defaultFilters, readFilters } from "../src/domain/tickets.ts";

test("saved view restores the complete queue configuration, including sort and Unicode", () => {
  const filters = {
    ...defaultFilters,
    query: "Мая & orders",
    status: "Open",
    priority: "Urgent",
    assignee: "Maya Chen",
    sort: "newest",
  };
  const views = addView([], "  Urgent triage  ", filters);
  const restored = readViews(JSON.stringify({ version: 1, views }));
  assert.equal(restored[0].name, "Urgent triage");
  assert.deepEqual(readFilters(restored[0].search), filters);
  assert.deepEqual(readViews(null), []);
});

test("duplicate names and equivalent filters cannot create ambiguous views", () => {
  const views = addView([], "Triage", defaultFilters);
  assert.throws(
    () => addView(views, "triAGE", { ...defaultFilters, status: "Open" }),
    /name already/,
  );
  assert.throws(
    () => addView(views, "Duplicate", defaultFilters),
    /already saved/,
  );
  for (const name of [" ", "x".repeat(41), "a\nb"])
    assert.throws(() => addView([], name, defaultFilters));
  assert.equal(views.length, 1);
});

test("view limit bounds growth without mutating existing views", () => {
  const views = Array.from({ length: 8 }, (_, i) => ({
    name: `View ${i}`,
    search: `?q=${i}`,
  }));
  assert.throws(() => addView(views, "Nine", defaultFilters), /up to 8/);
  assert.equal(views.length, 8);
});

test("untrusted stored views reject corruption, unknown versions, malformed filters and duplicates", () => {
  const wrap = (views) => JSON.stringify({ version: 1, views });
  for (const raw of [
    "{broken",
    "null",
    "[]",
    "x".repeat(50001),
    JSON.stringify({ version: 2, views: [] }),
    wrap([{ name: "Bad", search: "https://example.com" }]),
    wrap([{ name: "Bad", search: "?status=Unknown" }]),
    wrap([{ name: "Bad", search: "?q=one&unknown=two" }]),
    wrap([{ name: "Bad", search: "?q=" + "x".repeat(201) }]),
    wrap([
      { name: "A", search: "" },
      { name: "a", search: "?status=Open" },
    ]),
    wrap([
      { name: "A", search: "" },
      { name: "B", search: "" },
    ]),
    wrap([{ name: 123, search: "" }]),
    wrap(
      Array.from({ length: 9 }, (_, i) => ({
        name: `V${i}`,
        search: `?q=${i}`,
      })),
    ),
  ]) {
    assert.throws(() => readViews(raw));
  }
});
