'use strict';
const {RealityLayerAdapter}=require('../integrations/langgraph/reality-layer-adapter');
(async()=>{
  const token=process.env.REALITY_MCP_TOKEN;
  if(!token) throw new Error('Set REALITY_MCP_TOKEN to the token printed by Reality Layer.');
  const rl=new RealityLayerAdapter({token,clientName:'langgraph-smoke'});
  const plan=await rl.plan('\uCE68\uC2E4 \uBD88 \uCF1C\uC918');
  console.log('PLAN',JSON.stringify(plan,null,2));
  if(plan.ok&&plan.decision==='auto'){
    const result=await rl.execute(plan.plan_id);
    console.log('EXECUTE',JSON.stringify(result,null,2));
    for(const action of result.actions||[]){
      console.log(`ACTION ${action.action_id}: ${action.outcome} / reconciliation=${action.reconciliation?.state}`);
      if(action.outcome==='UNKNOWN') console.log('Do not retry blindly. Use rl.actionStatus(action_id) and rl.reconcile(...) after trustworthy readback evidence.');
    }
  }else console.log('Not auto-executing:',plan.decision||plan.reason);
})().catch(e=>{console.error(e);process.exitCode=1});
