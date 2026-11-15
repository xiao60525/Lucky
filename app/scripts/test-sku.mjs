/**
 * 多规格（SKU）前台自测（jsdom + 假 fetch）
 * 覆盖：价格区间「起」/ 规格选择与价格库存联动 / 售罄规格禁用 / 购物车按规格分行 / 结算带 skuId
 * 用法：node scripts/test-sku.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const appJs = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');

const SKU_PRODUCT = {
  id: 'p1',
  title: '手冲咖啡',
  amount: 500,
  desc: '现磨现发',
  tag: '热卖',
  sales: 3,
  skus: [
    { id: 'p1_s1', name: '小杯', price: 300, stock: 0, sales: 5, left: 0, active: true },
    { id: 'p1_s2', name: '大杯', price: 900, stock: 2, sales: 3, left: 2, active: true },
  ],
  priceMin: 300,
  priceMax: 900,
  soldOutAll: false,
};

const BOOTSTRAP = {
  user: { id: 'demo-user', nickname: '游客' },
  loggedIn: true,
  balance: 100000,
  provider: 'mock',
  payScene: 'native',
  wechatReady: false,
  wxMchId: null,
  channels: { wechat: false, alipay: false, alipayQr: false, mock: true },
  cloud: { ready: true, endpoint: 'x' },
  site: {
    name: '测试站',
    tagline: '',
    hasIcon: false,
    iconUrl: null,
    iconVer: 'default',
    home: {
      trustOn: false,
      trust: [],
      goodsTitle: '在售商品',
      contentTitle: '内容',
      support: {},
      modules: { goods: true, contents: false, trust: false, unpaid: true, notice: true, search: true, member: false, recharge: true, toTop: false, support: false },
      theme: { accent: '#5a5cf0', accent2: '#8b5cf6' },
      tabs: { home: '首页', content: '内容', mine: '我的', contentOn: false },
      banner: { on: false },
      entries: [],
    },
  },
  viewer: {
    id: 'u_test0001',
    nickname: '测试用户',
    phone: '13800001234',
    phoneMasked: '138****1234',
    initial: '测',
    points: 0,
    balance: 100000,
    address: {},
    orders: [],
    refunds: [],
    coupons: [],
    memberLevel: '',
    memberExpire: null,
    autoRenew: false,
  },
  products: [SKU_PRODUCT, { id: 'p2', title: '普通商品', amount: 200, desc: '', sales: 0 }],
  contents: [],
  favorites: [],
  refunds: [],
  orders: [],
};

const calls = [];
function json(data, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}
function fakeFetch(url, opts = {}) {
  const path = String(url).split('?')[0];
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ path, method, body });
  if (path === '/api/bootstrap') return json(BOOTSTRAP);
  if (path === '/api/auth/me') return json({ viewer: BOOTSTRAP.viewer });
  if (path === '/api/orders' && method === 'POST') {
    return json({ order: { id: 'OSKU1', title: '手冲咖啡（大杯）', amount: 900, status: 'created', createdAt: Date.now(), items: [] } }, 201);
  }
  if (/^\/api\/orders\/[^/]+\/pay$/.test(path)) return json({ mode: 'balance', balance: 100000, order: { id: 'OSKU1', amount: 900, status: 'paid', title: '手冲咖啡（大杯）', channelName: '余额' } });
  return json({}, 404);
}

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/?sharecode=TEST' });
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
// 预先放一个令牌：启动时会走 /api/auth/me 拿到登录态（等价于已登录用户）
window.localStorage.setItem('user_token_v1', 'tk_test');
window.eval(appJs);

const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const text = (s) => ($(s) ? $(s).textContent.replace(/\s+/g, ' ').trim() : '');
const click = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`);
};

await wait(150);

// 1. 商品卡：多规格显示「起」，单规格照旧
const card = $$('.goods-card').find((c) => c.dataset.id === 'p1');
check('多规格商品卡显示「起」', Boolean(card) && /¥3\.00 ?起/.test(card.textContent.replace(/\s+/g, ' ')), card && text('.goods-name'));
const plain = $$('.goods-card').find((c) => c.dataset.id === 'p2');
check('单规格商品卡不带起', Boolean(plain) && !/起/.test(plain.textContent.replace(/\s+/g, '').slice(0, 40)));

// 2. 详情：规格区 + 默认选中有货规格
click(card);
await wait(50);
check('详情出现规格选择', $$('.gs-spec').length === 2, `规格数 ${$$('.gs-spec').length}`);
check('售罄规格被禁用', Boolean($('.gs-spec.is-out')) && $('.gs-spec.is-out').disabled);
check('默认选中第一个有货规格', /大杯/.test(text('.gs-spec.on')), text('.gs-spec.on'));
check('价格随规格显示', /9\.00/.test(text('.gs-price')), text('.gs-price'));
check('库存按规格显示', /(库存|仅剩) 2 件/.test(text('.gs-chips')), text('.gs-chips'));

// 3. 切换到售罄规格：按钮不可点（disabled），选中态不转移
const outBtn = $('.gs-spec.is-out');
click(outBtn);
await wait(30);
check('点售罄规格不会切换', /大杯/.test(text('.gs-spec.on')));

// 4. 加购 → 购物车行带规格名与规格价
const addBtn = $$('.sheet [data-act="cart-add"]')[0] || $('[data-act="cart-add"]');
click(addBtn);
await wait(50);
const cartLS = JSON.parse(window.localStorage.getItem('cart_v1') || '[]');
check('加入购物车带 skuId', cartLS.length === 1 && cartLS[0].skuId === 'p1_s2', JSON.stringify(cartLS));

// 关掉弹层，去购物车
const mask = $('#mask');
if (mask) click(mask);
const cartTab = $$('.tab').find((t) => t.dataset.tab === 'cart');
click(cartTab);
await wait(50);
check('购物车显示规格名', /大杯/.test(text('.cart-sku')), text('.cart-name'));
check('购物车按规格价合计', /9\.00/.test(text('.cart-bar')), text('.cart-bar'));

// 5. 结算：提交的明细带 skuId
const payBtn = $('[data-act="cart-checkout"]');
click(payBtn);
await wait(50);
const confirmPay = $$('.sheet [data-act="pay"]')[0] || $('[data-act="pay"]');
click(confirmPay);
await wait(80);
const orderCall = calls.find((c) => c.path === '/api/orders' && c.method === 'POST');
check(
  '结算明细带规格',
  Boolean(orderCall) && orderCall.body.items.length === 1 && orderCall.body.items[0].skuId === 'p1_s2',
  orderCall ? JSON.stringify(orderCall.body.items) : 'no call'
);

console.log('\n----------------------------------------');
const passed = results.filter((r) => r.ok).length;
console.log(`结果：${passed}/${results.length} 通过`);
if (passed !== results.length) process.exit(1);
process.exit(0);
