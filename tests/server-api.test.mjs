import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppServer } from "../server/app.ts";
import { createSeed } from "../src/domain/seed.ts";
import { exportTickets } from "../src/domain/tickets.ts";
async function start(database) {
  const server = createAppServer(database);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}/api/workspace`,
  };
}
const close = (server) => new Promise((resolve) => server.close(resolve));
const put = (url, etag, body = exportTickets(createSeed()), origin) =>
  fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(etag ? { "If-Match": etag } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body,
  });
test("HTTP round trip persists across a database restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "support-desk-"));
  const path = join(directory, "workspace.sqlite");
  let app = await start(path);
  try {
    const loaded = await fetch(app.url);
    const tickets = createSeed();
    tickets[0].status = "Resolved";
    const saved = await put(
      app.url,
      loaded.headers.get("ETag"),
      exportTickets(tickets),
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get("ETag"), '"2"');
    await close(app.server);
    app = await start(path);
    const restored = await fetch(app.url);
    assert.equal((await restored.json()).tickets[0].status, "Resolved");
    assert.equal(restored.headers.get("ETag"), '"2"');
  } finally {
    await close(app.server);
    await rm(directory, { recursive: true });
  }
});
test("two writers using the same revision cannot both succeed", async () => {
  const app = await start();
  try {
    const loaded = await fetch(app.url);
    const tag = loaded.headers.get("ETag");
    const results = await Promise.all([put(app.url, tag), put(app.url, tag)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 412]);
    assert.equal((await fetch(app.url)).headers.get("ETag"), '"2"');
  } finally {
    await close(app.server);
  }
});
test("invalid documents and missing revisions do not change the database", async () => {
  const app = await start();
  try {
    assert.equal((await put(app.url, undefined)).status, 428);
    assert.equal((await put(app.url, '"1"', "{broken")).status, 400);
    const duplicate = createSeed();
    duplicate.push(duplicate[0]);
    assert.equal(
      (await put(app.url, '"1"', exportTickets(duplicate))).status,
      400,
    );
    assert.equal((await fetch(app.url)).headers.get("ETag"), '"1"');
  } finally {
    await close(app.server);
  }
});
test("cross-origin writes and unsupported content types are rejected", async () => {
  const app = await start();
  try {
    assert.equal(
      (await put(app.url, '"1"', undefined, "https://example.com")).status,
      403,
    );
    assert.equal(
      (await fetch(app.url, { method: "PUT", body: "{}" })).status,
      415,
    );
    assert.equal((await fetch(app.url, { method: "DELETE" })).status, 405);
  } finally {
    await close(app.server);
  }
});
test("oversized requests are rejected before persistence", async () => {
  const app = await start();
  try {
    assert.equal((await put(app.url, '"1"', "x".repeat(2000001))).status, 413);
    assert.equal((await fetch(app.url)).headers.get("ETag"), '"1"');
  } finally {
    await close(app.server);
  }
});

test("invalid revision and origin produce client errors without persistence", async () => {
  const app = await start();
  try {
    assert.equal((await put(app.url, '\"999999999999999999999\"')).status, 428);
    assert.equal(
      (await put(app.url, '\"1\"', undefined, "not-a-url")).status,
      400,
    );
    const unsupported = await fetch(app.url, { method: "POST" });
    assert.equal(unsupported.status, 405);
    assert.equal(unsupported.headers.get("Allow"), "GET, PUT");
    assert.equal((await fetch(app.url)).headers.get("ETag"), '\"1\"');
  } finally {
    await close(app.server);
  }
});
