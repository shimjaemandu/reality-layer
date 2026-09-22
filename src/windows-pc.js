const path = require('path');
const { spawn } = require('child_process');
const { getApp, resolveApp, publicRegistry } = require('./app-registry');

const SITES = {
  youtube: { name:'YouTube', url:'https://www.youtube.com/' },
  naver: { name:'Naver', url:'https://www.naver.com/' },
  google: { name:'Google', url:'https://www.google.com/' },
  chatgpt: { name:'ChatGPT', url:'https://chatgpt.com/' },
  github: { name:'GitHub', url:'https://github.com/' },
};

const SEARCH_PROVIDERS = {
  google: (q)=>`https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q)=>`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  naver: (q)=>`https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`,
  github: (q)=>`https://github.com/search?q=${encodeURIComponent(q)}`,
};

// Only curated, non-shell Windows surfaces are exposed to the AI.
// No PowerShell/cmd, registry editor, disk-management, security-disabling, or arbitrary commands.
const SYSTEM_TARGETS = {
  settings: { name:'Windows 설정', command:'explorer.exe', args:['ms-settings:'], aliases:['윈도우 설정','설정 앱','컴퓨터 설정'] },
  file_explorer: { name:'파일 탐색기', command:'explorer.exe', args:[], aliases:['파일 탐색기','탐색기'] },
  task_manager: { name:'작업 관리자', command:'taskmgr.exe', args:[], aliases:['작업 관리자','작업관리자'] },
  screenshot: { name:'화면 캡처', command:'explorer.exe', args:['ms-screenclip:'], aliases:['화면 캡처','스크린샷','캡처 도구'] },
  control_panel: { name:'제어판', command:'control.exe', args:[], aliases:['제어판'] },
  device_manager: { name:'장치 관리자', command:'devmgmt.msc', args:[], aliases:['장치 관리자','장치관리자'] },
  system_info: { name:'시스템 정보', command:'msinfo32.exe', args:[], aliases:['시스템 정보','시스템정보'] },
  resource_monitor: { name:'리소스 모니터', command:'resmon.exe', args:[], aliases:['리소스 모니터','리소스모니터'] },
  event_viewer: { name:'이벤트 뷰어', command:'eventvwr.msc', args:[], aliases:['이벤트 뷰어','이벤트뷰어'] },
  volume_mixer: { name:'볼륨 믹서', command:'sndvol.exe', args:[], aliases:['볼륨 믹서','볼륨믹서','소리 믹서'] },
  sound_settings: { name:'소리 설정', command:'explorer.exe', args:['ms-settings:sound'], aliases:['소리 설정','사운드 설정','오디오 설정'] },
  display_settings: { name:'디스플레이 설정', command:'explorer.exe', args:['ms-settings:display'], aliases:['디스플레이 설정','화면 설정','모니터 설정'] },
  graphics_settings: { name:'그래픽 설정', command:'explorer.exe', args:['ms-settings:display-advancedgraphics'], aliases:['그래픽 설정','그래픽 성능 설정'] },
  notifications: { name:'알림 설정', command:'explorer.exe', args:['ms-settings:notifications'], aliases:['알림 설정','알림설정'] },
  focus: { name:'집중 지원 설정', command:'explorer.exe', args:['ms-settings:quiethours'], aliases:['집중 모드 설정','집중 지원','방해 금지 설정'] },
  bluetooth: { name:'Bluetooth 설정', command:'explorer.exe', args:['ms-settings:bluetooth'], aliases:['블루투스 설정','bluetooth 설정'] },
  wifi: { name:'Wi-Fi 설정', command:'explorer.exe', args:['ms-settings:network-wifi'], aliases:['와이파이 설정','wi-fi 설정','wifi 설정'] },
  network_status: { name:'네트워크 상태', command:'explorer.exe', args:['ms-settings:network-status'], aliases:['네트워크 상태','인터넷 설정','네트워크 설정'] },
  ethernet: { name:'이더넷 설정', command:'explorer.exe', args:['ms-settings:network-ethernet'], aliases:['이더넷 설정','랜 설정'] },
  vpn: { name:'VPN 설정', command:'explorer.exe', args:['ms-settings:network-vpn'], aliases:['vpn 설정'] },
  proxy: { name:'프록시 설정', command:'explorer.exe', args:['ms-settings:network-proxy'], aliases:['프록시 설정'] },
  mobile_hotspot: { name:'모바일 핫스팟', command:'explorer.exe', args:['ms-settings:network-mobilehotspot'], aliases:['모바일 핫스팟','핫스팟 설정'] },
  printers: { name:'프린터 및 스캐너', command:'explorer.exe', args:['ms-settings:printers'], aliases:['프린터 설정','프린터 및 스캐너','스캐너 설정'] },
  mouse: { name:'마우스 설정', command:'explorer.exe', args:['ms-settings:mousetouchpad'], aliases:['마우스 설정','터치패드 설정'] },
  typing: { name:'키보드/입력 설정', command:'explorer.exe', args:['ms-settings:typing'], aliases:['키보드 설정','입력 설정','타이핑 설정'] },
  clipboard: { name:'클립보드 설정', command:'explorer.exe', args:['ms-settings:clipboard'], aliases:['클립보드 설정'] },
  personalization: { name:'개인 설정', command:'explorer.exe', args:['ms-settings:personalization'], aliases:['개인 설정','개인화 설정'] },
  background: { name:'배경 화면 설정', command:'explorer.exe', args:['ms-settings:personalization-background'], aliases:['배경 화면 설정','배경화면 설정','바탕화면 배경 설정'] },
  themes: { name:'테마 설정', command:'explorer.exe', args:['ms-settings:themes'], aliases:['테마 설정'] },
  lock_screen_settings: { name:'잠금 화면 설정', command:'explorer.exe', args:['ms-settings:lockscreen'], aliases:['잠금 화면 설정','잠금화면 설정'] },
  apps: { name:'설치된 앱', command:'explorer.exe', args:['ms-settings:appsfeatures'], aliases:['설치된 앱','앱 설정','프로그램 목록'] },
  default_apps: { name:'기본 앱', command:'explorer.exe', args:['ms-settings:defaultapps'], aliases:['기본 앱','기본앱 설정'] },
  startup_apps: { name:'시작 프로그램', command:'explorer.exe', args:['ms-settings:startupapps'], aliases:['시작 프로그램','시작프로그램 설정'] },
  storage: { name:'저장소 설정', command:'explorer.exe', args:['ms-settings:storagesense'], aliases:['저장소 설정','스토리지 설정','용량 설정'] },
  power: { name:'전원 및 배터리 설정', command:'explorer.exe', args:['ms-settings:powersleep'], aliases:['전원 설정','배터리 설정','전원 및 배터리'] },
  windows_update: { name:'Windows 업데이트', command:'explorer.exe', args:['ms-settings:windowsupdate'], aliases:['윈도우 업데이트','windows 업데이트','업데이트 설정'] },
  date_time: { name:'날짜 및 시간', command:'explorer.exe', args:['ms-settings:dateandtime'], aliases:['날짜 시간 설정','시간 설정','날짜 및 시간'] },
  language: { name:'언어 및 지역', command:'explorer.exe', args:['ms-settings:regionlanguage'], aliases:['언어 설정','지역 설정','언어 및 지역'] },
  accessibility: { name:'접근성 설정', command:'explorer.exe', args:['ms-settings:easeofaccess'], aliases:['접근성 설정','접근성'] },
  privacy: { name:'개인정보 설정', command:'explorer.exe', args:['ms-settings:privacy'], aliases:['개인정보 설정','프라이버시 설정'] },
  camera_privacy: { name:'카메라 개인정보 설정', command:'explorer.exe', args:['ms-settings:privacy-webcam'], aliases:['카메라 권한','카메라 개인정보','카메라 접근 설정'] },
  microphone_privacy: { name:'마이크 개인정보 설정', command:'explorer.exe', args:['ms-settings:privacy-microphone'], aliases:['마이크 권한','마이크 개인정보','마이크 접근 설정'] },
  windows_security: { name:'Windows 보안', command:'explorer.exe', args:['ms-settings:windowsdefender'], aliases:['윈도우 보안','windows 보안','보안 설정'] },
  about: { name:'PC 정보', command:'explorer.exe', args:['ms-settings:about'], aliases:['pc 정보','컴퓨터 정보','내 pc 정보','시스템 정보 설정'] },
  projection: { name:'화면 투영 설정', command:'explorer.exe', args:['ms-settings:project'], aliases:['화면 투영','프로젝션 설정','다른 화면 연결'] },
  on_screen_keyboard: { name:'화상 키보드', command:'osk.exe', args:[], aliases:['화상 키보드','온스크린 키보드'] },
  magnifier: { name:'돋보기', command:'magnify.exe', args:[], aliases:['돋보기'] },
  narrator: { name:'내레이터', command:'narrator.exe', args:[], aliases:['내레이터','화면 읽기'] },
  character_map: { name:'문자표', command:'charmap.exe', args:[], aliases:['문자표','문자 맵'] },
};

const POWER_ACTIONS = {
  lock: { name:'화면 잠금', command:'rundll32.exe', args:['user32.dll,LockWorkStation'], aliases:['화면 잠가','화면 잠금','컴퓨터 잠가','노트북 잠가'] },
  sleep: { name:'절전', command:'rundll32.exe', args:['powrprof.dll,SetSuspendState','0,1,0'], aliases:['절전 모드','절전해','잠자기 모드'] },
  hibernate: { name:'최대 절전', command:'shutdown.exe', args:['/h'], aliases:['최대 절전','최대절전'] },
  sign_out: { name:'로그아웃', command:'shutdown.exe', args:['/l'], aliases:['로그아웃','로그 아웃'] },
  restart: { name:'재시작', command:'shutdown.exe', args:['/r','/t','0'], aliases:['재시작','다시 시작','리부팅'] },
  shutdown: { name:'종료', command:'shutdown.exe', args:['/s','/t','0'], aliases:['컴퓨터 종료','노트북 종료','pc 종료','컴퓨터 꺼','노트북 꺼','pc 꺼'] },
};

const FOLDERS = {
  home: { name:'사용자 폴더', aliases:['사용자 폴더','내 폴더'], resolve:(env)=>env.USERPROFILE },
  desktop: { name:'바탕화면', aliases:['바탕화면','데스크톱'], resolve:(env)=>env.USERPROFILE && path.win32.join(env.USERPROFILE,'Desktop') },
  downloads: { name:'다운로드', aliases:['다운로드','다운로드 폴더'], resolve:(env)=>env.USERPROFILE && path.win32.join(env.USERPROFILE,'Downloads') },
  documents: { name:'문서', aliases:['문서','문서 폴더'], resolve:(env)=>env.USERPROFILE && path.win32.join(env.USERPROFILE,'Documents') },
  pictures: { name:'사진', aliases:['사진','사진 폴더','그림 폴더'], resolve:(env)=>env.USERPROFILE && path.win32.join(env.USERPROFILE,'Pictures') },
  music: { name:'음악', aliases:['음악 폴더','뮤직 폴더'], resolve:(env)=>env.USERPROFILE && path.win32.join(env.USERPROFILE,'Music') },
  videos: { name:'동영상', aliases:['동영상 폴더','비디오 폴더'], resolve:(env)=>env.USERPROFILE && path.win32.join(env.USERPROFILE,'Videos') },
  onedrive: { name:'OneDrive', aliases:['원드라이브','onedrive'], resolve:(env)=>env.OneDrive || env.ONEDRIVE },
};

const SPECIAL_LOCATIONS = {
  this_pc: { name:'내 PC', command:'explorer.exe', args:['shell:MyComputerFolder'], aliases:['내 pc','내 컴퓨터','this pc'] },
  recycle_bin: { name:'휴지통', command:'explorer.exe', args:['shell:RecycleBinFolder'], aliases:['휴지통'] },
  network: { name:'네트워크', command:'explorer.exe', args:['shell:NetworkPlacesFolder'], aliases:['네트워크 폴더','네트워크 위치'] },
  apps_folder: { name:'모든 앱', command:'explorer.exe', args:['shell:AppsFolder'], aliases:['모든 앱','앱 목록'] },
  quick_access: { name:'빠른 실행/홈', command:'explorer.exe', args:['shell:HomeFolder'], aliases:['빠른 실행','빠른 액세스','탐색기 홈'] },
};

const WORKFLOWS = {
  coding: { name:'코딩 모드', steps:[{ capability:'open_app', args:{ app:'vscode' } }, { capability:'open_site', args:{ site:'github' } }] },
  study: { name:'공부 모드', steps:[{ capability:'open_site', args:{ site:'chatgpt' } }, { capability:'open_site', args:{ site:'google' } }] },
  gaming: { name:'게임 준비', steps:[{ capability:'open_app', args:{ app:'steam' } }, { capability:'open_app', args:{ app:'discord' } }] },
};

function validateUrl(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 500) throw new Error('URL이 비어 있거나 너무 깁니다.');
  let url;
  try { url = new URL(value); } catch { throw new Error('올바른 URL이 아닙니다.'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('웹 주소는 http/https만 허용됩니다.');
  return url.toString();
}

function launch(command, args, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const dryRun = options.dryRun === true;
  if (dryRun) return { launched:true, dry_run:true, command, args };
  const child = spawnImpl(command, args, { detached:true, stdio:'ignore', windowsHide:false, shell:false });
  if (child && typeof child.unref === 'function') child.unref();
  return { launched:true, dry_run:false, command, args };
}

function ensureWindows(options = {}) {
  const platform = options.platform || process.platform;
  const dryRun = options.dryRun === true || process.env.PC_ADAPTER_DRY_RUN === '1';
  if (platform !== 'win32' && !dryRun) throw new Error('PC Adapter는 Windows에서만 실제 실행됩니다.');
  return dryRun;
}

function openRegisteredApp(appId, options = {}) {
  const dryRun = ensureWindows(options);
  const app = getApp(appId, options);
  if (!app) throw new Error('허용목록에 없는 앱입니다.');
  const resolved = resolveApp(app.id, options);
  if (!resolved && !dryRun) throw new Error(`${app.name}을 Windows에서 찾지 못했습니다. 연결 탭의 자동 찾기를 사용하거나 설치 상태를 확인해 주세요.`);
  if (resolved?.shell_app_id) {
    return { ...launch('explorer.exe', [`shell:AppsFolder\\${resolved.shell_app_id}`], { ...options, dryRun }), action:'open_app', target:app.id, target_name:app.name, discovery:resolved.discovered_by };
  }
  const command = resolved?.executable || app.paths[0] || `${app.id}.exe`;
  return { ...launch(command, [], { ...options, dryRun }), action:'open_app', target:app.id, target_name:app.name, discovery:resolved?.discovered_by };
}

function closeRegisteredApp(appId, options = {}) {
  const dryRun = ensureWindows(options);
  const app = getApp(appId, options);
  if (!app) throw new Error('허용목록에 없는 앱입니다.');
  const processName = app.process_names?.[0];
  if (!processName) throw new Error('이 앱은 안전한 종료 대상으로 등록되어 있지 않습니다.');
  return { ...launch('taskkill.exe', ['/IM', processName, '/T'], { ...options, dryRun }), action:'close_app', target:app.id, target_name:app.name };
}

function launchWeb(url, options = {}) {
  const dryRun = ensureWindows(options);
  const edge = resolveApp('edge', options);
  if (edge || dryRun) {
    return { ...launch(edge?.executable || 'msedge.exe', [url], { ...options, dryRun }), browser:'edge' };
  }
  return { ...launch('explorer.exe', [url], { ...options, dryRun }), browser:'default' };
}

function executePcAction(capability, args = {}, options = {}) {
  const dryRun = ensureWindows(options);

  if (capability === 'open_app') return openRegisteredApp(String(args.app || '').trim().toLowerCase(), { ...options, dryRun });
  if (capability === 'close_app') return closeRegisteredApp(String(args.app || '').trim().toLowerCase(), { ...options, dryRun });

  if (capability === 'open_url') {
    const url = validateUrl(args.url);
    return { ...launchWeb(url, { ...options, dryRun }), action:'open_url', target:url };
  }

  if (capability === 'open_site') {
    const siteId = String(args.site || '').trim().toLowerCase();
    const site = SITES[siteId];
    if (!site) throw new Error('등록되지 않은 사이트입니다.');
    return { ...launchWeb(site.url, { ...options, dryRun }), action:'open_site', target:siteId, target_name:site.name };
  }

  if (capability === 'web_search') {
    const provider = String(args.provider || '').trim().toLowerCase();
    const query = String(args.query || '').trim().slice(0,200);
    if (!SEARCH_PROVIDERS[provider]) throw new Error('등록되지 않은 검색 서비스입니다.');
    if (!query) throw new Error('검색어가 비어 있습니다.');
    const url = SEARCH_PROVIDERS[provider](query);
    return { ...launchWeb(url, { ...options, dryRun }), action:'web_search', target:provider, target_name:query };
  }

  if (capability === 'open_folder') {
    const folderId = String(args.folder || '').trim().toLowerCase();
    const folder = FOLDERS[folderId];
    if (!folder) throw new Error('등록되지 않은 폴더입니다.');
    const resolved = folder.resolve(options.env || process.env);
    if (!resolved) throw new Error('폴더 경로를 확인할 수 없습니다.');
    return { ...launch('explorer.exe', [resolved], { ...options, dryRun }), action:'open_folder', target:folderId, target_name:folder.name };
  }

  if (capability === 'open_special_location') {
    const targetId = String(args.special_location || '').trim().toLowerCase();
    const target = SPECIAL_LOCATIONS[targetId];
    if (!target) throw new Error('등록되지 않은 탐색기 위치입니다.');
    return { ...launch(target.command, target.args, { ...options, dryRun }), action:'open_special_location', target:targetId, target_name:target.name };
  }

  if (capability === 'open_system') {
    const targetId = String(args.system_target || '').trim().toLowerCase();
    const target = SYSTEM_TARGETS[targetId];
    if (!target) throw new Error('등록되지 않은 Windows 기능입니다.');
    return { ...launch(target.command, target.args, { ...options, dryRun }), action:'open_system', target:targetId, target_name:target.name };
  }

  if (capability === 'power_action') {
    const actionId = String(args.power_action || '').trim().toLowerCase();
    const action = POWER_ACTIONS[actionId];
    if (!action) throw new Error('등록되지 않은 전원 동작입니다.');
    return { ...launch(action.command, action.args, { ...options, dryRun }), action:'power_action', target:actionId, target_name:action.name };
  }

  if (capability === 'run_workflow') {
    const workflowId = String(args.workflow || '').trim().toLowerCase();
    const workflow = WORKFLOWS[workflowId];
    if (!workflow) throw new Error('등록되지 않은 작업 조합입니다.');
    const results = [];
    for (const step of workflow.steps) {
      try { results.push({ ok:true, ...executePcAction(step.capability, step.args, { ...options, dryRun }) }); }
      catch (error) { results.push({ ok:false, action:step.capability, error:error.message }); }
    }
    if (!results.some((r)=>r.ok)) throw new Error(`${workflow.name}에서 실행 가능한 항목을 찾지 못했습니다.`);
    return { launched:true, dry_run:dryRun, action:'run_workflow', target:workflowId, target_name:workflow.name, results };
  }

  throw new Error('PC Adapter가 지원하지 않는 동작입니다.');
}

function publicPcRegistry(options = {}) {
  return {
    apps: publicRegistry(options),
    sites: Object.entries(SITES).map(([id,x])=>({ id, name:x.name })),
    search_providers: Object.keys(SEARCH_PROVIDERS),
    folders: Object.entries(FOLDERS).map(([id,x])=>({ id, name:x.name })),
    special_locations: Object.entries(SPECIAL_LOCATIONS).map(([id,x])=>({ id, name:x.name })),
    system_targets: Object.entries(SYSTEM_TARGETS).map(([id,x])=>({ id, name:x.name })),
    power_actions: Object.entries(POWER_ACTIONS).map(([id,x])=>({ id, name:x.name, requires_confirmation:true })),
    workflows: Object.entries(WORKFLOWS).map(([id,x])=>({ id, name:x.name })),
    blocked_categories: ['임의 PowerShell/cmd 명령', '레지스트리 자동 수정', '디스크/파티션 자동 변경', '보안 기능 비활성화', '임의 파일 삭제', '임의 실행 파일 실행'],
  };
}

module.exports = {
  SITES, SEARCH_PROVIDERS, SYSTEM_TARGETS, POWER_ACTIONS, FOLDERS, SPECIAL_LOCATIONS, WORKFLOWS,
  validateUrl, executePcAction, publicPcRegistry,
};
