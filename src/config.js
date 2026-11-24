'use strict';

// 后端环境。dev 指本机 FastAPI（python -m uvicorn，127.0.0.1:8000），
// master 指服务器上已发布的一套（139.196.161.33:8000）。
// 令牌只用于联调：正式包应换成微信/抖音登录换取的令牌，不要把明文打进包里。
const environments = {
  dev: {
    label: '开发环境',
    apiBase: 'http://127.0.0.1:8000',
    playerToken: 'v9lIFZbDp8ZOm51n3NMUeKYjlm0TaQOkHVmCNA_tUIM',
  },
  master: {
    label: '线上环境',
    apiBase: 'http://139.196.161.33:8000',
    playerToken: 'qTQ-QTatM_RJfMgA_8oadFoh8dV2yiC_HthdhLQXo5g',
  },
};

// 默认连线上；预览页可以用 ?env=dev 临时切到本机后端。
const defaultEnv = 'master';

// 运行时选择的键，写在平台本地存储里，下次启动继续用上次的环境。
const ENV_KEY = 'jinyao-env-v1';

function resolve(platform) {
  const stored = platform && platform.read ? platform.read(ENV_KEY) : null;
  const hint = platform && platform.envHint;
  const name = [hint, stored].find(value => value && environments[value]) || defaultEnv;
  const env = environments[name];
  return { name, label: env.label, apiBase: env.apiBase, playerToken: env.playerToken };
}

module.exports = { environments, defaultEnv, ENV_KEY, resolve };
