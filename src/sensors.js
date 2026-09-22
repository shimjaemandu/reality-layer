const SENSOR_DEFS = {
  living_room_motion: {
    id: 'living_room_motion', name: '거실 움직임 센서', type: 'motion', location: 'living_room', reliability: 0.72, ttl_ms: 120000,
  },
  living_room_phone: {
    id: 'living_room_phone', name: '거실 휴대폰 근접 신호', type: 'device_presence', location: 'living_room', reliability: 0.92, ttl_ms: 180000,
  },
  bedroom_motion: {
    id: 'bedroom_motion', name: '침실 움직임 센서', type: 'motion', location: 'bedroom', reliability: 0.72, ttl_ms: 120000,
  },
  bedroom_pc_activity: {
    id: 'bedroom_pc_activity', name: '침실 PC 활동 신호', type: 'device_activity', location: 'bedroom', reliability: 0.84, ttl_ms: 180000,
  },
  entrance_motion: {
    id: 'entrance_motion', name: '현관 움직임 센서', type: 'motion', location: 'entrance', reliability: 0.68, ttl_ms: 60000,
  },
  room_presence: {
    id: 'room_presence', name: '방 재실 센서', type: 'presence', location: 'room', reliability: 0.8, ttl_ms: 150000,
  },
};

const sensors = Object.fromEntries(Object.entries(SENSOR_DEFS).map(([id, def]) => [id, {
  ...def,
  state: { detected: false, last_event_at: null },
}]));

function applySensorEvent(sensorId, detected, at = new Date()) {
  const sensor = sensors[sensorId];
  if (!sensor) throw new Error('등록되지 않은 센서입니다.');
  if (typeof detected !== 'boolean') throw new Error('센서 detected 값은 true/false여야 합니다.');
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) throw new Error('센서 이벤트 시간이 올바르지 않습니다.');

  sensor.state.detected = detected;
  sensor.state.last_event_at = date.toISOString();
  return { ...sensor, state: { ...sensor.state }, at: sensor.state.last_event_at };
}

function resetSensors() {
  for (const sensor of Object.values(sensors)) sensor.state = { detected: false, last_event_at: null };
}

function publicSensors() {
  return Object.values(sensors).map((sensor) => ({ ...sensor, state: { ...sensor.state } }));
}

module.exports = { sensors, applySensorEvent, resetSensors, publicSensors };
