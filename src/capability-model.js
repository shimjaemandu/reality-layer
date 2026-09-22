'use strict';

const CAPABILITY_MODEL_VERSION = 'reality-capability/1.0';

const models = {
  windows_pc: [
    action('application.launch', { app: str(1, 120) }, { legacy:'open_app', risk:'low', tags:['application','launch'] }),
    action('application.close', { app: str(1, 120) }, { legacy:'close_app', risk:'medium', reversible:false, tags:['application','close'] }),
    action('web.open_url', { url: str(1, 2048) }, { legacy:'open_url', risk:'low', tags:['web','navigation'] }),
    action('web.open_site', { site: str(1, 120) }, { legacy:'open_site', risk:'low', tags:['web','navigation'] }),
    action('web.search', { provider: str(1, 80), query: str(1, 200) }, { legacy:'web_search', risk:'low', tags:['web','search'] }),
    action('filesystem.open_folder', { folder: str(1, 120) }, { legacy:'open_folder', risk:'low', tags:['filesystem','navigation'] }),
    action('filesystem.open_special_location', { special_location: str(1, 120) }, { legacy:'open_special_location', risk:'low', tags:['filesystem','navigation'] }),
    action('system.open_settings', { system_target: str(1, 120) }, { legacy:'open_system', risk:'low', tags:['system','settings'] }),
    action('system.power', { power_action: str(1, 80) }, { legacy:'power_action', risk:'high', reversible:false, tags:['system','power'] }),
    action('workflow.run', { workflow: str(1, 120) }, { legacy:'run_workflow', risk:'medium', tags:['workflow','orchestration'] }),
  ],
  light: [
    property('power', { type:'string', enum:['on','off'] }, { risk:'low', tags:['environment','lighting'], legacyMap:{ on:'turn_on', off:'turn_off' } }),
    property('brightness', { type:'integer', minimum:0, maximum:100 }, { risk:'low', unit:'percent', tags:['environment','lighting'], legacy:'set_brightness' }),
  ],
  display: [
    property('power', { type:'string', enum:['on','off'] }, { risk:'low', tags:['display'], legacyMap:{ on:'turn_on', off:'turn_off' } }),
    action('message.display', { message: str(1, 120) }, { legacy:'display_message', risk:'low', tags:['display','message'] }),
  ],
  door: [
    property('lock_state', { type:'string', enum:['locked','unlocked'] }, { risk:'high', reversible:true, tags:['security','access'], legacyMap:{ locked:'lock', unlocked:'unlock' } }),
  ],
};

function str(minLength=0,maxLength=500){ return {type:'string',minLength,maxLength}; }
function action(id,inputSchema={},meta={}) { return base(id,'action',['invoke'],inputSchema,meta); }
function property(id,valueSchema,meta={}) { return base(id,'property',['read','write'],{ value:valueSchema },meta); }
function base(id,kind,operations,inputSchema,meta={}) {
  return {
    id, kind, operations,
    input_schema:{ type:'object', additionalProperties:false, properties:inputSchema, required:Object.keys(inputSchema) },
    output_schema:{ type:'object' },
    unit:meta.unit || null,
    risk:meta.risk || 'critical',
    reversible:meta.reversible !== false,
    idempotent:meta.idempotent !== false,
    tags:meta.tags || [],
    legacy:meta.legacy || null,
    legacy_map:meta.legacyMap || null,
  };
}

function capabilitiesForDevice(device) {
  return (models[device?.type] || []).map((c)=>JSON.parse(JSON.stringify(c)));
}
function getCapability(device, capabilityId) {
  return capabilitiesForDevice(device).find((c)=>c.id===capabilityId) || null;
}
function publicCapabilityModel(device) {
  if (device) return { version:CAPABILITY_MODEL_VERSION, device_id:device.id, device_type:device.type, capabilities:capabilitiesForDevice(device) };
  return { version:CAPABILITY_MODEL_VERSION, device_types:Object.fromEntries(Object.entries(models).map(([type,list])=>[type,list.map((c)=>JSON.parse(JSON.stringify(c)))])) };
}

function validateSchemaValue(value,schema,path='input') {
  if (!schema) return;
  if (schema.type==='string') {
    if (typeof value!=='string') throw new Error(`${path}는 문자열이어야 합니다.`);
    if (schema.minLength!=null && value.length<schema.minLength) throw new Error(`${path}가 너무 짧습니다.`);
    if (schema.maxLength!=null && value.length>schema.maxLength) throw new Error(`${path}가 너무 깁니다.`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} 값이 허용 범위를 벗어났습니다.`);
    return;
  }
  if (schema.type==='integer') {
    if (!Number.isInteger(value)) throw new Error(`${path}는 정수여야 합니다.`);
    if (schema.minimum!=null && value<schema.minimum) throw new Error(`${path}가 최소값보다 작습니다.`);
    if (schema.maximum!=null && value>schema.maximum) throw new Error(`${path}가 최대값보다 큽니다.`);
    return;
  }
  if (schema.type==='object') {
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error(`${path}는 객체여야 합니다.`);
    for (const key of schema.required || []) if (!(key in value)) throw new Error(`${path}.${key}가 필요합니다.`);
    if (schema.additionalProperties===false) for (const key of Object.keys(value)) if (!schema.properties?.[key]) throw new Error(`${path}.${key}는 허용되지 않은 입력입니다.`);
    for (const [key,sub] of Object.entries(schema.properties || {})) if (key in value) validateSchemaValue(value[key],sub,`${path}.${key}`);
  }
}
function validateCapabilityAction(device, capabilityId, operation, input={}) {
  const cap=getCapability(device,capabilityId);
  if(!cap) throw new Error(`기기 ${device?.id || 'unknown'}에 capability ${capabilityId}가 없습니다.`);
  if(!cap.operations.includes(operation)) throw new Error(`${capabilityId}는 ${operation} 연산을 지원하지 않습니다.`);
  validateSchemaValue(input,cap.input_schema);
  return cap;
}

function legacyToCapability(device, legacyCapability, args={}) {
  const type=device?.type;
  if(type==='light') {
    if(legacyCapability==='turn_on') return { capability_id:'power', operation:'write', input:{value:'on'} };
    if(legacyCapability==='turn_off') return { capability_id:'power', operation:'write', input:{value:'off'} };
    if(legacyCapability==='set_brightness') return { capability_id:'brightness', operation:'write', input:{value:Number(args.brightness)} };
  }
  if(type==='display') {
    if(legacyCapability==='turn_on') return { capability_id:'power', operation:'write', input:{value:'on'} };
    if(legacyCapability==='turn_off') return { capability_id:'power', operation:'write', input:{value:'off'} };
    if(legacyCapability==='display_message') return { capability_id:'message.display', operation:'invoke', input:{message:String(args.message ?? '')} };
  }
  if(type==='door') {
    if(legacyCapability==='lock') return { capability_id:'lock_state', operation:'write', input:{value:'locked'} };
    if(legacyCapability==='unlock') return { capability_id:'lock_state', operation:'write', input:{value:'unlocked'} };
  }
  if(type==='windows_pc') {
    const map={open_app:['application.launch','invoke',{app:args.app}],close_app:['application.close','invoke',{app:args.app}],open_url:['web.open_url','invoke',{url:args.url}],open_site:['web.open_site','invoke',{site:args.site}],web_search:['web.search','invoke',{provider:args.provider,query:args.query}],open_folder:['filesystem.open_folder','invoke',{folder:args.folder}],open_special_location:['filesystem.open_special_location','invoke',{special_location:args.special_location}],open_system:['system.open_settings','invoke',{system_target:args.system_target}],power_action:['system.power','invoke',{power_action:args.power_action}],run_workflow:['workflow.run','invoke',{workflow:args.workflow}]};
    const v=map[legacyCapability]; if(v) return {capability_id:v[0],operation:v[1],input:v[2]};
  }
  throw new Error(`legacy capability ${legacyCapability}를 Capability Model로 변환할 수 없습니다.`);
}

function capabilityToLegacy(device, capabilityId, operation, input={}) {
  const cap=validateCapabilityAction(device,capabilityId,operation,input);
  if(cap.legacy) {
    if (capabilityId === 'brightness' && operation === 'write') return { capability:cap.legacy, args:{ brightness:input.value } };
    return { capability:cap.legacy, args:{...input} };
  }
  if(cap.legacy_map) {
    const key=input.value;
    const legacy=cap.legacy_map[key];
    if(!legacy) throw new Error(`${capabilityId} 값 ${key}에 대응하는 legacy action이 없습니다.`);
    return { capability:legacy, args:{} };
  }
  throw new Error(`${capabilityId} capability의 legacy bridge가 없습니다.`);
}

module.exports={CAPABILITY_MODEL_VERSION,capabilitiesForDevice,getCapability,publicCapabilityModel,validateCapabilityAction,legacyToCapability,capabilityToLegacy};
