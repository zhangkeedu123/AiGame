'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src');
const preview = path.join(root, 'preview');
const port = process.argv[2] === undefined ? 4173 : Number(process.argv[2]);
const host = '127.0.0.1';

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
  '.webp': 'image/webp', '.ttf': 'font/ttf' };

function answer(response, status, type, content) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(content);
}

const server = http.createServer((request, response) => {
  try {
    const pathname = new URL(request.url, 'http://' + host).pathname;
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
    console.log('保存 src 中的修改后刷新浏览器。按 Ctrl+C 停止预览。');
  });
}
