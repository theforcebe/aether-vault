// Windows launcher: hidden local server; no installation or network hosting.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..'), cache = path.join(root,'knowledge/cache/workbench');
const url = 'http://127.0.0.1:8787';
async function ready() { try { const r=await fetch(url+'/api/workbench/status',{signal:AbortSignal.timeout(1000)});return (await r.json()).app==='aether-vault-workbench'; } catch (_) { return false; } }
(async()=>{
  if(!await ready()){
    fs.mkdirSync(cache,{recursive:true});
    const log=fs.openSync(path.join(cache,'server.log'),'a'),err=fs.openSync(path.join(cache,'server-errors.log'),'a');
    const child=spawn(process.execPath,[path.join(__dirname,'workbench-server.js')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,err]});
    child.unref();fs.closeSync(log);fs.closeSync(err);fs.writeFileSync(path.join(cache,'server.pid'),String(child.pid));
    let started=false;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,200));if(await ready()){started=true;break;}}
    if(!started)throw Error('Could not start Workbench. Check knowledge/cache/workbench/server-errors.log. Port 8787 may be in use.');
  }
  console.log('Aether Vault: '+url+'/#/workbench');
  if(!process.argv.includes('--no-browser')){
    const browser=spawn('powershell.exe',['-NoProfile','-Command',"Start-Process '"+url+"/#/workbench'"],{windowsHide:true,stdio:'ignore'});browser.unref();
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
