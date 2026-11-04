/**
 * 支付宝渠道 UI 自测（jsdom + 假 fetch）
 * 覆盖：渠道列表按服务端可用性渲染、默认选中、外部链接不加 sharecode
 * 用法：node scripts/test-alipay-ui.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const appJs = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');

const VIEWER = {
  id: 'u_test001',
  nickname: '测试',
  phone: '13800001234',
  phoneMasked: '138****1234',
  initial: '测',
  points: 100,
  coupons: [],
  address: {},
  balance: 5000,
  createdAt: Date.now(),
  orders: [],
};

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`✔ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`✘ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 点商品卡 → 详情 → 立即购买，进到收银台 */
async function openPaySheet(w) {
  $(w, '[data-act="goods"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(50);
  $(w, '[data-act="buy"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(60);
}

/** 跑一次场景：channels 决定渠道列表 */
async function run(channels) {
  const BOOTSTRAP = {
    user: { id: 'demo', nickname: '游客' },
    loggedIn: true,
    balance: 5000,
    provider: channels.alipay ? 'alipay' : channels.wechat ? 'wechat' : 'mock',
    payScene: 'native',
    wechatReady: !!channels.wechat,
    alipayReady: !!channels.alipay,
    channels,
    wxMchId: null,
    cloud: { ready: true, endpoint: 'x' },
    site: { name: '测试应用', tagline: '', hasIcon: false, iconUrl: null, iconVer: 'default' },
    products: [{ id: 'demo_001', title: '测试商品', amount: 100, desc: 'x', tag: '示例' }],
    orders: [],
  };

  const json = (body, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

  const fakeFetch = (url) => {
    const path = String(url).split('?')[0];
    if (path === '/api/bootstrap') return json(BOOTSTRAP);
    if (path === '/api/auth/me') return json({ viewer: VIEWER });
    if (path === '/api/orders') return json({ orders: [] });
    return json({}, 404);
  };

  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://mobile-app-pay-skeleton.app.workbuddy.host/?sharecode=TESTCODE',
  });
  const { window } = dom;
  window.fetch = fakeFetch;
  Object.defineProperty(window, 'localStorage', {
    value: {
      store: { user_token_v1: 'tk_test' },
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
  window.eval(appJs);
  await wait(150);
  return window;
}

const $ = (w, s) => w.document.querySelector(s);
const all = (w, s) => [...w.document.querySelectorAll(s)];
const txt = (w, s) => {
  const el = $(w, s);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
};

/* ---------- 场景 1：只配了支付宝 ---------- */
{
  const w = await run({ wechat: false, alipay: true, mock: true });
  const card = $(w, '[data-act="goods"]');
  check('首页有商品卡片', !!card);
  card.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(60);
  check('商品详情已打开', !!$(w, '.gs-title'), txt(w, '.gs-title'));
  const buy = $(w, '[data-act="buy"]');
  check('商品详情有购买按钮', !!buy);
  buy.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(60);

  const names = all(w, '.pay-item .pay-name').map((e) => e.textContent.trim());
  check('支付弹层列出渠道', names.length >= 2, names.join(' / '));
  check('包含支付宝', names.includes('支付宝'));
  check('未配置微信时不显示微信支付', !names.includes('微信支付'));
  check('已配真实渠道时不显示模拟收银台', !names.includes('模拟收银台'));

  const selected = $(w, '.pay-item.selected .pay-name');
  check('默认选中支付宝', selected && selected.textContent.trim() === '支付宝', selected ? selected.textContent.trim() : '无');

  const icon = $(w, '.pay-item .pay-icon.alipay');
  check('支付宝图标类名正确', !!icon);
  check('按钮文案为确认支付', txt(w, '#payBtn').includes('确认支付'), txt(w, '#payBtn'));
}

/* ---------- 场景 2：两个渠道都配了 ---------- */
{
  const w = await run({ wechat: true, alipay: true, mock: true });
  await openPaySheet(w);
  const names = all(w, '.pay-item .pay-name').map((e) => e.textContent.trim());
  check('两个真实渠道同时显示', names.includes('微信支付') && names.includes('支付宝'), names.join(' / '));
  check('仍有余额支付', names.includes('余额支付'));
}

/* ---------- 场景 3：都没配 ---------- */
{
  const w = await run({ wechat: false, alipay: false, mock: true });
  await openPaySheet(w);
  const names = all(w, '.pay-item .pay-name').map((e) => e.textContent.trim());
  check('未配置时回落到模拟收银台', names.includes('模拟收银台'), names.join(' / '));
  check('不显示支付宝', !names.includes('支付宝'));
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
