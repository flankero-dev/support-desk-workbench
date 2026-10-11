import assert from "node:assert/strict";
import { createAppServer } from "../server/app.ts";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  // Browser translators may change option labels. Labels must never become domain values.
  assert.equal(await page.locator("html").getAttribute("translate"), "no");
  // The wrapping label also contains the option text, so an exact label match is incorrect.
  const priorityFilter = page.getByLabel(/^Priority/);
  await priorityFilter.evaluate(select => {
    for (const option of select.options) {
      if (option.value === "Urgent") option.textContent = "Срочный";
    }
  });
  await priorityFilter.selectOption({ label: "Срочный" });
  assert.equal(await page.locator("tbody tr").count(), 2);
  assert.match(page.url(), /priority=Urgent/);
  assert.match(await page.locator(".pagination").innerText(), /1–2 of 2 requests/);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByLabel("Search requests").fill("Definitely no matching request");
  assert.equal(await page.getByRole("heading", { name: "No matching requests" }).count(), 1);
  assert.match(await page.locator(".pagination").innerText(), /0 of 0 requests/);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
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
  assert.equal(await page.getByLabel("Saved view", { exact: true }).inputValue(), "Maya requests");
  await page.reload();
  assert.equal(
    await page.getByRole("textbox", { name: "Search requests" }).inputValue(),
    "MAYA",
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(await page.getByLabel("Saved view", { exact: true }).inputValue(), "");
  await page.getByLabel("Saved view", { exact: true }).selectOption("Maya requests");
  assert.equal(await page.locator("tbody tr").count(), 1);
  assert.equal(await page.getByLabel("Search requests").inputValue(), "MAYA");
  await page.getByLabel("New view name").fill("Same filters");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  assert.match(await page.getByRole("alert").innerText(), /already saved/);
  // An error must not add a second view or erase the original.
  assert.equal(await page.locator("#saved-view option").count(), 2);
  await page.reload();
  await page.getByRole("button", { name: "Remove saved view Maya requests", exact: true }).click();
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
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
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
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
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
  await mobile.getByLabel("Saved view", { exact: true }).selectOption("Mobile triage view");
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
  await mobile.getByRole("button", { name: "Close ticket", exact: true }).click();
  await mobile.getByRole("button", { name: "Reset sample data", exact: true }).click();
  await mobile.getByRole("heading", { name: "Reset sample data?", exact: true }).waitFor();
  await mobile.getByRole("button", { name: "Keep changes", exact: true }).click();
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
  await firstTab.getByRole("button", { name: "Save view", exact: true }).click();
  await secondTab.locator("#saved-view option[value='From first tab']").waitFor({ state: "attached" });
  await secondTab.getByLabel("Search requests").fill("shipping");
  await secondTab.getByLabel("New view name").fill("From second tab");
  await secondTab.getByRole("button", { name: "Save view", exact: true }).click();
  await firstTab.locator("#saved-view option[value='From second tab']").waitFor({ state: "attached" });
  assert.equal(await firstTab.locator("#saved-view option").count(), 3);
  await firstTab.getByRole("button", { name: "Clear", exact: true }).click();
  await secondTab.getByRole("button", { name: "Clear", exact: true }).click();
  const requestName = "Checkout returns to cart after address edit";
  await firstTab.getByRole("button", { name: requestName, exact: true }).click();
  await firstTab.getByRole("dialog").getByRole("combobox", { name: "Status", exact: true }).selectOption("Resolved");
  await secondTab.getByRole("alert").waitFor();
  assert.match(await secondTab.getByRole("alert").innerText(), /Another tab/);
  await secondTab.getByRole("button", { name: requestName, exact: true }).click();
  await secondTab.getByRole("dialog").getByRole("combobox", { name: "Status", exact: true }).selectOption("Waiting");
  await secondTab.getByRole("button", { name: "Close ticket", exact: true }).click();
  await secondTab.getByRole("button", { name: "Reload saved workspace", exact: true }).click();
  await secondTab.getByRole("button", { name: requestName, exact: true }).click();
  assert.equal(await secondTab.getByRole("dialog").getByRole("combobox", { name: "Status", exact: true }).inputValue(), "Resolved");
  await shared.close();
  const corruptViews = await browser.newPage();
  await corruptViews.addInitScript(() => localStorage.setItem("support-desk-views:v1", "{broken"));
  await corruptViews.goto(url);
  await corruptViews.getByLabel("New view name").fill("Must not overwrite");
  await corruptViews.getByRole("button", { name: "Save view", exact: true }).click();
  assert.equal(await corruptViews.evaluate(() => localStorage.getItem("support-desk-views:v1")), "{broken");
  assert.match(await corruptViews.locator(".view-error").innerText(), /Could not save views/);
  const blockedViews = await browser.newPage();
  await blockedViews.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("storage blocked"); }; });
  await blockedViews.goto(url);
  await blockedViews.getByLabel("New view name").fill("Cannot save");
  await blockedViews.getByRole("button", { name: "Save view", exact: true }).click();
  assert.match(await blockedViews.locator(".view-error").innerText(), /storage blocked/);
  assert.equal(await blockedViews.locator("#saved-view option").count(), 1);
  const apiPage = await browser.newPage();
  apiPage.on("pageerror", error => errors.push(error.message));
  await apiPage.goto(url);
  await apiPage.getByRole("button", { name: "Server snapshot", exact: true }).click();
  await apiPage.getByRole("button", { name: "Refresh server copy", exact: true }).click();
  await apiPage.getByText("Server copy loaded for comparison.", { exact: false }).waitFor();
  // A second client saves after the browser has loaded revision 1.
  const staleRevision = await fetch(`${url}/api/workspace`);
  await fetch(`${url}/api/workspace`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": staleRevision.headers.get("ETag") }, body: await staleRevision.text() });
  await apiPage.getByRole("button", { name: "Save browser copy to server", exact: true }).click();
  assert.match(await apiPage.getByRole("alert").innerText(), /server copy changed/);
  assert.equal(await apiPage.getByRole("button", { name: "Save browser copy to server", exact: true }).isDisabled(), true);
  await apiPage.getByRole("button", { name: "Refresh server copy", exact: true }).click();
  await apiPage.getByText("Server copy loaded for comparison.", { exact: false }).waitFor();
  await apiPage.getByRole("button", { name: "Save browser copy to server", exact: true }).click();
  await apiPage.getByText("Saved to SQLite.", { exact: false }).waitFor();
  await apiPage.screenshot({ path: "docs/server-snapshot.png" });
  await apiPage.getByRole("button", { name: "Replace browser copy with server copy", exact: true }).click();
  assert.equal(await apiPage.getByRole("dialog").count(), 0);
  await apiPage.close();
  // Serve the actual production build under a non-loopback origin, as on Pages.
  // Static hosts must not advertise a local-only API action that returns 404.
  const hosted = await browser.newPage();
  hosted.on("pageerror", error => errors.push(error.message));
  await hosted.route("https://demo.example.test/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({ path: resolve("dist", pathname === "/" ? "index.html" : pathname.slice(1)) });
  });
  await hosted.goto("https://demo.example.test/");
  assert.equal(await hosted.getByRole("heading", { name: "Request queue" }).count(), 1);
  assert.equal(await hosted.getByRole("button", { name: "Server snapshot", exact: true }).count(), 0);
  await hosted.getByRole("button", { name: "Import JSON", exact: true }).click();
  assert.equal(await hosted.getByRole("dialog").count(), 1);
  await hosted.getByRole("button", { name: "Cancel", exact: true }).click();
  await hosted.close();
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: pagination, URL filters, saved views (reload, apply, duplicate, removal, two tabs, corrupt and blocked storage), ticket editing, notes, focus, persistence, bulk update, empty state, import/export, reset, keyboard shortcut, mobile layout, server snapshots and static-host controls.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
