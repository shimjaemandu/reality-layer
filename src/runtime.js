'use strict';
const fs = require('fs');
const path = require('path');
const live = process.env.REALITY_LIVE === '1';
// Real PC actions require an explicit live launch. Merely opening the demo cannot launch apps.
if (!live || process.platform !== 'win32') process.env.PC_ADAPTER_DRY_RUN = '1';
function localConfig() {
  const file = path.join(__dirname, '..', 'config.local.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('config.local.json 형식을 확인해 주세요.'); }
}
function runtimeStatus() {
  return { live, pc_live: live && process.platform === 'win32' && process.env.PC_ADAPTER_DRY_RUN !== '1', platform: process.platform };
}
module.exports = { live, localConfig, runtimeStatus };
