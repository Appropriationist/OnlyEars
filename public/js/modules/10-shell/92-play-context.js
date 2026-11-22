/* ==========================================================================
   播放上下文（Play Context）
   --------------------------------------------------------------------------
   问题：Mineradio 只有一条 playQueue，所有播放都塞进去。
        点歌单里的歌 → 塞进 playQueue → 播下一首时是队列里的，不是歌单里的。

   解决：引入「上下文」。点歌时把整张歌单 / 整个本地曲库写进 playQueue，
        这样 Mineradio 原有的 next/prev/repeat 全部照常工作 ——
        对 playQueue 来说，"整张歌单"就是它的全部内容。

   数据源（唯一）：
     · 歌单来源   → /api/local-pl/get
     · 本地和下载 → Mineradio 本地曲库（local-music-library.json）

   ⚠ 这个文件里每个函数只定义一次。之前因为重复定义，
     后面的旧版本覆盖了前面的新版本，导致改动全部失效。
   ========================================================================== */

var PLAY_CTX = {
  type: 'queue',
  id: '',
  name: '当前队列',
  songs: [],
};

/* ==========================================================================
   核心：设置上下文
   ========================================================================== */
function setPlayContext(ctx, startIndex) {
  if (!ctx || !Array.isArray(ctx.songs) || !ctx.songs.length) return false;

  PLAY_CTX = {
    type: ctx.type || 'queue',
    id: ctx.id || '',
    name: ctx.name || '播放列表',
    songs: ctx.songs.slice(),
  };

  try {
    if (typeof playQueue === 'undefined') return false;
    playQueue.length = 0;
    for (var i = 0; i < PLAY_CTX.songs.length; i++) {
      playQueue.push(cloneSongLite(PLAY_CTX.songs[i]));
    }
    currentIdx = (startIndex === undefined || startIndex === null) ? 0 : startIndex;
    if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('play-context');
    if (typeof safeShelfRebuild === 'function') safeShelfRebuild('play-context', true);
  } catch (e) {
    console.warn('[PlayContext]', e);
    return false;
  }

  /* 续播监听跟着上下文类型走 ——
     不管是走菜单切换，还是从队列双击某首，只要上下文变成 radio 就启动。 */
  try {
    if (PLAY_CTX.type === 'radio') {
      if (typeof startRadioContinueWatch === 'function') startRadioContinueWatch();
    } else {
      if (typeof stopRadioContinueWatch === 'function') stopRadioContinueWatch();
    }
  } catch (e) {
    console.warn('[PlayContext] 续播监听切换失败', e);
  }

  updatePlayContextBadge();
  return true;
}

function cloneSongLite(s) {
  if (typeof cloneSong === 'function') {
    try { return cloneSong(s); } catch (e) {}
  }
  return Object.assign({}, s);
}

function playContextAt(index) {
  if (!PLAY_CTX.songs.length) return;
  if (index < 0 || index >= PLAY_CTX.songs.length) index = 0;
  setPlayContext(PLAY_CTX, index);
  try {
    if (typeof playQueueAt === 'function') playQueueAt(index);
  } catch (e) { console.warn('[PlayContext]', e); }
}

function clearPlayContext(reasonName) {
  PLAY_CTX = { type: 'queue', id: '', name: '当前队列', songs: [] };
  try {
    if (typeof playQueue !== 'undefined') {
      playQueue.length = 0;
      currentIdx = -1;
      if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('clear-ctx');
    }
  } catch (e) {}
  updatePlayContextBadge();
}

function captureQueueAsContext() {
  try {
    if (typeof playQueue === 'undefined') return;
    PLAY_CTX = {
      type: 'queue',
      id: '',
      name: '当前队列',
      songs: playQueue.map(cloneSongLite),
    };
    updatePlayContextBadge();
  } catch (e) {}
}

/* ==========================================================================
   数据源：本地曲库
   ========================================================================== */
async function readLocalLibrary() {
  try {
    if (!window.desktopWindow || typeof window.desktopWindow.listLocalMusicLibrary !== 'function') return [];
    var lib = await window.desktopWindow.listLocalMusicLibrary();
    var arr = (lib && (lib.tracks || lib.records)) || (Array.isArray(lib) ? lib : []);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[Library] 读取失败', e);
    return [];
  }
}

function libraryTrackToItem(t) {
  return {
    provider: 'local', source: 'local', type: 'local',
    id: t.id || '',
    localKey: t.localKey || '',
    localUrl: t.localUrl || '',
    audioPath: t.audioPath || '',
    localPath: t.audioPath || '',
    name: t.name || '',
    artist: t.artist || '',
    album: t.album || '',
    cover: t.cover || '',
    duration: t.duration || 0,
    lyric: t.lyric || '',
    lyricSource: t.lyricSource || '',
  };
}

/* ==========================================================================
   入口：播本地曲库
   ========================================================================== */
async function playDownloadsAsContext(startIndex) {
  var tracks = await readLocalLibrary();

  if (!tracks.length) {
    clearPlayContext('本地');
    showToastSafe('本地曲库是空的');
    return;
  }

  var items = tracks.map(libraryTrackToItem);

  setPlayContext({
    type: 'local',
    id: '',
    name: '本地和下载',
    songs: items,
  }, startIndex || 0);

  try {
    if (typeof switchPlaylistTab === 'function') {
      switchPlaylistTab('queue', { animate: false, refresh: false });
    }
  } catch (e) {}

  showToastSafe('共 ' + items.length + ' 首');
  try { if (typeof playQueueAt === 'function') playQueueAt(startIndex || 0); } catch (e) {}
}

/* ==========================================================================
   入口：播本地歌单
   ========================================================================== */
function playLocalPlaylistAsContext(playlistId, startIndex) {
  fetch('/api/local-pl/get?id=' + encodeURIComponent(playlistId))
    .then(function (r) { return r.json(); })
    .then(function (pl) {
      var songs = (pl && pl.songs) || [];
      if (!songs.length) { showToastSafe('这个歌单是空的'); return; }

      var items = songs.map(function (s) {
        return {
          provider: 'bili', source: 'bili', type: 'song',
          id: s.bvid || '', bvid: s.bvid || '', cid: s.cid || 0,
          name: s.name || '', artist: s.artist || '', album: s.album || '',
          cover: s.cover || '', duration: s.duration || 0,
        };
      });

      setPlayContext({
        type: 'playlist',
        id: playlistId,
        name: (pl && pl.name) || '歌单',
        songs: items,
      }, startIndex || 0);

      try { if (typeof playQueueAt === 'function') playQueueAt(startIndex || 0); } catch (e) {}
    })
    .catch(function () { showToastSafe('读取歌单失败'); });
}
/* ==========================================================================
   清理本地列表
   --------------------------------------------------------------------------
   原来的「清理失效」自动检测文件是否存在，但 listLocalMusicLibrary()
   返回的对象里没有 audioPath（只有相对路径），前端根本判断不了。

   改成两个明确的操作，由用户决定：
     · 只从列表移除   —— 删曲库记录，磁盘文件保留
     · 同时删磁盘文件 —— 删曲库记录 + 删文件
   ========================================================================== */

async function pruneInvalidLocalTracks(silent) {
  var tracks = await readLocalLibrary();
  if (!tracks.length) {
    if (!silent) showToastSafe('本地曲库是空的');
    return;
  }

  var choice = await askLocalCleanChoice(tracks.length);
  if (!choice) return;

  var ids = tracks.map(function (t) { return t.id; });
  var deleteFile = (choice === 'both');

  try {
    var res = await window.desktopWindow.removeLocalMusicTracks(ids, { deleteFile: deleteFile });
    if (!res || !res.ok) {
      showToastSafe('操作失败：' + (res && res.error || ''));
      return;
    }

    showToastSafe(deleteFile
      ? ('已删除 ' + res.count + ' 首（含磁盘文件 ' + (res.deletedFiles || 0) + ' 个）')
      : ('已从列表移除 ' + res.count + ' 首，文件保留在磁盘'));

    clearPlayContext('清理');
  } catch (e) {
    console.warn('[Clean] 失败', e);
    showToastSafe('操作失败');
  }
}

function askLocalCleanChoice(count) {
  return new Promise(function (resolve) {
    var old = document.getElementById('local-clean-dlg');
    if (old) old.parentNode.removeChild(old);

    var d = document.createElement('div');
    d.id = 'local-clean-dlg';
    d.className = 'lcc-mask';
    d.innerHTML =
      '<div class="lcc-card">' +
        '<div class="lcc-title">清理本地列表</div>' +
        '<div class="lcc-sub">当前列表有 ' + count + ' 首。选择清理方式：</div>' +
        '<button type="button" class="lcc-opt" data-act="list">' +
          '<b>只清空列表</b>' +
          '<small>移除列表里的记录，磁盘上的音乐文件保留</small>' +
        '</button>' +
        '<button type="button" class="lcc-opt danger" data-act="both">' +
          '<b>列表和文件一起删除</b>' +
          '<small>移除记录并删除磁盘文件，不可恢复</small>' +
        '</button>' +
        '<button type="button" class="lcc-cancel" data-act="cancel">取消</button>' +
      '</div>';
    document.body.appendChild(d);

    function done(v) {
      if (d.parentNode) d.parentNode.removeChild(d);
      resolve(v);
    }
    d.addEventListener('click', function (e) {
      if (e.target === d) return done(null);
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'cancel') return done(null);
      done(act);
    });
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); document.removeEventListener('keydown', onKey, true); done(null); }
    }
    document.addEventListener('keydown', onKey, true);
  });
}

/* ==========================================================================
   徽标
   ========================================================================== */
function updatePlayContextBadge() {
  var chip = document.getElementById('play-ctx-chip');
  if (chip) {
    var short = String(PLAY_CTX.name || '当前队列');
    if (short.length > 14) short = short.slice(0, 13) + '…';
    chip.textContent = short;
    chip.title = '播放来源：' + (PLAY_CTX.name || '当前队列') +
      '（' + PLAY_CTX.songs.length + ' 首）';
  }
}

/* ==========================================================================
   播放来源切换菜单
   ========================================================================== */
function togglePlayContextMenu(e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var old = document.getElementById('play-ctx-menu');
  if (old) { old.parentNode.removeChild(old); return; }

  var anchor = document.getElementById('play-ctx-chip');
  if (!anchor) return;
  var r = anchor.getBoundingClientRect();

  var d = document.createElement('div');
  d.id = 'play-ctx-menu';
  d.className = 'pcm-menu';
  d.style.left = Math.max(8, r.left) + 'px';
  d.style.top = (r.bottom + 8) + 'px';

  var html = '<div class="pcm-head">播放来源</div>';

  html += '<button type="button" class="pcm-item' + (PLAY_CTX.type === 'queue' ? ' on' : '') + '"' +
    ' data-ctx="queue"><span>当前队列</span><small>' +
    (PLAY_CTX.type === 'queue' ? PLAY_CTX.songs.length + ' 首' : '手动排的歌') +
    '</small></button>';

  html += '<button type="button" class="pcm-item' + (PLAY_CTX.type === 'radio' ? ' on' : '') + '"' +
    ' data-ctx="radio"><span>每日电台</span><small>' +
    (PLAY_CTX.type === 'radio' ? PLAY_CTX.songs.length + ' 首' : '按日期生成') +
    '</small></button>';

  html += '<button type="button" class="pcm-item' + (PLAY_CTX.type === 'history' ? ' on' : '') + '"' +
    ' data-ctx="history"><span>历史播放</span><small>' +
    (PLAY_CTX.type === 'history' ? PLAY_CTX.songs.length + ' 首' : '听过的歌') +
    '</small></button>';

  html += '<button type="button" class="pcm-item' + (PLAY_CTX.type === 'local' ? ' on' : '') + '"' +
    ' data-ctx="local"><span>本地和下载</span><small>本地曲库</small></button>';

  if (typeof LOCAL_PLAYLISTS !== 'undefined' && LOCAL_PLAYLISTS.length) {
    html += '<div class="pcm-sep">我的歌单</div>';
    for (var i = 0; i < LOCAL_PLAYLISTS.length; i++) {
      var p = LOCAL_PLAYLISTS[i];
      var cur = (PLAY_CTX.type === 'playlist' && PLAY_CTX.id === p.id);
      html += '<button type="button" class="pcm-item' + (cur ? ' on' : '') + '"' +
        ' data-ctx="playlist" data-ctx-id="' + escAttr(p.id) + '">' +
        '<span>' + escAttr(p.name) + '</span>' +
        '<small>' + (p.count || 0) + ' 首</small></button>';
    }
  }

  d.innerHTML = html;
  document.body.appendChild(d);

  d.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-ctx]');
    if (!btn) return;
    var t = btn.getAttribute('data-ctx');
    d.parentNode.removeChild(d);

    if (t === 'queue') {
      captureQueueAsContext();
      showToastSafe('播放来源：当前队列');
      } else if (t === 'radio') {
        playRadioAsContext();
      } else if (t === 'history') {
        playHistoryAsContext();
      } else if (t === 'local') {
        try { if (typeof stopRadioContinueWatch === 'function') stopRadioContinueWatch(); } catch (e) {}
      playDownloadsAsContext(0);
    } else if (t === 'playlist') {
      playLocalPlaylistAsContext(btn.getAttribute('data-ctx-id'), 0);
    }
  });

  setTimeout(function () {
    document.addEventListener('click', function close() {
      var m = document.getElementById('play-ctx-menu');
      if (m) m.parentNode.removeChild(m);
      document.removeEventListener('click', close);
    }, { once: true });
  }, 10);
}

function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 队列被外部改动时同步徽标 */
(function watchQueueChanges() {
  setInterval(function () {
    try {
      if (typeof playQueue === 'undefined') return;
      if (playQueue.length !== PLAY_CTX.songs.length && PLAY_CTX.type === 'queue') {
        captureQueueAsContext();
      }
    } catch (e) {}
  }, CFG.PANEL_WATCH_INTERVAL * 2.5);
})();

/* ==========================================================================
   移除本地歌时的询问
   --------------------------------------------------------------------------
   用户要求：在队列里点「×」删除本地歌时，问清楚是
     · 只从列表删除（文件保留）
     · 列表和文件都删

   并给一个「不再询问」勾选框：
     勾了之后再点 ×，走上次选的方式，不再弹框。
   ========================================================================== */

var REMOVE_LOCAL_PREF_KEY = 'bili-remove-local-pref';

function getRemoveLocalPref() {
  try {
    var v = localStorage.getItem(REMOVE_LOCAL_PREF_KEY);
    if (v === 'list' || v === 'both') return v;
  } catch (e) {}
  return '';   // 空 = 每次都问
}

function setRemoveLocalPref(v) {
  try {
    if (v === 'list' || v === 'both') localStorage.setItem(REMOVE_LOCAL_PREF_KEY, v);
    else localStorage.removeItem(REMOVE_LOCAL_PREF_KEY);
  } catch (e) {}
}

/**
 * 判断一首歌是不是本地文件
 */
function isLocalTrack(song) {
  if (!song) return false;
  return song.provider === 'local' || song.source === 'local' ||
         song.type === 'local' || !!song.localKey || !!song.localUrl;
}

/**
 * 移除一首本地歌。
 * 返回 Promise<'list'|'both'|null>
 */
function askRemoveLocalChoice(song) {
  var pref = getRemoveLocalPref();
  if (pref) return Promise.resolve(pref);   // 已记住，不再问

  return new Promise(function (resolve) {
    var old = document.getElementById('local-remove-dlg');
    if (old) old.parentNode.removeChild(old);

    var name = (song && (song.name || song.title)) || '这首歌';

    var d = document.createElement('div');
    d.id = 'local-remove-dlg';
    d.className = 'lcc-mask';
    d.innerHTML =
      '<div class="lcc-card">' +
        '<div class="lcc-title">移除「' + escAttr(name) + '」</div>' +
        '<div class="lcc-sub">这是本地文件，选择移除方式：</div>' +
        '<button type="button" class="lcc-opt" data-act="list">' +
          '<b>只从列表移除</b>' +
          '<small>磁盘上的音乐文件保留</small>' +
        '</button>' +
        '<button type="button" class="lcc-opt danger" data-act="both">' +
          '<b>列表和文件一起删除</b>' +
          '<small>同时删除磁盘文件，不可恢复</small>' +
        '</button>' +
        '<label class="lcc-remember">' +
          '<input id="lcc-remember" type="checkbox">' +
          '<span>不再询问，以后都用这次的选择</span>' +
        '</label>' +
        '<button type="button" class="lcc-cancel" data-act="cancel">取消</button>' +
      '</div>';
    document.body.appendChild(d);

    function done(v) {
      var rem = d.querySelector('#lcc-remember');
      if (v && rem && rem.checked) setRemoveLocalPref(v);
      if (d.parentNode) d.parentNode.removeChild(d);
      resolve(v);
    }

    d.addEventListener('click', function (e) {
      if (e.target === d) return done(null);
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'cancel') return done(null);
      done(act);
    });

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); document.removeEventListener('keydown', onKey, true); done(null); }
    }
    document.addEventListener('keydown', onKey, true);
  });
}

/** 从曲库里真正删掉一条（可选同时删文件） */
async function removeLocalTrackFromLibrary(song, mode) {
  if (!song) return false;
  var id = song.id || '';
  if (!id) return false;
  try {
    var res = await window.desktopWindow.removeLocalMusicTracks([id], { deleteFile: mode === 'both' });
    return !!(res && res.ok);
  } catch (e) {
    console.warn('[Remove] 失败', e);
    return false;
  }
}
/* ==========================================================================
   下载完成后刷新本地列表
   --------------------------------------------------------------------------
   下载完的文件已经注册进曲库了，但如果用户此刻正处于「本地和下载」来源，
   PLAY_CTX.songs 还是旧快照 —— 新下载的看不到。

   这里监听 bili:downloaded 事件，如果当前正在「本地和下载」来源，
   自动重建一次列表（保留当前播放的那首）。
   ========================================================================== */
window.addEventListener('bili:downloaded', function () {
  if (PLAY_CTX.type !== 'local') return;
  // 等注册完成（事件发出时注册是异步的），稍等一下再拉
  setTimeout(function () {
    var cur = null;
    try {
      if (typeof playQueue !== 'undefined' && currentIdx >= 0 && playQueue[currentIdx]) {
        cur = playQueue[currentIdx];
      }
    } catch (e) {}

    readLocalLibrary().then(function (tracks) {
      if (!tracks.length) return;
      var items = tracks.map(libraryTrackToItem);
      // 尽量停在原来那首
      var keepIdx = 0;
      if (cur) {
        var key = cur.localKey || cur.id;
        for (var i = 0; i < items.length; i++) {
          if (items[i].localKey === key || items[i].id === key) { keepIdx = i; break; }
        }
      }
      PLAY_CTX = { type: 'local', id: '', name: '本地和下载', songs: items };
      try {
        if (typeof playQueue !== 'undefined') {
          playQueue.length = 0;
          for (var k = 0; k < items.length; k++) playQueue.push(cloneSongLite(items[k]));
          currentIdx = Math.min(keepIdx, Math.max(0, items.length - 1));
          if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('download-refresh');
        }
      } catch (e) {}
      updatePlayContextBadge();
    });
  }, CFG.DOWNLOAD_REFRESH_DELAY);
});

/* ==========================================================================
   播「每日电台」为上下文
   ========================================================================== */
async function playRadioAsContext(startIndex) {
  var data = null;
  try {
    data = await fetch('/api/radio/daily?limit=30').then(function (x) { return x.json(); });
  } catch (e) {
    showToastSafe('获取电台失败');
    return;
  }

  var songs = (data && data.songs) || [];
  if (!songs.length) {
    showToastSafe('今天没挑到歌');
    return;
  }

  var items = songs.map(function (s) {
    return {
      provider: 'bili', source: 'bili', type: 'song',
      id: s.bvid, bvid: s.bvid,
      name: s.name,
      artist: s.artist || '',
      cover: s.cover || '',
      duration: s.duration || 0,
    };
  });

  setPlayContext({
    type: 'radio',
    id: String((data && data.date) || ''),
    name: '每日电台',
    songs: items,
  }, startIndex || 0);

  try {
    if (typeof switchPlaylistTab === 'function') {
      switchPlaylistTab('queue', { animate: false, refresh: false });
    }
  } catch (e) {}

  showToastSafe('每日电台 · ' + items.length + ' 首');
  try { if (typeof playQueueAt === 'function') playQueueAt(startIndex || 0); } catch (e) {}

  /* 启动自动续播：听到最后 2 首会自动追加新的 */
  try { if (typeof startRadioContinueWatch === 'function') startRadioContinueWatch(); } catch (e) {}
}

/* ==========================================================================
   播「历史播放」为上下文
   ========================================================================== */
async function playHistoryAsContext(startIndex) {
  var data = null;
  try {
    data = await fetch('/api/history/list?limit=200').then(function (x) { return x.json(); });
  } catch (e) {
    showToastSafe('读取历史失败');
    return;
  }

  var list = (data && data.items) || [];
  if (!list.length) {
    showToastSafe('还没有播放记录');
    return;
  }

  var items = list.map(function (x) {
    var bvid = x.defaultBvid || '';
    if (bvid && !/^BV[0-9A-Za-z]{10}$/.test(bvid)) bvid = '';
    return {
      provider: 'bili', source: 'bili', type: 'song',
      id: bvid, bvid: bvid,
      name: x.name,
      artist: x.artist || '',
      album: x.album || '',
      cover: x.cover || '',
      duration: x.duration || 0,
    };
  });

  setPlayContext({
    type: 'history',
    id: '',
    name: '历史播放',
    songs: items,
  }, startIndex || 0);

  try {
    if (typeof switchPlaylistTab === 'function') {
      switchPlaylistTab('queue', { animate: false, refresh: false });
    }
  } catch (e) {}

  showToastSafe('历史播放 · ' + items.length + ' 首');
  try { if (typeof playQueueAt === 'function') playQueueAt(startIndex || 0); } catch (e) {}
}
