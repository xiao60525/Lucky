// 抓取支付宝 H5 收银台页面，检查唤起逻辑与潜在错误
const BASE = 'https://mobile-app-pay-skeleton.app.workbuddy.host';
const SC = 'sharecode=O53RMG5UQ2';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const phone = '1980000' + String(Math.floor(Math.random() * 9000 + 1000));
const PW = 'Test123456!';
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t.slice(0, 200) }; } };

let r = await fetch(`${BASE}/api/auth/login?${SC}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: PW }) });
let d = await j(r);
if (!d.token) {
  r = await fetch(`${BASE}/api/auth/register?${SC}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: PW }) });
  d = await j(r);
}
const token = d.token;
console.log('phone:', phone, 'token?', Boolean(token));
r = await fetch(`${BASE}/api/bootstrap?${SC}`, { headers: { 'x-user-token': token } });
const boot = await j(r);
const goods = (boot.products || []).find((p) => p.amount > 0 && !p.contentId);
r = await fetch(`${BASE}/api/orders?${SC}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-token': token }, body: JSON.stringify({ productId: goods.id }) });
d = await j(r);
console.log('order resp:', JSON.stringify(d).slice(0, 200));
r = await fetch(`${BASE}/api/orders/${d.order.id}/pay?${SC}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-user-token': token, 'User-Agent': UA_MOBILE },
  body: JSON.stringify({ channel: 'alipay' }),
});
d = await j(r);
console.log('pay resp:', JSON.stringify(d).slice(0, 200));
if (!d.payUrl) process.exit(1);
r = await fetch(d.payUrl, { headers: { 'User-Agent': UA_MOBILE }, redirect: 'follow' });
const buf = Buffer.from(await r.arrayBuffer());
let html; try { html = new TextDecoder('gbk').decode(buf); } catch { html = buf.toString('utf8'); }
console.log('finalUrl:', r.url);
console.log('--- 前 3000 字符 ---');
console.log(html.slice(0, 3000));
console.log('--- 关键词 ---');
for (const kw of ['alipays:', 'alipay:', 'fadeOut', '点击继续', '继续付款', '订单信息', '商品', '金额', '错误', '异常', '超时', '不存在']) {
  if (html.includes(kw)) console.log('含:', kw);
}
