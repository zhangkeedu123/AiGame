'use strict';

const { WIDTH, HEIGHT, SCALE, rotatePoint } = require('./puzzle.js');
const { formatTime } = require('./daily.js');

let fontFamily = '';
const COLORS = {
  base: '#152b29', edge: '#486458', panel: '#203a34', ink: '#f9eee0',
  note: '#c4d3c6', gold: '#f1cb86', dark: '#302b1f', cloth: '#a5b49f',
};
const HINT_OUTLINE = [['rgba(42,52,41,0.58)', 3.4], ['#e8c784', 1.9]];
const SELECTION_OUTLINE = [['rgba(38,74,62,0.52)', 2.6], ['#d8f1e5', 1.35]];
const OPENING_DURATION = 1320;
const BREAK_AT = 440;
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

function openingDraw(ctx, puzzle, image, decoyImage, elapsed) {
  const level = puzzle.level;
  const originX = (WIDTH - 400 * SCALE) / 2;
  const originY = (HEIGHT - 450 * SCALE) / 2;
  if (elapsed < BREAK_AT) {
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
      ctx.globalAlpha = (elapsed - 270) / (BREAK_AT - 270);
      seams(ctx, level, { ids: level.shards.map((_, id) => id) }, false);
    }
    ctx.restore();
    return;
  }

  const progress = (elapsed - BREAK_AT) / (OPENING_DURATION - BREAK_AT);
  const travel = 1 - (1 - progress) ** 3;
  const kick = Math.sin(Math.PI * progress);
  for (const group of puzzle.state.groups) {
    const id = group.ids[0];
    const shard = level.shards[id];
    const [dx, dy] = rotatePoint(shard.cx * SCALE, shard.cy * SCALE, group.turn);
    const targetX = group.x + dx, targetY = group.y + dy;
    const decoy = level.decoyArt && id >= level.realCount;
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
    ctx.rotate(turn * Math.PI / 2 * (decoy ? 1 : travel) + (id % 2 ? 0.16 : -0.16) * kick);
    ctx.scale(SCALE, SCALE);
    ctx.translate(-shard.cx, -shard.cy);
    drawShard(ctx, level, id, image, decoyImage);
    ctx.restore();
  }
}

function deskDraw(ctx, layout, puzzle, image, decoyImage, opening) {
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
    openingDraw(ctx, puzzle, image, decoyImage, opening.elapsed);
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

function homeIcon(ctx, kind, x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  if (kind === 'daily') {
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

function drawHome(ctx, layout, app) {
  const { width, height, top, bottom, w } = layout;
  const hits = [];
  const ink = '#254a40', brass = '#b39262';
  const scale = Math.min(1, w / 330, (height - top - bottom) / 392);
  const left = (width - 330 * scale) / 2;
  const originY = Math.max(top + 6, Math.min(height / 2 - 143 * scale, height - bottom - 379 * scale));
  homeBackground(ctx, width, height, app.imageFor(HOME_ART));
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
    ['normal', '10 关 · 每关多 5 片', '#2e6b59', '#205344'],
    ['hard', '20 关 · 20 片起 · 可旋转', '#3c657b', '#2c5269'],
    ['extreme', '无限关卡 · 可旋转 · 干扰碎片', '#9c6053', '#7a453d'],
  ];
  details.forEach(([mode, detail, light, dark], i) => {
    const y = 57 + i * 69;
    const glaze = ctx.createLinearGradient(0, y, 0, y + 57);
    glaze.addColorStop(0, light);
    glaze.addColorStop(1, dark);
    rounded(ctx, box(45, y + 3, 240, 57), 14, 'rgba(67,57,37,0.19)');
    rounded(ctx, box(45, y, 240, 57), 14, glaze, '#bd9a63');
    addHit('mode-' + mode, 45, y, 240, 57);
    rounded(ctx, box(49, y + 4, 232, 49), 10, null, 'rgba(247,222,167,0.37)');
    const book = app.modeBooks[mode];
    const progress = book?.wins?.length;
    const subtitle = progress === app.modes[mode].limit ? '已通关' :
      book?.current === undefined ? detail : '继续第 ' + (book.current + 1) + ' 关 · ' + detail.split(' · ')[0];
    text(ctx, app.modes[mode].name, 165, y + 20, { align: 'center', size: 20, bold: true, color: '#fff2d2' });
    text(ctx, subtitle, 165, y + 40, { align: 'center', size: 11.5, color: '#f1ddaf' });
    homeIcon(ctx, 'chevron', 266, y + 28, '#f0d39d');
  });

  const shortcuts = [
    ['daily', '每日一瓷', '#2d5d4e', '#eee4ca'],
    ['ranking', '排行榜', '#795434', '#f3dfbb'],
    ['share', '分享', '#32586c', '#e6e7da'],
  ];
  shortcuts.forEach(([id, label, iconColor, fill], i) => {
    const x = 83 + i * 82;
    ctx.save();
    ctx.shadowColor = 'rgba(29,35,30,0.32)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    rounded(ctx, box(x - 21, 279, 42, 42), 21, fill, '#bd9a63');
    ctx.restore();
    rounded(ctx, box(x - 17.5, 282.5, 35, 35), 17.5, null, 'rgba(112,84,47,0.25)');
    homeIcon(ctx, id, x, 300, iconColor);
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

function drawModal(ctx, app, layout) {
  const puzzle = app.puzzle;
  const kind = app.modal;
  const hits = [];
  const w = Math.min(420, layout.w);
  const height = kind === 'timeout' || kind === 'reset' ? 170 : Math.min(430, layout.height - layout.top - 34);
  const r = box((layout.width - w) / 2, Math.max(layout.top + 4, (layout.height - height) / 2), w, height);
  ctx.fillStyle = 'rgba(8,20,19,0.78)';
  ctx.fillRect(0, 0, layout.width, layout.height);
  rounded(ctx, r, 17, COLORS.panel, '#a18b5e');
  const title = kind === 'ranking' ? '排行榜' : kind === 'timeout' ? '时间到' : kind === 'reset' ? '重新打散碎片？' :
    kind === 'win' ? '「' + puzzle.level.name + '」已入藏' : puzzle.level.name;
  text(ctx, title, r.x + 14, r.y + 27, { color: COLORS.gold, size: 21, bold: true, serif: true, width: r.w - 84 });
  if (kind === 'timeout') {
    button(ctx, hits, 'home', '首页', box(r.x + r.w - 59, r.y + 10, 48, 34), { size: 12 });
    text(ctx, '可重开本关，重新开始计时。', r.x + 14, r.y + 76,
      { color: COLORS.note, width: r.w - 28 });
    button(ctx, hits, 'confirm-reset', '本关重开', box(r.x + 14, r.y + 109, r.w - 28, 42), { primary: true });
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
  deskDraw(ctx, layout, p, image, p.level.decoyArt && app.imageFor(p.level.decoyArt), app.opening);
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

module.exports = { computeLayout, contains, draw, OPENING_DURATION };
