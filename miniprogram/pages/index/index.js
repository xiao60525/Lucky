const { listProducts } = require('../../utils/store');
const { getBrand, refreshBrand, applyNavTitle } = require('../../utils/brand');

Page({
    data: {
        loading: true,
        error: '',
        products: [],
        brand: getBrand(),
    },

    onLoad() {
        applyNavTitle(this);
    },

    onShow() {
        this.applyBrand();
        this.load();
    },

    /** 品牌先用本地缓存渲染，再异步拉云库：后台改了名称/图标，重进页面就能看到 */
    async applyBrand() {
        applyNavTitle(this);
        try {
            await refreshBrand();
        } catch (e) {
            /* 拉不到就用缓存 */
        }
        applyNavTitle(this);
    },

    async load() {
        this.setData({ loading: true, error: '' });
        const { data, error } = await listProducts();
        if (error) {
            console.error('[index] 商品加载失败', JSON.stringify({ message: error.message || 'unknown' }));
            this.setData({ loading: false, error: error.message || '商品加载失败，请重试' });
            return;
        }
        this.setData({ loading: false, products: data });
    },

    onRetry() {
        this.load();
    },

    async onPullDownRefresh() {
        await this.applyBrand();
        await this.load();
        wx.stopPullDownRefresh();
    },

    onTapProduct(event) {
        const id = event.currentTarget.dataset.id;
        if (!id) return;
        wx.navigateTo({ url: '/pages/detail/detail?productId=' + encodeURIComponent(id) });
    },

    onGoOrders() {
        wx.switchTab({ url: '/pages/mine/mine' });
    },
});
