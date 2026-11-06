const { getProduct, placeOrder, fenToYuan } = require('../../utils/store');

Page({
    data: {
        state: 'loading',
        error: '',
        product: null,
        qty: 1,
        remark: '',
        totalText: '0.00',
        submitting: false,
    },

    onLoad(query) {
        this.productId = (query && query.productId) ? decodeURIComponent(query.productId) : '';
        const qty = Math.max(1, Math.min(99, Number((query && query.qty) || 1) || 1));
        this.setData({ qty });
        this.start();
    },

    async start() {
        if (!this.productId) {
            this.setData({ state: 'error', error: '没有找到要购买的商品' });
            return;
        }
        this.setData({ state: 'loading', error: '' });

        // 下单必须登录：没登录先引导去「我的」
        const { data: session } = await getApp().ensureSession();
        if (!session) {
            this.setData({ state: 'need-login' });
            return;
        }

        const { data, error } = await getProduct(this.productId);
        if (error || !data) {
            this.setData({ state: 'error', error: (error && error.message) || '商品不存在或已下架' });
            return;
        }

        wx.setNavigationBarTitle({ title: '确认订单' });
        this.setData({
            state: 'ready',
            product: data,
            totalText: fenToYuan(data.amount * this.data.qty),
        });
    },

    changeQty(next) {
        const qty = Math.max(1, Math.min(99, next));
        if (qty === this.data.qty) return;
        const price = this.data.product ? this.data.product.amount : 0;
        this.setData({ qty, totalText: fenToYuan(price * qty) });
    },

    onMinus() {
        this.changeQty(this.data.qty - 1);
    },

    onPlus() {
        this.changeQty(this.data.qty + 1);
    },

    onRemarkInput(event) {
        this.setData({ remark: event.detail.value });
    },

    async onSubmit() {
        if (this.data.submitting || !this.data.product) return;
        this.setData({ submitting: true, error: '' });

        const { data, error } = await placeOrder(this.productId, this.data.qty, this.data.remark);
        if (error || !data) {
            this.setData({ submitting: false, error: (error && error.message) || '下单失败，请重试' });
            return;
        }

        this.setData({ submitting: false });
        wx.redirectTo({ url: '/pages/order/order?id=' + encodeURIComponent(data.id) + '&new=1' });
    },

    onGoLogin() {
        wx.switchTab({ url: '/pages/mine/mine' });
    },

    onBack() {
        wx.navigateBack();
    },

    onRetry() {
        this.start();
    },
});
