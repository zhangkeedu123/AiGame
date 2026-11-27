'use strict';

const shippingFields = [
  ['recipient', '收件人', '请填写真实姓名', 60],
  ['phone', '手机号码', '请输入大陆手机号码', 20],
  ['address', '收货地址', '省市区、街道和门牌号', 240],
];
const shippingStatuses = { pending: '待处理', processing: '备货中', shipped: '已发货', delivered: '已签收' };

class Collection {
  constructor(platform, online) {
    this.platform = platform;
    this.online = online;
    this.items = [];
    this.claims = [];
    this.awards = [];
    this.cost = 30;
    this.balance = 0;
    this.ready = false;
    this.loading = false;
    this.notice = '';
    this.page = 0;
    this.tab = 'items';
    this.form = {};
  }

  get playerId() { return this.online?.player?.id; }

  get storageKey() { return 'jinyao-collection:' + this.online.deviceKey + ':' + this.playerId; }

  async submitDaily(proof, playerId = this.playerId) {
    if (!playerId || playerId !== this.playerId) return;
    const key = this.storageKey + ':daily';
    if (proof) this.platform.write(key, proof);
    const pending = proof || this.platform.read(key);
    if (!pending) return;
    try {
      await this.online.request('/me/daily/complete', { method: 'POST', body: pending });
      if (this.platform.read(key)?.date === pending.date) this.platform.write(key, null);
      return true;
    } catch (error) {
      if ([409, 422].includes(error.status) && this.platform.read(key)?.date === pending.date) {
        this.platform.write(key, null);
      }
      return false;
    }
  }

  async refresh() {
    if (!this.online || this.loading) return;
    this.loading = true;
    this.notice = '';
    try {
      await this.online.ensurePlayer();
      if (this.owner !== this.playerId) {
        this.owner = this.playerId;
        this.items = [];
        this.claims = [];
        this.awards = [];
        this.balance = 0;
      }
      await this.submitDaily();
      const data = await this.online.request('/me/collection');
      this.items = data.items.map(item => ({
        ...item, ms: item.elapsed_ms, verified: true,
        image: this.platform.onlineUrl('/api/v1/levels/' + item.level_id + '/atlas.png?v=' + (item.atlas_version || 1)),
      }));
      this.claims = data.claims;
      this.awards = data.awards || [];
      this.cost = data.cost;
      this.balance = data.balance;
      for (const claim of this.claims) {
        const key = this.redemptionKey(claim.reward_month?.slice(0, 7));
        if (this.platform.read(key) === claim.request_id) this.platform.write(key, null);
      }
      this.ready = true;
    } catch (_) {
      this.ready = false;
      this.notice = '联网后可同步收藏和兑换进度。';
    } finally {
      this.loading = false;
    }
  }

  records(local) {
    const verified = new Set(this.items.map(item => item.date));
    return this.items.concat(local.filter(item => !verified.has(item.date)))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  redemptionKey(month) { return this.storageKey + ':redemption' + (month ? ':' + month : ''); }

  async redeem() {
    const recipient = (this.form.recipient || '').trim();
    const phone = (this.form.phone || '').trim();
    const address = (this.form.address || '').trim();
    if (!recipient) return '请填写收件人姓名。';
    if (!/^(?:\+86[ -]?)?1[3-9]\d{9}$/.test(phone)) return '请输入有效的手机号码。';
    if (address.length < 6) return '请填写完整的收货地址。';
    const month = this.rewardMonth;
    const key = this.redemptionKey(month);
    const requestId = this.platform.read(key) || Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
    this.platform.write(key, requestId);
    try {
      const claim = await this.online.request('/me/collection/redemptions', {
        method: 'POST', body: { request_id: requestId, recipient, phone, address, ...(month ? { reward_month: month } : {}) },
      });
      this.platform.write(key, null);
      this.claims = [claim, ...this.claims.filter(item => item.id !== claim.id)];
      if (month) this.awards = this.awards.filter(award => award.month.slice(0, 7) !== month);
      else this.balance = Math.max(0, this.balance - this.cost);
      this.form = {};
      return '';
    } catch (error) {
      return error.status === 409 ? '兑换额度已变化，请返回刷新后再试。' :
        error.status === 422 ? '收货信息有误，请检查后再提交。' : '暂未确认申请结果，可重试。';
    }
  }
}

module.exports = { Collection, shippingFields, shippingStatuses };

