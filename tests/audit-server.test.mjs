import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAppServer } from "../server/app.ts";
import { openWorkspace } from "../server/storage.ts";
import { createSeed } from "../src/domain/seed.ts";
import { exportTickets } from "../src/domain/tickets.ts";
async function fixture(action) {
  const dir = await mkdtemp(join(tmpdir(), "audit-server-"));
  const root = join(dir, "dist");
  await mkdir(root);
  await writeFile(join(root, "index.html"), "safe index");
  await writeFile(join(root, "asset space.js"), "safe asset");
  const s = createAppServer(":memory:", root);
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  try {
    await action(`http://127.0.0.1:${s.address().port}`, root, dir);
  } finally {
    await new Promise((r) => s.close(r));
    await rm(dir, { recursive: true, force: true });
  }
}
test("S15/S16 static GET HEAD encoding and client errors", () =>
  fixture(async (url) => {
    assert.equal((await fetch(url + "/")).status, 200);
    assert.equal(
      await (await fetch(url + "/asset%20space.js?x=1")).text(),
      "safe asset",
    );
    assert.equal(
      await (await fetch(url + "/asset%20space.js", { method: "HEAD" })).text(),
      "",
    );
    for (const p of ["/%", "/%GG", "/%00"])
      assert.equal((await fetch(url + p)).status, 400, p);
    assert.equal((await fetch(url + "/missing.js")).status, 404);
  }));
test("S17 symlink outside served root cannot disclose bytes", () =>
  fixture(async (url, root, dir) => {
    await writeFile(join(dir, "outside.txt"), "synthetic secret");
    await symlink(join(dir, "outside.txt"), join(root, "exposed.txt"));
    assert.equal((await fetch(url + "/exposed.txt")).status, 403);
    await symlink(join(root, "asset space.js"), join(root, "inside.js"));
    assert.equal((await fetch(url + "/inside.js")).status, 200);
  }));
test("S18 invalid UTF8 is rejected without advancing revision", () =>
  fixture(async (url) => {
    const api = url + "/api/workspace";
    const initial = await fetch(api);
    const tag = initial.headers.get("etag");
    const doc = exportTickets([{ ...createSeed()[0], title: "MARKER" }]);
    const bad = Buffer.concat([
      Buffer.from(doc.split("MARKER")[0]),
      Buffer.from([255]),
      Buffer.from(doc.split("MARKER")[1]),
    ]);
    const response = await fetch(api, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": tag },
      body: bad,
    });
    assert.equal(response.status, 400);
    assert.equal((await fetch(api)).headers.get("etag"), tag);
  }));
test("S19 v1 business corruption fails startup and preserves DB", async () => {
  const dir = await mkdtemp(join(tmpdir(), "audit-db-"));
  const path = join(dir, "test.sqlite");
  try {
    const w = openWorkspace(path);
    w.close();
    const db = new DatabaseSync(path);
    db.exec("UPDATE tickets SET title='' WHERE position=0");
    db.close();
    assert.throws(() => openWorkspace(path), /invalid|backup|repair/i);
    const check = new DatabaseSync(path);
    assert.equal(
      check.prepare("SELECT title FROM tickets WHERE position=0").get().title,
      "",
    );
    check.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
