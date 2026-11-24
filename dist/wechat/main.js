'use strict';

const levels = require('./core/levels.js');
const { Puzzle, groupBounds } = require('./core/puzzle.js');
const { contains, computeLayout, draw, OPENING_DURATION, OPENING_BREAK } = require('./core/view.js');
const { GameAudio } = require('./core/audio.js');
const { dailyEdition, dailyRandom, formatTime } = require('./core/daily.js');
const { modes } = require('./core/modes.js');
const config = require('./config.js');
const { createApi } = require('./core/api.js');
const { loadLevels } = require('./core/remote.js');
const progressBook = require('./core/progress.js');

const MODES_KEY = 'jinyao-modes-v1';
const DAILY_KEY = 'jinyao-daily-v1';
const BONUS_MS = 60000;

class Game {
  constructor(platform) {
    this.platform = platform;
    this.audio = new GameAudio(platform);
    this.canvas = platform.canvas;
    this.fontFamily = platform.fontFamily || '';
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) throw new Error('金缮夜馆需要 Canvas 2D');
    // 接口地址与令牌来自 config.js：dev 连本机后端，master 连服务器。
    this.env = config.resolve(platform);
    this.api = createApi(platform, { apiBase: this.env.apiBase, playerToken: this.env.playerToken });
    this.profile = null;
    this.remoteProgress = {};
    this.syncTimer = null;
    this.syncing = false;
    this.status = this.env.label + ' · 正在连接';
    this.levels = levels;
    this.modes = modes;
    this.modeBooks = platform.read(MODES_KEY) || {};
    this.puzzle = null;
    this.screen = 'home';
    const daily = platform.read(DAILY_KEY) || {};
    this.daily = daily.current || null;
    this.records = Array.isArray(daily.records) ? daily.records : [];
    this.edition = dailyEdition(Date.now(), levels.length);
    this.dailySince = null;
    this.clockSince = null;
    this.clockTimer = null;
    this.visible = true;
    this.watching = false;
    this.homeNotice = '';
    this.shareNotice = '';
    this.textures = new Map();
    this.hits = [];
    this.active = null;
    this.modal = null;
    this.opening = null;
    this.pendingFrame = false;
    this.resize();
    platform.onInput((kind, touch) => this.input(kind, touch));
    platform.onResize(() => this.resize());
    platform.onShow(() => {
      this.visible = true;
      this.audio.setForeground(true);
      if (this.screen === 'home') this.edition = dailyEdition(Date.now(), levels.length);
      this.resumeClock();
      this.resize();
    });
    platform.onHide(() => {
      this.visible = false;
      this.audio.setForeground(false);
      if (this.opening) this.opening.since = null;
      this.pauseClock();
      this.cancel();
      this.save();
      this.dailySince = null;
    });
    this.connect();
  }

  // 启动时拉一次后台：先关卡，再玩家与存档。任何一步失败都退回到本地数据。
  async connect() {
    if (!this.api.enabled) {
      this.statusNote = '当前环境不支持网络，使用本地存档';
      this.updateStatus();
      return;
    }
    await this.syncLevels();
    await this.syncPlayer();
  }

  updateStatus() {
    const parts = [this.env.label];
    if (this.levelCount) parts.push(this.levelCount + ' 关');
    if (this.playerName) parts.push(this.playerName);
    if (this.statusNote) parts.push(this.statusNote);
    this.status = parts.filter(Boolean).join(' · ');
    this.renderSoon();
  }

  async syncLevels() {
    try {
      const list = await loadLevels(this.api);
      if (!list) {
        this.statusNote = '后台还没有已发布关卡';
      } else {
        // 原地替换：puzzle.js 与 modes.js 引用的是同一个数组。
        levels.splice(0, levels.length, ...list);
        this.textures.clear();
        this.edition = dailyEdition(Date.now(), levels.length);
        this.levelCount = list.length;
        this.statusNote = '关卡已同步';
      }
    } catch (error) {
      this.statusNote = '关卡用本地兜底（' + error.message + '）';
    }
    this.updateStatus();
  }

  async syncPlayer() {
    if (!this.api.token) {
      this.statusNote = '未配置玩家令牌';
      this.updateStatus();
      return;
    }
    try {
      this.profile = await this.api.login();
      this.playerName = this.profile.nickname || '玩家';
      this.statusNote = '已登录';
    } catch (error) {
      this.statusNote = '登录失败（' + error.message + '）';
      this.updateStatus();
      return;
    }
    this.updateStatus();
    try {
      this.applyRemoteProgress(await this.api.progress());
    } catch (error) {
      this.statusNote = '存档读取失败（' + error.message + '）';
      this.updateStatus();
    }
  }

  applyRemoteProgress(data, restore) {
    const map = {};
    if (data && Array.isArray(data.progress)) {
      for (const item of data.progress) map[item.level_id] = item;
    }
    this.remoteProgress = map;
    this.remoteReady = true;
    // 后台按顺序解锁：每日一瓷只在已解锁的画作里挑，避免存到还没开放的关卡。
    const edition = dailyEdition(Date.now(), Math.max(1, this.unlockedCount()));
    if (this.screen === 'home') {
      this.edition = edition;
    } else if (this.screen === 'daily' && this.puzzle && this.puzzle.newBoard &&
               edition.index !== this.edition.index) {
      // 进度比页面晚到：只要还没动过盘面，就按新的解锁范围重选今天的画作。
      this.edition = edition;
      this.openDaily(false);
      return;
    }
    if (restore !== false) this.restoreDaily();
  }

  unlockedCount() {
    const total = this.levels.length;
    let count = 1;
    for (let i = 0; i < total; i++) {
      const level = this.levels[i];
      const item = level && level.remoteId ? this.remoteProgress[level.remoteId] : null;
      if (!item || !item.completed) break;
      count = i + 2;
    }
    return Math.min(Math.max(count, 1), total);
  }

  // 每日一瓷用的就是后台那一关的完整几何，碎片数量能对上，可以直接续玩。
  restoreDaily() {
    const puzzle = this.puzzle;
    if (!this.remoteReady || this.screen !== 'daily' || !puzzle) return false;
    const level = puzzle.level;
    if (!level || !level.remoteId || !puzzle.newBoard) return false;
    const item = this.remoteProgress[level.remoteId];
    if (!item || !Array.isArray(item.groups) || !item.groups.length) return false;
    const groups = progressBook.restore(level, item.groups);
    if (!groups) return false;
    puzzle.book.games[puzzle.index] = { groups, remaining: level.duration };
    puzzle.load(puzzle.index);
    this.say('已从' + this.env.label + '恢复进度（修订号 ' + item.revision + '）', true);
    this.renderSoon();
    return true;
  }

  queueSync() {
    if (!this.api || !this.api.enabled || !this.remoteReady) return;
    const puzzle = this.puzzle;
    if (!puzzle) return;
    if (this.screen === 'daily') {
      if (!puzzle.level || !puzzle.level.remoteId) return;
    } else if (this.screen === 'campaign') {
      // 三模式只上报通关，过程盘面是本地切分的，和后台关卡碎片数不一致。
      if (puzzle.phase !== 'stored') return;
    } else return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.flushSync();
    }, 1200);
    if (typeof this.syncTimer.unref === 'function') this.syncTimer.unref();
  }

  syncTarget() {
    const puzzle = this.puzzle;
    if (!puzzle) return null;
    if (this.screen === 'daily') return puzzle.level || null;
    if (this.screen === 'campaign') return this.levels[puzzle.index % this.levels.length] || null;
    return null;
  }

  async flushSync() {
    const puzzle = this.puzzle;
    const target = this.syncTarget();
    if (!puzzle || !target || !target.remoteId) return;
    if (this.syncing) {
      this.queueSync();
      return;
    }
    const snapshot = this.screen === 'daily' && puzzle.level === target
      ? progressBook.snapshot(puzzle.state, puzzle.phase === 'stored')
      : puzzle.phase === 'stored' ? progressBook.completed(target.shards.length) : null;
    if (!snapshot) return;
    this.syncing = true;
    const levelId = target.remoteId;
    const body = snapshot;
    const known = this.remoteProgress[levelId];
    body.revision = known ? known.revision : 0;
    try {
      this.remoteProgress[levelId] = await this.api.saveProgress(levelId, body);
      this.syncLabel = '进度已存到' + this.env.label;
    } catch (error) {
      if (error.status === 409) {
        try {
          this.applyRemoteProgress(await this.api.progress(), false);
          const fresh = this.remoteProgress[levelId];
          body.revision = fresh ? fresh.revision : 0;
          this.remoteProgress[levelId] = await this.api.saveProgress(levelId, body);
          this.syncLabel = '修订号冲突，已重读后保存';
        } catch (inner) {
          this.syncLabel = '存档冲突：' + inner.message;
        }
      } else if (error.status === 403) {
        this.syncLabel = '后台按顺序解锁，这一关还没开放';
      } else if (error.status === 401) {
        this.syncLabel = '令牌无效，进度只存本地';
      } else {
        this.syncLabel = '存档失败：' + error.message;
      }
    } finally {
      this.syncing = false;
      this.renderSoon();
    }
  }

  defaultMessage() {
    const phase = this.puzzle.phase;
    this.say(phase === 'fit' ? '拖动碎片，让相邻裂边贴合。'
      : this.screen === 'daily' ? '本次修复用时 ' + formatTime(this.daily.elapsed) : '瓷器已收入藏品柜。');
  }

  say(message, highlight) {
    this.message = message;
    this.highlightMessage = Boolean(highlight);
  }

  resize() {
    this.cancel();
    const info = this.platform.windowInfo();
    const ratio = Math.min(3, Math.max(1, info.ratio));
    this.layout = computeLayout(info);
    const width = Math.round(info.width * ratio), height = Math.round(info.height * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.pixelX = width / info.width;
    this.pixelY = height / info.height;
    this.renderSoon();
  }

  renderSoon() {
    if (this.pendingFrame) return;
    this.pendingFrame = true;
    this.platform.frame(() => {
      this.pendingFrame = false;
      const animate = this.advanceOpening();
      this.ctx.save();
      try {
        this.ctx.scale(this.pixelX, this.pixelY);
        this.hits = draw(this.ctx, this.layout, this);
      } finally { this.ctx.restore(); }
      if (animate) this.renderSoon();
    });
  }

  prepareBoard() {
    this.opening = this.puzzle.newBoard ? { elapsed: 0, since: null } : null;
    this.resumeClock();
  }

  advanceOpening() {
    if (!this.opening || !this.visible || this.modal === 'settings' || !this.imageFor(this.puzzle.level)) return false;
    const now = Date.now();
    const previous = this.opening.elapsed;
    if (this.opening.since !== null) this.opening.elapsed += Math.max(0, now - this.opening.since);
    this.opening.since = now;
    if (previous < OPENING_BREAK && this.opening.elapsed >= OPENING_BREAK) this.audio.effect('break');
    if (this.opening.elapsed < OPENING_DURATION) return true;
    this.opening = null;
    this.resumeClock();
    return false;
  }

  imageFor(level) {
    const path = level.image;
    if (!this.textures.has(path)) {
      const texture = { image: null, failed: false };
      this.textures.set(path, texture);
      this.platform.loadImage(path, image => {
        texture.image = image;
        this.renderSoon();
      }, () => {
        texture.failed = true;
        this.renderSoon();
      });
    }
    return this.textures.get(path).image;
  }

  imageFailed(level) {
    const texture = this.textures.get(level.image);
    return texture ? texture.failed : false;
  }

  save() {
    if (this.screen === 'daily') {
      this.updateDailyTime();
      this.daily.book = this.puzzle.book;
      this.platform.write(DAILY_KEY, { current: this.daily, records: this.records });
    } else if (this.screen === 'campaign') {
      this.modeBooks[this.puzzle.mode] = this.puzzle.book;
      this.platform.write(MODES_KEY, this.modeBooks);
    }
    this.queueSync();
  }

  syncClock() {
    if (this.clockSince === null) return;
    const now = Date.now();
    const state = this.puzzle.state;
    state.remaining = Math.max(0, state.remaining - Math.max(0, now - this.clockSince));
    this.clockSince = now;
    if (state.remaining > 0) return;
    this.pauseClock();
    this.cancel();
    this.modal = 'timeout';
    this.adNotice = '';
    this.audio.effect('timeout');
    this.save();
    this.renderSoon();
  }

  pauseClock() {
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    this.clockTimer = null;
    if (this.clockSince === null) return;
    const state = this.puzzle.state;
    state.remaining = Math.max(0, state.remaining - Math.max(0, Date.now() - this.clockSince));
    this.clockSince = null;
    if (this.screen === 'daily') {
      this.updateDailyTime();
      this.dailySince = null;
    }
  }

  resumeClock() {
    if (!this.visible || this.opening || this.modal === 'settings' || !this.puzzle ||
        this.screen === 'home' || this.puzzle.phase === 'stored') return;
    if (this.puzzle.state.remaining === 0) {
      if (this.modal !== 'timeout') this.adNotice = '';
      this.modal = 'timeout';
      return;
    }
    if (this.clockSince !== null) return;
    this.clockSince = Date.now();
    if (this.screen === 'daily') this.dailySince = this.clockSince;
    this.scheduleClock();
  }

  scheduleClock() {
    this.clockTimer = setTimeout(() => {
      this.clockTimer = null;
      this.syncClock();
      if (this.clockSince !== null) this.scheduleClock();
      this.renderSoon();
    }, Math.min(1000, this.puzzle.state.remaining));
    if (this.clockTimer && typeof this.clockTimer.unref === 'function') this.clockTimer.unref();
  }

  async watchForTime() {
    if (this.watching || this.modal !== 'timeout') return;
    if (typeof this.platform.rewardedVideo !== 'function') {
      this.adNotice = '当前环境暂时无法播放广告';
      this.renderSoon();
      return;
    }
    this.watching = true;
    this.adNotice = '';
    this.renderSoon();
    try {
      const watched = await this.platform.rewardedVideo();
      if (watched) {
        this.puzzle.state.remaining += BONUS_MS;
        this.modal = null;
        this.resumeClock();
        this.save();
      } else this.adNotice = '完整观看后可增加时间';
    } catch (_) {
      this.adNotice = '广告暂不可用，可以本关重开';
    } finally {
      this.watching = false;
      this.renderSoon();
    }
  }

  updateDailyTime() {
    if (this.dailySince === null) return;
    const now = Date.now();
    this.daily.elapsed += Math.max(0, now - this.dailySince);
    this.dailySince = this.puzzle.phase === 'stored' ? null : now;
  }

  openDaily(restart) {
    this.pauseClock();
    const { date, day, index } = this.edition;
    if (restart || !this.daily || this.daily.date !== date) this.daily = { date, elapsed: 0 };
    this.puzzle = new Puzzle(this.daily.book, dailyRandom(day), index);
    this.screen = 'daily';
    this.modal = null;
    this.shareNotice = '';
    if (this.puzzle.phase === 'stored') this.recordDaily();
    this.defaultMessage();
    this.prepareBoard();
    this.save();
    this.restoreDaily();
  }

  recordDaily() {
    this.updateDailyTime();
    const previous = this.records.find(record => record.date === this.daily.date);
    if (!previous || this.daily.elapsed < previous.ms) {
      this.records = this.records.filter(record => record.date !== this.daily.date);
      this.records.push({ date: this.daily.date, index: this.puzzle.index, ms: this.daily.elapsed });
      this.records.sort((a, b) => a.ms - b.ms || b.date.localeCompare(a.date));
    }
  }

  share() {
    const daily = this.screen === 'daily';
    const time = daily ? formatTime(this.daily.elapsed) : '';
    const title = daily ? '金缮夜馆 ' + time : '金缮夜馆';
    const desc = daily ? this.puzzle.level.name + ' · 修复用时 ' + time : '一起来修复国风瓷器';
    const puzzle = this.puzzle;
    const notice = message => {
      if (this.screen === 'home' && !daily) this.homeNotice = message;
      else if (this.screen === 'daily' && puzzle === this.puzzle) {
        this.shareNotice = message;
        this.say(message, true);
      }
      this.renderSoon();
    };
    if (daily) this.shareNotice = '';
    else this.homeNotice = '';
    if (typeof this.platform.share === 'function') this.platform.share({ title, desc }, notice);
    else notice('当前环境暂不支持分享');
  }

  world(touch) {
    const { field, scale } = this.layout;
    return { x: (touch.x - field.x) / scale, y: (touch.y - field.y) / scale };
  }

  hitAt(touch) {
    return this.hits.find(hit => contains(hit.rect, touch.x, touch.y));
  }

  input(kind, touch) {
    if (kind === 'cancel') {
      if (!touch || (this.active && touch.id === this.active.id)) this.cancel();
      return;
    }
    const wasTimedOut = this.modal === 'timeout';
    this.syncClock();
    if (!wasTimedOut && this.modal === 'timeout') return;
    if (kind === 'start') {
      if (touch && !this.active) this.start(touch);
      return;
    }
    if (!this.active || (touch && touch.id !== this.active.id)) return;
    if (kind === 'move') {
      if (touch) this.move(touch);
    } else if (kind === 'end') this.release(touch || this.active.last);
  }

  start(touch) {
    this.audio.gesture();
    const hit = this.hitAt(touch);
    const active = { id: touch.id, first: touch, last: touch, button: hit?.id,
      slider: hit?.slider, group: null, moved: false };
    this.active = active;
    if (active.slider) {
      this.move(touch);
      return;
    }
    if (hit || this.screen === 'home' || this.opening || this.modal || !contains(this.layout.field, touch.x, touch.y)) return;
    if (this.puzzle.phase !== 'fit' || !this.imageFor(this.puzzle.level)) return;
    const point = this.world(touch);
    const group = this.puzzle.hit(point.x, point.y);
    if (!group) return;
    this.puzzle.select(group);
    active.group = group;
    active.origin = [group.x, group.y];
    active.bounds = groupBounds(this.puzzle.level, group);
    this.renderSoon();
  }

  move(touch) {
    const active = this.active;
    active.last = touch;
    if (active.slider) {
      const { channel, x, w } = active.slider;
      this.audio.setVolume(channel, (touch.x - x) / w * 100);
      this.renderSoon();
      return;
    }
    const dx = touch.x - active.first.x, dy = touch.y - active.first.y;
    if (!active.moved && Math.hypot(dx, dy) < 3) return;
    active.moved = true;
    if (!active.group) return;
    const scale = this.layout.scale;
    this.puzzle.dragTo(active.group, active.origin[0] + dx / scale, active.origin[1] + dy / scale, active.bounds);
    this.renderSoon();
  }

  release(touch) {
    const active = this.active;
    this.audio.gesture();
    this.move(touch);
    this.active = null;
    if (active.slider) {
      this.audio.save();
      if (active.slider.channel === 'effects') this.audio.effect('join');
    } else if (active.group) {
      if (active.moved) {
        if (this.puzzle.finishMove(active.group)) this.afterJoin();
        else this.defaultMessage();
      }
      this.save();
    } else if (!active.moved && active.button && active.button === this.hitAt(touch)?.id) {
      this.action(active.button);
    }
    this.renderSoon();
  }

  cancel() {
    if (!this.active) return;
    const { group, origin, bounds, slider } = this.active;
    this.active = null;
    if (slider) this.audio.save();
    if (group) {
      this.puzzle.dragTo(group, origin[0], origin[1], bounds);
      this.renderSoon();
    }
  }

  afterJoin() {
    if (this.puzzle.phase === 'fit') {
      this.audio.effect('join');
      this.say('裂边已贴合，可以拖动这一整组。', true);
      return;
    }
    this.pauseClock();
    this.modal = 'win';
    this.audio.effect('win');
    if (this.screen === 'daily') this.recordDaily();
    this.defaultMessage();
    this.highlightMessage = true;
  }

  load(index, restart) {
    this.pauseClock();
    this.puzzle.load(index, restart);
    this.modal = null;
    this.defaultMessage();
    this.prepareBoard();
    this.save();
  }

  action(id) {
    const p = this.puzzle;
    if (id === 'home') {
      this.pauseClock();
      this.save();
      this.screen = 'home';
      this.puzzle = null;
      this.opening = null;
      this.edition = dailyEdition(Date.now(), levels.length);
      this.dailySince = null;
      this.homeNotice = '';
      this.modal = null;
    } else if (id.startsWith('mode-')) {
      const mode = id.slice(5);
      this.puzzle = new Puzzle(this.modeBooks[mode], null, undefined, mode);
      this.screen = 'campaign';
      this.modal = null;
      this.defaultMessage();
      this.prepareBoard();
      this.save();
    } else if (id === 'daily') {
      this.edition = dailyEdition(Date.now(),
        Math.max(1, this.remoteReady ? this.unlockedCount() : levels.length));
      this.openDaily(false);
    } else if (id === 'settings') {
      this.pauseClock();
      if (this.opening) this.opening.since = null;
      this.modal = 'settings';
      this.save();
    } else if (id === 'toggle-music') this.audio.toggle('music');
    else if (id === 'toggle-effects') this.audio.toggle('effects');
    else if (id === 'ranking') this.modal = 'ranking';
    else if (id === 'share') this.share();
    else if (id === 'reference') this.modal = 'reference';
    else if (id === 'close') {
      const settings = this.modal === 'settings';
      this.modal = null;
      if (settings) this.resumeClock();
    }
    else if (id === 'reset') this.modal = 'reset';
    else if (id === 'rearrange') {
      p.rearrange();
      this.say('桌面已重排', true);
      this.save();
    } else if (id === 'ad-time') this.watchForTime();
    else if (id === 'confirm-reset') {
      if (this.screen === 'daily') this.openDaily(true);
      else this.load(p.index, true);
    }
    else if (id === 'next') this.load(p.index + 1);
    else if (id === 'hint') {
      const near = p.findNeighbors();
      if (!near) return;
      this.say(near.a.turn === near.b.turn ? '高亮的两组接得上，试着贴合裂边。'
        : '高亮的是两组邻片，先把方向转一致。', true);
    } else if (id === 'rotate') {
      if (p.turnSelected()) this.afterJoin();
      else {
        this.audio.effect('rotate');
        this.say('已顺时针旋转 90°。');
      }
      this.save();
    } else if (id === 'retry') this.textures.delete(p.level.image);
    else if (id.startsWith('level-')) this.load(Number(id.slice(6)));
    this.renderSoon();
  }
}

module.exports = { start: platform => new Game(platform) };
