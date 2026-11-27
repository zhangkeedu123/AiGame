'use strict';

const { Puzzle, WIDTH, HEIGHT, SCALE, groupBounds } = require('./core/puzzle.js');
const { contains, computeLayout, draw, OPENING_DURATION, OPENING_BREAK } = require('./core/view.js');
const { GameAudio } = require('./core/audio.js');
const { Online } = require('./core/online.js');
const { Collection, shippingFields } = require('./core/collection.js');
const { dailyRandom, formatTime } = require('./core/daily.js');
const modes = require('./core/modes.js');

const DAILY_KEY = 'jinyao-daily-v1';

class Game {
  constructor(platform) {
    this.platform = platform;
    this.audio = new GameAudio(platform);
    this.online = platform.onlineRequest ? new Online(platform) : null;
    this.collection = new Collection(platform, this.online);
    this.remoteLevels = [];
    this.connecting = false;
    this.canvas = platform.canvas;
    this.fontFamily = platform.fontFamily || '';
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) throw new Error('金缮夜馆需要 Canvas 2D');
    this.modes = modes;
    this.completed = new Set();
    this.ranking = { page: 0 };
    this.puzzle = null;
    this.screen = 'home';
    const daily = platform.read(DAILY_KEY) || {};
    this.daily = daily.current || null;
    this.records = Array.isArray(daily.records) ? daily.records.filter(record => record && typeof record.date === 'string') : [];
    this.clockSince = null;
    this.clockTimer = null;
    this.visible = true;
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
      if (this.online && this.screen === 'home') this.connect();
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
    });
    this.connect();
  }

  connect() {
    if (this.connecting) return this.connecting;
    if (!this.online) {
      this.setStatus('连接服务后即可开始修复。');
      return Promise.resolve();
    }
    const update = async () => {
      try {
        const [player, list] = await Promise.all([this.online.ensurePlayer(), this.online.catalog()]);
        this.playerKey = this.online.deviceKey + ':' + player.id;
        this.modePositions = this.platform.read(this.campaignPositionsKey()) || {};
        await this.flushScores();
        const progress = await this.online.request('/me/campaign');
        this.completed = new Set(progress.completed);
        this.remoteLevels = list;
        this.catalogUpdatedAt = Date.now();
        this.setStatus(list.length ? '' : '馆藏关卡正在准备中，欢迎稍后再来。');
      } catch (_) { this.setStatus('暂时无法连接，点选模式可重试。'); }
    };
    this.connecting = update().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  modeLevels(mode) { return this.remoteLevels.filter(level => level.category === mode); }

  modeEntry(mode) {
    const levels = this.modeLevels(mode);
    const lastOpened = levels.find(level => level.id === this.modePositions?.[mode]);
    if (lastOpened) return lastOpened;
    const next = levels.findIndex(level => !this.completed.has(level.id));
    return next < 0 ? levels.at(-1) : levels[Math.max(0, next - 1)];
  }

  campaignKey(level) { return 'jinyao-board:' + this.playerKey + ':' + level.id + ':' + level.atlas_version; }

  campaignPositionsKey() { return 'jinyao-mode-position:' + this.playerKey; }

  completedBoard(level, elapsed = 0) {
    return {
      groups: [{
        ids: Array.from({ length: level.realCount }, (_, id) => id),
        x: (WIDTH - 400 * SCALE) / 2,
        y: (HEIGHT - 450 * SCALE) / 2,
        turn: 0,
      }],
      elapsed,
    };
  }

  async prefetch(entry, retry = false) {
    const level = await this.online.detail(entry);
    if (retry && this.imageFailed(level)) this.textures.delete(level.image);
    this.imageFor(level);
    return level;
  }

  get nextLevel() { return this.campaignLevels?.[this.campaignIndex + 1]; }

  async playCampaign(mode, entry, reset = false) {
    if (!this.online || this.loadingLevel) return;
    if (this.screen === 'campaign') this.pauseClock();
    this.loadingLevel = true;
    this.setStatus(this.screen === 'home' ? '正在取出瓷器…' : '');
    const oldPuzzle = this.puzzle;
    try {
      if (!entry && (!this.catalogUpdatedAt || Date.now() - this.catalogUpdatedAt > 60000)) await this.connect();
      if (!this.playerKey) throw new Error('暂时无法连接，请重试。');
      const levels = oldPuzzle ? this.campaignLevels : this.modeLevels(mode);
      const selected = entry || this.modeEntry(mode);
      if (!selected) throw new Error('这个模式暂未开放关卡。');
      if (oldPuzzle?.phase === 'stored' && oldPuzzle.level.id !== selected.id) {
        await this.flushScores();
        if (!this.completed.has(oldPuzzle.level.id)) throw new Error('成绩尚未同步，请重试后继续。');
      }
      let detail = await this.prefetch(selected, true);
      let saved = reset ? null : this.platform.read(this.campaignKey(detail));
      let restored = saved ? new Puzzle(detail, saved) : null;
      let attemptId = saved?.attemptId;
      let timeKnown = saved?.timeKnown !== false;
      if (!reset && this.completed.has(detail.id) && restored?.phase !== 'stored' && !saved?.replay) {
        restored = new Puzzle(detail, this.completedBoard(detail));
        attemptId = null;
        timeKnown = false;
      }
      if (restored?.phase !== 'stored') {
        const attempt = await this.online.startLevel(selected.id);
        if (detail.atlas_version !== attempt.atlas_version) {
          detail = await this.prefetch({ ...selected, atlas_version: attempt.atlas_version }, true);
          if (detail.atlas_version !== attempt.atlas_version) {
            this.catalogUpdatedAt = 0;
            throw new Error('关卡正在更新，请稍后重试。');
          }
          saved = reset ? null : this.platform.read(this.campaignKey(detail));
          restored = null;
        }
        attemptId = attempt.id;
        if (!restored || saved?.attemptId !== attemptId) {
          restored = new Puzzle(detail, saved?.attemptId === attemptId ? saved : null);
        }
        timeKnown = true;
      }
      if (this.puzzle !== oldPuzzle || (!oldPuzzle && this.modal)) return;
      this.puzzle = restored;
      this.attempt = attemptId;
      this.campaignReplay = Boolean(reset || saved?.replay);
      this.campaignTimeKnown = timeKnown;
      this.campaignLevels = levels;
      this.campaignIndex = levels.findIndex(level => level.id === selected.id);
      this.screen = 'campaign';
      this.modal = null;
      this.scoreNotice = '';
      this.modePositions[mode] = detail.id;
      this.platform.write(this.campaignPositionsKey(), this.modePositions);
      this.defaultMessage();
      this.prepareBoard();
      this.save();
      if (this.puzzle.phase === 'stored' && this.attempt && !this.completed.has(detail.id)) this.queueScore();
      if (this.nextLevel) this.prefetch(this.nextLevel).catch(() => {});
    } catch (error) {
      const message = error.message || '关卡暂时无法打开，请稍后重试。';
      if (this.screen === 'home') this.homeNotice = message;
      else if (oldPuzzle === this.puzzle) {
        this.scoreNotice = message;
        this.say(message, true);
        if (oldPuzzle.phase === 'fit') this.resumeClock();
      }
    } finally {
      this.loadingLevel = false;
      this.renderSoon();
    }
  }

  async loadRanking(month) {
    const ranking = this.ranking;
    if (ranking.loading) return;
    ranking.loading = true;
    ranking.notice = '';
    this.modal = 'ranking';
    this.renderSoon();
    try {
      if (!this.online) throw new Error('offline');
      Object.assign(ranking, await this.online.ranking(month), { page: 0 });
    } catch (_) { ranking.notice = '月榜暂时无法读取，点此重试。'; }
    finally { ranking.loading = false; this.renderSoon(); }
  }

  priorRankingMonth() {
    const [year, month] = (this.ranking.current_month || '').split('-').map(Number);
    return year ? new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7) : undefined;
  }

  setStatus(text) {
    this.homeNotice = text;
    this.renderSoon();
  }

  defaultMessage() {
    const phase = this.puzzle.phase;
    this.say(phase === 'fit' ? '拖动碎片，让相邻裂边贴合。'
      : !this.hasElapsedRecord ? '已修复 · 通关记录已保存'
      : '修复完成 · 用时 ' + formatTime(this.puzzle.state.elapsed));
  }

  get hasElapsedRecord() { return this.screen !== 'campaign' || this.campaignTimeKnown !== false; }

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
    if (!this.opening || !this.visible || !this.imageFor(this.puzzle.level)) return false;
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
      if (this.textures.size > 16) {
        const protectedPaths = new Set([path, this.puzzle?.level.image, 'assets/home-shanshui.jpg']);
        this.textures.delete([...this.textures.keys()].find(key => !protectedPaths.has(key)));
      }
      this.platform.loadImage(path, image => {
        texture.image = image;
        if (this.puzzle?.level.image === path) this.resumeClock();
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
      this.daily.state = { ...this.puzzle.state, elapsed: this.elapsed() };
      this.platform.write(DAILY_KEY, { current: this.daily, records: this.records });
    } else if (this.screen === 'campaign') {
      this.platform.write(this.campaignKey(this.puzzle.level),
        { ...this.puzzle.state, elapsed: this.elapsed(), attemptId: this.attempt,
          replay: this.campaignReplay, timeKnown: this.campaignTimeKnown });
    }
  }

  elapsed() {
    return this.puzzle.state.elapsed + (this.clockSince === null ? 0 : Math.max(0, Date.now() - this.clockSince));
  }

  pauseClock() {
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    this.clockTimer = null;
    if (this.clockSince === null) return;
    this.puzzle.state.elapsed = this.elapsed();
    this.clockSince = null;
  }

  resumeClock() {
    if (!this.visible || this.opening || !this.puzzle || this.puzzle.phase === 'stored' ||
        this.clockSince !== null || !this.textures.get(this.puzzle.level.image)?.image) return;
    this.clockSince = Date.now();
    this.scheduleClock();
  }

  scheduleClock() {
    this.clockTimer = setTimeout(() => {
      this.clockTimer = null;
      if (this.clockSince !== null) {
        this.renderSoon();
        this.scheduleClock();
      }
    }, 1000);
    if (this.clockTimer && typeof this.clockTimer.unref === 'function') this.clockTimer.unref();
  }

  async startDaily() {
    if (!this.online) { this.setStatus('请联网开启每日一瓷。'); return; }
    if (this.loadingLevel) return;
    this.loadingLevel = true;
    this.setStatus('正在开启今日挑战…');
    try {
      await this.online.ensurePlayer();
      const data = await this.online.request('/me/daily/start', { method: 'POST' });
      if (!data.level) { this.setStatus('今日瓷器正在准备中，请稍后再来。'); return; }
      if (this.screen !== 'home' || this.modal) return;
      this.edition = { date: data.date, level: this.online.toLevel(data.level), playerId: this.collection.playerId,
        completed: data.completed, elapsed: data.elapsed_ms, completedAt: data.completed_at };
      this.openDaily();
      this.homeNotice = '';
    } catch (_) { this.homeNotice = '暂时无法连接每日一瓷，请重试。'; }
    finally { this.loadingLevel = false; this.renderSoon(); }
  }

  openDaily(restart) {
    this.pauseClock();
    const { date, level, playerId } = this.edition;
    if (restart || this.daily?.date !== date || this.daily.atlasVersion !== level.atlas_version ||
        this.daily.playerId !== playerId) this.daily = { date, atlasVersion: level.atlas_version, playerId, replay: Boolean(restart) };
    this.puzzle = new Puzzle(level, this.daily.state, dailyRandom(Date.parse(date) / 86400000));
    if (!this.daily.replay && this.edition.completed && this.puzzle.phase !== 'stored') {
      this.puzzle = new Puzzle(level, this.completedBoard(level, this.edition.elapsed));
    }
    this.screen = 'daily';
    this.modal = null;
    this.shareNotice = '';
    if (this.puzzle.phase === 'stored') {
      this.recordDaily(this.edition.completedAt);
      if (!this.edition.completed) this.syncDaily();
    }
    this.defaultMessage();
    this.prepareBoard();
    this.save();
  }

  async syncDaily() {
    const puzzle = this.puzzle;
    this.shareNotice = '正在同步今日藏品…';
    const synced = await this.collection.submitDaily({
      date: this.daily.date, group: puzzle.state.groups[0], elapsed_ms: Math.floor(puzzle.state.elapsed),
    }, this.daily.playerId);
    if (puzzle === this.puzzle) {
      this.shareNotice = synced ? '已收入藏品阁，今日兑换额已记录' : '已存本机，可打开藏品阁重试同步';
      this.renderSoon();
    }
  }

  recordDaily(completedAt) {
    const elapsed = this.puzzle.state.elapsed;
    const previous = this.records.find(record => record.date === this.daily.date);
    if (!previous || elapsed < previous.ms) {
      this.records = this.records.filter(record => record.date !== this.daily.date);
      const { name, image, poster } = this.puzzle.level;
      this.records.push({ date: this.daily.date, name, image, poster, ms: elapsed,
        completed_at: previous?.completed_at || completedAt });
    } else if (!previous.completed_at && completedAt) {
      previous.completed_at = completedAt;
    }
  }

  async openCollection() {
    this.collectionReturn = this.modal === 'win' ? 'win' : null;
    this.modal = 'collection';
    this.collection.tab = 'items';
    this.collection.page = 0;
    this.collection.form = {};
    this.collection.rewardMonth = null;
    const refresh = this.collection.refresh();
    this.renderSoon();
    await refresh;
    this.renderSoon();
  }

  async editShipping(key) {
    const field = shippingFields.find(item => item[0] === key);
    const c = this.collection;
    if (!field || c.editing || c.submitting) return;
    if (!this.platform.editText) {
      c.notice = '当前设备无法输入地址，请在小游戏客户端填写。';
      this.renderSoon();
      return;
    }
    c.editing = true;
    try {
      const value = await this.platform.editText(field[1], c.form[key] || '', field[3]);
      if (typeof value === 'string') c.form[key] = value.trim();
      c.notice = '';
    } catch (_) { c.notice = '暂时无法打开键盘，请重试。'; }
    finally { c.editing = false; this.renderSoon(); }
  }

  async submitRedemption() {
    const c = this.collection;
    const eligible = c.rewardMonth ? c.awards.some(award => award.month.startsWith(c.rewardMonth)) : c.balance >= c.cost;
    if (!this.platform.shippingAvailable || !c.ready || !eligible || c.editing || c.submitting) return;
    c.submitting = true;
    this.renderSoon();
    const notice = await c.redeem();
    c.submitting = false;
    if (notice) c.notice = notice;
    else {
      c.notice = '兑换申请已提交，可在这里查看发货进度。';
      c.tab = 'claims';
      c.page = 0;
      this.modal = 'collection';
    }
    this.renderSoon();
  }

  share() {
    const daily = this.screen === 'daily';
    const time = daily ? formatTime(this.puzzle.state.elapsed) : '';
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
    if (this.screen === 'daily') this.recordDaily(new Date(Date.now()).toISOString());
    this.save();
    if (this.screen === 'campaign') this.queueScore();
    if (this.screen === 'daily') this.syncDaily();
    this.defaultMessage();
    this.highlightMessage = true;
  }

  queueScore() {
    const key = 'jinyao-pending-scores:' + this.playerKey;
    const pending = this.platform.read(key) || {};
    const puzzle = this.puzzle;
    const attemptId = this.attempt;
    pending[attemptId] = { levelId: puzzle.level.id, group: puzzle.state.groups[0],
      elapsed_ms: Math.max(1, Math.floor(puzzle.state.elapsed)) };
    this.platform.write(key, pending);
    this.scoreNotice = '正在记录月榜成绩…';
    this.flushScores().then(results => {
      if (puzzle !== this.puzzle) return;
      this.scoreNotice = results.get(attemptId) === true ? '成绩已记录到本月榜单' :
        results.get(attemptId) === false ? '本次成绩无法登记，可重开关卡再试' : '成绩已存本机，可联网重试提交';
      this.renderSoon();
    });
  }

  flushScores() {
    if (this.flushingScores) return this.flushingScores;
    const key = 'jinyao-pending-scores:' + this.playerKey;
    const flush = async () => {
      const results = new Map();
      const pending = this.platform.read(key) || {};
      for (const [id, { levelId, ...proof }] of Object.entries(pending)) {
        try {
          await this.online.finishLevel(id, proof);
          this.completed.add(levelId);
          results.set(id, true);
        } catch (error) {
          if (![404, 422].includes(error.status)) continue;
          results.set(id, false);
        }
        const current = this.platform.read(key) || {};
        delete current[id];
        this.platform.write(key, current);
      }
      return results;
    };
    this.flushingScores = flush().finally(() => { this.flushingScores = null; });
    return this.flushingScores;
  }

  action(id) {
    const p = this.puzzle;
    if (id === 'home') {
      this.pauseClock();
      this.save();
      this.screen = 'home';
      this.puzzle = null;
      this.opening = null;
      this.homeNotice = '';
      this.modal = null;
    } else if (id.startsWith('mode-')) {
      this.playCampaign(id.slice(5));
    } else if (id === 'daily') {
      this.startDaily();
    } else if (id === 'collection') {
      this.openCollection();
    } else if (id === 'collection-items' || id === 'collection-claims') {
      this.collection.tab = id.slice(11);
      this.collection.page = 0;
    } else if (id === 'collection-prev' || id === 'collection-next') {
      this.collection.page += id === 'collection-prev' ? -1 : 1;
    } else if (id === 'redeem' || id === 'redeem-award') {
      this.collection.rewardMonth = id === 'redeem-award' ? this.collection.awards[0]?.month.slice(0, 7) : null;
      this.modal = 'redeem';
      this.collection.notice = '';
    } else if (id === 'redeem-back') {
      this.collection.form = {};
      this.collection.rewardMonth = null;
      this.collection.notice = '';
      this.modal = 'collection';
    } else if (id === 'redeem-submit') {
      this.submitRedemption();
    } else if (id.startsWith('shipping-')) {
      this.editShipping(id.slice(9));
    } else if (id === 'settings') {
      this.pauseClock();
      if (this.opening) this.opening.since = null;
      this.modal = 'settings';
      this.save();
    } else if (id === 'toggle-music') this.audio.toggle('music');
    else if (id === 'toggle-effects') this.audio.toggle('effects');
    else if (id === 'ranking' || id === 'rank-current') this.loadRanking();
    else if (id === 'rank-previous') this.loadRanking(this.priorRankingMonth());
    else if (id === 'rank-prev' || id === 'rank-next') this.ranking.page += id === 'rank-prev' ? -1 : 1;
    else if (id === 'share') this.share();
    else if (id === 'reference') this.modal = 'reference';
    else if (id === 'close') {
      const settings = this.modal === 'settings';
      this.modal = this.modal === 'collection' ? this.collectionReturn : null;
      if (settings) this.resumeClock();
    }
    else if (id === 'reset') this.modal = 'reset';
    else if (id === 'rearrange') {
      p.rearrange();
      this.say('桌面已重排', true);
      this.save();
    } else if (id === 'confirm-reset') {
      if (this.screen === 'daily') this.openDaily(true);
      else this.playCampaign(p.level.category, p.level, true);
    }
    else if (id === 'next' && this.nextLevel) this.playCampaign(p.level.category, this.nextLevel);
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
    this.renderSoon();
  }
}

module.exports = { start: platform => new Game(platform) };
