'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..'), FILE=path.join(ROOT,'data','action-ledger.json'), MAX=500;
const TERMINAL=new Set(['SUCCEEDED','FAILED']);
function clone(v){return JSON.parse(JSON.stringify(v));}
function ensure(){fs.mkdirSync(path.dirname(FILE),{recursive:true});if(!fs.existsSync(FILE))fs.writeFileSync(FILE,'[]\n');}
function read(){ensure();try{const v=JSON.parse(fs.readFileSync(FILE,'utf8'));return Array.isArray(v)?v:[];}catch{return[];}}
function write(v){ensure();fs.writeFileSync(FILE,JSON.stringify(v.slice(-MAX),null,2)+'\n');}
function start(ir,device){const all=read(),now=new Date().toISOString();let a=all.find(x=>x.action_id===ir?.id);if(a)return clone(a);a={schema:'reality-action-outcome/1.0',action_id:ir?.id||null,status:'STARTED',attempt:1,created_at:now,updated_at:now,target_id:device?.id||ir?.target?.device_id||null,provenance:clone(ir?.provenance||{}),evidence:[]};all.push(a);write(all);return clone(a);}
function transition(id,status,evidence={}){if(!['STARTED','SUCCEEDED','FAILED','UNKNOWN'].includes(status))throw new Error('Invalid action outcome');const all=read(),i=all.findIndex(x=>x.action_id===id);if(i<0)throw new Error('Action outcome not found');const cur=all[i];if(TERMINAL.has(cur.status)&&cur.status!==status)return clone(cur);cur.status=status;cur.updated_at=new Date().toISOString();cur.evidence.push({at:cur.updated_at,...clone(evidence)});write(all);return clone(cur);}
function get(id){return clone(read().find(x=>x.action_id===id)||null);}
function list(limit=50){return clone(read().slice(-Math.max(1,Math.min(200,Number(limit)||50))).reverse());}
function reconcile(id,{outcome,evidence={}}={}){const cur=get(id);if(!cur)throw new Error('Action outcome not found');if(cur.status!=='UNKNOWN')return cur;if(!['SUCCEEDED','FAILED'].includes(outcome))throw new Error('UNKNOWN action can only reconcile to SUCCEEDED or FAILED');return transition(id,outcome,{source:'reconciliation',...evidence});}
function reset(){write([]);}
module.exports={start,transition,get,list,reconcile,reset};
