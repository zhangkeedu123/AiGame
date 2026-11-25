'use strict';

// 后台环境解析：dev = 本机 FastAPI，master = 服务器上已发布的一套。
// 地址只写在 appids.local.json（不入库），示例见 appids.example.json。
const fs = require('node:fs');
const path = require('node:path');

const ENVS = {
  dev: { label: '开发环境', hint: '本机 FastAPI（127.0.0.1:8000）' },
  master: { label: '线上环境', hint: '服务器已发布接口' },
};

function readLocalConfig(root) {
  const file = path.join(root, 'appids.local.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : {};
}

function envNames() {
  return Object.keys(ENVS);
}

function defaultEnv(config) {
  if (config && ENVS[config.env]) return config.env;
  return 'dev';
}

// 收集每个环境的根地址。兼容旧配置里只写一个 apiUrl 的写法。
function envMap(config) {
  const urls = {};
  const table = config && config.apiUrls;
  if (table && typeof table === 'object') {
    for (const name of envNames()) {
      const value = table[name];
      if (typeof value === 'string' && value.trim()) urls[name] = value.trim();
    }
  }
  if (config && typeof config.apiUrl === 'string' && config.apiUrl.trim()) {
    const name = defaultEnv(config);
    if (!urls[name]) urls[name] = config.apiUrl.trim();
  }
  return urls;
}

function originOf(raw, name) {
  let url;
  try { url = new URL(raw); } catch (_) { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' ||
      url.search || url.hash || url.username || url.password) {
    throw new Error('appids.local.json 的 apiUrls.' + name + ' 必须是 HTTP/HTTPS 根地址，不能带路径、查询参数或账号信息');
  }
  return url.origin;
}

// 解析环境：name 省略时用配置里的 env，再缺省为 dev。
// API_ORIGIN 环境变量可强制指定地址（部署时用，仓库里不放本机配置）。
// 该环境没配地址时 apiUrl='' ，表示这个环境不接后台。
function resolveEnv(config, name) {
  const urls = envMap(config);
  const env = ENVS[name] ? name : defaultEnv(config);
  const forced = (process.env.API_ORIGIN || '').trim();
  const raw = forced || urls[env];
  const apiUrl = typeof raw === 'string' && raw.trim() ? originOf(raw.trim(), env) : '';
  return { env, label: ENVS[env].label, hint: ENVS[env].hint, apiUrl, urls };
}

function readApiOrigin(config, miniGame = false) {
  const env = resolveEnv(config);
  if (miniGame && env.apiUrl.startsWith('http://')) {
    const host = new URL(env.apiUrl).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      console.warn('[提示] ' + env.env + ' 用的是 HTTP 地址 ' + env.apiUrl +
        '，真机需要 HTTPS；开发者工具里请勾选「不校验合法域名」。');
    }
  }
  return env.apiUrl;
}

// 预览页 / 构建日志用：一次给出可用环境清单和当前环境。
function describe(config, name) {
  const env = resolveEnv(config, name);
  const urls = envMap(config);
  return {
    name: env.env,
    label: env.label,
    apiUrl: env.apiUrl,
    envs: envNames().map(key => ({
      name: key, label: ENVS[key].label, hint: ENVS[key].hint, apiUrl: urls[key] || '',
    })),
  };
}

module.exports = { ENVS, envNames, defaultEnv, envMap, resolveEnv, readApiOrigin, describe, readLocalConfig };
