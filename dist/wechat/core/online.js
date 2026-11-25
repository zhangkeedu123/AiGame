'use strict';

// 后台对接层：身份、关卡目录、进度存档全部走 HTTP。
// 除了这里的接口，游戏内不再有其他数据源（本机关卡只作为断网兜底）。

const TOKEN_KEY = 'jinyao-online-token';
const DEVICE_KEY = 'jinyao-device-id';

class Online {
  constructor(platform) {
    this.platform = platform;
    // 令牌与设备号按环境分开存：dev / master 是两套库，串用令牌会一路 401。
    const env = platform.onlineEnv || 'default';
    this.tokenKey = TOKEN_KEY + ':' + env;
    this.deviceKey = DEVICE_KEY + ':' + env;
    this.levels = [];
    this.page = 0;
    this.loading = false;
    this.notice = '';
    this.player = null;
    this.token = platform.read(this.tokenKey) || '';
  }

  request(path, { method = 'GET', token, body } = {}) {
    const auth = token === undefined ? this.token : token;
    return this.platform.onlineRequest('/api/v1' + path, { method, token: auth, body });
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

  // 首次启动：本地有令牌就校验，没有或已失效就用设备号换一个。
  async ensurePlayer(nickname) {
    if (this.token) {
      try {
        this.player = await this.request('/me');
        return this.player;
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    }
    return this.guest(nickname);
  }

  async guest(nickname) {
    const data = await this.request('/me/guest', {
      method: 'POST', token: '',
      body: { device_id: this.deviceId(), ...(nickname ? { nickname } : {}) },
    });
    this.token = data.token;
    this.platform.write(this.tokenKey, data.token);
    this.player = data;
    return data;
  }

  async login(token) {
    this.player = await this.request('/me/login', { method: 'POST', token });
    this.token = token;
    this.platform.write(this.tokenKey, token);
    return this.player;
  }

  // 关卡目录：列表只给名字，逐关取详情才有碎片与图集地址。
  async catalog() {
    const list = await this.request('/levels');
    this.levels = Array.isArray(list) ? list : [];
    const details = [];
    for (let i = 0; i < this.levels.length; i += 4) {
      const batch = this.levels.slice(i, i + 4);
      details.push(...await Promise.all(batch.map(level => this.request('/levels/' + level.id))));
    }
    return details.map(level => this.toLevel(level));
  }

  toLevel(data) {
    const shards = Array.isArray(data.shards) ? data.shards : [];
    return {
      ...data,
      remoteId: data.id,
      duration: (90 + shards.length * 12) * 1000,
      image: this.platform.onlineUrl('/api/v1/levels/' + data.id + '/atlas.png'),
    };
  }

  async detail(id) {
    return this.toLevel(await this.request('/levels/' + id));
  }

  async progress() {
    const data = await this.request('/me/progress');
    const map = {};
    for (const item of (data && data.progress) || []) map[item.level_id] = item;
    this.currentLevelId = (data && data.current_level_id) || null;
    return map;
  }

  async save(levelId, groups, revision) {
    const body = {
      groups: groups.map(group => ({ ids: group.ids.slice(), x: group.x, y: group.y, turn: group.turn })),
      paint: [], assembly_only: true, revision: revision || 0,
    };
    try {
      return await this.request('/me/progress/' + levelId, { method: 'PUT', body });
    } catch (error) {
      if (error.status !== 409) throw error;
      // 版本号被改过（另一台设备或上一次请求超时）：重新读一次再写。
      const stale = await this.request('/me/progress');
      const item = ((stale && stale.progress) || []).find(row => row.level_id === levelId);
      body.revision = item ? item.revision : 0;
      return this.request('/me/progress/' + levelId, { method: 'PUT', body });
    }
  }

  async record(id, groups) {
    if (!this.token) return '本机已保存';
    const map = await this.progress();
    const previous = map[id];
    if (previous && previous.completed) return '已通关，成绩在后台';
    await this.save(id, groups, previous ? previous.revision : 0);
    return '通关成绩已同步';
  }

  async refresh() {
    this.levels = await this.catalog();
    this.page = 0;
    if (!this.levels.length) this.notice = '后台还没有已发布关卡';
  }
}

module.exports = { Online };
