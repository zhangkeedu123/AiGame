'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const config = require('../src/core/view.js');

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const item = path.join(directory, entry.name);
    return entry.isDirectory() ? files(item) : [item];
  });
}

function verifyFiles(output) {
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'game.json'))).deviceOrientation, 'portrait');
  JSON.parse(fs.readFileSync(path.join(output, 'project.config.json')));
  const source = path.join(root, 'src');
  for (const file of files(source)) {
    const copy = path.join(output, path.relative(source, file));
    if (/^(?:vase-\d+\.png|sound-timeout\.wav)$/.test(path.basename(file))) {
      assert.equal(fs.existsSync(copy), false);
    } else {
      assert.ok(fs.readFileSync(file).equals(fs.readFileSync(copy)), '生成目录过期：' + file);
    }
  }
  for (const file of files(output).filter(item => item.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', file]);
  }
  for (const file of ['core/levels.js', 'core/geometry.js', 'platform/reward-config.js']) {
    assert.equal(fs.existsSync(path.join(output, file)), false);
  }
}

function details(id, level_number, category) {
  const shapes = [
    [120, 160, 192, 160, 210, 208, 176, 220, 120, 204],
    [192, 160, 280, 160, 280, 204, 210, 208],
    [120, 204, 176, 220, 210, 208, 280, 204, 279, 280, 120, 280],
    [148, 171, 177, 180, 165, 193, 141, 187],
  ];
  const shards = shapes.map(poly => {
    const xs = poly.filter((_, i) => i % 2 === 0), ys = poly.filter((_, i) => i % 2 === 1);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const [left, top, right, bottom] = box;
    return { poly, box, sprite: [left, top, right - left, bottom - top],
      cx: (left + right) / 2, cy: (top + bottom) / 2 };
  });
  return {
    id, level_number, category, name: '测试瓷器 ' + level_number, atlas_version: 1, cutout: true,
    rotations: 3, rotate_count: 2, decoy_count: 1, snapDistance: 12, points: [],
    poster: [0, 0, 400, 450], outline: [120, 160, 280, 160, 280, 280, 120, 280],
    shards, seams: [
      { ids: [0, 1], poly: [192, 160, 210, 208] },
      { ids: [0, 2], poly: [120, 204, 176, 220, 210, 208] },
      { ids: [1, 2], poly: [210, 208, 280, 204] },
    ],
  };
}

async function checkRuntime(output, source) {
  const { createPlatform } = require(path.join(output, 'platform/mini-game.js'));
  const { start } = require(path.join(output, 'main.js'));
  const { Puzzle, SCALE } = require(path.join(output, 'core/puzzle.js'));
  const queue = [], events = {}, requests = [], images = [], labels = [];
  const storage = new Map(), completed = new Set();
  const catalog = [details('first', 5, 'normal'), details('second', 6, 'normal'), details('hard', 1, 'hard')];
  const nowBefore = Date.now;
  let now = 1789412000000;
  Date.now = () => now;
  const methods = { fillText: value => labels.push(value), createLinearGradient: () => ({ addColorStop() {} }) };
  const ctx = new Proxy(methods, { get: (target, key) => target[key] || (() => {}) });
  const canvas = { getContext: () => ctx, requestAnimationFrame: callback => queue.push(callback) };
  const on = name => callback => { events[name] = callback; };
  const date = '2026-09-15';
  let dailyElapsed = null;
  let dailyCompletedAt = null;
  const api = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }),
    onShow: on('show'), onHide: on('hide'), onWindowResize: on('resize'),
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    createImage: () => ({
      width: 400, height: 450,
      set src(value) { images.push(value); queueMicrotask(() => this.onload()); },
    }),
    request({ url, data, method, success }) {
      const target = new URL(url);
      const p = target.pathname.replace('/api/v1', '');
      requests.push([p, method]);
      let response;
      if (p === '/me/guest') {
        assert.equal(data.source, source);
        response = { id: 'tester', token: 'demo' };
      } else if (p === '/me') response = { id: 'tester' };
      else if (p === '/levels') response = catalog.map(({ id, category, atlas_version, level_number, name }) =>
        ({ id, category, atlas_version, level_number, name }));
      else if (p === '/me/campaign') response = { completed: [...completed] };
      else if (p === '/me/campaign/levels/first/start') response = {
        id: completed.has('first') ? 'first-replay' : 'first-attempt', atlas_version: 1,
      };
      else if (p === '/me/campaign/levels/second/start') response = { id: 'second-attempt', atlas_version: 1 };
      else if (p === '/me/campaign/attempts/first-attempt/complete') {
        assert.deepEqual(data.group.ids.slice().sort(), [0, 1, 2]);
        assert.equal(data.elapsed_ms, 6300);
        completed.add('first');
        response = { elapsed_ms: data.elapsed_ms };
      } else if (p === '/me/daily/start') response = {
        date, level: { ...catalog[0], category: 'daily' }, completed: dailyElapsed !== null, elapsed_ms: dailyElapsed,
        completed_at: dailyCompletedAt,
      };
      else if (p === '/me/daily/complete') {
        dailyElapsed = data.elapsed_ms;
        dailyCompletedAt = new Date(Date.now()).toISOString();
        response = { date, elapsed_ms: dailyElapsed };
      }
      else if (p === '/me/collection') response = {
        cost: 30, balance: 31, claims: [], awards: [{ month: '2026-08-01' }],
        items: [{ date, elapsed_ms: 3200, completed_at: dailyCompletedAt, level_id: 'first', atlas_version: 1 }],
      };
      else if (p === '/me/collection/redemptions') {
        assert.equal(data.reward_month, '2026-08');
        response = { id: 'award', reward_month: '2026-08-01', status: 'pending' };
      } else if (p === '/ranking') response = {
        month: '2026-09', current_month: '2026-09', winner: null,
        items: [{ nickname: '瓷友', rank: 1, category: 'normal', level_number: 6, elapsed_ms: 6300 }],
      };
      else if (p.startsWith('/levels/')) response = catalog.find(level => level.id === p.slice(8));
      assert.ok(response, 'Unexpected request ' + p);
      queueMicrotask(() => success({ statusCode: 200, data: response }));
    },
  };
  const app = start(createPlatform(api, 'https://example.test', 'test', source));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const tick = (ms = 0) => {
    now += ms;
    labels.length = 0;
    for (const callback of queue.splice(0)) callback();
  };

  try {
    await flush();
    tick();
    assert.equal(requests.some(([p]) => p.startsWith('/levels/')), false);
    assert.ok(labels.includes('普通模式'));
    assert.ok(!labels.includes('线上关卡'));
    app.action('settings');
    tick();
    assert.ok(labels.includes('声音设置'));
    app.action('close');

    app.action('mode-normal');
    await flush();
    tick();
    assert.equal(app.puzzle.level.level_number, 5);
    assert.ok(labels.includes('00:00'));
    assert.ok(!app.hits.some(hit => hit.id === 'settings'));
    assert.equal(app.puzzle.state.groups.filter(group => group.turn !== 0).length, 2);
    assert.deepEqual(app.puzzle.state.numbers.slice().sort(), [1, 2, 3, 4]);
    assert.ok(requests.some(([p]) => p === '/levels/second'), '玩当前关时已获取下一关配置');
    assert.ok(images.some(value => value.includes('/levels/second/atlas.png')), '玩当前关时已加载下一关图集');
    assert.ok(!requests.some(([p]) => p.includes('/levels/hard')));
    const puzzle = app.puzzle;
    const decoy = puzzle.state.groups.find(group => group.ids[0] === 3);
    puzzle.select(decoy);
    assert.equal(puzzle.canRotate, false);
    assert.equal(puzzle.turnSelected(), false);
    app.action('rearrange');
    assert.equal(decoy.turn, 0);
    tick(config.OPENING_DURATION + 5);
    now += 6300;
    const board = puzzle.state.groups;
    for (const group of board) Object.assign(group, { x: 10, y: 10, turn: 0 });
    assert.equal(puzzle.finishMove(decoy), false);
    assert.equal(puzzle.finishMove(board.find(group => group !== decoy)), true);
    app.afterJoin();
    await flush();
    tick();
    assert.equal(app.elapsed(), 6300);
    assert.equal(app.puzzle.phase, 'stored');
    assert.ok(labels.includes('下一关'));
    app.action('home');
    app.action('mode-normal');
    await flush();
    assert.equal(app.puzzle.level.level_number, 5);
    assert.equal(app.puzzle.phase, 'stored');
    assert.equal(app.elapsed(), 6300);
    assert.equal(requests.filter(([p]) => p === '/me/campaign/levels/first/start').length, 1);

    const boardKey = app.campaignKey(app.puzzle.level);
    app.action('home');
    storage.delete(boardKey);
    storage.delete(app.campaignPositionsKey());
    await app.connect();
    app.action('mode-normal');
    await flush();
    assert.equal(app.puzzle.phase, 'stored');
    assert.equal(app.hasElapsedRecord, false);
    assert.equal(requests.filter(([p]) => p === '/me/campaign/levels/first/start').length, 1);
    app.action('confirm-reset');
    await flush();
    assert.equal(app.puzzle.phase, 'fit');
    assert.equal(app.attempt, 'first-replay');
    app.action('home');
    app.action('mode-normal');
    await flush();
    assert.equal(app.puzzle.phase, 'fit', '主动重开后可继续重玩');
    app.action('home');
    storage.delete(boardKey);
    app.action('mode-normal');
    await flush();
    assert.equal(app.puzzle.phase, 'stored');
    app.action('next');
    await flush();
    tick();
    assert.equal(app.puzzle.level.level_number, 6);
    assert.equal(requests.filter(([p]) => p === '/levels/second').length, 1, '下一关利用预取缓存');
    assert.equal(images.filter(value => value.includes('/levels/second/atlas.png')).length, 1);
    app.action('home');

    app.action('daily');
    await flush();
    tick();
    assert.equal(app.screen, 'daily');
    assert.equal(app.puzzle.level.category, 'daily');
    tick(config.OPENING_DURATION + 5);
    now += 3200;
    for (const group of app.puzzle.state.groups) Object.assign(group, { x: 10, y: 10, turn: 0 });
    app.puzzle.finishMove(app.puzzle.state.groups.find(group => group.ids[0] < 3));
    app.afterJoin();
    app.save();
    const daily = JSON.parse(storage.get('jinyao-daily-v1'));
    assert.equal(daily.records[0].ms, 3200);
    assert.equal(daily.records[0].completed_at, dailyCompletedAt);
    app.action('home');
    app.daily = null;
    app.records = [];
    app.action('daily');
    await flush();
    assert.equal(app.puzzle.phase, 'stored', '从每日挑战记录恢复整器');
    assert.equal(app.elapsed(), 3200);
    assert.equal(app.records[0].ms, 3200);
    assert.equal(app.records[0].completed_at, dailyCompletedAt);
    assert.equal(requests.filter(([p]) => p === '/me/daily/complete').length, 1);
    app.action('collection');
    await flush();
    tick();
    assert.ok(labels.includes('领取月榜冠军奖'));
    const { formatLocalDateTime } = require(path.join(output, 'core/daily.js'));
    assert.ok(labels.includes(formatLocalDateTime(dailyCompletedAt) + ' · 用时 00:03'));
    app.action('redeem-award');
    app.collection.form = { recipient: '测试', phone: '13800138000', address: '测试省测试街道 10 号' };
    app.action('redeem-submit');
    await flush();
    assert.equal(app.collection.balance, 31, '月榜奖品不扣收藏兑换额度');
    assert.equal(app.collection.awards.length, 0);
    app.action('home');
    app.action('ranking');
    await flush();
    tick();
    assert.ok(labels.includes('闯关月榜'));
    assert.ok(labels.includes('瓷友'));

    const one = new Puzzle(app.online.toLevel(catalog[0]), null, () => 0.5);
    const restored = new Puzzle(one.level, one.state, () => 0.7);
    assert.equal(restored.newBoard, false);
    assert.equal(restored.state.groups.length, 4);
    assert.deepEqual(restored.state.numbers, one.state.numbers);
    const masked = new Puzzle(app.online.toLevel(catalog[0]), null, () => 0.5);
    masked.level.shards[0].contours = [
      [130, 170, 182, 170, 182, 205, 130, 205],
      [145, 180, 145, 190, 155, 190, 155, 180],
    ];
    const shard = { ids: [0], x: 200, y: 30, turn: 1 };
    masked.state.groups = [shard];
    const hit = (x, y) => masked.hit(shard.x - y * SCALE, shard.y + x * SCALE);
    assert.equal(hit(140, 185), shard);
    assert.equal(hit(150, 185), null, '透明孔不可选中');
    assert.equal(hit(124, 176), null, '瓷器外侧透明区域不可选中');
  } finally {
    app.pauseClock();
    Date.now = nowBefore;
  }
}

async function main() {
  for (const source of ['wechat', 'douyin']) {
    const output = path.join(root, 'dist', source);
    verifyFiles(output);
    await checkRuntime(output, source);
    console.log(source + '：后端关卡、旋转与干扰片、正向计时、下一关预取、每日收藏和月榜通过本地检查');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
