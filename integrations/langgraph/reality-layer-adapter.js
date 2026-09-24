'use strict';
// Dependency-free LangGraph-facing adapter. Wrap these methods in your preferred LangChain tool() helper.
class RealityLayerAdapter {
  constructor({baseUrl='http://127.0.0.1:3000', token, clientName='langgraph'}={}) {
    if(!token) throw new Error('Reality Layer MCP token is required');
    this.baseUrl=baseUrl.replace(/\/$/,'');
    this.token=token;
    this.clientName=clientName;
    this.seq=0;
  }
  async call(name,args={}) {
    const id=++this.seq;
    const r=await fetch(`${this.baseUrl}/mcp`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json','Accept':'application/json',
        'Authorization':`Bearer ${this.token}`,
        'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name,
      },
      body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args,_meta:{
        'io.modelcontextprotocol/protocolVersion':'2026-07-28',
        'io.modelcontextprotocol/clientInfo':{name:this.clientName,version:'external-test'},
      }}}),
    });
    const body=await r.json();
    if(body.error) throw new Error(body.error.message);
    const result=body.result?.structuredContent;
    if(body.result?.isError) throw new Error(result?.error || 'Reality Layer tool call failed');
    return result;
  }
  discover(args={}){return this.call('reality.discover',args);}
  observe(args={}){return this.call('reality.observe',args);}
  plan(text){return this.call('reality.plan',{text});}
  execute(plan_id){return this.call('reality.execute',{plan_id});}
  explain(plan_id,limit=20){return this.call('reality.explain',{plan_id,limit});}
  actionStatus(action_id){return this.call('reality.action.get',{action_id});}
  reconcile(action_id){return this.call('reality.action.reconcile',{action_id});}
  tools(){ return [
    {name:'reality_plan',description:'Plan a real-world action through Reality Layer. Does not execute.',invoke:({text})=>this.plan(text)},
    {name:'reality_execute',description:'Execute a previously approved Reality Layer plan. User-confirmation gates cannot be self-approved by the agent.',invoke:({plan_id})=>this.execute(plan_id)},
    {name:'reality_observe',description:'Read current Reality Layer state and audit context.',invoke:(args={})=>this.observe(args)},
    {name:'reality_action_status',description:'Read stable action outcome/provenance by action_id.',invoke:({action_id})=>this.actionStatus(action_id)},
    {name:'reality_reconcile',description:'Ask the Runtime to gather trusted adapter/provider evidence for UNKNOWN. Caller assertions cannot resolve the action and the action is never retried.',invoke:({action_id})=>this.reconcile(action_id)},
  ]; }
}
module.exports={RealityLayerAdapter};
