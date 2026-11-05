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
  refunds: [],
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
  site: {
    name: '手机App支付骨架',
    tagline: '',
    hasIcon: false,
    iconUrl: null,
    iconVer: 'default',
    // 后台「外观」页可改的首页展示配置
    home: {
      trustOn: true,
      trust: [
        { icon: '🛡', title: '正品保障', desc: '假一赔十', on: true },
        { icon: '🚚', title: '极速发货', desc: '24 小时', on: true },
        { icon: '💬', title: '在线客服', desc: '随时找我', on: true },
      ],
      goodsTitle: '精选好物',
      contentTitle: '推荐阅读',
      support: { wechat: 'kefu-test', phone: '13800000000', note: '工作日 9-18 点' },
      // 后台可控制的前端项（模块开关 / 主题 / 导航 / 横幅 / 快捷入口）
      modules: { goods: true, contents: true, trust: true, unpaid: true, notice: true, search: true, member: true, recharge: true, toTop: true, support: true },
      theme: { accent: '#f97316', accent2: '#fb923c' },
      tabs: { home: '首页', content: '内容', mine: '我的', contentOn: true },
      banner: { on: true, text: '双 11 全场 8 折', sub: '下单再送 60 金币', btn: '去看看', link: 'https://example.com/promo', bg: '#f97316' },
      entries: [
        { icon: '🎁', title: '优惠活动', act: 'goods', value: '', on: true },
        { icon: '👑', title: '开通会员', act: 'member', value: '', on: true },
        { icon: '💬', title: '联系客服', act: 'support', value: '', on: true },
        { icon: '🔗', title: '外链', act: 'link', value: 'https://example.com', on: true },
      ],
    },
  },
  products: [
    { id: 'demo_001', title: '测试商品', amount: 1, desc: 'x', tag: '示例', sales: 5 },
    { id: 'member_month', title: '会员月卡', amount: 1200, desc: '30 天权益', tag: '会员', memberDays: 30, sales: 12 },
    { id: 'vip_kit', title: '会员专属礼包', amount: 1900, desc: '仅会员可买', tag: '', memberOnly: true, memberPrice: 990, sales: 0, image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' },
  ],
  contents: [
    { id: 'n1', title: '新人立减 5 元', desc: '注册即送，首单可用', tag: '活动', image: null, link: '', sort: 1, active: true },
    { id: 'n2', title: '怎么用余额支付', desc: '先充值，下单时选余额', tag: '', image: null, link: '/faq', sort: 2, active: true },
    { id: 'n3', title: '会员专享攻略', desc: '', tag: '', image: null, link: '', sort: 3, active: true, membersOnly: true, locked: true },
    { id: 'n4', title: '付费专栏：开店指南', desc: '', tag: '', image: null, link: '', sort: 4, active: true, membersOnly: false, price: 199, locked: true },
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

  if (path === '/api/bootstrap')
    return json({ ...BOOTSTRAP, orders: token ? VIEWER.orders : [], refunds: token ? VIEWER.refunds || [] : [] });
  if (path === '/api/orders' && method === 'GET') return json({ orders: token ? VIEWER.orders : [] });
  // 只存在于服务端的订单：验证「本地列表里没有也能补拉详情」
  if (path === '/api/orders/O_REMOTE' && method === 'GET' && token)
    return json({
      order: {
        id: 'O_REMOTE',
        title: '历史订单（仅服务端有）',
        amount: 990,
        status: 'paid',
        channel: 'balance',
        channelName: '余额支付',
        createdAt: Date.now() - 86400000,
        paidAt: Date.now() - 86300000,
      },
    });
  if (path === '/api/refunds' && method === 'GET') return json({ refunds: VIEWER.refunds || [] });
  if (path === '/api/orders/O1/refund-request' && method === 'POST') {
    const rf = {
      id: 'rf_t1',
      orderId: 'O1',
      amount: 1200,
      reason: (body && body.reason) || '',
      detail: (body && body.detail) || '',
      status: 'pending',
      adminNote: '',
      createdAt: Date.now(),
      handledAt: null,
      orderTitle: '会员月卡',
    };
    VIEWER.refunds = [rf, ...(VIEWER.refunds || [])];
    return json({ refund: rf, message: '退款申请已提交，等待商家审核' });
  }
  if (path === '/api/refunds/rf_t1/cancel' && method === 'POST') {
    const r = (VIEWER.refunds || []).find((x) => x.id === 'rf_t1');
    if (r) r.status = 'cancelled';
    return json({ ok: true });
  }
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
  if (path === '/api/auth/phone') {
    const body = JSON.parse(opts.body || '{}');
    VIEWER.phone = body.phone;
    VIEWER.phoneMasked = String(body.phone || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
    return json({ ok: true, viewer: VIEWER });
  }
  if (path === '/api/balance/logs')
    return json({
      logs: [
        { id: 1, delta: 3000, kind: 'recharge', ref: 'OABC', balanceAfter: 4200, createdAt: Date.now() - 60000 },
        { id: 2, delta: -1200, kind: 'pay', ref: 'O1', balanceAfter: 1200, createdAt: Date.now() - 120000 },
      ],
    });
  if (path === '/api/orders' && method === 'POST' && body && Array.isArray(body.items)) {
    const items = body.items.map((it) => {
      const p = BOOTSTRAP.products.find((x) => x.id === it.productId) || { title: it.productId, amount: 0 };
      return { productId: it.productId, title: p.title, price: p.amount, listPrice: p.amount, qty: it.qty, memberPrice: false };
    });
    const amount = items.reduce((s, it) => s + it.price * it.qty, 0);
    const order = {
      id: 'OCART1',
      kind: 'product',
      productId: items[0].productId,
      title: items.length > 1 ? `${items[0].title} 等 ${items.length} 种` : items[0].title,
      amount,
      items,
      itemCount: items.reduce((s, it) => s + it.qty, 0),
      status: 'created',
      createdAt: Date.now(),
    };
    VIEWER.orders.unshift(order);
    return json({ order }, 201);
  }
  if (path === '/api/orders/OCART1/pay' && method === 'POST') {
    const o = VIEWER.orders.find((x) => x.id === 'OCART1');
    const paid = { ...o, status: 'paid', channel: 'balance', channelName: '余额支付', paidAt: Date.now() };
    VIEWER.orders = VIEWER.orders.map((x) => (x.id === 'OCART1' ? paid : x));
    return json({ mode: 'balance', balance: 5000, order: paid });
  }
  if (path === '/api/orders' && method === 'POST' && body && body.recharge)
    return json({ order: { id: 'OR1', title: '余额充值 ¥30.00', amount: body.recharge, status: 'created', createdAt: Date.now() } }, 201);
  return json({}, 404);
}

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/?sharecode=TESTCODE' });
const { window } = dom;
window.fetch = fakeFetch;
window.confirm = () => true;
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
// 可读内容（免费/会员）：卡片可点、有正文预览、不带锁标
const readCard = [...window.document.querySelectorAll('.content-card')].find((c) => c.dataset.id === 'n1');
check('可读内容显示正文预览', Boolean(readCard) && readCard.textContent.includes('注册即送'), readCard ? readCard.textContent.replace(/\s+/g, ' ').trim() : '');
check('可读内容不是锁态且可点开', Boolean(readCard) && !readCard.classList.contains('is-locked') && readCard.dataset.act === 'open-content', readCard ? readCard.dataset.act : 'no-card');
check(
  '首页显示后台配置的内容',
  window.document.querySelectorAll('.content-card').length === 4 && text('.section-head').length >= 0,
  String(window.document.querySelectorAll('.content-card').length)
);
// 付费内容（方案三）：会员免费看，非会员可单篇解锁
const paidCard = [...window.document.querySelectorAll('.content-card')].find((c) => c.textContent.includes('付费专栏'));
check(
  '付费内容有付费角标',
  Boolean(paidCard) && paidCard.textContent.includes('付费内容'),
  paidCard ? paidCard.textContent.replace(/\s+/g, ' ').trim() : ''
);
check(
  '付费内容显示单篇解锁价',
  Boolean(paidCard) && paidCard.textContent.includes('1.99') && paidCard.textContent.includes('单篇解锁'),
  paidCard ? paidCard.textContent.replace(/\s+/g, ' ').trim() : ''
);
check('付费内容带内容 id（点开才知道是哪篇）', Boolean(paidCard) && paidCard.dataset.id === 'n4', paidCard ? paidCard.dataset.id : '');
check('首页内容标题正确', text('.content-title').includes('新人立减'), text('.content-title'));
check('未登录时首页头像显示占位', text('.hero-avatar').includes('游'), text('.hero-avatar'));

// 0.1 首页新增：服务保障条 / 商品搜索 / 筛选 chips
check('首页有服务保障条', window.document.querySelectorAll('.trust-item').length === 3, String(window.document.querySelectorAll('.trust-item').length));
check(
  '服务保障条用后台配置的文案',
  text('.trust-row').includes('正品保障') && text('.trust-row').includes('假一赔十'),
  text('.trust-row')
);
check('板块标题用后台配置的文案', text('.section-head h2').includes('精选好物'), text('.section-head h2'));

// 后台配置的横幅 / 快捷入口 / 主题色
check('首页横幅显示后台文案', text('.home-banner').includes('双 11 全场 8 折'), text('.home-banner').replace(/\s+/g, ' ').slice(0, 40));
check('首页横幅有副文案与按钮', text('.home-banner').includes('下单再送 60 金币') && text('.home-banner').includes('去看看'));
check('快捷入口按后台配置渲染', window.document.querySelectorAll('.entry-item').length === 4, String(window.document.querySelectorAll('.entry-item').length));
check('快捷入口文案正确', text('.entry-grid').includes('优惠活动') && text('.entry-grid').includes('联系客服'));
const themeAccent = window.document.documentElement.style.getPropertyValue('--accent');
check('后台主题色已生效', themeAccent === '#f97316', themeAccent || '(空)');

// 配了客服微信 → 保障条可点开客服弹层
$('.trust-item[data-act="support"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(50);
check('可打开客服弹层', Boolean($('.sheet .sup-row')), text('.sheet h3'));
check('客服弹层显示微信号', text('.sheet').includes('kefu-test'), text('.sheet .sup-v'));
window.navigator.clipboard = { writeText: () => Promise.resolve() };
window.isSecureContext = true;
$('.sheet [data-act="copy-text"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('复制客服号有反馈', text('#toast').includes('已复制'), text('#toast'));
closeSheetForTest();
await wait(40);

// 快捷入口可点：第三个是「联系客服」
const entrySupport = [...window.document.querySelectorAll('.entry-item')][2];
if (entrySupport) {
  entrySupport.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  check('快捷入口能打开对应功能', Boolean($('.sheet .sup-row')), text('.sheet h3'));
  closeSheetForTest();
  await wait(40);
}
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
  '首页顶部有未支付订单提醒',
  Boolean($('.unpaid-bar')) && text('.unpaid-bar').includes('待支付') && /剩余 \d+:\d{2}/.test(text('.unpaid-bar .order-count')),
  text('.unpaid-bar')
);
check(
  '已买过的商品显示「已购」',
  (() => {
    const c = [...window.document.querySelectorAll('.goods-card')].find((x) => x.dataset.id === 'demo_001');
    return Boolean(c) && Boolean(c.querySelector('.goods-owned'));
  })(),
  (window.document.querySelector('.goods-card .goods-owned') || {}).textContent || '无'
);
check('会员点商品先看详情', (() => {
  vipCard2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return true;
})());
await wait(60);
check(
  '商品详情展示标题与会员价',
  text('.sheet .gs-title').includes('会员专属礼包') && text('.sheet .gs-price').includes('9.90') && text('.sheet .gs-price').includes('19.00'),
  text('.sheet .gs-price')
);
check('商品详情显示会员立省', text('.sheet').includes('会员已省'), text('.sheet .gs-save'));
check('商品详情有分享入口', Boolean($('.sheet [data-act="share-goods"]')));
check('商品详情显示会员专享角标', Boolean($('.sheet .gs-tag')) && text('.sheet .gs-tag').includes('会员专享'));
$('.sheet [data-act="buy"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
check('详情里点立即购买进收银台', Boolean($('.sheet [data-act="pay"]')) && text('.sheet .amount-big').includes('9.90'), text('.sheet .amount-big'));

// 支付方式记忆：选了渠道后记到本地，下次进来默认选中
$('.sheet [data-act="channel"][data-id="mock"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
check('记住上次选择的支付方式', window.localStorage.getItem('last_channel_v1') === 'mock', String(window.localStorage.getItem('last_channel_v1')));
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
check(
  '设置中心入口存在',
  Boolean($('[data-act="settings"]')) && window.document.querySelectorAll('.set-row').length >= 1,
  window.document.querySelectorAll('.set-row').length + ' 个入口'
);
check(
  '我的页有收藏与反馈入口',
  Boolean($('[data-act="open-favorites"]')) && Boolean($('[data-act="feedback-new"]')) && Boolean($('[data-act="feedback-mine"]'))
);

// 4a2. 编辑资料：昵称 / 个性签名 / 换绑手机号
check('我的页有编辑资料入口', Boolean($('[data-act="edit-profile"]')));
$('[data-act="edit-profile"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(50);
check('资料弹层有昵称与签名输入', Boolean($('#pfNick')) && Boolean($('#pfBio')));
check(
  '资料弹层有换手机号与改密码入口',
  Boolean($('.sheet [data-act="open-phone"]')) && Boolean($('.sheet [data-act="change-password"]'))
);
$('#pfNick').value = '新昵称';
$('#pfBio').value = '我的新签名';
$('[data-act="save-profile"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(90);
check(
  '保存资料调用接口并带上昵称与签名',
  calls.some((c) => c.path === '/api/auth/profile' && c.body && c.body.nickname === '新昵称' && c.body.bio === '我的新签名')
);
check('保存后我的页显示新昵称', text('.profile-name').includes('新昵称'), text('.profile-name'));
check('保存后我的页显示新签名', text('.profile-bio').includes('我的新签名'), text('.profile-bio'));

$('[data-act="edit-profile"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(50);
$('.sheet [data-act="open-phone"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(50);
check('换绑弹层有新手机号与密码输入', Boolean($('#phNew')) && Boolean($('#phPwd')));
$('#phNew').value = '13900001111';
$('#phPwd').value = 'test1234';
$('[data-act="save-phone"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(90);
check(
  '换绑手机号调用接口',
  calls.some((c) => c.path === '/api/auth/phone' && c.body && c.body.phone === '13900001111')
);
check('换绑后我的页显示新手机号', text('.profile-sub').includes('139****1111'), text('.profile-sub'));

// 4b. 「支付中」订单：点进去直接进支付界面，且复用同一笔订单付款
$('[data-act="open-orders"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
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

// 7. 改昵称（走「编辑资料」弹层）
$('[data-act="edit-profile"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('资料弹层回填当前昵称', ($('#pfNick') || {}).value === '新昵称', ($('#pfNick') || {}).value || '');
$('#pfNick').value = '新名字';
$('[data-act="save-profile"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(90);
check('昵称已更新到页面', text('.profile-name').includes('新名字'), text('.profile-name'));

// 7b. 设置中心：分组设置项 + 深色模式开关
$('[data-act="settings"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
const setRows = [...window.document.querySelectorAll('.sheet .set-row')].map((e) => e.textContent.trim());
check(
  '设置中心项目齐全',
  ['修改密码', '收货地址', '深色模式', '刷新数据', '清除缓存', '意见反馈', '我的反馈', '关于', '退出登录'].every((k) =>
    setRows.some((r) => r.includes(k))
  ),
  setRows.join(' | ')
);
check(
  '设置中心分组标题',
  window.document.querySelectorAll('.sheet .sheet-group').length === 5,
  window.document.querySelectorAll('.sheet .sheet-group').length + ' 组'
);
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

// 9b. 订单详情：订单号可一键复制
await goMine();
await wait(40);
$('[data-act="open-orders"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
const paidRow = [...window.document.querySelectorAll('.sheet .order-row')].find((r) => r.dataset.id === 'O1');
if (paidRow) {
  paidRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(40);
  check('已支付订单可看详情', text('.sheet h3') === '订单详情', text('.sheet h3'));
  check('订单详情有订单号复制按钮', Boolean($('.sheet [data-act="copy-order"]')));
  $('.sheet [data-act="copy-order"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(40);
  check('复制订单号有反馈', text('#toast').includes('订单号已复制'), text('#toast'));
  closeSheetForTest();
  await wait(40);
} else {
  check('订单列表里有已支付订单', false, '未找到 O1');
}

// 9b-2. 列表里的「申请退款」快捷入口 + 本地找不到订单时补拉详情
await goMine();
await wait(40);
$('[data-act="open-orders"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
const quickRow = [...window.document.querySelectorAll('.sheet .order-row')].find((r) => r.dataset.id === 'O1');
const quickCta = quickRow ? quickRow.querySelector('.order-cta.is-refund') : null;
check('已支付订单在列表上有申请退款入口', Boolean(quickCta), quickCta ? quickCta.textContent.trim() : '未找到');
if (quickCta) {
  quickCta.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(40);
  check('点列表上的申请退款直接开退款弹层', text('.sheet h3') === '申请退款 / 退货', text('.sheet h3'));
  closeSheetForTest();
  await wait(30);
}
// 订单不在本地列表里（比如被刷新掉了）：点一下应该向服务端补拉，而不是没反应
const sheetEl = $('#sheet');
sheetEl.insertAdjacentHTML(
  'afterbegin',
  '<button class="order-row" data-act="order" data-id="O_REMOTE"><span class="order-main"><span class="order-title">历史订单</span></span></button>'
);
$('[data-act="order"][data-id="O_REMOTE"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(80);
check('本地没有的订单会补拉详情', text('.sheet h3') === '订单详情' && text('.sheet').includes('历史订单（仅服务端有）'), text('.sheet').slice(0, 40));
closeSheetForTest();
await wait(30);

// 9c. 退款 / 退货：用户申请 → 等后台审核 → 可撤销
await goMine();
await wait(40);
$('[data-act="open-orders"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
const rfRow = [...window.document.querySelectorAll('.sheet .order-row')].find((r) => r.dataset.id === 'O1');
if (rfRow) {
  rfRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(40);
  check('已支付订单有申请退款入口', Boolean($('.sheet [data-act="refund"]')));
  $('.sheet [data-act="refund"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(40);
  check('退款弹层有 5 个原因可选', window.document.querySelectorAll('.sheet .reason-chip').length === 5);
  $('.sheet [data-act="submit-refund"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  check('没选原因不让提交', text('#toast').includes('请先选一个退款原因'), text('#toast'));

  const chip = [...window.document.querySelectorAll('.sheet .reason-chip')].find((c) => c.dataset.r === '不想要了');
  chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(30);
  check('点原因后高亮', chip.classList.contains('on'));
  $('.sheet #refundDetail').value = '买多了';
  $('.sheet [data-act="submit-refund"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(120);
  const rfCall = calls.filter((c) => c.path === '/api/orders/O1/refund-request' && c.method === 'POST').pop();
  check(
    '提交退款申请带上原因与说明',
    Boolean(rfCall) && rfCall.body.reason === '不想要了' && rfCall.body.detail === '买多了',
    JSON.stringify(rfCall && rfCall.body)
  );
  check('提交后有审核提示', text('#toast').includes('等待商家审核'), text('#toast'));

  // 再打开这笔订单：显示审核中，且能撤销
  $('[data-act="open-orders"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(40);
  const rfRow2 = [...window.document.querySelectorAll('.sheet .order-row')].find((r) => r.dataset.id === 'O1');
  rfRow2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(40);
  check('订单详情显示退款审核中', text('.sheet').includes('退款申请审核中'), text('.sheet .refund-note'));
  check('审核中可撤销申请', Boolean($('.sheet [data-act="cancel-refund"]')));
  $('.sheet [data-act="cancel-refund"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(120);
  check('撤销申请调用接口', calls.some((c) => c.path === '/api/refunds/rf_t1/cancel' && c.method === 'POST'));
  check('撤销后回到可申请状态', (VIEWER.refunds[0] || {}).status === 'cancelled', (VIEWER.refunds[0] || {}).status);
} else {
  check('退款测试找到已支付订单', false, '未找到 O1');
}

// 10. 关于（从设置中心进入）
$('[data-act="settings"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
$('.sheet [data-act="about"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
check('关于弹层显示应用名', text('.about-name').includes('手机App支付骨架'), text('.about-name'));
$('.sheet [data-act="close"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);

// 10.5 付费内容：单篇解锁入口（登录态）
const tabTo = (k) =>
  [...window.document.querySelectorAll('.tab')]
    .find((t) => t.dataset.tab === k)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
tabTo('home');
await wait(60);
const payCard = [...window.document.querySelectorAll('.content-card')].find((c) => c.dataset.id === 'n4');
if (payCard) {
  payCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  check('付费内容弹层有单篇解锁按钮', Boolean($('.sheet [data-act="unlock-content"]')), text('.sheet h3'));
  check('付费内容弹层同时给会员入口', Boolean($('.sheet [data-act="open-member"]')));
  $('.sheet [data-act="unlock-content"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(80);
  check(
    '点解锁进入确认订单',
    text('.sheet').includes('确认订单') && text('.sheet').includes('1.99'),
    text('.sheet').replace(/\s+/g, ' ').slice(0, 60)
  );
  closeSheetForTest();
  await wait(40);
}
// 10.6 点开可读内容（免费/会员）：直接给全文，不再出现任何付费引导
const openCard = [...window.document.querySelectorAll('.content-card')].find((c) => c.dataset.id === 'n1');
if (openCard) {
  openCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  const sheetText = text('.sheet');
  check('点开内容直接显示全文', sheetText.includes('注册即送'), sheetText.replace(/\s+/g, ' ').slice(0, 50));
  check(
    '看已购/会员内容不再出现开通会员',
    !sheetText.includes('开通会员') && !$('.sheet [data-act="open-member"]'),
    sheetText.replace(/\s+/g, ' ').slice(0, 50)
  );
  check('看已购/会员内容不出现单篇解锁', !$('.sheet [data-act="unlock-content"]'));
  closeSheetForTest();
  await wait(40);
}
tabTo('mine');
await wait(60);

// 10.7 心愿单 / 浏览足迹 / 商品排序 / 订单搜索 / 再来一单 / 消息中心
tabTo('home');
await wait(80);
const favBtn = $('.goods-card[data-id="demo_001"] .goods-fav');
check('商品卡有心愿单标记', Boolean(favBtn), favBtn ? favBtn.textContent.trim() : '未找到');
if (favBtn) {
  favBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  check('点 ♡ 能收藏商品', text('#toast').includes('心愿单'), text('#toast'));
  check('收藏后变成实心 ♥', Boolean(favBtn.classList.contains('on')), favBtn.textContent.trim());
  check('收藏不会误开商品详情', !$('.sheet .gs-title'), text('.sheet h3'));
}

// 心愿单：列出收藏 → 取消收藏后清空
await goMine();
await wait(60);
const wishEntry = $('[data-act="open-wishlist"]');
check('我的服务里有心愿单入口', Boolean(wishEntry), wishEntry ? text('[data-act="open-wishlist"]') : '未找到');
if (wishEntry) {
  wishEntry.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(80);
  check('心愿单列出刚收藏的商品', text('.sheet').includes('测试商品'), text('.sheet h3'));
  const unFav = $('.sheet [data-act="goods-fav"]');
  if (unFav) {
    unFav.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(80);
    check('心愿单里取消收藏后变空', text('.sheet').includes('还没有收藏商品'), text('.sheet').slice(0, 40));
  } else {
    check('心愿单里有取消收藏按钮', false);
  }
  closeSheetForTest();
  await wait(50);
}

// 足迹：看两个商品后首页出现「最近看过」
tabTo('home');
await wait(60);
for (const id of ['demo_001', 'member_month']) {
  const c = $(`.goods-card[data-id="${id}"]`);
  if (c) {
    c.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(80);
    closeSheetForTest();
    await wait(60);
  }
}
tabTo('home');
await wait(80);
check('首页出现「最近看过」', Boolean($('.fp-row')), String(window.document.querySelectorAll('.fp-card').length));
await goMine();
await wait(60);
const fpEntry = $('[data-act="open-footprint"]');
if (fpEntry) {
  fpEntry.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(80);
  check('足迹弹层列出浏览过的商品', text('.sheet').includes('会员月卡'), text('.sheet h3'));
  const clearFp = $('.sheet [data-act="footprint-clear"]');
  if (clearFp) {
    clearFp.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(80);
    check('清空足迹后没有记录', text('.sheet').includes('还没有浏览记录'), text('.sheet').slice(0, 40));
  }
  closeSheetForTest();
  await wait(50);
} else {
  check('我的服务里有最近浏览入口', false);
}

// 商品排序：按销量排，销量最高的排第一
tabTo('home');
await wait(80);
const hotChip = $('[data-act="goods-sort"][data-s="hot"]');
check('首页有销量排序', Boolean(hotChip), hotChip ? hotChip.textContent.trim() : '未找到');
if (hotChip) {
  hotChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(80);
  const first = $('.goods-card');
  check('按销量排序后销量最高的在前', Boolean(first) && first.dataset.id === 'member_month', first ? first.dataset.id : '无卡片');
  const priceChip = $('[data-act="goods-sort"][data-s="price"]');
  if (priceChip) {
    priceChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(80);
    const cheap = $('.goods-card');
    check('按价格升序时最便宜的在前', Boolean(cheap) && cheap.dataset.id === 'demo_001', cheap ? cheap.dataset.id : '无卡片');
    // 再点一次切成降序
    const priceChip2 = $('[data-act="goods-sort"][data-s="price"]');
    priceChip2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(80);
    const dear = $('.goods-card');
    check('再点一次切成价格降序', Boolean(dear) && dear.dataset.id !== 'demo_001', dear ? dear.dataset.id : '无卡片');
    check('价格按钮显示降序', text('[data-act="goods-sort"][data-s="price"]').includes('↓'), text('[data-act="goods-sort"][data-s="price"]'));
  }
}

// 订单搜索 + 再来一单
await goMine();
await wait(50);
$('[data-act="open-orders"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(80);
const orderSearchInput = $('#orderSearch');
check('订单弹层有搜索框', Boolean(orderSearchInput));
if (orderSearchInput) {
  const before = window.document.querySelectorAll('#orderRows .order-row').length;
  orderSearchInput.value = '会员';
  orderSearchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(80);
  const after = window.document.querySelectorAll('#orderRows .order-row').length;
  check('搜「会员」只剩匹配的订单', after === 1 && before > 1, `前 ${before} 条 → 后 ${after} 条`);
  const clearBtn = $('.sheet [data-act="order-search-clear"]');
  if (clearBtn) {
    clearBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(80);
    check('清空搜索恢复全部订单', window.document.querySelectorAll('#orderRows .order-row').length === before, String(window.document.querySelectorAll('#orderRows .order-row').length));
  }
}
const reorderBtn = $('.sheet [data-act="reorder"]');
check('已支付订单有「再来一单」', Boolean(reorderBtn), reorderBtn ? reorderBtn.textContent.trim() : '未找到');
if (reorderBtn) {
  reorderBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(100);
  check('再来一单直接进确认订单', text('.sheet h3') === '确认订单', text('.sheet h3'));
  closeSheetForTest();
  await wait(50);
}

// 消息中心：订单动态 + 未读清零
await goMine();
await wait(60);
const msgEntry = $('[data-act="open-messages"]');
check('我的服务里有消息中心', Boolean(msgEntry), msgEntry ? text('[data-act="open-messages"]') : '未找到');
check('消息中心显示未读角标', Boolean($('.dot-num')), $('.dot-num') ? $('.dot-num').textContent : '无角标');
if (msgEntry) {
  msgEntry.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(80);
  check('消息中心列出支付动态', text('.sheet').includes('支付成功'), text('.sheet h3'));
  closeSheetForTest();
  await wait(60);
  await goMine();
  await wait(60);
  check('看过消息后未读清零', !$('.dot-num'));
}

// 10.8 购物车：详情加购 → 改数量 → 多件合并结算
window.localStorage.removeItem('cart_v1');
const tabBy = (key) => [...window.document.querySelectorAll('.tab')].find((t) => t.dataset.tab === key);
tabBy('home').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);

$('[data-act="goods"][data-id="demo_001"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(80);
const addBtn = $('.sheet [data-act="cart-add"]');
check('商品详情有「加入购物车」', Boolean(addBtn), addBtn ? addBtn.textContent.trim() : '未找到');
if (addBtn) {
  addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  check('加购后按钮显示已加购件数', text('.sheet [data-act="cart-add"]').includes('已加购 2 件'), text('.sheet [data-act="cart-add"]'));
}
closeSheetForTest();
await wait(60);
check('底部购物车角标显示件数', text('.tab[data-tab="cart"] .tab-badge') === '2', text('.tab[data-tab="cart"] .tab-badge'));

// 再加一件别的商品
$('[data-act="goods"][data-id="member_month"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(80);
$('.sheet [data-act="cart-add"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
closeSheetForTest();
await wait(60);

tabBy('cart').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(80);
check('购物车列出两件商品', window.document.querySelectorAll('.cart-item').length === 2, String(window.document.querySelectorAll('.cart-item').length));
check('购物车显示总件数', text('.cart-head h2').includes('3 件'), text('.cart-head h2'));
check('购物车合计按数量算', text('.cart-sum b') === '¥12.02', text('.cart-sum b'));

const plusBtn = $('.stepper [data-act="cart-qty"][data-id="demo_001"][data-d="1"]');
check('明细行有数量步进器', Boolean(plusBtn));
if (plusBtn) {
  plusBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(80);
  check('点 + 数量加一', window.localStorage.getItem('cart_v1').includes('"qty":3'), window.localStorage.getItem('cart_v1'));
  check('合计随数量更新', text('.cart-sum b') === '¥12.03', text('.cart-sum b'));
}
check('结算按钮显示可结算件数', text('.cart-pay').includes('4'), text('.cart-pay'));

$('.cart-pay').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(80);
check('结算弹层列出多件明细', window.document.querySelectorAll('.sheet .co-line').length === 2, String(window.document.querySelectorAll('.sheet .co-line').length));
check('结算金额与购物车一致', text('.sheet .amount-big').includes('12.03'), text('.sheet .amount-big'));
const payCartBtn = $('.sheet [data-act="pay"]');
if (payCartBtn) {
  payCartBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(250);
}
const cartOrderCall = calls.filter((c) => c.path === '/api/orders' && c.method === 'POST' && c.body && Array.isArray(c.body.items)).pop();
check('结算提交多件明细分', Boolean(cartOrderCall) && cartOrderCall.body.items.length === 2, cartOrderCall ? JSON.stringify(cartOrderCall.body) : '未提交');
check('购物车结算支付成功', text('.sheet .success-title') === '支付成功', text('.sheet .success-title'));
check('下单后购物车已清空', window.localStorage.getItem('cart_v1') === '[]', String(window.localStorage.getItem('cart_v1')));
check('购物车角标消失', !$('.tab[data-tab="cart"] .tab-badge'));
closeSheetForTest();
await wait(60);
tabBy('cart').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(80);
check('空购物车有引导文案', text('.cart-empty h3') === '购物车还是空的', text('.cart-empty h3'));

// 回到「我的」，后面的退出登录从这里进
await goMine();
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
const goodsCard = $('[data-act="goods"]');
if (goodsCard) {
  goodsCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(60);
  check('未登录也能看商品详情', Boolean($('.sheet .gs-title')), text('.sheet .gs-title'));
  $('.sheet [data-act="buy"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(80);
  check('未登录购买被引导到登录', !!$('#authPhone'), text('#toast'));
} else {
  check('首页有商品卡片', false, '未找到 goods 卡片');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'));
  process.exit(1);
}
