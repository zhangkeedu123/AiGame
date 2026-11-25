'use strict';

// 给朋友试玩用的公开服务：固定连线上后台，监听 0.0.0.0:$PORT。
// 仓库里不放 appids.local.json，所以这里用环境变量把地址固定住；
// 浏览器只访问本站的 /online/*，由服务端代理到后台，避免 HTTPS 页面直连 HTTP 接口被拦。
process.env.API_ORIGIN = process.env.API_ORIGIN || 'http://139.196.161.33:8000';
process.env.HOST = process.env.HOST || '0.0.0.0';

require('./preview.js');
