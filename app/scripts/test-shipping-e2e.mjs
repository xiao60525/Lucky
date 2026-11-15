/**
 * 临时端到端验证：收货地址快照进订单
 * 用完即删，不留在常规测试集里。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));

let cookie = '';
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const setc = res.headers.get('set-cookie');
  if (setc) cookie = setc.split(';')[0];
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? '✔' : '✗') + ' ' + msg);
  if (!cond) failed++;
};

try {
  for (let i = 0; i < 60 && !cookie; i++) {
    try {
      await api('/api/health');
      break;
    } catch {
      await sleep(500);
    }
  }
  const phone = '139' + String(Date.now()).slice(-8);
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone, password: 'test123456', nickname: '地址快照测试' }),
  });
  ok(reg.status === 200 || reg.status === 201, `注册测试用户 ${phone}（${reg.status}）`);
  const uid = reg.body && reg.body.viewer && reg.body.viewer.id;

  // 保存收货地址
  const addr = await api('/api/auth/profile', {
    method: 'POST',
    body: JSON.stringify({ address: { name: '王收货', phone, detail: '广东省深圳市南山区测试大道 88 号' } }),
  });
  ok(Boolean(addr.body && addr.body.viewer && addr.body.viewer.address && addr.body.viewer.address.name), '地址已保存到用户资料');

  // 找一个在售商品下单
  const st = await api('/api/bootstrap');
  const product = (st.body.products || []).find((p) => !p.soldOutAll && p.amount > 0);
  ok(Boolean(product), `找到测试商品：${product ? product.title : '无'}`);

  const o1 = await api('/api/orders', { method: 'POST', body: JSON.stringify({ productId: product.id }) });
  ok(o1.status === 201, '单件商品订单创建成功');
  ok(
    o1.body.order.shipping && o1.body.order.shipping.name === '王收货' && o1.body.order.shipping.detail.includes('测试大道'),
    '单件订单快照收货信息'
  );

  // 详情里也能看到
  const d1 = await api(`/api/orders/${o1.body.order.id}`);
  ok(Boolean(d1.body.order && d1.body.order.shipping && d1.body.order.shipping.name === '王收货'), '订单详情返回收货信息');

  // 购物车订单
  const o2 = await api('/api/orders', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: product.id, qty: 2 }] }),
  });
  ok(o2.status === 201 && o2.body.order.shipping && o2.body.order.shipping.name === '王收货', '购物车订单快照收货信息');

  // 充值单不快照
  const o3 = await api('/api/orders', { method: 'POST', body: JSON.stringify({ recharge: 100 }) });
  ok(o3.status === 201 && !o3.body.order.shipping, '充值订单不快照收货信息');

  console.log(failed ? `结果：${failed} 项失败` : '结果：全部通过');
  console.log('清理 SQL（手动/后续执行）：');
  console.log(`DELETE FROM orders WHERE user_id='${uid}';`);
  console.log(`DELETE FROM app_users WHERE id='${uid}';`);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error('测试执行失败:', e);
  process.exitCode = 1;
} finally {
  server.kill();
}
