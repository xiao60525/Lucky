const { getProduct, fenToYuan } = require('../../utils/store');

Page({
    data: {
        state: 'loading',
        error: '',
        product: null,
        qty: 1,
        totalText: '0.00',
    },

    onLoad(query) {
        this.productId = (query && query.productId) ? decodeURIComponent(query.productId) : '';
        this.load();
    },

    async load() {
        if (!this.productId) {
            this.setData({ state: 'error', error: '没有找到这个商品' });
            return;
        }
        this.setData({ state: 'loading', error: '' });

        const { data, error } = await getProduct(this.productId);
        if (error || !data) {
            this.setData({ state: 'error', error: (error && error.message) || '商品加载失败' });
            return;
        }

        wx.setNavigationBarTitle({ title: data.title || '商品详情' });
        const qty = Number(this.data.qty) || 1;
        this.setData({
            state: 'ready',
            product: data,
            totalText: fenToYuan(data.amount * qty),
        });
    },

    onRetry() {
        this.load();
    },

    onMinus() {
        this.changeQty((Number(this.data.qty) || 1) - 1);
    },

    onPlus() {
        this.changeQty((Number(this.data.qty) || 1) + 1);
    },

    changeQty(next) {
        const qty = Math.max(1, Math.min(99, next));
        if (qty === this.data.qty) return;
        const price = this.data.product ? this.data.product.amount : 0;
        this.setData({ qty, totalText: fenToYuan(price * qty) });
    },

    onBuy() {
        if (!this.data.product) return;
        const { product, qty } = this.data;
        wx.navigateTo({
            url:
                '/pages/pay/pay?productId=' +
                encodeURIComponent(product.id) +
                '&qty=' +
                qty,
        });
    },

    onGoHome() {
        wx.switchTab({ url: '/pages/index/index' });
    },
});
