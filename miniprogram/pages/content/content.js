const { getBrand, refreshBrand, applyNavTitle } = require('../../utils/brand');

const FAQ = [
    {
        q: '怎么下单？',
        a: '在首页点任意商品进入详情，选好数量后点「立即购买」，确认订单信息再提交，就会生成一笔待支付订单。',
    },
    {
        q: '订单在哪里看？',
        a: '「我的」页就是订单中心：顶部是待支付 / 已支付 / 已取消的数量，下面能按状态筛选，点订单可以看单号、金额和备注。',
    },
    {
        q: '现在能真的付款吗？',
        a: '微信支付正在开通中：小程序已完成绑定，服务类目已过审，备案在审核中；等微信认证和支付配置完成后就会调起真实收银台。在那之前可用「演示支付」把订单标记为已支付，不会扣任何钱。',
    },
    {
        q: '积分怎么获得？',
        a: '每天在「我的 → 积分签到」签到得 50 积分；下单支付成功按 1 元 = 1 积分自动返积分。积分明细在积分页可以随时查看。',
    },
    {
        q: '不想要了怎么办？',
        a: '待支付的订单进详情页就能「取消订单」，取消后不产生任何费用，随时可以重新下单。',
    },
    {
        q: '数据存在哪里？',
        a: '商品、订单、账号资料都存在云库里，换手机重新登录也能看到自己的订单；订单只有本人能看到。',
    },
];

Page({
    data: {
        brand: getBrand(),
        faq: FAQ,
        version: '0.4.0',
        open: -1,
    },

    onLoad() {
        applyNavTitle(this);
        wx.setNavigationBarTitle({ title: '使用说明' });
    },

    async onShow() {
        try {
            await refreshBrand();
        } catch (e) {
            /* 用缓存即可 */
        }
        wx.setNavigationBarTitle({ title: '使用说明' });
        this.setData({ brand: getBrand() });
    },

    onToggle(event) {
        const index = Number(event.currentTarget.dataset.index);
        this.setData({ open: this.data.open === index ? -1 : index });
    },

    onGoShop() {
        wx.switchTab({ url: '/pages/index/index' });
    },

    onGoMine() {
        wx.switchTab({ url: '/pages/mine/mine' });
    },
});
