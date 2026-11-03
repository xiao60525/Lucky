# 支付宝正式收款接入手册

> 适用：已有营业执照 + 已 ICP 备案域名。
> 代码侧已全部就绪（`src/alipay.js` 原生 RSA2 实现，43 项 + 12 项自测全通过），本手册只讲平台侧要点和你要填的东西。

---

## 一、必须先想清楚的硬条件

支付宝审核「手机网站支付 / 电脑网站支付」时，会核对三件事，缺一项就驳回：

| 条件 | 说明 | 你这边 |
|---|---|---|
| 网站能正常打开 | 审核员会实际访问，空白页/打不开直接拒 | 需自有域名可访问 |
| 域名已 ICP 备案 | 备案主体必须与支付宝账号主体**一致** | 需营业执照同主体 |
| 页面有完整商品信息 | 首页 + 商品页 + 支付页，内容不能是占位文字 | 本项目已具备 |

**结论**：当前托管域名 `mobile-app-pay-skeleton.app.workbuddy.host` 不是你的备案域名，不能用于签约。必须让你的备案域名指向本服务。

---

## 二、域名落地（两种方案，任选）

### 方案 A：有云服务器（最稳）

把 `app/` 整个目录传到服务器，`npm i && node server.js`（默认端口见 server.js），用 Nginx 反代 + HTTPS 证书。

```nginx
server {
  listen 443 ssl;
  server_name pay.你的域名.com;
  ssl_certificate     /etc/ssl/pay.crt;
  ssl_certificate_key /etc/ssl/pay.key;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

好处：回调地址不带 `sharecode`，最干净，审核也最容易过。

### 方案 B：域名反代到当前托管地址

自有域名 → CDN/Nginx → 回源 `mobile-app-pay-skeleton.app.workbuddy.host`。
注意回源时 Host 头要改成托管域名，否则网关会拒；且回调 URL 仍需保留 `?sharecode=`。

> 能用方案 A 就不要用 B，B 多一层不确定性。

---

## 三、开放平台操作顺序（照着点）

### 第 1 步 · 账号与实名
1. 打开 https://open.alipay.com ，用**营业执照主体**的支付宝账号登录
2. 完成企业实名认证（营业执照 + 法人身份证 + 对公账户）

### 第 2 步 · 创建应用，拿 APPID
1. 控制台 → 我的应用 → 创建应用 → 选「网页/移动应用」
2. 应用名称填你的店铺名，上传图标
3. 创建完成后页面上那串 **16 位数字就是 APPID**（形如 `2021xxxxxxxxxxxx`）

### 第 3 步 · 配置密钥（关键，顺序不能反）
1. 应用详情 → 开发设置 → 接口加签方式 → 点「设置」
2. 选 **公钥模式**
3. 把下面这段「应用公钥」整段粘进去（含 BEGIN/END 两行）：

```
（运行 npm run alipay:doctor，把第 6 节打印的内容整段复制过来）
```

4. 保存后，页面会显示另一段 **「支付宝公钥」** —— 这个才是要填进 `.env` 的，**不要**把应用公钥填进去（这是最常见的错，会导致「付了钱订单不变」）

### 第 4 步 · 签约支付产品
1. 应用详情 → 产品绑定 → 添加「手机网站支付」和「电脑网站支付」
2. 按提示填：网站地址（你的备案域名）、经营类目、商品页截图、支付页截图
3. 需要测试账号的话，先自己在站内注册一个手机号账号给审核员
4. 提交后一般 1 个工作日，结果在「消息中心」看

> 应用状态要从「开发中」提交为「已上线」，否则接口报 `ISV权限不足`。

### 第 5 步 · 把 3 个值填进 `.env`

```ini
ALIPAY_APP_ID=2021xxxxxxxxxxxx
ALIPAY_PUBLIC_KEY_PATH=certs/alipay_public_key.pem   # 把支付宝公钥整段存成这个文件
ALIPAY_NOTIFY_URL=https://pay.你的域名.com/api/notify/alipay
ALIPAY_RETURN_URL=https://pay.你的域名.com/api/alipay/return
ALIPAY_SANDBOX=0
```

应用私钥不用动，已经在 `certs/alipay_app_private_key.pem`（这个文件绝不外传、不进仓库）。

### 第 6 步 · 自检 + 实测

```bash
npm run alipay:doctor     # 应全部 ✓，特别看第 4 项「密钥配对检查」
npm run test:alipay       # 43 + 12 项自测
```

然后上架一个 **0.01 元** 的测试商品，用真手机走一遍：
下单 → 跳支付宝 → 付款 → 自动跳回 → 后台订单变「已支付」。
**只有后台订单真的变了，才算接入成功**（只看到跳转成功不算）。

---

## 四、常见报错对照

| 现象 | 原因 | 处理 |
|---|---|---|
| `ISV权限不足` | 应用未上线，或没签约对应支付产品 | 提交应用上线 + 签约产品 |
| `应用未绑定商户` | APPID 与收款账号没绑定 | 商家中心绑定 APPID |
| 付款成功但订单不变 | 填成了「应用公钥」而非「支付宝公钥」，或 notify 地址不可达 | 重配公钥；`curl` 测 notify 是否 200 |
| `invalid-signature` | 私钥与上传的应用公钥不配对 | 重跑 `alipay:keys` 后重新上传 |
| `INVALID_PARAMETER:total_amount` | 金额格式错 | 代码已按分转元 `toFixed(2)`，检查商品价格配置 |
| 通知一直重试 | 回调没返回纯文本 `success` | 代码已实现，检查网关是否拦截了 POST |

---

## 五、代码侧已处理好的点（无需你再改）

- 请求签名包含 `sign_type`；异步通知验签排除 `sign` 和 `sign_type`
- 金额：站内单位「分」，支付宝接口用「元」字符串
- 回调 `/api/notify/alipay` 返回纯文本 `success/failure`（返回 JSON 会无限重试）
- 同步跳回 `/api/alipay/return` 不信任参数，主动 `trade.query` 确认后才入账
- 通知幂等：同一笔重复通知只入账一次
- 金额校验：回调金额与订单金额不一致直接拒绝
- 外部网关 URL 不加 `sharecode`（加了会破坏签名）
- 后台「支付配置」页可看到支付宝就绪状态和缺失项
