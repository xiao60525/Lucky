// 好友页 DOM 冒烟测试：jsdom 里跑 friends.html，接口全部 mock
// 覆盖：好友列表渲染、待收款提示条、转账气泡三种状态与按钮、待收款弹层
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\//, ''), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'app', 'public', 'friends.html'), 'utf8');

let pass = 0;
const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log('✔ ' + name + (extra ? ' — ' + extra : ''));
  } else {
    fails.push(name);
    console.log('✘ ' + name + (extra ? ' — ' + extra : ''));
  }
};

const now = Date.now();
const ME = 'u_me';
const FRIEND = { id: 'u_fr', nickname: '小明', avatar: null, lastBody: '[转账] ¥10.00 待领取', lastFrom: 'u_fr', lastAt: now, unread: 1 };

const msgs = [
  { id: 'm1', fromUser: 'u_fr', toUser: ME, body: '', kind: 'transfer', payload: { tid: 'tr_in', amount: 1000, note: '午饭', status: 'pending' }, createdAt: now - 3000 },
  { id: 'm2', fromUser: ME, toUser: 'u_fr', body: '', kind: 'transfer', payload: { tid: 'tr_out', amount: 500, note: '', status: 'pending' }, createdAt: now - 2000 },
  { id: 'm3', fromUser: 'u_fr', toUser: ME, body: '', kind: 'transfer', payload: { tid: 'tr_done', amount: 200, note: '还钱', status: 'accepted' }, createdAt: now - 1000 },
];

const pending = {
  incoming: [{ id: 'tr_in', direction: 'in', amount: 1000, note: '午饭', status: 'pending', createdAt: now - 3000, fromUser: 'u_fr', toUser: ME, nickname: '小明', avatar: null }],
  outgoing: [],
  incomingCount: 1,
  incomingAmount: 1000,
};

const calls = [];
function mockFetch(url, opts = {}) {
  const u = String(url);
  calls.push({ url: u, method: (opts.method || 'GET').toUpperCase() });
  const j = (obj) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj), text: () => Promise.resolve(JSON.stringify(obj)) });
  if (u.includes('/api/auth/me')) return j({ viewer: { id: ME, nickname: '我', avatar: null, balance: 5000 } });
  if (u.includes('/api/friends/requests')) return j({ incoming: [], outgoing: [] });
  if (u.includes('/api/friends')) return j({ friends: [FRIEND], unread: 1, pending: 0 });
  if (u.includes('/api/dm/transfer/pending')) return j(pending);
  if (u.includes('/api/dm/transfer/act')) return j({ ok: true, status: 'accepted', tid: 'tr_in', messageId: 'm1', balance: 5600 });
  if (u.includes('/api/dm/thread')) return j({ friend: { id: 'u_fr', nickname: '小明', avatar: null }, messages: msgs, transfers: [], clearedAt: null });
  if (u.includes('/api/dm/unread')) return j({ unread: 1, pending: 0, transferIn: 1 });
  return j({});
}

const token = Buffer.from(ME + '|' + (now + 86400000), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.sig';
const dom = new JSDOM(HTML, {
  url: 'http://localhost/friends?t=' + encodeURIComponent(token),
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const w = dom.window;
w.fetch = mockFetch;
w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
w.scrollTo = () => {};
w.Element.prototype.scrollTo = () => {};
w.confirm = () => true;
const errs = [];
w.addEventListener('error', (e) => errs.push(String(e.message || e)));

// 执行页面内联脚本
const code = (HTML.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
try {
  w.eval(code);
} catch (e) {
  console.log('✘ 内联脚本执行失败：' + e.message);
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(300);

const $ = (sel) => w.document.querySelector(sel);
const text = (sel) => ($(sel) ? $(sel).textContent.replace(/\s+/g, ' ').trim() : '');
const click = (el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

ok('页面无脚本异常', errs.length === 0, errs.join('; '));
ok('好友列表已渲染', w.document.querySelectorAll('#list .row').length === 1, String(w.document.querySelectorAll('#list .row').length));
ok('待收款提示条出现', Boolean($('#tfStrip')), text('#tfStrip'));
ok('提示条显示金额', text('#tfStrip').includes('¥10.00'), text('#tfStrip'));

// 打开待收款弹层
click($('#tfStrip'));
await wait(200);
ok('点提示条打开待收款弹层', $('#tfSheet').classList.contains('show'), $('#tfSheet').className);
ok('弹层列出待收款', w.document.querySelectorAll('#tfBody .tf-item').length === 1, String(w.document.querySelectorAll('#tfBody .tf-item').length));
ok('弹层有收款按钮', Boolean($('#tfBody [data-a="accept"]')));

// 收款
click($('#tfBody [data-a="accept"]'));
await wait(200);
ok('收款走 act 接口', calls.some((c) => c.url.includes('/api/dm/transfer/act') && c.method === 'POST'));

// 进入会话看转账气泡
click($('#list .row'));
await wait(250);
const cards = [...w.document.querySelectorAll('#msgs .tcard')];
ok('会话渲染三个转账气泡', cards.length === 3, String(cards.length));
ok('收到的待收款有「收款」按钮', Boolean($('#msgs [data-tfact="accept"]')));
ok('收到的待收款有「退还」按钮', Boolean($('#msgs [data-tfact="reject"]')));
ok('我发出的待领取有「撤销」按钮', Boolean($('#msgs [data-tfact="cancel"]')));
ok('已收款卡片是成功态', w.document.querySelectorAll('#msgs .tcard.is-ok').length === 1, String(w.document.querySelectorAll('#msgs .tcard.is-ok').length));
ok('待收款卡片显示金额', [...w.document.querySelectorAll('#msgs .t2')].map((e) => e.textContent).join(',').includes('10.00'));

// 撤销一笔：走 cancel
click($('#msgs [data-tfact="cancel"]'));
await wait(200);
ok('撤销走 act 接口', calls.some((c) => c.url.includes('/api/dm/transfer/act')) && calls.filter((c) => c.url.includes('/api/dm/transfer/act')).length >= 2);

console.log(`\n结果：${pass}/${pass + fails.length} 通过`);
if (fails.length) {
  console.log('失败项：' + fails.join('、'));
  process.exit(1);
}
process.exit(0);
