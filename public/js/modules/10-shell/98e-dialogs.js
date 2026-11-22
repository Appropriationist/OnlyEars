/* ==========================================================================
   搜索 UI · 对话框与辅助
   --------------------------------------------------------------------------
   askPlaylistName         歌单命名框
   searchSubmit            主页回车 / 放大镜
   searchPageSubmit        整页回车 / 放大镜
   bindSearchUi            所有事件绑定
   biliSelfCheck           自检（Ctrl+Alt+D）
   forceShowBottomBar      播放条强制显示
   startBottomBarGuard     搜索页里的播放条守护
   askConfirm              自定义确认框（替代原生 confirm）
   showAddToPlaylistMenu   加入歌单菜单
   ========================================================================== */

function askPlaylistName(defaultName, count) {
  return new Promise(function (resolve) {
    var old = document.getElementById('pl-name-dialog');
    if (old) old.parentNode.removeChild(old);

    var d = document.createElement('div');
    d.id = 'pl-name-dialog';
    d.className = 'pl-name-mask';
    d.innerHTML =
      '<div class="pl-name-card">' +
        '<div class="pl-name-title">创建歌单</div>' +
        '<div class="pl-name-sub">共 ' + count + ' 首，保存到本地</div>' +
        '<input id="pl-name-input" type="text" maxlength="60" autocomplete="off" spellcheck="false">' +
        '<div class="pl-name-actions">' +
          '<button type="button" class="pl-name-btn ghost" data-act="cancel">取消</button>' +
          '<button type="button" class="pl-name-btn" data-act="ok">创建</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);

    var inp = d.querySelector('#pl-name-input');
    inp.value = defaultName;

    var okBtn = d.querySelector('[data-act="ok"]');
    function syncOkState() {
      if (!okBtn) return;
      okBtn.disabled = !inp.value.trim();
    }
    inp.addEventListener('input', syncOkState);
    syncOkState();
    setTimeout(function () {
      inp.focus();
      inp.select();
    }, CFG.MODAL_FOCUS_DELAY);

    function done(val) {
      if (d.parentNode) d.parentNode.removeChild(d);
      resolve(val);
    }

    d.querySelector('[data-act="cancel"]').onclick = function () { done(null); };
    d.querySelector('[data-act="ok"]').onclick = function () {
      var v = inp.value.trim();
      done(v || defaultName);
    };
    d.addEventListener('click', function (e) {
      if (e.target === d) done(null);
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var v = inp.value.trim();
        done(v || defaultName);
      } else if (e.key === 'Escape') {
        done(null);
      }
      e.stopPropagation();   // 别让全局 ESC 关掉上层页面
    });
  });
}

/* ==========================================================================
   事件绑定
   ========================================================================== */
function searchSubmit() {
  var inp = document.getElementById('search-input');
  var q = inp ? inp.value.trim() : '';
  if (!q) return;
  openSearchPage(q);
}

/* 搜索页里的放大镜（和主页那个一样的逻辑） */
function searchPageSubmit() {
  var inp = document.getElementById('search-page-input');
  var q = inp ? inp.value.trim() : '';
  if (!q) {
    inp && inp.focus();
    return;
  }
  runSearchUi(q, { forPage: true, page: 1 });
}

(function bindSearchUi() {
  var tries = 0;

  function bind() {
    var inp = document.getElementById('search-input');
    if (!inp) {
      if (++tries < 60) setTimeout(bind, CFG.DEBOUNCE_INPUT / 2);
      return;
    }

    var timer = null;
    inp.addEventListener('input', function () {
      var q = inp.value.trim();
      clearTimeout(timer);
      if (!q) {
        var box = document.getElementById('search-results');
        if (box) box.classList.remove('show');
        return;
      }
      timer = setTimeout(function () { runSearchUi(q, { forDropdown: true }); }, CFG.DEBOUNCE_INPUT);
    });

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchSubmit();
      } else if (e.key === 'Escape') {
        var box = document.getElementById('search-results');
        if (box) box.classList.remove('show');
        inp.blur();
      }
    });

    var pageInp = document.getElementById('search-page-input');
    if (pageInp) {
      var t2 = null;
      pageInp.addEventListener('input', function () {
        var q = pageInp.value.trim();
        clearTimeout(t2);
        if (!q) {
          var list = document.getElementById('search-page-list');
          if (list) list.innerHTML = '';
          var st = document.getElementById('search-page-status');
          if (st) st.textContent = '';
          return;
        }
        t2 = setTimeout(function () { runSearchUi(q, { forPage: true, page: 1 }); }, CFG.DEBOUNCE_INPUT);
      });
      pageInp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var q = pageInp.value.trim();
          if (q) runSearchUi(q, { forPage: true, page: 1 });
        } else if (e.key === 'Escape') {
          closeSearchPage();
        }
      });
    }

    document.addEventListener('click', function (e) {
      var box = document.getElementById('search-results');
      var stack = document.getElementById('search-stack');
      if (box && stack && !stack.contains(e.target)) box.classList.remove('show');

      var sel = document.getElementById('search-mode-select');
      if (sel && !sel.contains(e.target)) {
        sel.classList.remove('open');
        sel.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (SRC_PAGE.song && document.getElementById('source-page') &&
            document.getElementById('source-page').classList.contains('show')) {
          closeSourcePage();
        } else if (SEARCH_UI.pageOpen) {
          closeSearchPage();
        }
      }
    });

    setSearchUiMode('precise');
  }

  bind();
})();

/* ==========================================================================
   自检（给开发期排查用）
   --------------------------------------------------------------------------
   Electron 禁用了 F12，看不到控制台。
   这个函数把关键数据直接画在屏幕上，用户截图就能给我看。
   ========================================================================== */
function biliSelfCheck() {
  var out = [];
  function line(k, v) { out.push(k + ': ' + v); }

  line('devicePixelRatio', window.devicePixelRatio);
  line('innerWidth x innerHeight', window.innerWidth + ' x ' + window.innerHeight);
  line('body.zoom', getComputedStyle(document.body).zoom || 'none');
  line('body.transform', getComputedStyle(document.body).transform);

  var ids = ['sms-btn', 'search-input', 'search-go', 'search-mode-select', 'user-btn', 'home-btn'];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) { line(id, '不存在'); return; }
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var hit = document.elementFromPoint(cx, cy);
    var hitDesc = hit ? (hit.tagName + (hit.id ? '#' + hit.id : '') + (hit.className ? '.' + String(hit.className).split(' ')[0] : '')) : 'null';
    var cs = getComputedStyle(el);
    line(id, 'rect=[' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + 'x' + Math.round(r.height) + ']' +
      ' hit=' + hitDesc +
      ' pe=' + cs.pointerEvents +
      ' region=' + (cs.webkitAppRegion || 'none') +
      ' vis=' + cs.visibility);
  });

  // 检查搜索页状态
  var sp = document.getElementById('search-page');
  line('search-page.show', sp ? sp.classList.contains('show') : 'none');
  line('body.search-page-open', document.body.classList.contains('search-page-open'));
  var bar = document.getElementById('bottom-bar');
  if (bar) {
    var bcs = getComputedStyle(bar);
    var br = bar.getBoundingClientRect();
    line('bottom-bar', 'class=' + bar.className + ' opacity=' + bcs.opacity +
      ' vis=' + bcs.visibility + ' z=' + bcs.zIndex +
      ' h=' + Math.round(br.height) + ' y=' + Math.round(br.top));
  } else {
    line('bottom-bar', '不存在');
  }

  // 显示到屏幕
  var old = document.getElementById('bili-selfcheck');
  if (old) old.parentNode.removeChild(old);
  var d = document.createElement('div');
  d.id = 'bili-selfcheck';
  d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.94);' +
    'color:#0f0;font:12px/1.7 Consolas,monospace;padding:24px;overflow:auto;white-space:pre-wrap;cursor:pointer';
  d.textContent = '点击任意处关闭\n\n' + out.join('\n');
  d.onclick = function () { d.parentNode.removeChild(d); };
  document.body.appendChild(d);
}

/* 全局热键：Ctrl+Alt+D 打开自检 */
document.addEventListener('keydown', function (e) {
  if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    biliSelfCheck();
  }
});
/* ==========================================================================
   搜索页常驻播放条
   --------------------------------------------------------------------------
   自检发现：打开搜索页时 bottom-bar 的 class 是 "visible soft-hidden"，
   soft-hidden 把 opacity 设成 0，所以看不见。

   光靠 CSS 覆盖不够（Mineradio 的 JS 会重新加回 soft-hidden），
   所以这里直接操作 class：去掉 soft-hidden / controls-hidden。
   ========================================================================== */
function forceShowBottomBar() {
  var bar = document.getElementById('bottom-bar');
  if (!bar) return false;
  bar.classList.remove('soft-hidden', 'controls-hidden');
  bar.classList.add('visible');

  // 同时告诉 Mineradio 自己的状态机：不要隐藏
  try {
    if (typeof setControlsHidden === 'function') setControlsHidden(false);
  } catch (e) { /* 忽略 */ }
  return true;
}

/* 持续保持（Mineradio 可能在某些时机又加回 soft-hidden） */
var _bottomBarGuard = null;
function startBottomBarGuard() {
  stopBottomBarGuard();
  forceShowBottomBar();
  _bottomBarGuard = setInterval(forceShowBottomBar, CFG.BAR_GUARD_INTERVAL);
}
function stopBottomBarGuard() {
  if (_bottomBarGuard) {
    clearInterval(_bottomBarGuard);
    _bottomBarGuard = null;
  }
}
/* ==========================================================================
   自定义确认框
   --------------------------------------------------------------------------
   Electron 里原生 confirm() 会阻塞整个渲染进程 ——
   表现就是弹框弹出时播放器卡住、粒子动画停住。
   所以所有确认都要用这个异步版本。
   ========================================================================== */
function askConfirm(title, message, okText) {
  return new Promise(function (resolve) {
    var old = document.getElementById('bili-confirm');
    if (old) old.parentNode.removeChild(old);

    var d = document.createElement('div');
    d.id = 'bili-confirm';
    d.className = 'bili-confirm-mask';
    d.innerHTML =
      '<div class="bili-confirm-card">' +
        '<div class="bili-confirm-title">' + biliEsc(title) + '</div>' +
        '<div class="bili-confirm-msg">' + biliEsc(message) + '</div>' +
        '<div class="bili-confirm-actions">' +
          '<button type="button" class="bili-confirm-btn ghost" data-act="cancel">取消</button>' +
          '<button type="button" class="bili-confirm-btn danger" data-act="ok">' + biliEsc(okText || '确定') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);

    function done(v) {
      if (d.parentNode) d.parentNode.removeChild(d);
      resolve(v);
    }
    d.querySelector('[data-act="cancel"]').onclick = function () { done(false); };
    d.querySelector('[data-act="ok"]').onclick = function () { done(true); };
    d.addEventListener('click', function (e) { if (e.target === d) done(false); });

    // ESC 关闭（捕获阶段，别让它关掉上层页面）
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        document.removeEventListener('keydown', onKey, true);
        done(false);
      }
    }
    document.addEventListener('keydown', onKey, true);
  });
}

/* 打开一行的「加入歌单」小菜单 */
function showAddToPlaylistMenu(anchorEl, song) {
  var old = document.getElementById('bili-add-menu');
  if (old) old.parentNode.removeChild(old);

  var d = document.createElement('div');
  d.id = 'bili-add-menu';
  d.className = 'bili-add-menu';

  var r = anchorEl.getBoundingClientRect();
  d.style.left = Math.max(8, Math.min(r.left - 140, window.innerWidth - 230)) + 'px';
  d.style.top = Math.min(r.bottom + 6, window.innerHeight - 260) + 'px';

  var html = '<div class="bam-head">加入歌单</div><div class="bam-list">';
  if (!LOCAL_PLAYLISTS || !LOCAL_PLAYLISTS.length) {
    html += '<div class="bam-empty">还没有歌单</div>';
  } else {
    for (var i = 0; i < LOCAL_PLAYLISTS.length; i++) {
      var p = LOCAL_PLAYLISTS[i];
      html += '<button type="button" data-bam-id="' + biliEsc(p.id) + '">' +
          '<span>' + biliEsc(p.name) + '</span>' +
          '<small>' + (p.count || 0) + ' 首</small>' +
        '</button>';
    }
  }
  html += '</div>';
  html += '<button type="button" class="bam-new" data-bam-new="1">＋ 新建歌单并加入</button>';
  d.innerHTML = html;
  document.body.appendChild(d);

  d.addEventListener('click', function (e) {
    var t = e.target.closest('[data-bam-id]');
    if (t) {
      addSongToLocalPlaylist(t.getAttribute('data-bam-id'), song);
      d.parentNode.removeChild(d);
      return;
    }
    if (e.target.closest('[data-bam-new]')) {
      d.parentNode.removeChild(d);
      askPlaylistName(song.name || '新歌单', 1).then(function (name) {
        if (!name) return;
        fetch('/api/local-pl/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, songs: [normalizeSongForPlaylist(song)] }),
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.id) {
            if (typeof showToast === 'function') showToast('已创建并加入「' + res.name + '」');
            if (typeof loadLocalPlaylists === 'function') loadLocalPlaylists();
          }
        });
      });
    }
  });

  setTimeout(function () {
    document.addEventListener('click', function close() {
      var m = document.getElementById('bili-add-menu');
      if (m) m.parentNode.removeChild(m);
      document.removeEventListener('click', close);
    }, { once: true });
  }, 10);
}

function normalizeSongForPlaylist(song) {
  song = song || {};
  /* 关键：只能把真正的 B站 bvid 存进 bvid 字段。
     精确搜索出来的是曲库曲目（QQ 音乐的 mid），像 0027oMO61wWi55_0 这种
     不是 B站 bvid，存进去播放时会「当前没有可用音源」。
     这种情况 bvid 留空，播放时后台按歌名+歌手+时长重新找音源。 */
  var realBvid = /^BV[0-9A-Za-z]{10}$/.test(String(song.bvid || '')) ? song.bvid : '';
  return {
    bvid: realBvid,
    cid: realBvid ? (song.cid || 0) : 0,
    mid: song.mid || '',            // 曲库 mid，找音源时能加速
    name: song.name || song.title || '',
    artist: song.artist || '',
    album: song.album || '',
    cover: song.cover || song.picUrl || '',
    duration: song.duration || 0,
    duration_s: song.duration_s || Math.round((song.duration || 0) / 1000),
  };
}

function addSongToLocalPlaylist(playlistId, song) {
  fetch('/api/local-pl/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: playlistId, songs: [normalizeSongForPlaylist(song)] }),
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast('已加入歌单（共 ' + res.count + ' 首）');
        if (typeof loadLocalPlaylists === 'function') loadLocalPlaylists();
      } else {
        if (typeof showToast === 'function') showToast('加入失败');
      }
    })
    .catch(function () {
      if (typeof showToast === 'function') showToast('加入失败');
    });
}
