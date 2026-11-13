import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { spawnSync } from "node:child_process";
import { isInside } from "../server/pathSafety.ts";
import { createSeed } from "../src/domain/seed.ts";
import { parseImport, exportTickets } from "../src/domain/tickets.ts";
import { validTimestamp } from "../src/domain/text.ts";
test("S15 Win32 containment: drives, sibling prefix, mixed separators and encoded asset names", () => {
  const p = path.win32,
    root = "C:\\site\\dist";
  for (const file of [
    "index.html",
    "assets/a.js",
    "asset space.js",
    "nested/../favicon.svg",
  ])
    assert.equal(isInside(root, p.resolve(root, file), p), true);
  for (const file of [
    "../outside.txt",
    "../dist-other/a.js",
    "D:\\outside.txt",
    "\\\\server\\share\\a.js",
  ])
    assert.equal(isInside(root, p.resolve(root, file), p), false, file);
});
test("S03 imported explicit offsets remain invariant across four time zones", () => {
  const code = `import {parseImport,exportTickets,defaultFilters} from './src/domain/tickets.ts';import{createSeed}from './src/domain/seed.ts';const t=createSeed()[0];const ts=[{...t,id:'A',createdAt:'2026-03-29T02:30:00+02:00'},{...t,id:'B',createdAt:'2026-03-29T00:45:00Z'}];console.log(JSON.stringify(parseImport(exportTickets(ts)).map(x=>[x.id,new Date(x.createdAt).toISOString()])));`;
  const values = [
    "UTC",
    "Europe/Kyiv",
    "America/New_York",
    "Pacific/Auckland",
  ].map((TZ) => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      env: { ...process.env, TZ },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  });
  assert.equal(new Set(values).size, 1);
});
test("S03 history preserves append order and externally backdated timestamps", () => {
  const t = {
    ...createSeed()[0],
    activity: [
      { at: "2001-01-01T00:00:00Z", text: "Imported legacy event" },
      { at: "2030-01-01T00:00:00Z", text: "External clock" },
    ],
  };
  assert.deepEqual(parseImport(exportTickets([t])), [t]);
});
let seed = 0x20261018;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
};
// Delta reduction runs only when an invariant fails, at most 64 attempts.
function minimize(value, fails) {
  let result = value;
  for (
    let n = 0, step = Math.floor(result.length / 2);
    step > 0 && n < 64;
    step = Math.floor(step / 2)
  ) {
    for (let i = 0; i < result.length && n < 64; i += step, n++) {
      const c = result.slice(0, i) + result.slice(i + step);
      if (fails(c)) result = c;
    }
  }
  return result;
}
test(
  "S03/S20 bounded seeded date and import fuzz (seed 0x20261018)",
  { timeout: 5000 },
  () => {
    const start = performance.now();
    const t = createSeed()[0];
    for (let i = 0; i < 400; i++) {
      const ms = Date.UTC(
        2000 + (random() % 30),
        random() % 12,
        1 + (random() % 28),
        random() % 24,
        random() % 60,
        random() % 60,
      );
      const date = new Date(ms).toISOString();
      assert.ok(validTimestamp(date));
      const text = Array.from({ length: 1 + (random() % 24) }, () =>
        String.fromCodePoint(
          [65, 0x416, 0x1f600, 0x301, 0x200c, 32][random() % 6],
        ),
      ).join("");
      const candidate = exportTickets([
        {
          ...t,
          title: "Label " + text,
          createdAt: date,
          updatedAt: date,
          activity: [],
        },
      ]);
      const fails = (v) => {
        try {
          return !isDeepStrictEqual(
            JSON.parse(exportTickets(parseImport(v))),
            JSON.parse(v),
          );
        } catch {
          return true;
        }
      };
      if (fails(candidate))
        assert.fail("seed 0x20261018 minimized: " + minimize(candidate, fails));
      assert.throws(() => parseImport(candidate.slice(0, -1)));
    }
    assert.ok(performance.now() - start < 4000);
  },
);
