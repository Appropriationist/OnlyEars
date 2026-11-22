/* ==========================================================================
   下载管理 + 下载设置
   --------------------------------------------------------------------------
   用户要求：
     · 首页「平台热歌」→ 下载管理（看已下载、打开目录）
     · 首页「推荐电台」→ 下载设置（路径、格式）
     · 下载中可以暂停 / 取消
     · 批量下载可以先挑歌（不一定要全下）

   数据来源：
     · /api/dl/settings   读/写设置
     · /api/dl/list       已下载的文件（后端扫描目录）
     · /api/dl/status     任务进度
   ========================================================================== */

var DLM = {
  open: false,
  files: [],
};

/* ---------------------------------------------------------------- 面板骨架 */
function ensureDlPanel() {
  var old = document.getElementById('dlm-panel');
  if (old) return old;

  var d = document.createElement('div');
  d.id = 'dlm-panel';
  d.className = 'dlm-mask';
  d.innerHTML =
    '<div class="dlm-card">' +
      '<div class="dlm-head">' +
        '<div class="dlm-tabs">' +
          '<button class="dlm-tab on" data-tab="list">已下载</button>' +
          '<button class="dlm-tab" data-tab="settings">设置</button>' +
        '</div>' +
        '<button class="dlm-close" type="button" data-dlm-close="1" title="关闭">×</button>' +
      '</div>' +
      '<div class="dlm-body" id="dlm-body"></div>' +
    '</div>';
  document.body.appendChild(d);

  d.addEventListener('click', function (e) {
    if (e.target === d || e.target.closest('[data-dlm-close]')) closeDlPanel();
  });
  d.querySelectorAll('.dlm-tab').forEach(function (b) {
    b.addEventListener('click', function () {
      var tab = b.getAttribute('data-tab');
      d.querySelectorAll('.dlm-tab').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      if (tab === 'list') renderDlList();
      else renderDlSettings();
    });
  });
  return d;
}

function openDownloadManager() {
  var d = ensureDlPanel();
  d.classList.add('show');
  DLM.open = true;
  d.querySelectorAll('.dlm-tab').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-tab') === 'list');
  });
  renderDlList();
}

function openDownloadSettings() {
  var d = ensureDlPanel();
  d.classList.add('show');
  DLM.open = true;
  d.querySelectorAll('.dlm-tab').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-tab') === 'settings');
  });
  renderDlSettings();
}

function closeDlPanel() {
  var d = document.getElementById('dlm-panel');
  if (d) d.classList.remove('show');
  DLM.open = false;
}

/* ---------------------------------------------------------------- 已下载列表 */
async function renderDlList() {
  var body = document.getElementById('dlm-body');
  if (!body) return;

  body.innerHTML = '<div class="dlm-loading">正在读取下载目录…</div>';

  try {
    var r = await fetch('/api/dl/list').then(function (x) { return x.json(); });
    var files = (r && r.files) || [];
    var dir = (r && r.dir) || '';
    var totalSize = (r && r.totalSize) || 0;
    DLM.files = files;

    if (!files.length) {
      DLM.selected = {};
      body.innerHTML =
        '<div class="dlm-empty">' +
          '<div class="dlm-empty-icon">⬇</div>' +
          '<div>还没有下载任何歌曲</div>' +
          '<div class="dlm-empty-sub">搜索歌名，点右侧的下载按钮</div>' +
        '</div>' +
        '<div class="dlm-dir-bar">' +
          '<span title="' + escHtmlLite(dir) + '">' + escHtmlLite(dir) + '</span>' +
        '</div>';
      return;
    }

    var selCount = Object.keys(DLM.selected || {}).filter(function (k) { return DLM.selected[k]; }).length;
    var allSelected = selCount === files.length && files.length > 0;

    var html = '<div class="dlm-summary">' +
        '<span>' + files.length + ' 个文件 · ' + fmtSize(totalSize) +
          (selCount ? ' · 已选 ' + selCount : '') + '</span>' +
        '<button class="dlm-open-dir" type="button" onclick="openDownloadFolder()">打开文件夹</button>' +
      '</div>';

    /* 批量操作栏：有选中时才显示 */
    html += '<div class="dlm-batch-bar' + (selCount ? ' show' : '') + '">' +
        '<label class="dlm-sel-all">' +
          '<input type="checkbox" id="dlm-sel-all"' + (allSelected ? ' checked' : '') +
            ' onchange="dlmToggleAll(this.checked)">' +
          '<span>全选</span>' +
        '</label>' +
        '<span class="dlm-batch-count">已选 ' + selCount + ' 项</span>' +
        '<button type="button" class="dlm-batch-btn" onclick="dlmBatchPlay()">' +
          '<svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>播放' +
        '</button>' +
        '<button type="button" class="dlm-batch-btn ghost" onclick="dlmBatchDelete(false)">' +
          '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>移除' +
        '</button>' +
        '<button type="button" class="dlm-batch-btn danger" onclick="dlmBatchDelete(true)">' +
          '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>删除' +
        '</button>' +
      '</div>';

    html += '<div class="dlm-file-list">';
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var checked = !!(DLM.selected && DLM.selected[f.path]);
      html += '<div class="dlm-file' + (checked ? ' picked' : '') + '" data-dlm-file="' + i + '">' +
          '<input type="checkbox" class="dlm-file-check" data-dlm-check="' + i + '"' +
            (checked ? ' checked' : '') +
            ' onclick="event.stopPropagation();dlmToggleOne(' + i + ', this.checked)">' +
          '<div class="dlm-file-icon">' + (f.format === 'mp3' ? '♪' : '♫') + '</div>' +
          '<div class="dlm-file-info">' +
            '<div class="dlm-file-name">' + escHtmlLite(f.name) + '</div>' +
            '<div class="dlm-file-meta">' + fmtSize(f.size) + ' · ' +
              new Date(f.mtime).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
            '</div>' +
          '</div>' +
          '<button class="dlm-file-del" type="button" title="删除文件" data-dlm-del="' + i + '">×</button>' +
        '</div>';
    }
    html += '</div>';
    body.innerHTML = html;

    // 点行 = 播放
    body.querySelectorAll('[data-dlm-file]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('[data-dlm-del]') || e.target.closest('[data-dlm-check]')) return;
        var idx = +el.getAttribute('data-dlm-file');
        playDownloadedFile(files[idx]);
      });
    });
    // 单条删除
    body.querySelectorAll('[data-dlm-del]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = +btn.getAttribute('data-dlm-del');
        deleteDownloadedFile(files[idx]);
      });
    });
  } catch (e) {
    body.innerHTML = '<div class="dlm-empty">读取失败：' + escHtmlLite(e.message) + '</div>';
  }
}

/* ---------------------------------------------------------------- 批量选择 */
function dlmToggleOne(idx, checked) {
  if (!DLM.selected) DLM.selected = {};
  var f = DLM.files[idx];
  if (!f) return;
  if (checked) DLM.selected[f.path] = true;
  else delete DLM.selected[f.path];
  renderDlList();
}

function dlmToggleAll(checked) {
  DLM.selected = {};
  if (checked) {
    DLM.files.forEach(function (f) { DLM.selected[f.path] = true; });
  }
  renderDlList();
}

function dlmSelectedFiles() {
  var sel = DLM.selected || {};
  return DLM.files.filter(function (f) { return sel[f.path]; });
}

/* 播放选中的文件（作为播放上下文） */
function dlmBatchPlay() {
  var picked = dlmSelectedFiles();
  if (!picked.length) { showToastSafe('先勾选歌曲'); return; }

  var items = picked.map(function (f) {
    return {
      provider: 'local', source: 'local', type: 'local',
      id: f.path, audioPath: f.path, localPath: f.path,
      name: String(f.name).replace(/\.(m4a|mp3|flac|wav|ogg)$/i, ''),
      artist: '',
    };
  });

  if (typeof setPlayContext === 'function') {
    setPlayContext({ type: 'local', id: '', name: '下载选中', songs: items }, 0);
    try { if (typeof playQueueAt === 'function') playQueueAt(0); } catch (e) {}
  }
  closeDlPanel();
}

/* 批量删除 */
function dlmBatchDelete(deleteFile) {
  var picked = dlmSelectedFiles();
  if (!picked.length) { showToastSafe('先勾选歌曲'); return; }

  var msg = deleteFile
    ? ('将删除 ' + picked.length + ' 个文件，同时从磁盘移除，不可恢复。')
    : ('将把这 ' + picked.length + ' 项从列表移除，磁盘文件保留。');

  askConfirm(deleteFile ? '删除文件和列表' : '从列表移除', msg, deleteFile ? '删除' : '移除')
    .then(function (ok) {
      if (!ok) return;
      var paths = picked.map(function (f) { return f.path; });

      fetch('/api/dl/delete-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: paths, deleteFile: deleteFile }),
      })
        .then(function (x) { return x.json(); })
        .then(function (res) {
          if (res && res.ok) {
            showToastSafe('已处理 ' + (res.count || picked.length) + ' 项');
            DLM.selected = {};
            renderDlList();
            if (typeof refreshDownloadHomeCards === 'function') refreshDownloadHomeCards();
          } else {
            showToastSafe('操作失败：' + (res && res.error || ''));
          }
        })
        .catch(function () { showToastSafe('操作失败'); });
    });
}


function playDownloadedFile(f) {
  if (!f || !f.name) return;
  /* 本地文件走 Mineradio 的本地播放协议。
     它的 media 协议前缀在 preload 里注册过，形如 mineradio-media://
     这里用 file:// 试试；如果不行，退化成"在文件夹里定位" */
  var item = {
    provider: 'local', source: 'local', type: 'local',
    id: f.path,
    localPath: f.path,
    name: f.name.replace(/\.(m4a|mp3|flac|wav|ogg)$/i, ''),
    artist: '',
  };
  try {
    if (typeof playQueue !== 'undefined' && typeof playQueueAt === 'function') {
      playQueue.unshift(item);
      currentIdx = 0;
      playQueueAt(0);
      closeDlPanel();
      return;
    }
  } catch (e) {}
  showToastSafe('无法直接播放，请打开文件夹');
}

function deleteDownloadedFile(f) {
  if (!f) return;
  askConfirm('删除文件', '「' + f.name + '」将从磁盘删除，无法恢复。', '删除').then(function (ok) {
    if (!ok) return;
    fetch('/api/dl/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: f.path }),
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res && res.ok) {
        showToastSafe('已删除');
        renderDlList();
      } else {
        showToastSafe('删除失败：' + (res && res.error || ''));
      }
    });
  });
}

async function openDownloadFolder() {
  try {
    await fetch('/api/dl/open-folder', { method: 'POST' });
  } catch (e) {
    showToastSafe('无法打开文件夹，路径见下方');
  }
}

/* ---------------------------------------------------------------- 设置 */
async function renderDlSettings() {
  var body = document.getElementById('dlm-body');
  if (!body) return;

  body.innerHTML = '<div class="dlm-loading">读取设置…</div>';

  var s = {};
  try {
    s = await fetch('/api/dl/settings').then(function (x) { return x.json(); });
  } catch (e) {}

  body.innerHTML =
    '<div class="dlm-set">' +
      '<div class="dlm-set-row">' +
        '<label>保存路径</label>' +
        '<input id="dlm-set-dir" type="text" spellcheck="false" value="' + escHtmlLite(s.dir || '') + '">' +
      '</div>' +
      '<div class="dlm-set-row">' +
        '<label>默认格式</label>' +
        '<div class="dlm-fmt-row">' +
          '<button type="button" class="dlm-fmt' + (s.format === 'm4a' ? ' on' : '') + '" data-set-fmt="m4a">' +
            '<b>m4a</b><small>原始音质 · 不转码</small>' +
          '</button>' +
          '<button type="button" class="dlm-fmt' + (s.format === 'mp3' ? ' on' : '') + '" data-set-fmt="mp3"' +
            (s.ffmpegAvailable ? '' : ' disabled') + '>' +
            '<b>mp3</b><small>' + (s.ffmpegAvailable ? '192kbps' : '未安装 ffmpeg') + '</small>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="dlm-set-note">' +
        'ffmpeg：' + (s.ffmpegAvailable ? '<span class="ok">已找到</span> ' + escHtmlLite(s.ffmpeg || '') : '<span class="bad">未找到</span>（只能存 m4a）') +
      '</div>' +
      '<button class="dlm-save" type="button" onclick="saveDlSettings()">保存设置</button>' +
    '</div>';

  var fmt = s.format || 'm4a';
  body.querySelectorAll('.dlm-fmt').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      fmt = b.getAttribute('data-set-fmt');
      body.querySelectorAll('.dlm-fmt').forEach(function (x) {
        x.classList.toggle('on', x.getAttribute('data-set-fmt') === fmt);
      });
    });
  });
  body._pendingFormat = function () { return fmt; };
}

async function saveDlSettings() {
  var body = document.getElementById('dlm-body');
  var dir = body.querySelector('#dlm-set-dir')?.value.trim() || '';
  var fmt = body._pendingFormat ? body._pendingFormat() : 'm4a';

  try {
    await fetch('/api/dl/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: dir, format: fmt }),
    });
    showToastSafe('设置已保存');
    DL_PREFS.loaded = false;   // 下次重新读
    renderDlSettings();
  } catch (e) {
    showToastSafe('保存失败');
  }
}

/* ---------------------------------------------------------------- 首页文案 */
async function refreshDownloadHomeCards() {
  try {
    var r = await fetch('/api/dl/list').then(function (x) { return x.json(); });
    var n = (r && r.files) ? r.files.length : 0;
    var size = (r && r.totalSize) || 0;
    var a = document.getElementById('home-download-sub');
    if (a) a.textContent = n ? (n + ' 首 · ' + fmtSize(size)) : '还没有下载';
  } catch (e) {}

  try {
    var s = await fetch('/api/dl/settings').then(function (x) { return x.json(); });
    var b = document.getElementById('home-download-settings-sub');
    if (b) b.textContent = (s.format === 'mp3' ? 'mp3 转码' : 'm4a 直存') +
      (s.dir ? ' · ' + String(s.dir).split('\\').pop() : '');
  } catch (e) {}
}

(function initDownloadUi() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(refreshDownloadHomeCards, CFG.DOWNLOAD_REFRESH_DELAY + 1000); });
  } else {
    setTimeout(refreshDownloadHomeCards, CFG.DOWNLOAD_REFRESH_DELAY + 1000);
  }
  window.addEventListener('bili:downloaded', function () {
    setTimeout(refreshDownloadHomeCards, CFG.BAR_GUARD_INTERVAL);
    if (DLM.open) renderDlList();
  });
})();
