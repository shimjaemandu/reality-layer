'use strict';
const crypto=require('crypto');
const mcpAccess=require('./mcp-access');
const token=crypto.randomBytes(32).toString('hex');
function check(req, port) {
  if (String(req.url || '').split('?')[0] === '/mcp') return mcpAccess.check(req, port);
  const allowed=[`127.0.0.1:${port}`,`localhost:${port}`];
  if (!allowed.includes(req.headers.host)) return '이 앱은 해당 노트북의 localhost에서만 사용할 수 있어요.';
  if (req.headers.origin&&!allowed.some(host=>req.headers.origin===`http://${host}`)) return '다른 사이트에서 보낸 요청은 허용되지 않아요.';
  if (req.headers['sec-fetch-site']==='cross-site') return '다른 사이트에서 보낸 요청은 허용되지 않아요.';
  if (req.method!=='GET' && req.method!=='HEAD') {
    if (req.headers['x-reality-token']!==token) return '앱 연결이 만료됐어요. 화면을 새로고침해 주세요.';
    if (!req.headers['content-type']?.startsWith('application/json')) return 'JSON 요청만 사용할 수 있어요.';
  }
  return null;
}
module.exports={token,check};
