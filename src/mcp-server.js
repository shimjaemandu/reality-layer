'use strict';
const crypto = require('crypto');
const { appendEvent } = require('./event-store');

const MCP_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
const MCP_SERVER_VERSION = 'reality-mcp/1.8.2.2';
const SERVER_INFO = {
  name: 'reality-layer',
  title: 'Reality Layer',
  version: '1.8.2.2',
  description: 'Local-first Reality Layer northbound MCP server with policy/safety-gated physical execution.',
};

const TOOLS = [
  {
    name:'reality.discover',
    title:'Discover Reality',
    description:'Discover Reality Layer topology, devices, capabilities, current policy identity and supported northbound interfaces. Read-only.',
    inputSchema:{ type:'object', additionalProperties:false, properties:{ include_graph:{type:'boolean'} } },
    outputSchema:{ type:'object' },
    annotations:{ readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  },
  {
    name:'reality.observe',
    title:'Observe Reality',
    description:'Observe current State Store, Context and recent Event Store history. Optionally scope to one device. Read-only.',
    inputSchema:{
      type:'object', additionalProperties:false,
      properties:{ device_id:{type:'string',minLength:1,maxLength:120}, event_limit:{type:'integer',minimum:1,maximum:50}, include_context:{type:'boolean'} },
    },
    outputSchema:{ type:'object' },
    annotations:{ readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  },
  {
    name:'reality.plan',
    title:'Plan Reality Action',
    description:'Compile a natural-language intent into a Reality Layer plan. Planning never performs physical execution.',
    inputSchema:{ type:'object', additionalProperties:false, properties:{ text:{type:'string',minLength:1,maxLength:500} }, required:['text'] },
    outputSchema:{ type:'object' },
    annotations:{ readOnlyHint:false, destructiveHint:false, idempotentHint:false, openWorldHint:false },
  },
  {
    name:'reality.execute',
    title:'Execute Approved Reality Plan',
    description:'Execute a previously created plan through Reality Layer policy, safety, stale-context checks and Executor. An external agent cannot self-confirm CONFIRM-level plans.',
    inputSchema:{ type:'object', additionalProperties:false, properties:{ plan_id:{type:'string',minLength:8,maxLength:120} }, required:['plan_id'] },
    outputSchema:{ type:'object' },
    annotations:{ readOnlyHint:false, destructiveHint:true, idempotentHint:false, openWorldHint:false },
  },
  {
    name:'reality.explain',
    title:'Explain Reality Decision',
    description:'Explain a pending or previously executed plan using policy decisions, execution logs and audit events. Read-only.',
    inputSchema:{ type:'object', additionalProperties:false, properties:{ plan_id:{type:'string',minLength:8,maxLength:120}, limit:{type:'integer',minimum:1,maximum:20} } },
    outputSchema:{ type:'object' },
    annotations:{ readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  },
  {
    name:'reality.action.get',
    title:'Get Reality Action Outcome',
    description:'Read one stable Reality action outcome, provenance and reconciliation requirement by action_id. Read-only.',
    inputSchema:{ type:'object', additionalProperties:false, properties:{ action_id:{type:'string',minLength:8,maxLength:120} }, required:['action_id'] },
    outputSchema:{ type:'object' },
    annotations:{ readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  },
  {
    name:'reality.action.reconcile',
    title:'Reconcile Unknown Reality Action',
    description:'Ask Reality Layer to gather trusted adapter/provider evidence for an UNKNOWN action. Caller assertions cannot set SUCCEEDED or FAILED, and this never retries the physical action.',
    inputSchema:{ type:'object', additionalProperties:false, properties:{ action_id:{type:'string',minLength:8,maxLength:120} }, required:['action_id'] },
    outputSchema:{ type:'object' },
    annotations:{ readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  },
];

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function textContent(data) { return JSON.stringify(data, null, 2); }
function serverMeta() { return { 'io.modelcontextprotocol/serverInfo': { ...SERVER_INFO } }; }
function rpcResult(id, result) { return { jsonrpc:'2.0', id, result:{ ...result, _meta:{ ...(result?._meta || {}), ...serverMeta() } } }; }
function legacyRpcResult(id, result) { return { jsonrpc:'2.0', id, result }; }
function rpcError(id, code, message, data) { return { jsonrpc:'2.0', id:id ?? null, error:{ code, message, ...(data === undefined ? {} : {data}) } }; }

function writeJson(res, status, body, extraHeaders={}) {
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}
function writeEmpty(res, status, extraHeaders={}) {
  res.writeHead(status, { 'Cache-Control':'no-store', ...extraHeaders });
  res.end();
}

function sanitizeClientInfo(raw) {
  if (!raw || typeof raw !== 'object') return { name:'unknown-mcp-client', version:null, trust:'self-reported-unverified' };
  return {
    name:typeof raw.name === 'string' ? raw.name.slice(0,80) : 'unknown-mcp-client',
    version:typeof raw.version === 'string' ? raw.version.slice(0,40) : null,
    trust:'self-reported-unverified',
  };
}
function modernClientInfo(params={}) {
  const meta = params?._meta || {};
  return sanitizeClientInfo(meta['io.modelcontextprotocol/clientInfo']);
}

function validateObject(value, schema, path='arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
  for (const key of schema.required || []) if (!(key in value)) throw new Error(`${path}.${key} is required`);
  if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!schema.properties?.[key]) throw new Error(`${path}.${key} is not allowed`);
  for (const [key, rule] of Object.entries(schema.properties || {})) {
    if (!(key in value)) continue;
    const v = value[key];
    if (rule.type === 'string') {
      if (typeof v !== 'string') throw new Error(`${path}.${key} must be a string`);
      if (rule.minLength != null && v.length < rule.minLength) throw new Error(`${path}.${key} is too short`);
      if (rule.maxLength != null && v.length > rule.maxLength) throw new Error(`${path}.${key} is too long`);
      if (Array.isArray(rule.enum) && !rule.enum.includes(v)) throw new Error(`${path}.${key} must be one of: ${rule.enum.join(', ')}`);
    } else if (rule.type === 'boolean') {
      if (typeof v !== 'boolean') throw new Error(`${path}.${key} must be boolean`);
    } else if (rule.type === 'integer') {
      if (!Number.isInteger(v)) throw new Error(`${path}.${key} must be an integer`);
      if (rule.minimum != null && v < rule.minimum) throw new Error(`${path}.${key} is below minimum`);
      if (rule.maximum != null && v > rule.maximum) throw new Error(`${path}.${key} is above maximum`);
    }
  }
  return value;
}

function validateModernHeaders(req, body) {
  const method = String(body?.method || '');
  const protocol = String(req.headers['mcp-protocol-version'] || body?.params?._meta?.['io.modelcontextprotocol/protocolVersion'] || '');
  if (protocol !== MCP_PROTOCOL_VERSION) return { code:-32022, message:'Unsupported protocol version', data:{ supportedVersions:[MCP_PROTOCOL_VERSION] } };
  const methodHeader = String(req.headers['mcp-method'] || '');
  if (!methodHeader || methodHeader !== method) return { code:-32020, message:'Mcp-Method header does not match JSON-RPC method' };
  if (method === 'tools/call') {
    const name = String(body?.params?.name || '');
    const nameHeader = String(req.headers['mcp-name'] || '');
    if (!nameHeader || nameHeader !== name) return { code:-32020, message:'Mcp-Name header does not match tools/call params.name' };
  }
  return null;
}

function createMcpServer(service) {
  if (!service || typeof service !== 'object') throw new Error('MCP service callbacks are required.');
  const sessions = new Map();

  function getSession(req) {
    const id = String(req.headers['mcp-session-id'] || '').trim();
    return id ? sessions.get(id) || null : null;
  }

  function createLegacySession(params={}) {
    const requested = String(params.protocolVersion || '');
    if (!LEGACY_PROTOCOL_VERSIONS.includes(requested)) return null;
    const id = crypto.randomUUID();
    const session = {
      id,
      protocolVersion:requested,
      client:sanitizeClientInfo(params.clientInfo),
      createdAt:new Date().toISOString(),
    };
    sessions.set(id, session);
    return session;
  }

  function validateLegacySession(req) {
    const session = getSession(req);
    if (!session) return { error:{ code:-32001, message:'MCP session is missing or expired' } };
    const protocol = String(req.headers['mcp-protocol-version'] || '').trim();
    if (protocol && protocol !== session.protocolVersion) {
      return { error:{ code:-32600, message:'MCP-Protocol-Version does not match negotiated session version' } };
    }
    return { session };
  }

  async function callTool(name, args, client) {
    const tool = TOOLS.find((t)=>t.name === name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode:-32602 });
    validateObject(args || {}, tool.inputSchema);
    appendEvent({
      type:'mcp.tool.called', source:'mcp', actor_id:service.currentIdentity()?.id || null,
      payload:{ tool:name, client, argument_keys:Object.keys(args || {}) },
    });

    let data;
    if (name === 'reality.discover') data = await service.discover(args, {client});
    else if (name === 'reality.observe') data = await service.observe(args, {client});
    else if (name === 'reality.plan') data = await service.plan(args, {client});
    else if (name === 'reality.execute') data = await service.execute(args, {client, externalAgent:true});
    else if (name === 'reality.explain') data = await service.explain(args, {client});
    else if (name === 'reality.action.get') data = await service.actionGet(args, {client});
    else if (name === 'reality.action.reconcile') data = await service.actionReconcile(args, {client});

    appendEvent({
      type:'mcp.tool.result', source:'mcp', actor_id:service.currentIdentity()?.id || null,
      target_id:typeof data?.plan_id === 'string' ? data.plan_id : null,
      payload:{ tool:name, client, ok:data?.ok !== false, decision:data?.decision || null, status:data?.status || null },
    });
    return data;
  }

  async function handleLegacy(req, res, body) {
    if (body.method === 'initialize') {
      const session = createLegacySession(body.params || {});
      if (!session) {
        return writeJson(res,400,rpcError(body.id,-32602,'Unsupported legacy MCP protocol version',{
          supportedProtocolVersions:LEGACY_PROTOCOL_VERSIONS,
          requested:body.params?.protocolVersion || null,
        }));
      }
      return writeJson(res,200,legacyRpcResult(body.id,{
        protocolVersion:session.protocolVersion,
        capabilities:{ tools:{ listChanged:false } },
        serverInfo:{ name:SERVER_INFO.name, title:SERVER_INFO.title, version:SERVER_INFO.version },
        instructions:'Use reality.discover/observe/plan/execute/explain plus reality.action.get/reconcile for explicit action outcomes. All physical execution stays behind Reality Layer Identity, Permission, Safety and stale-context checks. Client metadata is never treated as authorization.',
      }), { 'Mcp-Session-Id':session.id, 'MCP-Protocol-Version':session.protocolVersion });
    }

    const checked = validateLegacySession(req);
    if (checked.error) return writeJson(res,400,rpcError(body.id,checked.error.code,checked.error.message));
    const session = checked.session;

    if (body.method === 'notifications/initialized') return writeEmpty(res,202,{'Mcp-Session-Id':session.id});
    if (body.method === 'ping') return writeJson(res,200,legacyRpcResult(body.id,{}),{'Mcp-Session-Id':session.id});
    if (body.method === 'tools/list') return writeJson(res,200,legacyRpcResult(body.id,{tools:clone(TOOLS)}),{'Mcp-Session-Id':session.id});
    if (body.method === 'tools/call') {
      try {
        const name = body.params?.name;
        const args = body.params?.arguments || {};
        const data = await callTool(name,args,session.client);
        return writeJson(res,200,legacyRpcResult(body.id,{
          content:[{type:'text',text:textContent(data)}],
          structuredContent:data,
          isError:false,
        }),{'Mcp-Session-Id':session.id});
      } catch (error) {
        if (error.rpcCode) return writeJson(res,400,rpcError(body.id,error.rpcCode,error.message),{'Mcp-Session-Id':session.id});
        const data = { ok:false, error:error.message };
        return writeJson(res,200,legacyRpcResult(body.id,{
          content:[{type:'text',text:textContent(data)}],
          structuredContent:data,
          isError:true,
        }),{'Mcp-Session-Id':session.id});
      }
    }
    return writeJson(res,404,rpcError(body.id,-32601,'Method not found'),{'Mcp-Session-Id':session.id});
  }

  async function handleModern(req, res, body) {
    const headerError = validateModernHeaders(req, body);
    if (headerError) return writeJson(res,400,rpcError(body.id,headerError.code,headerError.message,headerError.data),{'MCP-Protocol-Version':MCP_PROTOCOL_VERSION});

    try {
      if (body.method === 'server/discover') {
        return writeJson(res,200,rpcResult(body.id,{
          supportedVersions:[MCP_PROTOCOL_VERSION],
          capabilities:{ tools:{ listChanged:false } },
          instructions:'Use reality.discover/observe/plan/execute/explain plus reality.action.get/reconcile for explicit action outcomes. All physical execution stays behind Reality Layer Identity, Permission, Safety and stale-context checks. Client metadata is never treated as authorization.',
          ttlMs:30000,
          cacheScope:'private',
        }),{'MCP-Protocol-Version':MCP_PROTOCOL_VERSION});
      }
      if (body.method === 'tools/list') {
        return writeJson(res,200,rpcResult(body.id,{ tools:clone(TOOLS), ttlMs:30000, cacheScope:'private' }),{'MCP-Protocol-Version':MCP_PROTOCOL_VERSION});
      }
      if (body.method === 'tools/call') {
        const name = body.params?.name;
        const args = body.params?.arguments || {};
        const data = await callTool(name,args,modernClientInfo(body.params));
        return writeJson(res,200,rpcResult(body.id,{
          content:[{type:'text',text:textContent(data)}],
          structuredContent:data,
          isError:false,
        }),{'MCP-Protocol-Version':MCP_PROTOCOL_VERSION});
      }
      return writeJson(res,404,rpcError(body.id,-32601,'Method not found'),{'MCP-Protocol-Version':MCP_PROTOCOL_VERSION});
    } catch (error) {
      if (error.rpcCode) return writeJson(res,400,rpcError(body.id,error.rpcCode,error.message),{'MCP-Protocol-Version':MCP_PROTOCOL_VERSION});
      const data = { ok:false, error:error.message };
      return writeJson(res,200,rpcResult(body.id,{
        content:[{type:'text',text:textContent(data)}],
        structuredContent:data,
        isError:true,
      }),{'MCP-Protocol-Version':MCP_PROTOCOL_VERSION});
    }
  }

  async function handle(req, res, body) {
    if (req.method === 'DELETE') {
      const id = String(req.headers['mcp-session-id'] || '').trim();
      if (id) sessions.delete(id);
      return writeEmpty(res,204);
    }
    if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') return writeJson(res,400,rpcError(body?.id,-32600,'Invalid Request'));

    const isLegacy = body.method === 'initialize' || Boolean(req.headers['mcp-session-id']);
    if (isLegacy) return handleLegacy(req,res,body);
    return handleModern(req,res,body);
  }

  return {
    version:MCP_SERVER_VERSION,
    protocolVersion:MCP_PROTOCOL_VERSION,
    legacyProtocolVersions:[...LEGACY_PROTOCOL_VERSIONS],
    tools:()=>clone(TOOLS),
    handle,
    sessionCount:()=>sessions.size,
  };
}

function publicMcpSpec() {
  return {
    version:MCP_SERVER_VERSION,
    protocol_version:MCP_PROTOCOL_VERSION,
    legacy_protocol_versions:[...LEGACY_PROTOCOL_VERSIONS],
    lifecycle:'dual-era MCP: modern 2026-07-28 + legacy initialize/session compatibility',
    endpoint:'/mcp',
    tools:TOOLS.map((tool)=>({name:tool.name,title:tool.title,description:tool.description,annotations:tool.annotations})),
    execution_rule:'External agents can execute AUTO plans only. CONFIRM plans stop for trusted local user confirmation; client self-asserted confirmation is not accepted.',
    action_outcome_rule:'Every executed Typed Action IR has a stable action_id and one of STARTED/SUCCEEDED/FAILED/UNKNOWN. UNKNOWN must be reconciled before any retry.',
    client_identity_rule:'MCP client identity is self-reported metadata for audit/display only and never grants permissions.',
  };
}

module.exports = { MCP_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSIONS, MCP_SERVER_VERSION, createMcpServer, publicMcpSpec, TOOLS };
