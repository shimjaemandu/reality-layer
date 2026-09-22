const fs = require('fs');
const path = require('path');
const { devices } = require('./devices');
const { interpret: localInterpret, clarificationFor } = require('./intent');
const { registry } = require('./app-registry');
const { SITES, SEARCH_PROVIDERS, FOLDERS, SPECIAL_LOCATIONS, SYSTEM_TARGETS, POWER_ACTIONS, WORKFLOWS } = require('./windows-pc');

const ROOT = path.join(__dirname, '..');
const LOCAL_CONFIG = path.join(ROOT, 'config.local.json');
const DEFAULT_MODEL = 'gpt-5.6-luna';

function loadConfig() {
  let local = {};
  try {
    if (fs.existsSync(LOCAL_CONFIG)) local = JSON.parse(fs.readFileSync(LOCAL_CONFIG, 'utf8'));
  } catch (error) {
    console.warn('config.local.json을 읽지 못했습니다:', error.message);
  }
  return {
    apiKey: process.env.OPENAI_API_KEY || local.openai_api_key || '',
    model: process.env.OPENAI_MODEL || local.openai_model || DEFAULT_MODEL,
  };
}

function deviceSummary() {
  return Object.values(devices).map((device) => ({
    id: device.id,
    name: device.name,
    type: device.type,
    location: device.location,
    capabilities: device.capabilities,
    adapter_id: device.adapter_id,
    protocol: device.protocol,
    interface_version: device.interface_version,
    state: device.state,
  }));
}

function enumValues(object, extra = []) { return [...Object.keys(object), ...extra]; }
function appIds() { return registry().map((app)=>app.id); }

const actionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matched: { type: 'boolean' },
    device: { type: 'string', enum: ['my_laptop', 'living_room_light', 'bedroom_light', 'front_door', 'room_display', 'none'] },
    capability: { type: 'string', enum: ['open_app','close_app','open_url','open_site','web_search','open_folder','open_special_location','open_system','power_action','run_workflow','turn_on','turn_off','set_brightness','display_message','lock','unlock','none'] },
    brightness: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
    message: { type: ['string', 'null'], maxLength: 120 },
    app: { type: ['string', 'null'], enum: [...appIds(), null] },
    url: { type: ['string', 'null'], maxLength: 500 },
    site: { type: ['string','null'], enum: enumValues(SITES, [null]) },
    provider: { type: ['string','null'], enum: enumValues(SEARCH_PROVIDERS, [null]) },
    query: { type: ['string','null'], maxLength: 200 },
    folder: { type: ['string','null'], enum: enumValues(FOLDERS, [null]) },
    special_location: { type: ['string','null'], enum: enumValues(SPECIAL_LOCATIONS, [null]) },
    system_target: { type: ['string','null'], enum: enumValues(SYSTEM_TARGETS, [null]) },
    power_action: { type: ['string','null'], enum: enumValues(POWER_ACTIONS, [null]) },
    workflow: { type: ['string','null'], enum: enumValues(WORKFLOWS, [null]) },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', maxLength: 240 },
    context_references: { type: 'array', items: { type: 'string', enum: ['current_location', 'last_device'] }, maxItems: 2 },
  },
  required: ['matched','device','capability','brightness','message','app','url','site','provider','query','folder','special_location','system_target','power_action','workflow','confidence','explanation','context_references'],
};

function extractOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text;
  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return null;
}

function validateModelAction(result, sourceText) {
  if (!result || result.matched !== true) {
    return { ...clarificationFor(sourceText), reason:result?.explanation || 'AI가 지원되는 기기 명령으로 확정하지 못했습니다.' };
  }
  const device = devices[result.device];
  if (!device) return { ok:false, reason:'AI가 존재하지 않는 기기를 선택해 Gateway가 차단했습니다.' };
  if (!device.capabilities.includes(result.capability)) return { ok:false, reason:'AI가 해당 기기에 없는 기능을 선택해 Gateway가 차단했습니다.' };

  const args = {};
  if (result.capability === 'set_brightness') {
    const value = Number(result.brightness);
    if (!Number.isInteger(value) || value < 0 || value > 100) return { ok:false, reason:'조명 밝기 값이 안전한 범위(0~100)가 아니라 차단했습니다.' };
    args.brightness = value;
  } else if (result.capability === 'display_message') {
    const message = String(result.message || '').trim().slice(0,120);
    if (!message) return { ok:false, reason:'표시할 메시지가 비어 있어 실행하지 않습니다.' };
    args.message = message;
  } else if (['open_app','close_app'].includes(result.capability)) {
    const allowed = appIds();
    const app = String(result.app || '').trim().toLowerCase();
    if (!allowed.includes(app)) return { ok:false, reason:'AI가 허용목록에 없는 앱을 선택해 Gateway가 차단했습니다.' };
    args.app = app;
  } else if (result.capability === 'open_url') {
    const rawUrl = String(result.url || '').trim();
    try {
      const parsed = new URL(rawUrl);
      if (!['http:','https:'].includes(parsed.protocol)) throw new Error('unsupported');
      args.url = parsed.toString();
    } catch { return { ok:false, reason:'AI가 안전한 웹 주소를 만들지 못해 Gateway가 차단했습니다.' }; }
  } else if (result.capability === 'open_site') {
    const site = String(result.site || '').trim().toLowerCase();
    if (!SITES[site]) return { ok:false, reason:'AI가 등록되지 않은 사이트를 선택해 차단했습니다.' };
    args.site = site;
  } else if (result.capability === 'web_search') {
    const provider = String(result.provider || '').trim().toLowerCase();
    const query = String(result.query || '').trim().slice(0,200);
    if (!SEARCH_PROVIDERS[provider] || !query) return { ok:false, reason:'AI가 안전한 검색 대상 또는 검색어를 만들지 못해 차단했습니다.' };
    args.provider = provider; args.query = query;
  } else if (result.capability === 'open_folder') {
    const folder = String(result.folder || '').trim().toLowerCase();
    if (!FOLDERS[folder]) return { ok:false, reason:'AI가 등록되지 않은 폴더를 선택해 차단했습니다.' };
    args.folder = folder;
  } else if (result.capability === 'open_special_location') {
    const target = String(result.special_location || '').trim().toLowerCase();
    if (!SPECIAL_LOCATIONS[target]) return { ok:false, reason:'AI가 등록되지 않은 탐색기 위치를 선택해 차단했습니다.' };
    args.special_location = target;
  } else if (result.capability === 'open_system') {
    const target = String(result.system_target || '').trim().toLowerCase();
    if (!SYSTEM_TARGETS[target]) return { ok:false, reason:'AI가 등록되지 않은 Windows 기능을 선택해 차단했습니다.' };
    args.system_target = target;
  } else if (result.capability === 'power_action') {
    const target = String(result.power_action || '').trim().toLowerCase();
    if (!POWER_ACTIONS[target]) return { ok:false, reason:'AI가 등록되지 않은 전원 동작을 선택해 차단했습니다.' };
    args.power_action = target;
  } else if (result.capability === 'run_workflow') {
    const workflow = String(result.workflow || '').trim().toLowerCase();
    if (!WORKFLOWS[workflow]) return { ok:false, reason:'AI가 등록되지 않은 작업 조합을 선택해 차단했습니다.' };
    args.workflow = workflow;
  }

  return {
    ok:true,
    confidence:Math.max(0, Math.min(1, Number(result.confidence) || 0)),
    explanation:String(result.explanation || 'AI가 명령을 구조화했습니다.').slice(0,240),
    action:{ device:device.id, capability:result.capability, args, source_text:sourceText },
    context_used:Array.isArray(result.context_references) ? result.context_references.filter((value)=>['current_location','last_device'].includes(value)) : [],
  };
}

async function callOpenAI(text, context, config, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        store: false,
        input: [
          {
            role: 'system',
            content: [
              'You are the intent parser for an AI Action Gateway.',
              'Convert the Korean user request into exactly one supported device action.',
              'Never invent a device, capability, app, URL scheme, or hidden action.',
              `For my_laptop open_app/close_app, only these app IDs are allowed: ${appIds().join(', ')}.`,
              `Allowed site IDs: ${Object.keys(SITES).join(', ')}. Search providers: ${Object.keys(SEARCH_PROVIDERS).join(', ')}.`,
              `Allowed folders: ${Object.keys(FOLDERS).join(', ')}. Special Explorer locations: ${Object.keys(SPECIAL_LOCATIONS).join(', ')}. Windows system targets: ${Object.keys(SYSTEM_TARGETS).join(', ')}. Power actions: ${Object.keys(POWER_ACTIONS).join(', ')}. Workflows: ${Object.keys(WORKFLOWS).join(', ')}.`,
              'For open_url, only return an explicit http/https URL. Never return file:, javascript:, data:, shell commands, command lines, scripts, terminal actions, PowerShell, cmd, registry edits, or arbitrary executables.',
              'Prefer open_site, web_search, open_folder, open_special_location, open_system, power_action, or run_workflow when one of those exact actions fits. Power actions always require independent gateway confirmation.',
              'close_app may only target a registered app; the gateway will require user confirmation.',
              'You may resolve contextual words such as 여기/이 방 using current_location, and 그거/아까 그거 using last_device.',
              'If you use current_location or last_device to resolve the command, include that key in context_references. Otherwise return an empty array.',
              'Never use current_location when it is null, when current_location_status is ambiguous/insufficient, or when confidence is below 0.6.',
              'Use context only when it makes the reference unambiguous. If context does not safely resolve the target, matched=false.',
              'If the request is unsupported, asks for multiple actions, or remains ambiguous, matched=false and use device=none and capability=none.',
              'Do not decide permissions. The gateway independently validates and authorizes every action.',
              'For brightness, map qualitative requests only when clear: 어둡게≈30, 밝게≈85.',
              `Current context: ${JSON.stringify(context || {})}`,
              `Supported devices: ${JSON.stringify(deviceSummary())}`,
            ].join('\n'),
          },
          { role: 'user', content: text },
        ],
        max_output_tokens: 400,
        text: { format: { type: 'json_schema', name: 'gateway_action', strict: true, schema: actionSchema } },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `OpenAI API HTTP ${response.status}`);
    const outputText = extractOutputText(payload);
    if (!outputText) throw new Error('AI 응답에서 구조화 결과를 찾지 못했습니다.');
    return JSON.parse(outputText);
  } finally {
    clearTimeout(timeout);
  }
}

async function interpretWithAI(text, options = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, reason: '명령이 비어 있습니다.', engine: 'none' };
  const config = options.config || loadConfig();
  const context = options.context || {};

  if (!config.apiKey) {
    const local = localInterpret(raw, context);
    return { ...local, engine: 'local-fallback', model: null, warning: 'OpenAI API 키가 없어 로컬 해석기를 사용했습니다.' };
  }

  try {
    const structured = await callOpenAI(raw, context, config, options.fetchImpl || fetch);
    return { ...validateModelAction(structured, raw), engine: 'openai', model: config.model };
  } catch (error) {
    const local = localInterpret(raw, context);
    return { ...local, engine: 'local-fallback', model: config.model, warning: `AI 해석 실패로 로컬 해석기로 전환했습니다: ${error.name === 'AbortError' ? '요청 시간 초과' : error.message}` };
  }
}

function aiStatus() {
  const config = loadConfig();
  return { configured: Boolean(config.apiKey), model: config.model, fallback_available: true };
}

module.exports = { interpretWithAI, validateModelAction, extractOutputText, loadConfig, aiStatus, actionSchema, callOpenAI };
