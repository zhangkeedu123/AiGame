'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readLocalConfig(root) {
  const file = path.join(root, 'appids.local.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : {};
}

function readApiOrigin({ apiUrl = '' }, miniGame = false) {
  const invalid = () => new Error('appids.local.json 的 apiUrl 必须为 HTTP 或 HTTPS 根地址，不能含路径、查询参数或账号信息');
  if (typeof apiUrl !== 'string') throw invalid();
  if (!apiUrl.trim()) return '';
  let url;
  try { url = new URL(apiUrl.trim()); } catch (_) { throw invalid(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' ||
      url.search || url.hash || url.username || url.password) throw invalid();
  if (miniGame && url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('小游戏 API 地址请使用 HTTPS；仅本机开发允许 HTTP 环回地址');
  }
  return url.origin;
}

module.exports = { readLocalConfig, readApiOrigin };
