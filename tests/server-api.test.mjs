import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAppServer } from "../server/app.ts";
import { createSeed } from "../src/domain/seed.ts";
import { exportTickets } from "../src/domain/tickets.ts";
import { appendRequest, emptyRequest } from "../src/domain/createRequest.ts";
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

test("a created request survives SQLite restart and stale writers cannot remove it", async () => {
  await withDatabase(async (path) => {
    let app = await start(path);
    const at = "2026-10-16T16:00:00.000Z";
    const created = appendRequest(
      createSeed(),
      {
        ...emptyRequest,
        title: "Created through UI contract",
        customer: "Марія",
        category: "Orders",
        description: "Keep this record",
      },
      at,
      "REQ-api",
    );
    try {
      const before = await fetch(app.url);
      const revision = before.headers.get("ETag");
      const saved = await put(
        app.url,
        revision,
        exportTickets(created.tickets),
      );
      assert.equal(saved.status, 200);
      assert.equal(saved.headers.get("ETag"), '"2"');
      const stale = await put(app.url, revision);
      assert.equal(stale.status, 412);
      const duplicate = await put(
        app.url,
        '"2"',
        exportTickets([...created.tickets, created.ticket]),
      );
      assert.equal(duplicate.status, 400);
      const unchanged = await fetch(app.url);
      assert.equal(unchanged.headers.get("ETag"), '"2"');
      assert.deepEqual((await unchanged.json()).tickets.at(-1), created.ticket);
    } finally {
      await close(app.server);
    }
    app = await start(path);
    try {
      const restored = await fetch(app.url);
      assert.equal(restored.headers.get("ETag"), '"2"');
      assert.deepEqual((await restored.json()).tickets.at(-1), created.ticket);
    } finally {
      await close(app.server);
    }
  });
});

async function withDatabase(action) {
  const directory = await mkdtemp(join(tmpdir(), "support-relational-"));
  try {
    await action(join(directory, "workspace.sqlite"));
  } finally {
    await rm(directory, { recursive: true });
  }
}
function legacyDatabase(path, document, revision = 7) {
  const database = new DatabaseSync(path);
  database.exec(
    "CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL) STRICT",
  );
  database
    .prepare("INSERT INTO workspace VALUES (1, ?, ?)")
    .run(revision, document);
  database.close();
}

test("legacy migration preserves every field, order, Unicode notes and revision", async () => {
  await withDatabase(async (path) => {
    const tickets = createSeed().reverse();
    tickets[0].activity.push({
      at: "2026-10-13T09:00:00.000Z",
      text: "Перевірено — Київ ✅",
    });
    const document = exportTickets(tickets);
    legacyDatabase(path, document);
    for (let restart = 0; restart < 2; restart++) {
      const app = await start(path);
      try {
        const response = await fetch(app.url);
        assert.equal(response.headers.get("ETag"), '"7"');
        assert.deepEqual(await response.json(), JSON.parse(document));
      } finally {
        await close(app.server);
      }
    }
    const database = new DatabaseSync(path);
    try {
      assert.equal(
        database.prepare("PRAGMA user_version").get().user_version,
        1,
      );
      assert.equal(
        database.prepare("SELECT count(*) AS n FROM tickets").get().n,
        tickets.length,
      );
      assert.equal(
        database.prepare("SELECT count(*) AS n FROM activities").get().n,
        tickets.reduce((n, t) => n + t.activity.length, 0),
      );
      assert.equal(
        database
          .prepare("PRAGMA table_info(workspace)")
          .all()
          .some((c) => c.name === "document"),
        false,
      );
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      database.close();
    }
  });
});

test("failed migration leaves the legacy document and schema untouched", async () => {
  await withDatabase(async (path) => {
    legacyDatabase(path, "{broken");
    assert.throws(() => createAppServer(path));
    const database = new DatabaseSync(path);
    try {
      assert.equal(
        database.prepare("SELECT document FROM workspace").get().document,
        "{broken",
      );
      assert.equal(
        database.prepare("PRAGMA user_version").get().user_version,
        0,
      );
      assert.equal(
        database
          .prepare("SELECT name FROM sqlite_master WHERE name='tickets'")
          .get(),
        undefined,
      );
    } finally {
      database.close();
    }
  });
});

test("independent database connections reject a stale writer without mixing data", async () => {
  await withDatabase(async (path) => {
    const first = await start(path),
      second = await start(path);
    try {
      const a = createSeed(),
        b = createSeed();
      a[0].description = "First writer";
      b[0].description = "Second writer";
      const responses = await Promise.all([
        put(first.url, '"1"', exportTickets(a)),
        put(second.url, '"1"', exportTickets(b)),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 412]);
      const winner = responses[0].status === 200 ? a : b;
      for (const app of [first, second]) {
        const response = await fetch(app.url);
        assert.equal(response.headers.get("ETag"), '"2"');
        assert.deepEqual(
          await response.json(),
          JSON.parse(exportTickets(winner)),
        );
      }
      assert.deepEqual(
        await responses.find((r) => r.status === 200).json(),
        JSON.parse(exportTickets(winner)),
      );
    } finally {
      await close(first.server);
      await close(second.server);
    }
  });
});

test("a mid-write SQL failure rolls back requests, history and revision", async () => {
  await withDatabase(async (path) => {
    const app = await start(path);
    const database = new DatabaseSync(path);
    try {
      const before = await (await fetch(app.url)).json();
      database.exec(
        "CREATE TRIGGER fail_history BEFORE INSERT ON activities BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
      );
      assert.equal((await put(app.url, '"1"')).status, 500);
      const response = await fetch(app.url);
      assert.equal(response.headers.get("ETag"), '"1"');
      assert.deepEqual(await response.json(), before);
      database.exec("DROP TRIGGER fail_history");
      assert.equal((await put(app.url, '"1"')).status, 200);
    } finally {
      database.close();
      await close(app.server);
    }
  });
});

test("replacement removes obsolete histories and rejects an empty import", async () => {
  await withDatabase(async (path) => {
    let app = await start(path);
    try {
      assert.equal((await put(app.url, '"1"', exportTickets([]))).status, 400);
      const tickets = createSeed().slice(0, 1);
      tickets[0].activity = [];
      assert.equal(
        (await put(app.url, '"1"', exportTickets(tickets))).status,
        200,
      );
      await close(app.server);
      app = await start(path);
      const response = await fetch(app.url);
      assert.equal(response.headers.get("ETag"), '"2"');
      assert.deepEqual(
        await response.json(),
        JSON.parse(exportTickets(tickets)),
      );
      const database = new DatabaseSync(path);
      try {
        assert.equal(
          database.prepare("SELECT count(*) AS n FROM activities").get().n,
          0,
        );
      } finally {
        database.close();
      }
    } finally {
      await close(app.server);
    }
  });
});

test("future schemas are rejected without reseeding", async () => {
  await withDatabase(async (path) => {
    legacyDatabase(path, exportTickets([]));
    const database = new DatabaseSync(path);
    database.exec("PRAGMA user_version = 2");
    database.close();
    assert.throws(
      () => createAppServer(path),
      /Unsupported workspace database version/,
    );
    const reopened = new DatabaseSync(path);
    try {
      assert.equal(
        reopened.prepare("SELECT revision FROM workspace").get().revision,
        7,
      );
    } finally {
      reopened.close();
    }
  });
});

test("migration DDL rolls back if a conflicting table prevents completion", async () => {
  await withDatabase(async (path) => {
    const document = exportTickets(createSeed());
    legacyDatabase(path, document);
    const database = new DatabaseSync(path);
    database.exec(
      "CREATE TABLE tickets (sentinel TEXT); INSERT INTO tickets VALUES ('preserve')",
    );
    database.close();
    assert.throws(() => createAppServer(path));
    const reopened = new DatabaseSync(path);
    try {
      assert.equal(
        reopened.prepare("SELECT document FROM workspace").get().document,
        document,
      );
      assert.equal(
        reopened.prepare("SELECT sentinel FROM tickets").get().sentinel,
        "preserve",
      );
      assert.equal(
        reopened.prepare("PRAGMA user_version").get().user_version,
        0,
      );
      assert.equal(
        reopened
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='workspace_legacy'",
          )
          .get(),
        undefined,
      );
    } finally {
      reopened.close();
    }
  });
});

test("revision exhaustion fails without changing the stored snapshot", async () => {
  await withDatabase(async (path) => {
    const app = await start(path);
    const database = new DatabaseSync(path);
    try {
      database
        .prepare("UPDATE workspace SET revision=?")
        .run(Number.MAX_SAFE_INTEGER);
      const before = await (await fetch(app.url)).json();
      assert.equal(
        (await put(app.url, `"${Number.MAX_SAFE_INTEGER}"`)).status,
        500,
      );
      const response = await fetch(app.url);
      assert.equal(
        response.headers.get("ETag"),
        `"${Number.MAX_SAFE_INTEGER}"`,
      );
      assert.deepEqual(await response.json(), before);
    } finally {
      database.close();
      await close(app.server);
    }
  });
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
