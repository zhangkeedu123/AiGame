'use strict';

class Online {
  constructor(platform) {
    this.platform = platform;
    const env = platform.onlineEnv || 'default';
    this.tokenKey = 'jinyao-online-token:' + env;
    this.deviceKey = 'jinyao-device-id:' + env;
    this.details = new Map();
    this.token = platform.read(this.tokenKey) || '';
  }

  request(path, { method = 'GET', token = this.token, body } = {}) {
    return this.platform.onlineRequest('/api/v1' + path, { method, token, body });
  }

  deviceId() {
    const saved = this.platform.read(this.deviceKey);
    if (typeof saved === 'string' && saved.length >= 8) return saved;
    let salt = '';
    for (let i = 0; i < 4; i++) salt += Math.floor(Math.random() * 1e9).toString(36);
    const id = 'g' + Date.now().toString(36) + salt;
    this.platform.write(this.deviceKey, id);
    return id;
  }

  ensurePlayer() {
    if (!this.playerRequest) {
      this.playerRequest = this.identify().finally(() => { this.playerRequest = null; });
    }
    return this.playerRequest;
  }

  async identify() {
    if (this.token) {
      try {
        this.player = await this.request('/me');
        return this.player;
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    }
    const data = await this.request('/me/guest', {
      method: 'POST', token: '', body: { device_id: this.deviceId(), source: this.platform.source || 'wechat' },
    });
    this.token = data.token;
    this.platform.write(this.tokenKey, data.token);
    this.player = data;
    return data;
  }

  catalog() { return this.request('/levels'); }

  toLevel(data) {
    const realCount = data.shards.length - (data.decoy_count || 0);
    return {
      ...data, realCount, rotateCount: data.rotate_count ?? (data.rotations ? Math.ceil(realCount * 0.65) : 0),
      image: this.platform.onlineUrl('/api/v1/levels/' + data.id + '/atlas.png?v=' + (data.atlas_version || 1)),
    };
  }

  detail(entry) {
    const key = entry.id + ':' + entry.atlas_version;
    if (!this.details.has(key)) {
      const pending = this.request('/levels/' + entry.id).then(level => this.toLevel(level)).catch(error => {
        this.details.delete(key);
        throw error;
      });
      this.details.set(key, pending);
      if (this.details.size > 12) this.details.delete(this.details.keys().next().value);
    }
    return this.details.get(key);
  }

  startLevel(id) { return this.request('/me/campaign/levels/' + id + '/start', { method: 'POST' }); }

  finishLevel(id, body) {
    return this.request('/me/campaign/attempts/' + id + '/complete', { method: 'POST', body });
  }

  ranking(month) { return this.request('/ranking' + (month ? '?month=' + month : ''), { token: '' }); }
}

module.exports = { Online };
