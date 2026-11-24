'use strict';

// 把后台的已发布关卡转成客户端认识的关卡对象。
// 字段与 core/levels.js 保持一致，多出来的 remoteId 用于回写存档。

function duration(shards) {
  return (90 + shards.length * 12) * 1000;
}

function toLevel(detail) {
  return {
    image: detail.image,
    poster: detail.poster,
    outline: detail.outline,
    shards: detail.shards.map(shard => ({
      cx: shard.cx, cy: shard.cy, box: shard.box, poly: shard.poly, sprite: shard.sprite,
    })),
    seams: detail.seams,
    points: detail.points,
    name: detail.name,
    difficulty: detail.difficulty,
    story: detail.story,
    rotations: detail.rotations,
    snapDistance: detail.snapDistance,
    duration: duration(detail.shards),
    remoteId: detail.id,
    sortOrder: detail.sort_order,
  };
}

async function loadLevels(api) {
  const list = await api.levels();
  if (!Array.isArray(list) || !list.length) return null;
  const details = await Promise.all(
    list.map(row => api.level(row.id).then(detail => detail, () => null)),
  );
  const levels = details
    .filter(detail => detail && Array.isArray(detail.shards) && detail.shards.length)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(toLevel);
  return levels.length ? levels : null;
}

module.exports = { loadLevels, toLevel };
