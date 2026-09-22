const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const USER_APPS_FILE = path.join(ROOT, 'apps.local.json');
let startAppsCache = { at: 0, items: [] };

function envPaths(env = process.env) {
  return {
    pf: env.PROGRAMFILES || 'C:\\Program Files',
    pf86: env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
    local: env.LOCALAPPDATA || '',
    appData: env.APPDATA || '',
    user: env.USERPROFILE || '',
    pathEnv: env.PATH || env.Path || '',
    programData: env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData',
  };
}

function scanVersionedExecutable(baseDir, executable, fsImpl = fs) {
  if (!baseDir) return null;
  try {
    const dirs = fsImpl.readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const dir of dirs) {
      const candidate = path.win32.join(baseDir, dir, executable);
      if (fsImpl.existsSync(candidate)) return candidate;
    }
  } catch {}
  return null;
}

function findOnPath(executable, env = process.env, fsImpl = fs) {
  const raw = env.PATH || env.Path || '';
  for (const dir of String(raw).split(';').map((x)=>x.trim()).filter(Boolean)) {
    const candidate = path.win32.join(dir, executable);
    try { if (fsImpl.existsSync(candidate)) return candidate; } catch {}
  }
  return null;
}

function normalizeExecutableInput(raw, env = process.env) {
  let value = String(raw || '').trim();
  const quoted = value.match(/^"([^"]+?\.exe)"/i);
  if (quoted) value = quoted[1];
  else {
    const exeEnd = value.toLowerCase().indexOf('.exe');
    if (exeEnd >= 0) value = value.slice(0, exeEnd + 4);
  }
  value = value.replace(/^"|"$/g, '');
  value = value.replace(/%([^%]+)%/g, (_, key) => {
    const found = Object.keys(env).find((k)=>k.toLowerCase() === String(key).toLowerCase());
    return found ? env[found] : `%${key}%`;
  });
  if (/^[A-Za-z]:\//.test(value)) value = value.replace(/\//g, '\\');
  try { return path.win32.normalize(value); } catch { return value; }
}

function builtins(env = process.env, fsImpl = fs) {
  const { pf, pf86, local, appData, user, programData } = envPaths(env);
  const discord = scanVersionedExecutable(local && path.win32.join(local, 'Discord'), 'Discord.exe', fsImpl);
  const roblox = scanVersionedExecutable(local && path.win32.join(local, 'Roblox', 'Versions'), 'RobloxPlayerBeta.exe', fsImpl);
  const codeOnPath = findOnPath('Code.exe', env, fsImpl) || findOnPath('code.exe', env, fsImpl);
  const edgeOnPath = findOnPath('msedge.exe', env, fsImpl);
  return [
    { id:'chrome', name:'Google Chrome', aliases:['크롬','chrome'], paths:[path.win32.join(pf,'Google','Chrome','Application','chrome.exe'), path.win32.join(pf86,'Google','Chrome','Application','chrome.exe'), local && path.win32.join(local,'Google','Chrome','Application','chrome.exe')], process_names:['chrome.exe'] },
    { id:'edge', name:'Microsoft Edge', aliases:['엣지','edge','마이크로소프트 엣지'], paths:[local && path.win32.join(local,'Microsoft','Edge','Application','msedge.exe'), path.win32.join(pf86,'Microsoft','Edge','Application','msedge.exe'), path.win32.join(pf,'Microsoft','Edge','Application','msedge.exe'), edgeOnPath], process_names:['msedge.exe'] },
    { id:'calculator', name:'Windows 계산기', aliases:['계산기','calculator'], paths:['calc.exe'], process_names:['CalculatorApp.exe','calc.exe'] },
    { id:'notepad', name:'Windows 메모장', aliases:['메모장','notepad'], paths:['notepad.exe'], process_names:['notepad.exe'] },
    { id:'paint', name:'그림판', aliases:['그림판','paint','mspaint'], paths:['mspaint.exe'], process_names:['mspaint.exe'] },
    { id:'vscode', name:'Visual Studio Code', aliases:['vscode','vs code','비주얼 스튜디오 코드','비주얼 스튜디오 코드 에디터','코드 에디터'], paths:[local && path.win32.join(local,'Programs','Microsoft VS Code','Code.exe'), local && path.win32.join(local,'Programs','Microsoft VS Code Insiders','Code - Insiders.exe'), path.win32.join(pf,'Microsoft VS Code','Code.exe'), path.win32.join(pf86,'Microsoft VS Code','Code.exe'), user && path.win32.join(user,'scoop','apps','vscode','current','Code.exe'), local && path.win32.join(local,'Microsoft','WindowsApps','Code.exe'), programData && path.win32.join(programData,'chocolatey','bin','code.exe'), codeOnPath], process_names:['Code.exe'], start_names:['Visual Studio Code','Visual Studio Code - Insiders'] },
    { id:'discord', name:'Discord', aliases:['디스코드','discord'], paths:[discord, local && path.win32.join(local,'Discord','Discord.exe')], process_names:['Discord.exe'], start_names:['Discord'] },
    { id:'steam', name:'Steam', aliases:['스팀','steam'], paths:[path.win32.join(pf86,'Steam','steam.exe'), path.win32.join(pf,'Steam','steam.exe')], process_names:['steam.exe'], start_names:['Steam'] },
    { id:'spotify', name:'Spotify', aliases:['스포티파이','spotify'], paths:[appData && path.win32.join(appData,'Spotify','Spotify.exe'), local && path.win32.join(local,'Microsoft','WindowsApps','Spotify.exe')], process_names:['Spotify.exe'], start_names:['Spotify'] },
    { id:'kakaotalk', name:'KakaoTalk', aliases:['카카오톡','카톡','kakaotalk'], paths:[path.win32.join(pf86,'Kakao','KakaoTalk','KakaoTalk.exe'), path.win32.join(pf,'Kakao','KakaoTalk','KakaoTalk.exe')], process_names:['KakaoTalk.exe'], start_names:['카카오톡','KakaoTalk'] },
    { id:'roblox', name:'Roblox Player', aliases:['로블록스','roblox'], paths:[roblox], process_names:['RobloxPlayerBeta.exe'], start_names:['Roblox','Roblox Player'] },
  ].map((app) => ({ ...app, paths: app.paths.filter(Boolean) }));
}

function sanitizeUserApp(item, env = process.env) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(id)) return null;
  const name = String(item.name || id).trim().slice(0, 80);
  const aliases = Array.isArray(item.aliases) ? item.aliases.map((x)=>String(x).trim().toLowerCase()).filter(Boolean).slice(0,20) : [];
  const paths = Array.isArray(item.paths)
    ? item.paths.map((x)=>normalizeExecutableInput(x, env)).filter((p)=>/^[A-Za-z]:\\/.test(p) && /\.exe$/i.test(p)).slice(0,10)
    : [];
  const process_names = Array.isArray(item.process_names)
    ? item.process_names.map((x)=>String(x).trim()).filter((p)=>/^[A-Za-z0-9_. -]+\.exe$/i.test(p)).slice(0,10)
    : [];
  if (!paths.length) return null;
  return { id, name, aliases:[id, name.toLowerCase(), ...aliases], paths, process_names };
}

function loadUserApps(fsImpl = fs, env = process.env) {
  try {
    if (!fsImpl.existsSync(USER_APPS_FILE)) return [];
    const parsed = JSON.parse(fsImpl.readFileSync(USER_APPS_FILE, 'utf8'));
    return (Array.isArray(parsed.apps) ? parsed.apps : []).map((x)=>sanitizeUserApp(x, env)).filter(Boolean);
  } catch (error) {
    console.warn('apps.local.json을 읽지 못했습니다:', error.message);
    return [];
  }
}

function registry(options = {}) {
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  const map = new Map();
  for (const app of [...builtins(env, fsImpl), ...loadUserApps(fsImpl, env)]) map.set(app.id, app);
  return [...map.values()];
}

function getApp(appId, options = {}) {
  return registry(options).find((app)=>app.id === String(appId || '').trim().toLowerCase()) || null;
}

function safeSpawnSync(command, args, options = {}) {
  const impl = options.spawnSyncImpl || spawnSync;
  try {
    return impl(command, args, { encoding:'utf8', windowsHide:true, timeout:2500, maxBuffer:1024*1024 });
  } catch { return null; }
}

function findViaWhere(app, options = {}) {
  if ((options.platform || process.platform) !== 'win32') return null;
  const fsImpl = options.fsImpl || fs;
  const names = [...new Set([...(app.process_names || []), app.id === 'vscode' ? 'code.exe' : null, app.id === 'vscode' ? 'code.cmd' : null].filter(Boolean))];
  for (const name of names) {
    const result = safeSpawnSync('where.exe', [name], options);
    if (!result || result.status !== 0) continue;
    for (const line of String(result.stdout || '').split(/\r?\n/).map((x)=>x.trim()).filter(Boolean)) {
      if (/\.exe$/i.test(line)) {
        try { if (fsImpl.existsSync(line)) return line; } catch {}
      }
      if (app.id === 'vscode' && /\\bin\\code\.cmd$/i.test(line)) {
        const candidate = path.win32.normalize(path.win32.join(path.win32.dirname(line), '..', 'Code.exe'));
        try { if (fsImpl.existsSync(candidate)) return candidate; } catch {}
      }
    }
  }
  return null;
}

function listStartApps(options = {}) {
  if ((options.platform || process.platform) !== 'win32') return [];
  const now = Date.now();
  if (!options.noCache && now - startAppsCache.at < 30000) return startAppsCache.items;
  const script = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress";
  const result = safeSpawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], options);
  if (!result || result.status !== 0 || !String(result.stdout || '').trim()) return [];
  try {
    const parsed = JSON.parse(String(result.stdout).replace(/^\uFEFF/, '').trim());
    const items = (Array.isArray(parsed) ? parsed : [parsed]).filter((x)=>x && x.Name && x.AppID);
    startAppsCache = { at:now, items };
    return items;
  } catch { return []; }
}

function findStartApp(app, options = {}) {
  const targets = [app.name, ...(app.start_names || []), ...(app.aliases || [])]
    .map((x)=>String(x || '').trim().toLowerCase()).filter(Boolean);
  const items = listStartApps(options);
  const exact = items.find((item)=>targets.includes(String(item.Name).trim().toLowerCase()));
  if (exact) return exact;
  return items.find((item)=>{
    const name = String(item.Name).trim().toLowerCase();
    return targets.some((target)=>target.length >= 4 && (name.includes(target) || target.includes(name)));
  }) || null;
}

function discoverApp(appId, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const app = getApp(appId, options);
  if (!app) return null;
  for (const candidate of app.paths) {
    if (!candidate.includes('\\')) return { ...app, executable:candidate, launch_method:'command', discovered_by:'registry' };
    try { if (fsImpl.existsSync(candidate)) return { ...app, executable:candidate, launch_method:'executable', discovered_by:'known_path' }; } catch {}
  }
  const wherePath = findViaWhere(app, options);
  if (wherePath) return { ...app, executable:wherePath, launch_method:'executable', discovered_by:'where' };
  const startApp = findStartApp(app, options);
  if (startApp) return { ...app, shell_app_id:String(startApp.AppID), start_app_name:String(startApp.Name), launch_method:'start_app', discovered_by:'start_menu' };
  return null;
}

function resolveApp(appId, options = {}) { return discoverApp(appId, options); }

function matchAppFromText(text, options = {}) {
  const normalized = String(text || '').toLowerCase();
  const candidates = registry(options)
    .flatMap((app)=>[app.id, app.name.toLowerCase(), ...(app.aliases || [])].map((alias)=>({ app, alias:String(alias).toLowerCase() })))
    .filter((x)=>x.alias && normalized.includes(x.alias))
    .sort((a,b)=>b.alias.length-a.alias.length);
  return candidates[0]?.app || null;
}

function publicRegistry(options = {}) {
  const builtinIds = new Set(builtins(options.env || process.env, options.fsImpl || fs).map((x)=>x.id));
  return registry(options).map((app)=>{
    const resolved = resolveApp(app.id, options);
    return {
      id:app.id, name:app.name, aliases:app.aliases,
      available:Boolean(resolved), custom:!builtinIds.has(app.id),
      discovery:resolved ? { method:resolved.discovered_by, start_app_name:resolved.start_app_name || null } : null,
    };
  });
}

function saveUserApps(apps, fsImpl = fs, env = process.env) {
  const sanitized = (Array.isArray(apps) ? apps : []).map((x)=>sanitizeUserApp(x, env)).filter(Boolean);
  fsImpl.writeFileSync(USER_APPS_FILE, JSON.stringify({ apps:sanitized }, null, 2) + '\n', 'utf8');
  return sanitized;
}

function registerUserApp(input, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const env = options.env || process.env;
  const existing = loadUserApps(fsImpl, env);
  const normalizedPath = normalizeExecutableInput(input?.path, env);
  let candidate = sanitizeUserApp({
    id: input?.id,
    name: input?.name,
    aliases: input?.aliases,
    paths: [normalizedPath],
    process_names: input?.process_name ? [input.process_name] : [path.win32.basename(normalizedPath)],
  }, env);
  if (!candidate) throw new Error('앱 ID와 Windows .exe 전체 경로를 확인해 주세요.');
  let exe = candidate.paths[0];
  if ((options.platform || process.platform) === 'win32' && !fsImpl.existsSync(exe)) {
    const auto = discoverApp(candidate.id, { ...options, fsImpl, env });
    if (auto?.executable && auto.executable.includes('\\') && fsImpl.existsSync(auto.executable)) {
      exe = auto.executable;
      candidate = { ...candidate, paths:[exe], process_names:[path.win32.basename(exe)] };
    } else if (auto?.shell_app_id) {
      return { ...candidate, available:true, launch_method:'start_app', discovered_by:auto.discovered_by, start_app_name:auto.start_app_name, note:'입력한 경로는 없지만 Windows 시작 메뉴에서 앱을 찾아 등록 없이 실행할 수 있습니다.' };
    } else {
      throw new Error(`해당 .exe 파일을 찾지 못했습니다. 입력 경로: ${exe}. VS Code 같은 등록 앱은 이제 명령 실행 시 Windows 시작 메뉴까지 자동 탐색합니다.`);
    }
  }
  const merged = existing.filter((app)=>app.id !== candidate.id);
  merged.push(candidate);
  saveUserApps(merged, fsImpl, env);
  return { ...candidate, available:Boolean(resolveApp(candidate.id, { ...options, fsImpl, env })) };
}

module.exports = { USER_APPS_FILE, registry, getApp, resolveApp, discoverApp, matchAppFromText, publicRegistry, sanitizeUserApp, findOnPath, findViaWhere, findStartApp, normalizeExecutableInput, registerUserApp, saveUserApps };
