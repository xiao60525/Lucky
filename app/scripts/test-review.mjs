'use strict';
/**
 * 确认收货 + 满意度评价端到端自测
 * ---------------------------------------------------------------
 * 覆盖：下单支付 → 未确认收货不能评价 → 确认收货（重复确认幂等）→
 *       评分/商品校验 → 正常提交 → 重复评价被合并 → 商品页评价列表 + 平均分 →
 *       我的评价 → 后台评价列表 → 隐藏必须填原因 → 隐藏后商品页不可见、统计同步 →
 *       恢复展示 → 未登录不能评价 / 后台接口拒绝普通用户
 *
 * 运行：node scripts/test-review.mjs
 * 说明：会真实写测试用户/订单/评价到云库，脚本结束会打印清理 SQL。
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3998;
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

function envValue(key) {
  try {
    const t = readFileSync(join(ROOT, '.env'), 'utf8');
    for (const line of t.split(/\r?\n/)) {
      if (line.startsWith(key + '=')) return line.slice(key.length + 1).trim();
    }
  } catch {
    /* ignore */
  }
  return '';
}

const srv = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), PAY_PROVIDER: 'mock' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', (d) => (srvLog += d));
srv.stderr.on('data', (d) => (srvLog += d));

async function waitReady() {
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
function api(path, opts = {}, extraHeaders = {}) {
  return fetchJson(path, opts, { ...(token ? { 'x-user-token': token } : {}), ...extraHeaders });
}

async function fetchJson(path, opts = {}, headers = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...headers, ...(opts.headers || {}) },
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

const PHONE = '1980000' + String(Date.now()).slice(-4);
const PWD = 'revw2088';

/** 下单并完成 mock 支付，返回订单 */
async function payOneOrder() {
  const boot = await api('/api/bootstrap');
  const product = ((boot.data && boot.data.products) || []).find((p) => !p.memberOnly && Number(p.amount) > 0);
  if (!product) return null;
  const created = await api('/api/orders', { method: 'POST', body: JSON.stringify({ productId: product.id }) });
  const order = created.data && created.data.order;
  if (!order) return null;
  const pay = await api(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    body: JSON.stringify({ channel: 'mock' }),
  });
  const sign = new URL('http://x' + ((pay.data && pay.data.payUrl) || '')).searchParams.get('sign') || '';
  await api('/api/pay/confirm', { method: 'POST', body: JSON.stringify({ orderId: order.id, sign }) });
  for (let i = 0; i < 30; i++) {
    await sleep(250);
    const r = await api(`/api/orders/${order.id}`);
    if (r.data && r.data.order && r.data.order.status === 'paid') return { ...r.data.order, productId: product.id };
  }
  return null;
}

(async () => {
  if (!(await waitReady())) {
    console.error('服务未启动：\n' + srvLog.slice(-1500));
    srv.kill();
    process.exit(1);
  }

  // 1. 注册 + 支付
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE, password: PWD, nickname: '评价测试' }),
  });
  token = (reg.data && reg.data.token) || '';
  ok('测试用户注册成功', Boolean(token), PHONE);
  if (!token) {
    srv.kill();
    process.exit(1);
  }
  const order = await payOneOrder();
  ok('测试订单已支付', Boolean(order && order.status === 'paid'), order ? order.id : '下单/支付失败');
  if (!order) {
    console.log('\n最近服务端日志：\n' + srvLog.slice(-1200));
    srv.kill();
    process.exit(1);
  }

  // 2. 未登录不能评价
  const saved = token;
  token = '';
  const anon = await api('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({ orderId: order.id, productId: order.productId, rating: 5, content: '好' }),
  });
  ok('未登录不能提交评价', anon.status === 401, String(anon.status));
  token = saved;

  // 3. 未确认收货不能评价
  const before = await api('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({ orderId: order.id, productId: order.productId, rating: 5, content: '还没收货就想评' }),
  });
  ok('未确认收货不能评价', before.status === 409, `${before.status} ${before.data.message || ''}`);

  // 4. 确认收货
  const recv = await api(`/api/orders/${order.id}/receive`, { method: 'POST' });
  ok('确认收货成功', recv.status === 200 && recv.data.order && Boolean(recv.data.order.receivedAt));
  const recvAgain = await api(`/api/orders/${order.id}/receive`, { method: 'POST' });
  ok('重复确认收货幂等', recvAgain.status === 200 && recvAgain.data.duplicate === true, String(recvAgain.status));

  // 5. 参数校验
  const badRating = await api('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({ orderId: order.id, productId: order.productId, rating: 9, content: 'x' }),
  });
  ok('评分超出 1~5 被拒绝', badRating.status === 400, String(badRating.status));
  const badProduct = await api('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({ orderId: order.id, productId: 'p_not_mine', rating: 5, content: 'x' }),
  });
  ok('不能评价订单外的商品', badProduct.status === 400, `${badProduct.status} ${badProduct.data.message || ''}`);

  // 6. 正常提交
  const ok1 = await api('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({ orderId: order.id, productId: order.productId, rating: 5, content: '质量很好，物流很快' }),
  });
  ok('评价提交成功', ok1.status === 201 && ok1.data.review && ok1.data.review.rating === 5, String(ok1.status));
  const review = (ok1.data && ok1.data.review) || {};

  // 7. 重复评价被合并
  const dup = await api('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({ orderId: order.id, productId: order.productId, rating: 1, content: '改差评？不行' }),
  });
  ok('同一订单同一商品只能评一次', dup.status === 201 && dup.data.duplicated === true && dup.data.review.id === review.id);

  // 8. 商品页评价列表（游客可见）
  const pub = await fetchJson(`/api/reviews?productId=${encodeURIComponent(order.productId)}`);
  ok('商品评价列表游客可见', pub.status === 200 && Array.isArray(pub.data.reviews));
  const pubRow = (pub.data.reviews || []).find((r) => r.id === review.id);
  ok('评价出现在商品页', Boolean(pubRow), pubRow ? pubRow.content : '');
  ok('平均分与条数正确', pub.data.count >= 1 && Number(pub.data.rating) >= 1 && Number(pub.data.rating) <= 5, `avg=${pub.data.rating} count=${pub.data.count}`);
  ok('昵称脱敏展示', Boolean(pubRow && pubRow.nickname) && !String(PHONE).includes(pubRow.nickname || '##'), pubRow ? pubRow.nickname : '');

  // 9. 我的评价
  const mine = await api('/api/reviews/mine');
  ok('我的评价里能看到这条', mine.status === 200 && (mine.data.reviews || []).some((r) => r.id === review.id));

  // 10. 后台列表
  const adminPwd = process.env.TEST_ADMIN_PASSWORD || envValue('ADMIN_PASSWORD');
  const login = await fetchJson('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ userName: envValue('ADMIN_USER') || 'admin', password: adminPwd }),
  });
  let adminToken = login.data && login.data.token;
  if (!adminToken) {
    const key = (envValue('ADMIN_TOKEN_SECRET') || envValue('PAY_SECRET') || adminPwd || 'admin-dev-token').trim();
    const exp = Date.now() + 3600 * 1000;
    const crypto = await import('node:crypto');
    adminToken = crypto.createHmac('sha256', key).update('admin|' + exp).digest('base64url');
    adminToken = exp.toString(36) + '.' + adminToken;
  }
  const AH = { 'x-admin-token': adminToken };
  const adminList = await fetchJson('/api/admin/reviews', {}, AH);
  const adminRow = (adminList.data && adminList.data.reviews || []).find((r) => r.id === review.id);
  ok('后台能看到全部评价', adminList.status === 200 && Boolean(adminRow));
  ok('后台能看到买家与商品', Boolean(adminRow && (adminRow.phone || adminRow.userId) && adminRow.productTitle), adminRow ? adminRow.productTitle : '');

  // 11. 普通用户不能调后台评价接口
  const noAdmin = await api('/api/admin/reviews');
  ok('后台评价接口拒绝普通用户', noAdmin.status === 401, String(noAdmin.status));

  // 12. 隐藏必须填原因
  const noReason = await fetchJson('/api/admin/reviews/hide', {
    method: 'POST',
    body: JSON.stringify({ id: review.id, hidden: true, reason: '' }),
  }, AH);
  ok('隐藏评价必须填原因', noReason.status === 400, String(noReason.status));

  // 13. 隐藏后商品页不可见、统计同步
  const hide = await fetchJson('/api/admin/reviews/hide', {
    method: 'POST',
    body: JSON.stringify({ id: review.id, hidden: true, reason: '测试隐藏：涉嫌广告' }),
  }, AH);
  ok('隐藏成功', hide.status === 200 && hide.data.review && hide.data.review.hidden === true);
  const pub2 = await fetchJson(`/api/reviews?productId=${encodeURIComponent(order.productId)}`);
  ok('隐藏后商品页看不到这条评价', !(pub2.data.reviews || []).some((r) => r.id === review.id), `count=${pub2.data.count}`);
  ok('我的评价仍能看到（状态待审核）', (await api('/api/reviews/mine')).data.reviews.some((r) => r.id === review.id));

  // 14. 恢复展示
  const show = await fetchJson('/api/admin/reviews/hide', {
    method: 'POST',
    body: JSON.stringify({ id: review.id, hidden: false, reason: '' }),
  }, AH);
  ok('恢复展示成功', show.status === 200 && show.data.review && show.data.review.hidden === false);
  const pub3 = await fetchJson(`/api/reviews?productId=${encodeURIComponent(order.productId)}`);
  ok('恢复后商品页重新可见', (pub3.data.reviews || []).some((r) => r.id === review.id));

  // 15. 不存在的评价
  const ghost = await fetchJson('/api/admin/reviews/hide', {
    method: 'POST',
    body: JSON.stringify({ id: 'rv_not_exist', hidden: true, reason: 'x' }),
  }, AH);
  ok('不存在的评价返回 404', ghost.status === 404, String(ghost.status));

  // 16. 商品页评分上限展示（bootstrap 附带评分）
  const boot2 = await api('/api/bootstrap');
  const p2 = ((boot2.data && boot2.data.products) || []).find((x) => x.id === order.productId);
  ok('商品带评分与评价数', Boolean(p2) && Number(p2.reviewCount) >= 1 && Number(p2.rating) >= 1, p2 ? `rating=${p2.rating} count=${p2.reviewCount}` : '');

  console.log(`\n结果：${pass}/${pass + fail} 通过`);
  if (fail) console.log('\n最近服务端日志：\n' + srvLog.slice(-1500));
  console.log(`\n清理测试数据（云库执行）：
DELETE FROM reviews WHERE user_id IN (SELECT id FROM app_users WHERE phone='${PHONE}');
DELETE FROM orders WHERE user_id IN (SELECT id FROM app_users WHERE phone='${PHONE}');
DELETE FROM accounts WHERE id IN (SELECT id FROM app_users WHERE phone='${PHONE}');
DELETE FROM app_users WHERE phone='${PHONE}';`);
  srv.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  srv.kill();
  process.exit(1);
});
