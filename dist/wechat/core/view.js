'use strict';

const { WIDTH, HEIGHT, SCALE, rotatePoint } = require('./puzzle.js');
const { formatTime, formatLocalDateTime } = require('./daily.js');
const { shippingFields, shippingStatuses } = require('./collection.js');

let fontFamily = '';
const COLORS = {
  base: '#152b29', edge: '#486458', panel: '#203a34', ink: '#f9eee0',
  note: '#c4d3c6', gold: '#f1cb86', dark: '#302b1f', cloth: '#a5b49f',
};
const HINT_OUTLINE = [['rgba(42,52,41,0.58)', 3.4], ['#e8c784', 1.9]];
const SELECTION_OUTLINE = [['rgba(38,74,62,0.52)', 2.6], ['#d8f1e5', 1.35]];
const OPENING_DURATION = 1320;
const OPENING_BREAK = 440;
const HOME_ART = { image: 'assets/home-shanshui.jpg' };

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

function traceContours(ctx, contours) {
  ctx.beginPath();
  for (const outline of contours) {
    ctx.moveTo(outline[0], outline[1]);
    for (let i = 2; i < outline.length; i += 2) ctx.lineTo(outline[i], outline[i + 1]);
    ctx.closePath();
  }
}

function tracePolygon(ctx, outline) {
  traceContours(ctx, [outline]);
}

function seams(ctx, level, group, repaired) {
  if (group.ids.length < 2) return;
  ctx.save();
  traceContours(ctx, level.contours?.length ? level.contours : [level.outline]);
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

function shardNumbers(ctx, level, group, numbers) {
  for (const id of group.ids) {
    const { cx, cy, box } = level.shards[id];
    const size = level.cutout ? Math.max(12, Math.min(22, (box[2] - box[0]) * 0.42, (box[3] - box[1]) * 0.42)) : 22;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-group.turn * Math.PI / 2);
    text(ctx, String(numbers[id]), 0, 0, { align: 'center', size, bold: true, color: '#fffdf4', outline: '#253c33' });
    ctx.restore();
  }
}

function drawShard(ctx, level, id, image) {
  const shard = level.shards[id];
  const [left, top, right, bottom] = shard.box;
  const rect = box(left, top, right - left, bottom - top);
  if (!level.cutout) {
    atlasDraw(ctx, image, shard.sprite, rect);
    return;
  }
  ctx.save();
  tracePolygon(ctx, shard.poly);
  ctx.clip();
  atlasDraw(ctx, image, shard.sprite, rect);
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
      const { poly, contours } = level.shards[id];
      if (contours?.length) {
        traceContours(ctx, contours);
        ctx.stroke();
        continue;
      }
      if (level.cutout) {
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

function openingDraw(ctx, puzzle, image, elapsed) {
  const level = puzzle.level;
  const originX = (WIDTH - 400 * SCALE) / 2;
  const originY = (HEIGHT - 450 * SCALE) / 2;
  if (elapsed < OPENING_BREAK) {
    const lift = 24 * (1 - Math.min(1, elapsed / 275)) ** 2;
    ctx.save();
    ctx.translate(originX, originY - lift);
    ctx.scale(SCALE, SCALE);
    ctx.shadowColor = 'rgba(30,57,43,0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5 + lift * 0.28;
    atlasDraw(ctx, image, level.poster, box(0, 0, 400, 450));
    if (elapsed > 270) {
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = (elapsed - 270) / (OPENING_BREAK - 270);
      seams(ctx, level, { ids: level.shards.map((_, id) => id) }, false);
    }
    ctx.restore();
    return;
  }

  const progress = (elapsed - OPENING_BREAK) / (OPENING_DURATION - OPENING_BREAK);
  const travel = 1 - (1 - progress) ** 3;
  const kick = Math.sin(Math.PI * progress);
  for (const group of puzzle.state.groups) {
    const id = group.ids[0];
    const shard = level.shards[id];
    const [dx, dy] = rotatePoint(shard.cx * SCALE, shard.cy * SCALE, group.turn);
    const targetX = group.x + dx, targetY = group.y + dy;
    const decoy = id >= level.realCount;
    ctx.save();
    if (decoy) {
      const arrival = Math.max(0, (progress - 0.32) / 0.68);
      ctx.globalAlpha = arrival;
      ctx.translate(targetX, targetY + 44 * (1 - arrival) ** 2);
    } else {
      const startX = originX + shard.cx * SCALE, startY = originY + shard.cy * SCALE;
      ctx.translate(startX + (targetX - startX) * travel + kick * (shard.cx - 200) * 0.12,
        startY + (targetY - startY) * travel - kick * (16 + id % 4 * 3));
    }
    const turn = group.turn === 3 ? -1 : group.turn;
    if (!decoy) ctx.rotate(turn * Math.PI / 2 * travel + (id % 2 ? 0.16 : -0.16) * kick);
    ctx.scale(SCALE, SCALE);
    ctx.translate(-shard.cx, -shard.cy);
    drawShard(ctx, level, id, image);
    ctx.restore();
  }
}

function deskDraw(ctx, layout, puzzle, image, opening) {
  rounded(ctx, layout.desk, 14, COLORS.cloth, '#b8c4af');
  const desk = layout.desk;
  rounded(ctx, box(desk.x + 5, desk.y + 5, desk.w - 10, desk.h - 10), 10, null, '#c9d2bd');
  if (!image) return;
  ctx.save();
  rounded(ctx, desk, 14);
  ctx.clip();
  ctx.translate(layout.field.x, layout.field.y);
  ctx.scale(layout.scale, layout.scale);
  if (opening) {
    openingDraw(ctx, puzzle, image, opening.elapsed);
    ctx.restore();
    return;
  }
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
      for (const id of group.ids) drawShard(ctx, puzzle.level, id, image);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowColor = 'transparent';
    }
    seams(ctx, puzzle.level, group, intact);
    if (!intact) shardNumbers(ctx, puzzle.level, group, puzzle.state.numbers);
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
    if (puzzle.level.rotateCount) actions.push({ id: 'rotate', label: '旋转 90°', disabled: !puzzle.canRotate });
    actions.push({ id: 'rearrange', label: '重排' });
  }
  if (puzzle.phase === 'stored') actions.push(app.screen === 'daily'
    ? { id: 'share', label: '分享成绩', primary: true }
    : { id: app.nextLevel ? 'next' : 'home', label: app.nextLevel ? '下一关' : '返回首页', primary: true });
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

function homeBackground(ctx, width, height, image) {
  ctx.fillStyle = '#ddccba';
  ctx.fillRect(0, 0, width, height);
  if (image && image.width && image.height) {
    const cover = Math.max(width / image.width, height / image.height);
    const sourceWidth = width / cover, sourceHeight = height / cover;
    ctx.drawImage(image, (image.width - sourceWidth) / 2, 0,
      sourceWidth, sourceHeight, 0, 0, width, height);
  }
}

function drawIcon(ctx, kind, x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  if (kind === 'collection') {
    ctx.moveTo(-4, -7); ctx.lineTo(4, -7); ctx.lineTo(3, -4);
    ctx.quadraticCurveTo(3, -2, 5, 0); ctx.quadraticCurveTo(8, 4, 5, 6);
    ctx.quadraticCurveTo(0, 9, -5, 6); ctx.quadraticCurveTo(-8, 4, -5, 0);
    ctx.quadraticCurveTo(-3, -2, -3, -4); ctx.closePath();
  } else if (kind === 'daily') {
    ctx.moveTo(-2, -7); ctx.lineTo(-2, -3);
    ctx.moveTo(3, -7); ctx.lineTo(3, -3);
    ctx.moveTo(-6, -1); ctx.lineTo(7, -1);
    ctx.moveTo(-6, -5); ctx.lineTo(7, -5); ctx.lineTo(7, 7); ctx.lineTo(-6, 7); ctx.closePath();
  } else if (kind === 'ranking') {
    ctx.moveTo(-4, -6); ctx.lineTo(4, -6); ctx.lineTo(4, -2);
    ctx.quadraticCurveTo(4, 2, 0, 2); ctx.quadraticCurveTo(-4, 2, -4, -2); ctx.closePath();
    ctx.moveTo(-4, -4); ctx.lineTo(-8, -4); ctx.quadraticCurveTo(-8, 0, -4, 0);
    ctx.moveTo(4, -4); ctx.lineTo(8, -4); ctx.quadraticCurveTo(8, 0, 4, 0);
    ctx.moveTo(0, 2); ctx.lineTo(0, 7);
    ctx.moveTo(-4, 7); ctx.lineTo(4, 7);
  } else if (kind === 'share') {
    ctx.moveTo(-8, 5);
    ctx.quadraticCurveTo(-6, -3, 2, -3);
    ctx.lineTo(2, -7); ctx.lineTo(9, -1); ctx.lineTo(2, 5); ctx.lineTo(2, 1);
    ctx.quadraticCurveTo(-5, 1, -8, 5);
  } else if (kind === 'settings') {
    for (let tooth = 0; tooth < 8; tooth++) {
      const angle = tooth * Math.PI / 4;
      for (const [edge, radius] of [[-0.39, 7.2], [-0.19, 9.6], [0.19, 9.6], [0.39, 7.2]]) {
        const px = Math.cos(angle + edge) * radius, py = Math.sin(angle + edge) * radius;
        if (tooth === 0 && edge === -0.39) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.moveTo(3.2, 0);
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
  } else {
    ctx.moveTo(-3, -4); ctx.lineTo(2, 0); ctx.lineTo(-3, 4);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.35;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function settingsButton(ctx, hits, rect) {
  rounded(ctx, rect, 12, 'rgba(245,234,210,0.93)', '#ac8d5e');
  drawIcon(ctx, 'settings', rect.x + rect.w / 2, rect.y + rect.h / 2, '#254a40');
  hits.push({ id: 'settings', rect });
}

function drawHome(ctx, layout, app) {
  const { width, height, top, bottom, w } = layout;
  const hits = [];
  const ink = '#254a40', brass = '#b39262';
  const scale = Math.min(1, w / 330, (height - top - bottom) / 392);
  const left = (width - 330 * scale) / 2;
  const originY = Math.max(top + 6, Math.min(height / 2 - 143 * scale, height - bottom - 379 * scale));
  homeBackground(ctx, width, height, app.imageFor(HOME_ART));
  settingsButton(ctx, hits, box(layout.x + w - 42, top + 3, 42, 36));
  ctx.save();
  ctx.translate(left, originY);
  ctx.scale(scale, scale);

  const addHit = (id, x, y, w, h) => {
    hits.push({ id, rect: box(left + x * scale, originY + y * scale, w * scale, h * scale) });
  };

  text(ctx, '选择模式', 165, 26, { color: ink, align: 'center', size: 27, bold: true, serif: true });
  ctx.fillStyle = brass;
  ctx.fillRect(63, 26, 37, 1);
  ctx.fillRect(230, 26, 37, 1);

  const details = [
    ['normal', '#2e6b59', '#205344'],
    ['hard', '#3c657b', '#2c5269'],
    ['extreme', '#9c6053', '#7a453d'],
  ];
  details.forEach(([mode, light, dark], i) => {
    const y = 57 + i * 69;
    const glaze = ctx.createLinearGradient(0, y, 0, y + 57);
    glaze.addColorStop(0, light);
    glaze.addColorStop(1, dark);
    rounded(ctx, box(45, y + 3, 240, 57), 14, 'rgba(67,57,37,0.19)');
    rounded(ctx, box(45, y, 240, 57), 14, glaze, '#bd9a63');
    addHit('mode-' + mode, 45, y, 240, 57);
    rounded(ctx, box(49, y + 4, 232, 49), 10, null, 'rgba(247,222,167,0.37)');
    const current = app.modeEntry(mode);
    const subtitle = current ?
      '第 ' + current.level_number + ' 关 · ' + (app.completed.has(current.id) ? '已修复' : current.name || '开始修复') :
      app.modes[mode].subtitle;
    text(ctx, app.modes[mode].name, 165, y + 20, { align: 'center', size: 20, bold: true, color: '#fff2d2' });
    text(ctx, subtitle, 165, y + 40, { align: 'center', size: 11.5, color: '#f1ddaf' });
    drawIcon(ctx, 'chevron', 266, y + 28, '#f0d39d');
  });

  const shortcuts = [
    ['daily', '每日一瓷', '#2d5d4e', '#eee4ca'],
    ['collection', '藏品阁', '#6e4c3c', '#f2e6d1'],
    ['ranking', '排行榜', '#795434', '#f3dfbb'],
    ['share', '分享', '#32586c', '#e6e7da'],
  ];
  shortcuts.forEach(([id, label, color, fill], i) => {
    const x = 51 + i * 76;
    ctx.save();
    ctx.shadowColor = 'rgba(29,35,30,0.32)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    rounded(ctx, box(x - 21, 279, 42, 42), 21, fill, '#bd9a63');
    ctx.restore();
    rounded(ctx, box(x - 17.5, 282.5, 35, 35), 17.5, null, 'rgba(112,84,47,0.25)');
    drawIcon(ctx, id, x, 300, color);
    ctx.save();
    ctx.shadowColor = 'rgba(25,34,30,0.9)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    text(ctx, label, x, 337, { align: 'center', size: 13, color: '#fff3d7', bold: true });
    ctx.restore();
    addHit(id, x - 34, 276, 68, 73);
  });
  if (app.homeNotice) {
    rounded(ctx, box(53, 352, 224, 26), 13, 'rgba(246,235,211,0.95)');
    text(ctx, app.homeNotice, 165, 365, { align: 'center', size: 12, color: ink, width: 210 });
  }
  ctx.restore();
  return app.modal ? drawModal(ctx, app, layout) : hits;
}

function soundSettings(ctx, app, r, hits) {
  for (const [i, channel, label] of [[0, 'music', '背景音乐'], [1, 'effects', '游戏音效']]) {
    const { enabled, volume } = app.audio.settings[channel];
    const panel = box(r.x + 14, r.y + 55 + i * 105, r.w - 28, 94);
    rounded(ctx, panel, 9, '#264139', '#4b655a');
    text(ctx, label, panel.x + 13, panel.y + 21, { size: 15, bold: true });
    button(ctx, hits, 'toggle-' + channel, enabled ? '开启' : '关闭',
      box(panel.x + panel.w - 65, panel.y + 8, 53, 28), { primary: enabled, size: 12 });
    const slider = { channel, x: panel.x + 17, w: panel.w - 77 };
    const y = panel.y + 63;
    const filled = slider.w * volume / 100;
    rounded(ctx, box(slider.x, y - 3, slider.w, 6), 3, '#142c27');
    if (filled > 0) rounded(ctx, box(slider.x, y - 3, filled, 6), 3, enabled ? COLORS.gold : '#7d8f85');
    ctx.beginPath();
    ctx.arc(slider.x + filled, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = enabled ? '#fae4b4' : '#a3b2aa';
    ctx.fill();
    text(ctx, volume + '%', panel.x + panel.w - 13, y, { size: 13, align: 'right', color: COLORS.note });
    hits.push({ id: 'volume-' + channel, slider, rect: box(slider.x - 9, y - 17, slider.w + 18, 34) });
  }
}

function drawCollection(ctx, app, r, hits) {
  const c = app.collection;
  const x = r.x + 14, w = r.w - 28;
  const eligible = c.ready && !c.loading && c.balance >= c.cost;
  const canRedeem = eligible && app.platform.shippingAvailable;
  const award = c.ready && !c.loading && c.awards[0];
  const awardAvailable = Boolean(award && app.platform.shippingAvailable);
  const progress = c.loading ? '正在同步…' : c.ready ? '实物瓷碗兑换  ' + c.balance + ' / ' + c.cost : '完成每日一瓷赢取实物';
  rounded(ctx, box(x, r.y + 53, w, 72), 10, '#2a473e', '#607663');
  text(ctx, progress, x + 12, r.y + 73, { bold: true, color: COLORS.gold });
  rounded(ctx, box(x + 12, r.y + 90, w - 24, 5), 2, '#142c27');
  if (c.balance) rounded(ctx, box(x + 12, r.y + 90, (w - 24) * Math.min(1, c.balance / c.cost), 5), 2, COLORS.gold);
  const hint = canRedeem ? '集齐了，申请一份实物瓷器寄回家' :
    eligible ? '已集齐，安全连接可提交收货信息' : '每日首胜入藏 · 30 件可兑换如实物瓷碗';
  text(ctx, hint, x + 12, r.y + 109,
    { size: 11, color: COLORS.note, width: w - 24 });
  const half = (w - 8) / 2;
  button(ctx, hits, 'collection-items', '我的收藏', box(x, r.y + 134, half, 33), { primary: c.tab === 'items', size: 12 });
  button(ctx, hits, 'collection-claims', '兑换记录', box(x + half + 8, r.y + 134, half, 33),
    { primary: c.tab === 'claims', size: 12 });
  const items = c.tab === 'items' ? c.records(app.records) : c.claims;
  const startY = r.y + 174;
  const rows = Math.max(1, Math.min(3, Math.floor((r.h - 260) / 55)));
  const start = c.page * rows;
  items.slice(start, start + rows).forEach((item, i) => {
    const y = startY + i * 55;
    rounded(ctx, box(x, y, w, 50), 8, '#29453b');
    if (c.tab === 'items') {
      const thumbnail = box(x + 6, y + 4, 42, 42);
      rounded(ctx, thumbnail, 6, '#354e43');
      const image = item.image && item.poster && app.imageFor(item);
      if (image) poster(ctx, item, image, thumbnail, false);
      else drawIcon(ctx, 'collection', x + 27, y + 24, COLORS.gold);
      text(ctx, item.name || '每日藏品', x + 57, y + 16, { bold: true, width: w - 138 });
      const timestamp = formatLocalDateTime(item.completed_at) || item.date;
      text(ctx, timestamp + ' · 用时 ' + formatTime(item.ms), x + 57, y + 35,
        { color: COLORS.note, size: 11, width: w - 67 });
      text(ctx, item.verified ? '已入藏' : '本机收藏', x + w - 10, y + 17,
        { size: 11, color: item.verified ? COLORS.gold : COLORS.note, align: 'right' });
    } else {
      const day = formatLocalDateTime(item.created_at).slice(0, 10);
      text(ctx, day + (item.reward_month ? ' · 月榜冠军奖品' : ' · 收藏兑换'), x + 10, y + 16,
        { size: 13, bold: true, width: w - 91 });
      text(ctx, shippingStatuses[item.status] || '待处理', x + w - 10, y + 16, { color: COLORS.gold, size: 12, align: 'right' });
      text(ctx, item.tracking_number ? item.carrier + '  ' + item.tracking_number : '物流信息将在发货后更新',
        x + 10, y + 35, { width: w - 20, color: COLORS.note, size: 11 });
    }
  });
  if (!items.length) text(ctx, c.tab === 'items' ? '完成每日一瓷，第一件藏品就会出现在这里。' : '兑换成功后，可在这里查看发货进度。',
    x + w / 2, startY + 29, { width: w, align: 'center', color: COLORS.note, size: 13 });
  const lastY = r.y + r.h - 48;
  if (items.length > rows) {
    button(ctx, hits, 'collection-prev', '上一页', box(x, lastY - 38, 62, 28), { disabled: c.page === 0, size: 11 });
    button(ctx, hits, 'collection-next', '下一页', box(x + w - 62, lastY - 38, 62, 28),
      { disabled: start + rows >= items.length, size: 11 });
    text(ctx, (c.page + 1) + ' / ' + Math.ceil(items.length / rows), x + w / 2, lastY - 24,
      { size: 11, color: COLORS.note, align: 'center' });
  } else if (c.notice) {
    text(ctx, c.notice, x, lastY - 14, { size: 11, color: COLORS.gold, width: w });
  }
  button(ctx, hits, 'redeem', eligible ? '兑换实物瓷器' : '集齐 30 件可兑换', box(x, lastY, award ? half : w, 36),
    { primary: canRedeem, disabled: !canRedeem, size: 13 });
  if (award) button(ctx, hits, 'redeem-award', '领取月榜冠军奖', box(x + half + 8, lastY, half, 36),
    { primary: awardAvailable, disabled: !awardAvailable, size: 13 });
}

function drawRedemption(ctx, app, r, hits) {
  const c = app.collection;
  const x = r.x + 14, w = r.w - 28;
  const gap = Math.min(64, (r.h - 158) / 3);
  text(ctx, c.rewardMonth ? c.rewardMonth + ' 月榜冠军 · 领取实物瓷器一件' :
    '可兑换实物瓷碗等瓷器 · 消耗 ' + c.cost + ' 件额度', x, r.y + 59,
    { size: 13, color: COLORS.note, width: w });
  shippingFields.forEach(([key, label, placeholder], i) => {
    const y = r.y + 79 + i * gap;
    const value = c.form[key];
    text(ctx, label, x, y + 8, { size: 12, color: COLORS.gold });
    button(ctx, hits, 'shipping-' + key, value ? (value.length > 24 ? value.slice(0, 24) + '…' : value) : placeholder,
      box(x, y + 18, w, Math.min(34, gap - 20)), { size: 13, disabled: c.editing || c.submitting });
  });
  const y = r.y + r.h - 49;
  text(ctx, c.notice || '提交后，收货信息仅用于本次瓷器寄送。', x, y - 17, { size: 11, color: COLORS.note, width: w });
  button(ctx, hits, 'redeem-submit', c.submitting ? '提交中…' : '确认提交兑换', box(x, y, w, 37),
    { primary: true, disabled: c.editing || c.submitting });
}

function drawRanking(ctx, app, r, hits) {
  const board = app.ranking;
  const x = r.x + 14, width = r.w - 28;
  rounded(ctx, box(x, r.y + 55, width, 79), 10, '#2c4a40', '#8e7653');
  text(ctx, '每月冠军 · 赢一件实物瓷器', x + 12, r.y + 75, { color: COLORS.gold, bold: true, size: 16 });
  text(ctx, '闯得更远排在前，同关用时越短排名越高。', x + 12, r.y + 98,
    { color: COLORS.note, size: 12, width: width - 24 });
  text(ctx, '北京时间每月结算 · 奖品在藏品阁领取', x + 12, r.y + 118, { color: COLORS.note, size: 11, width: width - 24 });
  if (board.notice) {
    button(ctx, hits, 'ranking', board.notice, box(x, r.y + 149, width, 36), { size: 13 });
    return;
  }
  if (board.loading || !board.month) {
    text(ctx, '正在读取月榜…', x + 12, r.y + 163, { color: COLORS.note, size: 13 });
    return;
  }
  const half = (width - 8) / 2;
  button(ctx, hits, 'rank-current', '本月榜', box(x, r.y + 144, half, 32), { primary: board.month === board.current_month, size: 12 });
  button(ctx, hits, 'rank-previous', '上月榜', box(x + half + 8, r.y + 144, half, 32),
    { primary: board.month !== board.current_month, size: 12 });
  const champion = board.winner ? '冠军 ' + board.winner.nickname + ' · 奖品' + (board.winner.claimed ? '已申请' : '待领取') :
    '名次   玩家                         关卡 / 用时';
  text(ctx, board.month + ' · ' + champion, x + 7, r.y + 195, { size: 11, color: COLORS.note, width: width - 14 });
  const rowHeight = 39;
  const rows = Math.max(1, Math.floor((r.h - 255) / rowHeight));
  const start = board.page * rows;
  board.items.slice(start, start + rows).forEach((item, i) => {
    const y = r.y + 208 + i * rowHeight;
    rounded(ctx, box(x, y, width, 34), 7, item.rank === 1 ? '#4b4933' : '#29453b');
    text(ctx, String(item.rank).padStart(2, '0'), x + 10, y + 17, { bold: true, color: COLORS.gold });
    text(ctx, item.nickname || '玩家', x + 42, y + 17, { bold: true, size: 13, width: width - 166 });
    text(ctx, (app.modes[item.category]?.short || '') + ' 第 ' + item.level_number + ' 关', x + width - 73, y + 17,
      { size: 11, color: COLORS.note, align: 'right' });
    text(ctx, formatTime(item.elapsed_ms) + '.' + String(item.elapsed_ms % 1000).padStart(3, '0'),
      x + width - 8, y + 17, { size: 12, color: COLORS.gold, align: 'right' });
  });
  if (!board.items.length) text(ctx, '榜单还没有成绩，来完成一关吧。', x + width / 2, r.y + 239,
    { size: 13, color: COLORS.note, align: 'center' });
  if (board.items.length > rows) {
    const y = r.y + r.h - 42;
    button(ctx, hits, 'rank-prev', '上一页', box(x, y, 63, 30), { size: 11, disabled: board.page === 0 });
    button(ctx, hits, 'rank-next', '下一页', box(x + width - 63, y, 63, 30),
      { size: 11, disabled: start + rows >= board.items.length });
    text(ctx, (board.page + 1) + ' / ' + Math.ceil(board.items.length / rows), x + width / 2, y + 15,
      { size: 12, color: COLORS.note, align: 'center' });
  }
}

function drawModal(ctx, app, layout) {
  const puzzle = app.puzzle;
  const kind = app.modal;
  const hits = [];
  const w = Math.min(420, layout.w);
  const height = kind === 'settings' ? 270 :
    kind === 'reset' ? 170 : Math.min(430, layout.height - layout.top - 34);
  const r = box((layout.width - w) / 2, Math.max(layout.top + 4, (layout.height - height) / 2), w, height);
  ctx.fillStyle = 'rgba(8,20,19,0.78)';
  ctx.fillRect(0, 0, layout.width, layout.height);
  rounded(ctx, r, 17, COLORS.panel, '#a18b5e');
  const title = kind === 'collection' ? '藏品阁' : kind === 'redeem' ? '兑换实物瓷器' :
    kind === 'settings' ? '声音设置' : kind === 'ranking' ? '闯关月榜' : kind === 'reset' ? '重新打散碎片？' :
    kind === 'win' ? '「' + puzzle.level.name + '」已入藏' : puzzle.level.name;
  text(ctx, title, r.x + 14, r.y + 27, { color: COLORS.gold, size: 21, bold: true, serif: true, width: r.w - 84 });
  if (kind === 'settings') {
    button(ctx, hits, 'close', '完成', box(r.x + r.w - 67, r.y + 10, 53, 34), { size: 13 });
    soundSettings(ctx, app, r, hits);
    return hits;
  }
  button(ctx, hits, kind === 'redeem' ? 'redeem-back' : 'close', kind === 'redeem' ? '返回' : '关闭',
    box(r.x + r.w - 59, r.y + 10, 48, 34), { size: 12, disabled: kind === 'redeem' && (app.collection.editing || app.collection.submitting) });
  if (kind === 'collection') {
    drawCollection(ctx, app, r, hits);
  } else if (kind === 'redeem') {
    drawRedemption(ctx, app, r, hits);
  } else if (kind === 'ranking') {
    drawRanking(ctx, app, r, hits);
  } else if (kind === 'reset') {
    text(ctx, '这关的桌面位置与拼合进度将重置。', r.x + 14, r.y + 75, { width: r.w - 27 });
    button(ctx, hits, 'close', '继续拼', box(r.x + 14, r.y + 111, (r.w - 34) / 2, 42));
    button(ctx, hits, 'confirm-reset', '重新开始', box(r.x + (r.w + 6) / 2, r.y + 111, (r.w - 34) / 2, 42), { primary: true });
  } else {
    const daily = app.screen === 'daily';
    const last = !app.nextLevel;
    const artwork = box(r.x + 13, r.y + 52, r.w - 26, r.h - (kind === 'win' ? daily ? 172 : 147 : 101));
    rounded(ctx, artwork, 10, '#3c5647');
    poster(ctx, puzzle.level, app.imageFor(puzzle.level), artwork, puzzle.phase === 'stored');
    const label = kind !== 'win' ? puzzle.level.story : '本关用时 ' + formatTime(puzzle.state.elapsed);
    text(ctx, label, r.x + 14, artwork.y + artwork.h + 21, { color: COLORS.note, width: r.w - 28 });
    if (kind === 'win') {
      const y = r.y + r.h - 49;
      const notice = daily ? app.shareNotice : app.loadingLevel ? '正在取出下一件瓷器…' : app.scoreNotice;
      if (notice) text(ctx, notice, r.x + 14, y - 13,
        { size: 12, width: r.w - 28, color: COLORS.gold });
      const actions = daily ? [['close', '留在桌面'], ['share', '分享成绩'], ['collection', '查看藏品']] :
        [['close', '留在桌面'], [last ? 'home' : 'next', last ? '返回首页' : '下一关']];
      const width = (r.w - 26 - (actions.length - 1) * 7) / actions.length;
      actions.forEach(([id, label], i) => button(ctx, hits, id, label,
        box(r.x + 13 + (width + 7) * i, y, width, 37), { size: 13, primary: i === actions.length - 1, disabled: id === 'next' && app.loadingLevel }));
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
  const headerY = top + (compact ? 0 : 3), headerHeight = compact ? 31 : 35;
  button(ctx, hits, 'home', '‹ 首页', box(x, headerY, 75, headerHeight), { size: 13 });
  const clock = box(x + w - 117, headerY, 117, headerHeight);
  rounded(ctx, clock, 7, COLORS.panel, COLORS.edge);
  text(ctx, '用时', clock.x + 14, clock.y + clock.h / 2, { size: 11, color: COLORS.note });
  text(ctx, app.hasElapsedRecord ? formatTime(app.elapsed()) : '—', clock.x + 75, clock.y + clock.h / 2,
    { size: 19, bold: true, align: 'center', color: COLORS.gold });
  text(ctx, daily ? '每日一瓷 · ' + app.daily.date : '第 ' + p.level.level_number + ' 关 · ' + app.modes[p.level.category].name,
    x + 3, levelY + 2, { size: 12, color: COLORS.gold, bold: true });
  text(ctx, p.level.name, x + 3, levelY + (compact ? 23 : 28), { size: compact ? 23 : 30, serif: true, bold: true, width: w - 95 });
  const status = (p.level.realCount || p.level.shards.length) + ' 片';
  text(ctx, status, x + w - 3, levelY + 8, { color: COLORS.gold, size: 18, bold: true, align: 'right' });
  text(ctx, p.phase === 'stored' ? '已修复' : p.level.decoy_count > 0 ? '含干扰碎片' : '待合拢', x + w - 3, levelY + 29,
    { color: COLORS.note, size: 12, align: 'right' });
  const image = app.imageFor(p.level);
  deskDraw(ctx, layout, p, image, app.opening);
  if (!image) {
    const [cx, cy] = [layout.desk.x + layout.desk.w / 2, layout.desk.y + layout.desk.h / 2];
    if (app.imageFailed(p.level)) button(ctx, hits, 'retry', '瓷片加载失败，点此重试', box(cx - 101, cy - 21, 202, 42));
    else text(ctx, '正在取出瓷片…', cx, cy, { align: 'center', color: '#244438', bold: true });
  }
  if (!app.opening) {
    text(ctx, app.message, x + w / 2, layout.footerY - 16,
      { color: app.highlightMessage ? COLORS.gold : COLORS.note, size: 13, align: 'center', width: w - 5 });
    toolbar(ctx, layout, app, hits);
  }
  return app.modal ? drawModal(ctx, app, layout) : hits;
}

module.exports = { computeLayout, contains, draw, OPENING_DURATION, OPENING_BREAK };
