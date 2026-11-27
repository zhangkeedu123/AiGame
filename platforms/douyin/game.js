'use strict';
const { createPlatform } = require('./platform/mini-game.js');
const { apiUrl, env } = require('./platform/online-config.js');
require('./main.js').start(createPlatform(tt, apiUrl, env, 'douyin'));
