const { cloud } = require('../../utils/cloud');
const { createOrder, fenToYuan } = require('../../utils/store');
const { getBrand } = require('../../utils/brand');

Page({
    data: {
        state: 'loading',
        error: '',
        product: null,
        order: null,
        brand: getBrand(), // 保持「确认订单」标题，但页面里可以用到品牌名
    },

    onLoad(query) {
        this.productId = query && query.productId ? decodeURIComponent(query.productId) : '';
        this.start();
    },

    async start() {
        if (!this.productId) {
            this.setData({ state: 'error', error: '没有找到要购买的商品' });
            return;
        }
        this.setData({ state: 'loading', error: '' });

        const { data: session } = await getApp().ensureSession();
        if (!session) {
            this.setData({ state: 'need-login' });
            return;
        }

        // 金额以云端商品表为准，不用页面传过来的值
        const productResult = await cloud.database
            .from('products')
            .select('id, title, amount, description')
            .eq('id', this.productId)
            .maybeSingle();

        if (productResult.error || !productResult.data) {
            this.setData({ state: 'error', error: '商品不存在或已下架' });
            return;
        }

        const product = productResult.data;
        const created = await createOrder(product);
        if (created.error) {
            this.setData({ state: 'error', error: created.error.message || '下单失败，请稍后重试' });
            return;
        }

        this.setData({
            state: 'created',
            product: {
                id: product.id,
                title: product.title,
                amountText: fenToYuan(product.amount),
            },
            order: created.data,
        });
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
