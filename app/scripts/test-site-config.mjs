/**
 * 后台「控制前端」自测（jsdom + 假 fetch）
 * 覆盖：模块全关 / 内容页隐藏 / tab 改名 / 主题色 / 回到顶部
 * 用法：node scripts/test-site-config.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const appJs = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');

const BOOT = {
  user: { id: 'u_x', nickname: '张三' },
  loggedIn: true,
  balance: 1200,
  provider: 'mock',
  payScene: 'native',
  wechatReady: false,
  alipayReady: false,
  channels: { wechat: false, alipay: false, alipayQr: false, mock: true },
  orders: [],
  products: [{ id: 'p1', title: '测试商品', amount: 100, desc: 'x', tag: '' }],
  contents: [{ id: 'c1', title: '一条内容', desc: '正文', tag: '', image: null, link: '', sort: 1, active: true }],
  site: {
    name: '关闭模块的站点',
    tagline: '',
    hasIcon: false,
    iconUrl: null,
    iconVer: 'default',
    home: {
      trustOn: true,
      trust: [{ icon: '🔒', title: '安全支付', desc: '官方通道', on: true }],
      goodsTitle: '在售商品',
      contentTitle: '精选内容',
      support: { wechat: '', phone: '', note: '' },
      modules: {
        goods: false,
        contents: false,
        trust: false,
        unpaid: false,
        notice: false,
        search: false,
        member: false,
        recharge: false,
        toTop: false,
        support: false,
      },
      theme: { accent: '#0d9488', accent2: '#22c55e' },
      tabs: { home: '主页', content: '文章', mine: '我', contentOn: false },
      banner: { on: false, text: '', sub: '', btn: '', link: '', bg: '#0d9488' },
      entries: [{ icon: '🎁', title: '优惠活动', act: 'goods', value: '', on: true }],
    },
  },
};

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/?sharecode=TESTCODE' });
const { window } = dom;
window.fetch = async (url) => {
  const p = String(url).split('?')[0];
  const json = (obj, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (p.endsWith('/api/bootstrap')) return json(BOOT);
  if (p.endsWith('/api/auth/me')) return json({ viewer: { id: 'u_x', nickname: '张三', phoneMasked: '138****0000', memberExpire: null, balance: 1200, orders: [], address: {}, points: 0 } });
  if (p.endsWith('/api/orders')) return json({ orders: [] });
  return json({});
};
window.eval(appJs);

const results = [];
const check = (name, cond, extra = '') => results.push(`${cond ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(220);

const d = window.document;
const view = d.getElementById('view');
check('首页已渲染', Boolean(view) && view.textContent.includes('关闭模块的站点'), view ? view.textContent.slice(0, 20) : 'no-view');

// 模块全关：这些块都不该出现
check('商品区已关闭', !d.querySelector('.goods-grid'), String(d.querySelectorAll('.goods-grid').length));
check('内容区已关闭', !d.querySelector('.content-card'), String(d.querySelectorAll('.content-card').length));
check('服务保障条已关闭', !d.querySelector('.trust-row'));
check('搜索框已关闭', !d.querySelector('.search-bar'));
check('公告条已关闭', !d.querySelector('.notice-bar'));
check('快捷入口仍保留（未关）', d.querySelectorAll('.entry-item').length === 1, String(d.querySelectorAll('.entry-item').length));

// 内容 tab 隐藏 + 文案改成后台配的
const tabs = [...d.querySelectorAll('.tab')];
const contentTab = tabs.find((t) => t.dataset.tab === 'content');
check('内容 tab 已隐藏', Boolean(contentTab) && contentTab.hidden === true);
check('tab 文案用后台配置', d.querySelector('.tab[data-tab="home"] span').textContent === '主页', d.querySelector('.tab[data-tab="home"] span').textContent);
check('我的 tab 文案生效', d.querySelector('.tab[data-tab="mine"] span').textContent === '我');

// 主题色写进了根变量
const accent = d.documentElement.style.getPropertyValue('--accent');
check('主题色已应用', accent === '#0d9488', accent || '(空)');
const accent2 = d.documentElement.style.getPropertyValue('--accent-2');
check('辅助色已应用', accent2 === '#22c55e', accent2 || '(空)');

// 回到顶部按钮被隐藏
const toTop = d.getElementById('toTop');
check('回到顶部已隐藏', Boolean(toTop) && toTop.style.display === 'none', toTop ? toTop.style.display : 'no-btn');

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('✘'));
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.slice(2).split(' — ')[0]).join('、'));
  process.exit(1);
}
process.exit(0);
