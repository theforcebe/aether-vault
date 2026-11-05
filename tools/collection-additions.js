'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const A=require('../js/collection-additions');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
// The short synchronous commit keeps concurrent requests from losing inventory.
// Raw CSV archives and the independent allocation ledger are never changed here.
function commit(vaultRoot,entries,cards,options) {
  const dir=path.join(vaultRoot,'knowledge/collection'),file=path.join(dir,'latest.json'),lock=file+'.lock';
  let fd;try{fd=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')throw Error('Another collection update is saving. Retry your queue in a moment.');throw e;}
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try {
    const original=fs.readFileSync(file,'utf8'),snapshot=JSON.parse(original),result=A.apply(snapshot,entries,cards,options);
    if(result.replayed)return result;
    const history=path.join(dir,'snapshots');fs.mkdirSync(history,{recursive:true});
    const archive=path.join(history,'before-addition-'+digest(original)+'.json');
    try{fs.writeFileSync(archive,original,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(fs.readFileSync(archive,'utf8')!==original)throw Error('Collection archive verification failed.');}
    fs.writeFileSync(tmp,JSON.stringify(result.snapshot,null,2)+'\n',{flag:'wx'});
    if(fs.readFileSync(file,'utf8')!==original)throw Error('The collection changed while saving. Refresh and review your queue.');
    fs.renameSync(tmp,file);return result;
  } finally {if(fs.existsSync(tmp))fs.unlinkSync(tmp);fs.closeSync(fd);fs.unlinkSync(lock);}
}
module.exports={commit};
