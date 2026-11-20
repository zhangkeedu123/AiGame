'use strict';

(function () {
  const canvas = document.querySelector('#game');
  const errorBox = document.querySelector('#error');
  const savePrefix = 'jinyao-preview:';
  const savedKey = 'jinyao-museum-v2';
  let resettingSave = false;

  function showError(error) {
    errorBox.hidden = false;
    errorBox.textContent = '预览启动失败。请检查浏览器 Console 和启动预览的终端。\n' + (error.message || error);
  }

  function makeInput(listener) {
    let captured = null;
    function touch(event) {
      const rect = canvas.getBoundingClientRect();
      return { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || captured !== null) return;
      captured = event.pointerId;
      canvas.setPointerCapture(captured);
      listener('start', touch(event));
    });
    canvas.addEventListener('pointermove', event => {
      if (event.pointerId === captured) listener('move', touch(event));
    });
    canvas.addEventListener('pointerup', event => {
      if (event.pointerId !== captured) return;
      captured = null;
      listener('end', touch(event));
    });
    function cancel(event) {
      if (event.pointerId !== captured) return;
      captured = null;
      listener('cancel', touch(event));
    }
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('lostpointercapture', cancel);
  }

  async function start() {
    if (typeof window.startJinyao !== 'function') throw new Error('共享源码加载失败。');
    let fallback = '';
    try {
      const face = new FontFace('Jinyao UI', 'url(/assets/jinyao-ui.ttf)');
      document.fonts.add(await face.load());
      fallback = 'Jinyao UI';
    } catch (_) { /* Use the system font if the game font is unavailable. */ }

    window.jinyaoPreview = window.startJinyao({
      canvas,
      fontFamily: fallback,
      windowInfo() {
        const rect = canvas.getBoundingClientRect();
        return { width: rect.width, height: rect.height, ratio: window.devicePixelRatio || 1 };
      },
      loadImage(file, ready, failed) {
        const image = new Image();
        image.onload = () => ready(image);
        image.onerror = () => failed(file);
        image.src = '/' + file;
      },
      onInput: makeInput,
      onResize(listener) {
        const observer = new ResizeObserver(listener);
        observer.observe(canvas);
      },
      onShow(listener) {
        document.addEventListener('visibilitychange', () => { if (!document.hidden) listener(); });
      },
      onHide(listener) {
        document.addEventListener('visibilitychange', () => { if (document.hidden) listener(); });
        window.addEventListener('pagehide', listener);
      },
      read(key) {
        try { return JSON.parse(localStorage.getItem(savePrefix + key)); }
        catch (_) { return null; }
      },
      write(key, data) {
        if (resettingSave) return;
        try { localStorage.setItem(savePrefix + key, JSON.stringify(data)); }
        catch (error) { console.warn('预览存档写入失败', error); }
      },
      frame(callback) { window.requestAnimationFrame(callback); },
    });

    document.querySelector('#reset-preview').addEventListener('click', () => {
      if (!window.confirm('清除这个浏览器里的小游戏预览进度？')) return;
      try {
        localStorage.removeItem(savePrefix + savedKey);
        resettingSave = true;
        window.location.reload();
      } catch (error) { showError(error); }
    });
  }

  window.addEventListener('error', event => showError(event.error || event.message));
  start().catch(showError);
}());
