// 支付入口：页面只调用 payOrder，支付方式在这里切换。
//
// 现状：PAY_MODE = 'demo'，走演示支付（只改订单状态，不扣款）。
// 真实微信虚拟支付（xpay）还不能接：平台侧 paymentConfiguration.configured = false，
// 按接入规范此时不能生成任何支付调用代码（sign / requestVirtualPayment 都属禁用范围）。
//
// 凭证配好后的接线顺序（都在这个文件内完成，页面不用改）：
//   1. 调 store.preparePayment(orderId) 拿 outTradeNo / amount / productId / qty
//   2. wx.login() 取一次性 code（每次支付前重新取，有效期约 5 分钟）
//   3. cloud.wechatVirtualPayment.sign({ code, productId, goodsPrice: amount, buyQuantity: qty, outTradeNo, env })
//      —— 返回的 data 整体透传给 requestVirtualPayment，不要自己拆字段重组
//   4. requestVirtualPayment 成功后调 store.markPaidOrder(orderId, outTradeNo, 'xpay')
//   5. err.cause.errCode === -2 是用户主动取消，不提示错误
const { demoPay } = require('./store');

const PAY_MODE = 'demo'; // 'demo' | 'xpay'

async function payOrder(orderId) {
    if (PAY_MODE === 'demo') {
        return demoPay(orderId);
    }
    // xpay 未就绪：明确告知，不静默失败
    return {
        data: null,
        error: { message: '微信支付正在开通中（需先完成微信认证与备案），暂时请用演示支付' },
    };
}

/** 当前是否为演示支付，页面据此显示不同的确认文案 */
function isDemoMode() {
    return PAY_MODE === 'demo';
}

module.exports = { payOrder, isDemoMode, PAY_MODE };
