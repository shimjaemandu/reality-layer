'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..'), FILE=path.join(ROOT,'data','action-ledger.json'), MAX=500;
const TERMINAL=new Set(['SUCCEEDED','FAILED']);
function clone(v){return JSON.parse(JSON.stringify(v));}
function ensure(){fs.mkdirSync(path.dirname(FILE),{recursive:true});if(!fs.existsSync(FILE))fs.writeFileSync(FILE,'[]\n');}
function read(){
  ensure();
  let v;
  try { v=JSON.parse(fs.readFileSync(FILE,'utf8')); }
  catch(error){ const e=new Error(`Action ledger is corrupt or unreadable: ${error.message}`); e.code='ACTION_LEDGER_CORRUPT'; throw e; }
  if(!Array.isArray(v)){const e=new Error('Action ledger is corrupt: root value must be an array');e.code='ACTION_LEDGER_CORRUPT';throw e;}
  return v;
}
function write(v){
  ensure();
  // Never evict unresolved work. Retain every STARTED/UNKNOWN record and only cap terminal history.
  const unresolved=v.filter(x=>!TERMINAL.has(x.status));
  const terminal=v.filter(x=>TERMINAL.has(x.status)).slice(-MAX);
  const keepIds=new Set(unresolved.map(x=>x.action_id));
  const kept=[...terminal.filter(x=>!keepIds.has(x.action_id)),...unresolved].sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')));
  const tmp=`${FILE}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(kept,null,2)+'\n');
  fs.renameSync(tmp,FILE);
}
function reconciliationFor(status,reason=null){return {required:status==='UNKNOWN',state:status==='UNKNOWN'?'REQUIRED':'NOT_REQUIRED',reason:status==='UNKNOWN'?(reason||'execution_outcome_uncertain'):null};}
function start(ir,device){
  const all=read(),now=new Date().toISOString();
  let a=all.find(x=>x.action_id===ir?.id);
  if(a)return clone(a);
  a={schema:'reality-action-outcome/1.0',action_id:ir?.id||null,status:'STARTED',attempt:1,created_at:now,updated_at:now,target_id:device?.id||ir?.target?.device_id||null,provenance:clone(ir?.provenance||{}),reconciliation:reconciliationFor('STARTED'),evidence:[]};
  all.push(a);write(all);return clone(a);
}
function transition(id,status,evidence={}){
  if(!['STARTED','SUCCEEDED','FAILED','UNKNOWN'].includes(status))throw new Error('Invalid action outcome');
  const all=read(),i=all.findIndex(x=>x.action_id===id);if(i<0)throw new Error('Action outcome not found');
  const cur=all[i];if(TERMINAL.has(cur.status)&&cur.status!==status)return clone(cur);
  cur.status=status;cur.updated_at=new Date().toISOString();
  cur.reconciliation=reconciliationFor(status,evidence?.reason);
  if(!Array.isArray(cur.evidence))cur.evidence=[];
  cur.evidence.push({at:cur.updated_at,...clone(evidence)});write(all);return clone(cur);
}
function recoverInterrupted(){
  const all=read(),now=new Date().toISOString(),recovered=[];
  for(const cur of all){
    if(cur.status!=='STARTED')continue;
    cur.status='UNKNOWN';cur.updated_at=now;
    cur.reconciliation=reconciliationFor('UNKNOWN','runtime_interrupted_before_terminal_outcome');
    if(!Array.isArray(cur.evidence))cur.evidence=[];
    cur.evidence.push({at:now,source:'runtime-recovery',reason:'runtime_interrupted_before_terminal_outcome',outcome_unknown:true});
    recovered.push(clone(cur));
  }
  if(recovered.length)write(all);
  return recovered;
}
function get(id){return clone(read().find(x=>x.action_id===id)||null);}
function list(limit=50){return clone(read().slice(-Math.max(1,Math.min(200,Number(limit)||50))).reverse());}
function reconcile(id,{outcome,evidence={}}={}){const cur=get(id);if(!cur)throw new Error('Action outcome not found');if(cur.status!=='UNKNOWN')return cur;if(!['SUCCEEDED','FAILED'].includes(outcome))throw new Error('UNKNOWN action can only reconcile to SUCCEEDED or FAILED');return transition(id,outcome,{source:'reconciliation',...evidence});}
function reset(){write([]);}
module.exports={start,transition,recoverInterrupted,get,list,reconcile,reset};
