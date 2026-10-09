import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
const out='output/manchester/culture';await mkdir(out,{recursive:true});
try{
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.MANCHESTER_URL||'http://localhost:5188/manchester/');await page.waitForFunction(()=>window.render_game_to_text);
const read=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));const advance=ms=>page.evaluate(ms=>window.advanceTime(ms),ms);
await page.screenshot({path:`${out}/phone-access.png`});
for(const id of ['gallery','museum','industry']){
 await page.click('#phone-open');await page.getByRole('button',{name:'Things to do',exact:true}).click();await page.getByRole('button',{name:new RegExp(id==='gallery'?'Manchester Art Gallery':id==='museum'?'Manchester Museum':'Science and Industry Museum')}).click();await page.waitForSelector('#tram-leave');await advance(21000);await page.click('#tram-leave');await page.waitForFunction(id=>JSON.parse(window.render_game_to_text()).experience?.type===id,id);
 if(id==='gallery'){await page.click('#culture-action');await page.click('#culture-shape');await page.click('#culture-finish');}
 if(id==='museum'){for(let i=0;i<4;i++)await page.click('#culture-action');}
 if(id==='industry'){await page.locator('#culture-power').fill('60');await advance(3100);}
 assert.equal((await read()).experience.complete,true);await page.screenshot({path:`${out}/${id}.png`});await page.click('#experience-exit');assert.equal((await read()).district,id);await page.screenshot({path:`${out}/${id}-street.png`});
}
await page.click('#phone-open');await page.getByRole('button',{name:'My collection',exact:true}).click();assert.equal(await page.locator('.journal-entry').count(),3);assert.deepEqual(errors,[]);console.log('PASS: three destinations, tram handoff, each activity completed, exit, journal, mobile; no page errors');
}finally{await browser.close();}
