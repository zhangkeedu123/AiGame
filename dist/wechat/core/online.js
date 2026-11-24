'use strict';

const TOKEN_KEY = 'jinyao-online-token';

class Online {
  constructor(platform) {
    this.platform = platform;
    this.levels = [];
    this.page = 0;
    this.loading = false;
    this.notice = '';
    this.player = null;
  }

  request(path, options) {
    return this.platform.onlineRequest('/api/v1' + path, options);
  }

  async refresh() {
    const data = await this.request('/levels');
    this.levels = data.levels || data.items || data;
    this.page = 0;
  }

  async level(id) {
    const data = await this.request('/levels/' + id);
    data.image = this.platform.onlineUrl('/api/v1/levels/' + id + '/atlas.png');
    data.duration = (60 + data.shards.length * 12) * 1000;
    return data;
  }

  async login(token) {
    this.player = await this.request('/me/login', { method: 'POST', token });
    this.platform.write(TOKEN_KEY, token);
    return this.player;
  }

  async record(id, groups) {
    const token = this.platform.read(TOKEN_KEY);
    if (!token) return '本机已保存';
    const state = await this.request('/me/progress', { token });
    const previous = state.progress.find(item => item.level_id === id);
    if (!previous?.completed) await this.request('/me/progress/' + id, {
      method: 'PUT', token, body: { groups, paint: [], revision: previous?.revision || 0, assembly_only: true },
    });
    return '通关成绩已同步';
  }
}

module.exports = { Online };
