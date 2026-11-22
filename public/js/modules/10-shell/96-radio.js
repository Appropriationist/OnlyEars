/* ==========================================================================
   每日电台
   --------------------------------------------------------------------------
   数据来自 /api/radio/daily：
     · 用日期做种子，同一天结果固定，跨天自动换
     · 后端已过滤：时长 90-480 秒、非音乐内容、多P视频
     · 同一 UP 主最多 2 首

   界面：
     · 顶部：今日电台 / 日期 / 关键词标签
     · 列表：封面 + 歌名 + UP 主 + 时长 + 播放量
     · 底部：全部播放按钮

   播放：整段电台作为播放上下文，播完循环。
   ========================================================================== */

var RADIO_UI = {
  data: null,
  loading: false,
  loadedAt: 0,
};

function ensureRadioPanel() {
  var old = document.getElementById('radio-panel');
  if (old) return old;

  var d = document.createElement('div');
  d.id = 'radio-panel';
  d.className = 'radio-mask';
  d.innerHTML =
    '<div class="radio-card">' +
      '<div class="radio-head">' +
        '<div class="radio-head-left">' +
          '<div class="radio-title">每日电台</div>' +
          '<div class="radio-sub" id="radio-sub">正在生成…</div>' +
          '<div class="radio-tags" id="radio-tags"></div>' +
        '</div>' +
        '<div class="radio-head-right">' +
          '<button type="button" class="radio-playall" onclick="playAllRadio()">' +
            '<svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
            '全部播放' +
          '</button>' +
          '<button type="button" class="radio-close" data-radio-close="1" title="关闭">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="radio-body" id="radio-body"></div>' +
    '</div>';
  document.body.appendChild(d);

  d.addEventListener('click', function (e) {
    if (e.target === d || e.target.closest('[data-radio-close]')) closeRadioPanel();
  });
  return d;
}

function openRadioPanel() {
  var d = ensureRadioPanel();
  d.classList.add('show');
  loadRadio();
}

function closeRadioPanel() {
  var d = document.getElementById('radio-panel');
  if (d) d.classList.remove('show');
}

async function loadRadio(force) {
  var body = document.getElementById('radio-body');
  var sub = document.getElementById('radio-sub');
  if (!body) return;

  // 30 分钟内不重复请求
  if (!force && RADIO_UI.data && Date.now() - RADIO_UI.loadedAt < 30 * 60 * 1000) {
    renderRadio();
    return;
  }

  body.innerHTML =
    '<div class="radio-loading">' +
      '<div class="radio-spinner"></div>' +
      '<div>正在从 B站挑选今日歌曲…</div>' +
      '<div class="radio-loading-hint">约 1 秒</div>' +
    '</div>';
  if (sub) sub.textContent = '正在生成…';

  try {
    var r = await fetch('/api/radio/daily?limit=30').then(function (x) { return x.json(); });
    RADIO_UI.data = r || { songs: [], keywords: [] };
    RADIO_UI.loadedAt = Date.now();
    renderRadio();
  } catch (e) {
    body.innerHTML =
      '<div class="radio-empty">' +
        '<div>获取失败</div>' +
        '<div class="radio-empty-sub">' + escR(e.message) + '</div>' +
        '<button type="button" class="radio-retry" onclick="loadRadio(true)">重试</button>' +
      '</div>';
    if (sub) sub.textContent = '';
  }
}

function renderRadio() {
  var body = document.getElementById('radio-body');
  var sub = document.getElementById('radio-sub');
  var tags = document.getElementById('radio-tags');
  if (!body) return;

  var data = RADIO_UI.data || {};
  var songs = data.songs || [];
  var kws = data.keywords || [];

  if (sub) {
    var today = new Date();
    var ds = today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日';
    sub.textContent = ds + ' · ' + songs.length + ' 首 · 每天自动换一批';
  }

  if (tags) {
    tags.innerHTML = kws.map(function (k) {
      return '<span class="radio-tag">' + escR(k) + '</span>';
    }).join('');
  }

  if (!songs.length) {
    body.innerHTML =
      '<div class="radio-empty">' +
        '<div>今天没挑到合适的歌</div>' +
        '<div class="radio-empty-sub">试试手动搜索</div>' +
        '<button type="button" class="radio-retry" onclick="loadRadio(true)">重新生成</button>' +
      '</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < songs.length; i++) {
    var s = songs[i];
    var cover = s.cover
      ? '<img src="' + escR(s.cover) + '" alt="" loading="lazy" onerror="this.style.opacity=.2">'
      : '<div class="radio-cover-ph">♪</div>';
    var m = Math.floor((s.duration || 0) / 60000);
    var sec = Math.floor(((s.duration || 0) % 60000) / 1000);
    var dur = m + ':' + (sec < 10 ? '0' : '') + sec;

    html += '<div class="radio-row" data-radio-idx="' + i + '">' +
        '<span class="radio-idx">' + (i + 1) + '</span>' +
        cover +
        '<div class="radio-info">' +
          '<div class="radio-name">' + escR(s.name) + '</div>' +
          '<div class="radio-meta">' + escR(s.artist || '未知') +
            ' · ' + dur + ' · ' + fmtPlayR(s.play) + '</div>' +
        '</div>' +
        '<button type="button" class="radio-row-play" title="播放">' +
          '<svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
        '</button>' +
      '</div>';
  }
  body.innerHTML = html;

  body.querySelectorAll('[data-radio-idx]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target.closest('.radio-row-play')) return;
      var idx = +el.getAttribute('data-radio-idx');
      playRadioFrom(idx);
    });
    var btn = el.querySelector('.radio-row-play');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        playRadioFrom(+el.getAttribute('data-radio-idx'));
      });
    }
  });
}

/** 从电台第 idx 首开始播 */
function playRadioFrom(idx) {
  var data = RADIO_UI.data || {};
  var songs = data.songs || [];
  if (!songs.length) return;

  var items = songs.map(function (s) {
    return {
      provider: 'bili', source: 'bili', type: 'song',
      id: s.bvid,
      bvid: s.bvid,
      name: s.name,
      artist: s.artist || '',
      cover: s.cover || '',
      duration: s.duration || 0,
    };
  });

  if (typeof setPlayContext === 'function') {
    setPlayContext({
      type: 'radio',
      id: String(data.date || ''),
      name: '每日电台',
      songs: items,
    }, idx || 0);
    try {
      if (typeof playQueueAt === 'function') playQueueAt(idx || 0);
    } catch (e) {}
  }

  closeRadioPanel();
}

function playAllRadio() {
  playRadioFrom(0);
}

/* ---------------------------------------------------------------- 工具 */
function escR(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPlayR(n) {
  n = Number(n) || 0;
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

/* ==========================================================================
   电台无限续播
   --------------------------------------------------------------------------
   用户听完最后 2 首时，自动去要下一批，追加到队列末尾。
   这样「听完 21 首」不会停，会一直续下去，直到用户手动切走。

   机制：
     · 监听播放进度，当前是倒数第 2 首时触发
     · 请求 /api/radio/next（排除已播过的 bvid）
     · 追加到 PLAY_CTX.songs 和 playQueue 末尾
     · 有 30 秒冷却，避免重复请求
   ========================================================================== */

var RADIO_CONTINUE = {
  timer: null,
  fetching: false,
  lastFetchAt: 0,
  offset: 1,
  played: {},      // bvid -> true（已播过的，不再要）
  exhausted: false,
};

/** 开始监听续播 */
function startRadioContinueWatch() {
  stopRadioContinueWatch();
  RADIO_CONTINUE.lastFetchAt = 0;
  RADIO_CONTINUE.exhausted = false;

  // 记录当前批次所有 bvid
  try {
    if (typeof PLAY_CTX !== 'undefined' && PLAY_CTX.type === 'radio') {
      PLAY_CTX.songs.forEach(function (s) {
        if (s.bvid) RADIO_CONTINUE.played[s.bvid] = true;
      });
    }
  } catch (e) {}

  RADIO_CONTINUE.timer = setInterval(checkRadioContinue, CFG.PANEL_WATCH_INTERVAL);
}

function stopRadioContinueWatch() {
  if (RADIO_CONTINUE.timer) {
    clearInterval(RADIO_CONTINUE.timer);
    RADIO_CONTINUE.timer = null;
  }
}

function checkRadioContinue() {
  if (RADIO_CONTINUE.fetching || RADIO_CONTINUE.exhausted) return;

  try {
    // 只在电台上下文里续播
    if (typeof PLAY_CTX === 'undefined' || PLAY_CTX.type !== 'radio') {
      stopRadioContinueWatch();
      return;
    }
    if (typeof playQueue === 'undefined' || currentIdx < 0) return;

    // 记录当前播到哪首
    var cur = playQueue[currentIdx];
    if (cur && cur.bvid) RADIO_CONTINUE.played[cur.bvid] = true;

    // 距离末尾还有 2 首以上 → 不急
    var remain = playQueue.length - currentIdx - 1;
    if (remain > 2) return;

    // 冷却时间：30 秒
    if (Date.now() - RADIO_CONTINUE.lastFetchAt < 30000) return;

    fetchNextRadioBatch();
  } catch (e) {
    console.warn('[Radio] 续播检查失败', e);
  }
}

async function fetchNextRadioBatch() {
  if (RADIO_CONTINUE.fetching) return;
  RADIO_CONTINUE.fetching = true;
  RADIO_CONTINUE.lastFetchAt = Date.now();

  try {
    var exclude = Object.keys(RADIO_CONTINUE.played);
    var r = await fetch('/api/radio/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: 20,
        exclude: exclude,
        offset: RADIO_CONTINUE.offset,
      }),
    }).then(function (x) { return x.json(); });

    var songs = (r && r.songs) || [];
    if (!songs.length) {
      RADIO_CONTINUE.exhausted = true;
      console.log('[Radio] 没有更多新歌了');
      return;
    }

    RADIO_CONTINUE.offset = (r.offset || RADIO_CONTINUE.offset) + 1;

    // 转成播放项
    var items = songs.map(function (s) {
      RADIO_CONTINUE.played[s.bvid] = true;
      return {
        provider: 'bili', source: 'bili', type: 'song',
        id: s.bvid, bvid: s.bvid,
        name: s.name,
        artist: s.artist || '',
        cover: s.cover || '',
        duration: s.duration || 0,
      };
    });

    // 追加到 PLAY_CTX 和 playQueue
    if (typeof PLAY_CTX !== 'undefined' && Array.isArray(PLAY_CTX.songs)) {
      for (var i = 0; i < items.length; i++) PLAY_CTX.songs.push(items[i]);
    }
    if (typeof playQueue !== 'undefined') {
      for (var k = 0; k < items.length; k++) {
        playQueue.push(typeof cloneSongLite === 'function' ? cloneSongLite(items[k]) : items[k]);
      }
      try {
        if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('radio-continue');
      } catch (e) {}
    }
    if (typeof updatePlayContextBadge === 'function') updatePlayContextBadge();

    console.log('[Radio] 续播追加', items.length, '首，队列现在', playQueue.length, '首');
    showToastSafe('电台已续上 ' + items.length + ' 首');
  } catch (e) {
    console.warn('[Radio] 续播失败', e);
  } finally {
    RADIO_CONTINUE.fetching = false;
  }
}