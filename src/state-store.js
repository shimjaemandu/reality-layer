'use strict';
const fs = require('fs');
const path = require('path');
const { devices } = require('./devices');
const { sensors } = require('./sensors');
const { actors, spaces } = require('./device-graph');

const STATE_STORE_VERSION = 'reality-state/1.6';
const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'reality-state.json');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso() { return new Date().toISOString(); }
function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function defaultActors() {
  const at = nowIso();
  return {
    owner: { present:true, location:'room', source:'bootstrap', confidence:1, updated_at:at },
    family: { present:false, location:null, source:'simulation', confidence:0, updated_at:null },
    guest: { present:false, location:null, source:'simulation', confidence:0, updated_at:null },
  };
}

function runtimeDeviceStates() {
  const out = {};
  for (const device of Object.values(devices)) out[device.id] = { state:clone(device.state || {}), updated_at:null, source:'runtime' };
  return out;
}
function runtimeSensorStates() {
  const out = {};
  for (const sensor of Object.values(sensors)) out[sensor.id] = { state:clone(sensor.state || {}), updated_at:sensor.state?.last_event_at || null, source:'runtime' };
  return out;
}
function defaultStore() {
  return { version:STATE_STORE_VERSION, actors:defaultActors(), devices:runtimeDeviceStates(), sensors:runtimeSensorStates(), revision:0, updated_at:nowIso() };
}
function ensureDir() { fs.mkdirSync(path.dirname(STATE_FILE), { recursive:true }); }
function ensureFile() { ensureDir(); if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, JSON.stringify(defaultStore(), null, 2) + '\n'); }

function sanitizeActor(raw = {}) {
  const present = raw.present === true;
  const validLocation = present && raw.location && spaces[raw.location] && raw.location !== 'home' ? raw.location : null;
  return {
    present,
    location:validLocation,
    source:typeof raw.source === 'string' ? raw.source.slice(0, 40) : 'simulation',
    confidence:present && validLocation ? clamp01(raw.confidence ?? 1) : 0,
    updated_at:typeof raw.updated_at === 'string' ? raw.updated_at : null,
  };
}
function sanitizeEntry(raw = {}, fallbackState = {}) {
  return {
    state:raw.state && typeof raw.state === 'object' && !Array.isArray(raw.state) ? clone(raw.state) : clone(fallbackState),
    updated_at:typeof raw.updated_at === 'string' ? raw.updated_at : null,
    source:typeof raw.source === 'string' ? raw.source.slice(0, 40) : 'runtime',
  };
}
function normalize(raw = {}) {
  const out = { version:STATE_STORE_VERSION, actors:{}, devices:{}, sensors:{}, revision:Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0, updated_at:typeof raw.updated_at === 'string' ? raw.updated_at : nowIso() };
  const defaults = defaultActors();
  for (const id of Object.keys(actors)) out.actors[id] = sanitizeActor(raw.actors?.[id] || defaults[id]);
  for (const device of Object.values(devices)) out.devices[device.id] = sanitizeEntry(raw.devices?.[device.id], device.state || {});
  for (const sensor of Object.values(sensors)) out.sensors[sensor.id] = sanitizeEntry(raw.sensors?.[sensor.id], sensor.state || {});
  return out;
}
function readStore() { ensureFile(); try { return normalize(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch { return defaultStore(); } }
function writeStore(store, { bump=true } = {}) {
  const safe = normalize(store);
  if (bump) safe.revision += 1;
  safe.updated_at = nowIso();
  ensureDir(); fs.writeFileSync(STATE_FILE, JSON.stringify(safe, null, 2) + '\n');
  return safe;
}

function syncRuntimeState() {
  const store = readStore();
  let changed = false;
  for (const device of Object.values(devices)) {
    const current = store.devices[device.id] || { state:{}, updated_at:null, source:'runtime' };
    const nextState = clone(device.state || {});
    if (!same(current.state, nextState)) {
      store.devices[device.id] = { state:nextState, updated_at:nowIso(), source:'runtime' };
      changed = true;
    }
  }
  for (const sensor of Object.values(sensors)) {
    const current = store.sensors[sensor.id] || { state:{}, updated_at:null, source:'runtime' };
    const nextState = clone(sensor.state || {});
    if (!same(current.state, nextState)) {
      store.sensors[sensor.id] = { state:nextState, updated_at:sensor.state?.last_event_at || nowIso(), source:'runtime' };
      changed = true;
    }
  }
  return changed ? writeStore(store) : store;
}

function getStateStore({ syncRuntime=true } = {}) { return syncRuntime ? syncRuntimeState() : readStore(); }
function getActorState(actorId) { const store=getStateStore(); return store.actors[actorId] ? clone(store.actors[actorId]) : null; }
function getDeviceState(deviceId) { const store=getStateStore(); return store.devices[deviceId] ? clone(store.devices[deviceId]) : null; }
function getSensorState(sensorId) { const store=getStateStore(); return store.sensors[sensorId] ? clone(store.sensors[sensorId]) : null; }

function setActorState(actorId, { present, location=null, source='simulation', confidence=1 } = {}) {
  if (!actors[actorId]) throw new Error('등록되지 않은 Actor입니다.');
  if (typeof present !== 'boolean') throw new Error('present 값은 true/false여야 합니다.');
  if (present && (!location || !spaces[location] || location === 'home')) throw new Error('재실 Actor에는 유효한 공간 location이 필요합니다.');
  const store = getStateStore();
  const current = store.actors[actorId] || null;
  const candidate = sanitizeActor({ present, location, source, confidence, updated_at:current?.updated_at || null });
  const stableCurrent = current ? { present:current.present, location:current.location, source:current.source, confidence:current.confidence } : null;
  const stableCandidate = { present:candidate.present, location:candidate.location, source:candidate.source, confidence:candidate.confidence };
  if (same(stableCurrent, stableCandidate)) return clone(current);
  candidate.updated_at = nowIso();
  store.actors[actorId] = candidate;
  writeStore(store);
  return clone(candidate);
}
function syncDeviceState(deviceId, state = devices[deviceId]?.state, source='adapter') {
  if (!devices[deviceId]) throw new Error('등록되지 않은 Device입니다.');
  const store = getStateStore({syncRuntime:false});
  const nextState = clone(state || {});
  store.devices[deviceId] = { state:nextState, updated_at:nowIso(), source };
  writeStore(store);
  return clone(store.devices[deviceId]);
}
function syncSensorState(sensorId, state = sensors[sensorId]?.state, source='sensor') {
  if (!sensors[sensorId]) throw new Error('등록되지 않은 Sensor입니다.');
  const store = getStateStore({syncRuntime:false});
  store.sensors[sensorId] = { state:clone(state || {}), updated_at:state?.last_event_at || nowIso(), source };
  writeStore(store);
  return clone(store.sensors[sensorId]);
}
function resetActorStates() {
  const store = getStateStore({syncRuntime:false});
  store.actors = defaultActors();
  return writeStore(store).actors;
}
function resetStateStore() { const store=defaultStore(); writeStore(store,{bump:false}); return getStateStore({syncRuntime:false}); }

function publicStateStore() {
  const store = getStateStore();
  return {
    version:STATE_STORE_VERSION,
    layer:'current-state',
    revision:store.revision,
    updated_at:store.updated_at,
    actors:clone(store.actors),
    devices:clone(store.devices),
    sensors:clone(store.sensors),
    principle:'State Store contains the latest known mutable values only. It does not own topology or historical event history.',
  };
}

module.exports = {
  STATE_STORE_VERSION,
  getStateStore,
  publicStateStore,
  getActorState,
  getDeviceState,
  getSensorState,
  setActorState,
  syncDeviceState,
  syncSensorState,
  syncRuntimeState,
  resetActorStates,
  resetStateStore,
};
