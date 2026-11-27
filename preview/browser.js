'use strict';

(function () {
  const canvas = document.querySelector('#game');
  const errorBox = document.querySelector('#error');
  const savePrefix = 'jinyao-preview:';
  let audioContext;

  function unlockAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!audioContext && AudioContext) {
      try { audioContext = new AudioContext(); } catch (_) { /* Direct playback remains available. */ }
    }
    if (audioContext && audioContext.state !== 'running') audioContext.resume().catch(() => {});
  }

  function createSound(path, loop) {
    const player = new Audio('/' + path);
    player.loop = loop;
    let gain;
    if (audioContext) {
      gain = audioContext.createGain();
      audioContext.createMediaElementSource(player).connect(gain);
      gain.connect(audioContext.destination);
    }
    return {
      play(restart) {
        if (restart) player.currentTime = 0;
        return player.play();
      },
      pause() { player.pause(); },
      stop() { player.pause(); player.currentTime = 0; },
      setVolume(volume) {
        if (gain) gain.gain.value = volume;
        else player.volume = volume;
      },
    };
  }

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

    // 后台地址由启动预览时读取 appids.local.json 决定，页面上不做环境切换。
    const online = await fetch('/online-enabled').then(response => response.json())
      .catch(() => ({ enabled: false }));
    const env = online.enabled && online.env ? online.env : '';
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

    window.jinyaoPreview = window.startJinyao({
      ...(env ? {
        onlineEnv: env,
        onlineUrl: path => '/online' + path,
        shippingAvailable: (location.protocol === 'https:' || localHost) &&
          (/^https:\/\//i.test(online.apiUrl) ||
            (localHost && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(online.apiUrl))),
        async onlineRequest(path, { method = 'GET', token, body } = {}) {
          const headers = { 'Content-Type': 'application/json' };
          // 不用 Authorization：托管网关会把它剥掉，改用自定义头，由预览服务转成 Bearer。
          if (token) headers['X-Player-Token'] = token;
          const response = await fetch('/online' + path, {
            method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const error = new Error(typeof body.detail === 'string' ? body.detail : '服务暂不可用，请重试。');
            error.status = response.status;
            throw error;
          }
          return response.json();
        },
      } : {}),
      canvas,
      editText(label, value, maxLength) {
        return Promise.resolve(window.prompt(label, value)?.slice(0, maxLength));
      },
      fontFamily: fallback,
      unlockAudio,
      createSound,
      windowInfo() {
        const rect = canvas.getBoundingClientRect();
        return { width: rect.width, height: rect.height, ratio: window.devicePixelRatio || 1 };
      },
      loadImage(file, ready, failed) {
        const image = new Image();
        image.onload = () => ready(image);
        image.onerror = () => failed(file);
        image.src = file.startsWith('/') ? file : '/' + file;
      },
      async share(content, notice) {
        try {
          if (typeof navigator.share === 'function') {
            await navigator.share({ title: content.title, text: content.desc });
          } else {
            await navigator.clipboard.writeText(content.title + ' · ' + content.desc);
            notice('已复制分享文案');
          }
        } catch (error) {
          if (error.name !== 'AbortError') notice('暂时无法分享，请稍后重试');
        }
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
        try { localStorage.setItem(savePrefix + key, JSON.stringify(data)); }
        catch (error) { console.warn('预览存档写入失败', error); }
      },
      frame(callback) { window.requestAnimationFrame(callback); },
    });

  }

  window.addEventListener('error', event => showError(event.error || event.message));
  start().catch(showError);
}());
