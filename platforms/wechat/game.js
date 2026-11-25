'use strict';
const { createPlatform } = require('./platform/mini-game.js');
const { adUnitId } = require('./platform/reward-config.js');
const { apiUrl, env } = require('./platform/online-config.js');
require('./main.js').start(createPlatform(wx, adUnitId, apiUrl, env));
