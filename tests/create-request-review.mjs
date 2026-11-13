// Independent black-box review: production assets, computed CSS, accessibility
// and adversarial data. No assertion relies on React state or Tailwind strings.
import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
const browserType = process.env.AUDIT_BROWSER || "chromium";
import AxeBuilder from "@axe-core/playwright";
import { createAppServer } from "../server/app.ts";
import { createSeed } from "../src/domain/seed.ts";
import { exportTickets, parseImport } from "../src/domain/tickets.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const browser = await { chromium, firefox, webkit }[browserType].launch({
  headless: true,
  ...((browserType === "chromium" ? process.env.CHROMIUM_PATH : undefined)
    ? {
        executablePath:
          browserType === "chromium" ? process.env.CHROMIUM_PATH : undefined,
      }
    : {}),
});
const server = createAppServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const evidence = {
  browser: browser.version(),
  accessibility: [],
  contrast: [],
  baselineCSS: "UNVERIFIED",
  checks: [],
};
let baseline;
await mkdir("docs/create-request", { recursive: true });
async function open(page) {
  await page.getByRole("button", { name: "New request", exact: true }).click();
}
async function fill(page, title = "Review request") {
  await page.getByLabel("Title *", { exact: true }).fill(title);
  await page.getByLabel("Customer *", { exact: true }).fill("Customer");
  await page.getByLabel("Category *", { exact: true }).fill("Review");
  await page
    .getByLabel("Description *", { exact: true })
    .fill("Reproduce this issue and keep previous records intact.");
}
async function axe(page, state) {
  const result = await new AxeBuilder({ page })
    .include(".create-request")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  evidence.accessibility.push({
    state,
    violations: result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map((n) => n.target),
    })),
    incomplete: result.incomplete.map(({ id }) => id),
  });
  assert.deepEqual(result.violations, [], `axe ${state}`);
  // axe can mark contrast incomplete for native controls. Measure their actual
  // foreground/background cascade separately rather than hiding that result.
  const contrast = await page.locator(".create-request").evaluate((dialog) => {
    const rgb = (value) => value.match(/[\d.]+/g).map(Number);
    const lum = (c) =>
      c
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) =>
      (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const measured = [
      ...dialog.querySelectorAll("p,span,h2,h3,button,input,select,textarea"),
    ]
      .filter((el) => el.getClientRects().length)
      .map((el) => {
        let background = [255, 255, 255];
        const ancestors = [];
        for (let n = el; n; n = n.parentElement) ancestors.unshift(n);
        for (const n of ancestors) {
          const c = rgb(getComputedStyle(n).backgroundColor);
          const a = c[3] ?? 1;
          background = background.map((v, i) => c[i] * a + v * (1 - a));
        }
        const style = getComputedStyle(el);
        return {
          tag: el.tagName,
          text:
            el.getAttribute("aria-labelledby") ?? el.textContent?.slice(0, 70),
          textRatio: ratio(rgb(style.color), background),
          ...(el.matches("input,select,textarea")
            ? { borderRatio: ratio(rgb(style.borderTopColor), background) }
            : {}),
        };
      });
    return {
      minimumText: Math.min(...measured.map((m) => m.textRatio)),
      minimumControlBorder: Math.min(
        ...measured
          .filter((m) => m.borderRatio !== undefined)
          .map((m) => m.borderRatio),
      ),
      measured,
    };
  });
  evidence.contrast.push({ state, ...contrast });
  assert.ok(contrast.minimumText >= 4.5, `text contrast ${state}`);
  assert.ok(
    contrast.minimumControlBorder >= 3,
    `control boundary contrast ${state}`,
  );
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(url);
  if (process.env.BASELINE_DIST) {
    baseline = createAppServer(":memory:", resolve(process.env.BASELINE_DIST));
    await new Promise((done) => baseline.listen(0, "127.0.0.1", done));
    const old = await context.newPage();
    await old.goto(`http://127.0.0.1:${baseline.address().port}`);
    await old.screenshot({
      path: "docs/create-request/before-desktop.png",
      fullPage: true,
    });
    await old.setViewportSize({ width: 390, height: 844 });
    await old.screenshot({
      path: "docs/create-request/before-mobile.png",
      fullPage: true,
    });
    const styles = async (tab) =>
      tab.evaluate(() => {
        const selectors = [
          "h1",
          ".topbar",
          ".metrics strong",
          ".request-title",
          "thead",
          ".status",
          ".sort-label select",
          ".pagination button",
        ];
        const properties = [
          "fontFamily",
          "fontSize",
          "fontWeight",
          "lineHeight",
          "color",
          "backgroundColor",
          "borderRadius",
          "borderColor",
          "padding",
        ];
        return Object.fromEntries(
          selectors.map((selector) => {
            const s = getComputedStyle(document.querySelector(selector));
            return [
              selector,
              Object.fromEntries(properties.map((p) => [p, s[p]])),
            ];
          }),
        );
      });
    await old.setViewportSize({ width: 1440, height: 1000 });
    const before = await styles(old);
    const after = await styles(page);
    assert.deepEqual(
      after,
      before,
      "existing typography/control styles unchanged by Tailwind",
    );
    evidence.baselineCSS = { status: "VERIFIED", before, after };
    await old.close();
  }
  await open(page);
  await axe(page, "desktop default");
  await page
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await axe(page, "desktop invalid");
  // Implicit Enter must focus the first missing field beyond title.
  await page.getByLabel("Title *", { exact: true }).fill("Only title entered");
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .getByLabel("Customer *", { exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await fill(page, '<img src=x onerror="window.injected=true">');
  await page
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Request created", exact: true })
    .waitFor();
  await axe(page, "desktop success");
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.getByRole("dialog").locator("img").count(), 0);
  await page
    .getByRole("button", { name: "Back to queue", exact: true })
    .click();
  evidence.checks.push({
    name: "Enter first error and literal hostile text",
    status: "VERIFIED",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await axe(page, "mobile default");
  await page
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await axe(page, "mobile invalid");
  await page.keyboard.press("Escape");
  await context.close();

  // Adversarial polish review: rendered hierarchy, full identifiers and long
  // titles at narrow/breakpoint/desktop widths, with keyboard-only submission.
  evidence.polish = [];
  for (const width of [320, 390, 639, 640, 1440]) {
    const scoped = await browser.newContext({
      viewport: { width, height: width < 640 ? 844 : 1000 },
    });
    const tab = await scoped.newPage();
    await tab.goto(url);
    await open(tab);
    await tab.keyboard.press("Enter");
    const titleField = tab.getByLabel("Title *", { exact: true });
    const focusStyle = await titleField.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        active: el === document.activeElement,
        visible: el.matches(":focus-visible"),
        border: s.borderTopColor,
        outline: s.outlineColor,
        width: s.outlineWidth,
        offset: s.outlineOffset,
        style: s.outlineStyle,
      };
    });
    assert.deepEqual(focusStyle, {
      active: true,
      visible: true,
      border: "rgb(155, 67, 53)",
      outline: "rgb(155, 67, 53)",
      width: "3px",
      offset: "3px",
      style: "solid",
    });
    if ([390, 1440].includes(width))
      await tab.screenshot({
        path: `docs/create-request/polish-${width}-invalid.png`,
      });
    const title =
      width === 390
        ? "Довга назва заявки ".repeat(11).slice(0, 200)
        : "W".repeat(200);
    await fill(tab, title);
    await titleField.focus();
    assert.equal(
      await titleField.evaluate((el) => getComputedStyle(el).outlineColor),
      "rgb(39, 103, 82)",
      "valid keyboard focus retains the existing green outline",
    );
    await tab.keyboard.press("Enter");
    const heading = tab.getByRole("heading", { name: title, exact: true });
    await heading.waitFor();
    const records = parseImport(
      await tab.evaluate(() =>
        localStorage.getItem("support-desk-workbench:v1"),
      ),
    );
    const record = records.find((ticket) => ticket.title === title);
    assert.match(record.id, /^REQ-[0-9a-f-]{36}$/);
    const idText = tab
      .getByRole("dialog")
      .getByText(record.id, { exact: true });
    await idText.waitFor();
    const hierarchy = await heading.evaluate((el) => {
      const dialog = el.closest("dialog");
      const id = dialog.querySelector(".mono");
      const title = getComputedStyle(el);
      const identifier = getComputedStyle(id);
      return {
        titleSize: parseFloat(title.fontSize),
        idSize: parseFloat(identifier.fontSize),
        weight: Number(title.fontWeight),
        titleBeforeId: Boolean(
          el.compareDocumentPosition(id) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        overflow: dialog.scrollWidth > dialog.clientWidth + 1,
        titleOverflow: el.scrollWidth > el.clientWidth + 1,
      };
    });
    assert.ok(hierarchy.titleSize > hierarchy.idSize);
    assert.ok(hierarchy.weight >= 600);
    assert.equal(hierarchy.titleBeforeId, true);
    assert.equal(hierarchy.overflow, false);
    assert.equal(hierarchy.titleOverflow, false);
    assert.equal(
      await tab
        .locator("#created-heading")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    if ([390, 1440].includes(width)) {
      await axe(tab, `polish ${width} long-title success`);
      await tab.screenshot({
        path: `docs/create-request/polish-${width}-success.png`,
      });
    }
    await tab.keyboard.press("Tab");
    assert.equal(
      await tab
        .getByRole("button", { name: "Back to queue", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await tab.keyboard.press("Tab");
    await tab.keyboard.press("Enter");
    await tab
      .getByRole("dialog")
      .getByText(record.id, { exact: true })
      .waitFor();
    await tab.keyboard.press("Escape");
    await tab.reload();
    const reloaded = parseImport(
      await tab.evaluate(() =>
        localStorage.getItem("support-desk-workbench:v1"),
      ),
    );
    assert.deepEqual(
      reloaded.find((ticket) => ticket.id === record.id),
      record,
    );
    await open(tab);
    assert.equal(await titleField.inputValue(), "");
    await tab.keyboard.press("Escape");
    evidence.polish.push({
      width,
      status: "VERIFIED",
      focusStyle,
      hierarchy,
      fullIdPreserved: true,
      reload: true,
      keyboardViewRequest: true,
    });
    await scoped.close();
  }

  const capacityContext = await browser.newContext();
  const capacity = await capacityContext.newPage();
  const source = [createSeed()[0]];
  const at = source[0].createdAt;
  while (Buffer.byteLength(exportTickets(source)) < 1_997_000)
    source[0].activity.push({ at, text: "H".repeat(1000) });
  const raw = exportTickets(source);
  parseImport(raw);
  await capacity.addInitScript(
    (raw) => localStorage.setItem("support-desk-workbench:v1", raw),
    raw,
  );
  await capacity.goto(url);
  await open(capacity);
  await fill(capacity);
  await capacity
    .getByLabel("Description *", { exact: true })
    .fill("界".repeat(4000));
  await capacity
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await capacity.getByRole("alert").filter({ hasText: "2 MB" }).waitFor();
  assert.equal(
    await capacity.evaluate(() =>
      localStorage.getItem("support-desk-workbench:v1"),
    ),
    raw,
  );
  assert.equal(
    await capacity.getByLabel("Description *", { exact: true }).inputValue(),
    "界".repeat(4000),
  );
  evidence.checks.push({
    name: "browser UTF-8 2MB rejection preserves draft and saved copy",
    status: "VERIFIED",
  });
  await capacityContext.close();

  const corruptContext = await browser.newContext();
  const corrupt = await corruptContext.newPage();
  await corrupt.addInitScript(() =>
    localStorage.setItem("support-desk-workbench:v1", "{broken"),
  );
  await corrupt.goto(url);
  corrupt.once("dialog", (dialog) => dialog.accept());
  await corrupt
    .getByRole("button", {
      name: "Allow replacement of unreadable data",
      exact: true,
    })
    .click();
  await open(corrupt);
  await fill(corrupt, "Recovered workspace request");
  await corrupt
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await corrupt
    .getByRole("heading", { name: "Request created", exact: true })
    .waitFor();
  assert.equal(
    parseImport(
      await corrupt.evaluate(() =>
        localStorage.getItem("support-desk-workbench:v1"),
      ),
    ).length,
    19,
  );
  evidence.checks.push({
    name: "creation from existing corrupt-data recovery fallback",
    status: "VERIFIED",
  });
  await corruptContext.close();

  const staticContext = await browser.newContext();
  const hosted = await staticContext.newPage();
  const apiRequests = [];
  hosted.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/"))
      apiRequests.push(r.url());
  });
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
  await open(hosted);
  await fill(hosted, "Static demo request");
  await hosted
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await hosted
    .getByRole("heading", { name: "Request created", exact: true })
    .waitFor();
  await hosted.reload();
  assert.equal(
    parseImport(
      await hosted.evaluate(() =>
        localStorage.getItem("support-desk-workbench:v1"),
      ),
    ).length,
    19,
  );
  assert.deepEqual(apiRequests, []);
  evidence.checks.push({
    name: "static-host creation and reload with zero API requests",
    status: "VERIFIED",
  });
  await staticContext.close();
} finally {
  await writeFile(
    "docs/create-request/review-results.json",
    JSON.stringify(evidence, null, 2),
  );
  await browser.close();
  await new Promise((done) => server.close(done));
  if (baseline) await new Promise((done) => baseline.close(done));
}
console.log(
  "Independent production/browser review completed; see review-results.json for scope and limitations.",
);
