const INTERFACE_VERSION = 'uag/0.1';

function buildUnifiedCommand(device, capability, args = {}, sourceText = '') {
  if (!device) throw new Error('통합 명령을 만들 대상 기기가 없습니다.');
  if (device.interface_version !== INTERFACE_VERSION) {
    throw new Error(`지원하지 않는 기기 인터페이스 버전입니다: ${device.interface_version}`);
  }
  if (!device.capabilities.includes(capability)) {
    throw new Error('기기가 요청된 공통 동작을 지원하지 않습니다.');
  }
  return {
    schema: INTERFACE_VERSION,
    target: {
      device_id: device.id,
      device_type: device.type,
      adapter_id: device.adapter_id,
    },
    action: capability,
    parameters: { ...(args || {}) },
    source_text: String(sourceText || '').slice(0, 500),
  };
}

function publicInterfaceSpec() {
  return {
    version: INTERFACE_VERSION,
    envelope: {
      schema: INTERFACE_VERSION,
      target: { device_id: 'string', device_type: 'string', adapter_id: 'string' },
      action: 'capability string',
      parameters: 'object',
    },
    status: 'compatibility-layer',
    deprecated_as_core: true,
    rule: 'v1.5+ uses Typed Action IR as the internal core. UAG/0.1 remains only as a compatibility bridge for existing adapters.',
  };
}

module.exports = { INTERFACE_VERSION, buildUnifiedCommand, publicInterfaceSpec };
