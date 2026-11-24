'use strict';

// 客户端存档（任意摆放的分组）与后台存档（0 ≤ x ≤ 400、0 ≤ y ≤ 590）之间的换算。

const WIDTH = 400;
const HEIGHT = 590;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function tidy(value) {
  return Math.round(value * 1000) / 1000;
}

// 客户端允许碎片被拖到边界外（组外框可以越界），后台要求坐标落在拼图板内，
// 所以整体平移而不是逐组夹取，这样碎片之间的相对位置不变。
function shift(groups) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const group of groups) {
    minX = Math.min(minX, group.x);
    maxX = Math.max(maxX, group.x);
    minY = Math.min(minY, group.y);
    maxY = Math.max(maxY, group.y);
  }
  let dx = 0, dy = 0;
  if (minX < 0) dx = -minX;
  else if (maxX > WIDTH) dx = WIDTH - maxX;
  if (minY < 0) dy = -minY;
  else if (maxY > HEIGHT) dy = HEIGHT - maxY;
  return groups.map(group => ({
    ids: group.ids.slice(),
    x: tidy(clamp(group.x + dx, 0, WIDTH)),
    y: tidy(clamp(group.y + dy, 0, HEIGHT)),
    turn: clamp(group.turn | 0, 0, 3),
  }));
}

// 已入藏的盘面在后台记为「一组碎片 + 三个金点」，与后台的通关判定一致。
function snapshot(state, complete) {
  return { groups: shift(state.groups), paint: complete ? [0, 1, 2] : [], revision: 0 };
}

// 三模式的盘面是本地切分的，碎片数对不上后台关卡，只在通关时记一笔「已入藏」。
function completed(count) {
  const ids = [];
  for (let id = 0; id < count; id++) ids.push(id);
  return { groups: [{ ids, x: 0, y: 0, turn: 0 }], paint: [0, 1, 2], revision: 0 };
}

// 后台存档要覆盖该关全部碎片才可用；数量对不上就放弃，回落到本地存档。
function restore(level, groups) {
  if (!level || !Array.isArray(groups) || !groups.length) return null;
  const seen = new Set();
  for (const group of groups) {
    if (!Array.isArray(group.ids) || !group.ids.length) return null;
    if (!Number.isFinite(group.x) || !Number.isFinite(group.y)) return null;
    if (!Number.isInteger(group.turn) || group.turn < 0 || group.turn > 3) return null;
    for (const id of group.ids) {
      if (!Number.isInteger(id) || id < 0 || id >= level.shards.length || seen.has(id)) return null;
      seen.add(id);
    }
  }
  if (seen.size !== level.shards.length) return null;
  return groups.map(group => ({ ids: group.ids.slice(), x: group.x, y: group.y, turn: group.turn }));
}

module.exports = { snapshot, completed, restore, shift, WIDTH, HEIGHT };
