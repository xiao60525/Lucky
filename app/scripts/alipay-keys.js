'use strict';
/**
 * 支付宝 RSA2 密钥生成工具
 * ---------------------------------------------------------------
 * 用法：
 *   node scripts/alipay-keys.js
 *
 * 产出（certs/ 目录）：
 *   alipay_app_private_key.pem   应用私钥（PKCS8），【保密】，只填到 .env
 *   alipay_app_public_key.pem    应用公钥，填到支付宝开放平台
 *   alipay_test_public_key.pem   仅本地测试用的模拟「支付宝公钥」
 *
 * 接入步骤：
 *   1. 运行本脚本，复制 alipay_app_public_key.pem 的内容
 *   2. 支付宝开放平台 → 控制台 → 你的应用 → 开发设置 → 接口加签方式
 *      → 选「公钥」模式 → 把应用公钥粘贴进去 → 保存
 *   3. 保存后页面会显示「支付宝公钥」，把它复制到 .env 的 ALIPAY_PUBLIC_KEY
 *   4. 应用私钥内容填到 .env 的 ALIPAY_PRIVATE_KEY
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const outDir = path.join(__dirname, '..', 'certs');
fs.mkdirSync(outDir, { recursive: true });

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// 模拟「支付宝侧」的密钥对，仅用于本地联调验签逻辑
const mock = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const files = [
  ['alipay_app_private_key.pem', privateKey, '应用私钥（保密，填 .env 的 ALIPAY_PRIVATE_KEY）'],
  ['alipay_app_public_key.pem', publicKey, '应用公钥（填到支付宝开放平台）'],
  ['alipay_test_public_key.pem', mock.publicKey, '本地测试用模拟支付宝公钥（生产不要用）'],
  ['alipay_test_private_key.pem', mock.privateKey, '本地测试用模拟支付宝私钥（生产不要用）'],
];

for (const [name, content, desc] of files) {
  const p = path.join(outDir, name);
  if (fs.existsSync(p)) {
    console.log(`跳过（已存在）: certs/${name}`);
    continue;
  }
  fs.writeFileSync(p, content, { mode: name.includes('private') ? 0o600 : 0o644 });
  console.log(`已生成: certs/${name}  — ${desc}`);
}

const appPub = fs.readFileSync(path.join(outDir, 'alipay_app_public_key.pem'), 'utf8').trim();
const testPub = fs.readFileSync(path.join(outDir, 'alipay_test_public_key.pem'), 'utf8').trim();

console.log('\n================ 应用公钥（粘贴到支付宝开放平台） ================\n');
console.log(appPub);
console.log('\n==================================================================\n');
console.log('本地联调用的「模拟支付宝公钥」（只有跑测试时才需要）：\n');
console.log(testPub);
console.log('\n下一步：');
console.log('  1) 打开 https://open.alipay.com → 控制台 → 创建应用（选「网页/移动应用」）');
console.log('  2) 开发设置 → 接口加签方式 → 公钥模式 → 粘贴上面的【应用公钥】');
console.log('  3) 保存后页面会给出【支付宝公钥】，复制它');
console.log('  4) 把 APPID + 应用私钥 + 支付宝公钥填进 app/.env（见 .env.example 的 ALIPAY_* 段）');
console.log('  5) 运行 npm run pay:check 自检\n');
