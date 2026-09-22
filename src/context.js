const fs = require('fs');
const path = require('path');
const { devices } = require('./devices');
const { inferLocation, LOCATION_NAMES } = require('./context-engine');

const ROOT = path.join(__dirname, '..');
const CONTEXT_FILE = path.join(ROOT, 'data', 'context.json');
const ALLOWED_LOCATIONS = Object.keys(LOCATION_NAMES);
const ALLOWED_SOURCES = ['none', 'manual', 'context_engine'];
const ALLOWED_STATUSES = ['insufficient', 'ambiguous', 'resolved', 'manual'];

const DEFAULT_CONTEXT = {
  current_location: null,
  current_location_candidate: null,
  current_location_source: 'none',
  current_location_confidence: 0,
  current_location_status: 'insufficient',
  manual_location_override: false,
  context_reason: '아직 위치 증거가 없습니다.',
  location_scores: [],
  evidence: [],
  context_evaluated_at: null,
  last_sensor: null,
  last_sensor_event_at: null,
  last_device: null,
  last_capability: null,
  last_action_at: null,
};

function sanitize(raw = {}) {
  const currentLocation = ALLOWED_LOCATIONS.includes(raw.current_location) ? raw.current_location : null;
  const candidate = ALLOWED_LOCATIONS.includes(raw.current_location_candidate) ? raw.current_location_candidate : null;
  const lastDevice = raw.last_device && devices[raw.last_device] ? raw.last_device : null;
  const lastCapability = lastDevice && devices[lastDevice].capabilities.includes(raw.last_capability) ? raw.last_capability : null;
  const source = ALLOWED_SOURCES.includes(raw.current_location_source) ? raw.current_location_source : 'none';
  const status = ALLOWED_STATUSES.includes(raw.current_location_status) ? raw.current_location_status : 'insufficient';
  const confidence = Number(raw.current_location_confidence);
  return {
    current_location: currentLocation,
    current_location_candidate: candidate,
    current_location_source: source,
    current_location_confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    current_location_status: status,
    manual_location_override: raw.manual_location_override === true,
    context_reason: typeof raw.context_reason === 'string' ? raw.context_reason.slice(0, 300) : DEFAULT_CONTEXT.context_reason,
    location_scores: Array.isArray(raw.location_scores) ? raw.location_scores.slice(0, 8) : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence.slice(0, 12) : [],
    context_evaluated_at: typeof raw.context_evaluated_at === 'string' ? raw.context_evaluated_at : null,
    last_sensor: typeof raw.last_sensor === 'string' ? raw.last_sensor : null,
    last_sensor_event_at: typeof raw.last_sensor_event_at === 'string' ? raw.last_sensor_event_at : null,
    last_device: lastDevice,
    last_capability: lastCapability,
    last_action_at: typeof raw.last_action_at === 'string' ? raw.last_action_at : null,
  };
}

function ensureFile() {
  if (!fs.existsSync(CONTEXT_FILE)) fs.writeFileSync(CONTEXT_FILE, JSON.stringify(DEFAULT_CONTEXT, null, 2) + '\n');
}

function getContext() {
  ensureFile();
  try { return sanitize(JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8'))); }
  catch { return { ...DEFAULT_CONTEXT }; }
}

function saveContext(context) {
  const safe = sanitize(context);
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(safe, null, 2) + '\n');
  return safe;
}

function setCurrentLocation(location) {
  if (!ALLOWED_LOCATIONS.includes(location)) throw new Error('지원하지 않는 위치입니다.');
  const context = getContext();
  context.current_location = location;
  context.current_location_candidate = location;
  context.current_location_source = 'manual';
  context.current_location_confidence = 1;
  context.current_location_status = 'manual';
  context.manual_location_override = true;
  context.context_reason = '디버그용 수동 위치가 자동 추론보다 우선 적용되고 있습니다.';
  return saveContext(context);
}

function updateContextFromSensors(sensorList, lastSensorId = null, nowMs = Date.now()) {
  const context = getContext();
  const inference = inferLocation(sensorList, nowMs);
  if (lastSensorId) {
    context.last_sensor = lastSensorId;
    context.last_sensor_event_at = new Date(nowMs).toISOString();
  }

  context.current_location_candidate = inference.candidate;
  context.location_scores = inference.scores;
  context.evidence = inference.evidence;
  context.context_evaluated_at = inference.evaluated_at;

  if (!context.manual_location_override) {
    context.current_location = inference.location;
    context.current_location_source = inference.status === 'resolved' ? 'context_engine' : 'none';
    context.current_location_confidence = inference.confidence;
    context.current_location_status = inference.status;
    context.context_reason = inference.reason;
  } else {
    context.context_reason = `수동 위치가 적용 중입니다. 자동 추론 후보: ${inference.candidate ? LOCATION_NAMES[inference.candidate] : '없음'} (${Math.round(inference.confidence * 100)}%).`;
  }
  return saveContext(context);
}

function clearManualOverride(sensorList, nowMs = Date.now()) {
  const context = getContext();
  context.manual_location_override = false;
  saveContext(context);
  return updateContextFromSensors(sensorList, null, nowMs);
}

function rememberAction(deviceId, capability) {
  const context = getContext();
  if (devices[deviceId]) {
    context.last_device = deviceId;
    context.last_capability = devices[deviceId].capabilities.includes(capability) ? capability : null;
    context.last_action_at = new Date().toISOString();
  }
  return saveContext(context);
}

function resetContext() { return saveContext({ ...DEFAULT_CONTEXT }); }

function publicContext() {
  const context = getContext();
  return {
    ...context,
    current_location_name: context.current_location ? LOCATION_NAMES[context.current_location] : '확정 안 됨',
    current_location_candidate_name: context.current_location_candidate ? LOCATION_NAMES[context.current_location_candidate] : '없음',
    current_location_source_name: { none: '미확정', manual: '수동', context_engine: 'Context Engine' }[context.current_location_source],
    current_location_status_name: { insufficient: '증거 부족', ambiguous: '충돌/모호', resolved: '확정', manual: '수동 고정' }[context.current_location_status],
    last_device_name: context.last_device ? devices[context.last_device]?.name || null : null,
  };
}

module.exports = {
  ALLOWED_LOCATIONS,
  getContext,
  setCurrentLocation,
  updateContextFromSensors,
  clearManualOverride,
  rememberAction,
  resetContext,
  publicContext,
};
