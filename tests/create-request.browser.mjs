import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { createAppServer } from "../server/app.ts";
import { createSeed } from "../src/domain/seed.ts";
import { exportTickets, parseImport } from "../src/domain/tickets.ts";

const server = createAppServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const key = "support-desk-workbench:v1";
const results = [];
const errors = [];
const measurements = [];
await mkdir("docs/create-request", { recursive: true });
const saved = (page) => page.evaluate((key) => localStorage.getItem(key), key);
async function open(page) {
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await page
    .getByRole("dialog", { name: "New request", exact: true })
    .waitFor();
}
async function fill(page, title = "Address cannot be updated") {
  await page.getByLabel("Title *", { exact: true }).fill(title);
  await page.getByLabel("Customer *", { exact: true }).fill("Марія Коваль");
  await page.getByLabel("Category *", { exact: true }).fill("Orders");
  await page
    .getByLabel("Description *", { exact: true })
    .fill(
      "Editing the delivery address loses the apartment number.\nKeep the existing order intact.",
    );
}
async function create(page, title) {
  await open(page);
  await fill(page, title);
  await page
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Request created", exact: true })
    .waitFor();
}
async function fresh(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  return { context, page };
}
async function check(name, action) {
  try {
    await action();
    results.push({ name, status: "VERIFIED" });
  } catch (error) {
    results.push({ name, status: "FAILED", error: String(error) });
    throw error;
  }
}
try {
  await check(
    "keyboard, negative validation, successful save, Enter and focus restoration",
    async () => {
      const { context, page } = await fresh();
      await page.screenshot({
        path: "docs/create-request/queue-desktop.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "New request", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await page.getByLabel("Title *", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByLabel("Title *", { exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await page.screenshot({
        path: "docs/create-request/desktop-default.png",
      });
      await page
        .getByRole("button", { name: "Create request", exact: true })
        .click();
      assert.equal(await page.locator('[aria-invalid="true"]').count(), 4);
      assert.equal(
        await page
          .getByLabel("Title *", { exact: true })
          .getAttribute("aria-describedby"),
        "create-title-error",
      );
      assert.equal(await saved(page), null);
      await page.screenshot({
        path: "docs/create-request/desktop-invalid.png",
      });
      await page.getByLabel("Title *", { exact: true }).fill("   ");
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator("#create-title-error").innerText(),
        "Enter a title.",
      );
      await fill(page);
      await page.getByLabel("Description *", { exact: true }).focus();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      assert.equal(
        await saved(page),
        null,
        "textarea Enter is a newline, not submission",
      );
      await page
        .getByRole("button", { name: "Create request", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Request created", exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator("#created-heading")
          .evaluate((el) => el === document.activeElement),
        true,
      );
      const document = parseImport(await saved(page));
      assert.equal(document.length, 19);
      assert.match(document.at(-1).id, /^REQ-[\da-f-]{36}$/);
      assert.equal(document.at(-1).activity[0].text, "Request created");
      await page.screenshot({
        path: "docs/create-request/desktop-success.png",
      });
      await page
        .getByRole("button", { name: "View request", exact: true })
        .click();
      await page
        .getByRole("heading", {
          name: "Address cannot be updated",
          exact: true,
        })
        .waitFor();
      await page
        .getByLabel("Internal note")
        .fill("Created request remains editable");
      await page.getByRole("button", { name: "Add note", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.reload();
      assert.equal(parseImport(await saved(page)).length, 19);
      assert.match(await saved(page), /Created request remains editable/);
      await open(page);
      assert.equal(
        await page.getByLabel("Title *", { exact: true }).inputValue(),
        "",
      );
      await fill(page, "Must not be created");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      assert.equal(
        await page
          .getByRole("button", { name: "New request", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      assert.equal(parseImport(await saved(page)).length, 19);
      await context.close();
    },
  );
  await check(
    "current filters, saved view and sort survive creation; reset and JSON round-trip",
    async () => {
      const { context, page } = await fresh();
      await page.getByLabel(/^Status/).selectOption("Resolved");
      await page.getByLabel("Sort by").selectOption("newest");
      await page.getByLabel("New view name").fill("Resolved latest");
      await page
        .getByRole("button", { name: "Save view", exact: true })
        .click();
      const beforeUrl = page.url();
      await create(page, "Hidden by resolved filter");
      assert.match(
        await page.getByRole("dialog").innerText(),
        /hidden by your current search or filters/,
      );
      await page
        .getByRole("button", { name: "Back to queue", exact: true })
        .click();
      assert.equal(page.url(), beforeUrl);
      assert.equal(
        await page
          .getByRole("button", {
            name: "Hidden by resolved filter",
            exact: true,
          })
          .count(),
        0,
      );
      await page.reload();
      assert.match(
        await page.getByLabel("Saved view", { exact: true }).innerText(),
        /Resolved latest/,
      );
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.getByLabel("Sort by").selectOption("newest");
      assert.equal(
        await page.locator(".request-title").first().innerText(),
        "Hidden by resolved filter",
      );
      const raw = await saved(page);
      assert.equal(parseImport(exportTickets(parseImport(raw))).length, 19);
      await page
        .getByRole("button", { name: "Reset sample data", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Reset workspace", exact: true })
        .click();
      assert.equal(parseImport(await saved(page)).length, 18);
      await page
        .getByRole("button", { name: "Restore workspace", exact: true })
        .click();
      await page.getByLabel("Workspace JSON").fill(raw);
      await page
        .getByRole("button", { name: "Replace workspace", exact: true })
        .click();
      assert.equal(parseImport(await saved(page)).length, 19);
      await context.close();
    },
  );
  await check(
    "quota error preserves all form fields and memory, then retry creates only once",
    async () => {
      const { context, page } = await fresh();
      await open(page);
      await fill(page, "Retry after quota");
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        window.restoreStorage = () => {
          Storage.prototype.setItem = original;
        };
        Storage.prototype.setItem = function (key, value) {
          if (key === "support-desk-workbench:v1")
            throw new DOMException("Quota exceeded", "QuotaExceededError");
          return original.call(this, key, value);
        };
      });
      await page
        .getByRole("button", { name: "Create request", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "could not be saved" })
        .waitFor();
      assert.equal(
        await page.getByLabel("Title *", { exact: true }).inputValue(),
        "Retry after quota",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "All statuses 18", exact: true })
          .count(),
        1,
      );
      assert.equal(await saved(page), null);
      await page.screenshot({ path: "docs/create-request/save-error.png" });
      await page.evaluate(() => window.restoreStorage());
      await page
        .getByRole("button", { name: "Create request", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Request created", exact: true })
        .waitFor();
      assert.equal(parseImport(await saved(page)).length, 19);
      await context.close();
    },
  );
  await check(
    "another tab's creation is protected and unsaved draft survives conflict",
    async () => {
      const { context, page } = await fresh();
      const peer = await context.newPage();
      await peer.goto(url);
      await open(page);
      await fill(page, "Unsaved conflicting draft");
      await create(peer, "Peer saved first");
      const peerCopy = await saved(peer);
      await page
        .getByRole("button", { name: "Create request", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("alert")
        .filter({ hasText: "Another tab" })
        .waitFor();
      assert.equal(
        await page.getByLabel("Title *", { exact: true }).inputValue(),
        "Unsaved conflicting draft",
      );
      assert.equal(await saved(page), peerCopy);
      assert.equal(
        await page
          .getByRole("button", { name: "All statuses 18", exact: true })
          .count(),
        1,
      );
      await page.screenshot({ path: "docs/create-request/tab-conflict.png" });
      await context.close();
    },
  );
  await check(
    "immediate storage recheck works even without a delivered storage event",
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(() => {
        const add = window.addEventListener.bind(window);
        window.addEventListener = (type, ...args) => {
          if (type !== "storage") add(type, ...args);
        };
      });
      await page.goto(url);
      await open(page);
      await fill(page, "Event race");
      const peerCopy = exportTickets(createSeed().slice(0, 2));
      await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
        key,
        raw: peerCopy,
      });
      await page
        .getByRole("button", { name: "Create request", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("alert")
        .filter({ hasText: "Another tab" })
        .waitFor();
      assert.equal(await saved(page), peerCopy);
      await context.close();
    },
  );
  await check(
    "UUID collision never overwrites the existing record",
    async () => {
      const { context, page } = await fresh();
      await page.evaluate(() =>
        Object.defineProperty(crypto, "randomUUID", { value: () => "same-id" }),
      );
      await create(page, "First collision ID");
      await page
        .getByRole("button", { name: "Back to queue", exact: true })
        .click();
      const original = await saved(page);
      await open(page);
      await fill(page, "Second collision ID");
      await page
        .getByRole("button", { name: "Create request", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "ID already exists" })
        .waitFor();
      assert.equal(await saved(page), original);
      await context.close();
    },
  );
  await check(
    "500-record cap preserves the existing workspace and draft",
    async () => {
      const { context, page } = await fresh();
      const records = Array.from({ length: 500 }, (_, i) => ({
        ...createSeed()[0],
        id: `existing-${i}`,
      }));
      const raw = exportTickets(records);
      await page
        .getByRole("button", { name: "Restore workspace", exact: true })
        .click();
      await page.getByLabel("Workspace JSON").fill(raw);
      await page
        .getByRole("button", { name: "Replace workspace", exact: true })
        .click();
      await open(page);
      await fill(page, "Over record cap");
      await page
        .getByRole("button", { name: "Create request", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "500 requests" })
        .waitFor();
      assert.deepEqual(JSON.parse(await saved(page)), JSON.parse(raw));
      await context.close();
    },
  );
  await check(
    "desktop/mobile layout, minimum targets and modal keyboard containment",
    async () => {
      for (const width of [320, 390, 639, 640, 768, 1024, 1440]) {
        const { context, page } = await fresh({
          viewport: { width, height: 900 },
        });
        await open(page);
        const geometry = await page.getByRole("dialog").evaluate((dialog) => {
          const box = dialog.getBoundingClientRect();
          return {
            width: box.width,
            overflow: dialog.scrollWidth > dialog.clientWidth + 1,
            pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            fieldHeights: [
              ...dialog.querySelectorAll("input,select,button"),
            ].map((el) => el.getBoundingClientRect().height),
            columns: getComputedStyle(dialog.querySelector("form > div"))
              .gridTemplateColumns,
          };
        });
        assert.equal(geometry.overflow, false, `dialog overflow at ${width}`);
        assert.equal(geometry.pageOverflow, false, `page overflow at ${width}`);
        assert.ok(
          geometry.fieldHeights.every((height) => height >= 44),
          `44px controls at ${width}: ${geometry.fieldHeights}`,
        );
        measurements.push({ viewport: width, ...geometry });
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press("Tab");
          const focused = await page.evaluate(() => ({
            tag: document.activeElement?.outerHTML.slice(0, 200),
            inside: document
              .querySelector("dialog[open]")
              .contains(document.activeElement),
          }));
          assert.equal(
            focused.inside,
            true,
            `Tab ${i} at ${width}: ${focused.tag}`,
          );
        }
        for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+Tab");
        assert.equal(
          await page.evaluate(() =>
            document
              .querySelector("dialog[open]")
              .contains(document.activeElement),
          ),
          true,
        );
        if (width === 390) {
          await page.getByLabel("Title *", { exact: true }).focus();
          await page.screenshot({
            path: "docs/create-request/mobile-default.png",
          });
          await page
            .getByRole("button", { name: "Create request", exact: true })
            .click();
          await page.screenshot({
            path: "docs/create-request/mobile-invalid.png",
          });
          await fill(page, "Mobile address correction");
          await page
            .getByRole("button", { name: "Create request", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Request created", exact: true })
            .waitFor();
          await page.screenshot({
            path: "docs/create-request/mobile-success.png",
          });
        }
        await context.close();
      }
    },
  );
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    "docs/create-request/browser-results.json",
    JSON.stringify(
      { results, measurements, errors, browser: browser.version() },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  `Create request browser checks: ${results.filter((r) => r.status === "VERIFIED").length} VERIFIED.`,
);
