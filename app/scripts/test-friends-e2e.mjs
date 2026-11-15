/**
 * 好友与私聊 · 端到端测试
 * 起本地服务（mock 渠道）→ 注册两个用户 → 搜人 → 申请 → 同意 → 发消息 → 未读 → 删好友
 * 用法：node scripts/test-friends-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3411;
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
    return { raw: t.slice(0, 300) };
  }
};

const stamp = String(Date.now()).slice(-8);
const phoneA = '135' + stamp;
const phoneB = '133' + stamp;
const phoneC = '132' + stamp;

async function register(phone, nickname) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'friend123', nickname }),
  });
  const d = await j(r);
  if (!d.token) {
    // 已存在则登录（重复跑测试时）
    const r2 = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: 'friend123' }),
    });
    return (await j(r2)).token;
  }
  return d.token;
}

const H = (t) => ({ 'Content-Type': 'application/json', 'x-user-token': t });

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

  const tokenA = await register(phoneA, '好友测试A');
  const tokenB = await register(phoneB, '好友测试B');
  const tokenC = await register(phoneC, '路人C');
  ok('注册三个用户', Boolean(tokenA && tokenB && tokenC));
  if (!tokenA || !tokenB || !tokenC) throw new Error('注册失败');

  // 1. 未登录访问要 401
  let r = await fetch(`${BASE}/api/friends`);
  ok('未登录读好友列表 401', r.status === 401, String(r.status));

  const meA = (await j(await fetch(`${BASE}/api/auth/me`, { headers: H(tokenA) }))).viewer;
  const meB = (await j(await fetch(`${BASE}/api/auth/me`, { headers: H(tokenB) }))).viewer;
  ok('拿到双方 id', Boolean(meA && meB), `${meA && meA.id}/${meB && meB.id}`);

  // 2. 按手机号搜到 B
  r = await fetch(`${BASE}/api/friends/search?q=${phoneB}`, { headers: H(tokenA) });
  let d = await j(r);
  const found = (d.list || [])[0];
  ok('按手机号搜到人', Boolean(found) && found.nickname === '好友测试B', found && found.nickname);
  ok('陌生人关系为 none', found && found.relation === 'none', found && found.relation);
  ok('手机号脱敏展示', Boolean(found) && /\*\*\*\*/.test(found.phoneMasked || ''), found && found.phoneMasked);

  // 3. 按昵称模糊搜索（A 自己不该出现在结果里）
  r = await fetch(`${BASE}/api/friends/search?q=${encodeURIComponent('好友测试')}`, { headers: H(tokenA) });
  d = await j(r);
  ok(
    '按昵称模糊搜到人且排除自己',
    (d.list || []).some((u) => u.nickname === '好友测试B') && !(d.list || []).some((u) => u.id === (meA && meA.id)),
    (d.list || []).map((u) => u.nickname).join(',')
  );

  // 4. 不能加自己
  r = await fetch(`${BASE}/api/friends/request`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meA.id }),
  });
  ok('对自己加好友被拒绝', r.status === 400, String(r.status));

  // 5. A 给 B 发申请
  r = await fetch(`${BASE}/api/friends/request`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id }),
  });
  d = await j(r);
  ok('发送好友申请', r.status === 200 && d.status === 'pending', `${r.status} ${d.status}`);

  // 6. 重复申请复用同一条
  r = await fetch(`${BASE}/api/friends/request`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id }),
  });
  d = await j(r);
  ok('重复申请仍为 pending', d.status === 'pending', d.status);

  // 7. B 看到申请
  r = await fetch(`${BASE}/api/friends/requests`, { headers: H(tokenB) });
  d = await j(r);
  const inc = (d.incoming || [])[0];
  ok('B 收到好友申请', Boolean(inc) && inc.otherId === meA.id, inc && inc.nickname);

  // 8. B 同意
  r = await fetch(`${BASE}/api/friends/respond`, {
    method: 'POST',
    headers: H(tokenB),
    body: JSON.stringify({ id: inc.id, accept: true }),
  });
  d = await j(r);
  ok('同意好友申请', r.status === 200 && d.status === 'accepted', `${r.status} ${d.status}`);

  // 9. 重复处理被拒绝
  r = await fetch(`${BASE}/api/friends/respond`, {
    method: 'POST',
    headers: H(tokenB),
    body: JSON.stringify({ id: inc.id, accept: true }),
  });
  ok('重复处理申请 409', r.status === 409, String(r.status));

  // 10. 双方好友列表都有对方
  r = await fetch(`${BASE}/api/friends`, { headers: H(tokenA) });
  d = await j(r);
  ok('A 的好友列表含 B', (d.friends || []).some((f) => f.id === meB.id), String((d.friends || []).length));
  r = await fetch(`${BASE}/api/friends`, { headers: H(tokenB) });
  d = await j(r);
  ok('B 的好友列表含 A', (d.friends || []).some((f) => f.id === meA.id), String((d.friends || []).length));

  // 11. A 给 B 发消息
  r = await fetch(`${BASE}/api/dm/send`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id, text: '你好，我是 A' }),
  });
  d = await j(r);
  ok('发私聊消息', r.status === 200 && Boolean(d.message && d.message.id), `${r.status}`);

  // 12. B 的未读 +1
  r = await fetch(`${BASE}/api/dm/unread`, { headers: H(tokenB) });
  d = await j(r);
  ok('B 有 1 条未读', Number(d.unread) === 1, String(d.unread));

  // 13. B 读会话：拿到消息且未读清零
  r = await fetch(`${BASE}/api/dm/thread?userId=${encodeURIComponent(meA.id)}`, { headers: H(tokenB) });
  d = await j(r);
  ok('B 读到消息', (d.messages || []).length === 1 && (d.messages || [])[0].body === '你好，我是 A');
  ok('会话带对方昵称', d.friend && d.friend.nickname === '好友测试A', d.friend && d.friend.nickname);
  r = await fetch(`${BASE}/api/dm/unread`, { headers: H(tokenB) });
  d = await j(r);
  ok('读后未读清零', Number(d.unread) === 0, String(d.unread));

  // 14. 非好友不能发消息
  r = await fetch(`${BASE}/api/dm/send`, {
    method: 'POST',
    headers: H(tokenC),
    body: JSON.stringify({ toUserId: meA.id, text: '陌生人消息' }),
  });
  d = await j(r);
  ok('非好友发消息 403', r.status === 403, `${r.status} ${d.message || ''}`);

  // 15. 非好友不能读会话
  r = await fetch(`${BASE}/api/dm/thread?userId=${encodeURIComponent(meA.id)}`, { headers: H(tokenC) });
  ok('非好友读会话 403', r.status === 403, String(r.status));

  // 16. 空消息被拒绝
  r = await fetch(`${BASE}/api/dm/send`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id, text: '   ' }),
  });
  ok('空消息 400', r.status === 400, String(r.status));

  // 17. 删好友
  r = await fetch(`${BASE}/api/friends/remove`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ userId: meB.id }),
  });
  ok('删除好友', r.status === 200, String(r.status));
  r = await fetch(`${BASE}/api/friends`, { headers: H(tokenA) });
  d = await j(r);
  ok('删除后好友列表为空', (d.friends || []).length === 0, String((d.friends || []).length));

  r = await fetch(`${BASE}/api/dm/send`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id, text: '删了还能发吗' }),
  });
  ok('删除后不能发消息 403', r.status === 403, String(r.status));

  // 18. 重新加：B 主动申请，A 同意
  r = await fetch(`${BASE}/api/friends/request`, {
    method: 'POST',
    headers: H(tokenB),
    body: JSON.stringify({ toUserId: meA.id }),
  });
  d = await j(r);
  ok('重新申请', d.status === 'pending', d.status);
  r = await fetch(`${BASE}/api/friends/requests`, { headers: H(tokenA) });
  d = await j(r);
  const inc2 = (d.incoming || [])[0];
  ok('A 收到 B 的申请', Boolean(inc2) && inc2.otherId === meB.id);
  r = await fetch(`${BASE}/api/friends/respond`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ id: inc2.id, accept: true }),
  });
  ok('A 同意后重新成为好友', r.status === 200, String(r.status));

  // 19. 反向申请自动互加（A 删好友后 B 申请，A 直接申请 B 应自动通过）
  await fetch(`${BASE}/api/friends/remove`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ userId: meB.id }),
  });
  await fetch(`${BASE}/api/friends/request`, {
    method: 'POST',
    headers: H(tokenB),
    body: JSON.stringify({ toUserId: meA.id }),
  });
  r = await fetch(`${BASE}/api/friends/request`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id }),
  });
  d = await j(r);
  ok('对方已申请时直接互加', d.status === 'accepted', d.status);

  /* ---------------- 多媒体：图片 / 商品 / 转账 / 清空 ---------------- */
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  r = await fetch(`${BASE}/api/dm/send`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id, kind: 'image', payload: { dataUrl: PNG, w: 1, h: 1 } }),
  });
  d = await j(r);
  ok('发图片消息', r.status === 200 && d.message && d.message.kind === 'image', `${r.status} ${d.message && d.message.kind}`);

  r = await fetch(`${BASE}/api/dm/send`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id, kind: 'image', payload: { dataUrl: 'data:text/html;base64,AAA' } }),
  });
  ok('非图片类型被拒绝', r.status === 400, String(r.status));

  r = await fetch(`${BASE}/api/dm/send`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({
      toUserId: meB.id,
      kind: 'image',
      payload: { dataUrl: 'data:image/png;base64,' + 'A'.repeat(850000) },
    }),
  });
  ok('超大图片被拒绝', r.status === 400, String(r.status));

  // 商品卡片
  const boot = await j(await fetch(`${BASE}/api/bootstrap`));
  const goodsList = (boot.products || []).filter((p) => p.type !== 'recharge' && !p.contentId);
  const goods = goodsList[0];
  ok('拿到可分享商品', Boolean(goods && goods.id), goods && goods.title);

  r = await fetch(`${BASE}/api/dm/send`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id, kind: 'product', payload: { productId: goods.id } }),
  });
  d = await j(r);
  ok(
    '发商品卡片（价格以服务端为准）',
    r.status === 200 && d.message.kind === 'product' && d.message.payload.amount === goods.amount,
    `${r.status} ${d.message && d.message.payload && d.message.payload.amount}/${goods.amount}`
  );
  // 前端伪造价格应被忽略
  r = await fetch(`${BASE}/api/dm/send`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({
      toUserId: meB.id,
      kind: 'product',
      payload: { productId: goods.id, amount: 1, title: '假标题' },
    }),
  });
  d = await j(r);
  ok('伪造价格/标题被服务端覆盖', d.message && d.message.payload.amount === goods.amount && d.message.payload.title !== '假标题', d.message && String(d.message.payload.title));

  r = await fetch(`${BASE}/api/dm/send`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id, kind: 'product', payload: { productId: 'not-exist' } }),
  });
  ok('下架商品不能分享', r.status === 400, String(r.status));

  // 增量拉取
  const full = await j(await fetch(`${BASE}/api/dm/thread?userId=${meB.id}`, { headers: H(tokenA) }));
  const lastAt = full.messages[full.messages.length - 1].createdAt;
  const incRes = await j(
    await fetch(`${BASE}/api/dm/thread?userId=${meB.id}&after=${encodeURIComponent(new Date(lastAt + 1).toISOString())}`, {
      headers: H(tokenA),
    })
  );
  ok('增量拉取不带旧消息', (incRes.messages || []).length === 0, String((incRes.messages || []).length));

  // 转账：先充值
  const topupOrder = await j(
    await fetch(`${BASE}/api/orders`, { method: 'POST', headers: H(tokenA), body: JSON.stringify({ recharge: 2000 }) })
  );
  const payRes = await fetch(`${BASE}/api/orders/${topupOrder.order.id}/pay`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ channel: 'mock' }),
  });
  const payBody = await j(payRes);
  const paySign = new URL('http://x' + String(payBody.payUrl || '').replace(/^https?:\/\/[^/]+/, '')).searchParams.get('sign') || '';
  ok('A 充值下单', payRes.status === 200 && Boolean(paySign), String(payRes.status));
  // mock 渠道：确认收银台后由渠道回调入账
  await fetch(`${BASE}/api/pay/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: topupOrder.order.id, sign: paySign }),
  });
  await sleep(1600);

  const balA0 = (await j(await fetch(`${BASE}/api/auth/me`, { headers: H(tokenA) }))).viewer.balance;
  const balB0 = (await j(await fetch(`${BASE}/api/auth/me`, { headers: H(tokenB) }))).viewer.balance;

  r = await fetch(`${BASE}/api/dm/transfer`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id, amountFen: 150, note: 'aa 午饭' }),
  });
  d = await j(r);
  ok('转账成功', r.status === 200 && d.message && d.message.kind === 'transfer', `${r.status} ${d.message && d.message.kind}`);

  const balA1 = (await j(await fetch(`${BASE}/api/auth/me`, { headers: H(tokenA) }))).viewer.balance;
  const balB1 = (await j(await fetch(`${BASE}/api/auth/me`, { headers: H(tokenB) }))).viewer.balance;
  ok('A 余额扣减', balA1 === balA0 - 150, `${balA0} -> ${balA1}`);
  ok('B 余额入账', balB1 === balB0 + 150, `${balB0} -> ${balB1}`);

  r = await fetch(`${BASE}/api/dm/transfer`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id, amountFen: 900000 }),
  });
  ok('超单笔上限被拒', r.status === 400, String(r.status));

  r = await fetch(`${BASE}/api/dm/transfer`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ toUserId: meB.id, amountFen: balA1 + 1000 }),
  });
  ok('余额不足被拒', r.status === 400, String(r.status));

  r = await fetch(`${BASE}/api/dm/transfer`, {
    method: 'POST',
    headers: H(tokenC),
    body: JSON.stringify({ toUserId: meB.id, amountFen: 100 }),
  });
  ok('非好友不能转账', r.status === 403, String(r.status));

  // 列表预览文案
  const listA = await j(await fetch(`${BASE}/api/friends`, { headers: H(tokenA) }));
  const rowB = (listA.friends || []).find((x) => x.id === meB.id) || {};
  ok('会话预览带转账文案', String(rowB.lastBody || '').indexOf('[转账]') === 0, String(rowB.lastBody));

  // 清空记录：只清 A 侧
  r = await fetch(`${BASE}/api/dm/clear`, {
    method: 'POST',
    headers: H(tokenA),
    body: JSON.stringify({ userId: meB.id }),
  });
  ok('清空聊天记录', r.status === 200, String(r.status));
  const aAfter = await j(await fetch(`${BASE}/api/dm/thread?userId=${meB.id}`, { headers: H(tokenA) }));
  ok('A 侧已清空', (aAfter.messages || []).length === 0, String((aAfter.messages || []).length));
  const bAfter = await j(await fetch(`${BASE}/api/dm/thread?userId=${meA.id}`, { headers: H(tokenB) }));
  ok('B 侧记录仍在', (bAfter.messages || []).length > 0, String((bAfter.messages || []).length));

  console.log('\n测试账号：' + [phoneA, phoneB, phoneC].join(' / '));
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
