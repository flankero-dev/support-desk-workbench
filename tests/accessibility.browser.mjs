import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium, firefox, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
const kind = process.env.AUDIT_BROWSER || "chromium";
const port = 4177;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error("Preview timeout")), 15000);
  server.stdout.on("data", (d) => {
    if (String(d).includes(String(port))) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.once("exit", (c) => reject(Error("Preview exited " + c)));
});
let browser;
const results = [];
const dir = `docs/audit/accessibility-${kind}`;
await mkdir(dir, { recursive: true });
try {
  browser = await { chromium, firefox, webkit }[kind].launch({
    headless: true,
    ...(kind === "chromium" && process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);
  async function scan(state) {
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    results.push({
      state,
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
      incomplete: r.incomplete.map((v) => v.id),
    });
    await page.screenshot({ path: `${dir}/${state}.png`, fullPage: true });
  }
  await scan("queue");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await scan("new-request");
  await page.keyboard.press("Escape");
  await page.locator(".request-title").first().click();
  await scan("ticket");
  await page.getByLabel("Internal note").fill("Keyboard draft");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Restore workspace", exact: true })
    .click();
  await page.getByLabel("Workspace JSON").fill("{broken");
  await page
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  await scan("import-error");
  await page.keyboard.press("Escape");
  for (const zoom of [2, 4]) {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(
      (z) => (document.documentElement.style.zoom = String(z)),
      zoom,
    );
    results.push({
      state: `css-zoom-${zoom}`,
      violations: [],
      geometry: await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.getBoundingClientRect().width,
        viewport: innerWidth,
      })),
    });
    await page.screenshot({
      path: `${dir}/css-zoom-${zoom}.png`,
      fullPage: true,
    });
  }
  await page.evaluate(() => (document.documentElement.style.zoom = ""));
  await page.emulateMedia({ forcedColors: "active" });
  await page.screenshot({ path: `${dir}/forced-colors.png` });
  await page.emulateMedia({ forcedColors: "none" });
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const tp = await touch.newPage();
  await tp.goto(`http://127.0.0.1:${port}`);
  await tp.setViewportSize({ width: 844, height: 390 });
  assert.ok(
    await tp.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await touch.close();
  assert.deepEqual(errors, []);
  assert.equal(
    results.flatMap((r) => r.violations).length,
    0,
    JSON.stringify(results.filter((r) => r.violations.length)),
  );
} finally {
  await writeFile(
    `${dir}/results.json`,
    JSON.stringify(
      { browser: kind, version: browser?.version(), results },
      null,
      2,
    ),
  );
  await browser?.close();
  server.kill();
}
console.log("Accessibility states passed", results.length);
