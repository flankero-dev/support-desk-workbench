import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createAppServer } from "../server/app.ts";
import { createSeed } from "../src/domain/seed.ts";
import { exportTickets } from "../src/domain/tickets.ts";

const OUT="artifacts/support-release-data-gate";
const KEY="support-desk-workbench:v1";
const HEAD="90765909eaf98d8ea1784c5b6666d7e32dc1e787";
const fixtures=createSeed();
fixtures[0].description="Synthetic prior-version text: Київ, naïve, 🚀";
fixtures[0].activity.push({
  at:"2026-10-09T12:00:00.000Z",
  text:"Synthetic historical entry: original user data preserved"
});
const original=exportTickets(fixtures);
const report={
  testedHead:HEAD,
  baselinedSchema:"v1 export; src/domain/seed.ts unchanged from main 82040360",
  notes:"Synthetic data and temporary localhost server only; this is not a production data migration or physical-device test.",
  startedAt:new Date().toISOString(), cases:{},errors:[],
  viewport:{width:390,height:844},overall:"NOT_CONFIRMED"
};
await mkdir(OUT,{recursive:true});
let browser,server;
async function check(name,fn) {
  try {report.cases[name]={status:"PASS",...await fn()};console.log(name+" PASS");}
  catch(e){report.cases[name]={status:"FAIL",error:String(e)};console.error(name+" FAIL",String(e));}
}
try {
  server=createAppServer();
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  const url="http://127.0.0.1:"+server.address().port;
  browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true,deviceScaleFactor:1});
  const page=await ctx.newPage();
  page.on("pageerror",e=>report.errors.push(e.message));
  page.setDefaultTimeout(12000);
  await page.goto(url,{waitUntil:"domcontentloaded"});
  await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:KEY,raw:original});
  await page.reload({waitUntil:"domcontentloaded"});
  const ticket=()=>page.getByRole("button",{name:"Checkout returns to cart after address edit",exact:true});
  await ticket().waitFor();

  await check("v1_workspace_preserved_on_load",async()=>{
    const actual=await page.evaluate(k=>localStorage.getItem(k),KEY);
    assert.equal(actual,original,"Existing JSON changed without user action");
    assert.ok((await page.locator("body").innerText()).includes("Checkout returns to cart"));
    return {workspaceBytes:Buffer.byteLength(actual),requests:fixtures.length};
  });

  await check("unsent_note_retained_between_dialog_visits",async()=>{
    await ticket().tap();
    await page.getByLabel("Internal note").fill("Synthetic unfinished draft – preserve me");
    await page.keyboard.press("Escape");
    await ticket().tap();
    assert.equal(await page.getByLabel("Internal note").inputValue(),"Synthetic unfinished draft – preserve me");
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),KEY),original,"Unsent note should not change saved workspace");
    await page.screenshot({path:OUT+"/note-draft-390.png",fullPage:true});
    return {draft:"retained in tab only",screenshot:"note-draft-390.png"};
  });

  await check("saved_note_reloads_and_exports",async()=>{
    await page.getByRole("button",{name:"Add note",exact:true}).tap();
    const beforeReload=await page.evaluate(k=>localStorage.getItem(k),KEY);
    const parsedBefore=JSON.parse(beforeReload);
    assert.ok(parsedBefore.tickets[0].activity.some(a=>a.text.includes("Synthetic unfinished draft")));
    await page.keyboard.press("Escape");
    await page.reload({waitUntil:"domcontentloaded"});
    await ticket().waitFor();
    const afterReload=await page.evaluate(k=>localStorage.getItem(k),KEY);
    assert.equal(afterReload,beforeReload,"Reload did not preserve saved changes");
    assert.ok(JSON.parse(afterReload).tickets[0].activity.some(a=>a.text.includes("Synthetic historical entry")));
    const downloadPromise=page.waitForEvent("download",{timeout:5000});
    await page.getByRole("button",{name:"Export workspace",exact:true}).tap();
    const download=await downloadPromise;
    const exported=await readFile(await download.path(),"utf8");
    assert.deepEqual(JSON.parse(exported),JSON.parse(afterReload));
    return {notePersisted:true,historyRetained:true,exportMatchesSaved:true};
  });

  await check("restore_prerelease_export",async()=>{
    await page.getByRole("button",{name:"Restore workspace",exact:true}).tap();
    await page.getByLabel("Workspace JSON").fill(original);
    await page.getByRole("button",{name:"Replace workspace",exact:true}).tap();
    await page.getByRole("dialog",{name:"Restore workspace"}).waitFor({state:"hidden"});
    const restored=await page.evaluate(k=>localStorage.getItem(k),KEY);
    assert.deepEqual(JSON.parse(restored),JSON.parse(original),"Existing v1 export did not restore exactly");
    await page.reload();
    await ticket().waitFor();
    assert.deepEqual(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),KEY)),JSON.parse(original));
    return {originalBytes:Buffer.byteLength(original),restoredCount:fixtures.length};
  });

  await check("mobile_touch_viewport",async()=>{
    const metrics=await page.evaluate(()=>({
      w:innerWidth,h:innerHeight,scrollWidth:document.documentElement.scrollWidth,
      coarse:matchMedia("(pointer: coarse)").matches,touch:navigator.maxTouchPoints
    }));
    assert.equal(metrics.w,390);
    assert.equal(metrics.h,844);
    assert.ok(metrics.scrollWidth<=392,"Unexpected horizontal document overflow");
    assert.ok(metrics.coarse && metrics.touch>0);
    await page.screenshot({path:OUT+"/workspace-390.png",fullPage:true});
    return metrics;
  });

  await ctx.close();

  await check("corrupted_storage_not_overwritten",async()=>{
    const broken="{invalid_json_saved_by_old_version";
    const separate=await browser.newContext({viewport:{width:390,height:844}});
    const p=await separate.newPage();
    await p.addInitScript(({key,value})=>localStorage.setItem(key,value),{key:KEY,value:broken});
    await p.goto(url,{waitUntil:"domcontentloaded"});
    await p.getByRole("button",{name:"Export unreadable saved data"}).waitFor();
    assert.equal(await p.evaluate(k=>localStorage.getItem(k),KEY),broken);
    await p.screenshot({path:OUT+"/recovery-390.png",fullPage:true});
    await separate.close();
    return {rawDataPreserved:true,explicitRecoveryRequired:true};
  });
} catch(e) {
  report.environmentError=String(e);
  console.error("Environment error:",String(e));
} finally {
  if(browser)await browser.close().catch(()=>{});
  if(server)await new Promise(r=>server.close(r));
  report.finishedAt=new Date().toISOString();
  const statuses=Object.values(report.cases).map(x=>x.status);
  report.overall=!report.environmentError && statuses.length===6 &&
    statuses.every(x=>x==="PASS") && report.errors.length===0
    ?"PASS_ISOLATED_RELEASE_DATA_GATE":"NOT_CONFIRMED";
  await writeFile(OUT+"/report.json",JSON.stringify(report,null,2)+"\n");
  console.log("FINAL:",report.overall);
  if(report.overall!=="PASS_ISOLATED_RELEASE_DATA_GATE")process.exitCode=1;
}
