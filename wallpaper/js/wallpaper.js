(function () {
  'use strict';

  var IMAGE_WIDTH = 3840;
  var IMAGE_HEIGHT = 2160;
  // UI/motion use a fixed 4K design baseline; media geometry uses actual pixels.
  var mediaWidth = IMAGE_WIDTH, mediaHeight = IMAGE_HEIGHT;
  var GUARD = 2; // CSS pixels on every edge, even at the maximum legal displacement.
  var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  var POSE_KEYS = ['x', 'y', 'rotateX', 'rotateY'];
  var settings = {
    parallaxenabled: true,
    strength: 100,
    smoothing: 120,
    clockvisible: true,
    clockopacity: 44,
    clockscale: 100,
    hourformat: '24',
    showseconds: true,
    clockposition: 'topright',
    clockx: 100,
    clocky: 0,
    clock3d: true,
    clockmotion: 100,
    clocktimezone: 'Asia/Shanghai',
    clockoffset: 480
  };
  var image = document.getElementById('background');
  var clock = document.getElementById('clock');
  var clockAnchor = document.getElementById('clock-anchor');
  var clockLabel = document.getElementById('clock-label');
  var timezoneElement = document.getElementById('timezone');
  var timeElement = document.getElementById('time');
  var dateElement = document.getElementById('date');
  var periodElement = document.getElementById('period');
  var root = document.documentElement;
  var geometry;
  var normalized = { x: 0, y: 0 };
  var current = { x: 0, y: 0 };
  var target = { x: 0, y: 0 };
  var pointer = { x: 0, y: 0, active: false };
  var clockPose = { x: 0, y: 0, rotateX: 0, rotateY: 0 };
  var clockTargetPose = { x: 0, y: 0, rotateX: 0, rotateY: 0 };
  var clockLayout;
  var frameId = 0;
  var clockTimer = 0;
  var lastFrame = 0;
  var nextFrameDue = 0;
  var fps = 60;
  var enginePaused = false;
  var paused = document.hidden;
  var frameWrites = 0;
  var clockWrites = 0;
  var inputEvents = 0;
  var clockTransformWrites = 0;
  var geometryPendingShrink = false;
  var formatters = Object.create(null);
  var ZONES = {
    'Asia/Shanghai': '北京时间', 'UTC': '协调世界时', 'Asia/Tokyo': '东京时间',
    'Asia/Singapore': '新加坡时间', 'Asia/Dubai': '迪拜时间', 'Asia/Kolkata': '印度时间',
    'Europe/London': '伦敦时间', 'Europe/Paris': '巴黎时间',
    'America/New_York': '纽约时间', 'America/Los_Angeles': '洛杉矶时间',
    'Australia/Sydney': '悉尼时间', 'Pacific/Auckland': '奥克兰时间', 'custom': '自定义时间'
  };
  var videoPlayer = window.createWallpaperVideoLoop(image, { paused: paused });

  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function pad(value) { return String(value).padStart(2, '0'); }

  /** Preserve the video's aspect ratio while covering viewport + motion + guard. */
  function calculateGeometry(width, height, strength, enabled, retainedX, retainedY) {
    width = Math.max(1, Number(width) || 1);
    height = Math.max(1, Number(height) || 1);
    var viewportScale = Math.min(width / IMAGE_WIDTH, height / IMAGE_HEIGHT);
    var amount = enabled ? clamp(Number(strength) || 0, 0, 200) / 100 : 0;
    // The restrained motion envelope scales with the viewport, not the source size.
    var maxX = 32 * viewportScale * amount;
    var maxY = 12 * viewportScale * amount;
    // Keep the previous displacement covered while reduced strength eases toward center.
    var safeX = Math.max(maxX, Math.abs(retainedX || 0));
    var safeY = Math.max(maxY, Math.abs(retainedY || 0));
    var imageScale = Math.max(
      (width + 2 * (safeX + GUARD)) / mediaWidth,
      (height + 2 * (safeY + GUARD)) / mediaHeight
    );
    var coverScale = Math.max(width / mediaWidth, height / mediaHeight);
    var top = (height - mediaHeight * imageScale) / 2;
    return {
      viewportWidth: width, viewportHeight: height,
      imageWidth: mediaWidth * imageScale, imageHeight: mediaHeight * imageScale,
      left: (width - mediaWidth * imageScale) / 2,
      top: top,
      maxX: maxX, maxY: maxY, guard: GUARD,
      overscan: imageScale / coverScale,
      retainedMotion: safeX > maxX || safeY > maxY
    };
  }

  function fieldsAtOffset(timestamp, offset) {
    var shifted = new Date(Number(timestamp) + offset * 60000);
    return {
      year: shifted.getUTCFullYear(), month: pad(shifted.getUTCMonth() + 1),
      day: pad(shifted.getUTCDate()), hour: pad(shifted.getUTCHours()),
      minute: pad(shifted.getUTCMinutes()), second: pad(shifted.getUTCSeconds())
    };
  }

  function getFormatter(zone) {
    if (Object.prototype.hasOwnProperty.call(formatters, zone)) return formatters[zone];
    try {
      var candidate = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
        minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      });
      formatters[zone] = typeof candidate.formatToParts === 'function' ? candidate : null;
    } catch (error) { formatters[zone] = null; }
    return formatters[zone];
  }

  function offsetText(offset) {
    return (offset < 0 ? '-' : '+') + pad(Math.floor(Math.abs(offset) / 60)) + ':' + pad(Math.abs(offset) % 60);
  }

  /** Derive date, weekday and DST offset from this absolute instant, independent of Windows' zone. */
  function formatZonedTime(timestamp, use24, seconds, zone, offset, forceFallback) {
    zone = Object.prototype.hasOwnProperty.call(ZONES, zone) ? zone : 'Asia/Shanghai';
    var instant = new Date(timestamp);
    var offsetMinutes = zone === 'UTC' ? 0 : zone === 'custom' ? Math.round(clamp(Number(offset) || 0, -720, 840)) : 480;
    var fields = fieldsAtOffset(instant.getTime(), offsetMinutes);
    var usedIntl = false;
    var fallback = false;
    if (zone !== 'custom' && zone !== 'UTC') {
      var formatter = !forceFallback && getFormatter(zone);
      if (formatter) {
        try {
          formatter.formatToParts(instant).forEach(function (part) {
            if (Object.prototype.hasOwnProperty.call(fields, part.type)) fields[part.type] = part.value;
          });
          fields.hour = pad(Number(fields.hour) % 24);
          var localEpoch = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day),
            Number(fields.hour), Number(fields.minute), Number(fields.second));
          offsetMinutes = Math.round((localEpoch - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
          usedIntl = true;
        } catch (error) { /* The explicit UTC+8 compatibility display below is safe without Intl. */ }
      }
      if (!usedIntl) {
        offsetMinutes = 480;
        fields = fieldsAtOffset(instant.getTime(), offsetMinutes);
        fallback = true;
      }
    }
    var hour = Number(fields.hour) % 24;
    var period = use24 ? '' : (hour < 12 ? '上午' : '下午');
    var weekday = new Date(Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day))).getUTCDay();
    var suffix = offsetText(offsetMinutes);
    return {
      date: fields.year + '年' + fields.month + '月' + fields.day + '日 ' + WEEKDAYS[weekday],
      time: pad(use24 ? hour : (hour % 12 || 12)) + ':' + fields.minute + (seconds ? ':' + fields.second : ''),
      period: period,
      iso: fields.year + '-' + fields.month + '-' + fields.day + 'T' + pad(hour) + ':' + fields.minute + ':' + fields.second + suffix,
      method: usedIntl ? 'Intl ' + zone : fallback ? 'UTC+8 fallback' : 'UTC fixed offset',
      label: fallback ? '北京时间' : ZONES[zone],
      timezone: 'UTC' + suffix + (fallback ? ' · 兼容' : ''),
      offsetMinutes: offsetMinutes, zone: fallback ? 'Asia/Shanghai' : zone, fallback: fallback
    };
  }

  // Retained for old diagnostics and for explicitly requesting Beijing time.
  function formatBeijingTime(timestamp, use24, seconds, forceFallback) {
    return formatZonedTime(timestamp, use24, seconds, 'Asia/Shanghai', 480, forceFallback);
  }

  function updateClock() {
    clearTimeout(clockTimer);
    clockTimer = 0;
    if (paused || !settings.clockvisible) return;
    var now = Date.now();
    var display = formatZonedTime(now, settings.hourformat === '24', settings.showseconds,
      settings.clocktimezone, settings.clockoffset, false);
    if (timeElement.textContent !== display.time) { timeElement.textContent = display.time; clockWrites++; }
    if (dateElement.textContent !== display.date) dateElement.textContent = display.date;
    if (periodElement.textContent !== display.period) periodElement.textContent = display.period;
    if (clockLabel.textContent !== display.label) clockLabel.textContent = display.label;
    var accessibleLabel = display.label + '信息窗口' + (display.fallback ? '（UTC+8 兼容模式）' : '');
    if (clock.getAttribute('aria-label') !== accessibleLabel) clock.setAttribute('aria-label', accessibleLabel);
    if (timezoneElement.textContent !== display.timezone) timezoneElement.textContent = display.timezone;
    periodElement.hidden = !display.period;
    timeElement.setAttribute('datetime', display.iso);
    // Re-read real time at the next boundary. Event-loop delays cannot accumulate clock drift.
    var interval = settings.showseconds ? 1000 : 60000;
    clockTimer = setTimeout(updateClock, interval - (Date.now() % interval) + 2);
  }

  function writeTransform() {
    image.style.transform = 'translate3d(' + current.x.toFixed(4) + 'px,' + current.y.toFixed(4) + 'px,0)';
    frameWrites++;
  }

  function writeClockTransform() {
    if (!clockLayout) return;
    // Translate in local pixels so the observable slide remains constant at each viewport scale.
    clock.style.transform = 'perspective(1000px) translate3d(' + (clockPose.x / clockLayout.scale).toFixed(4) +
      'px,' + (clockPose.y / clockLayout.scale).toFixed(4) + 'px,0) rotateX(' +
      clockPose.rotateX.toFixed(4) + 'deg) rotateY(' + clockPose.rotateY.toFixed(4) + 'deg)';
    clockTransformWrites++;
  }

  function updateClockTarget() {
    var amount = settings.clockmotion / 100;
    var active = pointer.active && settings.clockvisible && settings.clock3d && amount > 0 && clockLayout;
    var x = 0, y = 0, influence = 0;
    if (active) {
      x = (pointer.x - clockLayout.left - clockLayout.width / 2) / (clockLayout.width / 2);
      y = (pointer.y - clockLayout.top - clockLayout.height / 2) / (clockLayout.height / 2);
      // Use the stable, untransformed anchor. Transforming the card never changes its input region.
      var outside = Math.max(Math.abs(x), Math.abs(y));
      var blend = clamp((1.45 - outside) / .45, 0, 1);
      influence = blend * blend * (3 - 2 * blend);
    }
    x = clamp(x, -1, 1) * influence;
    y = clamp(y, -1, 1) * influence;
    clockTargetPose.x = x * clockLayout.maxSlide;
    clockTargetPose.y = y * clockLayout.maxSlide;
    clockTargetPose.rotateX = -y * clockLayout.maxTilt;
    clockTargetPose.rotateY = x * clockLayout.maxTilt;
  }

  function applyClockLayout() {
    var width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
    var baseScale = Math.min(width / IMAGE_WIDTH, height / IMAGE_HEIGHT);
    var margin = Math.min(Math.max(12, 70 * baseScale), width * .08, height * .08);
    var requestedScale = 2 * Math.max(.34, baseScale) * settings.clockscale / 100;
    // Reserve the full supported envelope (20 degrees, 24 px at 4K), including 10 px raised text.
    // This avoids a layout jump when the motion slider changes or the old pose is easing back.
    var sine = Math.sin(20 * Math.PI / 180);
    var projection = 1000 / (1000 - (220 + 117.5) * sine - 10);
    var halfWidthEnvelope = (220 + 10 * sine) * projection;
    var halfHeightEnvelope = (117.5 + 220 * sine * sine + 10 * sine) * projection;
    var safetySlide = Math.min(24 * baseScale, width * .02, height * .02);
    var scale = Math.max(.001, Math.min(requestedScale,
      (width - 2 * margin - 2 * projection * safetySlide) / (2 * halfWidthEnvelope),
      (height - 2 * margin - 2 * projection * safetySlide) / (2 * halfHeightEnvelope)));
    var reserveX = (halfWidthEnvelope - 220) * scale + projection * safetySlide;
    var reserveY = (halfHeightEnvelope - 117.5) * scale + projection * safetySlide;
    var availableX = Math.max(0, width - 440 * scale - 2 * (margin + reserveX));
    var availableY = Math.max(0, height - 235 * scale - 2 * (margin + reserveY));
    var x = settings.clockx / 100, y = settings.clocky / 100;
    if (settings.clockposition !== 'custom') {
      x = settings.clockposition === 'center' ? .5 : settings.clockposition.indexOf('right') !== -1 ? 1 : 0;
      y = settings.clockposition === 'center' ? .5 : settings.clockposition.indexOf('bottom') !== -1 ? 1 : 0;
    }
    clockLayout = {
      left: margin + reserveX + availableX * x,
      top: margin + reserveY + availableY * y,
      width: 440 * scale, height: 235 * scale, scale: scale,
      margin: margin, maxSlide: 12 * baseScale * settings.clockmotion / 100,
      maxTilt: 10 * settings.clockmotion / 100, reserveX: reserveX, reserveY: reserveY,
      availableX: availableX, availableY: availableY
    };
    clockAnchor.style.left = clockLayout.left + 'px';
    clockAnchor.style.top = clockLayout.top + 'px';
    clockAnchor.style.transform = 'scale(' + scale + ')';
    root.style.setProperty('--clock-scale', String(scale));
    root.style.setProperty('--clock-margin', margin + 'px');
    writeClockTransform();
    updateClockTarget();
  }

  function applyGeometry(retainCurrent) {
    geometry = calculateGeometry(window.innerWidth, window.innerHeight, settings.strength,
      settings.parallaxenabled, retainCurrent ? current.x : 0, retainCurrent ? current.y : 0);
    image.style.width = geometry.imageWidth + 'px';
    image.style.height = geometry.imageHeight + 'px';
    image.style.left = geometry.left + 'px';
    image.style.top = geometry.top + 'px';
    geometryPendingShrink = geometry.retainedMotion;
    target.x = -normalized.x * geometry.maxX;
    target.y = -normalized.y * geometry.maxY;
    applyClockLayout();
    requestMotion();
  }

  function clockNeedsMotion(epsilon) {
    return Math.abs(clockTargetPose.x - clockPose.x) >= epsilon ||
      Math.abs(clockTargetPose.y - clockPose.y) >= epsilon ||
      Math.abs(clockTargetPose.rotateX - clockPose.rotateX) >= epsilon ||
      Math.abs(clockTargetPose.rotateY - clockPose.rotateY) >= epsilon;
  }

  function requestMotion() {
    if (paused || frameId) return;
    if (Math.abs(target.x - current.x) < .001 && Math.abs(target.y - current.y) < .001 && !clockNeedsMotion(.001)) return;
    lastFrame = performance.now();
    nextFrameDue = lastFrame;
    frameId = requestAnimationFrame(animate);
  }

  function animate(timestamp) {
    frameId = 0;
    if (paused) return;
    var interval = 1000 / fps;
    // The timestamp deadline avoids an uneven 30 fps / 60 Hz pattern from floating-point jitter.
    if (timestamp + .25 < nextFrameDue) { frameId = requestAnimationFrame(animate); return; }
    var elapsed = clamp(timestamp - lastFrame, 0, 100);
    lastFrame = timestamp;
    nextFrameDue += interval * Math.max(1, Math.floor((timestamp - nextFrameDue) / interval) + 1);
    var alpha = 1 - Math.exp(-elapsed / settings.smoothing);
    var backgroundMoving = Math.abs(target.x - current.x) >= .001 || Math.abs(target.y - current.y) >= .001;
    if (backgroundMoving) {
      current.x += (target.x - current.x) * alpha;
      current.y += (target.y - current.y) * alpha;
    }
    var settled = Math.abs(target.x - current.x) < .015 && Math.abs(target.y - current.y) < .015;
    if (settled) { current.x = target.x; current.y = target.y; }
    if (backgroundMoving) writeTransform();
    if (clockNeedsMotion(.001)) {
      var clockAlpha = 1 - Math.exp(-elapsed / Math.max(145, settings.smoothing));
      POSE_KEYS.forEach(function (key) {
        clockPose[key] += (clockTargetPose[key] - clockPose[key]) * clockAlpha;
        if (Math.abs(clockTargetPose[key] - clockPose[key]) < .006) clockPose[key] = clockTargetPose[key];
      });
      writeClockTransform();
    }
    if (settled && geometryPendingShrink) applyGeometry(false);
    if ((!settled || clockNeedsMotion(.001)) && !frameId) frameId = requestAnimationFrame(animate);
  }

  function onMouseMove(event) {
    if (paused) return;
    var x = Number(event.clientX), y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    inputEvents++;
    pointer.x = x; pointer.y = y; pointer.active = true;
    normalized.x = clamp(x / Math.max(1, window.innerWidth) * 2 - 1, -1, 1);
    normalized.y = clamp(y / Math.max(1, window.innerHeight) * 2 - 1, -1, 1);
    target.x = -normalized.x * geometry.maxX;
    target.y = -normalized.y * geometry.maxY;
    updateClockTarget();
    requestMotion();
  }

  function returnToCenter() {
    pointer.active = false;
    normalized.x = normalized.y = 0;
    target.x = target.y = 0;
    updateClockTarget();
    requestMotion();
  }

  function updatePause() {
    var nextPaused = enginePaused || document.hidden;
    if (paused === nextPaused) return;
    paused = nextPaused;
    if (paused) {
      cancelAnimationFrame(frameId);
      frameId = 0;
      clearTimeout(clockTimer);
      clockTimer = 0;
      videoPlayer.setPaused(true);
      // Resume from this exact visual position and gently return to the safe center.
      normalized.x = normalized.y = target.x = target.y = 0;
      pointer.active = false;
      clockTargetPose.x = clockTargetPose.y = clockTargetPose.rotateX = clockTargetPose.rotateY = 0;
    } else {
      updateClock();
      requestMotion();
      videoPlayer.setPaused(false);
    }
  }

  function booleanValue(value) { return value === true || value === 'true' || value === 1; }
  function numberProperty(properties, key, min, max) {
    if (!properties[key]) return;
    var value = Number(properties[key].value);
    if (Number.isFinite(value)) settings[key] = clamp(value, min, max);
  }

  // Official Wallpaper Engine Web API; assigned globally before any load event.
  window.wallpaperPropertyListener = {
    applyUserProperties: function (properties) {
      if (!properties) return;
      ['parallaxenabled', 'clockvisible', 'showseconds', 'clock3d'].forEach(function (key) {
        if (properties[key]) settings[key] = booleanValue(properties[key].value);
      });
      numberProperty(properties, 'strength', 0, 200);
      numberProperty(properties, 'smoothing', 60, 300);
      numberProperty(properties, 'clockopacity', 5, 95);
      numberProperty(properties, 'clockscale', 40, 180);
      numberProperty(properties, 'clockx', 0, 100);
      numberProperty(properties, 'clocky', 0, 100);
      numberProperty(properties, 'clockmotion', 0, 200);
      numberProperty(properties, 'clockoffset', -720, 840);
      if (properties.hourformat && /^(12|24)$/.test(String(properties.hourformat.value)))
        settings.hourformat = String(properties.hourformat.value);
      if (properties.clockposition && ['topright', 'topleft', 'bottomright', 'bottomleft', 'center', 'custom'].indexOf(properties.clockposition.value) !== -1)
        settings.clockposition = properties.clockposition.value;
      if (properties.clocktimezone && Object.prototype.hasOwnProperty.call(ZONES, properties.clocktimezone.value))
        settings.clocktimezone = properties.clocktimezone.value;
      if (!settings.parallaxenabled) normalized.x = normalized.y = 0;
      clock.hidden = !settings.clockvisible;
      clockAnchor.hidden = !settings.clockvisible;
      clock.setAttribute('data-position', settings.clockposition);
      root.style.setProperty('--clock-opacity', String(settings.clockopacity / 100));
      applyGeometry(true);
      updateClock();
    },
    applyGeneralProperties: function (properties) {
      if (properties && Number.isFinite(Number(properties.fps)) && Number(properties.fps) > 0) {
        fps = clamp(Number(properties.fps), 1, 240);
        nextFrameDue = performance.now();
        videoPlayer.setFPS(fps);
      }
    },
    setPaused: function (isPaused) { enginePaused = Boolean(isPaused); updatePause(); }
  };

  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('mouseout', function (event) { if (!event.relatedTarget) returnToCenter(); }, { passive: true });
  window.addEventListener('blur', returnToCenter);
  window.addEventListener('resize', function () { applyGeometry(true); });
  document.addEventListener('visibilitychange', updatePause);
  Array.prototype.forEach.call(image.querySelectorAll('video'), function (video) {
    function updateMediaGeometry() {
      if (video.videoWidth > 0 && video.videoHeight > 0 &&
          (mediaWidth !== video.videoWidth || mediaHeight !== video.videoHeight)) {
        mediaWidth = video.videoWidth; mediaHeight = video.videoHeight;
        applyGeometry(true);
      }
    }
    video.addEventListener('loadedmetadata', updateMediaGeometry);
    video.addEventListener('resize', updateMediaGeometry);
    updateMediaGeometry();
  });

  // Pull-only diagnostics: no logging, polling, network calls or per-frame diagnostic allocation.
  window.wallpaperDiagnostics = Object.freeze({
    calculateGeometry: calculateGeometry,
    formatBeijingTime: formatBeijingTime,
    formatZonedTime: formatZonedTime,
    snapshot: function () {
      var videoState = videoPlayer.snapshot();
      return {
        settings: Object.assign({}, settings), geometry: Object.assign({}, geometry),
        current: Object.assign({}, current), target: Object.assign({}, target),
        clockPose: Object.assign({}, clockPose), clockTargetPose: Object.assign({}, clockTargetPose),
        clockLayout: Object.assign({}, clockLayout),
        normalized: Object.assign({}, normalized), paused: paused, enginePaused: enginePaused,
        frameScheduled: Boolean(frameId), clockScheduled: Boolean(clockTimer), fps: fps,
        frameWrites: frameWrites, clockWrites: clockWrites, clockTransformWrites: clockTransformWrites, inputEvents: inputEvents,
        naturalWidth: videoState.width, naturalHeight: videoState.height,
        video: videoState,
        time: timeElement.textContent, date: dateElement.textContent,
        clockLabel: clockLabel.textContent, timezone: timezoneElement.textContent,
        clockBounds: clock.getBoundingClientRect().toJSON(),
        clockAnchorBounds: clockAnchor.getBoundingClientRect().toJSON(),
        backgroundBounds: image.getBoundingClientRect().toJSON()
      };
    }
  });

  applyGeometry(false);
  updateClock();
}());
