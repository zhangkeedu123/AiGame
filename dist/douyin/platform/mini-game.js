'use strict';

function optional(api, name) {
  try { return typeof api[name] === 'function' ? api[name]() : null; }
  catch (_) { return null; }
}

function createPlatform(api) {
  const canvas = api.createCanvas();
  let fontFamily = '';
  try { if (typeof api.loadFont === 'function') fontFamily = api.loadFont('assets/jinyao-ui.ttf') || ''; }
  catch (_) { /* System fonts remain available. */ }
  let fs;
  function bind(name, listener) {
    if (typeof api[name] === 'function') api[name](listener);
  }

  function observeTouch(name, type, listener) {
    bind(name, event => {
      const points = event.changedTouches && event.changedTouches.length ? event.changedTouches :
        type === 'start' || type === 'move' ? event.touches : [];
      if ((!points || !points.length) && (type === 'end' || type === 'cancel')) {
        listener(type, null);
        return;
      }
      for (let i = 0; points && i < points.length; i++) {
        const touch = points[i];
        const x = Number.isFinite(touch.clientX) ? touch.clientX : touch.screenX;
        const y = Number.isFinite(touch.clientY) ? touch.clientY : touch.screenY;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          listener(type, { id: touch.identifier === undefined ? 0 : touch.identifier, x, y });
        }
      }
    });
  }

  function loadImage(path, success, failure) {
    let fallback = false;
    function attempt(src) {
      const image = api.createImage();
      function ready() { success(image); }
      function failed() {
        if (fallback) { failure(path); return; }
        fallback = true;
        try {
          fs = fs || optional(api, 'getFileSystemManager');
          if (!fs) { failure(path); return; }
          const base64 = fs.readFileSync(path, 'base64');
          attempt('data:image/png;base64,' + base64);
        } catch (_) { failure(path); }
      }
      if (typeof image.addEventListener === 'function') {
        image.addEventListener('load', ready);
        image.addEventListener('error', failed);
      } else {
        image.onload = ready;
        image.onerror = failed;
      }
      try { image.src = src; } catch (_) { failed(); }
    }
    try { attempt(path); } catch (_) { failure(path); }
  }

  return {
    canvas,
    fontFamily,
    windowInfo() {
      const info = optional(api, 'getWindowInfo') || optional(api, 'getSystemInfoSync') || {};
      const menu = optional(api, 'getMenuButtonBoundingClientRect') || optional(api, 'getMenuButtonLayout');
      return {
        width: info.windowWidth || info.screenWidth || canvas.width || 360,
        height: info.windowHeight || info.screenHeight || canvas.height || 640,
        ratio: info.pixelRatio || 1,
        safeArea: info.safeArea,
        statusBarHeight: info.statusBarHeight || 0,
        menuBottom: menu ? (Number.isFinite(menu.bottom) ? menu.bottom : (menu.top || 0) + (menu.height || 0)) : 0,
      };
    },
    loadImage,
    onInput(listener) {
      observeTouch('onTouchStart', 'start', listener);
      observeTouch('onTouchMove', 'move', listener);
      observeTouch('onTouchEnd', 'end', listener);
      observeTouch('onTouchCancel', 'cancel', listener);
    },
    onResize(listener) { bind('onWindowResize', listener); },
    onShow(listener) { bind('onShow', listener); },
    onHide(listener) { bind('onHide', listener); },
    read(key) {
      try {
        const data = api.getStorageSync(key);
        return typeof data === 'string' ? JSON.parse(data) : data;
      } catch (_) { return null; }
    },
    write(key, value) {
      try { api.setStorageSync(key, JSON.stringify(value)); }
      catch (error) { console.warn('金缮夜馆存档失败', error); }
    },
    frame(callback) {
      if (typeof canvas.requestAnimationFrame === 'function') canvas.requestAnimationFrame(callback);
      else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
      else setTimeout(callback, 16);
    },
  };
}

module.exports = { createPlatform };
