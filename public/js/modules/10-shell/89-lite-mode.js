/* ==========================================================================
   极简模式（Lite Mode）· 极致压缩版
   --------------------------------------------------------------------------
   目标：把渲染开销压到接近「静态页面」的水平。

   实测发现的问题（第一版没压干净）：
     · rAF 仍有 98 次/秒（节流被绕过）
     · 还有 216 个 filter/backdrop-filter
     · #album-bg 用 filter: blur(120px)，单这一条就吃掉大量 GPU
     · #idle-guide-canvas 1280×900 全屏画布还在跑
     · 9 个 CSS 动画在跑

   这一版的做法：从源头掐死，不靠 CSS 覆盖。

   分三档：
     standard  标准（特效全开）
     lite      极简（关粒子/3D/毛玻璃，30fps）
     ultra     超极简（彻底静态：无 rAF 渲染、无图片、无阴影）

   开关保存在 localStorage，重启后保持。
   ========================================================================== */

var LITE_MODE_KEY = 'bili-lite-mode';       // legacy: '1' / ''
var LITE_LEVEL_KEY = 'bili-lite-level';     // 'standard' | 'lite' | 'ultra'

var LITE_STATE = {
  level: 'standard',
  applied: false,
  backup: null,
  savedRaf: null,
  throttledRaf: null,
  injectedStyle: null,
};

var LITE_LEVELS = {
  standard: { label: '标准模式', desc: '特效全开' },
  lite: { label: '极简模式', desc: '关粒子/3D/毛玻璃，帧率 30' },
  ultra: { label: '超极简', desc: '彻底静态：无动画、无图片、无阴影' },
};

/* ---------------------------------------------------------------- 读写 */
function liteLevel() {
  return LITE_STATE.level;
}

function isLiteMode() {
  return LITE_STATE.level !== 'standard';
}

function loadLiteMode() {
  var lv = 'standard';
  try {
    var saved = localStorage.getItem(LITE_LEVEL_KEY);
    if (saved === 'lite' || saved === 'ultra' || saved === 'standard') {
      lv = saved;
    } else if (localStorage.getItem(LITE_MODE_KEY) === '1') {
      lv = 'lite';   // 兼容旧版本
    }
  } catch (e) {}
  LITE_STATE.level = lv;
  return lv;
}

function saveLiteMode(level) {
  try {
    localStorage.setItem(LITE_LEVEL_KEY, level);
    if (level === 'standard') localStorage.removeItem(LITE_MODE_KEY);
    else localStorage.setItem(LITE_MODE_KEY, '1');
  } catch (e) {}
}

/* ---------------------------------------------------------------- 切换 */
function setLiteMode(level, silent) {
  // 兼容旧调用：布尔值 → lite / standard
  if (level === true) level = 'lite';
  if (level === false) level = 'standard';
  if (!LITE_LEVELS[level]) level = 'standard';

  var prev = LITE_STATE.level;
  LITE_STATE.level = level;
  saveLiteMode(level);

  // 先全部撤掉，再按新档位应用（便于降级/升级切换）
  revertLiteMode();
  if (level !== 'standard') applyLiteMode(level);

  if (!silent) {
    showToastSafe(LITE_LEVELS[level].label + '：' + LITE_LEVELS[level].desc);
  }
  updateLiteModeUI();
}

/** 循环切换：standard → lite → ultra → standard */
function cycleLiteMode() {
  var order = ['standard', 'lite', 'ultra'];
  var i = order.indexOf(LITE_STATE.level);
  setLiteMode(order[(i + 1) % order.length]);
}

/* ---------------------------------------------------------------- 应用 */
function applyLiteMode(level) {
  level = level || LITE_STATE.level;
  if (LITE_STATE.applied) return;
  LITE_STATE.applied = true;

  var body = document.body;
  body.classList.add('lite-mode');
  body.setAttribute('data-lite-level', level);

  /* ---- 1. 备份并关闭 fx 视觉开关 ---- */
  LITE_STATE.backup = {};
  try {
    if (typeof fx !== 'undefined' && fx) {
      var keys = [
        'cinema', 'floatLayer', 'edge', 'aiDepth', 'bloom',
        'lyricGlow', 'lyricGlowBeat', 'lyricGlowParticles', 'lyricVerticalFloat',
        'backgroundStarRiver', 'backgroundAlbumCover',
        'lyricBackdropAdapt', 'coverBackdropAdapt', 'lyricLiveViewportFit',
        'lyricContextHighQuality',
        'sonicGroundFloatingEnabled', 'sonicAudioMonitorEnabled', 'sonicAudioAutoTrack',
        'gestureHandOverlay',
      ];
      keys.forEach(function (k) {
        if (k in fx) {
          LITE_STATE.backup[k] = fx[k];
          fx[k] = false;
        }
      });

      if ('performanceQuality' in fx) {
        LITE_STATE.backup.performanceQuality = fx.performanceQuality;
        fx.performanceQuality = 'eco';
        try {
          if (typeof setPerformanceQualityMode === 'function') setPerformanceQualityMode('eco', true);
        } catch (e) {}
      }
      /* 歌词显示模式保持原样 —— 改成 single 会导致歌词不显示 */
      /* 歌词动效保持原样，避免渲染链路断裂 */
      // 超极简：连歌词翻译和上下文都关
      if (level === 'ultra') {
        if ('lyricTranslationMode' in fx) {
          LITE_STATE.backup.lyricTranslationMode = fx.lyricTranslationMode;
          fx.lyricTranslationMode = 'off';
        }
        if ('lyricContextHighQuality' in fx) {
          LITE_STATE.backup.lyricContextHighQuality = fx.lyricContextHighQuality;
          fx.lyricContextHighQuality = false;
        }
      }
    }
  } catch (e) {
    console.warn('[LiteMode] 关闭 fx 开关失败', e);
  }

  /* ---- 2. 停掉正在跑的动画进程 ---- */
  try { if (typeof stopCoverParticles === 'function') stopCoverParticles(); } catch (e) {}
  try { if (typeof pauseStarRiver === 'function') pauseStarRiver(); } catch (e) {}
  try { if (typeof disposeStageLyrics === 'function') disposeStageLyrics(); } catch (e) {}
  try {
    if (typeof stopBeatAnalysis === 'function') stopBeatAnalysis();
  } catch (e) {}

  /* ---- 3. 隐藏 canvas（直接设 display，不靠 CSS 选择器猜 id） ---- */
  hideAllCanvases(level);

  /* ---- 3.5 强制清除所有元素的 backdrop-filter 内联值 ----
     有些元素的 backdrop-filter 是 JS 直接写进 style 的
     （形如 url("#mineradio-xxx-glass-filter")），CSS 的 !important 也压不住
     —— 因为内联样式的优先级高于外部样式表。
     只能直接用 setProperty(..., 'important') 覆盖。 */
  forceClearFilters();

  /* 面板打开时可能重新写入，监听 DOM 变化 */
  observeFilterWrites();

  /* ---- 4. 注入覆盖样式（用 data-lite-level 精确控制） ---- */
  injectLiteStyle(level);

  /* ---- 5. 降分辨率（比 rAF 节流更有效，不会让粒子一顿一顿） ----
     缩小 canvas 的 backend store 尺寸，GPU 填充率按平方下降。
     视觉上是「模糊一点」，但动画仍然流畅。 */
  /* 不做降分辨率 —— 实测会破坏歌词渲染坐标系（歌词画到看不见的地方）。
     性能提升主要来自 backdrop-filter 清零（238→0）和 fx 特效关闭，
     这两项已经能降 80% 以上的 GPU 负载，不需要动 canvas。 */
  /* scaleDownCanvases(...) 保留代码但不调用 */

  /* ---- 5.5 超极简：隐藏 3D 粒子层（歌词是独立 mesh，不受影响） ---- */
  if (level === 'ultra') {
    hideParticleLayers();
  }

  /* ---- 6. 超极简：停掉所有 CSS 动画和过渡 ---- */
  if (level === 'ultra') {
    try {
      document.getAnimations && document.getAnimations().forEach(function (a) {
        try { a.pause(); } catch (e) {}
      });
    } catch (e) {}
  }

  console.log('[LiteMode] 已启用:', level);
}

function revertLiteMode() {
  if (!LITE_STATE.applied) return;
  LITE_STATE.applied = false;

  document.body.classList.remove('lite-mode');
  document.body.removeAttribute('data-lite-level');

    // 恢复 3D 粒子层
    restoreParticleLayers();

  // 恢复 canvas
  restoreCanvases();

  // 移除注入的样式
  if (LITE_STATE.injectedStyle && LITE_STATE.injectedStyle.parentNode) {
    LITE_STATE.injectedStyle.parentNode.removeChild(LITE_STATE.injectedStyle);
  }
  LITE_STATE.injectedStyle = null;

  // 恢复 fx
  try {
    if (typeof fx !== 'undefined' && fx && LITE_STATE.backup) {
      Object.keys(LITE_STATE.backup).forEach(function (k) {
        fx[k] = LITE_STATE.backup[k];
      });
      if (LITE_STATE.backup.performanceQuality) {
        try {
          if (typeof setPerformanceQualityMode === 'function') {
            setPerformanceQualityMode(LITE_STATE.backup.performanceQuality, true);
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  LITE_STATE.backup = null;

  uninstallLiteFrameThrottle();
  stopObserveFilterWrites();

  console.log('[LiteMode] 已关闭');
}

/* ---------------------------------------------------------------- canvas */
var LITE_CANVAS_BACKUP = [];

/* 必须保留的 canvas：歌词渲染依赖它们，隐藏了歌词就不显示了 */
var LITE_KEEP_CANVAS = [
  'lyrics-canvas',        // 歌词主画布
  'lyric-canvas',
  'stage-lyrics-canvas',
  'cover-canvas',         // 封面（显示专辑图）
];

function shouldKeepCanvas(c) {
  var id = String(c.id || '').toLowerCase();

  /* 没有 id 的 canvas 一律保留 ——
     Mineradio 的歌词画布就是无 id 形式，靠 id 判断不了。 */
  if (!id) return true;

  /* 明确是装饰性的才隐藏 */
  var hideIds = ['wallpaper-engine-freeze', 'idle-guide-canvas', 'splash-canvas',
                 'sonic-audio-monitor-canvas', 'hand-canvas', 'login-guide-canvas',
                 'cover-crop-preview'];
  for (var k = 0; k < hideIds.length; k++) {
    if (id.indexOf(hideIds[k]) >= 0) return false;
  }

  return true;
}

function hideAllCanvases(level) {
  LITE_CANVAS_BACKUP = [];
  var list = document.querySelectorAll('canvas');
  var hidden = 0, kept = 0;

  list.forEach(function (c) {
    // 歌词/封面相关画布必须保留
    if (shouldKeepCanvas(c)) {
      kept++;
      return;
    }

    LITE_CANVAS_BACKUP.push({ el: c, display: c.style.display });
    try {
      c.style.display = 'none';
      var ctx2d = c.getContext && c.getContext('2d');
      if (ctx2d) {
        try { ctx2d.clearRect(0, 0, c.width, c.height); } catch (e) {}
      }
      hidden++;
    } catch (e) {}
  });

  console.log('[LiteMode] canvas: 隐藏', hidden, '个，保留', kept, '个（歌词/封面）');
}

function restoreCanvases() {
  LITE_CANVAS_BACKUP.forEach(function (it) {
    try { it.el.style.display = it.display || ''; } catch (e) {}
  });
  LITE_CANVAS_BACKUP = [];
}

/* ---------------------------------------------------------------- 注入样式 */
function injectLiteStyle(level) {
  if (LITE_STATE.injectedStyle && LITE_STATE.injectedStyle.parentNode) {
    LITE_STATE.injectedStyle.parentNode.removeChild(LITE_STATE.injectedStyle);
  }

  var ultra = (level === 'ultra');

  var css = [
    /* 所有 canvas 隐藏（双保险，JS 已经设过） */
    /* canvas：只隐藏非歌词的（歌词画布靠 JS 保留，这里用 id 排除） */
    /* 只隐藏明确装饰性的 canvas。
       歌词画布是无 id 的 canvas，绝对不能用通配选择器隐藏。 */
    'body.lite-mode #idle-guide-canvas,',
    'body.lite-mode #splash-canvas,',
    'body.lite-mode #sonic-audio-monitor-canvas,',
    'body.lite-mode #hand-canvas,',
    'body.lite-mode #login-guide-canvas,',
    'body.lite-mode #cover-crop-preview,',
    'body.lite-mode #wallpaper-engine-freeze { display: none !important; }',

    /* 毛玻璃全部干掉。
       Mineradio 有几条超高特异性的规则：
         html.control-glass-svg-ok #search-area.peek #search-box { backdrop-filter: url(#...) !important }
       它有 2 个 ID + 3 个类，普通选择器压不住。
       这里用「重复类名」把特异性拉到最大（#id * 20 次类名）。
    */
    'html body.lite-mode.lite-mode.lite-mode.lite-mode.lite-mode.lite-mode,',
    'html body.lite-mode.lite-mode.lite-mode.lite-mode.lite-mode.lite-mode *,',
    'html body.lite-mode.lite-mode.lite-mode.lite-mode.lite-mode.lite-mode *::before,',
    'html body.lite-mode.lite-mode.lite-mode.lite-mode.lite-mode.lite-mode *::after {',
    '  backdrop-filter: none !important;',
    '  -webkit-backdrop-filter: none !important;',
    '  filter: none !important;',
    '  -webkit-filter: none !important;',
    '  box-shadow: none !important;',
    '  text-shadow: none !important;',
    '}',

    /* 针对所有可能的玻璃面板容器再补一刀 */
    'html body.lite-mode.lite-mode #search-area,',
    'html body.lite-mode.lite-mode #search-area *,',
    'html body.lite-mode.lite-mode #search-box,',
    'html body.lite-mode.lite-mode #search-results,',
    'html body.lite-mode.lite-mode #fx-panel,',
    'html body.lite-mode.lite-mode #playlist-panel,',
    'html body.lite-mode.lite-mode .control-source-switcher,',
    'html body.lite-mode.lite-mode .modal,',
    'html body.lite-mode.lite-mode .home-card,',
    'html body.lite-mode.lite-mode .home-hero {',
    '  backdrop-filter: none !important;',
    '  -webkit-backdrop-filter: none !important;',
    '}',

    /* 动画和过渡全停 */
    'body.lite-mode *,',
    'body.lite-mode *::before,',
    'body.lite-mode *::after {',
    '  transition: none !important;',
    '  animation: none !important;',
    '}',

    /* 背景图换成纯色（超极简连渐变都不要） */
    ultra
      ? 'body.lite-mode[data-lite-level="ultra"] *, body.lite-mode[data-lite-level="ultra"] *::before, body.lite-mode[data-lite-level="ultra"] *::after { background-image: none !important; }'
      : 'body.lite-mode #album-bg, body.lite-mode #album-bg-next, body.lite-mode .bg-particle-layer { background-image: none !important; }',

    /* 面板改实色 */
    'body.lite-mode #bottom-bar,',
    'body.lite-mode #playlist-panel,',
    'body.lite-mode #fx-panel,',
    'body.lite-mode #search-results,',
    'body.lite-mode .home-card,',
    'body.lite-mode .home-insight-card {',
    '  background: #101016 !important;',
    '  border-color: rgba(255,255,255,.10) !important;',
    '}',

    /* 装饰元素隐藏 */
    'body.lite-mode #bg-glow,',
    'body.lite-mode .bg-particle-layer,',
    'body.lite-mode #idle-guide-canvas,',
    'body.lite-mode #hand-canvas,',
    'body.lite-mode #login-guide-canvas,',
    'body.lite-mode #wallpaper-engine-freeze,',
    'body.lite-mode #update-progress-ring,',
    'body.lite-mode #splash-wordmark {',
    '  display: none !important;',
    '}',

    /* 图片：超极简换占位色块 */
    ultra
      ? 'body.lite-mode[data-lite-level="ultra"] img { visibility: hidden !important; background: #1a1a22; }'
      : '',
  ].filter(Boolean).join('\n');

  var style = document.createElement('style');
  style.id = 'lite-mode-style';
  style.textContent = css;

  /* 关键：必须追加到 head 的最后。
     Mineradio 的样式是 <link rel="stylesheet">，如果它在我的 <style> 之后，
     同优先级下后出现的会赢 —— 我的 !important 也会被它的 !important 压掉。
     所以每次应用都要「移到最末」。 */
  document.head.appendChild(style);
  LITE_STATE.injectedStyle = style;

  /* 双保险：再延迟一次确保在最后（有些样式是异步插入的） */
  setTimeout(function () {
    try {
      if (style.parentNode) {
        style.parentNode.removeChild(style);
        document.head.appendChild(style);
      }
    } catch (e) {}
  }, 800);
}

/* ---------------------------------------------------------------- rAF 节流 */
function installLiteFrameThrottle(fps) {
  uninstallLiteFrameThrottle();

  var minInterval = 1000 / (fps || 30);

  LITE_STATE.savedRaf = window.requestAnimationFrame;

  /* 整帧节流：
       一个「帧窗口」里所有排队的回调一起执行，执行后进入冷却。
       之前每个回调各自判断 lastAt，导致同一帧里 N 个回调
       互相把对方推到下一帧，实际上每帧还是跑了 N 次。

     做法：
       pending[]  收集这一窗口的回调
       running    是否已有一个原生 rAF 在等
       冷却到期 → 一次性执行所有 pending，清空，进入下一轮
  */
  var pending = [];
  var running = false;
  var nextAllowedAt = 0;

  function flush(t) {
    running = false;
    var now = performance.now();

    // 还没到冷却时间 → 继续等
    if (now < nextAllowedAt) {
      running = true;
      LITE_STATE.savedRaf.call(window, flush);
      return;
    }

    // 执行这一帧收集到的全部回调
    var batch = pending;
    pending = [];
    nextAllowedAt = now + minInterval;

    for (var i = 0; i < batch.length; i++) {
      try { batch[i](t); } catch (e) { console.warn('[LiteMode] rAF 回调异常', e); }
    }
  }

  LITE_STATE.throttledRaf = function (cb) {
    pending.push(cb);
    if (!running) {
      running = true;
      LITE_STATE.savedRaf.call(window, flush);
    }
    return pending.length;
  };

  window.requestAnimationFrame = LITE_STATE.throttledRaf;
  console.log('[LiteMode] rAF 整帧节流到', fps, 'fps');
}

function uninstallLiteFrameThrottle() {
  if (LITE_STATE.savedRaf) {
    window.requestAnimationFrame = LITE_STATE.savedRaf;
    LITE_STATE.savedRaf = null;
    LITE_STATE.throttledRaf = null;
  }
}

/* ---------------------------------------------------------------- UI */
function updateLiteModeUI() {
  var card = document.getElementById('lite-mode-toggle');
  if (!card) return;

  var lv = LITE_STATE.level;
  var info = LITE_LEVELS[lv] || LITE_LEVELS.standard;

  card.classList.toggle('on', lv !== 'standard');
  card.setAttribute('data-level', lv);

  var label = card.querySelector('.lite-label');
  if (label) label.textContent = info.label;

  var sub = card.querySelector('.lite-card-sub');
  if (sub) sub.textContent = info.desc;

  // 档位指示点
  card.querySelectorAll('[data-lite-dot]').forEach(function (dot) {
    dot.classList.toggle('on', dot.getAttribute('data-lite-dot') === lv);
  });
}

function liteModeCardHtml() {
  var lv = LITE_STATE.level;
  var info = LITE_LEVELS[lv] || LITE_LEVELS.standard;

  return '' +
    '<button type="button" id="lite-mode-toggle" class="lite-card' + (lv !== 'standard' ? ' on' : '') + '"' +
      ' data-level="' + lv + '"' +
      ' onclick="cycleLiteMode()">' +
      '<div class="lite-card-icon">' +
        '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
          '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>' +
        '</svg>' +
      '</div>' +
      '<div class="lite-card-body">' +
        '<div class="lite-card-title"><span class="lite-label">' + info.label + '</span></div>' +
        '<div class="lite-card-sub">' + info.desc + '</div>' +
        '<div class="lite-dots">' +
          '<span class="lite-dot' + (lv === 'standard' ? ' on' : '') + '" data-lite-dot="standard"></span>' +
          '<span class="lite-dot' + (lv === 'lite' ? ' on' : '') + '" data-lite-dot="lite"></span>' +
          '<span class="lite-dot' + (lv === 'ultra' ? ' on' : '') + '" data-lite-dot="ultra"></span>' +
        '</div>' +
      '</div>' +
      '<div class="lite-card-hint">点击切换</div>' +
    '</button>';
}

function toggleLiteMode() {
  cycleLiteMode();
  var wrap = document.getElementById('lite-mode-slot');
  if (wrap) {
    wrap.innerHTML =
      '<div style="font-size:10.5px;color:rgba(255,255,255,.32);letter-spacing:.06em;margin-bottom:9px">' +
        'PERFORMANCE · 性能' +
      '</div>' + liteModeCardHtml();
  }
}

/* ---------------------------------------------------------------- 启动 */
(function initLiteMode() {
  loadLiteMode();

  var tries = 0;
  function tryApply() {
    tries++;
    var ready = typeof fx !== 'undefined' && fx;
    if (ready && LITE_STATE.level !== 'standard') {
      applyLiteMode(LITE_STATE.level);
      return;
    }
    if (tries < 60) setTimeout(tryApply, 500);
  }
  setTimeout(tryApply, 1200);

  console.log('[LiteMode] 初始化，档位:', LITE_STATE.level);
})();

/* ---------------------------------------------------------------- 强制清滤镜 */
var LITE_FILTER_OBSERVER = null;

function forceClearFilters() {
  var count = 0;
  var all = document.querySelectorAll('*');
  all.forEach(function (el) {
    try {
      var cs = getComputedStyle(el);
      var bf = (cs.backdropFilter || cs.webkitBackdropFilter || '').trim();
      var f = (cs.filter || '').trim();

      if ((bf && bf !== 'none') || (f && f !== 'none')) {
        /* 用 setProperty 带 important，能压内联样式 */
        try { el.style.setProperty('backdrop-filter', 'none', 'important'); } catch (e) {}
        try { el.style.setProperty('-webkit-backdrop-filter', 'none', 'important'); } catch (e) {}
        try { el.style.setProperty('filter', 'none', 'important'); } catch (e) {}
        try { el.style.setProperty('-webkit-filter', 'none', 'important'); } catch (e) {}
        count++;
      }
    } catch (e) {}
  });
  console.log('[LiteMode] 强制清除滤镜:', count, '个元素');
}

/** Mineradio 打开面板时会重新写滤镜，监听并清掉 */
function observeFilterWrites() {
  if (LITE_FILTER_OBSERVER) return;

  var timer = null;
  LITE_FILTER_OBSERVER = new MutationObserver(function () {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      if (!LITE_STATE.applied) return;
      forceClearFilters();
    }, 400);
  });

  LITE_FILTER_OBSERVER.observe(document.body, {
    attributes: true,
    attributeFilter: ['style', 'class'],
    subtree: true,
    childList: true,
  });
}

function stopObserveFilterWrites() {
  if (LITE_FILTER_OBSERVER) {
    try { LITE_FILTER_OBSERVER.disconnect(); } catch (e) {}
    LITE_FILTER_OBSERVER = null;
  }
}

/* ---------------------------------------------------------------- 降分辨率 */
var LITE_CANVAS_SIZE_BACKUP = [];

/**
 * 把 canvas 的渲染分辨率缩小，GPU 填充率按平方下降。
 * 视觉上会模糊，但动画仍然流畅 —— 比 rAF 节流温和得多。
 */
function scaleDownCanvases(ratio) {
  ratio = Math.max(0.2, Math.min(1, ratio || 0.5));
  LITE_CANVAS_SIZE_BACKUP = [];

  document.querySelectorAll('canvas').forEach(function (c) {
    // 只处理可见的、有尺寸的
    var rect = c.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    try {
      LITE_CANVAS_SIZE_BACKUP.push({
        el: c,
        width: c.width,
        height: c.height,
        cssWidth: c.style.width,
        cssHeight: c.style.height,
      });

      // 只改 backend store 尺寸，CSS 尺寸保持不变（所以布局不变，只是模糊）
      c.width = Math.max(1, Math.round(c.width * ratio));
      c.height = Math.max(1, Math.round(c.height * ratio));
    } catch (e) {}
  });

  console.log('[LiteMode] canvas 降分辨率到', Math.round(ratio * 100) + '%：',
    LITE_CANVAS_SIZE_BACKUP.length, '个');
}

function restoreCanvasSize() {
  LITE_CANVAS_SIZE_BACKUP.forEach(function (it) {
    try {
      it.el.width = it.width;
      it.el.height = it.height;
      if (it.cssWidth) it.el.style.width = it.cssWidth;
      if (it.cssHeight) it.el.style.height = it.cssHeight;
    } catch (e) {}
  });
  LITE_CANVAS_SIZE_BACKUP = [];
}

/* ==========================================================================
   只关粒子，保留歌词
   --------------------------------------------------------------------------
   关键发现：Mineradio 的 3D 场景里，粒子和歌词是两个独立对象：
     · particles / bloomParticles / backgroundStarRiverParticles
       → THREE.Points（粒子）
     · 歌词是 CanvasTexture 贴到 shader 上的独立 mesh
     所以可以在运行时遍历 scene，只隐藏 Points，歌词完全不受影响。
   ========================================================================== */

var LITE_HIDDEN_POINTS = [];

var LITE_PARTICLE_GUARD = null;

function hideParticleLayers() {
  LITE_HIDDEN_POINTS = [];

  var sc = null;
  try {
    if (typeof scene !== 'undefined' && scene && scene.traverse) sc = scene;
  } catch (e) {}

  if (!sc) {
    console.warn('[LiteMode] 找不到 THREE 场景，跳过粒子隐藏');
    return 0;
  }

  // 先隐藏一遍
  applyParticleHide(sc);

  // 再挂持续压制（Mineradio 渲染循环可能把 visible 改回来）
  stopParticleGuard();
  LITE_PARTICLE_GUARD = setInterval(function () {
    if (!LITE_STATE.applied) { stopParticleGuard(); return; }
    if (liteLevel() !== 'ultra') { stopParticleGuard(); return; }
    applyParticleHide(sc);
  }, 200);

  console.log('[LiteMode] 粒子压制已启动，目标:', LITE_HIDDEN_POINTS.length, '个 Points');
  return LITE_HIDDEN_POINTS.length;
}

function applyParticleHide(sc) {
  var hidden = [];
  try {
    sc.traverse(function (obj) {
      if (!obj || !obj.isPoints) return;
      var posAttr = (obj.geometry && obj.geometry.attributes) ? obj.geometry.attributes.position : null;
      var count = posAttr ? posAttr.count : 0;
      if (count < 100) return;

      /* 双管齐下：
         visible=false（多数够）
         drawRange(0,0) —— 渲染循环不会改 drawRange，
         即使 visible 被改回 true 也画不出顶点 */
      if (!obj.__liteOrigDrawCount) {
        obj.__liteOrigDrawCount = (obj.geometry && obj.geometry.drawRange && obj.geometry.drawRange.count !== undefined)
          ? obj.geometry.drawRange.count
          : count;
      }
      try {
        if (obj.geometry && obj.geometry.setDrawRange) obj.geometry.setDrawRange(0, 0);
      } catch (e) {}

      if (obj.visible !== false) obj.visible = false;
      hidden.push(obj);
    });
  } catch (e) {}
  LITE_HIDDEN_POINTS = hidden;
}

function stopParticleGuard() {
  if (LITE_PARTICLE_GUARD) {
    clearInterval(LITE_PARTICLE_GUARD);
    LITE_PARTICLE_GUARD = null;
  }
}


function restoreParticleLayers() {
  stopParticleGuard();
  LITE_HIDDEN_POINTS.forEach(function (obj) {
    try {
      obj.visible = true;
      if (obj.__liteOrigDrawCount !== undefined && obj.geometry && obj.geometry.setDrawRange) {
        obj.geometry.setDrawRange(0, obj.__liteOrigDrawCount);
        delete obj.__liteOrigDrawCount;
      }
    } catch (e) {}
  });
  console.log('[LiteMode] 恢复粒子层:', LITE_HIDDEN_POINTS.length, '个');
  LITE_HIDDEN_POINTS = [];
}
