/**
 * 后台「外观」页首页配置 + 商品销量 + 订单剩余时间的渲染测试。
 * 用 jsdom 加载真实 admin.html / admin.js，stub 掉接口，避免依赖线上登录态。
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/admin?sharecode=TEST' });
const w = dom.window;

let pass = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`✔ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fails.push(name);
    console.log(`✘ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const site = {
  name: '测试应用',
  tagline: '副标题',
  notice: '公告内容',
  enableRegister: true,
  showMock: true,
  showBalance: true,
  hasIcon: false,
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
    modules: { goods: true, contents: false, trust: true, unpaid: true, notice: true, search: true, member: true, recharge: false, toTop: true, support: true },
    theme: { accent: '#f97316', accent2: '#fb923c' },
    tabs: { home: '主页', content: '文章', mine: '我的', contentOn: true },
    banner: { on: true, text: '双 11 全场 8 折', sub: '下单送金币', btn: '去看看', link: 'https://example.com', bg: '#f97316' },
    entries: [
      { icon: '🎁', title: '优惠活动', act: 'goods', value: '', on: true },
      { icon: '🔗', title: '官网', act: 'link', value: 'https://example.com', on: true },
    ],
  },
};

const orders = [
  { id: 'O-paid', productId: 'p1', title: '测试商品', amount: 100, amountText: '1.00', channel: 'mock', channelName: '模拟', status: 'paid', createdAt: Date.now() - 3600e3 },
  { id: 'O-paid2', productId: 'p1', title: '测试商品', amount: 100, amountText: '1.00', channel: 'mock', channelName: '模拟', status: 'paid', createdAt: Date.now() - 3600e3 },
  { id: 'O-new', productId: 'p2', title: '待付商品', amount: 200, amountText: '2.00', channel: 'mock', channelName: '模拟', status: 'created', createdAt: Date.now() - 60e3 },
];

let savedBody = null;
let savedContent = null;
w.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });
  if (u.includes('/api/admin/overview')) {
    return json({
      stats: { todayOrders: 0, todayAmount: 0, pendingOrders: 1 },
      orders,
      orderTtlMinutes: 30,
      products: [
        { id: 'p1', title: '测试商品', amount: 100, memberPrice: 0, memberDays: 0, memberOnly: false, sort: 1, active: true, image: '' },
        { id: 'p2', title: '待付商品', amount: 200, memberPrice: 0, memberDays: 0, memberOnly: false, sort: 2, active: true, image: '' },
      ],
      contents: [],
      site,
      mp: { ready: false },
      pay: { alipay: { ready: true, missing: [] }, wechatReady: false, missing: [], provider: 'alipay', cloudReady: true },
    });
  }
  if (u.includes('/api/admin/site/save')) {
    savedBody = JSON.parse(opts.body || '{}');
    return json({ site: { ...site, home: savedBody.home || site.home }, mp: { synced: false, message: '未接入' } });
  }
  if (u.includes('/api/admin/users')) {
    return json({
      ready: true,
      users: [
        { id: 'u1', phone: '13800000001', nickname: '正常用户', source: 'web', isMember: true, memberExpire: Date.now() + 86400e3, balance: 1200, orderCount: 2, banned: false, createdAt: Date.now() - 86400e3 },
        { id: 'u2', phone: '13800000002', nickname: '被封用户', source: 'web', isMember: false, memberExpire: null, balance: 0, orderCount: 0, banned: true, banReason: '恶意下单', createdAt: Date.now() - 3600e3 },
      ],
    });
  }
  if (u.includes('/api/admin/content/save')) {
    savedContent = JSON.parse(opts.body || '{}');
    return json({ content: { ...savedContent, id: 'c-new', locked: false } });
  }
  return json({}, 200);
};

w.sessionStorage.setItem('admin_token', 'test-token');
w.eval(js);
await new Promise((r) => setTimeout(r, 120));

const $ = (sel) => w.document.querySelector(sel);
const all = (sel) => [...w.document.querySelectorAll(sel)];

// 先确认已登录进入后台（token 存在时直接 load）
check('后台已加载概览', Boolean($('.side-nav') || $('#panel')), w.document.body.textContent.slice(0, 40).replace(/\s+/g, ' '));

/** 点侧边栏导航切页（走真实交互路径，不依赖内部 state） */
const nav = (key) => w.document.querySelector(`.nav-btn[data-tab="${key}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

// 切到「外观」页
nav('site');
await new Promise((r) => setTimeout(r, 60));

check('外观页有首页展示区', Boolean($('#trustBox')), '');
check('服务保障条有 4 行编辑位', all('#trustBox .trust-edit').length === 4, String(all('#trustBox .trust-edit').length));
check(
  '保障条回填后台配置的文案',
  $('.t-title') && $('.t-title').value === '正品保障' && $('.t-desc').value === '假一赔十',
  `${$('.t-title') && $('.t-title').value} / ${$('.t-desc') && $('.t-desc').value}`
);
check('板块标题回填', $('#h-goodstitle').value === '精选好物' && $('#h-contenttitle').value === '推荐阅读', $('#h-goodstitle').value);
check('客服信息回填', $('#h-wechat').value === 'kefu-test' && $('#h-phone').value === '13800000000', $('#h-wechat').value);
check('保障条总开关存在且勾选', Boolean($('#h-truston')) && $('#h-truston').checked);

// 新增：模块开关 / 主题色 / 底部导航 / 横幅 / 快捷入口
check('有模块开关区', all('#panel .mod-on').length === 10, String(all('#panel .mod-on').length));
check('模块开关回填正确', $('#panel .mod-on[data-mod="contents"]').checked === false && $('.mod-on[data-mod="goods"]').checked === true);
check('主题色回填', $('#h-accent').value === '#f97316' && $('#h-accent2').value === '#fb923c', $('#h-accent').value);
check('底部导航文案回填', $('#h-tab-home').value === '主页' && $('#h-tab-content').value === '文章', $('#h-tab-home').value);
check('横幅配置回填', $('#b-text').value === '双 11 全场 8 折' && $('#b-on').checked === true && $('#b-bg').value === '#f97316', $('#b-text').value);
check('快捷入口编辑器有 2 行', all('#entryBox .entry-edit').length === 2, String(all('#entryBox .entry-edit').length));

// 加一个入口、删一个入口，验证编辑器可用
$('#addEntryBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
check('可添加快捷入口', all('#entryBox .entry-edit').length === 3, String(all('#entryBox .entry-edit').length));
all('#entryBox .entry-edit')[2].querySelector('.e-title').value = '客服';
all('#entryBox .entry-edit')[2].querySelector('.e-act').value = 'support';
all('#entryBox [data-act="entry-del"]')[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
check('可删除快捷入口', all('#entryBox .entry-edit').length === 2, String(all('#entryBox .entry-edit').length));

// 改内容后保存，检查提交给接口的 home 结构
$('#h-goodstitle').value = '热门商品';
$('#h-contenttitle').value = '最新资讯';
$('#h-wechat').value = 'kefu002';
all('#trustBox .trust-edit')[1].querySelector('.t-title').value = ''; // 第 2 条清空 → 应被过滤
$('#saveSiteBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 150));

check('保存请求已发出', Boolean(savedBody), savedBody ? Object.keys(savedBody).join(',') : '无');
check('提交的首页标题正确', savedBody && savedBody.home.goodsTitle === '热门商品' && savedBody.home.contentTitle === '最新资讯', savedBody && savedBody.home.goodsTitle);
check('标题留空的保障条被过滤', savedBody && savedBody.home.trust.length === 2, savedBody && String(savedBody.home.trust.length));
check('提交的客服微信正确', savedBody && savedBody.home.support.wechat === 'kefu002', savedBody && savedBody.home.support.wechat);
check(
  '提交的模块开关正确',
  savedBody && savedBody.home.modules && savedBody.home.modules.contents === false && savedBody.home.modules.goods === true,
  savedBody && JSON.stringify(savedBody.home.modules)
);
check('提交的主题色正确', savedBody && savedBody.home.theme.accent === '#f97316', savedBody && savedBody.home.theme.accent);
check('提交的导航文案正确', savedBody && savedBody.home.tabs.home === '主页', savedBody && savedBody.home.tabs.home);
check(
  '提交的横幅正确',
  savedBody && savedBody.home.banner.text === '双 11 全场 8 折' && savedBody.home.banner.bg === '#f97316',
  savedBody && savedBody.home.banner.text
);
check(
  '提交的快捷入口正确',
  savedBody && savedBody.home.entries.length === 2 && savedBody.home.entries.some((e) => e.title === '客服' && e.act === 'support'),
  savedBody && JSON.stringify(savedBody.home.entries)
);

// 商品页：销量列
nav('products');
await new Promise((r) => setTimeout(r, 60));
const ths = all('#panel th').map((t) => t.textContent.trim());
check('商品表新增销量列', ths.includes('销量'), ths.join(','));
check(
  '销量按已支付订单统计',
  all('#panel tbody tr')[0].textContent.includes('已售 2'),
  all('#panel tbody tr')[0].textContent.replace(/\s+/g, ' ').slice(0, 60)
);

// 内容页：单篇解锁价
nav('contents');
await new Promise((r) => setTimeout(r, 60));
check('内容表单有单篇解锁价', Boolean($('#c-price')), $('#c-price') ? $('#c-price').type : '无');
$('#c-title').value = '付费专栏';
$('#c-price').value = '1.99';
$('#c-membersonly').value = '0';
$('#c-save').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 150));
check('保存内容时带上价格（元转分）', Boolean(savedContent) && savedContent.price === 199, savedContent ? String(savedContent.price) : '无');
check('价格不影响可见范围字段', Boolean(savedContent) && savedContent.membersOnly === false, savedContent ? String(savedContent.membersOnly) : '无');

// 订单页：未支付订单显示剩余时间
nav('orders');
await new Promise((r) => setTimeout(r, 60));
check('订单页显示未支付剩余时间', /剩余 \d+:\d{2}/.test($('#panel').textContent), ($('#panel').textContent.match(/剩余 [\d:]+/) || [''])[0]);
check('未支付订单有「延长」按钮', Boolean($('#panel [data-extend="O-new"]')));
check('已支付订单没有延长按钮', !$('#panel [data-extend="O-paid"]'));

// 用户页：状态列 + 封禁/调余额/送会员
nav('users');
await new Promise((r) => setTimeout(r, 200));
check('用户表有状态列', all('#panel th').map((t) => t.textContent.trim()).includes('状态'), all('#panel th').map((t) => t.textContent.trim()).join(','));
check('封禁用户显示已封禁标签', $('#panel').textContent.includes('已封禁') && $('#panel').textContent.includes('恶意下单'), '');
check('正常用户有封禁按钮', Boolean($('#panel [data-uban="u1"]')) && $('#panel [data-uban="u1"]').textContent.trim() === '封禁');
check('封禁用户按钮变成解封', Boolean($('#panel [data-uban="u2"]')) && $('#panel [data-uban="u2"]').textContent.trim() === '解封');
check('用户行有调余额与送会员', Boolean($('#panel [data-ubal="u1"]')) && Boolean($('#panel [data-umember="u1"]')));

console.log(`\n结果：${pass}/${pass + fails.length} 通过`);
if (fails.length) {
  console.log('失败项：' + fails.join('、'));
  process.exitCode = 1;
}
