'use strict';

const { WIDTH, HEIGHT, SCALE } = require('./puzzle.js');
const { formatTime } = require('./daily.js');

let fontFamily = '';
const COLORS = {
  base: '#152b29', edge: '#486458', panel: '#203a34', ink: '#f9eee0',
  note: '#c4d3c6', gold: '#f1cb86', dark: '#302b1f', cloth: '#a5b49f',
};
const HINT_OUTLINE = [['rgba(42,52,41,0.58)', 3.4], ['#e8c784', 1.9]];
const SELECTION_OUTLINE = [['rgba(38,74,62,0.52)', 2.6], ['#d8f1e5', 1.35]];

function box(x, y, w, h) { return { x, y, w, h }; }
function contains(r, x, y) {
  return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
}

function computeLayout(info) {
  const { width, height } = info;
  const safe = info.safeArea || {};
  const top = Math.max(8, safe.top || 0, info.statusBarHeight || 0,
    info.menuBottom > 0 && info.menuBottom < height * 0.25 ? info.menuBottom + 4 : 0);
  const availableBottom = Number.isFinite(safe.bottom) ? Math.min(height, safe.bottom) : height;
  const bottom = Math.max(8, height - availableBottom + 8);
  const side = Math.max(0, safe.left || 0, Number.isFinite(safe.right) ? width - safe.right : 0);
  const w = Math.min(500, width - 2 * side - 22);
  const x = (width - w) / 2;
  const compact = height - top - bottom < 550;
  const levelY = top + (compact ? 39 : 57);
  const footerY = height - bottom - 43;
  const boardY = levelY + (compact ? 39 : 51);
  const desk = box(x, boardY, w, Math.max(55, footerY - boardY - 34));
  const scale = Math.min((desk.w - 4) / WIDTH, (desk.h - 4) / HEIGHT);
  const field = box(desk.x + (desk.w - WIDTH * scale) / 2, desk.y + (desk.h - HEIGHT * scale) / 2,
    WIDTH * scale, HEIGHT * scale);
  return { x, w, top, bottom, levelY, desk, field, scale, footerY, compact, width, height };
}

function rounded(ctx, r, radius, fill, stroke) {
  const { x, y, w, h } = r;
  const rad = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function text(ctx, value, x, y, options) {
  const opt = options || {};
  ctx.fillStyle = opt.color || COLORS.ink;
  const system = opt.serif ? 'serif' : 'sans-serif';
  const family = fontFamily ? '"' + fontFamily + '", ' + system : system;
  ctx.font = (opt.bold ? 'bold ' : '') + (opt.size || 14) + 'px ' + family;
  ctx.textAlign = opt.align || 'left';
  ctx.textBaseline = 'middle';
  if (opt.outline) {
    ctx.strokeStyle = opt.outline;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(value, x, y);
  }
  if (opt.width) ctx.fillText(value, x, y, opt.width);
  else ctx.fillText(value, x, y);
}

function button(ctx, hits, id, label, rect, options) {
  const opt = options || {};
  rounded(ctx, rect, 9, opt.primary ? COLORS.gold : opt.disabled ? '#1e3430' : '#29483e',
    opt.primary ? COLORS.gold : COLORS.edge);
  text(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2, {
    align: 'center', size: opt.size || 14, bold: true, width: rect.w - 9,
    color: opt.primary ? COLORS.dark : opt.disabled ? '#94a59a' : COLORS.ink,
  });
  if (!opt.disabled) hits.push({ id, rect });
}

function atlasDraw(ctx, image, sprite, rect) {
  ctx.drawImage(image, sprite[0], sprite[1], sprite[2], sprite[3], rect.x, rect.y, rect.w, rect.h);
}

function tracePolygon(ctx, outline) {
  ctx.beginPath();
  ctx.moveTo(outline[0], outline[1]);
  for (let i = 2; i < outline.length; i += 2) ctx.lineTo(outline[i], outline[i + 1]);
  ctx.closePath();
}

function seams(ctx, level, group, repaired) {
  if (group.ids.length < 2) return;
  ctx.save();
  tracePolygon(ctx, level.outline);
  ctx.clip();
  for (const seam of level.seams) {
    if (!seam.ids.every(id => group.ids.includes(id))) continue;
    ctx.beginPath();
    ctx.moveTo(seam.poly[0], seam.poly[1]);
    for (let i = 2; i < seam.poly.length; i += 2) ctx.lineTo(seam.poly[i], seam.poly[i + 1]);
    ctx.strokeStyle = repaired ? '#ffe3a1' : '#ad793e';
    ctx.lineWidth = repaired ? 3 : 1.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

function shardNumbers(ctx, level, group) {
  for (const id of group.ids) {
    const { cx, cy, box } = level.shards[id];
    const size = level.procedural ? Math.max(12, Math.min(22, (box[2] - box[0]) * 0.42, (box[3] - box[1]) * 0.42)) : 22;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-group.turn * Math.PI / 2);
    text(ctx, String(id + 1), 0, 0, { align: 'center', size, bold: true, color: '#fffdf4', outline: '#253c33' });
    ctx.restore();
  }
}

function drawShard(ctx, level, id, image, decoyImage) {
  const shard = level.shards[id];
  const [left, top, right, bottom] = shard.box;
  const rect = box(left, top, right - left, bottom - top);
  if (!level.procedural) {
    atlasDraw(ctx, image, shard.sprite, rect);
    return;
  }
  const decoy = id >= level.realCount;
  const source = decoy ? level.decoyArt : level;
  const texture = decoy ? decoyImage : image;
  ctx.save();
  tracePolygon(ctx, shard.poly);
  ctx.clip();
  if (texture) {
    atlasDraw(ctx, texture, [source.poster[0] + left, source.poster[1] + top, rect.w, rect.h], rect);
  } else {
    ctx.fillStyle = '#b4afa0';
    ctx.fillRect(left, top, rect.w, rect.h);
  }
  ctx.restore();
}

function groupOutline(ctx, level, group, displayScale, strokes) {
  ctx.save();
  ctx.translate(group.x, group.y);
  ctx.rotate(group.turn * Math.PI / 2);
  ctx.scale(SCALE, SCALE);
  ctx.lineJoin = 'round';
  for (const [color, width] of strokes) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width / displayScale;
    for (const id of group.ids) {
      const poly = level.shards[id].poly;
      if (level.procedural) {
        tracePolygon(ctx, poly);
        ctx.stroke();
        continue;
      }
      // Authored cut polygons extend past the ceramic silhouette.
      ctx.save();
      tracePolygon(ctx, level.outline);
      ctx.clip();
      tracePolygon(ctx, poly);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      tracePolygon(ctx, poly);
      ctx.clip();
      tracePolygon(ctx, level.outline);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

function deskDraw(ctx, layout, puzzle, image, decoyImage) {
  rounded(ctx, layout.desk, 14, COLORS.cloth, '#b8c4af');
  const desk = layout.desk;
  rounded(ctx, box(desk.x + 5, desk.y + 5, desk.w - 10, desk.h - 10), 10, null, '#c9d2bd');
  if (!image) return;
  ctx.save();
  rounded(ctx, desk, 14);
  ctx.clip();
  ctx.translate(layout.field.x, layout.field.y);
  ctx.scale(layout.scale, layout.scale);
  const intact = puzzle.phase !== 'fit';
  for (const group of puzzle.state.groups) {
    ctx.save();
    ctx.translate(group.x, group.y);
    ctx.rotate(group.turn * Math.PI / 2);
    ctx.scale(SCALE, SCALE);
    if (intact) atlasDraw(ctx, image, puzzle.level.poster, box(0, 0, 400, 450));
    else {
      ctx.shadowColor = group === puzzle.selected ? '#23554e' : '#465b46';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 2;
      for (const id of group.ids) drawShard(ctx, puzzle.level, id, image, decoyImage);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowColor = 'transparent';
    }
    seams(ctx, puzzle.level, group, intact);
    if (!intact) shardNumbers(ctx, puzzle.level, group);
    ctx.restore();
  }
  if (!intact) {
    const displayScale = layout.scale * SCALE;
    for (const group of puzzle.hint) {
      groupOutline(ctx, puzzle.level, group, displayScale, HINT_OUTLINE);
    }
    if (puzzle.selected) groupOutline(ctx, puzzle.level, puzzle.selected, displayScale, SELECTION_OUTLINE);
  }
  ctx.restore();
}

function toolbar(ctx, layout, app, hits) {
  const puzzle = app.puzzle;
  const actions = [{ id: 'reference', label: '原器' }];
  if (puzzle.phase === 'fit') {
    actions.push({ id: 'hint', label: '找邻片' });
    if (puzzle.level.rotations) actions.push({ id: 'rotate', label: '旋转 90°', disabled: !puzzle.selected });
    actions.push({ id: 'rearrange', label: '重排' });
  }
  if (puzzle.phase === 'stored') actions.push(app.screen === 'daily'
    ? { id: 'share', label: '分享成绩', primary: true }
    : { id: puzzle.index + 1 === puzzle.limit ? 'home' : 'next',
      label: puzzle.index + 1 === puzzle.limit ? '返回首页' : '下一关', primary: true });
  actions.push({ id: 'reset', label: '重开' });
  const gap = 6;
  const w = (layout.w - gap * (actions.length - 1)) / actions.length;
  actions.forEach((action, i) => button(ctx, hits, action.id, action.label,
    box(layout.x + i * (w + gap), layout.footerY, w, 43), action));
}

function poster(ctx, level, image, target, repaired) {
  if (!image) return;
  const scale = Math.min(target.w / 400, target.h / 450);
  ctx.save();
  ctx.translate(target.x + (target.w - 400 * scale) / 2, target.y + (target.h - 450 * scale) / 2);
  ctx.scale(scale, scale);
  atlasDraw(ctx, image, level.poster, box(0, 0, 400, 450));
  if (repaired) {
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    seams(ctx, level, { ids: level.shards.map((_, i) => i) }, true);
  }
  ctx.restore();
}

function homeBackground(ctx, width, height) {
  const glaze = ctx.createLinearGradient(0, 0, width * 0.7, height);
  glaze.addColorStop(0, '#284942');
  glaze.addColorStop(0.52, '#47675b');
  glaze.addColorStop(1, '#819481');
  ctx.fillStyle = glaze;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.scale(width / 390, height / 844);
  ctx.beginPath();
  ctx.arc(311, 106, 53, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(233,211,158,0.31)';
  ctx.lineWidth = 1;
  ctx.stroke();

  for (const [rise, color] of [
    [0, 'rgba(211,221,197,0.17)'],
    [53, 'rgba(39,74,62,0.30)'],
    [104, 'rgba(22,54,47,0.42)'],
  ]) {
    ctx.beginPath();
    ctx.moveTo(0, 649 + rise);
    ctx.quadraticCurveTo(35, 600 + rise, 74, 633 + rise);
    ctx.quadraticCurveTo(127, 691 + rise, 170, 643 + rise);
    ctx.quadraticCurveTo(230, 567 + rise, 285, 655 + rise);
    ctx.quadraticCurveTo(330, 690 + rise, 390, 641 + rise);
    ctx.lineTo(390, 844);
    ctx.lineTo(0, 844);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

function drawHome(ctx, layout, app) {
  const { width, height, top, bottom, w } = layout;
  const hits = [];
  const ink = '#153e36', brass = '#b99b67';
  const scale = Math.min(w / 360, (height - top - bottom) / 594);
  const left = (width - 360 * scale) / 2;
  const originY = top + (height - top - bottom - 594 * scale) * 0.42;
  homeBackground(ctx, width, height);
  ctx.save();
  ctx.translate(left, originY);
  ctx.scale(scale, scale);

  const card = (id, x, y, w, h, fill) => {
    rounded(ctx, box(x, y, w, h), 7, fill, brass);
    hits.push({ id, rect: box(left + x * scale, originY + y * scale, w * scale, h * scale) });
  };

  text(ctx, '选择模式', 3, 43, { color: '#f7ead0', size: 35, bold: true, serif: true });
  ctx.fillStyle = brass;
  ctx.fillRect(3, 77, 354, 1);

  const details = [
    ['normal', '10 关 · 每关多 5 片', '#1e463c', '#d5c4a0'],
    ['hard', '20 关 · 20 片起 · 可旋转', '#263d42', '#ced7d7'],
    ['extreme', '无限关卡 · 可旋转 · 干扰碎片', '#523b37', '#e2c0ac'],
  ];
  details.forEach(([mode, detail, fill, accent], i) => {
    const y = 96 + i * 126;
    card('mode-' + mode, 0, y, 360, 112, fill);
    rounded(ctx, box(7, y + 7, 346, 98), 4, null, 'rgba(239,214,163,0.28)');
    const level = app.modeBooks[mode]?.current;
    const progress = (app.modeBooks[mode]?.wins || []).length;
    const hint = progress === app.modes[mode].limit ? '已通关' :
      level === undefined ? '开始挑战' : '继续第 ' + (level + 1) + ' 关';
    text(ctx, app.modes[mode].name, 22, y + 31, { size: 25, bold: true, serif: true });
    text(ctx, detail, 23, y + 63, { size: 14, color: accent });
    text(ctx, hint, 23, y + 89, { size: 13, color: accent });
    text(ctx, '›', 329, y + 55, { size: 30, color: '#f3d297', align: 'center' });
  });

  [['daily', '每日一瓷'], ['ranking', '排行榜'], ['share', '分享']].forEach(([id, label], i) => {
    card(id, i * 122, 482, 116, 50, '#e9ddc1');
    text(ctx, label, i * 122 + 58, 507, { align: 'center', size: 15, color: ink, bold: true });
  });
  if (app.homeNotice) text(ctx, app.homeNotice, 180, 555, { align: 'center', size: 14, color: '#fff2d6', width: 350 });
  ctx.restore();
  return app.modal ? drawModal(ctx, app, layout) : hits;
}

function drawModal(ctx, app, layout) {
  const puzzle = app.puzzle;
  const kind = app.modal;
  const hits = [];
  const w = Math.min(420, layout.w);
  const height = kind === 'timeout' ? 204 : kind === 'reset' ? 170 : Math.min(430, layout.height - layout.top - 34);
  const r = box((layout.width - w) / 2, Math.max(layout.top + 4, (layout.height - height) / 2), w, height);
  ctx.fillStyle = 'rgba(8,20,19,0.78)';
  ctx.fillRect(0, 0, layout.width, layout.height);
  rounded(ctx, r, 17, COLORS.panel, '#a18b5e');
  const title = kind === 'ranking' ? '排行榜' : kind === 'timeout' ? '时间到' : kind === 'reset' ? '重新打散碎片？' :
    kind === 'win' ? '「' + puzzle.level.name + '」已入藏' : puzzle.level.name;
  text(ctx, title, r.x + 14, r.y + 27, { color: COLORS.gold, size: 21, bold: true, serif: true, width: r.w - 84 });
  if (kind === 'timeout') {
    button(ctx, hits, 'home', '首页', box(r.x + r.w - 59, r.y + 10, 48, 34), { size: 12, disabled: app.watching });
    text(ctx, app.adNotice || '重开本关，或完整观看广告续时 60 秒。', r.x + 14, r.y + 76,
      { color: COLORS.note, width: r.w - 28 });
    const actionWidth = (r.w - 37) / 2;
    button(ctx, hits, 'confirm-reset', '本关重开', box(r.x + 14, r.y + 125, actionWidth, 46), { disabled: app.watching });
    button(ctx, hits, 'ad-time', app.watching ? '正在播放广告' : '看广告 +60 秒',
      box(r.x + 23 + actionWidth, r.y + 125, actionWidth, 46), { primary: !app.watching, disabled: app.watching });
    return hits;
  }
  button(ctx, hits, 'close', '关闭', box(r.x + r.w - 59, r.y + 10, 48, 34), { size: 12 });
  if (kind === 'ranking') {
    text(ctx, '本机 · 每日一瓷最快五次', r.x + 14, r.y + 63, { size: 14, color: COLORS.note });
    if (!app.records.length) {
      text(ctx, '完成今日修复后，用时将显示在这里。', r.x + 14, r.y + 108,
        { color: COLORS.note, width: r.w - 28 });
      button(ctx, hits, 'daily', '挑战每日一瓷', box(r.x + 14, r.y + 139, r.w - 28, 42), { primary: true });
    }
    const rowHeight = Math.min(57, (r.h - 92) / 5);
    app.records.slice(0, 5).forEach((record, i) => {
      const y = r.y + 82 + rowHeight * i;
      rounded(ctx, box(r.x + 13, y, r.w - 26, rowHeight - 5), 6, '#29453b');
      text(ctx, String(i + 1).padStart(2, '0'), r.x + 25, y + rowHeight / 2 - 3,
        { size: 17, color: COLORS.gold, bold: true });
      text(ctx, app.levels[record.index].name, r.x + 58, y + rowHeight / 2 - 10, { size: 15, bold: true });
      text(ctx, record.date, r.x + 58, y + rowHeight / 2 + 8, { size: 11, color: COLORS.note });
      text(ctx, formatTime(record.ms), r.x + r.w - 24, y + rowHeight / 2 - 3,
        { align: 'right', size: 17, color: COLORS.gold });
    });
  } else if (kind === 'reset') {
    text(ctx, '这关的桌面位置与拼合进度将重置。', r.x + 14, r.y + 75, { width: r.w - 27 });
    button(ctx, hits, 'close', '继续拼', box(r.x + 14, r.y + 111, (r.w - 34) / 2, 42));
    button(ctx, hits, 'confirm-reset', '重新开始', box(r.x + (r.w + 6) / 2, r.y + 111, (r.w - 34) / 2, 42), { primary: true });
  } else {
    const daily = app.screen === 'daily';
    const last = puzzle.index + 1 === puzzle.limit;
    const artwork = box(r.x + 13, r.y + 52, r.w - 26, r.h - (kind === 'win' ? daily ? 172 : 147 : 101));
    rounded(ctx, artwork, 10, '#3c5647');
    poster(ctx, puzzle.level, app.imageFor(puzzle.level), artwork, puzzle.phase === 'stored');
    const label = kind !== 'win' ? puzzle.level.story : daily ? '本次修复用时 ' + formatTime(app.daily.elapsed) :
      last ? '本模式全部关卡已完成。' : '下一关已解锁。';
    text(ctx, label, r.x + 14, artwork.y + artwork.h + 21, { color: COLORS.note, width: r.w - 28 });
    if (kind === 'win') {
      const y = r.y + r.h - 49;
      if (daily && app.shareNotice) text(ctx, app.shareNotice, r.x + 14, y - 13,
        { size: 12, width: r.w - 28, color: COLORS.gold });
      button(ctx, hits, 'close', '留在桌面', box(r.x + 13, y, (r.w - 33) / 2, 37));
      button(ctx, hits, daily ? 'share' : last ? 'home' : 'next', daily ? '分享成绩' : last ? '返回首页' : '下一关',
        box(r.x + (r.w + 7) / 2, y, (r.w - 33) / 2, 37), { primary: true });
    }
  }
  return hits;
}

function draw(ctx, layout, app) {
  const p = app.puzzle;
  fontFamily = app.fontFamily;
  if (app.screen === 'home') return drawHome(ctx, layout, app);
  const hits = [];
  const { width, height, x, w, top, levelY, compact } = layout;
  ctx.fillStyle = COLORS.base;
  ctx.fillRect(0, 0, width, height);
  const daily = app.screen === 'daily';
  button(ctx, hits, 'home', '‹ 首页', box(x, top + (compact ? 0 : 3), 75, compact ? 31 : 35), { size: 13 });
  if (p.phase === 'fit') {
    const clock = box(x + w - 104, top + (compact ? 0 : 3), 104, compact ? 31 : 35);
    const low = p.state.remaining <= 15000;
    rounded(ctx, clock, 7, low ? '#51322c' : COLORS.panel, low ? '#d2806e' : COLORS.edge);
    text(ctx, p.state.remaining > 0 ? formatTime(p.state.remaining) : '00:00', clock.x + 52, clock.y + clock.h / 2,
      { size: 19, bold: true, align: 'center', color: low ? '#ffd6c4' : COLORS.gold });
  }
  text(ctx, daily ? '每日一瓷 · ' + app.daily.date : '第 ' + (p.index + 1) + ' 关 · ' + p.level.difficulty,
    x + 3, levelY + 2, { size: 12, color: COLORS.gold, bold: true });
  text(ctx, p.level.name, x + 3, levelY + (compact ? 23 : 28), { size: compact ? 23 : 30, serif: true, bold: true, width: w - 95 });
  const status = (p.level.realCount || p.level.shards.length) + ' 片';
  text(ctx, status, x + w - 3, levelY + 8, { color: COLORS.gold, size: 18, bold: true, align: 'right' });
  text(ctx, p.phase === 'stored' ? '已修复' : p.level.decoyArt ? '含干扰碎片' : '待合拢', x + w - 3, levelY + 29,
    { color: COLORS.note, size: 12, align: 'right' });
  const image = app.imageFor(p.level);
  deskDraw(ctx, layout, p, image, p.level.decoyArt && app.imageFor(p.level.decoyArt));
  if (!image) {
    const [cx, cy] = [layout.desk.x + layout.desk.w / 2, layout.desk.y + layout.desk.h / 2];
    if (app.imageFailed(p.level)) button(ctx, hits, 'retry', '瓷片加载失败，点此重试', box(cx - 101, cy - 21, 202, 42));
    else text(ctx, '正在取出瓷片…', cx, cy, { align: 'center', color: '#244438', bold: true });
  }
  text(ctx, app.message, x + w / 2, layout.footerY - 16,
    { color: app.highlightMessage ? COLORS.gold : COLORS.note, size: 13, align: 'center', width: w - 5 });
  toolbar(ctx, layout, app, hits);
  return app.modal ? drawModal(ctx, app, layout) : hits;
}

module.exports = { computeLayout, contains, draw };
