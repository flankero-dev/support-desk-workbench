import { mkdirSync } from "node:fs";
import { createAppServer } from "./app.ts";
mkdirSync("data", { recursive: true });
const port = Number(process.env.PORT ?? 3000);
const server = createAppServer("data/workspace.sqlite");
server.listen(port, "127.0.0.1", () =>
  console.log(`Support Desk with SQLite: http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.close());
