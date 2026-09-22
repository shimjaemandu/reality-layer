function execute(device, capability) {
  let nativeCommand;
  if (capability === 'lock') {
    device.state.lock = 'locked';
    nativeCommand = { opcode: 'LOCK_SET', value: 1 };
  } else if (capability === 'unlock') {
    device.state.lock = 'unlocked';
    nativeCommand = { opcode: 'LOCK_SET', value: 0 };
  } else {
    throw new Error('지원되지 않는 Door 동작입니다.');
  }
  return {
    state: { ...device.state },
    native_trace: {
      adapter: device.adapter_id,
      protocol: device.protocol,
      translated_command: nativeCommand,
    },
  };
}
module.exports = { execute };
