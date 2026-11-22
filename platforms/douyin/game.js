'use strict';
const { createPlatform } = require('./platform/mini-game.js');
const { adUnitId } = require('./platform/reward-config.js');
require('./main.js').start(createPlatform(tt, adUnitId));
