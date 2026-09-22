function execute(device, capability, args = {}) {
  let nativeCommand;
  if (capability === 'turn_on') {
    device.state.power = 'on';
    nativeCommand = { op: 'display.power', value: true };
  } else if (capability === 'turn_off') {
    device.state.power = 'off';
    nativeCommand = { op: 'display.power', value: false };
  } else if (capability === 'display_message') {
    const message = String(args.message || '').trim().slice(0, 120);
    if (!message) throw new Error('표시할 메시지가 비어 있습니다.');
    device.state.power = 'on';
    device.state.message = message;
    nativeCommand = { op: 'signage.text.set', payload: { text: message } };
  } else {
    throw new Error('지원되지 않는 디스플레이 동작입니다.');
  }
  return { state: { ...device.state }, native_trace: { adapter: device.adapter_id, protocol: device.protocol, translated_command: nativeCommand } };
}
module.exports = { execute };
