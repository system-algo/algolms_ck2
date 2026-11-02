import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const CHILD = 'http://127.0.0.1:4173/';
const PARENT = 'http://localhost:5173/';
const ALLOWED = new Set(['127.0.0.1:4173', 'localhost:5173']);
const credential = (email) => {
  const segment = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return segment({ alg: 'none', typ: 'JWT' }) + '.' +
    segment({ email, exp: Math.floor(Date.now()/1000)+3600 }) + '.fixture';
};
const contextFor = (email, courseId='3126', tokenEmail=email) => ({
  studentEmail:email,
  courseId,
  viewerRole:'student',
  supabaseUrl:'http://localhost:54321',
  supabaseKey:'dummy-public-test-key',
  accessToken:credential(tokenEmail),
  backendUrl:'http://localhost:7000',
});
const parentHtml = `<!DOCTYPE html><meta charset="utf-8">
<script>
 window.testingContext = null;
 window.addEventListener('message', (event) => {
   if (event.origin !== 'http://127.0.0.1:4173') return;
   if (event.data?.type !== 'ALGO_LMS_READY' || !window.testingContext) return;
   event.source.postMessage({
     type:'ALGO_LMS_HANDOFF', handoffId:'browser-fixture-' + Date.now(),
     context:window.testingContext
   },event.origin);
 });
</script>`;
const server=http.createServer((req,res)=>{
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(parentHtml);
});
const preview=spawn('npm',['run','preview','--','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'ignore',detached:true});
preview.unref();
let browser;
let failed=false;
const watchdog=setTimeout(()=>{console.error('FAIL: browser E2E exceeded isolated 120s watchdog');process.exit(2);},120000);
async function waitForServer(url,timeoutMs=40000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    try {
      const response=await fetch(url);
      if(response.ok)return;
    }catch{}
    await sleep(200);
  }
  throw Error('Local Vite preview did not start');
}
async function openFromParent(parent,testingContext){
  await parent.evaluate(ctx=>{window.testingContext=ctx},testingContext);
  const [child]=await Promise.all([
    parent.waitForEvent('popup',{timeout:8000}),
    parent.evaluate(url=>{window.open(url,'_blank')},CHILD),
  ]);
  return child;
}
async function evaluateAfterNavigation(page, fn) {
  for (let i = 0; i < 25; i += 1) {
    try { return await page.evaluate(fn); }
    catch (error) {
      if (!/Execution context was destroyed|navigat/i.test(String(error))) throw error;
      await sleep(120);
    }
  }
  throw new Error('LMS popup did not stabilize after the secure handoff reload');
}
async function caseRun(title,fn){
  await fn();
  console.log('PASS '+title);
}

try {
  await new Promise((resolve)=>server.listen(5173,resolve));
  await waitForServer(CHILD);
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();
  // No request can leave this runner for Odoo, Supabase, or the live backend.
  await context.route('**/*',route=>{
    let url;
    try{url=new URL(route.request().url())}catch{return route.abort();}
    if(url.protocol==='http:' && ALLOWED.has(url.host)){
      return route.continue();
    }
    return route.abort();
  });

  const parent=await context.newPage();
  await parent.goto(PARENT);

  const emailA='qa.transfer.fixture@example.invalid';
  const emailB='qa.second.fixture@example.invalid';
  let first;
  await caseRun('authenticated popup waits for verified postMessage before application mount',async()=>{
    first=await openFromParent(parent,contextFor(emailA,'3126'));
    await first.waitForFunction(expected=>
      sessionStorage.getItem('lms_student_email')===expected,
      emailA,{timeout:17000});
    const data=await evaluateAfterNavigation(first,()=>({
      email:localStorage.getItem('lms_student_email'),
      courseId:localStorage.getItem('lms_course_id'),
      storedInTab:sessionStorage.getItem('lms_student_email'),
    }));
    assert.equal(data.email,emailA);
    assert.equal(data.storedInTab,emailA);
    assert.equal(data.courseId,'3126');
  });
  await caseRun('another popup cannot overwrite the original student context',async()=>{
    const second=await openFromParent(parent,contextFor(emailB,'3263'));
    await second.waitForFunction(expected=>
      sessionStorage.getItem('lms_student_email')===expected,
      emailB,{timeout:17000});
    const prior=await evaluateAfterNavigation(first,()=>({
      email:localStorage.getItem('lms_student_email'),
      courseId:localStorage.getItem('lms_course_id'),
    }));
    assert.deepEqual(prior,{email:emailA,courseId:'3126'});
    await second.close();
  });
  await caseRun('popup without verified handoff fails closed instead of Guest',async()=>{
    const untrusted=await openFromParent(parent,null);
    await untrusted.getByRole('alert').filter({hasText:'Could not verify your learning session'})
      .waitFor({state:'visible',timeout:18000});
    assert.equal(await untrusted.evaluate(()=>localStorage.getItem('lms_student_email')),null);
    await untrusted.close();
  });
  await caseRun('mismatched JWT identity cannot install a student session',async()=>{
    const invalid=await openFromParent(parent,contextFor('wrong@example.invalid','3126','other@example.invalid'));
    await invalid.getByRole('alert').filter({hasText:'Could not verify your learning session'})
      .waitFor({state:'visible',timeout:18000});
    assert.equal(await invalid.evaluate(()=>localStorage.getItem('lms_student_email')),null);
    await invalid.close();
  });
  await caseRun('intentional direct link without opener preserves Guest fallback',async()=>{
    const direct=await context.newPage();
    await direct.goto(CHILD,{waitUntil:'domcontentloaded'});
    assert.equal(await direct.evaluate(()=>window.opener===null),true);
    await direct.waitForTimeout(1000);
    const status=await direct.evaluate(()=>({
      receiverInstalled:window.__algoSecureLmsHandoffInstalled===true,
      isPending:window.__algoSecureLmsHandoffPending===true,
      hasBlockedAlert:Boolean(document.querySelector('[role="alert"]')?.textContent?.includes('Could not verify your learning session')),
    }));
    assert.equal(status.receiverInstalled,true);
    assert.equal(status.isPending,false);
    assert.equal(status.hasBlockedAlert,false);
    await direct.close();
  });
  await first.close();
  await parent.close();
  await context.close();
} catch(error){
  failed=true;
  console.error('FAIL isolated browser handoff E2E:',error?.stack||error);
} finally {
  try { await browser?.close(); } catch {}
  try { process.kill(-preview.pid,'SIGTERM'); } catch {}
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  clearTimeout(watchdog);
}
process.exit(failed ? 1 : 0);
