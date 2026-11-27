'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readLocalConfig, resolveEnv, envNames } = require('./api-origin.js');

const root = path.resolve(__dirname, '..');
const ids = readLocalConfig(root);
const all = ['wechat', 'douyin'];

// 用法：node scripts/build.js [wechat|douyin] [--env dev|master]
// 不传 --env 时用 appids.local.json 里的 env（缺省 dev）。
const argv = process.argv.slice(2);
const envFlag = argv.indexOf('--env');
const envArg = envFlag >= 0 ? (argv[envFlag + 1] || '') : '';
if (envFlag >= 0 && !envNames().includes(envArg)) {
  console.error('--env 只能是 ' + envNames().join(' 或 ') + '，例如：node scripts/build.js --env master');
  process.exit(1);
}
const target = argv.find((item, index) => !item.startsWith('--') && (envFlag < 0 || index !== envFlag + 1));
const env = resolveEnv(ids, envArg);
if (target && !all.includes(target)) {
  console.error('使用方式：node scripts/build.js [wechat|douyin] [--env dev|master]');
  process.exit(1);
}
if (!env.apiUrl) {
  console.warn('[提示] ' + env.env + ' 环境没有配置 apiUrl，构建出来的包不接后台。');
} else if (env.apiUrl.startsWith('http://')) {
  const host = new URL(env.apiUrl).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    console.warn('[提示] ' + env.env + ' 用的是 HTTP 地址 ' + env.apiUrl +
      '，真机需要 HTTPS；开发者工具里请勾选「不校验合法域名」。');
  }
}

for (const name of target ? [target] : all) {
  const output = path.join(root, 'dist', name);
  const template = path.join(root, 'platforms', name);
  fs.mkdirSync(output, { recursive: true });
  for (const directory of ['core', 'platform', 'assets']) {
    fs.rmSync(path.join(output, directory), { force: true, recursive: true });
  }
  fs.cpSync(path.join(root, 'src'), output, {
    recursive: true, force: true,
    filter: source => !/^(?:vase-\d+\.png|sound-timeout\.wav)$/.test(path.basename(source)),
  });
  fs.writeFileSync(path.join(output, 'platform', 'online-config.js'),
    "'use strict';\nmodule.exports = " +
    JSON.stringify({ env: env.env, label: env.label, apiUrl: env.apiUrl }) + ';\n', 'utf8');
  fs.copyFileSync(path.join(template, 'game.js'), path.join(output, 'game.js'));
  fs.copyFileSync(path.join(root, 'platforms', 'game.json'), path.join(output, 'game.json'));

  const configPath = path.join(output, 'project.config.json');
  const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const defaults = JSON.parse(fs.readFileSync(path.join(template, 'project.config.json'), 'utf8'));
  const config = Object.assign({}, existing, defaults);
  config.setting = Object.assign({}, defaults.setting, existing.setting);
  const localAppId = typeof ids[name] === 'string' ? ids[name].trim() : '';
  if (localAppId || existing.appid) config.appid = localAppId || existing.appid;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log('已生成 ' + path.relative(root, output) + '（' + env.env + ' → ' + (env.apiUrl || '不接后台') + '）');
}
