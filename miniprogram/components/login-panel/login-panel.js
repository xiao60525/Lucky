// 手机号验证码登录组件：发送与验证是两个动作；验证只使用当前手机号对应的已发送结果；成功后触发 signedin 事件。
// 依赖 utils/cloud.js 导出的 { cloud }（createMiniProgramWorkBuddyCloud 创建的唯一实例）。

const { cloud } = require('../../utils/cloud');
const { saveMyProfile } = require('../../utils/store');

// 大陆手机号：11 位、以 1 开头
const PHONE_RE = /^1\d{10}$/;
const COUNTDOWN_SECONDS = 60;

Component({
    data: {
        phone: '',
        code: '',
        sending: false,
        submitting: false,
        countdown: 0,
        tip: '',
        error: '',
    },

    lifetimes: {
        attached() {
            this.alive = true;
        },
        detached() {
            this.alive = false;
            this.stopCountdown();
        },
    },

    methods: {
        onPhoneInput(event) {
            this.setData({ phone: event.detail.value, error: '' });
        },

        onCodeInput(event) {
            this.setData({ code: event.detail.value, error: '' });
        },

        async sendCode() {
            if (this.data.sending || this.data.countdown > 0) {
                return;
            }
            const phone = (this.data.phone || '').trim();
            if (!PHONE_RE.test(phone)) {
                this.setData({ error: '请输入正确的 11 位手机号' });
                return;
            }
            this.setData({ sending: true, error: '', tip: '' });
            let sent;
            try {
                sent = await cloud.auth.sendOtp({ phone: phone });
            } catch (error) {
                sent = { data: null, error: { message: '' } };
            }
            if (this.alive === false) {
                return;
            }
            this.setData({ sending: false });
            if (sent.error) {
                this.setData({ error: sent.error.message || '验证码发送失败，请重试' });
                return;
            }
            this.challenge = {
                phone: phone,
                verificationId: sent.data.verificationId,
                isExistingUser: sent.data.isExistingUser,
            };
            this.setData({ tip: '验证码已发送，请查收短信', countdown: COUNTDOWN_SECONDS });
            this.startCountdown();
        },

        async submit() {
            if (this.data.submitting) {
                return;
            }
            const phone = (this.data.phone || '').trim();
            const code = (this.data.code || '').trim();
            if (!PHONE_RE.test(phone)) {
                this.setData({ error: '请输入正确的 11 位手机号' });
                return;
            }
            if (code === '') {
                this.setData({ error: '请输入短信收到的验证码' });
                return;
            }
            const pending = this.challenge;
            if (!pending || pending.phone !== phone) {
                this.setData({ error: '请先获取当前手机号的验证码' });
                return;
            }
            this.setData({ submitting: true, error: '', tip: '' });
            let completed;
            try {
                completed = await cloud.auth.verifyOtp({
                    phone: pending.phone,
                    verificationId: pending.verificationId,
                    isExistingUser: pending.isExistingUser,
                    token: code,
                });
            } catch (error) {
                completed = { data: null, error: { message: '' } };
            }
            if (this.alive === false) {
                return;
            }
            this.setData({ submitting: false });
            if (completed.error) {
                this.setData({ error: completed.error.message || '登录失败，请重试' });
                return;
            }

            // 把手机号落到 profiles 表，后台才能看到用户。失败不阻断登录，页面侧还会再补一次。
            const user = (completed.data && completed.data.user) || {};
            await saveMyProfile(user.phone || phone);

            this.challenge = null;
            this.setData({ code: '', tip: '' });
            this.triggerEvent('signedin');
        },

        startCountdown() {
            this.stopCountdown();
            this.countdownTimer = setInterval(() => {
                const next = this.data.countdown - 1;
                if (next <= 0) {
                    this.stopCountdown();
                    this.setData({ countdown: 0 });
                    return;
                }
                this.setData({ countdown: next });
            }, 1000);
        },

        stopCountdown() {
            if (this.countdownTimer) {
                clearInterval(this.countdownTimer);
                this.countdownTimer = null;
            }
        },
    },
});
