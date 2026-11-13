import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createSeed } from "../src/domain/seed.ts";
import { exportTickets } from "../src/domain/tickets.ts";

const SITE="https://flankero-dev.github.io/support-desk-workbench/";
const OUT="artifacts/support-production-smoke";
const KEY="support-desk-workbench:v1";
const tickets=createSeed();
tickets[0].description="Synthetic v1 old export Київ naïve 🚀";
tickets[0].activity.push({at:"2026-10-09T12:00:00.000Z",text:"Synthetic prior history entry"});
const original=exportTickets(tickets);
const report={
  expectedReleaseCommit:"ee1ebb05bd1b96c4531df2f939c08cd9d8929c58",
  site:SITE,
  note:"Temporary GitHub Actions Chromium browser context only. No real visitor storage or server data touched. Emulated touch, not physical device.",
  startedAt:new Date().toISOString(),
  tests:{},
  uncaughtErrors:[],
  overall:"NOT_CONFIRMED"
};
await mkdir(OUT,{recursive:true});
let browser,page;
async function check(name,fn){
  try{report.tests[name]={status:"PASS",...await fn()};console.log(name+" PASS");}
  catch(e){
    report.tests[name]={status:"FAIL",error:String(e)};console.error(name+" FAIL",String(e));
    if(page)await page.screenshot({path:OUT+"/"+name+"-failure.png",fullPage:true}).catch(()=>{});
  }
}
try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({
    viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,
    acceptDownloads:true,locale:"en-US",serviceWorkers:"block"
  });
  await context.route("**/*",route=>["GET","HEAD","OPTIONS"].includes(route.request().method())
    ?route.continue():route.abort("blockedbyclient"));
  page=await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror",e=>report.uncaughtErrors.push(e.message));
  const response=await page.goto(SITE,{waitUntil:"domcontentloaded",timeout:45000});
  await check("public_site",async()=>{
    assert.equal(response?.status(),200);
    assert.equal(new URL(page.url()).pathname,"/support-desk-workbench/");
    await page.getByRole("button",{name:"Export workspace",exact:true}).waitFor();
    return {httpStatus:response.status(),url:page.url(),title:await page.title()};
  });

  await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:KEY,raw:original});
  await page.reload({waitUntil:"domcontentloaded"});
  const first=()=>page.getByRole("button",{name:"Checkout returns to cart after address edit",exact:true});
  await first().waitFor();

  await check("legacy_v1_preserved",async()=>{
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),original);
    return {bytes:Buffer.byteLength(original),tickets:tickets.length};
  });

  await check("unsent_draft_survives_close",async()=>{
    await first().tap();
    await page.getByLabel("Internal note").fill("Unsent synthetic note retained after Escape");
    await page.keyboard.press("Escape");
    await first().tap();
    assert.equal(await page.getByLabel("Internal note").inputValue(),"Unsent synthetic note retained after Escape");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),original);
    await page.screenshot({path:OUT+"/draft-390.png",fullPage:true});
    return {persistedInTab:true,storageUnchanged:true};
  });

  await check("saved_note_reload_export",async()=>{
    await page.getByRole("button",{name:"Add note",exact:true}).tap();
    const saved=await page.evaluate(key=>localStorage.getItem(key),KEY);
    const parsed=JSON.parse(saved);
    assert.ok(parsed.tickets[0].activity.some(x=>x.text.includes("Unsent synthetic note")));
    await page.keyboard.press("Escape");
    await page.reload({waitUntil:"domcontentloaded"});
    await first().waitFor();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),saved);
    const promise=page.waitForEvent("download",{timeout:6000});
    await page.getByRole("button",{name:"Export workspace",exact:true}).tap();
    const download=await promise;
    const exported=JSON.parse(await readFile(await download.path(),"utf8"));
    assert.deepEqual(exported,JSON.parse(saved));
    return {savedNote:true,reload:true,exportEqualsStorage:true,historyPreserved:true};
  });

  await check("restore_legacy_export",async()=>{
    await page.getByRole("button",{name:"Restore workspace",exact:true}).tap();
    await page.getByLabel("Workspace JSON").fill(original);
    await page.getByRole("button",{name:"Replace workspace",exact:true}).tap();
    await page.getByRole("dialog",{name:"Restore workspace"}).waitFor({state:"hidden"});
    assert.deepEqual(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),KEY)),JSON.parse(original));
    await page.reload({waitUntil:"domcontentloaded"});
    await first().waitFor();
    assert.deepEqual(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),KEY)),JSON.parse(original));
    return {restored:true,afterReload:true};
  });

  await check("touch_viewport",async()=>{
    const viewport=await page.evaluate(()=>({
      width:innerWidth,height:innerHeight,
      scrollWidth:document.documentElement.scrollWidth
    }));
    assert.equal(viewport.width,390);
    assert.equal(viewport.height,844);
    assert.ok(viewport.scrollWidth<=392,"Document overflows 390px viewport");
    await page.evaluate(()=>{
      window.__smokeTouch=0;
      window.addEventListener("touchstart",()=>{window.__smokeTouch++;},{once:true,capture:true});
    });
    await page.touchscreen.tap(20,20);
    assert.ok(await page.evaluate(()=>window.__smokeTouch)>0,"No touchstart dispatched");
    await page.screenshot({path:OUT+"/mobile-390.png",fullPage:true});
    return {...viewport,touchstartDispatched:true};
  });

  await context.close();
  await check("corrupt_saved_data_recovery",async()=>{
    const broken="{broken-browser-workspace";
    const other=await browser.newContext({viewport:{width:390,height:844}});
    const p=await other.newPage();
    await p.goto(SITE,{waitUntil:"domcontentloaded"});
    await p.evaluate(({key,val})=>localStorage.setItem(key,val),{key:KEY,val:broken});
    await p.reload({waitUntil:"domcontentloaded"});
    await p.getByRole("button",{name:"Export unreadable saved data"}).waitFor();
    assert.equal(await p.evaluate(key=>localStorage.getItem(key),KEY),broken);
    await p.screenshot({path:OUT+"/recovery-390.png",fullPage:true});
    await other.close();
    return {rawPreserved:true,recoveryVisible:true};
  });
}catch(e){report.environmentError=String(e);console.error("Environment failure:",String(e));}
finally{
  if(browser)await browser.close().catch(()=>{});
  report.finishedAt=new Date().toISOString();
  const results=Object.values(report.tests);
  report.overall=!report.environmentError&&report.uncaughtErrors.length===0&&
    results.length===7&&results.every(x=>x.status==="PASS")
    ?"PASS_PRODUCTION_POSTRELEASE":"NOT_CONFIRMED";
  await writeFile(OUT+"/report.json",JSON.stringify(report,null,2)+"\n");
  console.log("FINAL:",report.overall);
  if(report.overall!=="PASS_PRODUCTION_POSTRELEASE")process.exitCode=1;
}
