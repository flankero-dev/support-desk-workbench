import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";
import { createAppServer } from "../server/app.ts";
import { createSeed } from "../src/domain/seed.ts";
import { exportTickets } from "../src/domain/tickets.ts";
const kind = process.env.AUDIT_BROWSER || "chromium";
const browser = await { chromium, firefox, webkit }[kind].launch({
  headless: true,
  ...(kind === "chromium" && process.env.CHROMIUM_PATH
    ? {
        executablePath: process.env.CHROMIUM_PATH,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ],
      }
    : {}),
});
const s = createAppServer();
await new Promise((r) => s.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${s.address().port}`;
const dir = `docs/audit/${process.env.AUDIT_STAGE || "after"}-${kind}`;
await mkdir(dir, { recursive: true });
const results = [];
const key = "support-desk-workbench:v1";
async function scenario(id, fn, setup) {
  console.log("Start", id);
  const c = await browser.newContext();
  const p = await c.newPage();
  p.setDefaultTimeout(4000);
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    if (setup) await setup(p);
    await p.goto(url);
    await fn(p, c);
    assert.deepEqual(errors, []);
    results.push({ id, status: "pass" });
  } catch (e) {
    results.push({ id, status: "fail", error: String(e) });
    await p.screenshot({ path: `${dir}/${id}-failure.png` }).catch(() => {});
  } finally {
    await c.close();
  }
}
const open = async (p) =>
  p
    .getByRole("button", {
      name: "Checkout returns to cart after address edit",
      exact: true,
    })
    .click();
try {
  await scenario(
    "S01",
    async (p) => {
      await p.getByLabel("Select SD-1042", { exact: true }).check();
      await p
        .getByRole("button", { name: "Apply status", exact: true })
        .click();
      assert.match(
        await p.locator(".announcement").innerText(),
        /not saved|in.memory|this tab only/i,
      );
      await open(p);
      assert.match(
        await p.getByRole("dialog").innerText(),
        /not saved|this tab only/i,
      );
    },
    async (p) =>
      p.addInitScript(() => {
        Storage.prototype.setItem = () => {
          throw new Error("synthetic quota");
        };
      }),
  );
  await scenario(
    "S02",
    async (p) => {
      await open(p);
      await p
        .getByRole("dialog")
        .locator("select")
        .first()
        .selectOption("Waiting");
      await p.keyboard.press("Escape");
      assert.equal(
        await p.evaluate((k) => localStorage.getItem(k), key),
        "{recoverable",
      );
      assert.equal(
        await p
          .getByRole("button", { name: "Export unreadable saved data" })
          .count(),
        1,
      );
    },
    async (p) =>
      p.addInitScript((k) => localStorage.setItem(k, "{recoverable"), key),
  );
  await scenario("S05", async (p) => {
    await p.getByLabel(/^Status/).selectOption("Open");
    await p.getByLabel("Select SD-1042", { exact: true }).check();
    await open(p);
    await p
      .getByRole("dialog")
      .locator("select")
      .first()
      .selectOption("Waiting");
    await p.keyboard.press("Escape");
    assert.equal(await p.locator(".bulk-bar").count(), 0);
  });
  await scenario("S07", async (p) => {
    await p
      .getByRole("button", { name: "Server snapshot", exact: true })
      .click();
    await p.getByRole("button", { name: "Refresh server copy" }).click();
    await p
      .getByText(
        "Server copy loaded for comparison. Your browser copy is unchanged.",
        { exact: true },
      )
      .waitFor();
    await p.route("**/api/workspace", (r) =>
      r.fulfill({ status: 500, body: "error" }),
    );
    await p.getByRole("button", { name: "Refresh server copy" }).click();
    await p.getByRole("alert").waitFor();
    assert.equal(
      await p
        .getByRole("button", { name: "Replace browser copy with server copy" })
        .isDisabled(),
      true,
    );
  });
  await scenario("S10", async (p) => {
    await p
      .getByRole("button", { name: "Restore workspace", exact: true })
      .click();
    const draft = exportTickets(createSeed());
    await p.getByLabel("Workspace JSON").fill(draft);
    await p.getByLabel("Exported workspace file").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    });
    await p.getByRole("alert").waitFor();
    assert.equal(await p.getByLabel("Workspace JSON").inputValue(), draft);
  });
  await scenario("S11", async (p) => {
    await open(p);
    await p.getByLabel("Internal note").fill("Keep my unfinished note");
    await p.keyboard.press("Escape");
    await open(p);
    assert.equal(
      await p.getByLabel("Internal note").inputValue(),
      "Keep my unfinished note",
    );
  });
  await scenario(
    "S12",
    async (p) => {
      assert.equal(
        await p.getByText("No saved views yet", { exact: true }).count(),
        0,
      );
      assert.equal(
        await p.getByText("Saved views unavailable", { exact: true }).count(),
        1,
      );
    },
    async (p) =>
      p.addInitScript(() => {
        const get = Storage.prototype.getItem;
        Storage.prototype.getItem = function (k) {
          if (k === "support-desk-views:v1")
            throw new Error("synthetic read blocked");
          return get.call(this, k);
        };
      }),
  );
  await scenario("S13", async (p) => {
    await p.getByRole("link", { name: "Skip to workspace" }).focus();
    await p.keyboard.press("Enter");
    assert.equal(await p.evaluate(() => document.activeElement?.id), "main");
    assert.equal(
      await p
        .getByRole("button", { name: "All statuses 18", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
  });
  await scenario("S08", async (p) => {
    const t = {
      ...createSeed()[0],
      activity: Array.from({ length: 30000 }, () => ({
        at: "2026-10-08T12:00:00Z",
        text: "H",
      })),
    };
    await p.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
      key,
      raw: exportTickets([t]),
    });
    await p.reload();
    p.setDefaultTimeout(30000);
    const start = performance.now();
    await open(p);
    await p.locator(".activity li").first().waitFor();
    const count = await p.locator(".activity li").count();
    results.push({
      id: "S08-metric",
      openMs: performance.now() - start,
      rendered: count,
      history: 30000,
    });
    assert.ok(count <= 100, `rendered ${count}`);
  });
  await scenario("S09-S14", async (p) => {
    const t = {
      ...createSeed()[0],
      id: "REQ-12345678-1234-4321-1234-123456789012",
      createdAt: "2025-10-08T12:00:00Z",
    };
    await p.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
      key,
      raw: exportTickets([t]),
    });
    await p.reload();
    for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440, 1920]) {
      await p.setViewportSize({ width, height: 900 });
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await p.screenshot({ path: `${dir}/queue-${width}.png`, fullPage: true });
      const title = await p.locator(".request-title").boundingBox();
      assert.ok(title.width >= 120, `title width ${title.width}`);
    }
    assert.match(await p.locator("tbody time").innerText(), /2025/);
  });

  for (const action of ["edit", "note", "import", "reset"])
    await scenario(
      `S01-${action}`,
      async (p) => {
        if (action === "edit" || action === "note") {
          await open(p);
          if (action === "edit")
            await p
              .getByRole("dialog")
              .locator("select")
              .first()
              .selectOption("Waiting");
          else {
            await p.getByLabel("Internal note").fill("Unpersisted note");
            await p
              .getByRole("button", { name: "Add note", exact: true })
              .click();
          }
          assert.match(await p.getByRole("dialog").innerText(), /not saved/i);
          await p.keyboard.press("Escape");
        } else if (action === "import") {
          await p
            .getByRole("button", { name: "Restore workspace", exact: true })
            .click();
          await p
            .getByLabel("Workspace JSON")
            .fill(exportTickets([createSeed()[0]]));
          await p
            .getByRole("button", { name: "Replace workspace", exact: true })
            .click();
        } else {
          await p
            .getByRole("button", { name: "Reset sample data", exact: true })
            .click();
          await p
            .getByRole("button", { name: "Reset workspace", exact: true })
            .click();
        }
        assert.match(
          await p.getByRole("alert").first().innerText(),
          /not saved/i,
        );
        assert.equal(
          await p.evaluate((k) => localStorage.getItem(k), key),
          null,
        );
        await p.evaluate(() => (window.__auditLifetime = "same-document"));
        await p
          .getByRole("link", { name: "Support desk", exact: true })
          .click();
        assert.equal(
          await p.evaluate(() => window.__auditLifetime),
          "same-document",
        );
      },
      async (p) =>
        p.addInitScript(() => {
          Storage.prototype.setItem = () => {
            throw new DOMException("quota", "QuotaExceededError");
          };
        }),
    );
  await scenario("S01-undelivered-conflict", async (p) => {
    const external = exportTickets([
      { ...createSeed()[0], title: "External tab copy" },
    ]);
    await p.evaluate(
      ({ key, external }) => localStorage.setItem(key, external),
      { key, external },
    );
    await p.getByLabel(/^Status/).selectOption("Open");
    await p.getByLabel("Select SD-1042", { exact: true }).check();
    await open(p);
    await p
      .getByRole("dialog")
      .locator("select")
      .first()
      .selectOption("Waiting");
    await p.keyboard.press("Escape");
    assert.equal(await p.locator(".bulk-bar").count(), 0);
    assert.equal(
      await p.evaluate((k) => localStorage.getItem(k), key),
      external,
    );
    assert.match(await p.getByRole("alert").first().innerText(), /Another tab/);
  });
  await scenario("S06-confirm-diff", async (p) => {
    const serverTickets = createSeed();
    serverTickets[0].activity.push({
      at: serverTickets[0].updatedAt,
      text: "Server-only note",
    });
    let puts = 0;
    await p.route("**/api/workspace", (r) => {
      if (r.request().method() === "PUT") puts++;
      return r.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json", ETag: '"7"' },
        body: exportTickets(serverTickets),
      });
    });
    await p
      .getByRole("button", { name: "Server snapshot", exact: true })
      .click();
    await p.getByRole("button", { name: "Refresh server copy" }).click();
    await p.getByText(/0 added, 0 removed, 1 modified/).waitFor();
    p.once("dialog", (d) => d.dismiss());
    await p
      .getByRole("button", { name: "Save browser copy to server" })
      .click();
    assert.equal(puts, 0);
    p.once("dialog", (d) => d.dismiss());
    await p
      .getByRole("button", { name: "Replace browser copy with server copy" })
      .click();
    assert.equal(await p.getByRole("dialog").count(), 1);
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), key), null);
  });
  for (const failure of ["invalid-etag", "network"])
    await scenario(`S07-${failure}`, async (p) => {
      await p
        .getByRole("button", { name: "Server snapshot", exact: true })
        .click();
      await p.getByRole("button", { name: "Refresh server copy" }).click();
      await p
        .getByText(
          "Server copy loaded for comparison. Your browser copy is unchanged.",
          { exact: true },
        )
        .waitFor();
      await p.route("**/api/workspace", (r) =>
        failure === "network"
          ? r.abort()
          : r.fulfill({
              status: 200,
              body: exportTickets(createSeed()),
              headers: { ETag: "bad" },
            }),
      );
      await p.getByRole("button", { name: "Refresh server copy" }).click();
      await p.getByRole("alert").waitFor();
      assert.equal(
        await p
          .getByRole("button", { name: "Save browser copy to server" })
          .isDisabled(),
        true,
      );
    });
} finally {
  await writeFile(
    `${dir}/results.json`,
    JSON.stringify(
      { browser: kind, version: browser.version(), results },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
  await browser.close();
  await new Promise((r) => s.close(r));
}
if (results.some((r) => r.status === "fail")) process.exitCode = 1;
