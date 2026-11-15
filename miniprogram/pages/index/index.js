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
        // 首次进入用骨架屏；之后再回到首页只静默刷新，不再闪一遍骨架
        if (this._loaded) this.load(true);
        else this.load();
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

    /**
     * @param {boolean} silent 静默刷新：保留现有内容，拉到新数据再替换，失败不打扰
     */
    async load(silent) {
        if (!silent) this.setData({ loading: true, error: '' });
        const { data, error } = await listProducts();
        if (error) {
            console.error('[index] 商品加载失败', JSON.stringify({ message: error.message || 'unknown' }));
            if (silent) return; // 静默刷新失败时保留旧内容，不打断浏览
            this.setData({ loading: false, error: error.message || '商品加载失败，请重试' });
            return;
        }
        this._loaded = true;
        this.setData({ loading: false, products: data });
    },

    onRetry() {
        this.load();
    },

    /** 商品图挂了就回退到首字占位，不留一块灰底 */
    onImgError(e) {
        const idx = e.currentTarget.dataset.idx;
        if (idx === undefined || !this.data.products[idx]) return;
        this.setData({ ['products[' + idx + '].image']: '' });
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
