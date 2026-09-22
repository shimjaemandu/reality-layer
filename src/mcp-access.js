'use strict';
const crypto = require('crypto');

const configured = String(process.env.REALITY_MCP_TOKEN || '').trim();
const token = configured || crypto.randomBytes(32).toString('hex');

function check(req, port) {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host)) return 'MCP는 이 노트북의 localhost에서만 사용할 수 있습니다.';
  if (req.headers.origin && !allowedHosts.some((host) => req.headers.origin === `http://${host}`)) return '외부 사이트 Origin의 MCP 요청은 허용되지 않습니다.';
  if (req.headers['sec-fetch-site'] === 'cross-site') return '교차 사이트 MCP 요청은 허용되지 않습니다.';
  if (!['POST','DELETE'].includes(req.method)) return 'MCP endpoint는 POST와 세션 종료용 DELETE만 허용합니다.';
  if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) return 'MCP 요청은 application/json이어야 합니다.';
  const auth = String(req.headers.authorization || '');
  if (auth !== `Bearer ${token}`) return 'MCP Bearer token이 없거나 올바르지 않습니다.';
  return null;
}

function publicStatus(port = 3000) {
  return {
    endpoint: `http://127.0.0.1:${port}/mcp`,
    protocol_version: '2026-07-28',
    legacy_protocol_versions: ['2025-11-25','2025-06-18','2025-03-26','2024-11-05'],
    authentication: 'Authorization: Bearer <runtime token>',
    token_source: configured ? 'REALITY_MCP_TOKEN environment variable' : 'ephemeral runtime token',
    token_persisted: Boolean(configured),
  };
}

module.exports = { token, check, publicStatus };
