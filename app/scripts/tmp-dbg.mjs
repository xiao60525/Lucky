import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
// 复用测试文件里最小的 mock
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
const VIEWER = { id: 'u1', nickname: '测试用户', phoneMasked: '138****1234', initial: '测', points: 100, coupons: [{ id: 'c1', title: 'x', amount: 100 }, { id: 'c2', title: 'y', amount: 300 }], address: { name: '张三', detail: '北京' }, balance: 1200, memberLevel: 'member', memberExpire: Date.now() + 15 * 86400000, autoRenew: false, orders: [] };
Object.defineProperty(window, 'localStorage', { value: { store: { user_token_v1: 'tk' }, getItem(k) { return this.store[k] || null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; }, clear() { this.store = {}; } } });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.fetch = (u, o) => {
  const path = String(u).split('?')[0];
  if (path === '/api/auth/profile') { const b = JSON.parse(o.body); Object.assign(VIEWER, b); console.log('PROFILE CALL', b); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ viewer: VIEWER }) }); }
  if (path === '/api/auth/me') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ viewer: VIEWER }) });
  if (path === '/api/bootstrap') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ user: { id: 'demo-user', nickname: '游客' }, loggedIn: false, balance: 0, provider: 'mock', payScene: 'native', wechatReady: false, wxMchId: null, cloud: { ready: true, endpoint: 'x' }, site: { name: 'X', tagline: '', hasIcon: false, iconUrl: null }, products: [{ id: 'demo_001', title: '测试商品', amount: 1, desc: 'x', tag: '示例' }, { id: 'member_month', title: '会员月卡', amount: 1200, desc: '', tag: '会员', memberDays: 30 }], contents: [], orders: [] }) });
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
};
window.addEventListener('error', (e) => console.log('PAGE ERROR:', e.message));
window.eval(appJs);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1200);
// 登录态直接进 mine
const click = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const $ = (s) => window.document.querySelector(s);
click([...window.document.querySelectorAll('.tab')].find((t) => t.dataset.tab === 'mine'));
await wait(200);
click($('[data-act="open-member"]'));
await wait(150);
console.log('sheet:', $('.sheet h3')?.textContent, '| autorenew row:', Boolean($('.autorenew-row')));
click($('.autorenew-row'));
await wait(300);
console.log('after click: autorenew=', VIEWER.autoRenew, '| row on:', $('.autorenew-row')?.classList.contains('on'), '| toast:', $('#toast')?.textContent);
