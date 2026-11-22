'use strict';

const DAY = 86400000;

function dailyEdition(now, count) {
  const day = Math.floor((now + 8 * 3600000) / DAY);
  return { date: new Date(day * DAY).toISOString().slice(0, 10), day, index: day % count };
}

function dailyRandom(day) {
  let state = day >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function formatTime(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

module.exports = { dailyEdition, dailyRandom, formatTime };
