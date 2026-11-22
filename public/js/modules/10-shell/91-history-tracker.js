/* ==========================================================================
   播放历史 · 自动记录
   --------------------------------------------------------------------------
   规则：一首歌连续播够 10 秒才计入历史。
     · 避免误记（点一下就切走的歌不该进历史）
     · 同一首播完再播算两次
     · 拖动进度条不会重复计数（用 trackSwitchToken 判断是不是同一首）

   记录内容：
     歌名/歌手/专辑/封面/时长 + 当前用的 B站 bvid + 音源标题和分数
     后端按「歌名+歌手」去重，同一首歌的多个音源版本会归到一条。
   ========================================================================== */

var HISTORY_TRACKER = {
  token: null,          // 当前跟踪的播放 token
  recorded: false,      // 这一首是否已记录过
  timer: null,
  startedAt: 0,
};

var HISTORY_MIN_SECONDS = 10;

/** 开始跟踪一首歌 */
function trackHistoryForSong(song) {
  if (!song || song.type === 'local' && false) return;

  // 换歌了 → 重置
  var token = (typeof trackSwitchToken !== 'undefined') ? trackSwitchToken : song.name;
  if (HISTORY_TRACKER.token !== token) {
    cancelHistoryTimer();
    HISTORY_TRACKER.token = token;
    HISTORY_TRACKER.recorded = false;
    HISTORY_TRACKER.startedAt = Date.now();
    HISTORY_TRACKER.song = song;

    // 10 秒后记录
    HISTORY_TRACKER.timer = setTimeout(function () {
      recordHistoryNow(song);
    }, HISTORY_MIN_SECONDS * 1000);
  }
}

function cancelHistoryTimer() {
  if (HISTORY_TRACKER.timer) {
    clearTimeout(HISTORY_TRACKER.timer);
    HISTORY_TRACKER.timer = null;
  }
}

/** 真正写入历史 */
function recordHistoryNow(song) {
  if (!song || HISTORY_TRACKER.recorded) return;
  HISTORY_TRACKER.recorded = true;

  var bvid = song.bvid || '';
  // 从 bvideo 里提取真正的 bvid（有些地方会把 bvid 放在 id 里）
  if (!bvid && /^BV[0-9A-Za-z]{10}$/.test(String(song.id || ''))) {
    bvid = song.id;
  }

  /* 音源信息：如果是从找音源页选的，song 上带着候选数据 */
  var sourceTitle = '';
  var sourceAuthor = '';
  var score = 0;
  if (song.biliCandidates && song.biliCandidates.length) {
    var cur = song.biliCandidates.filter(function (c) { return c.bvid === bvid; })[0];
    if (cur) {
      sourceTitle = cur.title || '';
      sourceAuthor = cur.author || '';
      score = cur.score || 0;
    }
  }

  var payload = {
    name: song.name || song.title || '',
    artist: song.artist || '',
    album: song.album || '',
    cover: song.cover || '',
    duration: song.duration || 0,
    bvid: bvid,
    sourceTitle: sourceTitle,
    sourceAuthor: sourceAuthor,
    score: score,
  };

  if (!payload.name) return;

  fetch('/api/history/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res && res.ok) {
        console.log('[History] 已记录:', payload.name, payload.artist);
      }
    })
    .catch(function (e) { console.warn('[History] 记录失败', e); });
}

/* ==========================================================================
   钩子：监听播放状态变化
   --------------------------------------------------------------------------
   不侵入 Mineradio 的播放代码，用轮询检查「当前歌变了没」。
   每 1 秒检查一次，变化时重置跟踪。
   ========================================================================== */
(function bindHistoryTracker() {
  var lastKey = '';

  function currentSongKey() {
    try {
      if (typeof playQueue === 'undefined' || typeof currentIdx === 'undefined') return '';
      if (currentIdx < 0 || currentIdx >= playQueue.length) return '';
      var s = playQueue[currentIdx];
      if (!s) return '';
      return (s.name || '') + '|' + (s.artist || '') + '|' + (s.bvid || s.id || '');
    } catch (e) {
      return '';
    }
  }

  function currentSong() {
    try {
      if (typeof playQueue === 'undefined' || typeof currentIdx === 'undefined') return null;
      if (currentIdx < 0 || currentIdx >= playQueue.length) return null;
      return playQueue[currentIdx];
    } catch (e) {
      return null;
    }
  }

  setInterval(function () {
    var key = currentSongKey();
    if (!key) return;

    // 歌变了
    if (key !== lastKey) {
      lastKey = key;
      var song = currentSong();
      if (song) trackHistoryForSong(song);
      return;
    }

    /* 同一首歌：如果之前在暂停状态导致计时中断，
       这里补一次检查（播够 10 秒且还没记录） */
    if (!HISTORY_TRACKER.recorded && HISTORY_TRACKER.song) {
      var elapsed = (Date.now() - HISTORY_TRACKER.startedAt) / 1000;
      var playing = true;
      try {
        if (typeof audio !== 'undefined' && audio) playing = !audio.paused;
      } catch (e) {}
      if (playing && elapsed >= HISTORY_MIN_SECONDS) {
        recordHistoryNow(HISTORY_TRACKER.song);
      }
    }
  }, 1000);
})();
