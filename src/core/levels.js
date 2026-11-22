'use strict';

const geometry = require('./geometry.js');

const names = [
  ['一叶知青', '入门', '三片墨叶落在温润的青釉上。', 0],
  ['丹霞入盏', '初阶', '橘红山脊层层叠叠，像落日照在砂岩上。', 0],
  ['云鹤栖白', '进阶', '青鹤掠过云纹，歇在象牙白釉之间。', 1],
  ['沧月听潮', '熟练', '月色落进靛蓝釉面，一道长潮绕瓶而行。', 2],
  ['翡翠听竹', '精修', '一丛青竹在折面上转折，竹叶间藏着金屑。', 3],
  ['曜夜星图', '镇馆', '把夜空收进黑釉，让散落的星座重新相连。', 3],
];

module.exports = names.map(function (entry, i) {
  return Object.assign({}, geometry[i], {
    name: entry[0],
    difficulty: entry[1],
    story: entry[2],
    rotations: entry[3],
    snapDistance: i < 2 ? 15 : i < 4 ? 13 : 11,
    duration: (90 + geometry[i].shards.length * 12) * 1000,
  });
});
