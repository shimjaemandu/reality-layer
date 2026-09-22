'use strict';
const assert = require('assert');
const { server } = require('../server');
const mcpAccess = require('../src/mcp-access');
const { resetDeviceStates } = require('../src/devices');
const { resetContext } = require('../src/context');
const { resetContextGraph } = require('../src/context-graph');
const { resetStateStore } = require('../src/state-store');
const { resetEventStore, readEvents } = require('../src/event-store');
const { resetIdentity } = require('../src/identity');

let pass=0;
async function test(name,fn){try{await fn();pass++;console.log('PASS',name);}catch(e){console.error('FAIL',name);throw e;}}

(async()=>{
  process.env.PC_ADAPTER_DRY_RUN='1';
  resetDeviceStates(); resetContext(); resetIdentity(); resetStateStore(); resetEventStore(); resetContextGraph();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port, base=`http://127.0.0.1:${port}`;

  async function post(body, headers={}) {
    const response=await fetch(`${base}/mcp`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json, text/event-stream',
        'Authorization':`Bearer ${mcpAccess.token}`,
        ...headers,
      },
      body:JSON.stringify(body),
    });
    const text=await response.text();
    return {status:response.status,headers:response.headers,data:text?JSON.parse(text):null};
  }

  try {
    let sessionId;
    await test('legacy initialize negotiates Gemini-compatible 2025-11-25 and returns session id', async()=>{
      const r=await post({
        jsonrpc:'2.0',id:1,method:'initialize',params:{
          protocolVersion:'2025-11-25',
          capabilities:{},
          clientInfo:{name:'gemini-cli',version:'0.60.0'},
        },
      });
      assert.equal(r.status,200);
      assert.equal(r.data.result.protocolVersion,'2025-11-25');
      assert.equal(r.data.result.serverInfo.name,'reality-layer');
      assert.equal(r.data.result.serverInfo.version,'1.8.1');
      sessionId=r.headers.get('mcp-session-id');
      assert.ok(sessionId);
    });

    await test('legacy initialized notification and ping succeed', async()=>{
      const headers={'Mcp-Session-Id':sessionId,'MCP-Protocol-Version':'2025-11-25'};
      const init=await post({jsonrpc:'2.0',method:'notifications/initialized',params:{}},headers);
      assert.equal(init.status,202);
      const ping=await post({jsonrpc:'2.0',id:2,method:'ping',params:{}},headers);
      assert.equal(ping.status,200);
      assert.deepEqual(ping.data.result,{});
    });

    await test('legacy tools/list exposes five Reality tools without modern-only headers', async()=>{
      const r=await post({jsonrpc:'2.0',id:3,method:'tools/list',params:{}},{'Mcp-Session-Id':sessionId,'MCP-Protocol-Version':'2025-11-25'});
      assert.equal(r.status,200);
      for(const name of ['reality.discover','reality.observe','reality.plan','reality.execute','reality.explain']) assert.ok(r.data.result.tools.some(t=>t.name===name));
    });

    await test('legacy tools/call records initialize clientInfo in audit', async()=>{
      const r=await post({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'reality.discover',arguments:{}}},{'Mcp-Session-Id':sessionId,'MCP-Protocol-Version':'2025-11-25'});
      assert.equal(r.status,200);
      assert.equal(r.data.result.structuredContent.ok,true);
      const event=readEvents({type:'mcp.tool.called',limit:20,reverse:true}).find(e=>e.payload?.client?.name==='gemini-cli');
      assert.ok(event);
      assert.equal(event.payload.client.version,'0.60.0');
      assert.equal(event.payload.client.trust,'self-reported-unverified');
    });

    await test('legacy session can be deleted', async()=>{
      const response=await fetch(`${base}/mcp`,{method:'DELETE',headers:{Authorization:`Bearer ${mcpAccess.token}`,'Mcp-Session-Id':sessionId}});
      assert.equal(response.status,204);
      const after=await post({jsonrpc:'2.0',id:5,method:'ping',params:{}},{'Mcp-Session-Id':sessionId,'MCP-Protocol-Version':'2025-11-25'});
      assert.equal(after.status,400);
    });

    console.log(`V1.7.1 TESTS PASSED (${pass})`);
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
})().catch((error)=>{console.error(error);process.exitCode=1;});
