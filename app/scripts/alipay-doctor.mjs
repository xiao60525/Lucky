#!/usr/bin/env node
/**
 * 支付宝接入体检 / 配置向导
 * ---------------------------------------------------------------
 * 用法：
 *   node scripts/alipay-doctor.mjs              # 体检当前 .env
 *   node scripts/alipay-doctor.mjs --sandbox    # 体检并提示沙箱口径
 *
 * 它只读，不改任何文件，不联网，不打印任何私钥内容。
 * 检查项：
 *   1. 必填项是否齐全（APPID / 应用私钥 / 支付宝公钥 / 异步通知地址）
 *   2. 应用私钥是否能正常签名（PEM 是否合法、是否 RSA2 可用）
 *   3. 支付宝公钥是否能验签通过应用私钥的签名（判断是否「贴错成应用公钥」）
 *   4. APPID 形态、通知地址是否 https 且带 sharecode
 *   5. 需要粘贴到开放平台的「应用公钥」原文
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\n/g, '\n');
    }
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const env = { ...loadEnv(path.join(ROOT, '.env')), ...process.env };
const sandbox = String(env.ALIPAY_SANDBOX || '') === '1' || process.argv.includes('--sandbox');

const C = {
  ok: (s) => `\x1b[32m✓\x1b[0m ${s}`,
  no: (s) => `\x1b[31m✗\x1b[0m ${s}`,
  warn: (s) => `\x1b[33m!\x1b[0m ${s}`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const keys = { ok: 0, no: 0, warn: 0 };
const ok = (s) => (keys.ok++, console.log('  ' + C.ok(s)));
const bad = (s) => (keys.no++, console.log('  ' + C.no(s)));
const warn = (s) => (keys.warn++, console.log('  ' + C.warn(s)));

function readPem(p) {
  if (!p) return null;
  if (p.includes('-----BEGIN')) return p.replace(/\\n/g, '\n');
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  } catch {
    return null;
  }
}

console.log(C.bold('\n支付宝接入体检'));
console.log(C.dim(`  配置来源：${path.join(ROOT, '.env')}`));
console.log(C.dim(`  运行环境：${sandbox ? '沙箱 openapi.alipaydev.com' : '生产 openapi.alipay.com'}\n`));

// ── 1. APPID ────────────────────────────────────────────────
console.log(C.bold('1) 应用 APPID'));
const appId = (env.ALIPAY_APP_ID || '').trim();
if (!appId) {
  bad('ALIPAY_APP_ID 未填写');
  console.log(C.dim('     开放平台 → 控制台 → 我的应用 → 应用详情，形如 2021000000000000'));
} else if (!/^\d{16}$/.test(appId)) {
  warn(`ALIPAY_APP_ID = ${appId}（不是标准 16 位数字，请确认没复制错）`);
} else {
  ok(`ALIPAY_APP_ID = ${appId}`);
}

// ── 2. 应用私钥 ─────────────────────────────────────────────
console.log(C.bold('\n2) 应用私钥（签名用，绝不外泄）'));
const privRaw = env.ALIPAY_PRIVATE_KEY || env.ALIPAY_PRIVATE_KEY_PATH;
const privPem = readPem(privRaw);
let privKeyObj = null;
if (!privPem) {
  bad('没有找到应用私钥');
  console.log(C.dim('     先运行：node scripts/alipay-keys.js，会生成到 certs/'));
} else if (!/BEGIN (RSA )?PRIVATE KEY/.test(privPem)) {
  bad('私钥格式不对，应为 PKCS8（-----BEGIN PRIVATE KEY-----）或 PKCS1');
} else {
  try {
    privKeyObj = crypto.createPrivateKey(privPem);
    const probe = crypto.createSign('RSA-SHA256').update('ping', 'utf8').sign(privKeyObj, 'base64');
    const bits = privKeyObj.asymmetricKeyDetails?.modulusLength || 0;
    ok(`应用私钥可用（RSA ${bits} 位，RSA2 签名正常）`);
    if (bits && bits < 2048) warn('密钥长度小于 2048 位，支付宝只接受 2048 及以上');
    globalThis.__probe = probe;
  } catch (e) {
    bad(`私钥无法使用：${e.message}`);
  }
}

// ── 3. 支付宝公钥 ───────────────────────────────────────────
console.log(C.bold('\n3) 支付宝公钥（验签用）'));
const pubRaw = env.ALIPAY_PUBLIC_KEY || env.ALIPAY_PUBLIC_KEY_PATH;
const pubPem = readPem(pubRaw);
let pubKeyObj = null;
if (!pubPem) {
  bad('没有找到支付宝公钥');
  console.log(C.dim('     开放平台 → 应用详情 → 开发设置 → 接口加签方式 → 查看「支付宝公钥」'));
} else if (!/BEGIN PUBLIC KEY/.test(pubPem)) {
  bad('公钥格式不对，应为 -----BEGIN PUBLIC KEY-----');
} else {
  try {
    pubKeyObj = crypto.createPublicKey(pubPem);
    ok('支付宝公钥格式合法');
  } catch (e) {
    bad(`公钥无法解析：${e.message}`);
  }
}

// ── 4. 密钥是否配对（最容易踩的坑） ─────────────────────────
console.log(C.bold('\n4) 密钥配对检查（防止把「应用公钥」当成「支付宝公钥」）'));
if (privKeyObj && pubKeyObj && globalThis.__probe) {
  const paired = crypto.createVerify('RSA-SHA256').update('ping', 'utf8').verify(pubKeyObj, globalThis.__probe, 'base64');
  if (paired) {
    warn('当前公钥与你的应用私钥是同一对——这说明你填的是「应用公钥」');
    console.log(C.dim('     正确做法：应用公钥贴到开放平台；本项要填开放平台给的「支付宝公钥」，两者不同'));
  } else {
    ok('公钥与私钥不是同一对，符合预期（说明确实填的是支付宝公钥）');
  }
  // 本地 certs 里的应用公钥，用于比对
  const localPub = readPem('certs/alipay_app_public_key.pem');
  if (localPub) {
    const norm = (s) => s.replace(/\s|-----[^-]+-----/g, '');
    if (pubPem && norm(pubPem) === norm(localPub)) {
      bad('当前 ALIPAY_PUBLIC_KEY 就是本地生成的「应用公钥」文件，必须换成支付宝公钥');
    }
  }
} else {
  warn('密钥不齐，跳过配对检查');
}

// ── 5. 回调地址 ─────────────────────────────────────────────
console.log(C.bold('\n5) 异步通知 / 同步跳转地址'));
const notify = (env.ALIPAY_NOTIFY_URL || '').trim();
const ret = (env.ALIPAY_RETURN_URL || '').trim();
if (!notify) {
  bad('ALIPAY_NOTIFY_URL 未填写');
  console.log(C.dim('     必须是公网 https，且支付宝服务器要能直连到（不能是 localhost）'));
} else if (!/^https:\/\//.test(notify)) {
  bad(`ALIPAY_NOTIFY_URL 不是 https：${notify}`);
} else {
  ok(`异步通知：${notify}`);
  if (!/[?&]sharecode=/.test(notify)) {
    warn('地址没带 sharecode 参数，预览网关可能拒掉支付宝的回调（建议补 ?sharecode=xxx）');
  }
  if (/\/api\/notify\/alipay$/.test(notify.split('?')[0]) === false) {
    warn('路径不是 /api/notify/alipay，确认服务端有对应路由');
  }
}
if (!ret) {
  warn('ALIPAY_RETURN_URL 未填写（用户付完跳回的页面，建议填）');
} else {
  ok(`同步跳回：${ret}`);
}

// ── 6. 待办 ─────────────────────────────────────────────────
console.log(C.bold('\n6) 需要粘贴到开放平台的「应用公钥」'));
const appPub = readPem('certs/alipay_app_public_key.pem');
if (!appPub) {
  console.log(C.dim('  certs/alipay_app_public_key.pem 不存在，先运行 node scripts/alipay-keys.js'));
} else {
  console.log(C.dim('  开放平台 → 应用详情 → 开发设置 → 接口加签方式 → 设置/修改 → 公钥模式，粘贴下面整段：'));
  console.log('\n' + appPub.trim().split('\n').map((l) => '  ' + l).join('\n') + '\n');
}

console.log(C.bold('汇总'));
console.log(`  ${C.ok(`${keys.ok} 项通过`)}  ${keys.no ? C.no(`${keys.no} 项未通过`) : ''}  ${keys.warn ? C.warn(`${keys.warn} 项提醒`) : ''}\n`);

if (keys.no === 0) {
  console.log(C.bold('  下一步：'));
  console.log('    npm run test:alipay        本地跑签名/验签/通知幂等自测');
  console.log('    重启服务后访问 /api/payconfig，alipay.ready 应为 true');
  console.log('    用 1 分钱商品下一单，确认能跳转支付宝收银台\n');
} else {
  console.log(C.bold('  还有未通过项，按上面 ✗ 逐条处理后再跑一次本脚本。\n'));
}

process.exit(keys.no > 0 ? 1 : 0);
