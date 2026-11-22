/* ==========================================================================
   下载 UI
   --------------------------------------------------------------------------
   入口：
     · 搜索下拉每行          [⬇]
     · 整页搜索每行          [⬇]
     · 找音源页每行          [⬇]
     · 歌单详情顶部          [下载整个歌单]
     · 歌单详情每首          [⬇]

   流程：
     单曲   → /api/dl/one       → toast 提示
     批量   → /api/dl/playlist  → 轮询进度 → 完成提示
     取消   → /api/dl/cancel    → 立刻隐藏进度条
   ========================================================================== */

var DL_UI = {
  busy: {},              // bvid -> true（防重复点）
  taskTimer: null,
  taskId: null,
  currentTaskId: null,
};

/* ---------------------------------------------------------------- 单曲 */
/**
 * 下载一首（不弹确认框的底层实现，由 94-download-confirm.js 的
 * downloadSongWithConfirm 覆盖后对外暴露）。
 */
async function downloadSong(song, btn) {
  if (!song) return;
  var bvid = song.bvid || '';
  if (!bvid || !/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
    showToastSafe('正在查找音源…');
    try {
      var r = await biliApiJson(
        '/api/bili/source?title=' + encodeURIComponent(song.name || '') +
        '&artist=' + encodeURIComponent(song.artist || '') +
        '&duration=' + encodeURIComponent(String(Math.round((song.duration || 0) / 1000) || 0)) +
        '&mode=balanced',
        { timeoutMs: CFG.SEARCH_TIMEOUT }
      );
      var cands = (r && r.candidates) || [];
      if (!cands.length) { showToastSafe('没有找到可用音源'); return; }
      bvid = cands[0].bvid;
    } catch (e) {
      showToastSafe('查找音源失败');
      return;
    }
  }

  if (DL_UI.busy[bvid]) return;
  DL_UI.busy[bvid] = true;
  if (btn) btn.classList.add('dl-busy');

  try {
    var fmt = await getDownloadFormat();
    var res = await fetch('/api/dl/one', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bvid: bvid,
        cid: song.cid || 0,
        name: song.name || '',
        artist: song.artist || '',
        format: fmt,
      }),
    }).then(function (x) { return x.json(); });

    if (res && res.path) {
      showToastSafe('已下载：' + res.name + '（' + fmtSize(res.size) + '）');
      try { window.dispatchEvent(new CustomEvent('bili:downloaded', { detail: res })); } catch (e) {}
    } else {
      showToastSafe('下载失败：' + (res && res.error || '未知错误'));
    }
  } catch (e) {
    showToastSafe('下载失败：' + (e.message || ''));
  } finally {
    DL_UI.busy[bvid] = false;
    if (btn) btn.classList.remove('dl-busy');
  }
}

/* ---------------------------------------------------------------- 歌单批量 */
async function downloadPlaylist(playlistId, playlistName) {
  if (!playlistId) return;
  var fmt = await getDownloadFormat();
  showToastSafe('正在解析歌单音源…');

  try {
    var res = await fetch('/api/dl/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: playlistId, format: fmt }),
    }).then(function (x) { return x.json(); });

    if (!res || !res.taskId) {
      showToastSafe('无法下载：' + (res && res.error || ''));
      return;
    }

    DL_UI.taskId = res.taskId;
    showToastSafe('开始下载 ' + res.total + ' 首…');
    startDownloadTaskPolling(res.taskId);
  } catch (e) {
    showToastSafe('下载失败：' + (e.message || ''));
  }
}

/* ---------------------------------------------------------------- 进度轮询 */
function startDownloadTaskPolling(taskId) {
  stopDownloadTaskPolling();
  DL_UI.currentTaskId = taskId;

  setDownloadBusyState(true, 1);

  var host = ensureDownloadProgressHost();
  host.classList.add('show');
  host.innerHTML =
    '<div class="dlp-title">正在下载…</div>' +
    '<div class="dlp-bar"><i style="width:0%"></i></div>' +
    '<div class="dlp-row">' +
      '<div class="dlp-info">0 / 0</div>' +
      '<button type="button" class="dlp-cancel" onclick="cancelCurrentDownload()">取消</button>' +
    '</div>';

  DL_UI.taskTimer = setInterval(async function () {
    try {
      var st = await fetch('/api/dl/status?id=' + encodeURIComponent(taskId)).then(function (x) { return x.json(); });
      if (!st || st.error) { stopDownloadTaskPolling(); return; }

      // 任务已结束 → 处理收尾
      if (!st.running) {
        finishDownloadTask(st);
        return;
      }

      // 正在取消中（后端已标记但还没停）
      if (st.cancelled) {
        var t = host.querySelector('.dlp-title');
        if (t) t.textContent = '正在停止…';
        return;
      }

      var pct = st.total ? Math.round((st.done + st.failed) / st.total * 100) : 0;
      var bar = host.querySelector('.dlp-bar i');
      var info = host.querySelector('.dlp-info');
      var title = host.querySelector('.dlp-title');
      if (bar) bar.style.width = pct + '%';
      if (info) info.textContent = (st.done + st.failed) + ' / ' + st.total +
        (st.failed ? '（失败 ' + st.failed + '）' : '');
      if (title) title.textContent = '正在下载：' + (st.current || '…');

      // 同步剩余数给主进程（关闭窗口时显示正确数字）
      var remain = Math.max(0, (st.total || 0) - (st.done + st.failed));
      setDownloadBusyState(remain > 0, remain);
    } catch (e) { /* 网络抖动，下次再试 */ }
  }, CFG.DOWNLOAD_POLL);
}

/** 任务结束的统一收尾 */
function finishDownloadTask(st) {
  stopDownloadTaskPolling();
  setDownloadBusyState(false, 0);

  var host = ensureDownloadProgressHost();

  if (st.cancelled) {
    // 取消：立刻隐藏，不再显示「已取消」的静止框
    host.classList.remove('show');
    showToastSafe('已取消，已下载 ' + st.done + ' 首');
    return;
  }

  host.classList.remove('show');
  showToastSafe('下载完成：成功 ' + st.done + ' 首' +
    (st.failed ? '，失败 ' + st.failed + ' 首' : ''));

  // 把下载成功的文件批量注册进本地曲库
  try {
    var okPaths = (st.results || [])
      .filter(function (r) { return r && r.ok && r.path; })
      .map(function (r) { return r.path; });
    if (okPaths.length && window.desktopWindow &&
        typeof window.desktopWindow.registerDownloadedFiles === 'function') {
      window.desktopWindow.registerDownloadedFiles(okPaths)
        .then(function (reg) {
          console.log('[Download] 批量加入曲库:', (reg && reg.tracks || []).length, '首');
        })
        .catch(function (e) { console.warn('[Download] 批量注册失败', e); });
    }
  } catch (e) {}

  try { window.dispatchEvent(new CustomEvent('bili:downloaded', { detail: st.results })); } catch (e) {}
}

function stopDownloadTaskPolling() {
  if (DL_UI.taskTimer) {
    clearInterval(DL_UI.taskTimer);
    DL_UI.taskTimer = null;
  }
}

/** 下载中状态同步给主进程（用于关窗口拦截） */
function setDownloadBusyState(busy, count) {
  try {
    if (window.desktopWindow && typeof window.desktopWindow.setDownloadBusy === 'function') {
      window.desktopWindow.setDownloadBusy(!!busy, Number(count) || 0);
    }
  } catch (e) {}
}

/* ---------------------------------------------------------------- 取消 */
/**
 * 取消下载。
 *
 * 关键：立刻隐藏进度条。用户点了取消就不该盯着一个静止的框等。
 * 后端会在当前这首下完后真正停止（最多几十秒），但用户不需要等。
 */
async function cancelCurrentDownload() {
  var id = DL_UI.currentTaskId;
  if (!id) return;

  var host = ensureDownloadProgressHost();
  host.classList.remove('show');
  stopDownloadTaskPolling();
  setDownloadBusyState(false, 0);
  showToastSafe('已取消下载');

  try {
    await fetch('/api/dl/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id }),
    });
  } catch (e) {
    console.warn('[Download] 取消请求失败', e);
  }
}

function ensureDownloadProgressHost() {
  var h = document.getElementById('bili-dl-progress');
  if (!h) {
    h = document.createElement('div');
    h.id = 'bili-dl-progress';
    document.body.appendChild(h);
  }
  return h;
}

/* ---------------------------------------------------------------- 设置 */
async function getDownloadFormat() {
  try {
    var s = await fetch('/api/dl/settings').then(function (x) { return x.json(); });
    return (s && s.format) === 'mp3' ? 'mp3' : 'm4a';
  } catch (e) {
    return 'm4a';
  }
}

function fmtSize(bytes) {
  var n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

function showToastSafe(msg) {
  if (typeof showToast === 'function') { try { showToast(msg); return; } catch (e) {} }
  var t = document.createElement('div');
  t.className = 'bili-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.classList.add('out'); }, CFG.TOAST_DURATION);
  setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, CFG.TOAST_DURATION + CFG.TOAST_FADE);
}

/* ---------------------------------------------------------------- 按钮 HTML */
function dlButtonHtml(song, extraClass) {
  var payload = encodeURIComponent(JSON.stringify({
    bvid: song.bvid || '',
    cid: song.cid || 0,
    name: song.name || song.title || '',
    artist: song.artist || '',
    duration: song.duration || 0,
  }));
  return '<button class="dl-btn ' + (extraClass || '') + '" type="button" title="下载" ' +
    'data-dl="' + payload + '" ' +
    'onclick="event.stopPropagation();dlFromButton(this)">' +
    '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
      '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>' +
    '</button>';
}

function dlFromButton(btn) {
  try {
    var raw = btn.getAttribute('data-dl') || '';
    var song = JSON.parse(decodeURIComponent(raw));
    downloadSong(song, btn);
  } catch (e) {
    showToastSafe('下载参数错误');
  }
}

/* 事件委托：任何带 data-dl-song 的元素点击都触发下载 */
document.addEventListener('click', function (e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-dl-song]') : null;
  if (!el) return;
  e.stopPropagation();
  try {
    var song = JSON.parse(decodeURIComponent(el.getAttribute('data-dl-song')));
    downloadSong(song, el);
  } catch (err) {}
}, true);

/* ==========================================================================
   关闭窗口时的下载拦截
   --------------------------------------------------------------------------
   主进程在窗口关闭时发事件，我们弹自己的确认框。
   点「强制退出」→ 通知主进程真关。
   ========================================================================== */
(function bindDownloadCloseGuard() {
  function bind() {
    if (!window.desktopWindow || typeof window.desktopWindow.onDownloadCloseRequest !== 'function') {
      setTimeout(bind, 1500);
      return;
    }
    window.desktopWindow.onDownloadCloseRequest(function (payload) {
      var n = (payload && payload.count) || 0;
      askConfirm(
        '正在下载',
        '还有 ' + n + ' 首歌曲正在下载。退出会中断下载，已经下完的文件会保留。',
        '强制退出'
      ).then(function (ok) {
        if (ok && typeof window.desktopWindow.confirmClose === 'function') {
          window.desktopWindow.confirmClose();
        }
      });
    });
  }
  bind();
})();
