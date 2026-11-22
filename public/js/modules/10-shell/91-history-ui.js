/* ==========================================================================
   播放历史界面
   --------------------------------------------------------------------------
   布局：
     顶部  标题 + 统计 + [清理全部]
     列表  每条 = 一首歌（去重后）
           展开后显示这首歌的所有音源版本，可切换默认

   交互：
     点行        → 用默认音源播放，整段历史成为播放上下文
     点「N 个音源」→ 展开音源列表
     点某个音源   → 设为默认并播放
     右键行      → 从历史移除
   ========================================================================== */

var HISTORY_UI = {
  items: [],
  openKeys: {},     // key -> true（展开状态）
  loaded: false,
};

/* ---------------------------------------------------------------- 面板骨架 */
function ensureHistoryPanel() {
  var old = document.getElementById('hist-panel');
  if (old) return old;

  var d = document.createElement('div');
  d.id = 'hist-panel';
  d.className = 'hist-mask';
  d.innerHTML =
    '<div class="hist-card">' +
      '<div class="hist-head">' +
        '<div class="hist-title-wrap">' +
          '<div class="hist-title">历史播放</div>' +
          '<div class="hist-sub" id="hist-sub">载入中…</div>' +
        '</div>' +
        '<div class="hist-actions">' +
          '<button type="button" class="hist-btn ghost" onclick="historyClearAll()">清理全部</button>' +
          '<button type="button" class="hist-close" data-hist-close="1" title="关闭">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="hist-body" id="hist-body"></div>' +
    '</div>';
  document.body.appendChild(d);

  d.addEventListener('click', function (e) {
    if (e.target === d || e.target.closest('[data-hist-close]')) closeHistoryPanel();
  });
  return d;
}

function openHistoryPanel() {
  var d = ensureHistoryPanel();
  d.classList.add('show');
  renderHistoryList();
}

function closeHistoryPanel() {
  var d = document.getElementById('hist-panel');
  if (d) d.classList.remove('show');
}

/* ---------------------------------------------------------------- 渲染 */
async function renderHistoryList() {
  var body = document.getElementById('hist-body');
  var sub = document.getElementById('hist-sub');
  if (!body) return;

  body.innerHTML = '<div class="hist-loading">正在读取历史…</div>';

  try {
    var r = await fetch('/api/history/list?limit=200').then(function (x) { return x.json(); });
    var items = (r && r.items) || [];
    HISTORY_UI.items = items;
    HISTORY_UI.loaded = true;

    if (sub) {
      sub.textContent = items.length
        ? (items.length + ' 首 · 共 ' + items.reduce(function (n, x) { return n + (x.playCount || 0); }, 0) + ' 次播放')
        : '';
    }

    if (!items.length) {
      body.innerHTML =
        '<div class="hist-empty">' +
          '<div class="hist-empty-icon">🕐</div>' +
          '<div>还没有播放记录</div>' +
          '<div class="hist-empty-sub">听满 10 秒就会记入历史</div>' +
        '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var isOpen = !!HISTORY_UI.openKeys[it.key];
      var cover = it.cover || '';
      var img = cover
        ? '<img src="' + escH(it.cover) + '" alt="" loading="lazy" onerror="this.style.opacity=.2">'
        : '<div class="hist-cover-ph">♪</div>';
      var srcCount = (it.sources || []).length;
      var dur = it.duration ? fmtTimeH(Math.round(it.duration / 1000)) : '';
      var timeAgo = fmtAgo(it.lastPlayedAt);

      html += '<div class="hist-row" data-hist-idx="' + i + '">' +
          img +
          '<div class="hist-info">' +
            '<div class="hist-name">' + escH(it.name) + '</div>' +
            '<div class="hist-meta">' + escH(it.artist || '未知歌手') +
              (dur ? ' · ' + dur : '') +
              ' · 播 ' + (it.playCount || 0) + ' 次 · ' + timeAgo + '</div>' +
          '</div>' +
          (srcCount > 1
            ? '<button type="button" class="hist-src-toggle' + (isOpen ? ' open' : '') + '" ' +
                'onclick="event.stopPropagation();historyToggleSources(' + i + ')">' +
                srcCount + ' 个音源 <span class="hist-caret">▾</span>' +
              '</button>'
            : '<span class="hist-src-single">1 个音源</span>') +
          '<button type="button" class="hist-play" title="播放">' +
            '<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
          '</button>' +
        '</div>';

      // 展开的音源列表
      if (isOpen && srcCount) {
        html += '<div class="hist-sources">';
        for (var k = 0; k < it.sources.length; k++) {
          var s = it.sources[k];
          var isDefault = (s.bvid === it.defaultBvid);
          html += '<div class="hist-source' + (isDefault ? ' on' : '') + '" ' +
              'data-hist-src="' + i + ':' + k + '">' +
              '<span class="hist-src-dot"></span>' +
              '<div class="hist-src-info">' +
                '<div class="hist-src-title">' + escH(s.title || s.bvid) + '</div>' +
                '<div class="hist-src-meta">' + escH(s.author || '') +
                  ' · 播 ' + (s.playCount || 0) + ' 次' +
                  (s.score ? ' · 匹配 ' + s.score : '') + '</div>' +
              '</div>' +
              (isDefault
                ? '<span class="hist-src-default">默认</span>'
                : '<button type="button" class="hist-src-set" onclick="event.stopPropagation();historySetDefault(' + i + ',' + k + ')">设为默认</button>') +
            '</div>';
        }
        html += '</div>';
      }
    }
    body.innerHTML = html;

    // 绑定点击
    body.querySelectorAll('[data-hist-idx]').forEach(function (el) {
      el.addEventListener('click', function () {
        var idx = +el.getAttribute('data-hist-idx');
        historyPlayItem(idx);
      });
      el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        var idx = +el.getAttribute('data-hist-idx');
        historyRemoveItem(idx);
      });
    });
    body.querySelectorAll('[data-hist-src]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var parts = el.getAttribute('data-hist-src').split(':');
        historyPlaySource(+parts[0], +parts[1]);
      });
    });
  } catch (e) {
    body.innerHTML = '<div class="hist-empty">读取失败：' + escH(e.message) + '</div>';
  }
}

/* ---------------------------------------------------------------- 交互 */
function historyToggleSources(idx) {
  var it = HISTORY_UI.items[idx];
  if (!it) return;
  HISTORY_UI.openKeys[it.key] = !HISTORY_UI.openKeys[it.key];
  renderHistoryList();
}

/** 播历史里的一首（用默认音源） */
function historyPlayItem(idx) {
  var it = HISTORY_UI.items[idx];
  if (!it) return;
  playHistoryItem(it, it.defaultBvid);
}

/** 播某个音源版本（同时设为默认） */
function historyPlaySource(idx, srcIdx) {
  var it = HISTORY_UI.items[idx];
  if (!it || !it.sources || !it.sources[srcIdx]) return;
  var src = it.sources[srcIdx];
  playHistoryItem(it, src.bvid);
  // 记住这个选择
  fetch('/api/history/set-default', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: it.key, bvid: src.bvid }),
  }).then(function () {
    it.defaultBvid = src.bvid;
  }).catch(function () {});
}

/** 设为默认（不播放） */
function historySetDefault(idx, srcIdx) {
  var it = HISTORY_UI.items[idx];
  if (!it || !it.sources || !it.sources[srcIdx]) return;
  var src = it.sources[srcIdx];
  fetch('/api/history/set-default', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: it.key, bvid: src.bvid }),
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res && res.ok) {
        it.defaultBvid = src.bvid;
        showToastSafe('已设为默认音源');
        renderHistoryList();
      }
    })
    .catch(function () { showToastSafe('设置失败'); });
}

/** 构建播放项并播 */
function playHistoryItem(it, bvid) {
  if (!it) return;

  /* 整段历史作为播放上下文，这样「列表循环」循环的是历史 */
  var songs = HISTORY_UI.items.map(function (x) {
    return {
      provider: 'bili', source: 'bili', type: 'song',
      id: x.defaultBvid || '',
      bvid: x.defaultBvid || '',
      name: x.name,
      artist: x.artist,
      album: x.album || '',
      cover: x.cover || '',
      duration: x.duration || 0,
    };
  });

  var startIdx = songs.findIndex
    ? songs.findIndex(function (x, i) { return HISTORY_UI.items[i].key === it.key; })
    : 0;

  // 当前这一首用指定的 bvid（可能是刚选的音源）
  if (bvid && startIdx >= 0) {
    songs[startIdx].bvid = bvid;
    songs[startIdx].id = bvid;
  }

  if (typeof setPlayContext === 'function') {
    setPlayContext({
      type: 'history',
      id: '',
      name: '历史播放',
      songs: songs,
    }, startIdx < 0 ? 0 : startIdx);
    try {
      if (typeof playQueueAt === 'function') playQueueAt(startIdx < 0 ? 0 : startIdx);
    } catch (e) {}
  }

  closeHistoryPanel();
}

/** 从历史移除 */
function historyRemoveItem(idx) {
  var it = HISTORY_UI.items[idx];
  if (!it) return;
  askConfirm('从历史移除', '「' + it.name + '」将从播放历史中移除（不影响歌单和文件）。', '移除')
    .then(function (ok) {
      if (!ok) return;
      fetch('/api/history/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: it.key }),
      }).then(function () {
        showToastSafe('已移除');
        renderHistoryList();
      });
    });
}

/** 清理全部 */
function historyClearAll() {
  askConfirm('清理全部历史', '将清空所有播放记录（不影响歌单和下载的文件）。', '清空')
    .then(function (ok) {
      if (!ok) return;
      fetch('/api/history/clear', { method: 'POST' })
        .then(function () {
          showToastSafe('历史已清空');
          HISTORY_UI.openKeys = {};
          renderHistoryList();
        });
    });
}

/* ---------------------------------------------------------------- 工具 */
function escH(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTimeH(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  var m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function fmtAgo(ts) {
  if (!ts) return '';
  var diff = (Date.now() - ts) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
  try {
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  } catch (e) {
    return '';
  }
}
