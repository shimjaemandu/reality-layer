const adapters = {
  windows_pc_v1: require('./windows-pc-adapter'),
  virtual_light_alpha: require('./virtual-light-alpha'),
  virtual_light_beta: require('./virtual-light-beta'),
  virtual_display_v1: require('./virtual-display'),
  virtual_door_v1: require('./virtual-door'),
  home_assistant_light: require('./home-assistant-light'),
};

function executeThroughAdapter(device, capability, args = {}) {
  const adapter = adapters[device.adapter_id];
  if (!adapter) throw new Error(`등록되지 않은 Adapter입니다: ${device.adapter_id}`);
  return adapter.execute(device, capability, args);
}

function adapterSummary() {
  return Object.keys(adapters);
}

module.exports = { executeThroughAdapter, adapterSummary };
