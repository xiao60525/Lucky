const { cloud } = require('./utils/cloud');
const { getBrand, refreshBrand } = require('./utils/brand');

App({
    globalData: {
        appName: '手机应用',
        brand: { name: '手机应用', tagline: '', logo: '', ver: '', initial: '应' },
    },

    onLaunch() {
        // 名称/图标由网页版管理后台「外观」页写入云库，这里先用缓存、再异步刷新
        this.globalData.brand = getBrand();
        this.globalData.appName = this.globalData.brand.name;
        refreshBrand()
            .then((brand) => {
                this.globalData.brand = brand;
                this.globalData.appName = brand.name;
            })
            .catch(() => {});
    },

    ensureSession() {
        if (!this.sessionPromise) {
            this.sessionPromise = cloud.auth.getSession();
        }
        return this.sessionPromise;
    },

    resetSession() {
        this.sessionPromise = null;
    },
});
