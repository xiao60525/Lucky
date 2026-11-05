'use strict';
/**
 * 退款 / 退货审核端到端自测
 * ---------------------------------------------------------------
 * 覆盖：用户下单支付 → 旧的「直接退款」接口被停用 → 提交退款申请 →
 *       重复提交被合并 → 后台看到待审核 → 拒绝必须写原因 → 用户能看到拒绝原因 →
 *       重新申请 → 后台同意 → 订单变已退款 + 申请变已通过 → 退款后再申请被拒 →
 *       用户撤销申请 → 已处理的申请不能再被审核
 *
 * 运行：node scripts/test-refund.mjs
 * 说明：会真实写测试用户/订单/退款申请到云库，脚本结束会打印清理 SQL。
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3996;
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

const PHONE = '1970000' + String(Date.now()).slice(-4);
const PWD = 'rfnd7391';

/** 下单并完成 mock 支付，返回订单号 */
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

  // 1. 注册
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE, password: PWD, nickname: '退款测试' }),
  });
  token = (reg.data && reg.data.token) || '';
  ok('测试用户注册成功', Boolean(token), PHONE);
  if (!token) {
    srv.kill();
    process.exit(1);
  }

  // 2. 支付一笔订单
  const order = await payOneOrder();
  ok('测试订单已支付', Boolean(order && order.status === 'paid'), order ? order.id : '下单/支付失败');
  if (!order) {
    console.log('\n最近服务端日志：\n' + srvLog.slice(-1200));
    srv.kill();
    process.exit(1);
  }

  // 3. 未登录不能申请
  const saved = token;
  token = '';
  const anon = await api(`/api/orders/${order.id}/refund-request`, {
    method: 'POST',
    body: JSON.stringify({ reason: '不想要了' }),
  });
  ok('未登录不能提交退款申请', anon.status === 401, String(anon.status));
  token = saved;

  // 4. 旧的「直接退款」接口被停用，必须走审核
  const direct = await api(`/api/orders/${order.id}/refund`, { method: 'POST' });
  ok('直接退款接口已停用', direct.status === 403 && direct.data.code === 'REFUND_NEED_REVIEW', `${direct.status} ${direct.data.message || ''}`);
  const stillPaid = await api(`/api/orders/${order.id}`);
  ok('订单没有被退款', stillPaid.data.order.status === 'paid');

  // 5. 没选原因不让提交
  const noReason = await api(`/api/orders/${order.id}/refund-request`, { method: 'POST', body: JSON.stringify({}) });
  ok('必须选择退款原因', noReason.status === 400, String(noReason.status));

  // 6. 正常提交
  const apply1 = await api(`/api/orders/${order.id}/refund-request`, {
    method: 'POST',
    body: JSON.stringify({ reason: '商品与描述不符', detail: '收到的和图片不一样' }),
  });
  ok('提交退款申请成功', apply1.status === 200 && apply1.data.refund && apply1.data.refund.status === 'pending', String(apply1.status));
  const req1 = (apply1.data && apply1.data.refund) || {};
  ok('申请金额等于订单金额', req1.amount === order.amount, `${req1.amount} vs ${order.amount}`);
  ok('申请带原因与说明', req1.reason === '商品与描述不符' && req1.detail === '收到的和图片不一样');

  // 7. 重复提交被合并
  const applyDup = await api(`/api/orders/${order.id}/refund-request`, {
    method: 'POST',
    body: JSON.stringify({ reason: '不想要了' }),
  });
  ok('重复提交合并到同一条', applyDup.status === 200 && applyDup.data.duplicated === true && applyDup.data.refund.id === req1.id);

  // 8. 用户能从 bootstrap 看到进度
  const boot1 = await api('/api/bootstrap');
  const mine1 = ((boot1.data && boot1.data.refunds) || []).find((r) => r.id === req1.id);
  ok('用户能看到自己的退款申请', Boolean(mine1) && mine1.status === 'pending');
  ok('申请带订单标题', Boolean(mine1 && mine1.orderTitle), mine1 ? mine1.orderTitle : '');

  // 9. 后台登录
  const adminPwd = process.env.TEST_ADMIN_PASSWORD || envValue('ADMIN_PASSWORD');
  const login = await fetchJson('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ userName: envValue('ADMIN_USER') || 'admin', password: adminPwd }),
  });
  let adminToken = login.data && login.data.token;
  if (!adminToken) {
    const key = (envValue('ADMIN_TOKEN_SECRET') || envValue('PAY_SECRET') || adminPwd || 'admin-dev-token').trim();
    const exp = Date.now() + 3600 * 1000;
    const sig = crypto.createHmac('sha256', key).update('admin|' + exp).digest('base64url');
    adminToken = exp.toString(36) + '.' + sig;
  }
  const AH = { 'x-admin-token': adminToken };

  // 10. 未登录后台不能审核
  const noAuth = await fetchJson('/api/admin/refund/review', {
    method: 'POST',
    body: JSON.stringify({ id: req1.id, action: 'approve' }),
  });
  ok('后台审核接口需要登录', noAuth.status === 401, String(noAuth.status));

  // 11. 后台能看到这条申请
  const ov = await fetchJson('/api/admin/overview', {}, AH);
  const list = (ov.data && ov.data.refunds) || [];
  const inList = list.find((r) => r.id === req1.id);
  ok('后台列表出现待审核申请', Boolean(inList) && inList.status === 'pending', String(list.length) + ' 条');
  ok('后台能看到买家信息', Boolean(inList && inList.phone === PHONE), inList ? inList.phone : '');
  ok('概览有待审核数量', Boolean(ov.data.stats && ov.data.stats.refundPending >= 1), String(ov.data.stats && ov.data.stats.refundPending));

  // 12. 拒绝必须写原因
  const rejectNoNote = await fetchJson('/api/admin/refund/review', {
    method: 'POST',
    body: JSON.stringify({ id: req1.id, action: 'reject' }),
  }, AH);
  ok('拒绝必须填写原因', rejectNoNote.status === 400, String(rejectNoNote.status));

  const rejected = await fetchJson('/api/admin/refund/review', {
    method: 'POST',
    body: JSON.stringify({ id: req1.id, action: 'reject', note: '商品已使用，不支持退款' }),
  }, AH);
  ok('拒绝申请成功', rejected.status === 200 && rejected.data.refund.status === 'rejected', String(rejected.status));

  const orderAfterReject = await api(`/api/orders/${order.id}`);
  ok('拒绝后订单仍是已支付', orderAfterReject.data.order.status === 'paid');

  const boot2 = await api('/api/bootstrap');
  const mine2 = ((boot2.data && boot2.data.refunds) || []).find((r) => r.id === req1.id);
  ok('用户能看到拒绝原因', Boolean(mine2) && mine2.status === 'rejected' && /已使用/.test(mine2.adminNote || ''), mine2 ? mine2.adminNote : '');

  // 13. 被拒后可以重新申请
  const apply2 = await api(`/api/orders/${order.id}/refund-request`, {
    method: 'POST',
    body: JSON.stringify({ reason: '服务未使用', detail: '重新申请一次' }),
  });
  ok('被拒后可以重新申请', apply2.status === 200 && apply2.data.refund.id !== req1.id && apply2.data.refund.status === 'pending');
  const req2 = (apply2.data && apply2.data.refund) || {};

  // 14. 同一订单这时有两条待审核？不应该（前一条已拒绝）
  const allMine = ((await api('/api/bootstrap')).data.refunds || []).filter((r) => r.orderId === order.id);
  ok('同一订单只有一条待审核', allMine.filter((r) => r.status === 'pending').length === 1, String(allMine.length) + ' 条历史');

  // 15. 后台同意 → 真退款
  const approved = await fetchJson('/api/admin/refund/review', {
    method: 'POST',
    body: JSON.stringify({ id: req2.id, action: 'approve', note: '已核实，同意退款' }),
  }, AH);
  ok('同意退款成功', approved.status === 200 && approved.data.refund.status === 'approved', String(approved.status));

  let refundedOrder = null;
  for (let i = 0; i < 20; i++) {
    const r = await api(`/api/orders/${order.id}`);
    refundedOrder = r.data && r.data.order;
    if (refundedOrder && refundedOrder.status === 'refunded') break;
    await sleep(250);
  }
  ok('订单已变为已退款', Boolean(refundedOrder) && refundedOrder.status === 'refunded');
  ok('订单有退款时间', Boolean(refundedOrder && refundedOrder.refundedAt));

  // 16. 已退款订单不能再申请
  const afterRefund = await api(`/api/orders/${order.id}/refund-request`, {
    method: 'POST',
    body: JSON.stringify({ reason: '不想要了' }),
  });
  ok('已退款订单不能再申请', afterRefund.status === 409, `${afterRefund.status} ${afterRefund.data.message || ''}`);

  // 17. 审核过的申请不能重复审核
  const again = await fetchJson('/api/admin/refund/review', {
    method: 'POST',
    body: JSON.stringify({ id: req2.id, action: 'approve' }),
  }, AH);
  ok('已处理的申请不能重复审核', again.status === 409, String(again.status));

  // 18. 不存在的申请
  const ghost = await fetchJson('/api/admin/refund/review', {
    method: 'POST',
    body: JSON.stringify({ id: 'rf_not_exist', action: 'approve' }),
  }, AH);
  ok('不存在的申请返回 404', ghost.status === 404, String(ghost.status));

  // 19. 撤销流程（第二笔订单）
  const order2 = await payOneOrder();
  ok('第二笔订单已支付', Boolean(order2 && order2.status === 'paid'));
  if (order2) {
    const a3 = await api(`/api/orders/${order2.id}/refund-request`, {
      method: 'POST',
      body: JSON.stringify({ reason: '重复购买' }),
    });
    const req3 = (a3.data && a3.data.refund) || {};
    ok('第二笔申请提交成功', Boolean(req3.id), String(a3.status));
    const cancel = await api(`/api/refunds/${req3.id}/cancel`, { method: 'POST' });
    ok('用户可以撤销申请', cancel.status === 200 && cancel.data.ok === true, String(cancel.status));
    const boot3 = await api('/api/bootstrap');
    const mine3 = ((boot3.data && boot3.data.refunds) || []).find((r) => r.id === req3.id);
    ok('撤销后状态为已撤销', Boolean(mine3) && mine3.status === 'cancelled', mine3 ? mine3.status : '');
    const cancelAgain = await api(`/api/refunds/${req3.id}/cancel`, { method: 'POST' });
    ok('已撤销不能再次撤销', cancelAgain.status === 409, String(cancelAgain.status));
    const approveCancelled = await fetchJson('/api/admin/refund/review', {
      method: 'POST',
      body: JSON.stringify({ id: req3.id, action: 'approve' }),
    }, AH);
    ok('已撤销的申请不能审核通过', approveCancelled.status === 409, String(approveCancelled.status));
  }

  // 20. 我的退款列表接口
  const mineApi = await api('/api/refunds');
  ok('我的退款列表接口可用', mineApi.status === 200 && Array.isArray(mineApi.data.refunds) && mineApi.data.refunds.length >= 3, String((mineApi.data.refunds || []).length) + ' 条');

  console.log(`\n结果：${pass}/${pass + fail} 通过`);
  if (fail) console.log('\n最近服务端日志：\n' + srvLog.slice(-1500));
  console.log(`\n清理测试数据（云库执行）：
DELETE FROM refund_requests WHERE user_id IN (SELECT id FROM app_users WHERE phone='${PHONE}');
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
