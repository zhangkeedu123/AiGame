'use strict';

const levels = require('./core/levels.js');
const { Puzzle, groupBounds } = require('./core/puzzle.js');
const { contains, computeLayout, draw, OPENING_DURATION, OPENING_BREAK } = require('./core/view.js');
const { GameAudio } = require('./core/audio.js');
const { Online } = require('./core/online.js');
const { dailyEdition, dailyRandom, formatTime } = require('./core/daily.js');
const { modes } = require('./core/modes.js');

const MODES_KEY = 'jinyao-modes-v1';
const DAILY_KEY = 'jinyao-daily-v1';
const BONUS_MS = 60000;

class Game {
  constructor(platform) {
    this.platform = platform;
    this.audio = new GameAudio(platform);
    this.online = platform.onlineRequest ? new Online(platform) : null;
    this.remoteProgress = {};
    this.remoteReady = false;
    this.remoteSyncing = false;
    this.connecting = false;
    this.canvas = platform.canvas;
    this.fontFamily = platform.fontFamily || '';
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) throw new Error('金缮夜馆需要 Canvas 2D');
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
      if (this.screen === 'home') this.edition = dailyEdition(Date.now(), this.unlockedCount());
      // 上次没连上后台（启动时断网/接口重启）：回到前台再试一次。
      if (this.online && !this.remoteReady && this.screen === 'home') this.connect();
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
    this.boot();
  }

  // 启动流程：身份 → 关卡目录 → 后台存档。关卡与存档都以后台为准，
  // 只有后台连不上时才退回本机素材，并在首页明确标注「离线兜底」。
  async boot() {
    if (!this.online) {
      this.setStatus('当前环境不支持网络 · 使用本机关卡');
      return;
    }
    await this.connect();
  }

  envTag() {
    const env = this.platform.onlineEnv;
    return env ? env + ' · ' : '';
  }

  async connect() {
    if (this.connecting) return;
    this.connecting = true;
    const tag = this.envTag();
    try {
      try {
        this.player = await this.online.ensurePlayer();
      } catch (error) {
        this.setStatus(tag + '后台连接失败 · 离线兜底（' + error.message + '）');
        return;
      }
      try {
        const list = await this.online.catalog();
        if (list.length) {
          // 原地替换：puzzle.js / modes.js / view.js 引用的是同一个数组。
          levels.splice(0, levels.length, ...list);
          this.textures.clear();
          this.edition = dailyEdition(Date.now(), levels.length);
          const nickname = this.player && this.player.nickname;
          this.setStatus(tag + '后台关卡 ' + list.length + ' 关' + (nickname ? ' · ' + nickname : ''));
        } else {
          this.setStatus(tag + '后台还没有已发布关卡 · 离线兜底');
        }
      } catch (error) {
        this.setStatus(tag + '关卡读取失败 · 离线兜底（' + error.message + '）');
      }
      try {
        this.remoteProgress = await this.online.progress();
        this.remoteReady = true;
      } catch (error) {
        this.setStatus((this.statusText ? this.statusText + ' · ' : '') + '存档读取失败（' + error.message + '）');
      }
      if (this.remoteReady && this.screen === 'home') {
        this.edition = dailyEdition(Date.now(), this.unlockedCount());
      }
      this.renderSoon();
    } finally {
      this.connecting = false;
    }
  }

  // 后台按 sort_order 顺序解锁：每日一瓷只在已解锁的关卡里挑，避免存档被 403 拒掉。
  unlockedCount() {
    if (!this.remoteReady) return levels.length || 1;
    let count = 1;
    for (let i = 0; i < levels.length - 1; i++) {
      const key = levels[i].remoteId || levels[i].id;
      const item = this.remoteProgress[key];
      if (item && item.completed) count = i + 2;
      else break;
    }
    return Math.min(count, levels.length || 1);
  }

  setStatus(text) {
    this.statusText = text;
    this.homeNotice = text;
    this.renderSoon();
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
    } else if (this.screen === 'online') {
      this.platform.write('jinyao-online-' + this.puzzle.level.id, this.puzzle.book);
    }
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
    this.restoreDailyFromRemote();
  }

  // 本机没有存档时，用后台上次保存的碎片位置接着拼。
  restoreDailyFromRemote() {
    const puzzle = this.puzzle;
    if (!this.remoteReady || !puzzle || !puzzle.newBoard) return;
    const item = puzzle.level.remoteId && this.remoteProgress[puzzle.level.remoteId];
    if (!item || !Array.isArray(item.groups) || !item.groups.length) return;
    if (!puzzle.adopt(item.groups)) return;
    this.say('已从后台恢复上次进度。', true);
    this.save();
  }

  async syncDaily() {
    const puzzle = this.puzzle;
    if (!this.online || !this.remoteReady || !puzzle || !puzzle.level.remoteId) return;
    if (this.remoteSyncing) return;
    this.remoteSyncing = true;
    const levelId = puzzle.level.remoteId;
    const previous = this.remoteProgress[levelId];
    try {
      const saved = await this.online.save(levelId, puzzle.state.groups, previous ? previous.revision : 0);
      this.remoteProgress[levelId] = saved;
      if (puzzle === this.puzzle) this.shareNotice = '进度已存入后台';
    } catch (error) {
      if (puzzle === this.puzzle) {
        this.shareNotice = error.status === 403 ? '这关在后台还没解锁，成绩先存本机'
          : '后台保存失败：' + error.message;
      }
    } finally {
      this.remoteSyncing = false;
      this.renderSoon();
    }
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
    if (this.screen === 'online') this.syncOnline();
    if (this.screen === 'daily') { this.recordDaily(); this.syncDaily(); }
    this.defaultMessage();
    this.highlightMessage = true;
  }

  async syncOnline() {
    const puzzle = this.puzzle;
    this.online.notice = '正在同步成绩';
    let notice;
    try { notice = await this.online.record(puzzle.level.id, puzzle.state.groups); }
    catch (_) { notice = '本机已保存，线上同步失败'; }
    if (puzzle === this.puzzle) {
      this.online.notice = notice;
      this.renderSoon();
    }
  }

  async onlineAction(id) {
    const online = this.online;
    if (!online || online.loading) return;
    this.modal = 'online';
    online.loading = true;
    online.notice = '';
    this.renderSoon();
    try {
      if (id === 'online') await online.refresh();
      else if (id === 'online-token') {
        const token = (await this.platform.askToken()).trim();
        if (token) {
          await online.login(token);
          online.notice = '已绑定：' + (online.player.nickname || '玩家');
        }
      } else {
        const level = await online.detail(id.slice(13));
        if (this.modal !== 'online') return;
        this.puzzle = new Puzzle(this.platform.read('jinyao-online-' + level.id), null, undefined, undefined, level);
        this.screen = 'online';
        this.modal = null;
        this.defaultMessage();
        this.prepareBoard();
        if (this.puzzle.phase === 'stored') this.syncOnline();
      }
    } catch (_) { online.notice = '连接失败，请检查服务或令牌'; }
    finally { online.loading = false; this.renderSoon(); }
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
      this.edition = dailyEdition(Date.now(), this.unlockedCount());
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
      this.edition = dailyEdition(Date.now(), this.unlockedCount());
      this.openDaily(false);
    } else if (id === 'online' || id === 'online-token' || id.startsWith('online-level-')) {
      this.onlineAction(id);
    } else if (id === 'online-prev' || id === 'online-next') {
      this.online.page += id === 'online-prev' ? -1 : 1;
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
