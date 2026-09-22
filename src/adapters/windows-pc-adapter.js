const { executePcAction } = require('../windows-pc');
const { spawn } = require('child_process');

function execute(device, capability, args = {}) {
  const launches = [];
  const result = executePcAction(capability, args, { spawnImpl(command, argv, options) {
    const child = spawn(command, argv, options);
    launches.push(new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(new Error('Windows에서 실행 요청을 시작하지 못했습니다. 앱 설치와 경로를 확인해 주세요.')));
    }));
    return child;
  }});
  if (launches.length) return Promise.all(launches).then(() => record(device, result));
  return record(device, result);
}

function record(device, result) {
  device.state.status = 'ready';
  device.state.last_action = result.action;
  device.state.last_target = result.target;
  device.state.last_target_name = result.target_name || result.target;
  return {
    state: { ...device.state },
    native_trace: {
      adapter: device.adapter_id,
      protocol: device.protocol,
      translated_command: { action: result.action, target: result.target },
      launched: result.launched,
      dry_run: result.dry_run,
      results: result.results || undefined,
    },
  };
}

module.exports = { execute };
