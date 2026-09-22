function execute(device, capability, args = {}) {
  let nativeCommand;
  if (capability === 'turn_on') {
    device.state.power = 'on';
    nativeCommand = { power: 1 };
  } else if (capability === 'turn_off') {
    device.state.power = 'off';
    nativeCommand = { power: 0 };
  } else if (capability === 'set_brightness') {
    const brightness = Number(args.brightness);
    if (!Number.isFinite(brightness) || brightness < 0 || brightness > 100) throw new Error('밝기는 0~100 사이여야 합니다.');
    device.state.brightness = Math.round(brightness);
    device.state.power = brightness === 0 ? 'off' : 'on';
    nativeCommand = { level_255: Math.round((device.state.brightness / 100) * 255) };
  } else {
    throw new Error('지원되지 않는 Beta 조명 동작입니다.');
  }
  return { state: { ...device.state }, native_trace: { adapter: device.adapter_id, protocol: device.protocol, translated_command: nativeCommand } };
}
module.exports = { execute };
