'use strict';
/**
 * 内容单篇付费（方案三）端到端自测
 * ---------------------------------------------------------------
 * 覆盖：非会员看付费内容只拿到标题（正文不下发）→ 单篇下单 →
 *       模拟收银台支付 → 支付回调后自动解锁 → 再拉 bootstrap 正文下发 →
 *       重复下单被拦截（already_owned / already_member）→ 金额以服务端内容表为准
 *
 * 运行：node scripts/test-content-pay.mjs
 * 说明：会真实写一条测试用户/订单/解锁记录到云库，脚本结束时打印清理 SQL。
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3997;
const BASE = `http://localhost:${PORT}`;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), PAY_PROVIDER: 'mock' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', (d) => (srvLog += d));
srv.stderr.on('data', (d) => (srvLog += d));

async function waitReady() {
  // /api/health 早起也会 200，但云库可能还在连；等 bootstrap 真正能出数据再跑
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) {
        const b = await fetch(`${BASE}/api/bootstrap`);
        if (b.status === 200) return true;
      }
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  return false;
}

let token = '';
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-user-token': token } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

const PHONE = '1990000' + String(Date.now()).slice(-4);

(async () => {
  if (!(await waitReady())) {
    console.error('服务未启动：\n' + srvLog.slice(-1500));
    srv.kill();
    process.exit(1);
  }

  // 1. 注册测试用户
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE, password: 'test1234', nickname: '内容付费测试' }),
  });
  token = (reg.data && (reg.data.token || (reg.data.user && reg.data.user.token))) || '';
  ok('测试用户注册成功', Boolean(token), PHONE);
  if (!token) {
    srv.kill();
    process.exit(1);
  }

  // 2. 找一篇有单篇价格的内容
  let boot = await api('/api/bootstrap');
  const paid = (boot.data.contents || []).find((c) => Number(c.price) > 0);
  if (!paid) {
    console.log('✘ 没有配置单篇解锁价的内容，先在后台「内容」里填价格再跑本测试');
    srv.kill();
    process.exit(1);
  }
  ok('找到付费内容', Boolean(paid), `${paid.title} · ${(paid.price / 100).toFixed(2)} 元`);

  // 3. 非会员：锁定 + 正文不下发
  ok('非会员看到的是锁定状态', paid.locked === true);
  ok('正文未下发到前端', !paid.desc, JSON.stringify(paid.desc || ''));
  ok('价格有下发（前端要展示）', Number(paid.price) === paid.price);

  // 4. 单篇下单：金额取服务端内容表
  const created = await api('/api/orders', { method: 'POST', body: JSON.stringify({ contentId: paid.id }) });
  ok('内容解锁订单创建成功', created.status === 201 && Boolean(created.data.order), JSON.stringify(created.data).slice(0, 120));
  const order = created.data.order || {};
  ok('订单金额等于内容价格', order.amount === paid.price, `${order.amount} vs ${paid.price}`);
  ok('订单被标记为内容订单', order.kind === 'content' && order.contentId === paid.id);

  // 5. 模拟收银台支付
  const pay = await api(`/api/orders/${order.id}/pay`, { method: 'POST', body: JSON.stringify({ channel: 'mock' }) });
  ok('拉起模拟收银台', pay.status === 200 && Boolean(pay.data.payUrl), pay.data.payUrl || '');
  const sign = new URL('http://x' + (pay.data.payUrl || '')).searchParams.get('sign') || '';
  const confirm = await api('/api/pay/confirm', {
    method: 'POST',
    body: JSON.stringify({ orderId: order.id, sign }),
  });
  ok('确认支付被接受', confirm.status === 200 && confirm.data.ok === true);

  // 6. 等渠道回调 → 订单已支付
  let paidOrder = null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const r = await api(`/api/orders/${order.id}`);
    if (r.data && r.data.order && r.data.order.status === 'paid') {
      paidOrder = r.data.order;
      break;
    }
  }
  ok('订单变为已支付', Boolean(paidOrder));

  // 7. 解锁生效：正文下发、标记已解锁（权益发放是异步的，最多等 6 秒）
  let after = null;
  for (let i = 0; i < 20; i++) {
    boot = await api('/api/bootstrap');
    after = (boot.data.contents || []).find((c) => c.id === paid.id);
    if (after && after.unlocked) break;
    await sleep(300);
  }
  ok('解锁后不再是锁定状态', after && after.locked === false);
  ok('解锁标记正确', after && after.unlocked === true);
  ok('解锁后正文已下发', Boolean(after && after.desc), after && after.desc ? after.desc.slice(0, 20) : '');

  // 8. 重复购买被拦截
  const again = await api('/api/orders', { method: 'POST', body: JSON.stringify({ contentId: paid.id }) });
  ok('已解锁再买被拦截', again.status === 409 && again.data.code === 'already_owned', again.data.message || '');

  // 9. 未登录不能下单
  const saved = token;
  token = '';
  const anon = await api('/api/orders', { method: 'POST', body: JSON.stringify({ contentId: paid.id }) });
  ok('未登录下单被拒绝', anon.status === 401);
  token = saved;

  // 10. 退款后收回阅读权限（避免退了钱还能看）
  const refund = await api(`/api/orders/${order.id}/refund`, { method: 'POST' });
  ok('内容订单可以退款', refund.status === 200, refund.data.message || '');
  let relock = null;
  for (let i = 0; i < 15; i++) {
    boot = await api('/api/bootstrap');
    relock = (boot.data.contents || []).find((c) => c.id === paid.id);
    if (relock && relock.locked === true) break;
    await sleep(300);
  }
  ok('退款后重新锁上', Boolean(relock) && relock.locked === true && !relock.desc);

  // 11. 不存在的/免费内容不能下单
  const fake = await api('/api/orders', { method: 'POST', body: JSON.stringify({ contentId: 'not_exist_xxx' }) });
  ok('不存在的内容被拒绝', fake.status === 404, fake.data.message || '');

  console.log(`\n结果：${pass}/${pass + fail} 通过`);
  if (fail) {
    console.log('\n最近服务端日志：\n' + srvLog.slice(-1200));
  }
  console.log(`\n清理测试数据（云库执行）：\nDELETE FROM content_unlocks WHERE user_id IN (SELECT id FROM app_users WHERE phone='${PHONE}');\nDELETE FROM orders WHERE id='${order.id}';\nDELETE FROM app_users WHERE phone='${PHONE}';`);
  srv.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  srv.kill();
  process.exit(1);
});
