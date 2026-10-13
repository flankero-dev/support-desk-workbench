import { DatabaseSync } from "node:sqlite";
import { createSeed } from "../src/domain/seed.ts";
import { exportTickets, parseImport } from "../src/domain/tickets.ts";
import type { Ticket } from "../src/domain/tickets.ts";

type Snapshot = { revision: number; document: string };

export function openWorkspace(databasePath: string) {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");

  // Callbacks are synchronous: requests never yield with a transaction open.
  function transaction<T>(write: boolean, action: () => T): T {
    database.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try {
      const result = action();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function replaceTickets(tickets: Ticket[]) {
    database.exec("DELETE FROM tickets");
    const insertTicket = database.prepare(`
      INSERT INTO tickets (id, position, title, customer, category, status,
        priority, assignee, created_at, updated_at, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertActivity = database.prepare(
      "INSERT INTO activities (ticket_id, position, at, text) VALUES (?, ?, ?, ?)",
    );
    tickets.forEach((ticket, position) => {
      insertTicket.run(
        ticket.id,
        position,
        ticket.title,
        ticket.customer,
        ticket.category,
        ticket.status,
        ticket.priority,
        ticket.assignee,
        ticket.createdAt,
        ticket.updatedAt,
        ticket.description,
      );
      ticket.activity.forEach((entry, index) => {
        insertActivity.run(ticket.id, index, entry.at, entry.text);
      });
    });
  }

  try {
    transaction(true, () => {
      const version = database
        .prepare("PRAGMA user_version")
        .get()?.user_version;
      if (version === 1) return;
      if (version !== 0)
        throw new Error("Unsupported workspace database version.");
      const legacyExists = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace'",
        )
        .get();
      let revision = 1;
      let tickets: Ticket[];
      if (legacyExists) {
        const legacy = database
          .prepare("SELECT revision, document FROM workspace WHERE id=1")
          .get();
        if (
          !legacy ||
          !Number.isSafeInteger(legacy.revision) ||
          Number(legacy.revision) < 1
        ) {
          throw new Error("Invalid legacy workspace revision.");
        }
        revision = Number(legacy.revision);
        tickets = parseImport(String(legacy.document));
        database.exec("ALTER TABLE workspace RENAME TO workspace_legacy");
      } else {
        tickets = createSeed();
      }
      database.exec(`
        CREATE TABLE workspace (
          id INTEGER PRIMARY KEY CHECK(id=1),
          revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991)
        ) STRICT;
        CREATE TABLE tickets (
          id TEXT PRIMARY KEY NOT NULL,
          position INTEGER NOT NULL UNIQUE CHECK(position >= 0),
          title TEXT NOT NULL, customer TEXT NOT NULL, category TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('Open', 'In progress', 'Waiting', 'Resolved')),
          priority TEXT NOT NULL CHECK(priority IN ('Urgent', 'High', 'Normal', 'Low')),
          assignee TEXT NOT NULL, created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, description TEXT NOT NULL
        ) STRICT;
        CREATE TABLE activities (
          ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          position INTEGER NOT NULL CHECK(position >= 0),
          at TEXT NOT NULL, text TEXT NOT NULL,
          PRIMARY KEY(ticket_id, position)
        ) STRICT;
      `);
      database.prepare("INSERT INTO workspace VALUES (1, ?)").run(revision);
      replaceTickets(tickets);
      if (legacyExists) database.exec("DROP TABLE workspace_legacy");
      database.exec("PRAGMA user_version = 1");
    });

    const readRevision = database.prepare(
      "SELECT revision FROM workspace WHERE id=1",
    );
    const readTickets = database.prepare(`
      SELECT id, title, customer, category, status, priority, assignee,
        created_at AS createdAt, updated_at AS updatedAt, description
      FROM tickets ORDER BY position
    `);
    const readActivities = database.prepare(
      "SELECT ticket_id, at, text FROM activities ORDER BY ticket_id, position",
    );
    const advance = database.prepare(`
      UPDATE workspace SET revision=revision+1
      WHERE id=1 AND revision=? AND revision < 9007199254740991
    `);

    function snapshot(): Snapshot {
      const row = readRevision.get();
      if (!row) throw new Error("Workspace revision is missing.");
      const rows = readTickets.all() as Omit<Ticket, "activity">[];
      const tickets: Ticket[] = rows.map((row) => ({ ...row, activity: [] }));
      const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
      for (const entry of readActivities.all()) {
        const ticket = byId.get(String(entry.ticket_id));
        if (!ticket) throw new Error("Activity has no request.");
        ticket.activity.push({
          at: String(entry.at),
          text: String(entry.text),
        });
      }
      return {
        revision: Number(row.revision),
        document: exportTickets(tickets),
      };
    }

    // Check the existing schema before returning an open handle.
    transaction(false, snapshot);
    return {
      current: () => transaction(false, snapshot),
      save: (tickets: Ticket[], revision: number): Snapshot | undefined =>
        transaction(true, () => {
          if (!advance.run(revision).changes) {
            if (
              readRevision.get()?.revision === revision &&
              revision === Number.MAX_SAFE_INTEGER
            ) {
              throw new Error("Workspace revision limit reached.");
            }
            return undefined;
          }
          replaceTickets(tickets);
          return snapshot();
        }),
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
