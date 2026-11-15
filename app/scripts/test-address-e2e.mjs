/**
 * 收货地址簿 · 端到端测试
 * 起本地服务（mock 渠道）→ 注册用户 → 增删改查多地址 → 下单带上选中地址
 * 用法：node scripts/test-address-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3401;
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
  env: {
    ...process.env,
    PORT: String(PORT),
    PAY_PROVIDER: 'mock',
    ALIPAY_APP_ID: '',
    ALIPAY_PRIVATE_KEY: '',
    ALIPAY_PUBLIC_KEY: '',
    ALIPAY_NOTIFY_URL: '',
  },
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

const post = (path, headers, body) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body || {}),
  });

try {
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

  const phone = '136' + String(Date.now()).slice(-8);
  let r = await post('/api/auth/register', {}, { phone, password: 'addr123456', nickname: '地址测试' });
  let d = await j(r);
  ok('注册测试用户', r.status === 201 && !!d.token, String(r.status));
  const H = { 'x-user-token': d.token };

  // 1. 初始为空
  r = await fetch(`${BASE}/api/address/list`, { headers: H });
  d = await j(r);
  ok('新用户地址簿为空', r.status === 200 && Array.isArray(d.addresses) && d.addresses.length === 0, String((d.addresses || []).length));

  // 2. 第一条自动成为默认
  r = await post(
    '/api/address/save',
    H,
    { name: '张三', phone: '13800001234', region: '北京市 朝阳区', detail: '测试路 1 号 101 室', tag: '家' }
  );
  d = await j(r);
  const a1 = (d.addresses || []).find((x) => x.id === d.focusId) || {};
  ok('新增第一个地址', r.status === 200 && (d.addresses || []).length === 1, String(r.status));
  ok('第一个地址自动设为默认', a1.isDefault === true, String(a1.isDefault));
  ok('手机号已脱敏返回', a1.phoneMasked === '138****1234', a1.phoneMasked);
  ok('标签已保存', a1.tag === '家', a1.tag);

  // 3. 再存一个：不抢默认
  r = await post(
    '/api/address/save',
    H,
    { name: '李四', phone: '13900001111', region: '上海市 浦东新区', detail: '测试路 2 号 202 室', tag: '公司' }
  );
  d = await j(r);
  const a2 = (d.addresses || []).find((x) => x.name === '李四') || {};
  ok('新增第二个地址', r.status === 200 && (d.addresses || []).length === 2, String((d.addresses || []).length));
  ok('第二个地址不抢默认', a2.isDefault === false, String(a2.isDefault));
  ok('默认地址仍排第一位', (d.addresses || [])[0].isDefault === true, (d.addresses || [])[0].name);

  // 4. 设为默认
  r = await post('/api/address/default', H, { id: a2.id });
  d = await j(r);
  ok('切换默认地址', r.status === 200 && (d.addresses || [])[0].id === a2.id && (d.addresses || [])[0].isDefault === true, (d.addresses || [])[0].name);
  const onlyOneDefault = (d.addresses || []).filter((x) => x.isDefault).length === 1;
  ok('始终只有一条默认', onlyOneDefault, String((d.addresses || []).filter((x) => x.isDefault).length));

  // 5. 编辑
  r = await post(
    '/api/address/save',
    H,
    { id: a2.id, name: '李四四', phone: '13900001111', region: '上海市 浦东新区', detail: '测试路 28 号 303 室', tag: '学校' }
  );
  d = await j(r);
  const edited = (d.addresses || []).find((x) => x.id === a2.id) || {};
  ok('编辑地址生效', r.status === 200 && edited.name === '李四四' && edited.detail.includes('28 号'), edited.detail);
  ok('编辑后默认身份保留', edited.isDefault === true, String(edited.isDefault));

  // 6. 参数校验
  r = await post('/api/address/save', H, { name: '', phone: '13800001234', detail: '测试路 1 号' });
  ok('姓名为空被拒', r.status === 400, String(r.status));
  r = await post('/api/address/save', H, { name: '张三', phone: '123', detail: '测试路 1 号' });
  ok('手机号不合法被拒', r.status === 400, String(r.status));
  r = await post('/api/address/save', H, { name: '张三', phone: '13800001234', detail: 'too' });
  ok('详细地址过短被拒', r.status === 400, String(r.status));
  r = await post('/api/address/default', H, { id: 'ad_not_exists' });
  ok('设默认时地址不存在返回 404', r.status === 404, String(r.status));

  // 7. 未登录访问被拒
  r = await fetch(`${BASE}/api/address/list`);
  ok('未登录读地址返回 401', r.status === 401, String(r.status));

  // 8. 别人动不了我的地址
  const phone2 = '135' + String(Date.now()).slice(-8);
  const other = await j(await post('/api/auth/register', {}, { phone: phone2, password: 'addr123456', nickname: '路人' }));
  const H2 = { 'x-user-token': other.token };
  r = await post('/api/address/delete', H2, { id: a2.id });
  ok('别人的地址删不掉', r.status === 404, String(r.status));
  r = await post('/api/address/default', H2, { id: a1.id });
  ok('别人的地址设不了默认', r.status === 404, String(r.status));

  // 9. 下单带上选中的地址（非默认那条）
  const boot = (await fetch(`${BASE}/api/bootstrap`, { headers: H }).then(j)) || {};
  const product = (boot.products || []).find((p) => Number(p.amount) > 0 && !p.skuList) || (boot.products || [])[0];
  ok('有可下单商品', Boolean(product), product ? product.id : '无');
  r = await post('/api/orders', H, { productId: product.id, addressId: a1.id });
  d = await j(r);
  const order = d.order || {};
  ok('下单成功', r.status === 201 && Boolean(order.id), String(r.status));
  ok(
    '订单快照用的是选中的地址',
    Boolean(order.shipping) && order.shipping.name === '张三' && order.shipping.detail.includes('测试路 1 号'),
    JSON.stringify(order.shipping || null)
  );

  // 10. 删除默认地址后自动补一条默认
  r = await post('/api/address/delete', H, { id: a2.id });
  d = await j(r);
  const left = d.addresses || [];
  ok('删除地址成功', r.status === 200 && left.length === 1, String(left.length));
  ok('删除默认后自动补默认', left.length === 1 && left[0].isDefault === true, left.length ? String(left[0].isDefault) : '无');

  // 11. 上限 20 条
  let lastStatus = 0;
  for (let i = 0; i < 20; i++) {
    const rr = await post('/api/address/save', H, {
      name: '批量' + i,
      phone: '13800001234',
      region: '广东省 深圳市',
      detail: '批量测试路 ' + i + ' 号',
    });
    lastStatus = rr.status;
  }
  ok('满 20 条后继续新增被拒', lastStatus === 400, String(lastStatus));
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
