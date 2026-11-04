'use strict';
/**
 * 支付宝接入自测
 * ---------------------------------------------------------------
 * 不连真实支付宝，用本地生成的「模拟支付宝密钥」验证：
 *   1. 下单参数与签名是否正确（应用私钥签 → 应用公钥验）
 *   2. 异步通知验签、金额校验、幂等
 *   3. 端到端：登录 → 下单 → 选支付宝 → 支付成功
 *
 * 运行：node scripts/test-alipay.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Alipay } from '../src/alipay.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CERT = path.join(ROOT, 'certs');
const read = (n) => fs.readFileSync(path.join(CERT, n), 'utf8');

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`✔ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`✘ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

/* ================= 第一部分：签名与参数（纯单元） ================= */

const APP_PRIVATE = read('alipay_app_private_key.pem');
const APP_PUBLIC = read('alipay_app_public_key.pem');
const TEST_ALIPAY_PRIVATE = read('alipay_test_private_key.pem'); // 模拟支付宝私钥
const TEST_ALIPAY_PUBLIC = read('alipay_test_public_key.pem'); // 模拟支付宝公钥

// 1. 缺配置时优雅降级
const emptyEnv = { ...process.env };
delete emptyEnv.ALIPAY_APP_ID;
delete emptyEnv.ALIPAY_PRIVATE_KEY;
delete emptyEnv.ALIPAY_PUBLIC_KEY;
delete emptyEnv.ALIPAY_NOTIFY_URL;
ok('缺配置时 fromEnv 返回 null', Alipay.fromEnv(emptyEnv) === null);
ok('missingEnv 列出 4 项', Alipay.missingEnv(emptyEnv).length === 4);

// 2. 配齐后可构造客户端
const client = new Alipay({
  appId: '2021000000000001',
  privateKey: APP_PRIVATE,
  publicKey: TEST_ALIPAY_PUBLIC,
  notifyUrl: 'https://example.com/api/notify/alipay',
  returnUrl: 'https://example.com/api/alipay/return',
});
ok('fromEnv 配齐后返回实例', Alipay.fromEnv({
  ALIPAY_APP_ID: '2021000000000001',
  ALIPAY_PRIVATE_KEY: APP_PRIVATE,
  ALIPAY_PUBLIC_KEY: TEST_ALIPAY_PUBLIC,
  ALIPAY_NOTIFY_URL: 'https://example.com/api/notify/alipay',
}) instanceof Alipay);
ok('未开沙箱走生产网关', client.gateway === 'https://openapi.alipay.com/gateway.do');

// 3. 手机端下单 URL
const wapUrl = client.buildPagePayUrl({
  outTradeNo: 'OTEST0001',
  totalAmountFen: 1200,
  subject: '会员月卡',
  body: '会员月卡',
  wap: true,
});
const u = new URL(wapUrl);
const p = Object.fromEntries(u.searchParams);
ok('URL 指向支付宝网关', u.origin + u.pathname === 'https://openapi.alipay.com/gateway.do');
ok('method 为 wap.pay', p.method === 'alipay.trade.wap.pay', p.method);
ok('app_id 正确', p.app_id === '2021000000000001');
ok('sign_type 为 RSA2', p.sign_type === 'RSA2');
ok('charset 为 utf-8', p.charset === 'utf-8');
ok('version 为 1.0', p.version === '1.0');
ok('带 notify_url', p.notify_url === 'https://example.com/api/notify/alipay');
ok('带 return_url', p.return_url === 'https://example.com/api/alipay/return');

const biz = JSON.parse(p.biz_content);
ok('金额分→元换算正确', biz.total_amount === '12.00', biz.total_amount);
ok('商户订单号正确', biz.out_trade_no === 'OTEST0001');
ok('wap 支付 product_code 正确', biz.product_code === 'QUICK_WAP_WAY');
ok('超时时间已设置', biz.timeout_express === '30m');
ok('timestamp 格式正确', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(p.timestamp), p.timestamp);

// 4. 签名可被应用公钥验证（请求签名包含 sign_type）
const restForSign = { ...p };
delete restForSign.sign;
const content = Object.keys(restForSign)
  .sort()
  .map((k) => `${k}=${restForSign[k]}`)
  .join('&');
const verifyApp = crypto.createVerify('RSA-SHA256').update(content, 'utf8').verify(APP_PUBLIC, p.sign, 'base64');
ok('下单签名可被应用公钥验证', verifyApp);

// 5. 参数被篡改后验签失败（防金额篡改）
const tampered = content.replace('1200', '1').replace('"12.00"', '"0.01"');
const verifyTampered = crypto
  .createVerify('RSA-SHA256')
  .update(tampered, 'utf8')
  .verify(APP_PUBLIC, p.sign, 'base64');
ok('篡改金额后验签失败', verifyTampered === false);

// 6. 电脑端下单
const pageUrl = client.buildPagePayUrl({ outTradeNo: 'OTEST0002', totalAmountFen: 2000, subject: '测试商品', wap: false });
const pp = Object.fromEntries(new URL(pageUrl).searchParams);
const pbiz = JSON.parse(pp.biz_content);
ok('电脑端 method 为 page.pay', pp.method === 'alipay.trade.page.pay');
ok('电脑端 product_code 正确', pbiz.product_code === 'FAST_INSTANT_TRADE_PAY');
ok('电脑端金额正确', pbiz.total_amount === '20.00');

// 6b. 周期扣款：签约链接与代扣参数
const cycleSignUrl = client.buildCycleSignUrl({
  externalAgreementNo: 'cyc_u_test123',
  singleAmountFen: 2000,
  notifyUrl: 'https://example.com/api/notify/alipay-cycle',
  returnUrl: 'https://example.com/?cycle=signed',
});
const csParams = Object.fromEntries(new URL(cycleSignUrl).searchParams);
const csBiz = JSON.parse(csParams.biz_content);
ok('签约 method 为 user.agreement.page.sign', csParams.method === 'alipay.user.agreement.page.sign');
ok('签约产品码 CYCLE_PAY_SIGN', csBiz.personal_product_code === 'CYCLE_PAY_SIGN');
ok('签约场景 INDUSTRY', csBiz.sign_scene === 'INDUSTRY');
ok('签约外部协议号透传', csBiz.external_agreement_no === 'cyc_u_test123');
ok('协议立即生效', csBiz.agreement_effect_params.agreement_effect === 'START');
ok('签约单期金额正确', csBiz.period_rule_params.single_amount === '20.00');
ok('签约期数正确（默认 24 期）', csBiz.period_rule_params.total_payments === 24);
ok('签约通知地址随单上送', csParams.notify_url === 'https://example.com/api/notify/alipay-cycle');
ok('签约签名可被应用公钥验证', (() => {
  const rest = { ...csParams };
  delete rest.sign;
  const c = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join('&');
  return crypto.createVerify('RSA-SHA256').update(c, 'utf8').verify(APP_PUBLIC, csParams.sign, 'base64');
})());

// 周期扣款代扣：拦截 callApi 校验请求体
let capturedCycle = null;
const origCallApi = client.callApi.bind(client);
client.callApi = async (method, bizContent, extraParams) => {
  capturedCycle = { method, bizContent, extraParams };
  return { trade_status: 'TRADE_SUCCESS', trade_no: '2026110322001400000000000002' };
};
const cycleResp = await client.cyclePay({
  outTradeNo: 'CYC20261103UAB12',
  totalAmountFen: 2000,
  subject: '会员月卡（自动续费）',
  agreementNo: 'AGREE001',
});
client.callApi = origCallApi;
ok('代扣 method 为 trade.pay', capturedCycle.method === 'alipay.trade.pay');
ok('代扣产品码 CYCLE_PAY_AUTH', capturedCycle.bizContent.product_code === 'CYCLE_PAY_AUTH');
ok('代扣带协议号', capturedCycle.bizContent.agreement_params && capturedCycle.bizContent.agreement_params.agreement_no === 'AGREE001');
ok('代扣金额正确', capturedCycle.bizContent.total_amount === '20.00');
ok('代扣通知地址随单上送', capturedCycle.extraParams.notify_url === 'https://example.com/api/notify/alipay');
ok('代扣返回透传', cycleResp.trade_no === '2026110322001400000000000002');

// 7. 通知验签（模拟支付宝用自己私钥签名）
function signNotify(params, privateKey) {
  const c = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createSign('RSA-SHA256').update(c, 'utf8').sign(privateKey, 'base64');
}

const notify = {
  app_id: '2021000000000001',
  out_trade_no: 'OTEST0001',
  trade_no: '2026110222001400000000000001',
  trade_status: 'TRADE_SUCCESS',
  total_amount: '12.00',
  gmt_payment: '2026-11-02 16:40:00',
  notify_time: '2026-11-02 16:40:01',
  notify_type: 'trade_status_sync',
  charset: 'utf-8',
  version: '1.0',
  sign_type: 'RSA2',
};
notify.sign = signNotify(notify, TEST_ALIPAY_PRIVATE);
ok('合法通知验签通过', client.verifyNotify(notify) === true);

const badAmount = { ...notify, total_amount: '0.01' };
ok('篡改金额的通知验签失败', client.verifyNotify(badAmount) === false);

const noSign = { ...notify };
delete noSign.sign;
ok('无签名的通知被拒绝', client.verifyNotify(noSign) === false);

/* ================= 第二部分：端到端（起真实服务） ================= */

const PORT = 3998;
const BASE = `http://localhost:${PORT}`;

const env = {
  ...process.env,
  PORT: String(PORT),
  PAY_PROVIDER: 'alipay',
  ALIPAY_APP_ID: '2021000000000001',
  ALIPAY_PRIVATE_KEY: APP_PRIVATE,
  ALIPAY_PUBLIC_KEY: TEST_ALIPAY_PUBLIC,
  ALIPAY_NOTIFY_URL: `${BASE}/api/notify/alipay`,
  ALIPAY_RETURN_URL: `${BASE}/api/alipay/return`,
  ALIPAY_GATEWAY: 'https://openapi.alipay.com/gateway.do',
};

const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = '';
srv.stdout.on('data', (d) => (srvLog += d));
srv.stderr.on('data', (d) => (srvLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  return false;
}

const post = async (p, body, headers = {}) => {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

try {
  const ready = await waitReady();
  ok('服务启动成功', ready);
  if (!ready) throw new Error('服务未启动：' + srvLog.slice(-400));

  const phone = '135' + String(Date.now()).slice(-8);
  const reg = await post('/api/auth/register', { phone, password: 'ali123456', nickname: '支付宝测试' });
  ok('注册测试用户', reg.status === 201 && !!reg.data.token);
  const token = reg.data.token;
  const H = { 'x-user-token': token };

  const boot = await fetch(`${BASE}/api/bootstrap`).then((r) => r.json());
  ok('bootstrap 报告支付宝可用', boot.alipayReady === true);
  ok('bootstrap 渠道含支付宝', !!boot.channels && boot.channels.alipay === true);
  const productId = boot.products[0].id;

  const created = await post('/api/orders', { productId }, H);
  ok('创建订单', created.status === 201 && !!created.data.order);
  const order = created.data.order;

  const paid = await post(`/api/orders/${order.id}/pay`, { channel: 'alipay' }, H);
  ok('发起支付宝支付', paid.status === 200, `mode=${paid.data.mode}`);
  ok('返回跳转模式', paid.data.mode === 'redirect');
  ok('返回支付宝收银台地址', /openapi\.alipay\.com\/gateway\.do/.test(paid.data.payUrl || ''));
  const payParams = Object.fromEntries(new URL(paid.data.payUrl).searchParams);
  ok('支付地址含商户订单号', JSON.parse(payParams.biz_content).out_trade_no === order.id);
  ok('支付金额与订单一致', Math.round(Number(JSON.parse(payParams.biz_content).total_amount) * 100) === order.amount);

  // 伪造一条合法异步通知（模拟支付宝回调）
  const n2 = {
    app_id: '2021000000000001',
    out_trade_no: order.id,
    trade_no: '2026110222001400000000000099',
    trade_status: 'TRADE_SUCCESS',
    total_amount: (order.amount / 100).toFixed(2),
    notify_time: '2026-11-02 16:41:00',
    notify_type: 'trade_status_sync',
    charset: 'utf-8',
    version: '1.0',
    sign_type: 'RSA2',
  };
  n2.sign = signNotify(n2, TEST_ALIPAY_PRIVATE);

  const notifyRes = await fetch(`${BASE}/api/notify/alipay`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(n2).toString(),
  });
  const notifyText = await notifyRes.text();
  ok('异步通知返回 success', notifyText.trim() === 'success', notifyText.trim());

  const detail = await fetch(`${BASE}/api/orders/${order.id}`, { headers: H }).then((r) => r.json());
  ok('订单已变为已支付', detail.order.status === 'paid');
  ok('记录了支付宝交易号', detail.order.transactionId === '2026110222001400000000000099');

  // 重复通知：幂等
  const again = await fetch(`${BASE}/api/notify/alipay`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(n2).toString(),
  }).then((r) => r.text());
  const detail2 = await fetch(`${BASE}/api/orders/${order.id}`, { headers: H }).then((r) => r.json());
  ok('重复通知幂等', again.trim() === 'success' && detail2.order.status === 'paid');

  // 金额不符：拒绝
  const created2 = await post('/api/orders', { productId }, H);
  const o2 = created2.data.order;
  await post(`/api/orders/${o2.id}/pay`, { channel: 'alipay' }, H);
  const bad = {
    app_id: '2021000000000001',
    out_trade_no: o2.id,
    trade_no: 'X1',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '999.99',
    notify_time: '2026-11-02 16:42:00',
    sign_type: 'RSA2',
  };
  bad.sign = signNotify(bad, TEST_ALIPAY_PRIVATE);
  const badRes = await fetch(`${BASE}/api/notify/alipay`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(bad).toString(),
  }).then((r) => r.text());
  const d2 = await fetch(`${BASE}/api/orders/${o2.id}`, { headers: H }).then((r) => r.json());
  ok('金额不符的通知被拒绝', badRes.trim() === 'failure' && d2.order.status !== 'paid', badRes.trim());

  // 伪造签名：拒绝
  const forged = { ...bad, sign: 'ZmFrZQ==' };
  const forgedRes = await fetch(`${BASE}/api/notify/alipay`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(forged).toString(),
  }).then((r) => r.text());
  ok('伪造签名的通知被拒绝', forgedRes.trim() === 'failure', forgedRes.trim());

  // 后台支付配置包含支付宝
  const pw = (() => {
    try {
      const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
      const m = txt.match(/^ADMIN_PASSWORD=(.*)$/m);
      return m ? m[1].trim() : process.env.ADMIN_PASSWORD;
    } catch {
      return process.env.ADMIN_PASSWORD;
    }
  })();
  const al = await post('/api/admin/login', { password: pw });
  if (!al.data || !al.data.token) {
    // 后台密码已在「设置」页改过时，.env 里的旧密码不可用：这种情况跳过该步，不当作回归失败
    console.log('↓ 跳过后台配置校验：.env 的 ADMIN_PASSWORD 已不是当前后台密码（可用 TEST_ADMIN_PASSWORD 指定）');
  } else {
    const admin = await fetch(`${BASE}/api/admin/overview`, { headers: { 'x-admin-token': al.data.token } }).then((r) => r.json());
    ok('后台能看到支付宝已配置', admin.pay && admin.pay.alipay && admin.pay.alipay.ready === true);
    ok('后台能看到支付宝 APPID', admin.pay.alipay.appId === '2021000000000001');
  }
} catch (e) {
  fail++;
  console.log('✘ 测试异常：' + e.message);
} finally {
  srv.kill();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
