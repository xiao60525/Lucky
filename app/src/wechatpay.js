'use strict';
/**
 * 微信支付 V3 客户端（原生实现，只依赖 Node 内置 crypto + 全局 fetch）
 * ---------------------------------------------------------------
 * 商户号：1119507394
 *
 * 还需要在 微信支付商户平台 > 账户中心 > API安全 里拿到：
 *   · APIv3 密钥（32 位）
 *   · 商户 API 证书 apiclient_key.pem + 证书序列号
 *   · 微信支付公钥（公钥模式）或平台证书（证书模式，本文件可自动下载）
 * 以及一个 AppID（小程序/公众号/APP 任选其一，必须与该商户号绑定）
 *
 * 金额单位：分
 */

const fs = require('fs');
const crypto = require('crypto');

const API_BASE = 'https://api.mch.weixin.qq.com';

function nonceStr() {
  return crypto.randomBytes(16).toString('hex'); // 微信要求 <= 32 位
}

function readPem(p) {
  if (!p) return null;
  if (p.includes('-----BEGIN')) return p; // 直接传了 PEM 内容
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

class WechatPayError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'WechatPayError';
    this.detail = detail;
  }
}

class WechatPay {
  constructor(opts) {
    this.appid = opts.appid;
    this.mchid = opts.mchid;
    this.apiV3Key = opts.apiV3Key;
    this.serialNo = opts.serialNo;
    this.privateKey = readPem(opts.privateKey);
    this.notifyUrl = opts.notifyUrl;
    this.platformPublicKey = readPem(opts.platformPublicKey);
    this.platformPublicKeyId = opts.platformPublicKeyId;
    this.certs = new Map(); // serial_no -> PEM（证书模式缓存）
  }

  /** 从环境变量构造；缺少必填项返回 null，便于优雅降级到模拟渠道 */
  static fromEnv(env = process.env) {
    const cfg = {
      appid: env.WX_APPID,
      mchid: env.WX_MCHID,
      apiV3Key: env.WX_API_V3_KEY,
      serialNo: env.WX_SERIAL_NO,
      privateKey: env.WX_PRIVATE_KEY || env.WX_PRIVATE_KEY_PATH,
      notifyUrl: env.WX_NOTIFY_URL,
      platformPublicKey: env.WX_PLATFORM_PUBLIC_KEY || env.WX_PLATFORM_PUBLIC_KEY_PATH,
      platformPublicKeyId: env.WX_PLATFORM_PUBLIC_KEY_ID,
    };
    const ready =
      cfg.appid && cfg.mchid && cfg.apiV3Key && cfg.serialNo && readPem(cfg.privateKey) && cfg.notifyUrl;
    return ready ? new WechatPay(cfg) : null;
  }

  /** 还缺哪些配置（用于自检，不泄露任何密钥值） */
  static missingEnv(env = process.env) {
    const need = [
      ['WX_APPID', '小程序/公众号/APP 的 AppID（需与该商户号绑定）'],
      ['WX_MCHID', '商户号'],
      ['WX_API_V3_KEY', 'APIv3 密钥（32 位）'],
      ['WX_SERIAL_NO', '商户 API 证书序列号'],
      ['WX_PRIVATE_KEY_PATH', '商户 API 证书私钥 apiclient_key.pem 路径'],
      ['WX_NOTIFY_URL', '支付结果回调地址（公网可访问的 https 地址）'],
    ];
    return need.filter(([k]) => !env[k]).map(([k, d]) => ({ key: k, desc: d }));
  }

  /* ---------------- 签名 ---------------- */

  sign(message) {
    return crypto.createSign('RSA-SHA256').update(message).sign(this.privateKey, 'base64');
  }

  authorization(method, urlPath, body) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const nc = nonceStr();
    const message = `${method}\n${urlPath}\n${ts}\n${nc}\n${body || ''}\n`;
    return (
      `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchid}",` +
      `nonce_str="${nc}",signature="${this.sign(message)}",` +
      `timestamp="${ts}",serial_no="${this.serialNo}"`
    );
  }

  /* ---------------- 请求 ---------------- */

  async request(method, urlPath, payload) {
    const body = payload ? JSON.stringify(payload) : '';
    const res = await fetch(API_BASE + urlPath, {
      method,
      headers: {
        Authorization: this.authorization(method, urlPath, body),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'wb-mobile-skeleton/0.2',
      },
      body: method === 'GET' ? undefined : body,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      throw new WechatPayError(data.message || `微信支付接口返回 ${res.status}`, {
        status: res.status,
        code: data.code,
        body: data,
      });
    }
    return data;
  }

  /* ---------------- 下单 ---------------- */

  baseOrder({ description, outTradeNo, amount, attach }) {
    return {
      appid: this.appid,
      mchid: this.mchid,
      description,
      out_trade_no: outTradeNo,
      notify_url: this.notifyUrl,
      amount: { total: amount, currency: 'CNY' },
      ...(attach ? { attach } : {}),
    };
  }

  /** JSAPI/小程序下单：需要用户 openid，返回用于 wx.requestPayment 的参数 */
  async createJsapi({ description, outTradeNo, amount, openid, attach }) {
    if (!openid) throw new WechatPayError('JSAPI 下单需要用户 openid（需公众号网页授权或小程序登录）');
    const data = await this.request(
      'POST',
      '/v3/pay/transactions/jsapi',
      Object.assign(this.baseOrder({ description, outTradeNo, amount, attach }), { payer: { openid } })
    );
    return { prepayId: data.prepay_id, payParams: this.buildJsapiParams(data.prepay_id) };
  }

  /** 组装前端调起支付所需参数（paySign 用商户私钥签名） */
  buildJsapiParams(prepayId) {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonce = nonceStr();
    const pkg = `prepay_id=${prepayId}`;
    const message = `${this.appid}\n${timeStamp}\n${nonce}\n${pkg}\n`;
    return {
      appId: this.appid,
      timeStamp,
      nonceStr: nonce,
      package: pkg,
      signType: 'RSA',
      paySign: this.sign(message),
    };
  }

  /** Native 下单：返回二维码链接 code_url，用微信扫码支付（PC/收银台场景） */
  async createNative({ description, outTradeNo, amount, attach }) {
    const data = await this.request(
      'POST',
      '/v3/pay/transactions/native',
      this.baseOrder({ description, outTradeNo, amount, attach })
    );
    return { codeUrl: data.code_url };
  }

  /** H5 下单：手机非微信浏览器使用，返回 h5_url（需要在商户平台开通 H5 支付并配置域名） */
  async createH5({ description, outTradeNo, amount, clientIp, attach }) {
    const body = Object.assign(this.baseOrder({ description, outTradeNo, amount, attach }), {
      scene_info: {
        payer_client_ip: clientIp || '127.0.0.1',
        h5_info: { type: 'Wap' },
      },
    });
    const data = await this.request('POST', '/v3/pay/transactions/h5', body);
    return { h5Url: data.h5_url };
  }

  /* ---------------- 查询 / 关单 / 退款 ---------------- */

  queryByOutTradeNo(outTradeNo) {
    return this.request(
      'GET',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(this.mchid)}`
    );
  }

  closeOrder(outTradeNo) {
    return this.request('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`, {
      mchid: this.mchid,
    });
  }

  /** 申请退款；金额单位为分 */
  refund({ outTradeNo, outRefundNo, refund, total, reason }) {
    return this.request('POST', '/v3/refund/domestic/refunds', {
      out_trade_no: outTradeNo,
      out_refund_no: outRefundNo,
      ...(reason ? { reason } : {}),
      amount: { refund, total, currency: 'CNY' },
    });
  }

  /* ---------------- 回调验签与解密 ---------------- */

  /** 下载并缓存平台证书（证书模式）；公钥模式不需要 */
  async downloadCerts() {
    const data = await this.request('GET', '/v3/certificates');
    for (const item of data.data || []) {
      const pem = this.decryptResource(item.encrypt_certificate);
      this.certs.set(item.serial_no, pem);
    }
    return this.certs;
  }

  /** 取用于验签的公钥：公钥模式直接返回平台公钥；证书模式查缓存，必要时下载 */
  async getVerifyKey(serial) {
    if (this.platformPublicKey && (!this.platformPublicKeyId || this.platformPublicKeyId === serial)) {
      return this.platformPublicKey;
    }
    if (!this.certs.size) await this.downloadCerts();
    return this.certs.get(serial) || null;
  }

  /** 回调验签：时间戳 5 分钟内 + RSA-SHA256 验签 */
  async verifyNotify(rawBody, headers) {
    const ts = headers['wechatpay-timestamp'];
    const nc = headers['wechatpay-nonce'];
    const sig = headers['wechatpay-signature'];
    const serial = headers['wechatpay-serial'];
    if (!ts || !nc || !sig || !serial) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

    const key = await this.getVerifyKey(serial);
    if (!key) return false;

    const message = `${ts}\n${nc}\n${rawBody}\n`;
    return crypto.createVerify('RSA-SHA256').update(message).verify(key, sig, 'base64');
  }

  /** AES-256-GCM 解密回调 resource */
  decryptResource(resource) {
    const { ciphertext, nonce, associated_data } = resource;
    const buf = Buffer.from(ciphertext, 'base64');
    const authTag = buf.subarray(buf.length - 16);
    const data = buf.subarray(0, buf.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(this.apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
    if (associated_data) decipher.setAAD(Buffer.from(associated_data, 'utf8'));
    decipher.setAuthTag(authTag);

    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(plain);
  }

  /** 解析回调：验签 → 解密 → 返回业务数据 */
  async parseNotify(rawBody, headers) {
    const ok = await this.verifyNotify(rawBody, headers);
    if (!ok) throw new WechatPayError('回调验签失败');
    const body = JSON.parse(rawBody);
    if (!body.resource) throw new WechatPayError('回调缺少 resource');
    return { event: body.event_type, data: this.decryptResource(body.resource) };
  }
}

module.exports = { WechatPay, WechatPayError };
