'use strict';

const { WIDTH, HEIGHT, SCALE } = require('./puzzle.js');

let fontFamily = '';
const COLORS = {
  base: '#152b29', edge: '#486458', panel: '#203a34', ink: '#f9eee0',
  note: '#c4d3c6', gold: '#f1cb86', dark: '#302b1f', cloth: '#a5b49f',
};

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
  return { x, w, top, levelY, desk, field, scale, footerY, compact, width, height };
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

function ceramicOutline(ctx, outline) {
  ctx.beginPath();
  ctx.moveTo(outline[0], outline[1]);
  for (let i = 2; i < outline.length; i += 2) ctx.lineTo(outline[i], outline[i + 1]);
  ctx.closePath();
  ctx.clip();
}

function seamIsLit(puzzle, seam) {
  if (puzzle.phase === 'stored') return true;
  const coords = seam.poly;
  for (const id of puzzle.state.paint) {
    const [px, py] = puzzle.level.points[id];
    for (let i = 2; i < coords.length; i += 2) {
      const x = coords[i - 2], y = coords[i - 1], dx = coords[i] - x, dy = coords[i + 1] - y;
      const t = Math.min(1, Math.max(0, ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(px - x - t * dx, py - y - t * dy) <= 5) return true;
    }
  }
  return false;
}

function seams(ctx, level, group, bright) {
  if (group.ids.length < 2) return;
  ctx.save();
  ceramicOutline(ctx, level.outline);
  for (const seam of level.seams) {
    if (!seam.ids.every(id => group.ids.includes(id))) continue;
    const lit = bright(seam);
    ctx.beginPath();
    ctx.moveTo(seam.poly[0], seam.poly[1]);
    for (let i = 2; i < seam.poly.length; i += 2) ctx.lineTo(seam.poly[i], seam.poly[i + 1]);
    ctx.strokeStyle = lit ? '#ffe3a1' : '#ad793e';
    ctx.lineWidth = lit ? 3 : 1.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

function goldDots(ctx, puzzle) {
  for (let i = 0; i < puzzle.level.points.length; i++) {
    const [x, y] = puzzle.level.points[i];
    const done = puzzle.state.paint.includes(i);
    if (!done) {
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(241,176,76,0.34)';
      ctx.strokeStyle = '#ffe8ad';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, done ? 4 : 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff4cc';
    ctx.fill();
  }
}

function deskDraw(ctx, layout, puzzle, image) {
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
      const hinted = puzzle.hint.includes(group);
      ctx.shadowColor = hinted ? '#fff3ad' : group === puzzle.selected ? '#23554e' : '#465b46';
      ctx.shadowBlur = hinted ? 10 : 3;
      ctx.shadowOffsetY = hinted ? 0 : 2;
      for (const id of group.ids) {
        const shard = puzzle.level.shards[id], b = shard.box;
        atlasDraw(ctx, image, shard.sprite, box(b[0], b[1], b[2] - b[0], b[3] - b[1]));
      }
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowColor = 'transparent';
    }
    seams(ctx, puzzle.level, group, item => intact && seamIsLit(puzzle, item));
    if (puzzle.phase === 'gold') goldDots(ctx, puzzle);
    ctx.restore();
  }
  ctx.restore();
}

function toolbar(ctx, layout, app, hits) {
  const puzzle = app.puzzle;
  const actions = [{ id: 'reference', label: '原器' }];
  if (puzzle.phase === 'fit') {
    actions.push({ id: 'hint', label: '找邻片' });
    if (puzzle.level.rotations) actions.push({ id: 'rotate', label: '顺转 90°', disabled: !puzzle.selected });
  }
  if (puzzle.phase === 'stored') actions.push({ id: 'next', label: puzzle.index === app.levels.length - 1 ? '查看藏品' : '下一关', primary: true });
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
  if (repaired) seams(ctx, level, { ids: level.shards.map((_, i) => i) }, () => true);
  ctx.restore();
}

function drawModal(ctx, app, layout) {
  const puzzle = app.puzzle;
  const kind = app.modal;
  const hits = [];
  const w = Math.min(420, layout.w);
  const height = kind === 'reset' ? 170 : Math.min(430, layout.height - layout.top - 34);
  const r = box((layout.width - w) / 2, Math.max(layout.top + 4, (layout.height - height) / 2), w, height);
  ctx.fillStyle = 'rgba(8,20,19,0.78)';
  ctx.fillRect(0, 0, layout.width, layout.height);
  rounded(ctx, r, 17, COLORS.panel, '#a18b5e');
  const title = kind === 'cabinet' ? '藏品柜' : kind === 'reset' ? '重新打散碎片？' :
    kind === 'win' ? '「' + puzzle.level.name + '」已入藏' : puzzle.level.name;
  text(ctx, title, r.x + 14, r.y + 27, { color: COLORS.gold, size: 21, bold: true, serif: true, width: r.w - 84 });
  button(ctx, hits, 'close', '关闭', box(r.x + r.w - 59, r.y + 10, 48, 34), { size: 12 });
  if (kind === 'reset') {
    text(ctx, '这关的桌面位置与拼合进度将重置。', r.x + 14, r.y + 75, { width: r.w - 27 });
    button(ctx, hits, 'close', '继续拼', box(r.x + 14, r.y + 111, (r.w - 34) / 2, 42));
    button(ctx, hits, 'confirm-reset', '重新开始', box(r.x + (r.w + 6) / 2, r.y + 111, (r.w - 34) / 2, 42), { primary: true });
  } else if (kind === 'cabinet') {
    const cellWidth = (r.w - 43) / 3;
    const cellHeight = Math.min(161, (r.h - 68) / 2);
    app.levels.forEach((level, i) => {
      const cell = box(r.x + 14 + (i % 3) * (cellWidth + 7.5), r.y + 54 + Math.floor(i / 3) * (cellHeight + 6), cellWidth, cellHeight);
      const open = puzzle.unlocked(i), won = puzzle.book.wins.includes(i);
      rounded(ctx, cell, 8, '#29453b', i === puzzle.index ? COLORS.gold : COLORS.edge);
      ctx.save();
      if (!open) ctx.globalAlpha = 0.62;
      poster(ctx, level, app.imageFor(level), box(cell.x + 2, cell.y + 2, cell.w - 4, cell.h - 45), won);
      ctx.restore();
      text(ctx, level.name, cell.x + cell.w / 2, cell.y + cell.h - 30,
        { align: 'center', size: 13, bold: true, width: cell.w - 4 });
      text(ctx, won ? '已入藏' : open ? level.shards.length + ' 片' : '未解锁',
        cell.x + cell.w / 2, cell.y + cell.h - 13, { align: 'center', size: 12, color: COLORS.note });
      if (open) hits.push({ id: 'level-' + i, rect: cell });
    });
  } else {
    const artwork = box(r.x + 13, r.y + 52, r.w - 26, r.h - (kind === 'win' ? 147 : 101));
    rounded(ctx, artwork, 10, '#3c5647');
    poster(ctx, puzzle.level, app.imageFor(puzzle.level), artwork, puzzle.phase === 'stored');
    const label = kind === 'win' ? (puzzle.index === app.levels.length - 1 ? '六件瓷瓶已修复。' : '下一件瓷瓶已解锁。') : puzzle.level.story;
    text(ctx, label, r.x + 14, artwork.y + artwork.h + 21, { color: COLORS.note, width: r.w - 28 });
    if (kind === 'win') {
      const y = r.y + r.h - 49;
      button(ctx, hits, 'close', '留在桌面', box(r.x + 13, y, (r.w - 33) / 2, 37));
      button(ctx, hits, 'next', puzzle.index === app.levels.length - 1 ? '查看藏品' : '下一关',
        box(r.x + (r.w + 7) / 2, y, (r.w - 33) / 2, 37), { primary: true });
    }
  }
  return hits;
}

function draw(ctx, layout, app) {
  const p = app.puzzle;
  fontFamily = app.fontFamily;
  const hits = [];
  const { width, height, x, w, top, levelY, compact } = layout;
  ctx.fillStyle = COLORS.base;
  ctx.fillRect(0, 0, width, height);
  text(ctx, '金缮夜馆', x + 2, top + (compact ? 13 : 20), { size: 20, bold: true, serif: true });
  button(ctx, hits, 'cabinet', '藏品柜   ' + p.book.wins.length + '/' + app.levels.length,
    box(x + w - 111, top + (compact ? 0 : 3), 111, compact ? 31 : 35), { size: 13 });
  text(ctx, '第 ' + (p.index + 1) + ' 关 · ' + p.level.difficulty, x + 3, levelY + 2, { size: 12, color: COLORS.gold, bold: true });
  text(ctx, p.level.name, x + 3, levelY + (compact ? 23 : 28), { size: compact ? 23 : 30, serif: true, bold: true });
  const status = p.phase === 'fit' ? p.state.groups.length + ' 组' :
    p.phase === 'gold' ? p.state.paint.length + '/' + p.level.points.length : p.level.shards.length + ' 片';
  text(ctx, status, x + w - 3, levelY + 8, { color: COLORS.gold, size: 18, bold: true, align: 'right' });
  text(ctx, p.phase === 'fit' ? '待合拢' : p.phase === 'gold' ? '描金' : '已修复', x + w - 3, levelY + 29,
    { color: COLORS.note, size: 12, align: 'right' });
  const image = app.imageFor(p.level);
  deskDraw(ctx, layout, p, image);
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
