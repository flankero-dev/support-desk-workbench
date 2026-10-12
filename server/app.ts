import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSeed } from "../src/domain/seed.ts";
import { exportTickets, parseImport } from "../src/domain/tickets.ts";
export function createAppServer(
  databasePath = ":memory:",
  root = resolve("dist"),
) {
  const database = new DatabaseSync(databasePath);
  database.exec(
    "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL) STRICT",
  );
  database
    .prepare("INSERT OR IGNORE INTO workspace VALUES (1, 1, ?)")
    .run(exportTickets(createSeed()));
  const read = database.prepare(
    "SELECT revision, document FROM workspace WHERE id=1",
  );
  const save = database.prepare(
    "UPDATE workspace SET document=?, revision=revision+1 WHERE id=1 AND revision=?",
  );
  const current = () =>
    read.get() as {
      revision: number;
      document: string;
    };
  const json = (
    response: ServerResponse,
    code: number,
    body: unknown,
    etag?: string,
  ) => {
    response.writeHead(code, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(etag ? { ETag: etag } : {}),
    });
    response.end(JSON.stringify(body));
  };
  async function body(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2000000) throw new Error("Request is limited to 2 MB.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
        json(response, 403, {
          error: "This server accepts loopback hosts only.",
        });
        return;
      }
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname === "/api/workspace") {
        if (request.method === "GET") {
          const snapshot = current();
          json(
            response,
            200,
            JSON.parse(snapshot.document),
            `"${snapshot.revision}"`,
          );
          return;
        }
        if (request.method !== "PUT") {
          response.setHeader("Allow", "GET, PUT");
          json(response, 405, { error: "Use GET or PUT." });
          return;
        }
        const origin = request.headers.origin;
        let originUrl: URL | undefined;
        try {
          originUrl = origin ? new URL(origin) : undefined;
        } catch {
          json(response, 400, { error: "Invalid Origin header." });
          return;
        }
        if (originUrl && originUrl.origin !== `http://${host}`) {
          json(response, 403, {
            error: "Cross-origin writes are not allowed.",
          });
          return;
        }
        if (
          request.headers["content-type"]?.split(";")[0] !== "application/json"
        ) {
          json(response, 415, { error: "Send application/json." });
          return;
        }
        const expected = request.headers["if-match"];
        if (typeof expected !== "string" || !/^"[1-9]\d*"$/.test(expected)) {
          json(response, 428, {
            error: "Load a server revision before saving.",
          });
          return;
        }
        const revision = Number(expected.slice(1, -1));
        if (!Number.isSafeInteger(revision)) {
          json(response, 428, {
            error: "Load a valid server revision before saving.",
          });
          return;
        }
        let document: string;
        try {
          document = exportTickets(parseImport(await body(request)));
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : "Invalid workspace.";
          json(response, detail === "Request is limited to 2 MB." ? 413 : 400, {
            error: detail,
          });
          return;
        }
        // One conditional SQL statement is atomic across concurrent writers.
        const result = save.run(document, revision);
        if (!result.changes) {
          json(response, 412, {
            error:
              "The server copy changed. Refresh it before deciding what to save.",
          });
          return;
        }
        const snapshot = current();
        json(
          response,
          200,
          JSON.parse(snapshot.document),
          `"${snapshot.revision}"`,
        );
        return;
      }
      if (pathname.startsWith("/api/")) {
        json(response, 404, { error: "Unknown endpoint." });
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      const path = resolve(root, `.${decodeURIComponent(pathname)}`);
      if (path !== root && !path.startsWith(`${root}/`)) {
        response.writeHead(403).end();
        return;
      }
      try {
        const file = path === root ? resolve(root, "index.html") : path;
        const types: Record<string, string> = {
          ".html": "text/html",
          ".css": "text/css",
          ".js": "text/javascript",
          ".svg": "image/svg+xml",
        };
        const content = await readFile(file);
        response.writeHead(200, {
          "Content-Type": types[extname(file)] ?? "application/octet-stream",
        });
        response.end(request.method === "HEAD" ? undefined : content);
      } catch {
        response.writeHead(404).end();
      }
    } catch {
      json(response, 500, { error: "Request could not be processed." });
    }
  });
  server.requestTimeout = 15000;
  server.on("close", () => database.close());
  return server;
}
