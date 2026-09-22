const { capabilitiesForDevice } = require('./capability-model');
const devices = {
  my_laptop: {
    id: 'my_laptop',
    name: '내 Windows 노트북',
    type: 'windows_pc',
    location: 'room',
    adapter_id: 'windows_pc_v1',
    vendor: 'Windows',
    protocol: 'local-agent',
    interface_version: 'uag/0.1',
    capabilities: ['open_app', 'close_app', 'open_url', 'open_site', 'web_search', 'open_folder', 'open_special_location', 'open_system', 'power_action', 'run_workflow'],
    state: { status: 'ready', last_action: null, last_target: null, last_target_name: null },
  },
  living_room_light: {
    id: 'living_room_light',
    name: '거실 조명 A',
    type: 'light',
    location: 'living_room',
    adapter_id: 'virtual_light_alpha',
    vendor: 'Virtual Alpha',
    protocol: 'alpha-native-v1',
    interface_version: 'uag/0.1',
    capabilities: ['turn_on', 'turn_off', 'set_brightness'],
    state: { power: 'off', brightness: 70 },
  },
  bedroom_light: {
    id: 'bedroom_light',
    name: '침실 조명 B',
    type: 'light',
    location: 'bedroom',
    adapter_id: 'virtual_light_beta',
    vendor: 'Virtual Beta',
    protocol: 'beta-native-v2',
    interface_version: 'uag/0.1',
    capabilities: ['turn_on', 'turn_off', 'set_brightness'],
    state: { power: 'on', brightness: 55 },
  },
  front_door: {
    id: 'front_door',
    name: '현관문 (가상)',
    type: 'door',
    location: 'entrance',
    adapter_id: 'virtual_door_v1',
    vendor: 'Virtual Secure',
    protocol: 'secure-lock-native-v1',
    interface_version: 'uag/0.1',
    capabilities: ['lock', 'unlock'],
    state: { lock: 'locked', status: 'ready' },
  },
  room_display: {
    id: 'room_display',
    name: '안내 디스플레이',
    type: 'display',
    location: 'room',
    adapter_id: 'virtual_display_v1',
    vendor: 'Virtual Signage',
    protocol: 'signage-native-v1',
    interface_version: 'uag/0.1',
    capabilities: ['turn_on', 'turn_off', 'display_message'],
    state: { power: 'on', message: 'Reality Layer ready' },
  },
};

function publicDevices() {
  return Object.values(devices).map((d) => ({ ...d, capability_model_version:'reality-capability/1.0', capability_model:capabilitiesForDevice(d), state: { ...d.state } }));
}

function resetDeviceStates() {
  devices.my_laptop.state = { status: 'ready', last_action: null, last_target: null, last_target_name: null };
  devices.living_room_light.state = { power: 'off', brightness: 70 };
  devices.bedroom_light.state = { power: 'on', brightness: 55 };
  devices.front_door.state = { lock: 'locked', status: 'ready' };
  devices.room_display.state = { power: 'on', message: 'Reality Layer ready' };
}

module.exports = { devices, publicDevices, resetDeviceStates };
