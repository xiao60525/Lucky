// 线上手机网站支付全链路诊断
const BASE = 'https://mobile-app-pay-skeleton.app.workbuddy.host';
const SC = 'sharecode=O53RMG5UQ2';
const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';

const phone = '1980000' + String(Math.floor(Math.random() * 9000 + 1000));
const PW = 'Test123456!';
const j = async (r) => {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; }
};

// 1. 登录测试用户
let r = await fetch(`${BASE}/api/auth/login?${SC}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone, password: PW }),
});
let d = await j(r);
if (!d.token) {
  r = await fetch(`${BASE}/api/auth/register?${SC}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: PW }),
  });
  d = await j(r);
}
console.log('1. 登录/注册:', d.token ? 'ok (' + phone + ')' : JSON.stringify(d).slice(0, 200));
const token = d.token;

// 2. bootstrap 渠道状态
r = await fetch(`${BASE}/api/bootstrap?${SC}`, { headers: { 'User-Agent': UA_MOBILE, 'x-user-token': token } });
d = await j(r);
console.log('2. bootstrap channels:', JSON.stringify(d.channels), 'alipayReady:', d.alipayReady);

// 3. 找一个商品下单
const goods =
  (d.products || []).find((p) => p.type !== 'recharge' && p.amount > 0 && !p.contentId) ||
  (d.products || []).find((p) => p.amount > 0);
console.log('3. 测试商品:', goods && goods.id, goods && goods.amount);
r = await fetch(`${BASE}/api/orders?${SC}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-user-token': token },
  body: JSON.stringify({ productId: goods.id }),
});
d = await j(r);
const orderId = d.order && d.order.id;
console.log('   下单:', orderId || JSON.stringify(d).slice(0, 200));

// 4. 用支付宝渠道支付（手机 UA）
r = await fetch(`${BASE}/api/orders/${orderId}/pay?${SC}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-user-token': token, 'User-Agent': UA_MOBILE },
  body: JSON.stringify({ channel: 'alipay' }),
});
d = await j(r);
console.log('4. pay mode:', d.mode, '| channel:', d.channel, '| payUrl:', d.payUrl ? d.payUrl.slice(0, 110) + '…' : JSON.stringify(d).slice(0, 250));
if (!d.payUrl) process.exit(0);

// 5. 模拟浏览器：先拉站内中转页 → 解析自动 POST 表单 → 提交给支付宝网关
async function relayToGateway(payUrl, ua) {
  // 中转页是站内地址，预览网关要求带 sharecode（前端 withShare 会自动追加，这里保持一致）
  const relay = await fetch(`${BASE}${payUrl}${payUrl.includes('?') ? '&' : '?'}${SC}`, { headers: { 'User-Agent': ua } });
  const relayHtml = await relay.text();
  if (!relayHtml.includes('alipayForm')) {
    return { status: relay.status, url: `${BASE}${payUrl}`, html: relayHtml, relayError: true };
  }
  const action = (relayHtml.match(/action="([^"]+)"/) || [])[1] || '';
  const inputs = {};
  for (const m of relayHtml.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) {
    inputs[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  const body = new URLSearchParams(inputs).toString();
  const gr = await fetch(action, {
    method: 'POST',
    headers: { 'User-Agent': ua, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'follow',
  });
  const buf = Buffer.from(await gr.arrayBuffer());
  let gh;
  try { gh = new TextDecoder('gbk').decode(buf); } catch { gh = buf.toString('utf8'); }
  return { status: gr.status, url: gr.url, html: gh };
}

r = await relayToGateway(d.payUrl, UA_MOBILE);
let html = r.html;
console.log('5. 网关 status:', r.status, '| 最终 host:', new URL(r.url).host);
const acq = (html.match(/ACQ\.[A-Z_]+/g) || []).slice(0, 3);
console.log('   notSigned(未签约):', /insufficient-isv-permissions|isv\.insufficient/i.test(html));
console.log('   acq业务错误:', acq);
console.log('   invalid签名错误:', /invalid-signature|验签出错/i.test(html));
console.log('   debug调试页:', /调试错误|debugger-error|aliPayDebug/i.test(html));
console.log('   cashier收银台:', /cashier|收银台|confirmForm/i.test(html));
console.log('   alipays唤起App:', html.includes('alipays://'));
console.log('   htmlLen:', html.length);

// 6. PC UA 对照
r = await relayToGateway(d.payUrl, UA_PC);
const htmlPc = r.html;
console.log('6. PC UA:', r.status, '| host:', new URL(r.url).host, '| 含扫码:', /qr|二维码|扫码/i.test(htmlPc), '| 未签约/验签错误:', /insufficient|invalid-signature/i.test(htmlPc));

// 7. 同步回跳
r = await fetch(`${BASE}/api/alipay/return?${SC}&out_trade_no=${orderId}&trade_status=TRADE_SUCCESS`, { redirect: 'manual' });
console.log('7. alipay/return:', r.status, '→', (r.headers.get('location') || '').slice(0, 140));
