import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:true,args:['--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({acceptDownloads:true});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
  await page.goto(process.env.PAGES_URL||'http://127.0.0.1:5175/crystal-studio-web/',{waitUntil:'networkidle'});
  await expect(page.locator('#status')).toContainText('Ready');
  assert.ok(await page.locator('#viewport canvas').evaluate(canvas=>canvas.toDataURL().length>10000),'Production WebGL canvas');
  await page.locator('#open-export').click();await page.locator('#export-format').selectOption('pdf');await page.locator('#export-dpi').fill('72');
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-submit').click();const download=await downloadPromise;assert.equal(await download.failure(),null);
  assert.deepEqual(errors,[]);
  console.log('PASS production app, WebGL, assets and lazy-loaded PDF export under the GitHub Pages repository path');
}finally{await browser.close();}
