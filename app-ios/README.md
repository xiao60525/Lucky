# 原生 App（云构建版：iOS + Android）

把 `app/public` 的网页用 Capacitor 包成原生工程，用 **Codemagic** 云端机器编译：
iOS 出 `.ipa`（云上 macOS），Android 出 `.apk`（不需要任何开发者账号）。全程不需要本地 Mac / Android Studio。

```
app-ios/
├─ capacitor.config.json        App 名称、Bundle ID、webDir
├─ scripts/sync-web.mjs         把 app/public 同步到 www/（排除管理后台）
├─ scripts/make-icons.mjs       iOS：1024×1024 不透明 App 图标（取线上后台当前图标）
├─ scripts/make-android-icons.mjs  Android：各密度 mipmap 图标 + 自适应前景 + 启动图
├─ assets/icon-1024.png         离线兜底图标（CI 取不到线上时用）
├─ www/                         构建产物：要打进 App 的网页（git 忽略）
├─ ios/                         Xcode 工程（cap sync 生成，已提交必要文件）
└─ android/                     Gradle 工程（cap add android 生成，已提交必要文件）
```

## 一、现在就能跑：编译验证

1. 把仓库推到 GitHub（私有库可以）。
2. 打开 [codemagic.io](https://codemagic.io) 用 GitHub 登录 → **Add application** → 选这个仓库。
3. 工作流选 **`ios-compile-check`**（不需要任何苹果账号）→ **Start new build**。
4. 大约 8~12 分钟出结果。成功即说明工程可编译；产物是可看不可装（未签名）。

## 一·五、现在就能装：Android APK（不需要任何账号）

同上推仓库 → Codemagic 工作流选 **`android-apk`** → 构建完在 Artifacts 下载 `app-debug.apk`，
传到任意安卓手机安装即可（首次安装需允许「安装未知来源应用」）。
App 名称、图标、启动图都会自动取自线上后台「外观」页的当前配置。

## 二、拿到开发者账号后：出可安装的 ipa

### 1. 注册苹果开发者账号
- 打开 <https://developer.apple.com/programs/> → Enroll，选 Individual（个人）或 Organization（公司，需要邓白氏编码）。
- 费用 **$99/年**，个人账号通常 1~3 天审核通过。

### 2. 在 App Store Connect 建 App 记录
- 登录 <https://appstoreconnect.apple.com> → 我的 App → **+** → 新建 App。
- Bundle ID 先要在 *Certificates, Identifiers & Profiles → Identifiers* 里注册：`host.workbuddy.xiaogua`
  （想换也行，改 `capacitor.config.json` 的 `appId` 和 `codemagic.yaml` 里的 `bundle_identifier`，两处要一致）
- App 名称、主语言、SKU 随便填；图标用 `assets/icon-1024.png`。

### 3. Codemagic 里配签名
- 应用设置 → **Code signing identities** → iOS Distribution：按向导上传或自动生成证书与描述文件。
- 应用设置 → **Environment variables** → 新建变量组 `appstore_credentials`，加入：
  | 变量名 | 从哪来 |
  |---|---|
  | `APP_STORE_CONNECT_ISSUER_ID` | App Store Connect → 用户和访问 → 集成 → App Store Connect API |
  | `APP_STORE_CONNECT_KEY_IDENTIFIER` | 同上（Key ID） |
  | `APP_STORE_CONNECT_PRIVATE_KEY` | 同上（下载的 `.p8` 文件全文，只给一次，注意保存） |

### 4. 跑签名工作流
- 选 **`ios-signed-ipa`** → Start new build。产物在 `app-ios/build/ios/ipa/*.ipa`。
- 已顺带开启自动交到 **TestFlight**：审核（Beta 审核，通常几小时到 1 天）通过后，你自己和邀请的测试员在 iPhone 的 TestFlight App 里就能装，不需要上架 App Store。

## 三、改了网页内容怎么办

网页代码（`app/public`）改了之后**不需要重新提交 App**：App 里打包的是网页副本 + 接口走线上。两个选择：
- 只改了接口/数据 → 线上发布一次即可，App 立刻生效（App 内的网页副本只影响首屏静态内容）。
- 改了页面结构/CSS → 重跑一次云构建，出新版本 ipa。

想彻底摆脱"内容靠打包"的限制，可加一步 `npx cap sync` 前把 `capacitor.config.json` 改成 `server.url` 指向线上（见根目录备忘），代价是审核风险变大，不建议。

## 四、必须知道的三个坑

1. **苹果审核 4.2「功能过于简单」**：纯网页套壳容易被拒。建议上架前加一项原生能力——推送通知、离线缓存、相机/相册上传、Apple 登录，任一即可显著降低被拒概率。
2. **虚拟商品必须用苹果内购（IAP）**：App 内卖会员/金币这类虚拟商品，苹果要求走 IAP 并抽 30%，用微信支付会被拒审。卖实物或线下服务不受限。当前"模拟收银台"仅作流程演示，正式上架前需按业务类型改造。
3. **微信支付在原生 App 里不能直接用 H5/JSAPI**：需要接微信 OpenSDK（App 支付），要额外申请「App 支付」权限并配置 Universal Link。当前 `PAY_PROVIDER=mock`，未接通真实渠道。

## 五、常见失败排查

| 现象 | 原因 |
|---|---|
| `pod install` 失败 | Codemagic 上偶发网络问题，重跑一次即可 |
| 图标报 4.3/透明通道错误 | 后台「外观」里换了透明 PNG，重新跑 `npm run icons`（脚本会转成不透明） |
| 编译报 Bundle ID 冲突 | `capacitor.config.json` 的 `appId` 与 App Store Connect 记录不一致 |
| 白色空白页 | 线上域名不可达或 sharecode 变更，改 `app/public/native.js` 里的 `SHARE` 常量后重新构建 |
