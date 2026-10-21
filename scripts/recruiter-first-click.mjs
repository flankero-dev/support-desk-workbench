import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Only public URLs. Each URL and viewport receives its own clean, ephemeral context.
const out = path.resolve("artifacts/recruiter-audit");
await mkdir(out, { recursive: true });
const targets = [
  { id: "support", url: "https://flankero-dev.github.io/support-desk-workbench/" },
  { id: "merchant", url: "https://merchant-listing-preflight.pages.dev/" },
  { id: "profile", url: "https://github.com/flankero-dev" },
  { id: "github-support", url: "https://github.com/flankero-dev/support-desk-workbench" },
  { id: "github-merchant", url: "https://github.com/flankero-dev/-merchant-listing-preflight" },
];
const sizes = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1365, height: 900 },
];
const report = {
  generatedAt: new Date().toISOString(),
  runId: process.env.GITHUB_RUN_ID ?? null,
  note: "Read-only public pages, no authenticated sessions or server mutations",
  results: [],
};
const browser = await chromium.launch({ headless: true });
for (const target of targets) {
  for (const size of sizes) {
    const id = target.id + "-" + size.name;
    const result = {
      id, url: target.url, viewport: [size.width, size.height],
      state: "UNKNOWN", httpStatus: null, title: "", finalUrl: "",
      pageErrors: [], requestFailures: [], badResponses: [],
      screenshots: [], observations: {}, actions: {},
    };
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      isMobile: size.name === "mobile",
      hasTouch: size.name === "mobile",
      deviceScaleFactor: 1,
      locale: "en-US",
      serviceWorkers: "block",
      permissions: [],
      acceptDownloads: false,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => result.pageErrors.push(error.message.slice(0, 500)));
    page.on("requestfailed", (req) => {
      if (result.requestFailures.length < 20) {
        result.requestFailures.push({ url: req.url(), error: req.failure()?.errorText });
      }
    });
    page.on("response", (res) => {
      if (res.status() >= 400 && result.badResponses.length < 20) {
        result.badResponses.push({ url: res.url(), status: res.status() });
      }
    });
    const snap = async (suffix, fullPage = false) => {
      const file = id + "-" + suffix + ".png";
      await page.screenshot({ path: path.join(out, file), fullPage, animations: "disabled" });
      result.screenshots.push(file);
    };
    try {
      const response = await page.goto(target.url, {
        waitUntil: "domcontentloaded", timeout: 45000,
      });
      result.httpStatus = response?.status() ?? null;
      result.finalUrl = page.url();
      result.title = await page.title();
      await page.waitForTimeout(1200);
      result.observations = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        headings: Array.from(document.querySelectorAll("h1,h2")).slice(0, 12)
          .map((e) => e.textContent?.trim().slice(0, 100)),
        visibleButtons: Array.from(document.querySelectorAll("button"))
          .filter((e) => e.getBoundingClientRect().width > 0).slice(0, 25)
          .map((e) => e.textContent?.trim().slice(0, 70)),
        pinned: Array.from(document.querySelectorAll(".pinned-item-list-item"))
          .map((e) => e.innerText.trim().slice(0, 150)),
        readme: Boolean(document.querySelector("#readme,article.markdown-body")),
        firstText: (document.querySelector("main")?.innerText ?? document.body.innerText).slice(0, 700),
      }));
      await snap("first");
      if (size.name === "mobile") await snap("full", true);
      result.state = result.httpStatus === 200 ? "NAVIGATION_OK" : "HTTP_REVIEW";
      if (size.name === "mobile" && target.id === "support") {
        const btn = page.getByRole("button", { name: /new request/i }).first();
        result.actions.newRequestVisible = await btn.count() > 0;
        if (result.actions.newRequestVisible) {
          await btn.click({ timeout: 9000 });
          await snap("new-request");
          const submit = page.getByRole("button", { name: /create request/i }).first();
          if (await submit.count()) {
            await submit.click({ timeout: 9000 });
            await snap("empty-validation");
            result.actions.validationVisible = await page.locator("[aria-invalid=true]").count();
          }
        }
      }
      if (size.name === "mobile" && target.id === "merchant") {
        const btn = page.getByRole("button", { name: /load sample csv/i }).first();
        result.actions.sampleButtonVisible = await btn.count() > 0;
        if (result.actions.sampleButtonVisible) {
          await btn.click({ timeout: 9000 });
          await page.waitForTimeout(400);
          await snap("sample-csv");
          result.actions.sampleOutput = (await page.locator("body").innerText()).slice(0, 900);
        }
      }
    } catch (error) {
      result.state = "BLOCKED_OR_ERROR";
      result.error = String(error).slice(0, 1000);
      try { await snap("failure"); } catch { result.screenshotFailed = true; }
    } finally {
      report.results.push(result);
      await context.close();
      console.log(id + ": " + result.state + " status=" + result.httpStatus);
    }
  }
}
await browser.close();
report.total = report.results.length;
report.overall = report.results.every((x) => x.state === "NAVIGATION_OK")
  ? "NAVIGATION_OK_VISUAL_REVIEW_REQUIRED" : "REVIEW_REQUIRED";
await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log("AUDIT " + report.overall + " (10 browser contexts).");
// A website error is recorded in the artifact, not hidden by failed CI upload.
