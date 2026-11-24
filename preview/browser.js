'use strict';

(function () {
  const canvas = document.querySelector('#game');
  const errorBox = document.querySelector('#error');
  const savePrefix = 'jinyao-preview:';
  const savedKey = 'jinyao-museum-v2';
  const dailyKey = 'jinyao-daily-v1';
  const modesKey = 'jinyao-modes-v1';
  let resettingSave = false;
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

    const onlineEnabled = await fetch('/online-enabled').then(response => response.json()).catch(() => false);
    window.jinyaoPreview = window.startJinyao({
      ...(onlineEnabled ? {
        onlineUrl: path => '/online' + path,
        askToken: () => window.prompt('请输入管理员签发的玩家令牌') || '',
        async onlineRequest(path, { method = 'GET', token, body } = {}) {
          const headers = { 'Content-Type': 'application/json' };
          if (token) headers.Authorization = 'Bearer ' + token;
          const response = await fetch('/online' + path, { method, headers, body: body && JSON.stringify(body) });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        },
      } : {}),
      canvas,
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
        localStorage.removeItem(savePrefix + dailyKey);
        localStorage.removeItem(savePrefix + modesKey);
        resettingSave = true;
        window.location.reload();
      } catch (error) { showError(error); }
    });
  }

  window.addEventListener('error', event => showError(event.error || event.message));
  start().catch(showError);
}());
