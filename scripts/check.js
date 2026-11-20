'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { computeLayout } = require('../src/core/view.js');
const { Puzzle, areNeighbors, matchNearby, SCALE } = require('../src/core/puzzle.js');
const levels = require('../src/core/levels.js');

const root = path.resolve(__dirname, '..');
const storeKey = 'jinyao-museum-v2';

function fileNames(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? fileNames(file) : [file];
  });
}

function verifyFiles(output) {
  const game = JSON.parse(fs.readFileSync(path.join(output, 'game.json')));
  assert.equal(game.deviceOrientation, 'portrait');
  JSON.parse(fs.readFileSync(path.join(output, 'project.config.json')));
  for (const file of fileNames(path.join(root, 'src'))) {
    const copy = path.join(output, path.relative(path.join(root, 'src'), file));
    assert.ok(fs.readFileSync(file).equals(fs.readFileSync(copy)), '生成目录过期，请先运行构建');
  }
  for (const file of fileNames(output).filter(file => file.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', file]);
  }
  for (const level of levels) {
    const png = fs.readFileSync(path.join(output, level.image));
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    for (const [x, y, sw, sh] of [level.poster, ...level.shards.map(s => s.sprite)]) {
      assert.ok(x >= 0 && y >= 0 && sw > 0 && sh > 0 && x + sw <= w && y + sh <= h);
    }
  }
}

function mockRuntime(output, platform) {
  const info = {
    width: 390, height: 844, ratio: 3, statusBarHeight: 24, menuBottom: 59,
    safeArea: { top: 24, bottom: 817, left: 0, right: 390 },
  };
  const layout = computeLayout(info);
  const queue = [], events = {};
  let labels = [], imagesDrawn = 0, imageFallback = 0, fontLoaded = false;
  let stored = JSON.stringify({
    current: 0, wins: [], games: { 0: {
      groups: [
        { ids: [0], x: 45, y: 54, turn: 0 },
        { ids: [1], x: -25, y: 130, turn: 0 },
        { ids: [2], x: 52, y: 209, turn: 0 },
      ], paint: [],
    } },
  });
  const ctx = {};
  for (const name of ['save','restore','scale','translate','rotate','beginPath','closePath','moveTo',
    'lineTo','quadraticCurveTo','fill','stroke','clip','fillRect','arc']) ctx[name] = () => {};
  ctx.drawImage = () => { imagesDrawn++; };
  ctx.fillText = (label, x, y) => labels.push({ label, x, y });
  const canvas = { getContext: kind => kind === '2d' ? ctx : null, width: 0, height: 0 };
  canvas.requestAnimationFrame = callback => queue.push(callback);
  const systemInfo = () => ({
    windowWidth: info.width, windowHeight: info.height, pixelRatio: info.ratio,
    statusBarHeight: info.statusBarHeight, safeArea: info.safeArea,
  });
  const on = name => callback => { events[name] = callback; };
  const api = {
    createCanvas: () => canvas,
    loadFont(file) { fontLoaded = fs.existsSync(path.join(output, file)); return fontLoaded ? 'Jinyao UI' : ''; },
    onTouchStart: on('start'), onTouchMove: on('move'), onTouchEnd: on('end'), onTouchCancel: on('cancel'),
    onShow: on('show'), onHide: on('hide'), onWindowResize: on('resize'),
    getStorageSync: key => key === storeKey ? stored : '',
    setStorageSync: (key, data) => { assert.equal(key, storeKey); stored = data; },
    getFileSystemManager: () => ({
      readFileSync(file, encoding) {
        imageFallback++;
        return fs.readFileSync(path.join(output, file), encoding);
      },
    }),
    createImage() {
      const listeners = {};
      const img = {};
      if (platform === 'douyin') img.addEventListener = (name, listener) => { listeners[name] = listener; };
      Object.defineProperty(img, 'src', { set(src) {
        const isData = src.startsWith('data:image/png;base64,');
        const exists = isData || fs.existsSync(path.join(output, src));
        const event = exists && (platform === 'wechat' || isData) ? 'load' : 'error';
        queue.push(() => (listeners[event] || img['on' + event])());
      } });
      return img;
    },
  };
  if (platform === 'wechat') {
    api.getWindowInfo = systemInfo;
    api.getMenuButtonBoundingClientRect = () => ({ bottom: info.menuBottom });
  } else {
    api.getSystemInfoSync = systemInfo;
    api.getMenuButtonLayout = () => ({ top: 27, height: info.menuBottom - 27 });
  }
  function flush() {
    for (let i = 0; queue.length && i < 100; i++) queue.shift()();
    assert.equal(queue.length, 0);
  }
  function screen(world) {
    return [layout.field.x + world[0] * layout.scale, layout.field.y + world[1] * layout.scale];
  }
  function emit(stage, pos, identifier = 77) {
    const fields = platform === 'wechat' ? { clientX: pos[0], clientY: pos[1] } : { screenX: pos[0], screenY: pos[1] };
    events[stage]({ changedTouches: [Object.assign({ identifier }, fields)] });
    flush();
  }
  function drag(a, b) {
    emit('start', screen(a));
    emit('move', screen(b), 88);
    emit('move', screen(b));
    emit('end', screen(b));
  }
  function tap(screenPoint) {
    emit('start', screenPoint);
    emit('end', screenPoint);
  }
  function state() { return JSON.parse(stored).games[0]; }
  function group(id) { return state().groups.find(g => g.ids.includes(id)); }
  function center(id, pose = group(id)) {
    const s = levels[0].shards[id];
    return [pose.x + s.cx * SCALE, pose.y + s.cy * SCALE];
  }

  const environment = platform === 'wechat' ? 'wx' : 'tt';
  global[environment] = api;
  try {
    require(path.join(output, 'game.js'));
    flush();
    assert.equal(canvas.width, 1170);
    assert.ok(imagesDrawn > 0);
    assert.ok(fontLoaded && ctx.font.includes('Jinyao UI'));
    assert.equal(imageFallback, platform === 'wechat' ? 0 : 1);

    // Two non-neighboring pieces can occupy the same spot and remain separate.
    const base = center(2);
    drag(center(0), base);
    assert.equal(state().groups.length, 3);
    assert.equal(state().groups.at(-1).ids[0], 0);
    assert.ok(Math.hypot(center(0)[0] - base[0], center(0)[1] - base[1]) < 0.001);

    // Adjacent fractures join, then the combined piece moves as one object.
    drag(center(0), center(0, group(1)));
    assert.deepEqual(group(0).ids, [0, 1]);
    const start = center(0);
    drag(start, [start[0] + 42, start[1] + 30]);
    assert.equal(group(0).x, group(1).x);
    assert.ok(Math.abs(group(0).x - 17) < 0.001);

    emit('start', screen(center(0)));
    emit('move', screen([start[0] + 65, start[1] + 60]));
    emit('cancel', screen(center(0)));
    events.hide();
    flush();
    assert.ok(Math.abs(group(0).x - 17) < 0.001);

    drag(center(2), center(2, group(0)));
    assert.equal(state().groups.length, 1);
    const full = group(0);
    for (const [x, y] of levels[0].points) tap(screen([full.x + x * SCALE, full.y + y * SCALE]));
    assert.deepEqual(JSON.parse(stored).wins, [0]);
    assert.equal(state().paint.length, 3);
    labels = [];
    events.show();
    flush();
    const next = labels.findLast(item => item.label === '下一关');
    assert.ok(next);
    tap([next.x, next.y]);
    assert.equal(JSON.parse(stored).current, 1);
    const restored = new Puzzle(JSON.parse(stored));
    assert.equal(restored.index, 1);
    assert.equal(restored.state.groups.length, 5);
  } finally { delete global[environment]; }
}

assert.deepEqual(levels.map(level => level.shards.length), [3, 5, 7, 9, 12, 16]);
for (const level of levels) {
  const isolated = level.shards.map((_, id) => id);
  const group = { ids: [isolated.shift()], x: 71, y: 123, turn: 2 };
  while (isolated.length) {
    const adjacent = isolated.findIndex(id => areNeighbors(level, group, { ids: [id] }));
    assert.ok(adjacent >= 0);
    const other = { ids: [isolated.splice(adjacent, 1)[0]], x: 74, y: 121, turn: 0 };
    const groups = [group, other];
    assert.equal(matchNearby(level, groups, group), false);
    other.turn = 2;
    assert.equal(matchNearby(level, groups, group), true);
    assert.equal(groups.length, 1);
  }
}
for (const platform of ['wechat', 'douyin']) {
  const output = path.join(root, 'dist', platform);
  verifyFiles(output);
  mockRuntime(output, platform);
  console.log(platform + '：入口、竖屏配置、贴图、拖动叠放、吸附、描金、解锁及存档通过本地检查');
}
