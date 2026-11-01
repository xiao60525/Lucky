'use strict';
/**
 * 支付渠道适配层
 * ---------------------------------------------------------------
 * 上层业务（server.js）只依赖这里的统一接口，不关心底层是模拟收银台、
 * 微信支付还是支付宝。想接真实渠道时：
 *
 *   1. 在 providers 里实现一个渠道对象：
 *        createPayment(order) -> { payUrl }        （H5/跳转模式）
 *                            -> { prepayId }       （小程序/JSAPI 模式）
 *        parseNotify(headers, rawBody) -> { orderId, amount, status }
 *
 *   2. 启动时把 PAY_PROVIDER 环境变量改成渠道名即可，业务代码零改动。
 *
 * 目前 mock（模拟收银台）与 wechat（真实微信支付 V3）可用，支付宝留了骨架。
 */

require('./env').loadEnv();

const crypto = require('crypto');
const { WechatPay } = require('./wechatpay');

// 生产环境务必通过环境变量注入，不要硬编码在代码里
const SECRET = process.env.PAY_SECRET || 'demo-pay-secret-change-me';

/** HMAC-SHA256 签名 */
function sign(raw) {
  return crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
}

/** 订单参与签名的字段：id + 金额(分) + 渠道，防止前端篡改金额 */
function signPayload(order) {
  return `${order.id}:${order.amount}:${order.channel}`;
}

/** 恒定时间比较，避免时序攻击 */
function verify(raw, signature) {
  if (typeof signature !== 'string') return false;
  const expected = sign(raw);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** 决定下单场景：显式配置优先，否则按 UA 自动适配 */
function resolveScene(ctx = {}) {
  const forced = (process.env.WX_PAY_SCENE || 'auto').toLowerCase();
  if (['jsapi', 'native', 'h5'].includes(forced)) return forced;

  const ua = ctx.ua || '';
  const inWechat = /MicroMessenger/i.test(ua);
  const mobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|Windows Phone/i.test(ua);

  if (inWechat) return 'jsapi'; // 微信内置浏览器：JSAPI 调起
  return mobile ? 'h5' : 'native'; // 手机浏览器：H5 收银台；电脑：扫码
}

const providers = {
  /** 模拟收银台：跳转到一个假的收银页，用户点「确认支付」后由服务端发送回调 */
  mock: {
    id: 'mock',
    name: '模拟收银台',
    scene: 'redirect',
    /** 用户从收银台点确认后，延迟多久发回调（模拟真实渠道的异步通知） */
    notifyDelay: 800,
    createPayment(order) {
      const s = sign(signPayload(order));
      return { payUrl: `/cashier?orderId=${encodeURIComponent(order.id)}&sign=${s}` };
    },
  },

  /**
   * 微信支付 V3（真实渠道）
   * 下单场景由 WX_PAY_SCENE 决定：
   *   · jsapi  微信内打开 / 小程序，需要用户 openid（WX_TEST_OPENID 可临时顶替）
   *   · native 电脑或收银台展示二维码，微信扫码支付（最容易用来验证商户号是否可用）
   *   · h5     手机浏览器（非微信）跳转微信收银台，需在商户平台开通 H5 支付
   */
  wechat: {
    id: 'wechat',
    name: '微信支付',
    scene: (process.env.WX_PAY_SCENE || 'auto').toLowerCase(),
    isReady() {
      return !!WechatPay.fromEnv();
    },
    async createPayment(order, ctx = {}) {
      const client = WechatPay.fromEnv();
      if (!client) {
        const missing = WechatPay.missingEnv()
          .map((m) => m.key)
          .join('、');
        throw new Error(`微信支付缺少配置：${missing}`);
      }

      const scene = resolveScene(ctx);
      const base = { description: order.title, outTradeNo: order.id, amount: order.amount };

      if (scene === 'jsapi') {
        const openid = ctx.openid || process.env.WX_TEST_OPENID;
        if (!openid) {
          throw new Error('微信内支付需要用户 openid：请在公众号网页授权或小程序登录后带上 openid');
        }
        const r = await client.createJsapi({ ...base, openid });
        return { mode: 'jsapi', payParams: r.payParams, prepayId: r.prepayId };
      }
      if (scene === 'h5') {
        try {
          const r = await client.createH5({ ...base, clientIp: ctx.clientIp });
          return { mode: 'h5', payUrl: r.h5Url };
        } catch (e) {
          throw new Error(
            `H5 支付下单失败（${e.message}）：手机浏览器支付需在商户平台开通「H5 支付」并配置已备案域名`
          );
        }
      }
      const r = await client.createNative(base);
      return { mode: 'native', codeUrl: r.codeUrl };
    },
    /** 关闭渠道侧订单（用户取消时调用，失败不影响本地关单） */
    async closePayment(order) {
      const client = WechatPay.fromEnv();
      if (client) await client.closeOrder(order.id);
    },
    /** 真实退款：调微信退款接口 */
    async refund(order, outRefundNo) {
      const client = WechatPay.fromEnv();
      if (!client) throw new Error('微信支付未配置，无法发起真实退款');
      return client.refund({
        outTradeNo: order.id,
        outRefundNo,
        refund: order.amount,
        total: order.amount,
        reason: '用户申请退款',
      });
    },
  },

  /** 支付宝（未接入，仅骨架）：alipay.trade.page.pay / trade.create */
  alipay: {
    id: 'alipay',
    name: '支付宝',
    scene: 'redirect',
    createPayment() {
      throw new Error('支付宝未配置：需要 ALIPAY_APP_ID / 应用私钥 / 支付宝公钥证书');
    },
  },

  /** 余额支付：站内渠道，不走外部收银台，直接扣减账户余额 */
  balance: {
    id: 'balance',
    name: '余额支付',
    scene: 'internal',
    createPayment() {
      throw new Error('余额支付由站内直接结算，不经过渠道下单');
    },
  },
};

function getProvider(id) {
  const p = providers[id];
  if (!p) throw new Error(`未知支付渠道: ${id}`);
  return p;
}

/** 渠道展示名，未知渠道不抛错（历史订单里有脏数据时也能正常展示） */
function channelName(id) {
  if (!id) return '未选择';
  return providers[id] ? providers[id].name : id;
}

module.exports = { sign, signPayload, verify, providers, getProvider, channelName, resolveScene };
