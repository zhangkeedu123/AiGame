'use strict';

const artworks = require('./levels.js');
const { dailyRandom } = require('./daily.js');

const modes = {
  normal: { name: '普通模式', limit: 10, first: 5, increase: 5, rotations: 0, seed: 11 },
  hard: { name: '困难模式', limit: 20, first: 20, increase: 2, rotations: 3, seed: 41 },
  extreme: { name: '极难模式', limit: Infinity, first: 30, increase: 1, rotations: 3, seed: 79 },
};

function bounds(poly) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < poly.length; i += 2) {
    box[0] = Math.min(box[0], poly[i]);
    box[1] = Math.min(box[1], poly[i + 1]);
    box[2] = Math.max(box[2], poly[i]);
    box[3] = Math.max(box[3], poly[i + 1]);
  }
  return box;
}

function polygonContains(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const ax = poly[i], ay = poly[i + 1], bx = poly[j], by = poly[j + 1];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function shape(poly) {
  const box = bounds(poly);
  let area = 0, x = 0, y = 0;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const cross = poly[j] * poly[i + 1] - poly[i] * poly[j + 1];
    area += cross;
    x += (poly[j] + poly[i]) * cross;
    y += (poly[j + 1] + poly[i + 1]) * cross;
  }
  return { poly, box, area: Math.abs(area / 2), cx: x / (3 * area), cy: y / (3 * area) };
}

function positionBadge(piece) {
  if (polygonContains(piece.poly, piece.cx, piece.cy)) return;
  const [left, top, right, bottom] = piece.box;
  let nearest = Infinity;
  let point;
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 12; col++) {
      const x = left + (col + 0.5) * (right - left) / 12;
      const y = top + (row + 0.5) * (bottom - top) / 12;
      const distance = Math.hypot(x - piece.cx, y - piece.cy);
      if (distance < nearest && polygonContains(piece.poly, x, y)) {
        nearest = distance;
        point = [x, y];
      }
    }
  }
  if (point) [piece.cx, piece.cy] = point;
}

function clip(poly, axis, cut, side) {
  const result = [];
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const a = poly[j + axis], b = poly[i + axis];
    const inside = side * (b - cut) >= 0;
    if (inside !== (side * (a - cut) >= 0)) {
      const other = 1 - axis;
      const t = (cut - a) / (b - a);
      const value = poly[j + other] + t * (poly[i + other] - poly[j + other]);
      result.push(axis ? value : cut, axis ? cut : value);
    }
    if (inside) result.push(poly[i], poly[i + 1]);
  }
  return result;
}

function partition(outline, count, random) {
  const pieces = [shape(outline)];
  while (pieces.length < count) {
    pieces.sort((a, b) => b.area - a.area);
    const piece = pieces.shift();
    const b = piece.box;
    const axis = b[2] - b[0] > b[3] - b[1] ? 0 : 1;
    const cut = b[axis] + (b[axis + 2] - b[axis]) * (0.43 + random() * 0.14);
    pieces.push(shape(clip(piece.poly, axis, cut, -1)), shape(clip(piece.poly, axis, cut, 1)));
  }
  pieces.forEach(positionBadge);
  return pieces.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
}

function intervals(poly, axis, cut) {
  const along = 1 - axis;
  const segments = [];
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    if (poly[i + axis] === cut && poly[j + axis] === cut) {
      segments.push([Math.min(poly[i + along], poly[j + along]), Math.max(poly[i + along], poly[j + along])]);
    }
  }
  return segments;
}

function seamsFor(shards) {
  const seams = [];
  shards.forEach((a, i) => {
    for (let j = i + 1; j < shards.length; j++) {
      const b = shards[j];
      for (const axis of [0, 1]) {
        const cut = a.box[axis + 2] === b.box[axis] ? b.box[axis]
          : b.box[axis + 2] === a.box[axis] ? a.box[axis] : null;
        if (cut === null) continue;
        for (const [a1, a2] of intervals(a.poly, axis, cut)) {
          for (const [b1, b2] of intervals(b.poly, axis, cut)) {
            const from = Math.max(a1, b1), to = Math.min(a2, b2);
            if (to - from > 0.01) seams.push({ ids: [i, j], poly: axis ? [from, cut, to, cut] : [cut, from, cut, to] });
          }
        }
      }
    }
  });
  return seams;
}

function modeLevel(mode, index) {
  const rules = modes[mode];
  const random = dailyRandom((Math.imul(index, 32771) + rules.seed) >>> 0);
  const artwork = artworks[index % artworks.length];
  const realCount = Math.min(64, rules.first + index * rules.increase);
  const real = partition(artwork.outline, realCount, random);
  const decoyArt = mode === 'extreme' ? artworks[(index + 1) % artworks.length] : null;
  const decoys = decoyArt ? partition(decoyArt.outline, realCount, random)
    .slice(0, Math.min(12, 4 + Math.floor(index / 3))) : [];
  return {
    ...artwork,
    difficulty: rules.name,
    rotations: rules.rotations,
    snapDistance: mode === 'normal' ? 15 : mode === 'hard' ? 12 : 10,
    duration: (60 + realCount * (mode === 'normal' ? 12 : 16)) * 1000,
    realCount,
    procedural: true,
    decoyArt,
    shards: real.concat(decoys),
    seams: seamsFor(real),
  };
}

module.exports = { modes, modeLevel, polygonContains };
