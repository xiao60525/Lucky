// 生成一个真实 payUrl 输出到文件，供浏览器打开复现
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
r = await fetch(`${BASE}/api/bootstrap?${SC}`, { headers: { 'x-user-token': token } });
const boot = await j(r);
const goods = (boot.products || []).find((p) => p.amount > 0 && !p.contentId);
r = await fetch(`${BASE}/api/orders?${SC}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-token': token }, body: JSON.stringify({ productId: goods.id }) });
d = await j(r);
r = await fetch(`${BASE}/api/orders/${d.order.id}/pay?${SC}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-user-token': token, 'User-Agent': UA_MOBILE },
  body: JSON.stringify({ channel: 'alipay' }),
});
d = await j(r);
console.log('ORDER=' + (d.order ? d.order.id : '?'));
console.log('PAYURL=' + (d.payUrl || ''));
