'use strict';
/**
 * 读取 .env（不依赖 dotenv）
 * 支持：KEY=value、# 注释、引号包裹、单行内 \n 转义（方便把 PEM 私钥写在一行里）
 */

const fs = require('fs');
const path = require('path');

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const key = s.slice(0, i).trim();
    let val = s.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
      (val.startsWith("'") && val.endsWith("'") && val.length > 1)
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val.replace(/\\n/g, '\n');
  }
  return out;
}

/** 载入 app/.env，已存在的环境变量优先（便于部署平台注入） */
function loadEnv(file) {
  const target = file || path.join(__dirname, '..', '.env');
  const parsed = parseEnvFile(target);
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
  }
  return parsed;
}

module.exports = { loadEnv, parseEnvFile };
