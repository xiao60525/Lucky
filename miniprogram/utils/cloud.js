// 云服务客户端：全局唯一实例，Auth / Database 共用。
// endpoint 与 publishableKey 是应用级公开配置，来自云服务下发的 publicConfig。
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');

const publicConfig = {
    endpoint: 'https://mp-api.app.workbuddy.host',
    publishableKey: 'wbpk_yRpSbkLI5B3qYWUzX9iyG3_iZjbLUxdNyIqoAkiu68rvPVs5B0l2SK4',
    workBuddyOAuthClientId: 'cb_jq6QyEPkOkJXPcpz0JxS_wbapp_yRpSbkLI5B3qYWUzX9iyG3',
};

const cloud = createMiniProgramWorkBuddyCloud({
    endpoint: publicConfig.endpoint,
    publishableKey: publicConfig.publishableKey,
    workBuddyOAuthClientId: publicConfig.workBuddyOAuthClientId,
    wx: createDiagnosticWx(wx),
});

module.exports = { cloud, publicConfig };
