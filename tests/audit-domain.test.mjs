import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../src/domain/seed.ts";
import {
  parseImport,
  exportTickets,
  addNote,
  compareSnapshots,
} from "../src/domain/tickets.ts";
import { addView } from "../src/domain/views.ts";
import { validateRequest, emptyRequest } from "../src/domain/createRequest.ts";
import { defaultFilters } from "../src/domain/tickets.ts";
const base = createSeed()[0];
for (const date of [
  "0",
  "2026-02-30T12:00:00Z",
  "2026-01-01T00:30:00",
  "2026-13-01T00:00:00Z",
  "2026-01-01",
])
  test(`S03 reject ambiguous or impossible timestamp ${date}`, () =>
    assert.throws(() =>
      parseImport(exportTickets([{ ...base, createdAt: date }])),
    ));
test("S03 reject updatedAt preceding createdAt", () =>
  assert.throws(() =>
    parseImport(
      exportTickets([{ ...base, updatedAt: "2000-01-01T00:00:00Z" }]),
    ),
  ));
test("S03 explicit offsets represent the same instant and roundtrip", () => {
  const t = {
    ...base,
    createdAt: "2026-01-01T02:00:00+02:00",
    updatedAt: "2026-01-01T00:00:00Z",
    activity: [],
  };
  assert.deepEqual(parseImport(exportTickets([t])), [t]);
});
for (const field of ["id", "assignee"])
  test(`S04 reject ambiguous surrounding whitespace in ${field}`, () =>
    assert.throws(() =>
      parseImport(
        exportTickets([{ ...base, [field]: " " + base[field] + " " }]),
      ),
    ));
for (const text of ["\u200b", "\u202e", "\u0000", "\ud800"])
  test(`S04/S20 reject invisible or ill-formed labels ${JSON.stringify(text)}`, () => {
    assert.throws(() => parseImport(exportTickets([{ ...base, title: text }])));
    assert.throws(() => addView([], text, defaultFilters));
    assert.ok(validateRequest({ ...emptyRequest, title: text }).title);
    assert.throws(() => addNote([base], base.id, text, base.updatedAt));
  });
test("S20 reject embedded lone surrogate; preserve legitimate Unicode and joining characters", () => {
  assert.throws(() =>
    parseImport(exportTickets([{ ...base, description: "hello\ud800world" }])),
  );
  const t = {
    ...base,
    title: "Київ ✅ cafe\u0301 فارسی\u200cزبان",
    description: "<script>inert</script> 🇺🇦",
  };
  assert.deepEqual(parseImport(exportTickets([t])), [t]);
});

test("S06/N03 snapshot comparison ignores key order and detects note-only differences", () => {
  const original = createSeed();
  const parsed = parseImport(exportTickets(original));
  assert.deepEqual(compareSnapshots(original, parsed), {
    added: 0,
    removed: 0,
    modified: 0,
  });
  parsed[0].activity.push({
    at: parsed[0].updatedAt,
    text: "Server-only note",
  });
  assert.deepEqual(compareSnapshots(original, parsed), {
    added: 0,
    removed: 0,
    modified: 1,
  });
  assert.deepEqual(compareSnapshots(original.slice(1), parsed), {
    added: 0,
    removed: 1,
    modified: 0,
  });
});
