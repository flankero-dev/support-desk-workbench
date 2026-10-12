import assert from "node:assert/strict";
import { createAppServer } from "../server/app.ts";
import { mkdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const server = createAppServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const errors = [];
try {
  await mkdir("docs", { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  assert.equal(
    await page.getByRole("heading", { name: "Request queue" }).count(),
    1,
  );
  assert.equal(await page.locator("tbody tr").count(), 8);
  // Page selection persists across pagination; deselecting a page leaves other pages alone.
  await page.getByLabel("Select SD-1042", { exact: true }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Select visible requests", { exact: true }).check();
  assert.match(await page.locator(".bulk-bar").innerText(), /9 selected/);
  await page.getByLabel("Select visible requests", { exact: true }).uncheck();
  assert.match(await page.locator(".bulk-bar").innerText(), /1 selected/);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  assert.equal(
    await page.getByLabel("Select SD-1042", { exact: true }).isChecked(),
    true,
  );
  await page
    .getByRole("button", { name: "Cancel selection", exact: true })
    .click();
  await page.getByLabel("Select SD-1042", { exact: true }).check();
  await page.getByLabel("New status", { exact: true }).selectOption("Open");
  await page.getByRole("button", { name: "Apply status", exact: true }).click();
  assert.match(
    await page.locator(".announcement").innerText(),
    /No changes: all 1 selected requests are already Open/,
  );
  await page.getByLabel("Select SD-1042", { exact: true }).check();
  await page.getByLabel("Select SD-1041", { exact: true }).check();
  await page.getByRole("button", { name: "Apply status", exact: true }).click();
  assert.match(
    await page.locator(".announcement").innerText(),
    /Updated 1 of 2 selected requests to Open/,
  );
  await page.screenshot({
    path: "docs/support-bulk-feedback.png",
    fullPage: true,
  });
  // Restore the untouched sample for the rest of the scenarios.
  await page
    .getByRole("button", { name: "Reset sample data", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset workspace", exact: true })
    .click();
  // Browser translators may change option labels. Labels must never become domain values.
  assert.equal(await page.locator("html").getAttribute("translate"), "no");
  // The wrapping label also contains the option text, so an exact label match is incorrect.
  const priorityFilter = page.getByLabel(/^Priority/);
  await priorityFilter.evaluate((select) => {
    for (const option of select.options) {
      if (option.value === "Urgent") option.textContent = "Срочный";
    }
  });
  await priorityFilter.selectOption({ label: "Срочный" });
  assert.equal(await page.locator("tbody tr").count(), 2);
  assert.match(page.url(), /priority=Urgent/);
  assert.match(
    await page.locator(".pagination").innerText(),
    /1–2 of 2 requests/,
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page
    .getByLabel("Search requests")
    .fill("Definitely no matching request");
  assert.equal(
    await page.getByRole("heading", { name: "No matching requests" }).count(),
    1,
  );
  assert.match(
    await page.locator(".pagination").innerText(),
    /0 of 0 requests/,
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.reload();
  await mkdir("docs", { recursive: true });
  await page.screenshot({ path: "docs/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.match(await page.locator(".pagination").innerText(), /Page 2 of 3/);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(await page.locator("tbody tr").count(), 2);
  await page
    .getByRole("button", { name: "Next", exact: true })
    .isDisabled()
    .then((value) => assert.equal(value, true));
  await page.getByRole("textbox", { name: "Search requests" }).fill("MAYA");
  assert.equal(await page.locator("tbody tr").count(), 1);
  assert.match(page.url(), /q=MAYA/);
  await page.getByLabel("New view name").fill("Maya requests");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  assert.equal(
    await page.getByLabel("Saved view", { exact: true }).inputValue(),
    "Maya requests",
  );
  await page.reload();
  assert.equal(
    await page.getByRole("textbox", { name: "Search requests" }).inputValue(),
    "MAYA",
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(
    await page.getByLabel("Saved view", { exact: true }).inputValue(),
    "",
  );
  await page
    .getByLabel("Saved view", { exact: true })
    .selectOption("Maya requests");
  assert.equal(await page.locator("tbody tr").count(), 1);
  assert.equal(await page.getByLabel("Search requests").inputValue(), "MAYA");
  await page.getByLabel("New view name").fill("Same filters");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  assert.match(await page.getByRole("alert").innerText(), /already saved/);
  // An error must not add a second view or erase the original.
  assert.equal(await page.locator("#saved-view option").count(), 2);
  await page.reload();
  await page
    .getByRole("button", {
      name: "Remove saved view Maya requests",
      exact: true,
    })
    .click();
  assert.equal(await page.locator("#saved-view option").count(), 1);
  await page.reload();
  assert.equal(await page.locator("#saved-view option").count(), 1);
  await page
    .getByRole("button", {
      name: "Checkout returns to cart after address edit",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("In progress");
  await page
    .getByRole("dialog")
    .getByLabel("Internal note")
    .fill("Confirmed the address update scenario.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  assert.match(
    await page.locator(".activity").innerText(),
    /Confirmed the address update scenario/,
  );
  await page.screenshot({ path: "docs/ticket.png", fullPage: true });
  await page
    .getByRole("button", { name: "Close ticket", exact: true })
    .press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(
    await page
      .getByRole("button", {
        name: "Checkout returns to cart after address edit",
        exact: true,
      })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.reload();
  assert.match(await page.locator("tbody").innerText(), /In progress/);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Select visible requests", exact: true })
    .check();
  await page.getByLabel("New status", { exact: true }).selectOption("Resolved");
  await page.getByRole("button", { name: "Apply status", exact: true }).click();
  assert.equal(await page.locator("tbody .status.resolved").count(), 8);
  await page
    .getByRole("textbox", { name: "Search requests" })
    .fill("No matching customer");
  assert.equal(
    await page.getByRole("heading", { name: "No matching requests" }).count(),
    1,
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  await page.getByLabel("Workspace JSON").fill("{broken");
  await page
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  assert.match(await page.getByRole("alert").innerText(), /Invalid JSON/);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export workspace/ }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.tickets.length, 18);
  await page
    .getByRole("button", { name: "Reset sample data", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep changes", exact: true }).click();
  assert.equal(await page.locator("tbody .status.resolved").count(), 8);
  await page
    .getByRole("button", { name: "Reset sample data", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset workspace", exact: true })
    .click();
  assert.equal(await page.locator("tbody .status.resolved").count(), 0);
  await page
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  await page.getByLabel("Workspace JSON").fill(JSON.stringify(exported));
  await page
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  assert.equal(await page.locator("tbody .status.resolved").count(), 8);
  await page.getByRole("heading", { name: "Request queue" }).click();
  await page.keyboard.press("/");
  assert.equal(
    await page
      .getByRole("textbox", { name: "Search requests" })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  await mobile.goto(url);
  await mobile.getByLabel("Search requests").fill("MAYA");
  await mobile.getByLabel("New view name").fill("Mobile triage view");
  await mobile.getByRole("button", { name: "Save view", exact: true }).click();
  await mobile.getByRole("button", { name: "Clear", exact: true }).click();
  await mobile
    .getByLabel("Saved view", { exact: true })
    .selectOption("Mobile triage view");
  assert.equal(await mobile.locator("tbody tr").count(), 1);
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await mobile.screenshot({ path: "docs/mobile.png", fullPage: true });
  await mobile
    .getByRole("button", {
      name: "Checkout returns to cart after address edit",
      exact: true,
    })
    .click();
  assert.equal(await mobile.getByRole("dialog").isVisible(), true);
  await mobile
    .getByRole("button", { name: "Close ticket", exact: true })
    .click();
  await mobile
    .getByRole("button", { name: "Reset sample data", exact: true })
    .click();
  await mobile
    .getByRole("heading", { name: "Reset sample data?", exact: true })
    .waitFor();
  await mobile
    .getByRole("button", { name: "Keep changes", exact: true })
    .click();
  assert.equal(await mobile.getByRole("dialog").isVisible(), false);
  const recovery = await browser.newPage();
  await recovery.addInitScript(() =>
    localStorage.setItem("support-desk-workbench:v1", "{broken"),
  );
  await recovery.goto(url);
  assert.match(
    await recovery.getByRole("alert").innerText(),
    /could not be loaded/,
  );
  assert.equal(
    await recovery.evaluate(() =>
      localStorage.getItem("support-desk-workbench:v1"),
    ),
    "{broken",
  );
  const blockedStorage = await browser.newPage();
  await blockedStorage.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("storage blocked");
    };
  });
  await blockedStorage.goto(url);
  await blockedStorage
    .getByRole("button", {
      name: "Checkout returns to cart after address edit",
      exact: true,
    })
    .click();
  await blockedStorage
    .getByRole("dialog")
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("Resolved");
  await blockedStorage.getByRole("alert").waitFor();
  assert.match(
    await blockedStorage.getByRole("alert").innerText(),
    /storage is unavailable/,
  );
  const shared = await browser.newContext();
  const firstTab = await shared.newPage();
  const secondTab = await shared.newPage();
  await firstTab.goto(url);
  await secondTab.goto(url);
  await firstTab.getByLabel("Search requests").fill("MAYA");
  await firstTab.getByLabel("New view name").fill("From first tab");
  await firstTab
    .getByRole("button", { name: "Save view", exact: true })
    .click();
  await secondTab
    .locator("#saved-view option[value='From first tab']")
    .waitFor({ state: "attached" });
  await secondTab.getByLabel("Search requests").fill("shipping");
  await secondTab.getByLabel("New view name").fill("From second tab");
  await secondTab
    .getByRole("button", { name: "Save view", exact: true })
    .click();
  await firstTab
    .locator("#saved-view option[value='From second tab']")
    .waitFor({ state: "attached" });
  assert.equal(await firstTab.locator("#saved-view option").count(), 3);
  await firstTab.getByRole("button", { name: "Clear", exact: true }).click();
  await secondTab.getByRole("button", { name: "Clear", exact: true }).click();
  const requestName = "Checkout returns to cart after address edit";
  await firstTab
    .getByRole("button", { name: requestName, exact: true })
    .click();
  await firstTab
    .getByRole("dialog")
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("Resolved");
  await secondTab.getByRole("alert").waitFor();
  assert.match(await secondTab.getByRole("alert").innerText(), /Another tab/);
  await secondTab
    .getByRole("button", { name: requestName, exact: true })
    .click();
  await secondTab
    .getByRole("dialog")
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("Waiting");
  await secondTab
    .getByRole("button", { name: "Close ticket", exact: true })
    .click();
  await secondTab
    .getByRole("button", { name: "Reload saved workspace", exact: true })
    .click();
  await secondTab
    .getByRole("button", { name: requestName, exact: true })
    .click();
  assert.equal(
    await secondTab
      .getByRole("dialog")
      .getByRole("combobox", { name: "Status", exact: true })
      .inputValue(),
    "Resolved",
  );
  await shared.close();
  const corruptViews = await browser.newPage();
  await corruptViews.addInitScript(() => {
    if (!sessionStorage.getItem("corruption-seeded")) {
      localStorage.setItem("support-desk-views:v1", "{broken");
      sessionStorage.setItem("corruption-seeded", "yes");
    }
  });
  await corruptViews.goto(url);
  await corruptViews.getByLabel("New view name").fill("Must not overwrite");
  await corruptViews
    .getByRole("button", { name: "Save view", exact: true })
    .click();
  assert.equal(
    await corruptViews.evaluate(() =>
      localStorage.getItem("support-desk-views:v1"),
    ),
    "{broken",
  );
  assert.match(
    await corruptViews.locator(".view-error").innerText(),
    /Could not save views/,
  );
  await corruptViews
    .getByRole("button", { name: "Reset saved views", exact: true })
    .click();
  await corruptViews
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal(
    await corruptViews.evaluate(() =>
      localStorage.getItem("support-desk-views:v1"),
    ),
    "{broken",
  );
  await corruptViews
    .getByRole("button", { name: "Reset saved views", exact: true })
    .click();
  await corruptViews
    .getByRole("button", { name: "Discard saved views", exact: true })
    .click();
  assert.equal(
    await corruptViews.evaluate(() =>
      localStorage.getItem("support-desk-views:v1"),
    ),
    null,
  );
  await corruptViews.getByLabel("New view name").fill("Recovered view");
  await corruptViews
    .getByRole("button", { name: "Save view", exact: true })
    .click();
  await corruptViews.reload();
  const recovered = corruptViews;
  assert.match(
    await recovered.getByLabel("Saved view", { exact: true }).innerText(),
    /Recovered view/,
  );
  await recovered.evaluate(() =>
    localStorage.setItem("support-desk-views:v1", "{broken"),
  );
  await recovered.reload();
  await recovered
    .getByRole("button", { name: "Reset saved views", exact: true })
    .click();
  const peerCopy = JSON.stringify({ version: 1, views: [] });
  await recovered.evaluate(
    (raw) => localStorage.setItem("support-desk-views:v1", raw),
    peerCopy,
  );
  await recovered
    .getByRole("button", { name: "Discard saved views", exact: true })
    .click();
  assert.equal(
    await recovered.evaluate(() =>
      localStorage.getItem("support-desk-views:v1"),
    ),
    peerCopy,
  );
  const blockedViews = await browser.newPage();
  await blockedViews.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("storage blocked");
    };
  });
  await blockedViews.goto(url);
  await blockedViews.getByLabel("New view name").fill("Cannot save");
  await blockedViews
    .getByRole("button", { name: "Save view", exact: true })
    .click();
  assert.match(
    await blockedViews.locator(".view-error").innerText(),
    /storage blocked/,
  );
  assert.equal(await blockedViews.locator("#saved-view option").count(), 1);
  const apiPage = await browser.newPage();
  apiPage.on("pageerror", (error) => errors.push(error.message));
  await apiPage.goto(url);
  await apiPage
    .getByRole("button", { name: "Server snapshot", exact: true })
    .click();
  await apiPage
    .getByRole("button", { name: "Refresh server copy", exact: true })
    .click();
  await apiPage
    .getByText("Server copy loaded for comparison.", { exact: false })
    .waitFor();
  // A second client saves after the browser has loaded revision 1.
  const staleRevision = await fetch(`${url}/api/workspace`);
  await fetch(`${url}/api/workspace`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": staleRevision.headers.get("ETag"),
    },
    body: await staleRevision.text(),
  });
  await apiPage
    .getByRole("button", { name: "Save browser copy to server", exact: true })
    .click();
  assert.match(
    await apiPage.getByRole("alert").innerText(),
    /server copy changed/,
  );
  assert.equal(
    await apiPage
      .getByRole("button", { name: "Save browser copy to server", exact: true })
      .isDisabled(),
    true,
  );
  await apiPage
    .getByRole("button", { name: "Refresh server copy", exact: true })
    .click();
  await apiPage
    .getByText("Server copy loaded for comparison.", { exact: false })
    .waitFor();
  await apiPage
    .getByRole("button", { name: "Save browser copy to server", exact: true })
    .click();
  await apiPage.getByText("Saved to SQLite.", { exact: false }).waitFor();
  await apiPage.screenshot({ path: "docs/server-snapshot.png" });
  await apiPage
    .getByRole("button", {
      name: "Replace browser copy with server copy",
      exact: true,
    })
    .click();
  assert.equal(await apiPage.getByRole("dialog").count(), 0);
  await apiPage.close();
  // Serve the actual production build under a non-loopback origin, as on Pages.
  // Static hosts must not advertise a local-only API action that returns 404.
  const hosted = await browser.newPage();
  hosted.on("pageerror", (error) => errors.push(error.message));
  await hosted.route("https://demo.example.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({
      path: resolve(
        "dist",
        pathname === "/" ? "index.html" : pathname.slice(1),
      ),
    });
  });
  await hosted.goto("https://demo.example.test/");
  assert.equal(
    await hosted.getByRole("heading", { name: "Request queue" }).count(),
    1,
  );
  assert.equal(
    await hosted
      .getByRole("button", { name: "Server snapshot", exact: true })
      .count(),
    0,
  );
  const contrastProblems = await hosted
    .locator(
      ".status,.priority,.assignee,.request-meta,td time,.small-label,.workspace-label,.nav span,.metrics small",
    )
    .evaluateAll((elements) => {
      const rgb = (value) => value.match(/[\d.]+/g).map(Number);
      const lum = (color) =>
        color
          .slice(0, 3)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      return elements
        .filter((el) => el.getClientRects().length)
        .flatMap((el) => {
          let bg = [255, 255, 255];
          const ancestors = [];
          for (let n = el; n; n = n.parentElement) ancestors.unshift(n);
          for (const n of ancestors) {
            const c = rgb(getComputedStyle(n).backgroundColor);
            const a = c[3] ?? 1;
            bg = bg.map((v, i) => c[i] * a + v * (1 - a));
          }
          const fg = rgb(getComputedStyle(el).color);
          const values = [lum(fg), lum(bg)].sort((a, b) => a - b);
          const ratio = (values[1] + 0.05) / (values[0] + 0.05);
          return ratio < 4.5 ? [{ text: el.textContent, ratio }] : [];
        });
    });
  assert.deepEqual(
    contrastProblems,
    [],
    "compact labels must remain readable against their actual backgrounds",
  );
  const scrollPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await scrollPage.goto(url);
  await scrollPage
    .getByRole("region", { name: "Request table", exact: true })
    .focus();
  await scrollPage.keyboard.press("ArrowRight");
  await scrollPage.waitForFunction(
    () => document.querySelector(".table-scroll").scrollLeft > 0,
  );
  await scrollPage.close();
  await hosted.screenshot({ path: "docs/workspace.png", fullPage: true });
  await hosted
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  assert.equal(await hosted.getByRole("dialog").count(), 1);
  await hosted.getByRole("button", { name: "Cancel", exact: true }).click();
  await hosted.close();
  const edge = await browser.newPage({ viewport: { width: 320, height: 700 } });
  edge.on("pageerror", (error) => errors.push(error.message));
  await edge.goto(url);
  const edgeSeed = (await import("../src/domain/seed.ts")).createSeed();
  const longAssignee = "А".repeat(200);
  edgeSeed[0] = {
    ...edgeSeed[0],
    id: "I".repeat(200),
    title: "T".repeat(200),
    customer: "C".repeat(200),
    description: "D".repeat(4000),
    assignee: longAssignee,
  };
  edgeSeed[1].assignee = "All";
  await edge
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  await edge
    .getByLabel("Workspace JSON")
    .fill(JSON.stringify({ version: 1, tickets: edgeSeed }));
  await edge
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  await edge
    .locator(".filters")
    .getByLabel(/^Assignee/)
    .selectOption(longAssignee);
  await edge.getByLabel("New view name").fill("Long assignee");
  await edge.getByRole("button", { name: "Save view", exact: true }).click();
  await edge.reload();
  assert.equal(await edge.locator("tbody tr").count(), 1);
  assert.equal(await edge.locator(".view-error").count(), 0);
  await edge.locator(".request-title").first().click();
  assert.equal(
    await edge
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  await edge.screenshot({ path: "docs/long-import-mobile.png" });
  await edge.keyboard.press("Escape");
  await edge
    .locator(".filters")
    .getByLabel(/^Assignee/)
    .selectOption("person:All");
  assert.equal(await edge.locator("tbody tr").count(), 1);
  await edge.reload();
  assert.equal(
    await edge
      .locator(".filters")
      .getByLabel(/^Assignee/)
      .inputValue(),
    "person:All",
  );
  assert.equal(await edge.locator("tbody tr").count(), 1);
  await edge.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(
    await edge
      .locator(".filters")
      .getByLabel(/^Assignee/)
      .inputValue(),
    "All",
  );
  assert.equal(await edge.locator("tbody tr").count(), 8);
  await edge.locator("tbody input[type=checkbox]").first().check();
  assert.equal(
    await edge
      .getByLabel("Select visible requests")
      .evaluate((el) => el.indeterminate),
    true,
  );
  await edge
    .getByRole("button", { name: "Cancel selection", exact: true })
    .click();
  await edge
    .locator(".filters")
    .getByLabel(/^Status/)
    .selectOption("Open");
  await edge.locator(".request-title").first().click();
  await edge
    .getByRole("dialog")
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("Waiting");
  await edge.keyboard.press("Escape");
  await edge.locator(".ticket-dialog").waitFor({ state: "detached" });
  assert.equal(
    await edge
      .getByLabel("Search requests")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await edge
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  const historyTicket = {
    ...edgeSeed[1],
    activity: Array.from({ length: 500 }, () => ({
      at: edgeSeed[1].createdAt,
      text: "Imported history",
    })),
  };
  await edge
    .getByLabel("Workspace JSON")
    .fill(JSON.stringify({ version: 1, tickets: [historyTicket] }));
  await edge
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  await edge.getByRole("button", { name: "Clear", exact: true }).click();
  await edge.locator(".request-title").first().click();
  await edge.getByLabel("Internal note").fill("History must survive reload");
  await edge.getByRole("button", { name: "Add note", exact: true }).click();
  await edge.getByRole("button", { name: "Close ticket", exact: true }).click();
  await edge.reload();
  assert.equal(await edge.getByRole("alert").count(), 0);
  await edge.locator(".request-title").first().click();
  assert.match(
    await edge.locator(".activity").innerText(),
    /History must survive reload/,
  );
  const nearLimitTicket = { ...edgeSeed[1], activity: [] };
  const historyEntry = {
    at: nearLimitTicket.createdAt,
    text: "H".repeat(1190),
  };
  const wrap = (ticket) => JSON.stringify({ version: 1, tickets: [ticket] });
  const count = Math.floor(
    (1_999_990 - wrap(nearLimitTicket).length) /
      (JSON.stringify(historyEntry).length + 1),
  );
  nearLimitTicket.activity = Array.from({ length: count }, () => ({
    ...historyEntry,
  }));
  let remaining = 1_999_990 - wrap(nearLimitTicket).length;
  for (const entry of nearLimitTicket.activity) {
    const extra = Math.min(remaining, 10);
    entry.text += "H".repeat(extra);
    remaining -= extra;
    if (!remaining) break;
  }
  const nearLimit = wrap(nearLimitTicket);
  const capacity = await browser.newPage();
  capacity.on("pageerror", (error) => errors.push(error.message));
  await capacity.addInitScript(
    (value) => localStorage.setItem("support-desk-workbench:v1", value),
    nearLimit,
  );
  await capacity.goto(url);
  await capacity.locator(".request-title").first().click();
  await capacity.getByLabel("Internal note").fill("N".repeat(1000));
  await capacity.getByRole("button", { name: "Add note", exact: true }).click();
  await capacity
    .getByRole("alert")
    .filter({ hasText: "Nothing was changed" })
    .waitFor();
  assert.equal(
    await capacity.getByLabel("Internal note").inputValue(),
    "N".repeat(1000),
  );
  assert.equal(await capacity.locator(".activity li").count(), count);
  await capacity.screenshot({
    path: "docs/support-size-rejection.png",
  });
  await capacity
    .getByRole("dialog")
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("Resolved");
  assert.equal(
    await capacity
      .getByRole("dialog")
      .getByRole("combobox", { name: "Status", exact: true })
      .inputValue(),
    nearLimitTicket.status,
  );
  await capacity
    .getByRole("button", { name: "Close ticket", exact: true })
    .click();
  assert.equal(
    await capacity.evaluate(() =>
      localStorage.getItem("support-desk-workbench:v1"),
    ),
    nearLimit,
  );
  const exportPromise = capacity.waitForEvent("download");
  await capacity
    .getByRole("button", { name: "Export workspace", exact: false })
    .click();
  const exportedFile = await exportPromise;
  const downloadDirectory = await mkdtemp(
    join(tmpdir(), "support-desk-export-"),
  );
  const downloadedPath = join(
    downloadDirectory,
    exportedFile.suggestedFilename(),
  );
  await exportedFile.saveAs(downloadedPath);
  const exportedJSON = await readFile(downloadedPath, "utf8");
  const { parseImport } = await import("../src/domain/tickets.ts");
  assert.deepEqual(parseImport(exportedJSON), [nearLimitTicket]);
  await capacity
    .getByRole("button", { name: "Reset sample data", exact: true })
    .click();
  await capacity
    .getByRole("button", { name: "Reset workspace", exact: true })
    .click();
  assert.equal(await capacity.locator("tbody tr").count(), 8);
  await capacity
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  await capacity
    .getByLabel("Exported workspace file")
    .setInputFiles(downloadedPath);
  await capacity.getByLabel("Workspace JSON").evaluate(
    (element) =>
      new Promise((resolve) => {
        const poll = () => (element.value ? resolve() : setTimeout(poll, 10));
        poll();
      }),
  );
  await capacity
    .getByRole("status")
    .filter({ hasText: "Loaded support-desk-workspace" })
    .waitFor();
  await capacity.setViewportSize({ width: 320, height: 900 });
  assert.equal(
    await capacity
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    true,
  );
  await capacity.screenshot({ path: "docs/support-file-restore.png" });

  await capacity
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  assert.equal(await capacity.locator("tbody tr").count(), 1);
  await capacity
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  await capacity.getByLabel("Exported workspace file").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await capacity
    .getByRole("alert")
    .filter({ hasText: "Invalid JSON" })
    .waitFor();
  assert.equal(
    await capacity
      .getByRole("button", { name: "Replace workspace", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await capacity.evaluate(
      () =>
        JSON.parse(localStorage.getItem("support-desk-workbench:v1")).tickets
          .length,
    ),
    1,
  );
  // The same file can be chosen again after a failed import.
  await capacity
    .getByLabel("Exported workspace file")
    .setInputFiles(downloadedPath);
  await capacity.waitForFunction(
    () => document.querySelector("#import-json").value.length > 0,
  );
  await capacity
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  await capacity.close();
  await rm(downloadDirectory, { recursive: true, force: true });
  await edge.close();
  for (const width of [320, 360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
      `queue at ${width}: no page overflow`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: pagination, URL filters, saved views (reload, apply, duplicate, removal, two tabs, corrupt and blocked storage), ticket editing, notes, focus, persistence, bulk update, empty state, import/export, reset, keyboard shortcut, mobile layout, server snapshots and static-host controls.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
