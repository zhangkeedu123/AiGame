'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const localConfig = path.join(root, 'appids.local.json');
const ids = fs.existsSync(localConfig) ? JSON.parse(fs.readFileSync(localConfig, 'utf8')) : {};
const all = ['wechat', 'douyin'];
const target = process.argv[2];
if (target && !all.includes(target)) {
  console.error('使用方式：node scripts/build.js [wechat|douyin]');
  process.exit(1);
}

for (const name of target ? [target] : all) {
  const output = path.join(root, 'dist', name);
  const template = path.join(root, 'platforms', name);
  fs.mkdirSync(output, { recursive: true });
  for (const directory of ['core', 'platform', 'assets']) {
    fs.rmSync(path.join(output, directory), { force: true, recursive: true });
  }
  fs.cpSync(path.join(root, 'src'), output, { recursive: true, force: true });
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
  console.log('已生成 ' + path.relative(root, output));
}
