/**
 * 取消未支付订单 · 端到端测试
 * 起一个本地服务（mock 渠道，不需要真实支付配置）→ 注册用户 → 下单 → 取消 → 校验状态
 * 用法：node scripts/test-cancel-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3399;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`✔ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fails.push(name);
    console.log(`✘ ${name}${detail ? ' — ' + detail : ''}`);
  }
};

const srv = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), PAY_PROVIDER: 'mock', ALIPAY_APP_ID: '', ALIPAY_PRIVATE_KEY: '', ALIPAY_PUBLIC_KEY: '', ALIPAY_NOTIFY_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
srv.stdout.on('data', (d) => (log += d));
srv.stderr.on('data', (d) => (log += d));

const j = async (r) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t.slice(0, 200) };
  }
};

try {
  // 等服务起来
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try {
      const r = await fetch(`${BASE}/api/bootstrap`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* 继续等 */
    }
  }
  ok('服务启动', ready, ready ? '' : log.slice(-300));
  if (!ready) throw new Error('服务未启动');

  const phone = '137' + String(Date.now()).slice(-8);
  let r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'cancel123', nickname: '取消测试' }),
  });
  let d = await j(r);
  ok('注册测试用户', r.status === 201 && !!d.token, String(r.status));
  const H = { 'x-user-token': d.token };

  const boot = (await fetch(`${BASE}/api/bootstrap`, { headers: H }).then(j)) || {};
  const product = (boot.products || []).find((p) => Number(p.amount) > 0) || (boot.products || [])[0];
  ok('有可下单的商品', Boolean(product), product ? product.id : '无');

  // 1. 下单 → 取消
  r = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...H },
    body: JSON.stringify({ productId: product.id }),
  });
  d = await j(r);
  const order = d.order;
  ok('创建订单', r.status === 201 && !!order, String(r.status));
  ok('新订单未支付', order && (order.status === 'created' || order.status === 'pending'), order && order.status);

  r = await fetch(`${BASE}/api/orders/${order.id}/cancel`, { method: 'POST', headers: H });
  d = await j(r);
  ok('取消成功', r.status === 200 && d.order && d.order.status === 'closed', `${r.status} ${d.order && d.order.status}`);
  ok('取消非支付状态', d.paid === false, String(d.paid));

  // 2. 详情里状态已同步
  r = await fetch(`${BASE}/api/orders/${order.id}`, { headers: H });
  d = await j(r);
  ok('订单详情显示已关闭', r.status === 200 && d.order && d.order.status === 'closed', d.order && d.order.status);

  // 3. 重复取消被拒绝
  r = await fetch(`${BASE}/api/orders/${order.id}/cancel`, { method: 'POST', headers: H });
  d = await j(r);
  ok('重复取消返回 409', r.status === 409, `${r.status} ${d.message || ''}`);

  // 4. 已支付订单不能取消
  r = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...H },
    body: JSON.stringify({ productId: product.id }),
  });
  const order2 = (await j(r)).order;
  r = await fetch(`${BASE}/api/orders/${order2.id}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...H },
    body: JSON.stringify({ channel: 'mock' }),
  });
  d = await j(r);
  const sign = new URL('http://x' + (d.payUrl || '')).searchParams.get('sign') || '';
  if (sign) {
    await fetch(`${BASE}/api/pay/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order2.id, sign }),
    });
    for (let i = 0; i < 30; i++) {
      await sleep(250);
      const cur = await fetch(`${BASE}/api/orders/${order2.id}`, { headers: H }).then(j);
      if (cur.order && cur.order.status === 'paid') break;
    }
  }
  r = await fetch(`${BASE}/api/orders/${order2.id}/cancel`, { method: 'POST', headers: H });
  d = await j(r);
  ok('已支付订单取消被拒绝', r.status === 409, `${r.status} ${d.message || ''}`);

  // 5. 别人的订单不能取消
  const phone2 = '136' + String(Date.now()).slice(-8);
  r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone2, password: 'cancel123', nickname: '路人' }),
  });
  const d2 = await j(r);
  r = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...H },
    body: JSON.stringify({ productId: product.id }),
  });
  const order3 = (await j(r)).order;
  r = await fetch(`${BASE}/api/orders/${order3.id}/cancel`, {
    method: 'POST',
    headers: { 'x-user-token': d2.token },
  });
  ok('不能取消别人的订单', r.status === 403, String(r.status));
} catch (e) {
  fails.push('异常：' + e.message);
  console.log('✘ 异常：' + e.message);
} finally {
  srv.kill();
}
console.log(`\n结果：${pass}/${pass + fails.length} 通过`);
if (fails.length) {
  console.log('失败项：' + fails.join('、'));
  process.exit(1);
}
process.exit(0);
