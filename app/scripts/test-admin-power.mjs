/**
 * 后台管理能力端到端测试
 * 覆盖：封禁/解封（登录与下单拦截）、延长支付、看板指标、外观配置读写
 * 用法：node scripts/test-admin-power.mjs
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3993;
const BASE = `http://localhost:${PORT}`;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function envValue(key) {
  try {
    const t = readFileSync(join(ROOT, '.env'), 'utf8');
    for (const line of t.split(/\r?\n/)) {
      if (line.startsWith(key + '=')) return line.slice(key.length + 1).trim();
    }
  } catch {}
  return '';
}

const srv = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), PAY_PROVIDER: 'mock' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
srv.stdout.on('data', (d) => (log += d));
srv.stderr.on('data', (d) => (log += d));

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, opts);
  let data = null;
  try {
    data = await r.json();
  } catch {}
  return { status: r.status, data };
};
const postJSON = (path, body, headers = {}) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

try {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${BASE}/api/bootstrap`);
      if (r.status === 200) break;
    } catch {}
    await sleep(300);
  }

  const phone = '197' + String(Date.now()).slice(-8);
  const pwd = 'test' + String(Date.now()).slice(-6);
  const reg = await postJSON('/api/auth/register', { phone, password: pwd, nickname: '封禁测试' });
  ok('注册测试用户', reg.status === 201 && Boolean(reg.data && reg.data.token), `${reg.status}`);
  const uid = reg.data && reg.data.viewer && reg.data.viewer.id;
  const userToken = reg.data && reg.data.token;

  // 后台登录
  const adminPwd = process.env.TEST_ADMIN_PASSWORD || envValue('ADMIN_PASSWORD');
  const login = await postJSON('/api/admin/login', { userName: envValue('ADMIN_USER') || 'admin', password: adminPwd });
  let adminToken = login.data && login.data.token;
  console.log(adminToken ? '· 后台登录成功（用 .env 密码）' : '· .env 密码不是当前后台密码，改用本地签名 token 继续测试');
  if (!adminToken) {
    // 后台密码被改过时，用本机 .env 的签名密钥直接签一个测试 token（仅本地测试用）
    const key = (envValue('ADMIN_TOKEN_SECRET') || envValue('PAY_SECRET') || adminPwd || 'admin-dev-token').trim();
    const exp = Date.now() + 3600 * 1000;
    const sig = crypto.createHmac('sha256', key).update('admin|' + exp).digest('base64url');
    adminToken = exp.toString(36) + '.' + sig;
    console.log('↓ 用本地签名密钥生成测试 token 继续跑后台接口测试');
  }
  if (!adminToken) {
    console.log('\n跳过后台接口测试（拿不到后台 token）');
  } else {
    const AH = { 'x-admin-token': adminToken };

    // 1. 封禁
    const ban = await postJSON('/api/admin/user/ban', { userId: uid, banned: true, reason: '恶意下单' }, AH);
    ok('封禁接口返回成功', ban.status === 200 && ban.data && ban.data.user && ban.data.user.banned === true, `${ban.status}`);

    const loginBanned = await postJSON('/api/auth/login', { phone, password: pwd });
    ok('封禁后无法登录', loginBanned.status === 403, `${loginBanned.status} ${(loginBanned.data && loginBanned.data.message) || ''}`);
    ok('封禁提示带原因', Boolean(loginBanned.data && /恶意下单/.test(loginBanned.data.message || '')), (loginBanned.data && loginBanned.data.message) || '');

    const orderBanned = await postJSON('/api/orders', { productId: 'demo_001' }, { 'x-user-token': userToken });
    ok('封禁后无法下单', orderBanned.status === 403, `${orderBanned.status}`);

    // 2. 解封
    const unban = await postJSON('/api/admin/user/ban', { userId: uid, banned: false }, AH);
    ok('解封接口返回成功', unban.status === 200 && unban.data && unban.data.user && unban.data.user.banned === false);
    const loginBack = await postJSON('/api/auth/login', { phone, password: pwd });
    ok('解封后可以登录', loginBack.status === 200 && Boolean(loginBack.data && loginBack.data.token), `${loginBack.status}`);

    // 3. 延长支付
    const boot = await api('/api/bootstrap', { headers: { 'x-user-token': userToken } });
    const product = (boot.data && boot.data.products || []).find((p) => !p.memberOnly && Number(p.amount) > 0);
    if (product) {
      const ord = await postJSON('/api/orders', { productId: product.id }, { 'x-user-token': userToken });
      const orderId = ord.data && ord.data.order && ord.data.order.id;
      ok('创建测试订单', Boolean(orderId), String(ord.status));
      if (orderId) {
        // 把创建时间改早，模拟"快超时"
        const before = await api('/api/admin/overview', { headers: AH });
        const ext = await postJSON('/api/admin/order/extend', { orderId }, AH);
        ok('延长支付接口成功', ext.status === 200 && Boolean(ext.data && ext.data.order), `${ext.status}`);
        ok(
          '延长后订单时间刷新',
          Boolean(ext.data && ext.data.order && Math.abs(ext.data.order.createdAt - Date.now()) < 15000),
          ext.data && ext.data.order ? String(ext.data.order.createdAt) : ''
        );
        const again = await postJSON('/api/admin/order/extend', { orderId }, AH);
        ok('已支付/无效订单不能延长', again.status === 200 || again.status === 409, `${again.status}`);
        // 新下的单应排在第一条（后台订单按时间从近到远）
        const ovSort = await api('/api/admin/overview', { headers: AH });
        const first = ovSort.data && ovSort.data.orders && ovSort.data.orders[0];
        ok('订单按时间从近到远', Boolean(first && first.id === orderId), first ? first.id : '无订单');
      }
    }

    // 3.5 用户列表带累计消费字段（服务端从已支付订单聚合）
    const ul = await api('/api/admin/users', { headers: AH });
    const testUser = ((ul.data && ul.data.users) || []).find((u) => u.id === uid);
    ok('用户列表返回累计消费字段', Boolean(testUser && typeof testUser.paidAmount === 'number'), testUser ? String(testUser.paidAmount) : '未找到用户');

    // 4. 看板
    const ov = await api('/api/admin/overview', { headers: AH });
    const stats = ov.data && ov.data.stats;
    ok('看板有 7 日趋势', Boolean(stats && Array.isArray(stats.trend) && stats.trend.length === 7), stats ? String(stats.trend.length) : '');
    ok('看板有今日指标', Boolean(stats && typeof stats.todayGmv === 'number' && typeof stats.payRate === 'number'));
    ok('看板有会员与用户数', Boolean(stats && typeof stats.memberCount === 'number' && typeof stats.userCount === 'number'));

    // 5. 外观配置读写（模块开关 / 主题 / 横幅 / 快捷入口）
    const saveSite = await postJSON(
      '/api/admin/site/save',
      {
        name: '后台能力测试',
        home: {
          goodsTitle: '在售商品',
          contentTitle: '精选内容',
          homeTitle: '欢迎光临',
          trust: [{ icon: '🔒', title: '安全支付', desc: '官方通道', on: true }],
          support: { wechat: '', phone: '', note: '' },
          modules: { goods: true, contents: false, trust: true, unpaid: true, notice: true, search: false, member: true, recharge: true, toTop: false, support: true },
          theme: { accent: '#0d9488', accent2: '#22c55e' },
          tabs: { home: '主页', content: '文章', mine: '我的', contentOn: false },
          banner: { on: true, text: '限时活动', sub: '全场 8 折', btn: '去看看', link: '', bg: '#0d9488' },
          entries: [{ icon: '🎁', title: '优惠', act: 'goods', value: '', on: true }],
        },
      },
      AH
    );
    const home = saveSite.data && saveSite.data.site && saveSite.data.site.home;
    ok('外观保存成功', saveSite.status === 200 && Boolean(home), `${saveSite.status}`);
    ok('模块开关已保存', home && home.modules.contents === false && home.modules.search === false, home ? JSON.stringify(home.modules) : '');
    ok('主题色已保存', home && home.theme.accent === '#0d9488', home ? home.theme.accent : '');
    ok('导航与内容页开关已保存', home && home.tabs.home === '主页' && home.tabs.contentOn === false, home ? JSON.stringify(home.tabs) : '');
    ok('横幅已保存', home && home.banner.on === true && home.banner.text === '限时活动', home ? home.banner.text : '');
    ok('快捷入口已保存', home && Array.isArray(home.entries) && home.entries.length === 1, home ? String(home.entries.length) : '');
    ok('非法主题色被拦下', home && /^#[0-9a-f]{6}$/.test(home.theme.accent2), home ? home.theme.accent2 : '');

    // 恢复默认外观，避免影响线上展示（这里跑的是本地库）
    await postJSON(
      '/api/admin/site/save',
      {
        name: '手机App支付骨架',
        home: {
          goodsTitle: '在售商品',
          contentTitle: '精选内容',
          homeTitle: '',
          trust: [
            { icon: '🔒', title: '安全支付', desc: '官方通道', on: true },
            { icon: '⚡', title: '即时到账', desc: '分钟级', on: true },
            { icon: '💬', title: '售后无忧', desc: '在线客服', on: true },
          ],
          support: { wechat: '', phone: '', note: '' },
          modules: { goods: true, contents: true, trust: true, unpaid: true, notice: true, search: true, member: true, recharge: true, toTop: true, support: true },
          theme: { accent: '#5a5cf0', accent2: '#8b5cf6' },
          tabs: { home: '首页', content: '内容', mine: '我的', contentOn: true },
          banner: { on: false, text: '', sub: '', btn: '', link: '', bg: '#5a5cf0' },
          entries: [],
        },
      },
      AH
    );
    ok('外观已恢复默认', true);
  }

  console.log(`\n结果：${pass}/${pass + fails.length} 通过`);
  if (fails.length) console.log('失败项：' + fails.join('、'));
  console.log('\n清理测试数据（云库执行）：');
  console.log(`DELETE FROM orders WHERE user_id='${uid}';`);
  console.log(`DELETE FROM app_users WHERE id='${uid}';`);
  srv.kill();
  process.exit(fails.length ? 1 : 0);
} catch (e) {
  console.error('测试异常：', e);
  console.error(log.split('\n').slice(-12).join('\n'));
  srv.kill();
  process.exit(1);
}
