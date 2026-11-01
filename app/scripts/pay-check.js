'use strict';
/**
 * 微信支付凭据自检
 *   node scripts/pay-check.js
 *
 * 做三件事：
 *   1. 检查 .env 里必填项是否齐全
 *   2. 本地校验私钥可用、私钥与证书是否配对、APIv3 密钥长度
 *   3. 真实请求一次 /v3/certificates（只读接口，不产生订单、不扣钱）
 *      —— 能通过说明：商户号、证书序列号、私钥签名、网络全部正确
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('../src/env').loadEnv(path.join(__dirname, '..', '.env'));

const { WechatPay } = require('../src/wechatpay');

const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = (m) => console.log('  \x1b[31m✗\x1b[0m ' + m);
const info = (m) => console.log('    ' + m);

(async function main() {
  console.log('\n微信支付凭据自检');
  console.log('---------------------------------------------');

  // 商户号格式（微信官方：8~10 位数字）
  const mchid = (process.env.WX_MCHID || '').trim();
  if (!mchid) bad('未配置商户号 WX_MCHID');
  else if (!/^\d{8,10}$/.test(mchid)) bad(`商户号 ${mchid} 格式不对，应为 8~10 位数字`);
  else ok(`商户号 ${mchid} 格式正确`);

  const missing = WechatPay.missingEnv();
  if (missing.length) {
    console.log('缺少以下配置（写在 app/.env 里）：');
    missing.forEach((m) => console.log(`  ✗ ${m.key.padEnd(20)} ${m.desc}`));
    console.log('\n补全后重新运行本脚本。');
    return;
  }
  ok('必填配置齐全');

  // APIv3 密钥
  const key = process.env.WX_API_V3_KEY || '';
  if (Buffer.byteLength(key, 'utf8') === 32) ok('APIv3 密钥长度正确（32 字节）');
  else bad(`APIv3 密钥长度 ${Buffer.byteLength(key, 'utf8')} 字节，必须是 32 字节`);

  // 私钥
  const keyPath = process.env.WX_PRIVATE_KEY_PATH || process.env.WX_PRIVATE_KEY;
  let privateKey = null;
  try {
    privateKey = keyPath.includes('BEGIN')
      ? keyPath
      : fs.readFileSync(path.resolve(__dirname, '..', keyPath), 'utf8');
    crypto.createPrivateKey(privateKey);
    ok('商户私钥可读取且格式正确');
  } catch (e) {
    bad('商户私钥无法解析：' + e.message);
    return;
  }

  // 私钥与证书是否配对
  const certPath = process.env.WX_CERT_PATH;
  if (certPath && fs.existsSync(path.resolve(__dirname, '..', certPath))) {
    const certPem = fs.readFileSync(path.resolve(__dirname, '..', certPath), 'utf8');
    const pubFromCert = crypto.createPublicKey(certPem).export({ type: 'spki', format: 'pem' });
    const pubFromKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    if (pubFromCert === pubFromKey) ok('私钥与证书 apiclient_cert.pem 配对正确');
    else bad('私钥与证书不配对：证书序列号或私钥拿错了');

    // 证书序列号自校验
    const x509 = new crypto.X509Certificate(certPem);
    const serial = BigInt('0x' + x509.serialNumber.replace(/[^0-9a-fA-F]/g, '')).toString(16).toUpperCase();
    if (process.env.WX_SERIAL_NO && serial.includes(process.env.WX_SERIAL_NO.replace(/[^0-9A-F]/gi, '').toUpperCase())) {
      ok('证书序列号与 WX_SERIAL_NO 一致');
    } else {
      info(`小提示：证书里的序列号是 ${serial}，请确认与商户平台「API证书」列表一致`);
    }
    info(`证书有效期至：${x509.validTo}`);
  } else {
    info('未提供 WX_CERT_PATH，跳过证书配对校验');
  }

  // 真实验签测试：只读接口
  console.log('\n向微信支付发送一次只读请求（GET /v3/certificates）…');
  const client = WechatPay.fromEnv();
  try {
    const data = await client.request('GET', '/v3/certificates');
    ok(`请求成功，签名被微信接受（返回 ${(data.data || []).length} 张平台证书）`);
    console.log('\n凭据可用，可以开始真实下单了。');
  } catch (e) {
    bad('请求失败：' + e.message);
    if (e.detail && e.detail.code) info('错误码：' + e.detail.code);
    if (e.detail && e.detail.code === 'SIGN_ERROR') {
      info('通常是证书序列号 WX_SERIAL_NO 与私钥不是同一套证书');
    }
    if (e.detail && e.detail.code === 'PARAM_ERROR') {
      info('检查 WX_MCHID 是否正确、AppID 是否与该商户号绑定');
    }
  }
  console.log('---------------------------------------------\n');
})();
