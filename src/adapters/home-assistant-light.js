'use strict';
const {localConfig,live}=require('../runtime');
let config=null;
function validateConfig(raw) {
  if (!raw || !raw.url || !raw.token) return null;
  const url=new URL(raw.url);
  if (!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)) throw new Error('Home Assistant 주소는 http(s)://호스트:포트 형식이어야 합니다.');
  const entities={};
  for (const [id,entity] of Object.entries(raw.entities||{})) {
    if (!['living_room_light','bedroom_light'].includes(id)||typeof entity!=='string'||!/^light\.[a-z0-9_]+$/.test(entity)) throw new Error('Home Assistant에는 등록된 두 조명의 light 엔티티만 연결할 수 있습니다.');
    if (Object.values(entities).includes(entity)) throw new Error('동일한 실제 조명을 두 공간에 중복 등록할 수 없습니다.');
    entities[id]=entity;
  }
  return {url:url.origin,token:raw.token,entities};
}
function setup(devices) {
  const local=localConfig().home_assistant||{};
  config=validateConfig({...local,url:process.env.HA_URL||local.url,token:process.env.HA_TOKEN||local.token});
  if (!live || !config) return;
  for (const id of Object.keys(config.entities)) {
    Object.assign(devices[id],{adapter_id:'home_assistant_light',vendor:'Home Assistant',protocol:'ha-rest',state:{power:'unknown',brightness:null,availability:'not_checked'}});
  }
}
function status() {return {configured:Boolean(config),active:Boolean(live&&config),mapped:config?Object.keys(config.entities):[],hardware_verified:false};}
async function request(cfg, endpoint, payload, fetchImpl=fetch) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),6000);
  try {
    const r=await fetchImpl(cfg.url+endpoint,{method:payload?'POST':'GET',headers:{Authorization:`Bearer ${cfg.token}`,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{}),signal:controller.signal,redirect:'error'});
    if (!r.ok) throw new Error(`Home Assistant 응답 ${r.status}. 주소·토큰·기기 연결을 확인해 주세요.`);
    return await r.json();
  } catch(e) {
    if (e.name==='AbortError') throw new Error('Home Assistant 응답 시간 초과. 실제 상태를 확인한 뒤 다시 요청해 주세요.');
    throw new Error(e.message.startsWith('Home Assistant')?e.message:'Home Assistant 연결 실패. 실제 상태를 확인해 주세요.');
  } finally {clearTimeout(timeout);}
}
function decode(raw) {
  if (!raw||!['on','off'].includes(raw.state)) throw new Error('Home Assistant 기기가 unavailable/unknown 상태입니다.');
  return {power:raw.state,brightness:Number.isFinite(raw.attributes?.brightness)?Math.round(raw.attributes.brightness/255*100):null,availability:'available'};
}
async function refresh(device, options={}) {
  const cfg=options.config||config, entity=cfg?.entities[device.id];
  if (!entity) throw new Error('Home Assistant 기기 매핑이 없습니다.');
  try {device.state=decode(await request(cfg,'/api/states/'+entity,null,options.fetchImpl));}
  catch(e){device.state={...device.state,availability:'unavailable'};throw e;}
  return {...device.state};
}
async function execute(device,capability,args={},options={}) {
  const cfg=options.config||config, entity=cfg?.entities[device.id];
  if (!entity) throw new Error('Home Assistant 기기 매핑이 없습니다.');
  if (!['turn_on','turn_off','set_brightness'].includes(capability)) throw new Error('지원하지 않는 조명 동작입니다.');
  const payload={entity_id:entity};
  if (capability==='set_brightness') {
    if (!Number.isInteger(args.brightness)||args.brightness<0||args.brightness>100) throw new Error('밝기는 0~100 정수여야 합니다.');
    payload.brightness_pct=args.brightness;
  }
  const action=capability==='turn_off'?'turn_off':'turn_on';
  await request(cfg,'/api/services/light/'+action,payload,options.fetchImpl);
  // Service acceptance is not success: read the reported entity state back.
  const state=await refresh(device,options);
  const expected=action==='turn_off'||args.brightness===0?'off':'on';
  if (state.power!==expected || (capability==='set_brightness'&&args.brightness>0&&(state.brightness===null||Math.abs(state.brightness-args.brightness)>3))) throw new Error('명령은 전송했지만 조명 상태가 아직 일치하지 않습니다. 새로고침으로 확인해 주세요.');
  return {state,native_trace:{adapter:'home_assistant_light',protocol:'ha-rest',translated_command:{service:'light.'+action,...payload},verified_by:'entity_state_readback'}};
}
module.exports={setup,status,execute,refresh,validateConfig};
