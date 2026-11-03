(function () {
  'use strict';

  // Two persistent decoders: a visible player is never rewound. The other player
  // starts before EOF and is revealed only after it has submitted a decoded frame.
  window.createWallpaperVideoLoop = function (container, options) {
    var videos = Array.prototype.slice.call(container.querySelectorAll('video'));
    var slots = videos.map(function (video, index) {
      video.loop = false;
      video.muted = video.defaultMuted = true;
      video.pause();
      return { video: video, index: index, callback: 0, verified: false,
        opacity: 0, z: index === 0 ? 1 : 0, error: null, playPending: false,
        retryAt: 0, retryCount: 0 };
    });
    var active = 0, incoming = -1, phase = 'idle', progress = 0;
    var paused = Boolean(options && options.paused);
    var timer = 0, frame = 0, lastFade = 0, due = 0, fps = 60;
    var handOffs = 0, holdCount = 0, lastHandoff = 0;
    var LEAD = .5, GUARD = .125, FADE_MS = 220, MAX_ABORT_RETRIES = 3;

    function shouldHandoff(video) {
      return video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 1 &&
        (video.ended || video.duration - video.currentTime <= LEAD);
    }
    function atEnd(video) {
      return video.ended || (Number.isFinite(video.duration) && video.duration > 0 &&
        video.currentTime >= video.duration);
    }

    function opacity(slot, value) {
      slot.opacity = value;
      slot.video.style.opacity = String(value);
    }
    function layer(slot, z) { slot.z = z; slot.video.style.zIndex = String(z); }
    function cancelCallback(slot) {
      if (slot.callback && slot.video.cancelVideoFrameCallback) slot.video.cancelVideoFrameCallback(slot.callback);
      slot.callback = 0;
    }
    function watchFrame(slot) {
      var v = slot.video;
      if (paused || slot.callback || !v.requestVideoFrameCallback) return;
      slot.callback = v.requestVideoFrameCallback(function () {
        slot.callback = 0;
        if (paused) return;
        if (!v.seeking && v.readyState >= 2) {
          slot.verified = true;
          if (slot.index === active && phase === 'idle') opacity(slot, 1);
          if (slot.index === incoming && phase === 'starting') beginFade();
        }
        advance();
        if (!v.paused) watchFrame(slot);
      });
    }
    function play(slot) {
      var v = slot.video;
      if (paused) return;
      // play() automatically seeks an ended video to its first frame. Even if a
      // long task skipped the pre-roll timer, never do that to the visible slot.
      if (slot.index === active) {
        if (phase === 'idle' && shouldHandoff(v)) { startHandoff(); return; }
        if (atEnd(v)) return;
      }
      if (slot.playPending || performance.now() < slot.retryAt || (!v.paused && !v.ended)) { watchFrame(slot); return; }
      slot.retryAt = 0;
      slot.playPending = true;
      var promise = v.play();
      watchFrame(slot);
      if (promise && promise.then) {
        promise.then(function () {
          slot.playPending = false;
          slot.error = null;
          slot.retryAt = slot.retryCount = 0;
          if (paused || (slot.index !== active && slot.index !== incoming)) v.pause();
          else watchFrame(slot);
        }).catch(function (error) {
          slot.playPending = false;
          if (error.name !== 'AbortError') slot.error = error.name + ': ' + error.message;
          else if (!paused && (slot.index === active || slot.index === incoming)) {
            // A fast pause/resume can happen before pause() rejects the old
            // play promise. Resume then sees playPending and must retry later.
            if (slot.retryCount < MAX_ABORT_RETRIES) {
              slot.retryAt = performance.now() + 100 * Math.pow(2, slot.retryCount++);
              schedule();
            } else {
              slot.retryAt = Infinity;
              slot.error = 'AbortError: playback restart failed after three retries';
            }
          }
        });
      } else slot.playPending = false;
    }
    function prepare(slot) {
      // This function is called only AFTER the old player is completely covered.
      slot.video.pause();
      cancelCallback(slot);
      opacity(slot, 0);
      layer(slot, 0);
      slot.verified = false;
      slot.retryAt = slot.retryCount = 0;
      if (slot.video.readyState >= 1 && slot.video.currentTime > .001) slot.video.currentTime = 0;
      watchFrame(slot);
    }
    function schedule() {
      clearTimeout(timer);
      timer = 0;
      if (paused) return;
      var v = slots[active].video;
      var remaining = Number.isFinite(v.duration) ? v.duration - v.currentTime - LEAD : .5;
      timer = setTimeout(function () { timer = 0; advance(); schedule(); },
        phase === 'idle' ? Math.max(30, Math.min(500, remaining * 1000)) : 40);
    }
    function startHandoff() {
      incoming = 1 - active;
      var next = slots[incoming];
      phase = 'starting';
      progress = 0;
      next.verified = false;
      opacity(next, 0);
      layer(next, 2);
      cancelCallback(next);
      play(next);
      schedule();
    }
    function finishHandoff() {
      var previous = slots[active];
      active = incoming;
      incoming = -1;
      opacity(slots[active], 1);
      layer(slots[active], 1);
      phase = 'idle';
      progress = 0;
      handOffs++;
      lastHandoff = performance.now();
      prepare(previous);
      schedule();
    }
    function fade(now) {
      frame = 0;
      if (paused || phase !== 'fading') return;
      if (now + .25 < due) { frame = requestAnimationFrame(fade); return; }
      // Pauses reset lastFade; wall-clock time spent suspended never advances the fade.
      progress = Math.min(1, progress + Math.max(0, now - lastFade) / FADE_MS);
      lastFade = now;
      due = now + 1000 / fps;
      // The outgoing image stays fully opaque underneath. Complementary opacity
      // on both layers would expose the backdrop and darken the midpoint.
      opacity(slots[incoming], progress);
      if (progress >= 1) finishHandoff();
      else frame = requestAnimationFrame(fade);
    }
    function beginFade() {
      if (paused || phase !== 'starting') return;
      phase = 'fading';
      lastFade = due = performance.now();
      frame = requestAnimationFrame(fade);
    }
    function advance() {
      if (paused) return;
      var current = slots[active], v = current.video;
      // Older CEF fallback: wait for advancing decoded media rather than treating
      // loadedmetadata as a displayed frame; opacity starts on a later animation frame.
      [active, incoming].forEach(function (index) {
        if (index < 0) return;
        var slot = slots[index], media = slot.video;
        if (!media.requestVideoFrameCallback && !media.seeking && media.readyState >= 2 && media.currentTime > .025) {
          slot.verified = true;
          if (index === active && phase === 'idle') opacity(slot, 1);
          if (index === incoming && phase === 'starting') beginFade();
        }
      });
      if (phase === 'idle') {
        if (shouldHandoff(v)) startHandoff();
        else if (v.paused && v.readyState >= 2) play(current);
      }
      if (phase === 'starting') {
        var next = slots[incoming];
        if (next.video.paused && !next.playPending && Number.isFinite(next.retryAt) &&
            next.retryAt > 0 && performance.now() >= next.retryAt) play(next);
      }
      // If decoding the spare is late, retain this actual decoded frame instead
      // of letting the visible player hit EOF and clear its video surface.
      if (phase !== 'idle' && !v.paused && Number.isFinite(v.duration) && v.duration - v.currentTime <= GUARD) {
        v.pause(); cancelCallback(current); holdCount++;
      }
    }
    slots.forEach(function (slot) {
      layer(slot, slot.z); opacity(slot, 0);
      ['loadeddata', 'canplay', 'seeked', 'timeupdate'].forEach(function (type) {
        slot.video.addEventListener(type, function () {
          if (paused) return;
          if (type !== 'timeupdate') watchFrame(slot);
          if (slot.index === active && phase === 'idle') play(slot);
          advance();
        });
      });
      slot.video.addEventListener('error', function () {
        slot.error = slot.video.error ? 'Media error ' + slot.video.error.code + ': ' + slot.video.error.message : 'Media load error';
      });
    });

    function setPaused(value) {
      value = Boolean(value);
      if (paused === value) return;
      paused = value;
      clearTimeout(timer); timer = 0;
      cancelAnimationFrame(frame); frame = 0;
      if (paused) slots.forEach(function (slot) { slot.video.pause(); cancelCallback(slot); });
      else {
        // An explicit resume can recover from an exhausted transient abort;
        // automatic retries within one running period remain bounded.
        slots.forEach(function (slot) { slot.retryAt = slot.retryCount = 0; });
        var v = slots[active].video;
        if (phase === 'idle' || !Number.isFinite(v.duration) || v.duration - v.currentTime > GUARD) play(slots[active]);
        if (incoming >= 0) play(slots[incoming]);
        if (phase === 'fading') { lastFade = due = performance.now(); frame = requestAnimationFrame(fade); }
        advance(); schedule();
      }
    }
    function snapshot() {
      var states = slots.map(function (slot) {
        var v = slot.video, q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
        return { index: slot.index, time: v.currentTime, paused: v.paused, seeking: v.seeking,
          readyState: v.readyState, opacity: slot.opacity, zIndex: slot.z, verified: slot.verified,
          frames: q ? q.totalVideoFrames : 0, dropped: q ? q.droppedVideoFrames : 0,
          error: slot.error, nativeLoop: v.loop, callbackScheduled: Boolean(slot.callback) };
      });
      var v = slots[active].video;
      return { active: active, incoming: incoming, phase: phase, progress: progress, handOffs: handOffs,
        holdCount: holdCount, lastHandoff: lastHandoff, paused: paused, timerScheduled: Boolean(timer),
        frameScheduled: Boolean(frame), videos: states, width: v.videoWidth, height: v.videoHeight,
        currentTime: v.currentTime, duration: v.duration, ended: v.ended, readyState: v.readyState,
        muted: true, loop: true, strategy: 'predecoded two-player handoff', revision: '2026-10-23-eof-guard',
        error: states.map(function (s) { return s.error; }).filter(Boolean).join('; ') || null,
        totalVideoFrames: states[0].frames + states[1].frames,
        droppedVideoFrames: states[0].dropped + states[1].dropped };
    }
    if (!paused) { play(slots[active]); watchFrame(slots[1]); schedule(); }
    return Object.freeze({ setPaused: setPaused,
      setFPS: function (value) { fps = Math.max(1, Math.min(240, Number(value) || 60)); }, snapshot: snapshot });
  };
}());
