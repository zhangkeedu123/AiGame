'use strict';

const levels = require('./core/levels.js');
const { Puzzle, groupBounds } = require('./core/puzzle.js');
const { contains, computeLayout, draw } = require('./core/view.js');

const SAVE_KEY = 'jinyao-museum-v2';

class Game {
  constructor(platform) {
    this.platform = platform;
    this.canvas = platform.canvas;
    this.fontFamily = platform.fontFamily || '';
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) throw new Error('金缮夜馆需要 Canvas 2D');
    this.levels = levels;
    this.puzzle = new Puzzle(platform.read(SAVE_KEY));
    this.textures = new Map();
    this.hits = [];
    this.active = null;
    this.modal = null;
    this.pendingFrame = false;
    this.defaultMessage();
    this.resize();
    platform.onInput((kind, touch) => this.input(kind, touch));
    platform.onResize(() => this.resize());
    platform.onShow(() => this.resize());
    platform.onHide(() => {
      this.cancel();
      this.save();
    });
  }

  defaultMessage() {
    const phase = this.puzzle.phase;
    this.say(phase === 'fit' ? '拖动碎片，让相邻裂边贴合。'
      : phase === 'gold' ? '点亮瓶身的三处金点。' : '已收入藏品柜。');
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
      this.ctx.save();
      try {
        this.ctx.scale(this.pixelX, this.pixelY);
        this.hits = draw(this.ctx, this.layout, this);
      } finally { this.ctx.restore(); }
    });
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
    this.platform.write(SAVE_KEY, this.puzzle.book);
  }

  world(touch) {
    const { field, scale } = this.layout;
    return { x: (touch.x - field.x) / scale, y: (touch.y - field.y) / scale };
  }

  buttonAt(touch) {
    const item = this.hits.find(hit => contains(hit.rect, touch.x, touch.y));
    return item ? item.id : null;
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
    const button = this.buttonAt(touch);
    const active = { id: touch.id, first: touch, last: touch, button, group: null, moved: false };
    this.active = active;
    if (button || this.modal || !contains(this.layout.field, touch.x, touch.y)) return;
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
    this.move(touch);
    this.active = null;
    if (active.group) {
      if (active.moved) {
        if (this.puzzle.finishMove(active.group)) this.joinMessage();
        else this.defaultMessage();
      }
      this.save();
    } else if (!active.moved && active.button && active.button === this.buttonAt(touch)) {
      this.action(active.button);
    } else if (!active.moved && !this.modal && this.puzzle.phase === 'gold' &&
               this.imageFor(this.puzzle.level) && contains(this.layout.field, touch.x, touch.y)) {
      const point = this.world(touch);
      if (this.puzzle.paintAt(point.x, point.y)) {
        if (this.puzzle.phase === 'stored') {
          this.modal = 'win';
          this.say('金线已点亮，这件瓷瓶已入藏。', true);
        } else {
          this.say('金线已点亮 ' + this.puzzle.state.paint.length + ' / ' + this.puzzle.level.points.length + '。', true);
        }
        this.save();
      }
    }
    this.renderSoon();
  }

  cancel() {
    if (!this.active) return;
    const { group, origin, bounds } = this.active;
    this.active = null;
    if (group) {
      this.puzzle.dragTo(group, origin[0], origin[1], bounds);
      this.renderSoon();
    }
  }

  joinMessage() {
    this.say(this.puzzle.phase === 'gold' ? '瓷瓶已拼合。点亮三处金点。'
      : '裂边已贴合，可以拖动这一整组。', true);
  }

  load(index, restart) {
    this.puzzle.load(index, restart);
    this.modal = null;
    this.defaultMessage();
    this.save();
  }

  action(id) {
    const p = this.puzzle;
    if (id === 'reference') this.modal = 'reference';
    else if (id === 'cabinet') this.modal = 'cabinet';
    else if (id === 'close') this.modal = null;
    else if (id === 'reset') this.modal = 'reset';
    else if (id === 'confirm-reset') this.load(p.index, true);
    else if (id === 'next') {
      if (p.index + 1 === this.levels.length) this.modal = 'cabinet';
      else this.load(p.index + 1);
    } else if (id === 'hint') {
      const near = p.findNeighbors();
      if (!near) return;
      this.say(near.a.turn === near.b.turn ? '高亮的两组接得上，试着贴合裂边。'
        : '高亮的是两组邻片，先把方向转一致。', true);
    } else if (id === 'rotate') {
      if (p.turnSelected()) this.joinMessage();
      else this.say('已顺时针旋转 90°。');
      this.save();
    } else if (id === 'retry') this.textures.delete(p.level.image);
    else if (id.startsWith('level-')) this.load(Number(id.slice(6)));
    this.renderSoon();
  }
}

module.exports = { start: platform => new Game(platform) };
