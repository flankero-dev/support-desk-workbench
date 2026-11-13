import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { parseImport } from "../src/domain/tickets.ts";
import type { Ticket } from "../src/domain/tickets.ts";
import { isInside } from "./pathSafety.ts";
import { openWorkspace } from "./storage.ts";
export function createAppServer(
  databasePath = ":memory:",
  root = resolve("dist"),
) {
  root = resolve(root);
  const workspace = openWorkspace(databasePath);
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
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
    } catch {
      throw new Error("Request must contain valid UTF-8 JSON.");
    }
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
          const snapshot = workspace.current();
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
        let tickets: Ticket[];
        try {
          tickets = parseImport(await body(request));
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : "Invalid workspace.";
          json(response, detail === "Request is limited to 2 MB." ? 413 : 400, {
            error: detail,
          });
          return;
        }
        // Revision and related rows commit together across database connections.
        const snapshot = workspace.save(tickets, revision);
        if (!snapshot) {
          json(response, 412, {
            error:
              "The server copy changed. Refresh it before deciding what to save.",
          });
          return;
        }
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
      let decoded: string;
      try {
        decoded = decodeURIComponent(pathname);
        if (decoded.includes("\0")) throw new Error();
      } catch {
        json(response, 400, { error: "Invalid URL encoding." });
        return;
      }
      const path = resolve(root, `.${decoded}`);
      if (!isInside(root, path)) {
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
        const [realRoot, realFile] = await Promise.all([
          realpath(root),
          realpath(file),
        ]);
        if (!isInside(realRoot, realFile)) {
          response.writeHead(403).end();
          return;
        }
        if (!(await stat(realFile)).isFile()) {
          response.writeHead(404).end();
          return;
        }
        const content = await readFile(realFile);
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
  server.on("close", () => workspace.close());
  return server;
}
