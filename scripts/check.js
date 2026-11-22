'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { computeLayout, OPENING_DURATION } = require('../src/core/view.js');
const { Puzzle, areNeighbors, groupBounds, matchNearby, SCALE } = require('../src/core/puzzle.js');
const levels = require('../src/core/levels.js');
const { dailyEdition, dailyRandom } = require('../src/core/daily.js');
const { modes, modeLevel, polygonContains } = require('../src/core/modes.js');

const root = path.resolve(__dirname, '..');
const storeKey = 'jinyao-museum-v2';
const dailyKey = 'jinyao-daily-v1';
const modesKey = 'jinyao-modes-v1';

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

async function mockRuntime(output, platform) {
  const info = {
    width: 390, height: 844, ratio: 3, statusBarHeight: 24, menuBottom: 59,
    safeArea: { top: 24, bottom: 817, left: 0, right: 390 },
  };
  const layout = computeLayout(info);
  const queue = [], events = {};
  const initialTime = 6 * 86400000;
  const edition = dailyEdition(initialTime, levels.length);
  let labels = [], imagesDrawn = 0, imageFallback = 0, fontLoaded = false, share;
  let storedModes = '';
  let adClosed, videoShown = 0;
  const strokes = [], numberOutlines = [];
  const cropWidths = [];
  let arcs = 0;
  let openingFrames = false;
  let stored = JSON.stringify({
    current: 0, wins: [], games: { 0: {
      groups: [
        { ids: [0], x: 45, y: 54, turn: 0 },
        { ids: [1], x: -25, y: 130, turn: 0 },
        { ids: [2], x: 52, y: 209, turn: 0 },
      ], paint: [],
    } },
  });
  let storedDaily = JSON.stringify({
    current: { date: edition.date, elapsed: 4000, book: JSON.parse(stored) },
    records: [],
  });
  const ctx = {};
  for (const name of ['rotate','beginPath','closePath','moveTo',
    'lineTo','quadraticCurveTo','fill','clip','fillRect']) ctx[name] = () => {};
  ctx.arc = () => { arcs++; };
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  ctx.stroke = () => strokes.push(ctx.strokeStyle);
  ctx.strokeText = label => numberOutlines.push(label);
  const transforms = [];
  let transform = { x: 0, y: 0, sx: 1, sy: 1 };
  ctx.save = () => transforms.push({ ...transform });
  ctx.restore = () => { transform = transforms.pop(); };
  ctx.translate = (x, y) => {
    transform.x += x * transform.sx;
    transform.y += y * transform.sy;
  };
  ctx.scale = (x, y) => { transform.sx *= x; transform.sy *= y; };
  ctx.drawImage = (_, sourceX, sourceY, sourceWidth) => {
    imagesDrawn++;
    cropWidths.push(sourceWidth);
  };
  ctx.fillText = (label, x, y) => labels.push({
    label, x: (transform.x + x * transform.sx) / info.ratio, y: (transform.y + y * transform.sy) / info.ratio,
  });
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
    getStorageSync: key => key === storeKey ? stored : key === dailyKey ? storedDaily : key === modesKey ? storedModes : '',
    setStorageSync(key, data) {
      if (key === dailyKey) storedDaily = data;
      else if (key === modesKey) storedModes = data;
      else { assert.equal(key, storeKey); stored = data; }
    },
    shareAppMessage(options) { share = options; },
    createRewardedVideoAd({ adUnitId }) {
      assert.equal(adUnitId, 'test-reward');
      return {
        load: () => Promise.resolve(),
        show() { videoShown++; return Promise.resolve(); },
        onClose(listener) { adClosed = listener; },
        onError() {},
      };
    },
    getFileSystemManager: () => ({
      readFileSync(file, encoding) {
        imageFallback++;
        return fs.readFileSync(path.join(output, file), encoding);
      },
    }),
    createImage() {
      const listeners = {};
      const img = { width: 800, height: 1761 };
      if (platform === 'douyin') img.addEventListener = (name, listener) => { listeners[name] = listener; };
      Object.defineProperty(img, 'src', { set(src) {
        const isData = /^data:image\/(?:png|jpeg);base64,/.test(src);
        if (isData) assert.ok(/^data:image\/(?:png;base64,iVBOR|jpeg;base64,\/9j\/)/.test(src));
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
    for (let i = 0; queue.length && i < (openingFrames ? 8 : 100); i++) queue.shift()();
    assert.ok(queue.length <= (openingFrames ? 1 : 0));
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
  function tapLabel(label) {
    const hit = labels.findLast(item => item.label === label);
    assert.ok(hit, '找不到按钮：' + label);
    labels = [];
    tap([hit.x, hit.y]);
  }
  function state() { return JSON.parse(storedDaily).current.book.games[0]; }
  function group(id) { return state().groups.find(g => g.ids.includes(id)); }
  function center(id, pose = group(id)) {
    const s = levels[0].shards[id];
    return [pose.x + s.cx * SCALE, pose.y + s.cy * SCALE];
  }

  const environment = platform === 'wechat' ? 'wx' : 'tt';
  const realNow = Date.now;
  let now = initialTime;
  Date.now = () => now;
  function openWithAnimation(label, inspect) {
    openingFrames = true;
    cropWidths.length = 0;
    tapLabel(label);
    assert.ok(cropWidths.length && cropWidths.every(width => width === 400));
    assert.equal(queue.length, 1);
    if (inspect) {
      assert.equal(numberOutlines.length, 0);
      cropWidths.length = 0;
      now += 650;
      flush();
      assert.ok(cropWidths.length && cropWidths.every(width => width > 0 && width < 400));
      assert.equal(numberOutlines.length, 0);
      assert.ok(!labels.some(item => item.label === '找邻片'));
    }
    now += OPENING_DURATION;
    openingFrames = false;
    flush();
  }
  global[environment] = api;
  const rewardConfig = require(path.join(output, 'platform', 'reward-config.js'));
  const originalAdId = rewardConfig.adUnitId;
  rewardConfig.adUnitId = 'test-reward';
  try {
    require(path.join(output, 'game.js'));
    flush();
    assert.equal(canvas.width, 1170);
    assert.ok(imagesDrawn > 0);
    assert.ok(fontLoaded && ctx.font.includes('Jinyao UI'));
    assert.equal(imageFallback, platform === 'wechat' ? 0 : 1);
    tapLabel('分享');
    assert.equal(share.title, '金缮夜馆');
    tapLabel('排行榜');
    assert.ok(labels.some(item => item.label === '本机 · 每日一瓷最快五次'));
    tapLabel('挑战每日一瓷');
    assert.ok(imagesDrawn > 0);
    assert.equal(imageFallback, platform === 'wechat' ? 0 : 2);
    const oldCampaign = stored;
    const dailyGroup = { x: -25, y: 130, turn: 0 };
    strokes.length = 0;
    tap(screen(center(0)));
    assert.ok(strokes.includes('#d8f1e5'));
    const base = center(2);
    drag(center(0), base);
    assert.equal(state().groups.length, 3);
    assert.ok(Math.hypot(center(0)[0] - base[0], center(0)[1] - base[1]) < 0.001);
    drag(center(0), center(0, dailyGroup));
    const start = center(0);
    strokes.length = 0;
    emit('start', screen(start));
    assert.ok(strokes.filter(color => color === '#d8f1e5').length >= 4);
    emit('move', screen([start[0] + 42, start[1] + 30]));
    emit('cancel', screen(start));
    assert.deepEqual(group(0).ids, [0, 1]);
    tapLabel('‹ 首页');
    now += 60000;
    tapLabel('每日一瓷');
    assert.deepEqual(JSON.parse(storedDaily).current.book.games[0].groups.at(-1).ids, [0, 1]);
    now += 6000;
    drag(center(2), center(2, dailyGroup));
    assert.equal(stored, oldCampaign);
    assert.deepEqual(JSON.parse(storedDaily).records, [{ date: edition.date, index: 0, ms: 10000 }]);
    tapLabel('分享成绩');
    assert.match(share.title, /00:10/);
    assert.match(share.desc, /00:10/);
    tapLabel('留在桌面');
    tapLabel('‹ 首页');
    tapLabel('排行榜');
    assert.ok(labels.some(item => item.label === '00:10'));
    tapLabel('关闭');
    arcs = 0;
    numberOutlines.length = 0;
    openWithAnimation('普通模式', true);
    const first = () => JSON.parse(storedModes).normal.games[0];
    assert.equal(first().groups.length, 5);
    for (const number of ['1', '2', '3', '4', '5']) assert.ok(labels.some(item => item.label === number));
    assert.deepEqual([...new Set(numberOutlines)].sort(), ['1', '2', '3', '4', '5']);
    assert.equal(arcs, 0);
    strokes.length = 0;
    tapLabel('找邻片');
    assert.ok(strokes.filter(color => color === '#e8c784').length >= 2);
    const original = first();
    tapLabel('重排');
    assert.notDeepEqual(first().groups, original.groups);
    assert.equal(first().remaining, original.remaining);
    events.hide();
    now += 300000;
    events.show();
    flush();
    assert.ok(labels.some(item => item.label === '02:00'));
    now += 120001;
    emit('start', [10, 300]);
    assert.ok(labels.some(item => item.label === '时间到'));
    assert.equal(first().remaining, 0);
    const expiredGroups = first().groups;
    tapLabel('看广告 +60 秒');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(videoShown, 1);
    adClosed({ isEnded: false });
    await new Promise(resolve => setImmediate(resolve));
    flush();
    assert.equal(first().remaining, 0);
    tapLabel('看广告 +60 秒');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(videoShown, 2);
    adClosed({ isEnded: true });
    adClosed({ isEnded: true });
    await new Promise(resolve => setImmediate(resolve));
    flush();
    assert.deepEqual(first().groups, expiredGroups);
    assert.equal(first().remaining, 60000);
    now += 60001;
    emit('start', [10, 300]);
    openWithAnimation('本关重开');
    assert.equal(first().remaining, 120000);
    tapLabel('‹ 首页');
    openWithAnimation('困难模式');
    assert.equal(JSON.parse(storedModes).hard.games[0].groups.length, 20);
    tapLabel('‹ 首页');
    openWithAnimation('极难模式');
    assert.equal(JSON.parse(storedModes).extreme.games[0].groups.length, 34);
  } finally {
    rewardConfig.adUnitId = originalAdId;
    Date.now = realNow;
    delete global[environment];
  }
}

assert.equal(dailyEdition(Date.UTC(2026, 0, 1, 15, 59), levels.length).date, '2026-01-01');
assert.equal(dailyEdition(Date.UTC(2026, 0, 1, 16), levels.length).date, '2026-01-02');
assert.deepEqual(new Puzzle(null, dailyRandom(9), 3).state, new Puzzle(null, dailyRandom(9), 3).state);
const oldAssembled = { groups: [{ ids: [0, 1, 2], x: 45, y: 54, turn: 0 }], paint: [0] };
const migrated = new Puzzle({ current: 0, wins: [], games: { 0: oldAssembled } });
assert.equal(migrated.phase, 'stored');
assert.equal(migrated.unlocked(1), true);
assert.deepEqual(migrated.state.groups, oldAssembled.groups);
assert.equal('paint' in migrated.state, false);
const rotating = new Puzzle(null, dailyRandom(4), 2);
const target = { ids: rotating.level.shards.slice(1).map((_, id) => id + 1), x: 30, y: 80, turn: 0 };
const last = { ids: [0], turn: 3 };
const oldBounds = groupBounds(rotating.level, last);
const newBounds = groupBounds(rotating.level, { ...last, turn: 0 });
last.x = target.x + (newBounds[0] + newBounds[2] - oldBounds[0] - oldBounds[2]) / 2;
last.y = target.y + (newBounds[1] + newBounds[3] - oldBounds[1] - oldBounds[3]) / 2;
rotating.state.groups = [last, target];
rotating.select(last);
assert.equal(rotating.turnSelected(), true);
assert.equal(rotating.phase, 'stored');
assert.deepEqual(rotating.book.wins, [2]);
assert.deepEqual(Array.from({ length: 10 }, (_, i) => modeLevel('normal', i).realCount),
  [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
assert.equal(modes.hard.limit, 20);
assert.equal(modeLevel('hard', 0).realCount, 20);
for (const [name, mode] of Object.entries(modes)) {
  for (let i = 0; i < Math.min(mode.limit, 120); i++) {
    const level = modeLevel(name, i), reached = new Set([0]);
    assert.ok(level.shards.every(shard => polygonContains(shard.poly, shard.cx, shard.cy)));
    let previous;
    do {
      previous = reached.size;
      for (const { ids: [a, b] } of level.seams) {
        assert.ok(a < level.realCount && b < level.realCount);
        if (reached.has(a) || reached.has(b)) { reached.add(a); reached.add(b); }
      }
    } while (reached.size > previous);
    assert.equal(reached.size, level.realCount);
  }
}
const extreme = new Puzzle(null, dailyRandom(4), undefined, 'extreme');
const decoy = extreme.state.groups.find(group => group.ids[0] >= extreme.level.realCount);
const staged = extreme.state.groups.map(group => Object.assign(group, { x: 40, y: 80, turn: 0 }));
extreme.rearrange();
assert.equal(extreme.state.groups.length, 34);
for (const group of staged) Object.assign(group, { x: 40, y: 80, turn: 0 });
assert.equal(extreme.finishMove(decoy), false);
assert.equal(extreme.finishMove(staged.find(group => group !== decoy && group.ids[0] < extreme.level.realCount)), true);
assert.equal(extreme.phase, 'stored');
assert.equal(extreme.state.groups[0].ids.length, extreme.level.realCount);
assert.equal(new Puzzle(extreme.book, null, undefined, 'extreme').phase, 'stored');
assert.equal(modeLevel('extreme', 10000).realCount, 64);
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
async function checkPlatforms() {
  for (const platform of ['wechat', 'douyin']) {
    const output = path.join(root, 'dist', platform);
    verifyFiles(output);
    await mockRuntime(output, platform);
    console.log(platform + '：三种模式、倒计时、重排、重开、广告续时与每日挑战通过本地检查');
  }
}

checkPlatforms().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
