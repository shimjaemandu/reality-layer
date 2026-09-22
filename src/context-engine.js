const LOCATION_NAMES = {
  living_room: '거실',
  bedroom: '침실',
  entrance: '현관',
  room: '방',
};

const RESOLVE_THRESHOLD = 0.6;
const MARGIN_THRESHOLD = 0.12;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function freshness(lastEventAt, ttlMs, nowMs) {
  if (!lastEventAt) return 0;
  const at = Date.parse(lastEventAt);
  if (!Number.isFinite(at)) return 0;
  const age = Math.max(0, nowMs - at);
  if (age >= ttlMs) return 0;
  return 1 - age / ttlMs;
}

function combine(existing, signal) {
  // Independent positive evidence: 0.7 + 0.7 does not become 1.4.
  return 1 - ((1 - clamp01(existing)) * (1 - clamp01(signal)));
}

function inferLocation(sensorList, nowMs = Date.now()) {
  const scores = Object.fromEntries(Object.keys(LOCATION_NAMES).map((location) => [location, 0]));
  const evidence = [];

  for (const sensor of sensorList || []) {
    if (!sensor?.state?.detected) continue;
    const ttlMs = Math.max(1000, Number(sensor.ttl_ms) || 120000);
    const fresh = freshness(sensor.state.last_event_at, ttlMs, nowMs);
    if (fresh <= 0) continue;
    const reliability = clamp01(sensor.reliability ?? 0.5);
    const signal = clamp01(reliability * fresh);
    if (!Object.prototype.hasOwnProperty.call(scores, sensor.location)) continue;
    scores[sensor.location] = combine(scores[sensor.location], signal);
    evidence.push({
      sensor_id: sensor.id,
      sensor_name: sensor.name,
      location: sensor.location,
      reliability,
      freshness: Number(fresh.toFixed(4)),
      contribution: Number(signal.toFixed(4)),
      last_event_at: sensor.state.last_event_at,
    });
  }

  const ranking = Object.entries(scores)
    .map(([location, score]) => ({ location, name: LOCATION_NAMES[location], score: Number(score.toFixed(4)) }))
    .sort((a, b) => b.score - a.score);

  const top = ranking[0];
  const second = ranking[1];
  const margin = Number(((top?.score || 0) - (second?.score || 0)).toFixed(4));
  let status = 'insufficient';
  let resolvedLocation = null;
  let reason = '활성 센서 증거가 부족해 현재 위치를 확정하지 않았습니다.';

  if ((top?.score || 0) >= RESOLVE_THRESHOLD) {
    if ((second?.score || 0) > 0 && margin < MARGIN_THRESHOLD) {
      status = 'ambiguous';
      reason = `${top.name}와 ${second.name}의 센서 증거가 비슷해 위치를 확정하지 않았습니다.`;
    } else {
      status = 'resolved';
      resolvedLocation = top.location;
      reason = `${top.name}의 센서 증거가 가장 강하고 다른 위치와 충분한 차이가 있어 확정했습니다.`;
    }
  }

  return {
    status,
    location: resolvedLocation,
    candidate: (top?.score || 0) > 0 ? top.location : null,
    confidence: top?.score || 0,
    margin,
    scores: ranking,
    evidence: evidence.sort((a, b) => b.contribution - a.contribution),
    reason,
    thresholds: { resolve: RESOLVE_THRESHOLD, margin: MARGIN_THRESHOLD },
    evaluated_at: new Date(nowMs).toISOString(),
  };
}

module.exports = { inferLocation, LOCATION_NAMES, RESOLVE_THRESHOLD, MARGIN_THRESHOLD };
