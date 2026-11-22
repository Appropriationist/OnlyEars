/* ==========================================================================
   下载确认框
   --------------------------------------------------------------------------
   用户要求：点下载后先问三件事
     · 下载到哪里（可以改目录）
     · 什么格式（m4a / mp3）
     · 以后是否默认用这个设置

   下载中显示进度，完成弹提示（带文件路径，点击可打开所在文件夹）。
   ========================================================================== */

var DL_PREFS = {
  dir: '',
  format: 'm4a',
  remember: true,
  skipConfirm: false,   // 用户勾了「不再询问」后为 true
  ffmpegAvailable: false,
  loaded: false,
};

/* 「不再询问」存在 localStorage，跨会话保留 */
var DL_SKIP_KEY = 'bili-dl-skip-confirm';

function readSkipConfirm() {
  try { return localStorage.getItem(DL_SKIP_KEY) === '1'; } catch (e) { return false; }
}
function writeSkipConfirm(on) {
  try {
    if (on) localStorage.setItem(DL_SKIP_KEY, '1');
    else localStorage.removeItem(DL_SKIP_KEY);
  } catch (e) {}
}

/* ---------------------------------------------------------------- 读设置 */
async function loadDownloadPrefs() {
  if (DL_PREFS.loaded) return DL_PREFS;
  try {
    var s = await fetch('/api/dl/settings').then(function (x) { return x.json(); });
    DL_PREFS.dir = s.dir || '';
    DL_PREFS.format = s.format || 'm4a';
    DL_PREFS.ffmpegAvailable = !!s.ffmpegAvailable;
    DL_PREFS.skipConfirm = readSkipConfirm();
    DL_PREFS.loaded = true;
  } catch (e) { /* 保持默认 */ }
  return DL_PREFS;
}

/* ---------------------------------------------------------------- 确认框 */
/**
 * 弹下载设置框。返回 Promise<{dir, format, remember}|null>
 * 取消返回 null。
 */
function askDownloadOptions(songName, count) {
  return loadDownloadPrefs().then(function (prefs) {
    /* 用户勾过「不再询问」→ 直接返回现有设置，不弹框 */
    if (prefs.skipConfirm && prefs.dir) {
      return { dir: prefs.dir, format: prefs.format, remember: true, skipped: true };
    }
    return new Promise(function (resolve) {
      var old = document.getElementById('dl-confirm');
      if (old) old.parentNode.removeChild(old);

      var d = document.createElement('div');
      d.id = 'dl-confirm';
      d.className = 'dlc-mask';
      d.innerHTML =
        '<div class="dlc-card">' +
          '<div class="dlc-title">下载' + (count > 1 ? ' ' + count + ' 首' : '') + '</div>' +
          '<div class="dlc-sub">' + escHtmlLite(songName || '') + '</div>' +

          '<div class="dlc-field">' +
            '<label>保存到</label>' +
            '<div class="dlc-dir-row">' +
              '<input id="dlc-dir" type="text" spellcheck="false" value="' + escHtmlLite(prefs.dir) + '">' +
            '</div>' +
          '</div>' +

          '<div class="dlc-field">' +
            '<label>格式</label>' +
            '<div class="dlc-fmt-row">' +
              '<button type="button" class="dlc-fmt' + (prefs.format === 'm4a' ? ' on' : '') + '" data-fmt="m4a">' +
                '<b>m4a</b><small>原始音质 · 不转码 · 最快</small>' +
              '</button>' +
              '<button type="button" class="dlc-fmt' + (prefs.format === 'mp3' ? ' on' : '') + '" data-fmt="mp3"' +
                (prefs.ffmpegAvailable ? '' : ' disabled title="需要 ffmpeg"') + '>' +
                '<b>mp3</b><small>' + (prefs.ffmpegAvailable ? '192kbps · 兼容老设备' : '需要 ffmpeg（未安装）') + '</small>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<label class="dlc-remember">' +
            '<input id="dlc-remember" type="checkbox" checked>' +
            '<span>以后都用这个设置，不再询问</span>' +
          '</label>' +

          '<div class="dlc-actions">' +
            '<button type="button" class="dlc-btn ghost" data-act="cancel">取消</button>' +
            '<button type="button" class="dlc-btn primary" data-act="ok">开始下载</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(d);

      var fmt = prefs.format;

      // 格式切换
      d.querySelectorAll('.dlc-fmt').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.disabled) return;
          fmt = b.getAttribute('data-fmt');
          d.querySelectorAll('.dlc-fmt').forEach(function (x) {
            x.classList.toggle('on', x.getAttribute('data-fmt') === fmt);
          });
        });
      });

      function done(v) {
        if (d.parentNode) d.parentNode.removeChild(d);
        resolve(v);
      }

      d.querySelector('[data-act="cancel"]').onclick = function () { done(null); };
      d.querySelector('[data-act="ok"]').onclick = function () {
        var dir = d.querySelector('#dlc-dir').value.trim();
        var rem = d.querySelector('#dlc-remember').checked;
        /* 勾了「不再询问」→ 记住，下次直接下载 */
        if (rem) {
          writeSkipConfirm(true);
          DL_PREFS.skipConfirm = true;
        } else {
          writeSkipConfirm(false);
          DL_PREFS.skipConfirm = false;
        }
        done({ dir: dir, format: fmt, remember: rem });
      };
      d.addEventListener('click', function (e) { if (e.target === d) done(null); });

      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); document.removeEventListener('keydown', onKey, true); done(null); }
        if (e.key === 'Enter') { e.stopPropagation(); d.querySelector('[data-act="ok"]').click(); }
      }
      document.addEventListener('keydown', onKey, true);

      setTimeout(function () {
        var inp = d.querySelector('#dlc-dir');
        if (inp) inp.focus();
      }, CFG.MODAL_FOCUS_DELAY);
    });
  });
}

function escHtmlLite(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------------------------------------------------------- 下载主流程 */
/**
 * 统一的下载入口（替换旧的 downloadSong）。
 * 流程：问设置 → 保存设置 → 下载 → 进度 → 完成提示
 */
async function downloadSongWithConfirm(song, btn) {
  if (!song || DL_UI.busy[song.name]) return;

  var opts = await askDownloadOptions(song.name || '', 1);
  if (!opts) return;

  // 保存设置
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

  var key = song.name || song.bvid || 'x';
  DL_UI.busy[key] = true;
  if (btn) btn.classList.add('dl-busy');

  var prog = ensureDownloadProgressHost();
  showDownloadProgress(prog, '正在解析音源…', 0);

  try {
    var res = await fetch('/api/dl/one', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bvid: song.bvid || '',
        cid: song.cid || 0,
        name: song.name || '',
        artist: song.artist || '',
        duration: song.duration || 0,
        format: opts.format,
      }),
    }).then(function (x) { return x.json(); });

    if (res && res.path) {
      showDownloadProgress(prog, '下载完成', 100);
      setTimeout(function () { hideDownloadProgress(prog); }, CFG.DOWNLOAD_PROGRESS_HIDE);

      /* 下载完立刻注册进本地曲库 ——
         这样「本地和下载」列表里马上就有这一首，不用手动导入。 */
      if (window.desktopWindow && typeof window.desktopWindow.registerDownloadedFiles === 'function') {
        window.desktopWindow.registerDownloadedFiles([res.path])
          .then(function (reg) {
            if (reg && reg.tracks && reg.tracks.length) {
              console.log('[Download] 已加入本地曲库:', reg.tracks[0].name);
            }
          })
          .catch(function (e) { console.warn('[Download] 注册曲库失败', e); });
      }

      showDownloadDone(res);
      try { window.dispatchEvent(new CustomEvent('bili:downloaded', { detail: res })); } catch (e) {}
    } else {
      hideDownloadProgress(prog);
      showToastSafe('下载失败：' + (res && (res.message || res.error) || '未知错误'));
    }
  } catch (e) {
    hideDownloadProgress(prog);
    showToastSafe('下载失败：' + (e.message || ''));
  } finally {
    DL_UI.busy[key] = false;
    if (btn) btn.classList.remove('dl-busy');
  }
}

function showDownloadProgress(host, label, pct) {
  host.classList.add('show');
  host.innerHTML =
    '<div class="dlp-title">' + escHtmlLite(label) + '</div>' +
    '<div class="dlp-bar"><i style="width:' + (pct || 0) + '%"></i></div>';
}
function hideDownloadProgress(host) {
  host.classList.remove('show');
}

/* ---------------------------------------------------------------- 完成提示 */
function showDownloadDone(res) {
  var old = document.getElementById('dl-done');
  if (old) old.parentNode.removeChild(old);

  var d = document.createElement('div');
  d.id = 'dl-done';
  d.className = 'dld-mask';
  d.innerHTML =
    '<div class="dld-card">' +
      '<div class="dld-icon">' +
        '<svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">' +
          '<path d="M20 6L9 17l-5-5"/></svg>' +
      '</div>' +
      '<div class="dld-title">下载完成</div>' +
      '<div class="dld-name">' + escHtmlLite(res.name || '') + '</div>' +
      '<div class="dld-meta">' + fmtSize(res.size) + ' · ' + escHtmlLite(res.format || '') + '</div>' +
      '<div class="dld-path" title="' + escHtmlLite(res.path || '') + '">' + escHtmlLite(res.path || '') + '</div>' +
      '<div class="dld-actions">' +
        '<button type="button" class="dld-btn ghost" data-act="close">关闭</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(d);

  function close() { if (d.parentNode) d.parentNode.removeChild(d); }
  d.querySelector('[data-act="close"]').onclick = close;
  d.addEventListener('click', function (e) { if (e.target === d) close(); });
  setTimeout(close, CFG.DOWNLOAD_DONE_DURATION);
}

/* 覆盖旧入口 */
function downloadSong(song, btn) {
  return downloadSongWithConfirm(song, btn);
}
