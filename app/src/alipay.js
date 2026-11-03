'use strict';
/**
 * 支付宝客户端（原生实现，只依赖 Node 内置 crypto + 全局 fetch）
 * ---------------------------------------------------------------
 * 支持两种页面支付：
 *   · alipay.trade.wap.pay   手机浏览器 → 唤起支付宝 App 或 H5 收银台
 *   · alipay.trade.page.pay  电脑浏览器 → 登录支付宝付款
 *
 * 需要配置（支付宝开放平台 · 应用详情 · 开发设置）：
 *   · ALIPAY_APP_ID        应用 APPID
 *   · ALIPAY_PRIVATE_KEY   应用私钥（RSA2，PKCS8，-----BEGIN PRIVATE KEY-----）
 *   · ALIPAY_PUBLIC_KEY    支付宝公钥（-----BEGIN PUBLIC KEY-----，注意不是「应用公钥」）
 *   · ALIPAY_NOTIFY_URL    异步通知地址（公网 https，如 https://域名/api/notify/alipay）
 *   · ALIPAY_RETURN_URL    同步跳回地址（如 https://域名/api/alipay/return）
 * 可选：
 *   · ALIPAY_SANDBOX=1     使用沙箱网关 openapi.alipaydev.com
 *   · ALIPAY_GATEWAY       自定义网关（优先于 SANDBOX）
 *
 * 金额单位：本文件对外用「分」，支付宝接口用「元」字符串。
 */

const fs = require('fs');
const crypto = require('crypto');

const PROD_GATEWAY = 'https://openapi.alipay.com/gateway.do';
const SANDBOX_GATEWAY = 'https://openapi.alipaydev.com/gateway.do';

function readPem(p) {
  if (!p) return null;
  if (p.includes('-----BEGIN')) return p.replace(/\\n/g, '\n');
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  } catch {
    return null;
  }
}

/** 支付宝要求 timestamp 为北京时间 yyyy-MM-dd HH:mm:ss */
function beijingTimestamp(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.toISOString().replace('T', ' ').slice(0, 19);
}

/** 待签名字符串：除 exclude 外所有非空参数按 key 字典序拼接（值不做 URL 编码）
 *  注意：请求签名要包含 sign_type；异步通知验签要排除 sign 和 sign_type。 */
function signContent(params, exclude = ['sign']) {
  return Object.keys(params)
    .filter((k) => !exclude.includes(k) && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

/** 分 → 元字符串，两位小数 */
function fenToYuan(fen) {
  return (Number(fen || 0) / 100).toFixed(2);
}

class AlipayError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'AlipayError';
    this.detail = detail;
  }
}

class Alipay {
  constructor(opts) {
    this.appId = opts.appId;
    this.privateKey = readPem(opts.privateKey);
    this.publicKey = readPem(opts.publicKey);
    this.gateway = opts.gateway || (opts.sandbox ? SANDBOX_GATEWAY : PROD_GATEWAY);
    this.notifyUrl = opts.notifyUrl;
    this.returnUrl = opts.returnUrl;
    this.sandbox = Boolean(opts.sandbox);
  }

  static fromEnv(env = process.env) {
    const cfg = {
      appId: env.ALIPAY_APP_ID,
      privateKey: env.ALIPAY_PRIVATE_KEY || env.ALIPAY_PRIVATE_KEY_PATH,
      publicKey: env.ALIPAY_PUBLIC_KEY || env.ALIPAY_PUBLIC_KEY_PATH,
      notifyUrl: env.ALIPAY_NOTIFY_URL,
      returnUrl: env.ALIPAY_RETURN_URL,
      sandbox: String(env.ALIPAY_SANDBOX || '') === '1',
      gateway: env.ALIPAY_GATEWAY,
    };
    const ready = cfg.appId && readPem(cfg.privateKey) && readPem(cfg.publicKey) && cfg.notifyUrl;
    return ready ? new Alipay(cfg) : null;
  }

  static missingEnv(env = process.env) {
    const need = [
      ['ALIPAY_APP_ID', '支付宝开放平台应用的 APPID'],
      ['ALIPAY_PRIVATE_KEY', '应用私钥（RSA2，PKCS8 PEM）'],
      ['ALIPAY_PUBLIC_KEY', '支付宝公钥（不是应用公钥）'],
      ['ALIPAY_NOTIFY_URL', '异步通知地址，如 https://你的域名/api/notify/alipay'],
    ];
    return need.filter(([k]) => !env[k]).map(([k, d]) => ({ key: k, desc: d }));
  }

  /** 公共请求参数 */
  baseParams(method, extra = {}) {
    return {
      app_id: this.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: beijingTimestamp(),
      version: '1.0',
      ...extra,
    };
  }

  sign(content) {
    return crypto.createSign('RSA-SHA256').update(content, 'utf8').sign(this.privateKey, 'base64');
  }

  verify(content, signature) {
    try {
      return crypto.createVerify('RSA-SHA256').update(content, 'utf8').verify(this.publicKey, signature, 'base64');
    } catch {
      return false;
    }
  }

  /**
   * 生成页面支付跳转地址
   * @param {{outTradeNo:string,totalAmountFen:number,subject:string,body?:string,wap?:boolean,returnUrl?:string,notifyUrl?:string,timeoutExpress?:string}} o
   */
  buildPagePayUrl(o) {
    const method = o.wap === false ? 'alipay.trade.page.pay' : 'alipay.trade.wap.pay';
    const biz = {
      out_trade_no: o.outTradeNo,
      total_amount: fenToYuan(o.totalAmountFen),
      subject: String(o.subject || '订单').slice(0, 128),
      product_code: method === 'alipay.trade.wap.pay' ? 'QUICK_WAP_WAY' : 'FAST_INSTANT_TRADE_PAY',
      timeout_express: o.timeoutExpress || '30m',
    };
    if (o.body) biz.body = String(o.body).slice(0, 128);

    const params = this.baseParams(method, {
      notify_url: o.notifyUrl || this.notifyUrl,
      return_url: o.returnUrl || this.returnUrl,
      biz_content: JSON.stringify(biz),
    });
    params.sign = this.sign(signContent(params));

    const qs = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');
    return `${this.gateway}?${qs}`;
  }

  /** 验签异步通知 / 同步返回（入参需已 URL 解码） */
  verifyNotify(params) {
    if (!params || !params.sign) return false;
    const content = signContent(params, ['sign', 'sign_type']);
    return this.verify(content, params.sign);
  }

  /** 调用 OpenAPI（表单 POST，业务参数走 biz_content） */
  async callApi(method, bizContent, extraParams = {}) {
    const params = this.baseParams(method, { ...extraParams, biz_content: JSON.stringify(bizContent) });
    params.sign = this.sign(signContent(params));
    const body = new URLSearchParams(params).toString();

    let data;
    try {
      const res = await fetch(this.gateway, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
        body,
      });
      const text = await res.text();
      data = JSON.parse(text);
    } catch (e) {
      throw new AlipayError(`支付宝接口请求失败：${e.message}`, { method });
    }

    const key = method.replace(/\./g, '_') + '_response';
    const resp = data[key] || {};
    if (resp.code && resp.code !== '10000') {
      throw new AlipayError(resp.sub_msg || resp.msg || '支付宝返回错误', {
        method,
        code: resp.code,
        subCode: resp.sub_code,
        subMsg: resp.sub_msg,
      });
    }
    return resp;
  }

  /** 主动查询交易（回调不可靠时以此为准） */
  async query(outTradeNo) {
    return this.callApi('alipay.trade.query', { out_trade_no: outTradeNo });
  }

  /**
   * 当面付预下单：拿到二维码链接（qr.alipay.com/...），扫码即可付款。
   * 相比 wap.pay / page.pay 不需要「手机网站支付 / 电脑网站支付」签约，
   * 只要开通「当面付（扫码支付）」即可，是签约未生效时最稳的收款方式。
   */
  async precreate({ outTradeNo, totalAmountFen, subject, timeoutExpress, notifyUrl }) {
    // 关键：notify_url 必须随下单一起上送，否则扫码付款后支付宝不会回调我们，
    // 订单会一直停在「待支付」（应用里配置的默认异步地址只在部分接口生效）
    const resp = await this.callApi(
      'alipay.trade.precreate',
      {
        out_trade_no: outTradeNo,
        total_amount: fenToYuan(totalAmountFen),
        subject,
        timeout_express: timeoutExpress || '15m',
      },
      { notify_url: notifyUrl || this.notifyUrl }
    );
    return resp.qr_code || '';
  }

  /** 关闭交易（用户取消支付时调用） */
  async close(outTradeNo) {
    return this.callApi('alipay.trade.close', { out_trade_no: outTradeNo });
  }

  /** 退款（金额单位：分） */
  async refund({ outTradeNo, outRequestNo, amountFen, reason }) {
    return this.callApi('alipay.trade.refund', {
      out_trade_no: outTradeNo,
      refund_amount: fenToYuan(amountFen),
      out_request_no: outRequestNo,
      refund_reason: reason || '用户申请退款',
    });
  }

  /* ---------------- 周期扣款（免密自动续费） ---------------- */

  /**
   * 生成周期扣款签约页跳转地址（alipay.user.agreement.page.sign）。
   * @param {{externalAgreementNo:string, singleAmountFen:number, periodType?:string, period?:number, totalPayments?:number, notifyUrl?:string, returnUrl?:string}} o
   * 签约成功后支付宝异步通知 notify_type=dut_user_sign（含 agreement_no）。
   */
  buildCycleSignUrl(o) {
    const single = fenToYuan(o.singleAmountFen);
    const totalPayments = Math.max(1, Number(o.totalPayments) || 24);
    const biz = {
      personal_product_code: 'CYCLE_PAY_SIGN',
      sign_scene: 'INDUSTRY',
      external_agreement_no: o.externalAgreementNo,
      agreement_effect_params: { agreement_effect: 'START' },
      period_rule_params: {
        period_type: o.periodType || 'month',
        period: Number(o.period) || 1,
        single_amount: single,
        total_amount: fenToYuan(o.singleAmountFen * totalPayments),
        total_payments: totalPayments,
      },
    };
    const params = this.baseParams('alipay.user.agreement.page.sign', {
      notify_url: o.notifyUrl || this.notifyUrl,
      return_url: o.returnUrl || this.returnUrl,
      biz_content: JSON.stringify(biz),
    });
    params.sign = this.sign(signContent(params));
    const qs = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');
    return `${this.gateway}?${qs}`;
  }

  /**
   * 周期扣款代扣（alipay.trade.pay，product_code=CYCLE_PAY_AUTH）。
   * 扣款同步返回，trade_status=TRADE_SUCCESS 即扣款成功。
   */
  cyclePay({ outTradeNo, totalAmountFen, subject, agreementNo, notifyUrl }) {
    return this.callApi(
      'alipay.trade.pay',
      {
        out_trade_no: outTradeNo,
        total_amount: fenToYuan(totalAmountFen),
        subject: String(subject || '会员自动续费').slice(0, 128),
        product_code: 'CYCLE_PAY_AUTH',
        agreement_params: { agreement_no: agreementNo },
      },
      { notify_url: notifyUrl || this.notifyUrl }
    );
  }

  /** 解除周期扣款协议 */
  unsign({ agreementNo, notifyUrl }) {
    return this.callApi(
      'alipay.user.agreement.unsign',
      { personal_product_code: 'CYCLE_PAY_SIGN', sign_scene: 'INDUSTRY', agreement_no: agreementNo },
      { notify_url: notifyUrl || this.notifyUrl }
    );
  }

  /** 查询代扣协议状态 */
  queryAgreement({ agreementNo }) {
    return this.callApi('alipay.user.agreement.query', {
      personal_product_code: 'CYCLE_PAY_SIGN',
      sign_scene: 'INDUSTRY',
      agreement_no: agreementNo,
    });
  }
}

module.exports = { Alipay, AlipayError, signContent, beijingTimestamp, fenToYuan, PROD_GATEWAY, SANDBOX_GATEWAY };
