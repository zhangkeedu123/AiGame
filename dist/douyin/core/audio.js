'use strict';

const AUDIO_KEY = 'jinyao-audio-v1';
const tracks = {
  music: 'music-river',
  break: 'sound-break',
  join: 'sound-join',
  rotate: 'sound-rotate',
  win: 'sound-win',
};

function clampVolume(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readChannel(saved, volume) {
  return {
    enabled: saved?.enabled !== false,
    volume: Number.isFinite(saved?.volume) ? clampVolume(saved.volume) : volume,
  };
}

class GameAudio {
  constructor(platform) {
    this.platform = platform;
    const saved = platform.read(AUDIO_KEY);
    this.settings = {
      music: readChannel(saved?.music, 45),
      effects: readChannel(saved?.effects, 70),
    };
    this.players = new Map();
    this.foreground = true;
    this.interacted = false;
    this.musicRequest = null;
  }

  player(name) {
    if (!this.players.has(name)) {
      const player = this.platform.createSound?.('assets/' + tracks[name] + '.wav', name === 'music');
      if (player) this.players.set(name, player);
    }
    return this.players.get(name);
  }

  gesture() {
    this.interacted = true;
    this.platform.unlockAudio?.();
    this.syncMusic();
  }

  setForeground(visible) {
    this.foreground = visible;
    this.syncMusic();
    if (!visible) this.stopEffects();
  }

  stopEffects() {
    for (const [name, player] of this.players) {
      if (name !== 'music') player.stop();
    }
  }

  syncMusic() {
    const { enabled, volume } = this.settings.music;
    if (!enabled || volume === 0 || !this.foreground || !this.interacted) {
      if (this.musicRequest) {
        this.players.get('music').pause();
        this.musicRequest = null;
      }
      return;
    }
    const player = this.player('music');
    if (!player) return;
    player.setVolume(volume / 100);
    if (this.musicRequest) return;
    const request = {};
    this.musicRequest = request;
    const result = player.play();
    if (result === false) this.musicRequest = null;
    else result?.catch?.(() => {
      if (this.musicRequest === request) this.musicRequest = null;
    });
  }

  effect(name) {
    const { enabled, volume } = this.settings.effects;
    if (!enabled || !volume || !this.foreground || !this.interacted) return;
    const player = this.player(name);
    if (!player) return;
    player.setVolume(volume / 100);
    player.play(true)?.catch?.(() => {});
  }

  toggle(channel) {
    const config = this.settings[channel];
    config.enabled = !config.enabled;
    if (channel === 'music') this.syncMusic();
    else if (config.enabled) this.effect('join');
    else this.stopEffects();
    this.save();
  }

  setVolume(channel, value) {
    const volume = clampVolume(value);
    if (volume === this.settings[channel].volume) return;
    this.settings[channel].volume = volume;
    if (channel === 'music') this.syncMusic();
    else {
      for (const [name, player] of this.players) {
        if (name !== 'music') player.setVolume(volume / 100);
      }
    }
  }

  save() {
    this.platform.write(AUDIO_KEY, this.settings);
  }
}

module.exports = { GameAudio };
