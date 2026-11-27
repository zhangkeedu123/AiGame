'use strict';
const { createPlatform } = require('./platform/mini-game.js');
const { apiUrl, env } = require('./platform/online-config.js');
require('./main.js').start(createPlatform(wx, apiUrl, env, 'wechat'));
