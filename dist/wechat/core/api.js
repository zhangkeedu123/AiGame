'use strict';

// 金缮夜馆后端的最小客户端：统一拼地址、带令牌、超时、错误归一化。
// 传输层由 platform.request 提供（小程序用 wx/tt.request，预览页用 fetch）。

const TIMEOUT = 12000;

function fail(message, status, detail) {
  const error = new Error(message);
  error.status = status;
  error.detail = detail;
  return error;
}

function describe(body, status) {
  if (body && typeof body === 'object') {
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail) && body.detail.length) {
      const first = body.detail[0];
      return (first.loc ? first.loc.join('.') + '：' : '') + (first.msg || '参数不合法');
    }
  }
  if (typeof body === 'string' && body && body.length < 200) return body;
  return '请求失败（HTTP ' + status + '）';
}

function createApi(platform, options) {
  const base = String(options.apiBase || '').replace(/\/+$/, '');
  const token = options.playerToken || (platform.read && platform.read('jinyao-token-v1')) || '';
  const timeout = options.timeout || TIMEOUT;
  let available = typeof platform.request === 'function';

  function send(method, path, payload) {
    if (!available) return Promise.reject(fail('当前环境不支持网络请求', 0));
    const header = {};
    if (token) header.Authorization = 'Bearer ' + token;
    let settled = false;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(fail('请求超时', 0));
      }, timeout);
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error instanceof Error ? error : fail(String(error), 0));
        else resolve(value);
      };
      try {
        platform.request({
          url: base + path,
          method,
          header,
          data: payload,
          success(response) {
            const status = response.statusCode || response.status || 0;
            let body = response.data !== undefined ? response.data : response.body;
            if (typeof body === 'string') {
              try { body = JSON.parse(body); } catch (_) { /* 保留原始文本，便于报错。 */ }
            }
            if (status >= 200 && status < 300) finish(null, { status, body });
            else finish(fail(describe(body, status), status, body));
          },
          fail(error) {
            finish(fail((error && (error.errMsg || error.message)) || '网络不可用', 0));
          },
        });
      } catch (error) {
        finish(error);
      }
    });
  }

  return {
    base,
    token,
    get enabled() { return available; },
    get(path) { return send('GET', path).then(result => result.body); },
    put(path, payload) { return send('PUT', path, payload).then(result => result.body); },
    post(path, payload) { return send('POST', path, payload).then(result => result.body); },
    health() { return this.get('/health'); },
    levels() { return this.get('/api/v1/levels'); },
    level(id) { return this.get('/api/v1/levels/' + id); },
    me() { return this.get('/api/v1/me'); },
    login() { return this.post('/api/v1/me/login'); },
    progress() { return this.get('/api/v1/me/progress'); },
    saveProgress(levelId, payload) { return this.put('/api/v1/me/progress/' + levelId, payload); },
  };
}

module.exports = { createApi };
