'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { readLocalConfig, describe } = require('./api-origin.js');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src');
const preview = path.join(root, 'preview');
const argv = process.argv.slice(2);
const envFlag = argv.indexOf('--env');
const envArg = envFlag >= 0 ? (argv[envFlag + 1] || '') : '';
const rest = argv.filter((item, index) => !item.startsWith('--') && (envFlag < 0 || index !== envFlag + 1));
const port = rest[0] === undefined ? 4173 : Number(rest[0]);
// 第二个参数传 0.0.0.0 可让同一局域网的手机访问；默认只监听本机。
const host = rest[1] === undefined ? '127.0.0.1' : rest[1];
// 走 dev 还是 master 由 appids.local.json 的 env 决定（可用 --env 临时覆盖），
// 页面上不再提供切换入口。
const backend = describe(readLocalConfig(root), envArg);
const apiOrigin = backend.apiUrl;

function moduleId(file) {
  return path.relative(source, file).split(path.sep).join('/');
}

function bundle() {
  const modules = new Map();

  function visit(file) {
    const id = moduleId(file);
    if (modules.has(id)) return;
    const code = fs.readFileSync(file, 'utf8');
    const imports = Object.create(null);
    modules.set(id, { code, imports });
    for (const [, request] of code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!request.startsWith('./') && !request.startsWith('../')) {
        throw new Error(id + ' 引用了浏览器预览不支持的模块 ' + request);
      }
      const resolved = require.resolve(path.resolve(path.dirname(file), request));
      if (!resolved.startsWith(source + path.sep) || path.extname(resolved) !== '.js') {
        throw new Error(id + ' 只能引用 src 内的 JavaScript 模块：' + request);
      }
      imports[request] = moduleId(resolved);
      visit(resolved);
    }
  }

  visit(path.join(source, 'main.js'));
  const definitions = Array.from(modules, ([id, { code, imports }]) =>
    JSON.stringify(id) + ':[function(require,module,exports){\n' + code + '\n},' + JSON.stringify(imports) + ']'
  ).join(',\n');

  return `(function () {
  'use strict';
  const modules = {${definitions}};
  const cache = Object.create(null);
  function load(id) {
    if (cache[id]) return cache[id].exports;
    const definition = modules[id];
    if (!definition) throw new Error('找不到游戏模块：' + id);
    const [factory, imports] = definition;
    const module = { exports: {} };
    cache[id] = module;
    factory(function (request) {
      const target = imports[request];
      if (!target) throw new Error(id + ' 无法引用模块：' + request);
      return load(target);
    }, module, module.exports);
    return module.exports;
  }
  window.startJinyao = load('main.js').start;
}());`;
}

const staticFiles = new Map([
  ['/', [path.join(preview, 'index.html'), 'text/html; charset=utf-8']],
  ['/preview/browser.js', [path.join(preview, 'browser.js'), 'text/javascript; charset=utf-8']],
]);
const assetTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ttf': 'font/ttf', '.wav': 'audio/wav' };

function answer(response, status, type, content) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(content);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://' + host);
    const pathname = url.pathname;
    if (pathname === '/online-enabled') {
      answer(response, 200, 'application/json', JSON.stringify({
        enabled: Boolean(apiOrigin),
        env: backend.name,
        label: backend.label,
        apiUrl: apiOrigin,
      }));
      return;
    }
    if (/^\/online\/api\/v1\/(levels(?:\/[a-f0-9-]{36}(?:\/atlas\.png)?)?|me|me\/(?:guest|login|progress(?:\/[a-f0-9-]{36})?))$/.test(pathname)) {
      if (!apiOrigin) {
        answer(response, 503, 'application/json', JSON.stringify({ detail: '未配置后台地址' }));
        return;
      }
      const headers = { 'Content-Type': 'application/json' };
      if (request.headers.authorization) headers.Authorization = request.headers.authorization;
      const upstream = await fetch(new URL(pathname.slice(7) + url.search, apiOrigin), {
        method: request.method, headers, redirect: 'error', signal: AbortSignal.timeout(15000),
        ...(['PUT', 'POST', 'PATCH'].includes(request.method) ? { body: request, duplex: 'half' } : {}),
      });
      answer(response, upstream.status, upstream.headers.get('content-type') || 'application/octet-stream',
        Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    if (pathname === '/preview/game.js') {
      answer(response, 200, 'text/javascript; charset=utf-8', bundle());
      return;
    }
    let target = staticFiles.get(pathname);
    if (!target && /^\/assets\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(pathname)) {
      const type = assetTypes[path.extname(pathname)];
      if (type) target = [path.join(source, pathname.slice(1)), type];
    }
    if (!target || !fs.existsSync(target[0])) {
      answer(response, 404, 'text/plain; charset=utf-8', '找不到预览资源');
      return;
    }
    answer(response, 200, target[1], fs.readFileSync(target[0]));
  } catch (error) {
    console.error(error);
    answer(response, 500, 'text/plain; charset=utf-8', error.message);
  }
});

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('端口必须是 1 到 65535 之间的整数。');
  process.exitCode = 1;
} else {
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') console.error('端口已占用。请试试 node scripts/preview.js 4174');
    else console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log('金缮夜馆预览  http://' + host + ':' + port);
    console.log('后台环境 ' + backend.name + '（' + backend.label + '）→ ' + (apiOrigin || '未配置'));
    console.log('要换环境请改 appids.local.json 的 env（dev / master）后重启预览。');
    console.log('保存 src 中的修改后刷新浏览器。按 Ctrl+C 停止预览。');
  });
}
