const { devices } = require('./devices');
const { matchAppFromText, getApp, publicRegistry } = require('./app-registry');
const { SITES, SEARCH_PROVIDERS, FOLDERS, SPECIAL_LOCATIONS, SYSTEM_TARGETS, POWER_ACTIONS, WORKFLOWS } = require('./windows-pc');

const locationMap = [
  { terms: ['거실'], value: 'living_room' },
  { terms: ['침실', '내 방', '방'], value: 'bedroom' },
  { terms: ['현관', '입구'], value: 'entrance' },
];

function pickLocation(text) {
  for (const item of locationMap) {
    if (item.terms.some((term) => text.includes(term))) return item.value;
  }
  return null;
}

function findBrightness(text) {
  const percent = text.match(/(\d{1,3})\s*%/);
  if (percent) return Math.max(0, Math.min(100, Number(percent[1])));
  const plain = text.match(/밝기\s*(?:를\s*)?(\d{1,3})/);
  if (plain) return Math.max(0, Math.min(100, Number(plain[1])));
  if (/어둡게|좀\s*어둡/.test(text)) return 30;
  if (/밝게|좀\s*밝/.test(text)) return 85;
  return null;
}

function locationLight(location) {
  if (location === 'living_room') return 'living_room_light';
  if (location === 'bedroom' || location === 'room') return 'bedroom_light';
  return null;
}

function contextualDevice(text, context) {
  if (!/(그거|그것|아까|방금|다시)/.test(text)) return null;
  return context?.last_device && devices[context.last_device] ? context.last_device : null;
}

function genericActionForDevice(text, device) {
  if (!device) return null;
  if (/꺼|끄|off/i.test(text) && device.capabilities.includes('turn_off')) return 'turn_off';
  if (/켜|on/i.test(text) && device.capabilities.includes('turn_on')) return 'turn_on';
  if (/잠가|잠궈|lock/i.test(text) && device.capabilities.includes('lock')) return 'lock';
  if (/열어|unlock/i.test(text) && device.capabilities.includes('unlock')) return 'unlock';
  return null;
}

function clarificationFor(text) {
  const normalized = String(text || '').trim();
  const pc = devices.my_laptop?.state || {};
  const options = [];
  if (pc.last_target) {
    const recentApp = getApp(pc.last_target);
    if (recentApp) options.push({ label:`최근 사용 · ${recentApp.name}`, text:`${recentApp.name} 켜줘` });
    else if (SITES[pc.last_target]) options.push({ label:`최근 사용 · ${SITES[pc.last_target].name}`, text:`${SITES[pc.last_target].name} 열어줘` });
  }
  if (/(켜|열어|실행)/.test(normalized)) {
    for (const app of publicRegistry().filter((x)=>x.available && ['edge','vscode','roblox','calculator','notepad'].includes(x.id))) {
      if (options.some((x)=>x.text.includes(app.name))) continue;
      options.push({ label:app.name, text:`${app.name} 켜줘` });
      if (options.length >= 4) break;
    }
  }
  return {
    ok:false,
    needs_clarification:true,
    reason:'대상을 안전하게 확정하지 못했습니다.',
    question:/(켜|열어|실행)/.test(normalized)?'어떤 앱이나 기능을 열까요?':'어떤 대상을 말한 건지 조금 더 알려주세요.',
    options:options.slice(0,4),
    suggestion:'대상을 직접 말해 주세요. 예: “로블록스 켜줘”, “유튜브 열어줘”, “거실 불 꺼줘”',
  };
}

function interpret(text, context = {}) {
  const raw = String(text || '').trim();
  const normalized = raw.replace(/\s+/g, ' ');
  if (!normalized) return { ok: false, reason: '명령이 비어 있습니다.' };

  // Windows PC: 확장 가능한 앱 Registry / 검색 / 폴더 / 시스템 기능 / 작업 조합
  const workflowAliases = [
    { id:'coding', terms:['코딩 시작','코딩할게','개발 시작','개발할게'] },
    { id:'study', terms:['공부 시작','공부할게','공부 준비'] },
    { id:'gaming', terms:['게임 준비','게임할게','게임 시작'] },
  ];
  for (const item of workflowAliases) {
    if (item.terms.some((term)=>normalized.includes(term)) && WORKFLOWS[item.id]) {
      return { ok:true, confidence:0.94, action:{ device:'my_laptop', capability:'run_workflow', args:{ workflow:item.id }, source_text:raw }, explanation:`${WORKFLOWS[item.id].name} 작업 조합을 실행하는 명령으로 이해했습니다.`, context_used:[] };
    }
  }

  const searchPatterns = [
    { provider:'youtube', re:/(?:유튜브|youtube)(?:에서)?\s+(.+?)\s*(?:검색(?:해줘|해|)|찾아줘|찾아)/i },
    { provider:'naver', re:/(?:네이버|naver)(?:에서)?\s+(.+?)\s*(?:검색(?:해줘|해|)|찾아줘|찾아)/i },
    { provider:'google', re:/(?:구글|google)(?:에서)?\s+(.+?)\s*(?:검색(?:해줘|해|)|찾아줘|찾아)/i },
    { provider:'github', re:/(?:깃허브|github)(?:에서)?\s+(.+?)\s*(?:검색(?:해줘|해|)|찾아줘|찾아)/i },
  ];
  for (const item of searchPatterns) {
    const m = normalized.match(item.re);
    if (m && m[1] && SEARCH_PROVIDERS[item.provider]) {
      const query = m[1].trim();
      return { ok:true, confidence:0.97, action:{ device:'my_laptop', capability:'web_search', args:{ provider:item.provider, query }, source_text:raw }, explanation:`${item.provider}에서 “${query}”를 검색하는 명령으로 이해했습니다.`, context_used:[] };
    }
  }

  const siteAliases = {
    youtube:['유튜브','youtube'], naver:['네이버','naver'], google:['구글','google'],
    chatgpt:['챗지피티','chatgpt','chat gpt'], github:['깃허브','github'],
  };
  if (/(켜|열어|접속|보여|들어가)/.test(normalized)) {
    for (const [site, aliases] of Object.entries(siteAliases)) {
      if (SITES[site] && aliases.some((alias)=>normalized.toLowerCase().includes(alias))) {
        // 앱 이름과 사이트 이름이 겹치는 경우 앱이 명시되지 않았다면 사이트를 연다.
        if (site === 'google' || site === 'youtube' || site === 'naver' || site === 'chatgpt' || site === 'github') {
          return { ok:true, confidence:0.98, action:{ device:'my_laptop', capability:'open_site', args:{ site }, source_text:raw }, explanation:`${SITES[site].name}을 기본 브라우저에서 여는 명령으로 이해했습니다.`, context_used:[] };
        }
      }
    }
  }

  if (/(열어|보여|폴더|들어가)/.test(normalized)) {
    for (const [folder, item] of Object.entries(FOLDERS)) {
      const aliases = item.aliases || [item.name];
      if (aliases.some((alias)=>normalized.toLowerCase().includes(String(alias).toLowerCase()))) {
        return { ok:true, confidence:0.97, action:{ device:'my_laptop', capability:'open_folder', args:{ folder }, source_text:raw }, explanation:`${item.name}을 여는 명령으로 이해했습니다.`, context_used:[] };
      }
    }
    for (const [special_location, item] of Object.entries(SPECIAL_LOCATIONS)) {
      const aliases = item.aliases || [item.name];
      if (aliases.some((alias)=>normalized.toLowerCase().includes(String(alias).toLowerCase()))) {
        return { ok:true, confidence:0.97, action:{ device:'my_laptop', capability:'open_special_location', args:{ special_location }, source_text:raw }, explanation:`${item.name}을 여는 명령으로 이해했습니다.`, context_used:[] };
      }
    }
  }

  // 전원/세션 동작은 실제 작업을 끊을 수 있으므로 항상 사용자 확인이 필요하다.
  for (const [power_action, item] of Object.entries(POWER_ACTIONS)) {
    const aliases = item.aliases || [item.name];
    if (aliases.some((alias)=>normalized.toLowerCase().includes(String(alias).toLowerCase()))) {
      return { ok:true, confidence:0.99, action:{ device:'my_laptop', capability:'power_action', args:{ power_action }, source_text:raw }, explanation:`${item.name} 요청으로 이해했습니다. 실행 전 사용자 확인이 필요합니다.`, context_used:[] };
    }
  }

  if (/(켜|열어|실행|보여|설정|해줘|해)/.test(normalized)) {
    for (const [system_target, item] of Object.entries(SYSTEM_TARGETS)) {
      const aliases = item.aliases || [item.name];
      if (aliases.some((alias)=>normalized.toLowerCase().includes(String(alias).toLowerCase()))) {
        return { ok:true, confidence:0.98, action:{ device:'my_laptop', capability:'open_system', args:{ system_target }, source_text:raw }, explanation:`${item.name}을 여는 명령으로 이해했습니다.`, context_used:[] };
      }
    }
  }

  let app = matchAppFromText(normalized);
  const wantsClose = /(꺼줘|꺼|닫아줘|닫아|종료해줘|종료해)/.test(normalized);
  const wantsOpen = /(켜줘|켜|열어줘|열어|실행해줘|실행해|실행)/.test(normalized);
  if (!app && wantsClose && /(아까|방금|그거)/.test(normalized)) {
    const recent = devices.my_laptop?.state?.last_target;
    if (recent) app = getApp(recent);
  }
  if (app && wantsClose) {
    return { ok:true, confidence:0.96, action:{ device:'my_laptop', capability:'close_app', args:{ app:app.id }, source_text:raw }, explanation:`${app.name} 종료 요청으로 이해했습니다. 종료는 사용자 확인 후 실행됩니다.`, context_used:[] };
  }
  if (app && wantsOpen) {
    return { ok:true, confidence:0.99, action:{ device:'my_laptop', capability:'open_app', args:{ app:app.id }, source_text:raw }, explanation:`Windows 노트북에서 ${app.name}을 실행하는 명령으로 이해했습니다.`, context_used:[] };
  }

  const explicitLocation = pickLocation(normalized);
  const saysHere = /(여기|이 방|지금 있는 곳)/.test(normalized);
  const location = explicitLocation || (saysHere ? context.current_location : null);

  if (/(현관문|문)/.test(normalized)) {
    if (/잠가|잠궈|잠금|lock/i.test(normalized)) {
      return { ok:true, confidence:0.98, action:{ device:'front_door', capability:'lock', args:{}, source_text:raw }, explanation:'현관문을 잠그는 요청으로 이해했습니다. Reality Layer 정책 평가가 필요합니다.', context_used:[] };
    }
    if (/열어|잠금\s*해제|unlock/i.test(normalized)) {
      return { ok:true, confidence:0.98, action:{ device:'front_door', capability:'unlock', args:{}, source_text:raw }, explanation:'현관문 잠금 해제 요청으로 이해했습니다. 민감한 물리 행동이므로 Reality Layer 정책 평가가 필요합니다.', context_used:[] };
    }
  }

  const previousId = contextualDevice(normalized, context);
  if (previousId) {
    const previous = devices[previousId];
    const capability = genericActionForDevice(normalized, previous);
    if (capability) {
      return {
        ok: true,
        confidence: 0.9,
        action: { device: previous.id, capability, args: {}, source_text: raw },
        explanation: `최근 제어 대상인 ${previous.name}을(를) 가리키는 것으로 이해했습니다.`,
        context_used: ['last_device'],
      };
    }
  }

  if (/불|조명/.test(normalized)) {
    const brightness = findBrightness(normalized);
    const targetLocation = location || explicitLocation || context.current_location;
    if (!targetLocation) {
      return { ok: false, reason: '현재 위치가 확정되지 않아 어떤 조명을 제어할지 결정하지 않았습니다.', suggestion: '위치를 직접 말하거나 Context가 확정될 때까지 기다려줘.' };
    }
    const device = locationLight(targetLocation);
    if (!device) {
      return { ok: false, reason: '현재 위치에는 등록된 조명이 없어 대상을 확정할 수 없습니다.' };
    }
    const locationName = targetLocation === 'living_room' ? '거실' : '침실';
    const contextUsed = explicitLocation ? [] : ['current_location'];
    if (brightness !== null) {
      return {
        ok: true,
        confidence: explicitLocation ? 0.94 : 0.89,
        action: { device, capability: 'set_brightness', args: { brightness }, source_text: raw },
        explanation: `${locationName} 조명의 밝기를 ${brightness}%로 설정하는 명령으로 이해했습니다.`,
        context_used: contextUsed,
      };
    }
    if (/꺼|끄|off/i.test(normalized)) {
      return {
        ok: true,
        confidence: explicitLocation ? 0.98 : 0.92,
        action: { device, capability: 'turn_off', args: {}, source_text: raw },
        explanation: `${locationName} 조명을 끄는 명령으로 이해했습니다.`,
        context_used: contextUsed,
      };
    }
    if (/켜|on/i.test(normalized)) {
      return {
        ok: true,
        confidence: explicitLocation ? 0.98 : 0.92,
        action: { device, capability: 'turn_on', args: {}, source_text: raw },
        explanation: `${locationName} 조명을 켜는 명령으로 이해했습니다.`,
        context_used: contextUsed,
      };
    }
  }

  if (/디스플레이|화면|표시판|안내판/.test(normalized)) {
    if (/꺼|끄/.test(normalized)) {
      return { ok: true, confidence: 0.95, action: { device: 'room_display', capability: 'turn_off', args: {}, source_text: raw }, explanation: '안내 디스플레이를 끄는 명령으로 이해했습니다.', context_used: [] };
    }
    if (/켜/.test(normalized)) {
      return { ok: true, confidence: 0.95, action: { device: 'room_display', capability: 'turn_on', args: {}, source_text: raw }, explanation: '안내 디스플레이를 켜는 명령으로 이해했습니다.', context_used: [] };
    }
    const messageMatch = normalized.match(/(?:디스플레이|화면|표시판|안내판)(?:에|에다가)?\s*["“]?(.+?)["”]?(?:이라고|라고)?\s*(?:띄워|표시|써)/);
    if (messageMatch && messageMatch[1]) {
      const message = messageMatch[1].trim().replace(/["“”]/g, '');
      return { ok: true, confidence: 0.91, action: { device: 'room_display', capability: 'display_message', args: { message }, source_text: raw }, explanation: `안내 디스플레이에 “${message}” 메시지를 표시하는 명령으로 이해했습니다.`, context_used: [] };
    }
  }

  return clarificationFor(raw);
}

module.exports = { interpret, clarificationFor };
