/* ==========================================================================
   本地歌单接入「我的歌单」面板
   --------------------------------------------------------------------------
   后端 local-playlist.js 把歌单存在 data/local-playlists.json。
   这个模块负责把它注入 Mineradio 的歌单面板（#pl-list）。

   做法：不改 Mineradio 那几个文件（它们在多处重复赋值 userPlaylists，
         改起来容易漏），而是在渲染前把这些歌单插进 userPlaylists 数组。

   触发时机：
     · 启动后拉一次
     · 创建歌单后（监听 bili:playlist-created 事件）
     · 打开歌单面板时（点「我的歌单」tab）
   ========================================================================== */

var LOCAL_PLAYLISTS = [];
var _localPlLoaded = false;

/* ---------------------------------------------------------------- 拉取 */
async function loadLocalPlaylists() {
  try {
    var r = await fetch('/api/local-pl/list').then(function (x) { return x.json(); });
    LOCAL_PLAYLISTS = (r && r.playlists) || [];
    _localPlLoaded = true;
    syncLocalPlaylistsIntoPanel();
    return LOCAL_PLAYLISTS;
  } catch (e) {
    console.warn('[LocalPL] 加载失败', e);
    return [];
  }
}

/* ---------------------------------------------------------------- 注入 */
/**
 * 把本地歌单插到 userPlaylists 最前面（本地优先，用户刚建的应该先看到）。
 *
 * 每项的形状要跟 Mineradio 的 pl 对象对齐：
 *   { id, name, provider, trackCount, creator, cover }
 */
/**
 * 直接把本地歌单渲染到 #pl-list。
 *
 * 为什么不用「注入 userPlaylists」的方案：
 *   Mineradio 有 5 处会重建 userPlaylists
 *   （builtInPlaylists.concat(...) 之类），注入进去的内容会被覆盖。
 *   改成直接接管 DOM 渲染，不受它影响。
 */
/**
 * 渲染「我的歌单」列表 / 详情。
 *
 * 两种视图：
 *   view = 'list'   → 歌单卡片列表（默认）
 *   view = 'detail' → 某个歌单的歌曲列表（带返回键）
 *
 * 为什么自己做视图切换：
 *   Mineradio 原来的展开是内联在卡片下面的，
 *   用户要求"点歌单进详情页，有返回键"。
 */
var LPL_VIEW = { mode: 'list', id: '', name: '', songs: [], loading: false };

function syncLocalPlaylistsIntoPanel() {
  var list = document.getElementById('pl-list');
  if (!list) {
    setTimeout(syncLocalPlaylistsIntoPanel, CFG.PLAYLIST_RETRY);
    return;
  }
  if (list.offsetParent === null) {
    setTimeout(syncLocalPlaylistsIntoPanel, CFG.PLAYLIST_RETRY);
    return;
  }

  if (LPL_VIEW.mode === 'detail') {
    renderLocalDetailView(list);
    return;
  }

  // ---- 列表视图 ----
  if (!LOCAL_PLAYLISTS.length) {
    list.innerHTML = '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,.32);font-size:11.5px">还没有歌单<br><span style="font-size:10.5px;opacity:.6">点上面的「+ 新建歌单」</span></div>';
    return;
  }

  var html = '';
  for (var i = 0; i < LOCAL_PLAYLISTS.length; i++) {
    var p = LOCAL_PLAYLISTS[i];
    var cover = (p.covers && p.covers[0]) || '';
    var img = cover
      ? '<img src="' + escHtml(cover) + '" alt="" loading="lazy" onerror="this.style.opacity=0.2">'
      : '<div class="pl-built-in-placeholder">♪</div>';
    html += '<div class="pl-card" data-bili-pl-open="' + escHtml(p.id) + '"' +
        ' data-playlist-provider="local-bili"' +
        ' data-playlist-id="' + escHtml(p.id) + '"' +
        ' data-playlist-title="' + escHtml(p.name) + '" style="cursor:pointer">' +
        img +
        '<div style="flex:1;min-width:0">' +
          '<div class="pl-name">' + escHtml(p.name) +
            '<span class="tag-source bili" style="margin-left:6px;vertical-align:1px">B站</span>' +
          '</div>' +
          '<div class="pl-sub">' + (p.count || 0) + ' 首 · 本地歌单</div>' +
        '</div>' +
      '</div>';
  }
  list.innerHTML = html;

  // 绑定点击 → 进详情
  list.querySelectorAll('[data-bili-pl-open]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      openLocalPlaylistDetail(el.getAttribute('data-bili-pl-open'));
    }, true);   // 捕获阶段，抢在 Mineradio 的 handler 前面
  });
}

/* ---------------------------------------------------------------- 详情视图 */
async function openLocalPlaylistDetail(id) {
  var pl = LOCAL_PLAYLISTS.filter(function (x) { return x.id === id; })[0];
  LPL_VIEW = { mode: 'detail', id: id, name: pl ? pl.name : '', songs: [], loading: true };
  syncLocalPlaylistsIntoPanel();

  try {
    var full = await fetch('/api/local-pl/get?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); });
    LPL_VIEW.songs = (full && full.songs) || [];
    LPL_VIEW.loading = false;
    LPL_VIEW.name = full.name || LPL_VIEW.name;
  } catch (e) {
    LPL_VIEW.songs = [];
    LPL_VIEW.loading = false;
  }
  syncLocalPlaylistsIntoPanel();
}

function closeLocalPlaylistDetail() {
  LPL_VIEW = { mode: 'list', id: '', name: '', songs: [], loading: false };
  if (typeof loadLocalPlaylists === 'function') {
    loadLocalPlaylists().then(function () { syncLocalPlaylistsIntoPanel(); });
  } else {
    syncLocalPlaylistsIntoPanel();
  }
}

function renderLocalDetailView(list) {
  var head = '<div class="lpl-detail-head">' +
      '<button class="lpl-back" type="button" onclick="closeLocalPlaylistDetail()" title="返回歌单列表">' +
        '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M15 18l-6-6 6-6"/></svg>' +
      '</button>' +
      '<div class="lpl-detail-title">' + escHtml(LPL_VIEW.name || '歌单') + '</div>' +
      '<div class="lpl-detail-count">' + (LPL_VIEW.songs.length || 0) + ' 首</div>' +
      (LPL_VIEW.songs.length
        ? '<button class="lpl-dl-all" type="button" title="下载整个歌单" ' +
            'onclick="event.stopPropagation();downloadCurrentLocalPlaylist()">' +
            '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
              '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>' +
            '全部下载' +
          '</button>'
        : '') +
    '</div>';

  if (LPL_VIEW.loading) {
    list.innerHTML = head + '<div class="lpl-detail-empty">载入中…</div>';
    return;
  }
  if (!LPL_VIEW.songs.length) {
    list.innerHTML = head + '<div class="lpl-detail-empty">这个歌单还是空的<br>' +
      '<span style="font-size:10.5px;opacity:.6">搜索后点歌曲右边的 ＋ 加入</span></div>';
    return;
  }

  var html = head;
  for (var i = 0; i < LPL_VIEW.songs.length; i++) {
    var s = LPL_VIEW.songs[i];
    var dur = s.duration_s ? (Math.floor(s.duration_s / 60) + ':' + String(s.duration_s % 60).padStart(2, '0')) : '';
    html += '<div class="lpl-song-row" data-lpl-song="' + i + '">' +
        '<span class="lpl-song-idx">' + (i + 1) + '</span>' +
        '<div class="lpl-song-main">' +
          '<div class="lpl-song-name">' + escHtml(s.name || '') + '</div>' +
          '<div class="lpl-song-meta">' + escHtml(s.artist || '') + (dur ? ' · ' + dur : '') + '</div>' +
        '</div>' +
        '<button class="dl-btn" type="button" title="下载" ' +
          'data-dl-song="' + encodeURIComponent(JSON.stringify({bvid: s.bvid||"", cid: s.cid||0, name: s.name||"", artist: s.artist||"", duration: s.duration||0})) + '"' +
          ' onclick="event.stopPropagation()">' +
          '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
            '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>' +
        '</button>' +
        '<button class="lpl-song-del" type="button" title="从歌单移除" data-lpl-del="' + i + '">×</button>' +
      '</div>';
  }
  list.innerHTML = html;

  list.querySelectorAll('[data-lpl-song]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-lpl-del]')) return;   // 点删除时不播放
      var idx = +el.getAttribute('data-lpl-song');
      playLocalPlaylistSong(idx);
    });
  });
  list.querySelectorAll('[data-lpl-del]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var idx = +btn.getAttribute('data-lpl-del');
      removeLocalPlaylistSong(idx);
    });
  });
}

function playLocalPlaylistSong(idx) {
  var s = LPL_VIEW.songs[idx];
  if (!s) return;

  /* 用播放上下文播：整张歌单成为队列，
     这样「列表循环」循环的是歌单，不是上次的队列。 */
  if (typeof setPlayContext === 'function') {
    var items = LPL_VIEW.songs.map(function (x) {
      return {
        provider: 'bili', source: 'bili', type: 'song',
        id: x.bvid || '', bvid: x.bvid || '', cid: x.cid || 0,
        name: x.name || '', artist: x.artist || '', album: x.album || '',
        cover: x.cover || '', duration: x.duration || 0,
      };
    });
    setPlayContext({
      type: 'playlist',
      id: LPL_VIEW.id,
      name: LPL_VIEW.name || '歌单',
      songs: items,
    }, idx);
    try {
      if (typeof playQueueAt === 'function') playQueueAt(idx);
    } catch (e) { console.warn('[playLocalPlaylistSong]', e); }
    return;
  }

  // 兜底：没有上下文模块时的旧行为
  var item = {
    provider: 'bili', source: 'bili', type: 'song',
    id: s.bvid, bvid: s.bvid, cid: s.cid || 0,
    name: s.name, artist: s.artist, album: s.album || '',
    cover: s.cover, duration: s.duration || 0,
  };
  try {
    if (typeof playQueue !== 'undefined' && typeof playQueueAt === 'function') {
      playQueue.unshift(item);
      currentIdx = 0;
      playQueueAt(0);
    }
  } catch (e) { console.warn('[playLocalPlaylistSong]', e); }
}

function removeLocalPlaylistSong(idx) {
  var s = LPL_VIEW.songs[idx];
  if (!s) return;
  askConfirm('从歌单移除', '「' + (s.name || '') + '」将从歌单中移除。', '移除').then(function (ok) {
    if (!ok) return;
    fetch('/api/local-pl/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: LPL_VIEW.id, bvid: s.bvid, cid: s.cid || 0 }),
    }).then(function (r) { return r.json(); }).then(function () {
      if (typeof showToast === 'function') showToast('已移除');
      openLocalPlaylistDetail(LPL_VIEW.id);
    });
  });
}
/* ---------------------------------------------------------------- 详情 */
/**
 * 点开一个本地歌单时，渲染它的歌曲列表。
 * Mineradio 原来的加载器只认 netease/qq/kugou/qishui，
 * 这里给它开一条通道。
 */
async function renderLocalPlaylistDetail(id) {
  var host = document.getElementById('pl-detail-body') || document.getElementById('pl-list');
  if (!host) return;

  try {
    var pl = await fetch('/api/local-pl/get?id=' + encodeURIComponent(id)).then(function (x) { return x.json(); });
    var songs = (pl && pl.songs) || [];

    if (!songs.length) {
      host.innerHTML = '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,.32);font-size:11.5px">这个歌单是空的</div>';
      return;
    }

    // 用 Mineradio 自己的搜索结果行样式（保持视觉一致）
    var html = '';
    for (var i = 0; i < songs.length; i++) {
      var s = songs[i];
      var cover = s.cover || '';
      var img = cover
        ? '<img src="' + escHtml(cover) + '" alt="" loading="lazy" onerror="this.style.opacity=.2">'
        : '<div style="width:44px;height:44px;border-radius:8px;background:rgba(255,255,255,.06);flex-shrink:0"></div>';
      var dur = s.duration_s ? (Math.floor(s.duration_s / 60) + ':' + String(s.duration_s % 60).padStart(2, '0')) : '';
      html += '<div class="search-result" data-local-idx="' + i + '" style="cursor:pointer">' +
          '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">' +
            img +
            '<div class="search-result-info">' +
              '<div class="search-result-title">' + escHtml(s.name || '') +
                '<span class="tag-source bili">B站</span></div>' +
              '<div class="search-result-meta">' + escHtml(s.artist || '') +
                (dur ? ' · ' + dur : '') + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }
    host.innerHTML = html;

    // 点击播放
    host.querySelectorAll('[data-local-idx]').forEach(function (el) {
      el.addEventListener('click', function () {
        var idx = +el.getAttribute('data-local-idx');
        var s = songs[idx];
        if (!s) return;
        var item = {
          provider: 'bili', source: 'bili', type: 'song',
          id: s.bvid, bvid: s.bvid, cid: s.cid || 0,
          name: s.name, artist: s.artist, album: s.album || '',
          cover: s.cover, duration: s.duration || 0,
        };
        try {
          if (typeof playQueue !== 'undefined' && typeof playQueueAt === 'function') {
            playQueue.unshift(item);
            currentIdx = 0;
            playQueueAt(0);
          }
        } catch (e) { console.warn(e); }
      });
    });
  } catch (e) {
    console.warn('[LocalPL] 详情加载失败', e);
  }
}

/* ---------------------------------------------------------------- 事件 */
(function bindLocalPlaylist() {
  var tries = 0;

  function init() {
    if (typeof loadLocalPlaylists !== 'function') return;
    // 等 Mineradio 的初始化跑完再拉
    setTimeout(function () {
      loadLocalPlaylists();
    }, CFG.PANEL_WATCH_INTERVAL * 2);

    // 创建歌单后刷新
    window.addEventListener('bili:playlist-created', function () {
      loadLocalPlaylists();
    });

    // 点「我的歌单」tab 时刷新
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-pl-tab="mine"]') || t.closest('#pl-tab-mine')) {
        loadLocalPlaylists();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(init, CFG.PANEL_WATCH_INTERVAL);
    });
  } else {
    setTimeout(init, CFG.PANEL_WATCH_INTERVAL);
  }
})();

/* ==========================================================================
   歌单面板里的两个按钮
   --------------------------------------------------------------------------
   注意：Electron 不实现 window.prompt（直接返回 null），
   所以不能用 prompt。这里复用搜索页那个自定义命名对话框
   （askPlaylistName，见 98-search-ui.js）。
   ========================================================================== */

function promptNewLocalPlaylist() {
  var ask = (typeof askPlaylistName === 'function')
    ? askPlaylistName('我的歌单', 0)
    : null;

  if (!ask) {
    // 兜底：没有对话框就直接建一个默认名的
    fetch('/api/local-pl/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '我的歌单', songs: [] }),
    }).then(function (r) { return r.json(); }).then(function () {
      refreshLocalPlaylistsPanel();
    });
    return;
  }

  ask.then(function (name) {
    if (!name) return;
    fetch('/api/local-pl/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, songs: [] }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.id) {
          if (typeof showToast === 'function') showToast('已创建歌单「' + res.name + '」');
          refreshLocalPlaylistsPanel();
          try { window.dispatchEvent(new CustomEvent('bili:playlist-created', { detail: res })); } catch (e) {}
        } else {
          if (typeof showToast === 'function') showToast('创建失败');
        }
      })
      .catch(function () {
        if (typeof showToast === 'function') showToast('创建失败');
      });
  });
}

function refreshLocalPlaylistsPanel() {
  if (typeof loadLocalPlaylists === 'function') {
    loadLocalPlaylists().then(function () {
      // 更新首数统计
      var chip = document.getElementById('pl-count-chip');
      if (chip) {
        var n = (typeof LOCAL_PLAYLISTS !== 'undefined' ? LOCAL_PLAYLISTS.length : 0);
        chip.textContent = n ? ('本地歌单 · ' + n + ' 个') : '还没有歌单';
      }
    });
  }
}
/* ==========================================================================
   本地歌单右键菜单（改名 / 删除）
   --------------------------------------------------------------------------
   给 #pl-list 里的本地歌单卡片绑定 contextmenu。
   用捕获阶段监听，避免和 Mineradio 自己的点击处理打架。
   ========================================================================== */
function bindLocalPlaylistContextMenu() {
  var list = document.getElementById('pl-list');
  if (!list || list._biliCtxBound) return;
  list._biliCtxBound = true;

  list.addEventListener('contextmenu', function (e) {
    var card = e.target && e.target.closest ? e.target.closest('.pl-card') : null;
    if (!card) return;
    var provider = card.getAttribute('data-playlist-provider') || '';
    if (provider !== 'local-bili') return;   // 不是本地歌单，不接管

    e.preventDefault();
    e.stopPropagation();

    var id = card.getAttribute('data-playlist-id') || '';
    var name = card.getAttribute('data-playlist-title') || '';
    showLocalPlaylistMenu(e.clientX, e.clientY, id, name);
  }, true);
}

function showLocalPlaylistMenu(x, y, id, name) {
  var old = document.getElementById('lpl-menu');
  if (old) old.parentNode.removeChild(old);

  var d = document.createElement('div');
  d.id = 'lpl-menu';
  d.className = 'lpl-menu';
  d.style.left = Math.min(x, window.innerWidth - 170) + 'px';
  d.style.top = Math.min(y, window.innerHeight - 110) + 'px';
  d.innerHTML =
    '<button type="button" data-act="rename">改名</button>' +
    '<button type="button" data-act="delete" class="danger">删除歌单</button>';
  document.body.appendChild(d);

  d.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    d.parentNode.removeChild(d);

    if (act === 'rename') {
      askPlaylistName(name, 0).then(function (newName) {
        if (!newName || newName === name) return;
        fetch('/api/local-pl/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, name: newName }),
        }).then(function () {
          if (typeof showToast === 'function') showToast('已改名');
          if (typeof refreshLocalPlaylistsPanel === 'function') refreshLocalPlaylistsPanel();
        });
      });
    } else if (act === 'delete') {
      /* 不能用原生 confirm()：Electron 里它会阻塞整个渲染进程，
         表现为「播放器卡住、动画停住」。
         改成自己的异步确认框。 */
      askConfirm('删除歌单', '「' + name + '」将从本地移除，歌单里的歌不会删除。', '删除').then(function (ok) {
        if (!ok) return;
        fetch('/api/local-pl/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id }),
        }).then(function () {
          if (typeof showToast === 'function') showToast('已删除');
          if (typeof refreshLocalPlaylistsPanel === 'function') refreshLocalPlaylistsPanel();
        });
      });
    }
  });

  // 点别处关闭
  setTimeout(function () {
    document.addEventListener('click', function closeMenu() {
      var m = document.getElementById('lpl-menu');
      if (m) m.parentNode.removeChild(m);
      document.removeEventListener('click', closeMenu);
    }, { once: true });
  }, 10);
}

/* 面板打开时绑定一次 */
(function watchPlaylistPanel() {
  setInterval(function () {
    var list = document.getElementById('pl-list');
    if (list && list.offsetParent !== null) bindLocalPlaylistContextMenu();
  }, CFG.PANEL_WATCH_INTERVAL);
})();
/* ==========================================================================
   接管「我的歌单」渲染
   --------------------------------------------------------------------------
   Mineradio 的 switchPlaylistTab('playlists') 会调 renderUserPlaylistsList，
   而那个函数读的是被反复清空的 userPlaylists。

   这里包一层：凡是渲染「我的歌单」的时机，都改成渲染本地歌单。
   用 Monkey patch，不改它的源码文件（它们是共享的，改多了容易漏）。
   ========================================================================== */
/* bili-pl-render-patch */
(function patchPlaylistRender() {
  var tries = 0;

  function patch() {
    if (typeof renderUserPlaylistsList !== 'function') {
      if (++tries < 60) setTimeout(patch, CFG.BAR_GUARD_INTERVAL);
      return;
    }
    if (renderUserPlaylistsList.__biliPatched) return;

    var original = renderUserPlaylistsList;
    var patched = function (opts) {
      // 先让原函数跑（它可能画别的平台歌单）
      try { original.apply(this, arguments); } catch (e) {}

      // 然后我们接管：只要有本地歌单，就把列表换成我们的
      var list = document.getElementById('pl-list');
      if (!list) return;
      if (list.offsetParent === null) return;   // 面板没开

      if (LOCAL_PLAYLISTS.length) {
        syncLocalPlaylistsIntoPanel();
      }
    };
    patched.__biliPatched = true;
    window.renderUserPlaylistsList = patched;
    window.__biliOrigRenderUserPlaylistsList = original;
  }

  patch();
})();

/* 面板打开/切换 tab 时也补一次 */
(function watchPlaylistPanelOpens() {
  var lastVisible = false;
  setInterval(function () {
    var list = document.getElementById('pl-list');
    if (!list) return;
    var nowVisible = list.offsetParent !== null;
    if (nowVisible && !lastVisible) {
      // 刚打开
      setTimeout(function () {
        if (LOCAL_PLAYLISTS.length) syncLocalPlaylistsIntoPanel();
      }, CFG.PANEL_WATCH_INTERVAL / 8);
    }
    lastVisible = nowVisible;
  }, CFG.BAR_GUARD_INTERVAL + 100);
})();
/* 下载当前打开的歌单（给头部按钮用） */
function downloadCurrentLocalPlaylist() {
  if (!LPL_VIEW || !LPL_VIEW.id) return;
  downloadPlaylistWithConfirm(LPL_VIEW.id, LPL_VIEW.name, LPL_VIEW.songs);
}

/**
 * 歌单批量下载（带确认框 + 重复检测）。
 *
 * 流程：
 *   1. 检查已下载目录，找出这个歌单里已经下过的歌
 *   2. 弹确认框：显示总数、将跳过几首、格式、路径
 *   3. 用户确认 → 建任务 → 轮询进度
 *   4. 结束 → 通报成功/失败数
 */
async function downloadPlaylistWithConfirm(playlistId, playlistName, songs) {
  if (!playlistId) return;
  songs = songs || LPL_VIEW.songs || [];
  if (!songs.length) { showToastSafe('这个歌单是空的'); return; }

  showToastSafe('正在检查已下载的文件…');

  // 1. 查已下载，做重复检测
  var existing = new Set();
  try {
    var dlr = await fetch('/api/dl/list').then(function (x) { return x.json(); });
    (dlr.files || []).forEach(function (f) {
      var base = String(f.name).replace(/\.(m4a|mp3|flac|wav|ogg)$/i, '');
      existing.add(normalizeNameKey(base));
    });
  } catch (e) {}

  var dupNames = [];
  var todo = [];
  songs.forEach(function (s) {
    var key = normalizeNameKey((s.artist ? s.artist + ' - ' : '') + (s.name || ''));
    if (existing.has(key)) dupNames.push(s.name);
    else todo.push(s);
  });

  // 2. 确认框
  var opts = await askDownloadOptions(
    playlistName + '（' + songs.length + ' 首）' +
      (dupNames.length ? ' · 其中 ' + dupNames.length + ' 首已下载' : ''),
    songs.length
  );
  if (!opts) return;

  if (dupNames.length && !todo.length) {
    // 全下载过了
    var again = await askConfirm(
      '全部已下载',
      '这个歌单的 ' + songs.length + ' 首都已经下载过了。要重新下载一遍吗？',
      '重新下载'
    );
    if (!again) return;
    todo = songs.slice();
  } else if (dupNames.length && todo.length) {
    var keepGoing = await askConfirm(
      '部分已下载',
      '有 ' + dupNames.length + ' 首已下载（会跳过），还有 ' + todo.length + ' 首待下载。继续吗？',
      '开始下载'
    );
    if (!keepGoing) return;
  }

  if (!todo.length) { showToastSafe('没有需要下载的歌'); return; }

  // 3. 保存设置
  if (opts.remember) {
    try {
      await fetch('/api/dl/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: opts.dir, format: opts.format }),
      });
      DL_PREFS.dir = opts.dir;
      DL_PREFS.format = opts.format;
    } catch (e) {}
  }

  // 4. 建任务
  try {
    var res = await fetch('/api/dl/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: playlistId, format: opts.format }),
    }).then(function (x) { return x.json(); });

    if (!res || !res.taskId) {
      showToastSafe('无法开始下载：' + (res && (res.message || res.error) || ''));
      return;
    }
    startDownloadTaskPolling(res.taskId);
  } catch (e) {
    showToastSafe('下载失败：' + (e.message || ''));
  }
}

/** 归一化文件名，用于重复比对：去掉后缀、空格、括号里的版本说明 */
function normalizeNameKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.(m4a|mp3|flac|wav|ogg)$/i, '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/\s+/g, '')
    .trim();
}