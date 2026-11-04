/**
 * 用户中心 UI 自测（jsdom + 假 fetch）
 * 覆盖：未登录登录页 / 登录成功 / 用户中心各区块 / 分享 / 设置弹层 / 退出
 * 用法：node scripts/test-user-ui.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const appJs = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');

const VIEWER = {
  id: 'u_abc123456789',
  nickname: '测试用户',
  phone: '13800001234',
  phoneMasked: '138****1234',
  initial: '测',
  points: 100,
  coupons: [
    { id: 'c1', title: '新人立减 5 元', amount: 500, expiresAt: Date.now() + 86400000 },
    { id: 'c2', title: '满 20 减 3 元', amount: 300, expiresAt: Date.now() + 86400000 },
  ],
  address: { name: '张三', phone: '13800001234', detail: '北京市朝阳区测试路 1 号' },
  balance: 1200,
  createdAt: Date.now() - 86400000,
  memberLevel: 'member',
  memberExpire: Date.now() + 15 * 86400000,
  autoRenew: false,
  orders: [
    { id: 'O1', productId: 'demo_001', title: '会员月卡', amount: 1200, status: 'paid', createdAt: Date.now() },
    {
      id: 'O2',
      productId: 'demo_001',
      title: '测试商品',
      amount: 1200,
      status: 'pending',
      channel: 'alipay_qr',
      channelName: '支付宝扫码',
      createdAt: Date.now() - 60000,
    },
    // 40 分钟前创建、一直没支付：超过 30 分钟，服务端已删除，前端也不该再展示
    { id: 'O3', title: '超时未支付订单', amount: 500, status: 'created', createdAt: Date.now() - 40 * 60 * 1000 },
  ],
};

const BOOTSTRAP = {
  user: { id: 'demo-user', nickname: '游客' },
  loggedIn: false,
  balance: 0,
  provider: 'mock',
  payScene: 'native',
  wechatReady: false,
  wxMchId: null,
  cloud: { ready: true, endpoint: 'x' },
  site: { name: '手机App支付骨架', tagline: '', hasIcon: false, iconUrl: null, iconVer: 'default' },
  products: [
    { id: 'demo_001', title: '测试商品', amount: 1, desc: 'x', tag: '示例' },
    { id: 'member_month', title: '会员月卡', amount: 1200, desc: '30 天权益', tag: '会员', memberDays: 30 },
    { id: 'vip_kit', title: '会员专属礼包', amount: 1900, desc: '仅会员可买', tag: '', memberOnly: true, memberPrice: 990, image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' },
  ],
  contents: [
    { id: 'n1', title: '新人立减 5 元', desc: '注册即送，首单可用', tag: '活动', image: null, link: '', sort: 1, active: true },
    { id: 'n2', title: '怎么用余额支付', desc: '先充值，下单时选余额', tag: '', image: null, link: '/faq', sort: 2, active: true },
    { id: 'n3', title: '会员专享攻略', desc: '', tag: '', image: null, link: '', sort: 3, active: true, membersOnly: true, locked: true },
  ],
  orders: [],
};

let token = '';
const calls = [];
function fakeFetch(url, opts = {}) {
  const path = String(url).split('?')[0];
  const method = (opts.method || 'GET').toUpperCase();
  const auth = (opts.headers && opts.headers.Authorization) || '';
  if (auth) token = String(auth).replace(/^Bearer\s+/i, '');
  let body = null;
  try {
    body = opts.body ? JSON.parse(opts.body) : null;
  } catch {
    body = null;
  }
  calls.push({ path, method, auth: Boolean(auth), body });

  const json = (body, status = 200) =>
    Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    });

  if (path === '/api/bootstrap') return json({ ...BOOTSTRAP, orders: token ? VIEWER.orders : [] });
  if (path === '/api/orders' && method === 'GET') return json({ orders: token ? VIEWER.orders : [] });
  if (path === '/api/orders/O2/pay') {
    // 模拟「上次其实已经付成功、只是回调没到」：服务端直接回已付，不再重复收款
    const paid = { ...VIEWER.orders[1], status: 'paid', paidAt: Date.now() };
    VIEWER.orders[1] = paid;
    return json({ mode: 'already_paid', order: paid });
  }
  if (path === '/api/auth/login') return json({ token: 'tk_test', viewer: VIEWER });
  if (path === '/api/auth/register') return json({ token: 'tk_test', viewer: VIEWER }, 201);
  if (path === '/api/auth/me') return token ? json({ viewer: VIEWER }) : json({ message: '未登录' }, 401);
  if (path === '/api/auth/profile') {
    const body = JSON.parse(opts.body || '{}');
    Object.assign(VIEWER, body);
    if (body.nickname) VIEWER.initial = body.nickname.slice(0, 1);
    return json({ viewer: VIEWER });
  }
  if (path === '/api/auth/password') return json({ ok: true });
  if (path === '/api/balance/logs')
    return json({
      logs: [
        { id: 1, delta: 3000, kind: 'recharge', ref: 'OABC', balanceAfter: 4200, createdAt: Date.now() - 60000 },
        { id: 2, delta: -1200, kind: 'pay', ref: 'O1', balanceAfter: 1200, createdAt: Date.now() - 120000 },
      ],
    });
  if (path === '/api/orders' && method === 'POST' && body && body.recharge)
    return json({ order: { id: 'OR1', title: '余额充值 ¥30.00', amount: body.recharge, status: 'created', createdAt: Date.now() } }, 201);
  return json({}, 404);
}

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/?sharecode=TESTCODE' });
const { window } = dom;
window.fetch = fakeFetch;
Object.defineProperty(window, 'localStorage', {
  value: {
    store: {},
    getItem(k) {
      return this.store[k] || null;
    },
    setItem(k, v) {
      this.store[k] = String(v);
    },
    removeItem(k) {
      delete this.store[k];
    },
    clear() {
      this.store = {};
    },
  },
});
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.navigator.standalone = false;

// 执行 app.js
window.eval(appJs);

const $ = (s) => window.document.querySelector(s);
const text = (s) => ($(s) ? $(s).textContent.replace(/\s+/g, ' ').trim() : '');
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function closeSheetForTest() {
  const mask = window.document.querySelector('#mask');
  if (mask) mask.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

async function goMine() {
  const tab = [...window.document.querySelectorAll('.tab')].find((t) => t.dataset.tab === 'mine');
  tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(30);
}

await wait(120);

// 0. 首页：商品卡片 + 后台配置的内容卡片
check('首页商品卡片', window.document.querySelectorAll('.goods-card').length === 3, text('.goods-name'));
// 商品图：后台配了图就显示图片，没配图回退到默认图标
const imgCard = [...window.document.querySelectorAll('.goods-card')].find((c) => c.dataset.id === 'vip_kit');
const plainCard = [...window.document.querySelectorAll('.goods-card')].find((c) => c.dataset.id === 'demo_001');
check(
  '商品图前台渲染',
  Boolean(imgCard) && Boolean(imgCard.querySelector('.goods-thumb img')?.getAttribute('src')?.startsWith('data:image/png')),
  imgCard ? imgCard.querySelector('.goods-thumb img')?.getAttribute('src')?.slice(0, 32) || '' : ''
);
check(
  '无图商品回退默认图标',
  Boolean(plainCard) && Boolean(plainCard.querySelector('.goods-emoji')) && !plainCard.querySelector('.goods-thumb'),
  plainCard ? plainCard.textContent.replace(/\s+/g, ' ').trim() : ''
);
// 会员专享：角标 + 会员价（当前登录用户是会员，应按会员价展示并划线原价）
const vipCard = [...window.document.querySelectorAll('.goods-card')].find((c) => c.dataset.id === 'vip_kit');
check('会员专享商品有角标', Boolean(vipCard) && vipCard.textContent.includes('会员专享'), vipCard ? vipCard.textContent.replace(/\s+/g, ' ').trim() : '');
check(
  '游客看到原价并引导开通会员',
  Boolean(vipCard) && vipCard.textContent.includes('19.00') && vipCard.textContent.includes('开通会员'),
  vipCard ? vipCard.textContent.replace(/\s+/g, ' ').trim() : ''
);
const lockedCard = [...window.document.querySelectorAll('.content-card')].find((c) => c.textContent.includes('会员专享攻略'));
check('会员专享内容有锁标', Boolean(lockedCard) && lockedCard.textContent.includes('会员专享'), lockedCard ? lockedCard.textContent.replace(/\s+/g, ' ').trim() : '');
check('锁态内容不下发正文', Boolean(lockedCard) && lockedCard.textContent.includes('开通会员后查看全文'));
check(
  '首页显示后台配置的内容',
  window.document.querySelectorAll('.content-card').length === 3 && text('.section-head').length >= 0,
  String(window.document.querySelectorAll('.content-card').length)
);
check('首页内容标题正确', text('.content-title').includes('新人立减'), text('.content-title'));
check('未登录时首页头像显示占位', text('.hero-avatar').includes('游'), text('.hero-avatar'));

// 0.1 首页新增：服务保障条 / 商品搜索 / 筛选 chips
check('首页有服务保障条', window.document.querySelectorAll('.trust-item').length === 3, String(window.document.querySelectorAll('.trust-item').length));
check('首页有商品搜索框', Boolean($('#goodsSearch')));
check(
  '首页有商品筛选 chips',
  window.document.querySelectorAll('.gchip').length >= 2,
  [...window.document.querySelectorAll('.gchip')].map((c) => c.textContent.trim()).join(',')
);

const searchInput = $('#goodsSearch');
searchInput.value = '会员';
searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
await wait(30);
check(
  '搜索按关键词过滤',
  window.document.querySelectorAll('.goods-card').length === 2 &&
    [...window.document.querySelectorAll('.goods-card')].every((c) => c.textContent.includes('会员')),
  String(window.document.querySelectorAll('.goods-card').length)
);
check('搜索结果计数更新', text('#goodsMeta').includes('/'), text('#goodsMeta'));

searchInput.value = '不存在的商品';
searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
await wait(30);
check('搜索无结果给空态', Boolean($('.goods-none')), text('.goods-none'));
$('[data-act="goods-clear"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
check('清空搜索恢复全部商品', window.document.querySelectorAll('.goods-card').length === 3, String(window.document.querySelectorAll('.goods-card').length));

$('[data-act="goods-filter"][data-f="member"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
check('筛选「会员专享」只剩专享商品', window.document.querySelectorAll('.goods-card').length === 1 && $('.goods-card').dataset.id === 'vip_kit', String(window.document.querySelectorAll('.goods-card').length));
$('[data-act="goods-filter"][data-f="all"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
check('筛选「全部」恢复', window.document.querySelectorAll('.goods-card').length === 3, String(window.document.querySelectorAll('.goods-card').length));

// 1. 未登录：登录页
await goMine();
check('未登录显示登录页', !!$('#authPhone') && !!$('#authPwd'));
check('登录页有登录/注册按钮', !!$('[data-act="login"]') && !!$('[data-act="register"]'));
check('登录页标题', text('.auth-head h2') === '登录后使用', text('.auth-head h2'));

// 2. 非法手机号拦截
$('#authPhone').value = '123';
$('#authPwd').value = '123456';
$('[data-act="login"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('非法手机号被拦截', text('#toast').includes('11 位手机号'), text('#toast'));
check('未发起登录请求', !calls.some((c) => c.path === '/api/auth/login'));

// 3. 正常登录
$('#authPhone').value = '13800001234';
$('#authPwd').value = 'test123456';
$('[data-act="login"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(80);
token = window.localStorage.getItem('user_token_v1');
check('登录后写入令牌', token === 'tk_test', String(token));
// 登录后回首页：会员价生效（当前测试用户为生效中会员）
[...window.document.querySelectorAll('.tab')].find((t) => t.dataset.tab === 'home').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
const vipCard2 = [...window.document.querySelectorAll('.goods-card')].find((c) => c.dataset.id === 'vip_kit');
check(
  '会员看到会员价与划线原价',
  Boolean(vipCard2) && vipCard2.textContent.includes('9.90') && Boolean(vipCard2.querySelector('s')) && vipCard2.textContent.includes('19.00'),
  vipCard2 ? vipCard2.textContent.replace(/\s+/g, ' ').trim() : ''
);
check(
  '已买过的商品显示「已购」',
  (() => {
    const c = [...window.document.querySelectorAll('.goods-card')].find((x) => x.dataset.id === 'demo_001');
    return Boolean(c) && Boolean(c.querySelector('.goods-owned'));
  })(),
  (window.document.querySelector('.goods-card .goods-owned') || {}).textContent || '无'
);
check('会员点会员专享直接进收银台', (() => {
  vipCard2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return true;
})());
await wait(60);
check('会员专享商品可正常下单', Boolean($('.sheet [data-act="pay"]')) && text('.sheet .amount-big').includes('9.90'), text('.sheet .amount-big'));
closeSheetForTest();
await wait(40);
await goMine();
check('登录请求已发出', calls.some((c) => c.path === '/api/auth/login' && c.method === 'POST'));
check(
  '底部「我的」有待支付角标',
  (() => {
    const b = window.document.querySelector('.tab[data-tab="mine"] .tab-badge');
    return Boolean(b) && b.textContent === '1';
  })(),
  (window.document.querySelector('.tab[data-tab="mine"] .tab-badge') || {}).textContent || '无'
);

// 4. 用户中心各区块
check('显示昵称', text('.profile-name').includes('测试用户'), text('.profile-name'));
check('显示脱敏手机号', text('.profile-sub').includes('138****1234'), text('.profile-sub'));
const stats = [...window.document.querySelectorAll('.stat b')].map((e) => e.textContent.trim());
check('余额/积分两项', stats.length === 2 && stats[0] === '¥12.00' && stats[1] === '100', stats.join(','));
check('收货地址已显示', text('.addr-name').includes('张三') && text('.addr-detail').includes('北京市'), text('.addr-detail'));
check('页面已无优惠券区块', !text('#view').includes('优惠券') && window.document.querySelectorAll('.coupon').length === 0);
check('会员卡显示生效中', text('.member-card').includes('会员生效中') && text('.member-card').includes('剩'), text('.member-card'));

// 4.1 会员中心 + 自动续费开关
$('[data-act="open-member"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('会员中心弹层', text('.sheet h3') === '会员中心', text('.sheet h3'));
check('会员商品列出', window.document.querySelectorAll('.member-item').length === 1);
check('自动续费开关存在', Boolean($('.autorenew-row')) && !$('.autorenew-row').classList.contains('on'));
$('.autorenew-row').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
check('开启自动续费请求', calls.some((c) => c.path === '/api/auth/profile' && c.body && c.body.autoRenew === true));
check('开关状态切换为开', $('.autorenew-row').classList.contains('on'));
$('.sheet [data-act="close"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
check('会员卡显示自动续费角标', text('.member-card').includes('自动续费已开启'), text('.member-card'));

// 4.2 余额中心：流水 + 充值
$('[data-act="open-balance"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(120);
check('余额中心弹层', text('.sheet h3') === '余额中心', text('.sheet h3'));
check('余额流水两行', window.document.querySelectorAll('.bal-row').length === 2, String(window.document.querySelectorAll('.bal-row').length));
check('流水有充值入账', text('.bal-logs').includes('+¥30.00') && text('.bal-logs').includes('充值'), text('.bal-logs').replace(/\s+/g, ' ').slice(0, 80));
$('[data-act="recharge"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
check('充值弹层金额档', window.document.querySelectorAll('.rchip').length === 5, String(window.document.querySelectorAll('.rchip').length));
$('[data-act="recharge-go"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
check('充值进确认单且无余额渠道', text('.sheet h3') === '确认订单' && !text('.pay-list').includes('余额'), text('.sheet h3'));
$('#mask').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);

check('头像可点击更换', Boolean($('.avatar-btn')) && text('.avatar-btn').includes('📷'), text('.avatar-btn'));
$('[data-act="edit-avatar"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('头像弹层可换图', text('.sheet h3') === '我的头像' && Boolean($('[data-act="pick-avatar"]')), text('.sheet h3'));
$('.sheet [data-act="close"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
check('订单入口存在且页面不直接铺订单', Boolean($('[data-act="open-orders"]')) && window.document.querySelectorAll('.order-row').length === 0);
$('[data-act="open-orders"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('订单列表', window.document.querySelectorAll('.sheet .order-row').length === 2, text('.sheet .order-title'));
check(
  '超时未支付订单不展示',
  ![...window.document.querySelectorAll('.sheet .order-row')].some((r) => r.dataset.id === 'O3'),
  [...window.document.querySelectorAll('.sheet .order-row')].map((r) => r.dataset.id).join(',')
);
check(
  '待支付订单显示剩余时间倒计时',
  Boolean($('.sheet .order-count')) && /剩余 \d+:\d{2}/.test(text('.sheet .order-count')),
  text('.sheet .order-count')
);
check('分享区存在', !!$('[data-act="share-copy"]') && !!$('[data-act="share-more"]') && !!$('[data-act="share-qr"]'));
check('设置中心入口存在', Boolean($('[data-act="settings"]')) && window.document.querySelectorAll('.set-row').length === 1);

// 4b. 「支付中」订单：点进去直接进支付界面，且复用同一笔订单付款
const pendingRow = [...window.document.querySelectorAll('.sheet .order-row')].find((r) => r.dataset.id === 'O2');
check('待支付订单有「继续支付」提示', Boolean(pendingRow) && pendingRow.textContent.includes('继续支付'), pendingRow ? pendingRow.textContent.replace(/\s+/g, ' ').trim() : '');
check('待支付筛选包含支付中订单', text('.sheet .mchips').includes('待支付 1'), text('.sheet .mchips'));
pendingRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('点支付中订单直接进支付界面', text('.sheet h3') === '继续支付', text('.sheet h3'));
check(
  '支付界面显示原订单号与金额',
  text('.sheet .sheet-sub').includes('O2') && text('.amount-big').includes('12.00'),
  text('.sheet .sheet-sub')
);
check('支付界面有立即支付按钮', Boolean($('.sheet [data-act="pay-order"]')));
$('.sheet [data-act="pay-order"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(140);
const payCall = calls.filter((c) => c.path === '/api/orders/O2/pay' && c.method === 'POST').pop();
check(
  '继续支付复用同一笔订单，不新建',
  Boolean(payCall) && !calls.some((c) => c.path === '/api/orders' && c.method === 'POST'),
  payCall ? JSON.stringify(payCall.body) : '未发出支付请求'
);
check('已付款时直接给成功反馈', text('.success-title') === '支付成功', text('.success-title'));
$('.sheet [data-act="close"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
$('[data-act="open-orders"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('支付后列表状态同步为已支付', window.document.querySelectorAll('.sheet .status.paid').length === 2);
$('.sheet [data-act="close"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);

// 5. 分享：复制链接
let copied = '';
window.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
window.isSecureContext = true;
$('[data-act="share-copy"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('复制的是带 sharecode 的链接', copied === 'https://example.com/?sharecode=TESTCODE', copied);

// 6. 二维码弹层
$('[data-act="share-qr"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
const qrSrc = ($('.qr-img') || {}).src || '';
check('二维码图片地址含 t 参数', qrSrc.includes('/api/qr?t=') && qrSrc.includes('sharecode=TESTCODE'), qrSrc.slice(0, 60));
$('.sheet [data-act="close"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);

// 7. 改昵称
$('[data-act="edit-nickname"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('改昵称弹层输入框有当前值', ($('#nickInput') || {}).value === '测试用户');
$('#nickInput').value = '新名字';
$('[data-act="save-nickname"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(80);
check('昵称已更新到页面', text('.profile-name').includes('新名字'), text('.profile-name'));

// 7b. 设置中心：分组设置项 + 深色模式开关
$('[data-act="settings"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
const setRows = [...window.document.querySelectorAll('.sheet .set-row')].map((e) => e.textContent.trim());
check(
  '设置中心项目齐全',
  ['修改密码', '收货地址', '深色模式', '刷新数据', '清除缓存', '关于', '退出登录'].every((k) => setRows.some((r) => r.includes(k))),
  setRows.join(' | ')
);
check('设置中心分组标题', window.document.querySelectorAll('.sheet .sheet-group').length === 4, window.document.querySelectorAll('.sheet .sheet-group').length + ' 组');
$('.sheet [data-act="toggle-dark"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('深色模式可开启', window.document.body.classList.contains('dark'));
check('深色模式已记忆', window.localStorage.getItem('dark_mode') === '1');
$('.sheet [data-act="toggle-dark"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('深色模式可关闭', !window.document.body.classList.contains('dark'));

// 8. 改地址
$('[data-act="edit-address"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
$('#addrName').value = '李四';
$('#addrPhone').value = '13900001111';
$('#addrDetail').value = '上海市浦东新区测试路 2 号';
$('[data-act="save-address"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(80);
check('地址已更新', text('.addr-name').includes('李四') && text('.addr-detail').includes('上海市'), text('.addr-detail'));

// 9. 改密码校验（从设置中心进入）
$('[data-act="settings"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
$('.sheet [data-act="change-password"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
$('#pwdOld').value = 'test123456';
$('#pwdNew').value = '123';
$('[data-act="save-password"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('新密码过短被拦截', text('#toast').includes('至少 6 位'), text('#toast'));
$('#pwdNew').value = 'newpass123';
$('[data-act="save-password"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
check('改密码成功请求', calls.some((c) => c.path === '/api/auth/password'));

// 10. 关于（从设置中心进入）
$('[data-act="settings"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
$('.sheet [data-act="about"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('关于弹层显示应用名', text('.about-name').includes('手机App支付骨架'), text('.about-name'));
$('.sheet [data-act="close"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);

// 11. 退出登录（从设置中心进入）
$('[data-act="settings"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
$('.sheet [data-act="logout"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
check('退出后清空令牌', !window.localStorage.getItem('user_token_v1'));
check('退出后回到登录页', !!$('#authPhone') && !$('.stat-row'));

// 12. 未登录点购买 → 引导登录
const homeTab = [...window.document.querySelectorAll('.tab')].find((t) => t.dataset.tab === 'home');
homeTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
const buyBtn = $('[data-act="buy"]');
if (buyBtn) {
  buyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  check('未登录购买被引导到登录', !!$('#authPhone'), text('#toast'));
} else {
  check('首页有购买按钮', false, '未找到 buy 按钮');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'));
  process.exit(1);
}
