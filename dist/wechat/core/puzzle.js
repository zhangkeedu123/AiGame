'use strict';

const WIDTH = 400;
const HEIGHT = 590;
const SCALE = 0.84;
const EDGE = 8;

function rotatePoint(x, y, turn) {
  switch (turn) {
    case 1: return [-y, x];
    case 2: return [-x, -y];
    case 3: return [y, -x];
    default: return [x, y];
  }
}

function limit(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function overlap(a, b) {
  return Math.max(0, Math.min(a[2], b[2]) + 8 - Math.max(a[0], b[0])) *
         Math.max(0, Math.min(a[3], b[3]) + 8 - Math.max(a[1], b[1]));
}

function polygonContains(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const ax = poly[j], ay = poly[j + 1], bx = poly[i], by = poly[i + 1];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function shardContains(shard, x, y) {
  if (!shard.contours?.length) return polygonContains(shard.poly, x, y);
  // Crossing the boundary of a hole toggles the point back outside the shard.
  let inside = false;
  for (const contour of shard.contours) {
    if (polygonContains(contour, x, y)) inside = !inside;
  }
  return inside;
}

function groupBounds(level, group) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const id of group.ids) {
    const box = level.shards[id].box;
    const a = rotatePoint(box[0] * SCALE, box[1] * SCALE, group.turn);
    const b = rotatePoint(box[2] * SCALE, box[3] * SCALE, group.turn);
    left = Math.min(left, a[0], b[0]);
    top = Math.min(top, a[1], b[1]);
    right = Math.max(right, a[0], b[0]);
    bottom = Math.max(bottom, a[1], b[1]);
  }
  return [left, top, right, bottom];
}

function place(level, group, x, y, bounds) {
  const box = bounds || groupBounds(level, group);
  group.x = limit(x, EDGE - box[0], WIDTH - EDGE - box[2]);
  group.y = limit(y, EDGE - box[1], HEIGHT - EDGE - box[3]);
}

function areNeighbors(level, a, b) {
  return level.seams.some(function (seam) {
    const x = seam.ids[0], y = seam.ids[1];
    return (a.ids.includes(x) && b.ids.includes(y)) || (a.ids.includes(y) && b.ids.includes(x));
  });
}

function bestMatch(level, groups, group, tolerance) {
  let best = null;
  let closest = tolerance;
  for (const other of groups) {
    if (other === group || other.turn !== group.turn) continue;
    // Equal transforms align every point on the two pieces' shared fracture.
    const distance = Math.hypot(other.x - group.x, other.y - group.y);
    if (distance <= closest && areNeighbors(level, group, other)) {
      best = other;
      closest = distance;
    }
  }
  return best;
}

function matchNearby(level, groups, moved) {
  let target = bestMatch(level, groups, moved, level.snapDistance);
  if (!target) return false;
  moved.x = target.x;
  moved.y = target.y;
  do {
    moved.ids.push.apply(moved.ids, target.ids);
    groups.splice(groups.indexOf(target), 1);
    // A second join must already be close to the first join's exact pose.
    target = bestMatch(level, groups, moved, level.snapDistance * 0.57);
  } while (target);
  return true;
}

function makeGame(level, random) {
  const ids = level.shards.map(function (_, id) { return id; });
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const item = ids[i];
    ids[i] = ids[j];
    ids[j] = item;
  }
  const rotated = new Set(ids.filter(id => id < level.realCount).slice(0, level.rotateCount));
  const groups = ids.map(function (id) {
    return { ids: [id], x: 0, y: 0, turn: rotated.has(id) ? 1 + Math.floor(random() * 3) : 0 };
  });
  const numbers = [];
  ids.forEach((id, index) => { numbers[id] = (level.realCount < ids.length ? index : id) + 1; });
  arrange(level, groups, random);
  return { groups, numbers, elapsed: 0 };
}

function arrange(level, groups, random) {
  const arranged = groups.map(function (group) {
    const box = groupBounds(level, group);
    return { group, box, area: (box[2] - box[0]) * (box[3] - box[1]) };
  });
  arranged.sort(function (a, b) { return b.area - a.area; });
  const filled = [];
  for (const item of arranged) {
    const box = item.box;
    let best = null;
    for (let i = 0; i < (groups.length > 24 ? 70 : 140); i++) {
      const x = EDGE - box[0] + random() * (WIDTH - EDGE * 2 + box[0] - box[2]);
      const y = EDGE - box[1] + random() * (HEIGHT - EDGE * 2 + box[1] - box[3]);
      const rect = [box[0] + x, box[1] + y, box[2] + x, box[3] + y];
      const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
      let closest = Infinity;
      let covering = 0;
      for (const earlier of filled) {
        closest = Math.min(closest, Math.hypot(cx - earlier.cx, cy - earlier.cy));
        covering += overlap(rect, earlier.rect);
      }
      const score = covering - (filled.length ? closest * 0.31 : 0) + random() * 12;
      if (!best || score < best.score) best = { x, y, cx, cy, rect, score };
    }
    item.group.x = best.x;
    item.group.y = best.y;
    filled.push(best);
  }
}

function complete(group, level) {
  return group.ids.length === level.realCount && group.ids.every(id => id < level.realCount);
}

function validGame(game, level) {
  if (!game || !Array.isArray(game.groups) || !game.groups.length) return false;
  const ids = new Set();
  for (const group of game.groups) {
    if (!group || !Array.isArray(group.ids) || !group.ids.length ||
        !Number.isFinite(group.x) || !Number.isFinite(group.y) ||
        !Number.isInteger(group.turn) || group.turn < 0 || group.turn > 3) return false;
    for (const id of group.ids) {
      if (!Number.isInteger(id) || id < 0 || id >= level.shards.length || ids.has(id)) return false;
      if (id >= level.realCount && (group.ids.length !== 1 || group.turn !== 0)) return false;
      ids.add(id);
    }
  }
  return ids.size === level.shards.length || (game.groups.length === 1 && complete(game.groups[0], level));
}

class Puzzle {
  constructor(level, saved, random = Math.random) {
    this.level = level;
    this.random = random;
    this.newBoard = !validGame(saved, level);
    this.state = this.newBoard ? makeGame(level, random) : {
      groups: saved.groups,
      numbers: saved.numbers || level.shards.map((_, index) => index + 1),
      elapsed: Number.isFinite(saved.elapsed) ? Math.max(0, saved.elapsed) : 0,
    };
    this.selected = null;
    this.hint = [];
    for (const group of this.state.groups) place(this.level, group, group.x, group.y);
  }

  get phase() {
    return this.state.groups.length === 1 && complete(this.state.groups[0], this.level) ? 'stored' : 'fit';
  }

  hit(x, y) {
    const groups = this.state.groups;
    for (let i = groups.length - 1; i >= 0; i--) {
      const group = groups[i];
      const local = rotatePoint((x - group.x) / SCALE, (y - group.y) / SCALE, (4 - group.turn) % 4);
      const lx = local[0], ly = local[1];
      if (!this.level.cutout && !polygonContains(this.level.outline, lx, ly)) continue;
      for (const id of group.ids) {
        const shard = this.level.shards[id], box = shard.box;
        if (lx >= box[0] && ly >= box[1] && lx <= box[2] && ly <= box[3] && shardContains(shard, lx, ly)) return group;
      }
    }
    return null;
  }

  select(group) {
    const groups = this.state.groups;
    groups.splice(groups.indexOf(group), 1);
    groups.push(group);
    this.selected = group;
    if (!this.hint.includes(group)) this.hint = [];
  }

  dragTo(group, x, y, bounds) {
    place(this.level, group, x, y, bounds);
  }

  finishMove(group) {
    if (!matchNearby(this.level, this.state.groups, group)) return false;
    this.hint = [];
    if (complete(group, this.level)) {
      this.state.groups.splice(0, this.state.groups.length, group);
      this.selected = null;
    }
    return true;
  }

  rearrange() {
    if (this.phase === 'stored') return;
    arrange(this.level, this.state.groups, this.random);
    this.selected = null;
    this.hint = [];
  }

  turnSelected() {
    const group = this.selected;
    if (!this.canRotate) return false;
    const old = groupBounds(this.level, group);
    const cx = group.x + (old[0] + old[2]) / 2, cy = group.y + (old[1] + old[3]) / 2;
    group.turn = (group.turn + 1) % 4;
    const box = groupBounds(this.level, group);
    place(this.level, group, cx - (box[0] + box[2]) / 2, cy - (box[1] + box[3]) / 2, box);
    return this.finishMove(group);
  }

  get canRotate() {
    return this.level.rotateCount > 0 && this.phase === 'fit' &&
      Boolean(this.selected && this.selected.ids[0] < this.level.realCount);
  }

  findNeighbors() {
    const groups = this.state.groups;
    let best = null;
    let alternative = null;
    for (const a of this.selected ? [this.selected] : groups) {
      for (const b of groups) {
        if (a === b || !areNeighbors(this.level, a, b)) continue;
        const pair = { a, b, distance: Math.hypot(a.x - b.x, a.y - b.y) };
        if (!best || pair.distance < best.distance) best = pair;
        if ((!this.hint.includes(a) || !this.hint.includes(b)) &&
            (!alternative || pair.distance < alternative.distance)) alternative = pair;
      }
    }
    const pair = alternative || best;
    if (!pair) return null;
    this.hint = [pair.a, pair.b];
    return pair;
  }
}

module.exports = { Puzzle, WIDTH, HEIGHT, SCALE, groupBounds, areNeighbors, matchNearby, rotatePoint };
