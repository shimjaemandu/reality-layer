'use strict';
const assert = require('assert');
const { server } = require('../server');
const mcpAccess = require('../src/mcp-access');
const { resetDeviceStates, devices } = require('../src/devices');
const { resetContext } = require('../src/context');
const { resetContextGraph } = require('../src/context-graph');
const { resetStateStore, publicStateStore } = require('../src/state-store');
const { resetEventStore, readEvents } = require('../src/event-store');
const { resetIdentity } = require('../src/identity');
const { publicMcpSpec } = require('../src/mcp-server');

let pass=0;
async function test(name,fn){try{await fn();pass++;console.log('PASS',name);}catch(e){console.error('FAIL',name);throw e;}}
function meta(clientName='v17-test-agent'){return {'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:clientName,version:'1.0'}};}

(async()=>{
  process.env.PC_ADAPTER_DRY_RUN='1';
  resetDeviceStates(); resetContext(); resetIdentity(); resetStateStore(); resetEventStore(); resetContextGraph();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port, base=`http://127.0.0.1:${port}`;

  async function raw(body,{auth=true,methodHeader=body.method,nameHeader=body.params?.name,protocol='2026-07-28'}={}){
    const headers={'Content-Type':'application/json','MCP-Protocol-Version':protocol,'Mcp-Method':methodHeader};
    if(nameHeader)headers['Mcp-Name']=nameHeader;
    if(auth)headers.Authorization=`Bearer ${mcpAccess.token}`;
    const response=await fetch(`${base}/mcp`,{method:'POST',headers,body:JSON.stringify(body)});
    let data; try{data=await response.json();}catch{data=null;}
    return {status:response.status,data};
  }
  async function rpc(method,params={},client='v17-test-agent'){
    if(!params._meta)params={...params,_meta:meta(client)};
    return raw({jsonrpc:'2.0',id:Math.floor(Math.random()*100000)+1,method,params});
  }
  async function tool(name,args={},client='v17-test-agent'){
    return rpc('tools/call',{name,arguments:args,_meta:meta(client)},client);
  }

  try{
    await test('MCP v1.7 스펙이 5개 northbound tool을 노출한다',async()=>{
      const spec=publicMcpSpec();
      assert.equal(spec.protocol_version,'2026-07-28');
      for(const name of ['reality.discover','reality.observe','reality.plan','reality.execute','reality.explain']) assert.ok(spec.tools.some(t=>t.name===name));
    });

    await test('MCP endpoint는 Bearer token 없이는 사용할 수 없다',async()=>{
      const r=await raw({jsonrpc:'2.0',id:1,method:'server/discover',params:{_meta:meta()}},{auth:false});
      assert.equal(r.status,403);
    });

    await test('server/discover와 tools/list가 modern MCP 2026-07-28로 응답한다',async()=>{
      const discover=await rpc('server/discover',{});
      assert.equal(discover.status,200);
      assert.deepEqual(discover.data.result.supportedVersions,['2026-07-28']);
      assert.equal(discover.data.result._meta['io.modelcontextprotocol/serverInfo'].version,'1.8.2.2');
      const list=await rpc('tools/list',{});
      assert.ok(list.data.result.tools.length>=5);
      assert.equal(list.data.result.cacheScope,'private');
    });

    await test('Mcp-Method/Mcp-Name header와 JSON-RPC body 불일치는 거부한다',async()=>{
      const body={jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'reality.discover',arguments:{},_meta:meta()}};
      const badMethod=await raw(body,{methodHeader:'tools/list'});
      assert.equal(badMethod.status,400); assert.equal(badMethod.data.error.code,-32020);
      const badName=await raw(body,{nameHeader:'reality.observe'});
      assert.equal(badName.status,400); assert.equal(badName.data.error.code,-32020);
    });

    await test('reality.discover/observe가 Graph와 State/Event를 읽기 전용으로 노출한다',async()=>{
      const d=await tool('reality.discover',{include_graph:true},'agent-A');
      const ds=d.data.result.structuredContent;
      assert.equal(ds.ok,true); assert.equal(ds.reality_layer_version,'1.8.2.2'); assert.ok(ds.graph.nodes.length>0); assert.ok(ds.devices.length>0);
      const o=await tool('reality.observe',{device_id:'bedroom_light',event_limit:5,include_context:true},'agent-A');
      const os=o.data.result.structuredContent;
      assert.equal(os.ok,true); assert.deepEqual(Object.keys(os.state_store.devices),['bedroom_light']);
    });

    let directPlanId;
    await test('reality.plan은 직접 자연어를 Typed Action IR 계획으로 만들고 AUTO 계획은 MCP로 실행된다',async()=>{
      devices.bedroom_light.state.power='off'; resetStateStore();
      const p=await tool('reality.plan',{text:'침실 불 켜줘'},'agent-A');
      const plan=p.data.result.structuredContent;
      assert.equal(plan.ok,true); assert.equal(plan.intent,'direct_command'); assert.equal(plan.decision,'auto');
      assert.equal(plan.steps[0].action_ir.capability.id,'power');
      directPlanId=plan.plan_id;
      const e=await tool('reality.execute',{plan_id:directPlanId},'agent-A');
      const exec=e.data.result.structuredContent;
      assert.equal(exec.ok,true); assert.equal(exec.status,'completed');
      assert.equal(publicStateStore().devices.bedroom_light.state.power,'on');
    });

    await test('외부 Agent는 CONFIRM 계획을 스스로 승인할 수 없다',async()=>{
      const p=await tool('reality.plan',{text:'나 이제 나갈게'},'agent-B');
      const plan=p.data.result.structuredContent;
      assert.equal(plan.ok,true); assert.equal(plan.decision,'confirm');
      const before=JSON.stringify(publicStateStore().devices);
      const e=await tool('reality.execute',{plan_id:plan.plan_id},'agent-B');
      const exec=e.data.result.structuredContent;
      assert.equal(exec.ok,false); assert.equal(exec.needs_user_confirmation,true); assert.equal(exec.decision,'confirm');
      assert.equal(JSON.stringify(publicStateStore().devices),before);
      const forged=await tool('reality.execute',{plan_id:plan.plan_id,confirmed:true},'agent-B');
      assert.equal(forged.data.result.isError,true);
    });

    await test('MCP clientInfo는 감사 메타데이터일 뿐 Reality Identity를 바꾸지 않는다',async()=>{
      const r=await tool('reality.discover',{},'owner-admin-superuser');
      assert.equal(r.data.result.structuredContent.identity.id,'owner');
      assert.equal(r.data.result.structuredContent.identity.identity_assurance,'demo');
      const call=readEvents({type:'mcp.tool.called',limit:50,reverse:true}).find(e=>e.payload?.client?.name==='owner-admin-superuser');
      assert.ok(call); assert.equal(call.payload.client.trust,'self-reported-unverified');
    });

    await test('reality.explain은 실행된 plan의 Policy/Audit 흔적을 반환한다',async()=>{
      const r=await tool('reality.explain',{plan_id:directPlanId,limit:10},'agent-A');
      const x=r.data.result.structuredContent;
      assert.equal(x.ok,true); assert.ok(x.execution_logs.length>=1 || x.audit_events.length>=1);
    });

    console.log(`V1.7 TESTS PASSED (${pass})`);
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
})().catch((error)=>{console.error(error);process.exitCode=1;});
