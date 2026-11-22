/* ==========================================================================
   搜索 UI · 核心
   --------------------------------------------------------------------------
   包含：状态对象、工具函数、模式切换（精确/模糊）、搜索入口 runSearchUi

   依赖关系：
     本文件被其他 98x 文件依赖（它们用 SEARCH_UI / biliEsc / biliApiJson）
     本文件不依赖其他 98x 文件
   ========================================================================== */

var SEARCH_UI = {
  mode: 'precise',
  lastQuery: '',
  lastResults: [],
  dropLimit: 6,
  pageOpen: false,
  busy: false,
  page: 1,
  hasMore: false,
};

var SRC_PAGE = {
  song: null,
  candidates: [],
  autoPlayTimer: null,
  requestId: 0,
  fromSearchPage: false,
};

/* ---------------------------------------------------------------- 工具 */
function biliEsc(s) {
  if (typeof escHtml === 'function') return escHtml(String(s == null ? '' : s));
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function biliApiJson(url, opts) {
  if (typeof apiJson === 'function') return apiJson(url, opts);
  return fetch(url, { signal: (opts && opts.signal) }).then(function (r) { return r.json(); });
}

function biliFmtTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  var m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

/* ---------------------------------------------------------------- 模式 */
function setSearchUiMode(mode) {
  SEARCH_UI.mode = (mode === 'fuzzy') ? 'fuzzy' : 'precise';
  var label = document.getElementById('sms-label');
  if (label) label.textContent = SEARCH_UI.mode === 'fuzzy' ? '模糊' : '精确';

  var items = document.querySelectorAll('#sms-menu .sms-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle('on', items[i].getAttribute('data-smode') === SEARCH_UI.mode);
  }
  var items2 = document.querySelectorAll('#search-page-mode .spm-item');
  for (var j = 0; j < items2.length; j++) {
    items2[j].classList.toggle('on', items2[j].getAttribute('data-smode') === SEARCH_UI.mode);
  }

  var ph = SEARCH_UI.mode === 'fuzzy'
    ? '搜索 B 站视频（歌名、UP 主、关键词）...'
    : '搜索歌曲、歌手...';
  var i1 = document.getElementById('search-input');
  var i2 = document.getElementById('search-page-input');
  if (i1) i1.placeholder = ph;
  if (i2) i2.placeholder = ph;
}

function toggleSearchModeSelect(e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var wrap = document.getElementById('search-mode-select');
  if (!wrap) return;
  var open = wrap.classList.toggle('open');
  wrap.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function pickSearchMode(mode) {
  setSearchUiMode(mode);
  var wrap = document.getElementById('search-mode-select');
  if (wrap) {
    wrap.classList.remove('open');
    wrap.setAttribute('aria-expanded', 'false');
  }
  var inp = document.getElementById('search-input');
  var q = inp ? inp.value.trim() : '';
  if (q) runSearchUi(q, { forDropdown: true });
}

function pickSearchModeFromPage(mode) {
  setSearchUiMode(mode);
  var inp = document.getElementById('search-page-input');
  var q = inp ? inp.value.trim() : SEARCH_UI.lastQuery;
  if (q) runSearchUi(q, { forPage: true, page: 1 });
}


/* ==========================================================================
   搜索主入口
   ========================================================================== */

async function runSearchUi(q, opts) {
  opts = opts || {};
  q = String(q || '').trim();
  if (!q) return;

  if (opts.page) SEARCH_UI.page = Math.max(1, opts.page);
  else if (q !== SEARCH_UI.lastQuery) SEARCH_UI.page = 1;

  SEARCH_UI.lastQuery = q;
  SEARCH_UI.busy = true;

  var url;
  if (SEARCH_UI.mode === 'fuzzy') {
    url = '/api/bili/raw?keywords=' + encodeURIComponent(q) + '&page=' + SEARCH_UI.page;
  } else {
    var offset = (SEARCH_UI.page - 1) * 30;
    url = '/api/bili/search?keywords=' + encodeURIComponent(q) + '&limit=30&offset=' + offset;
  }

  try {
    var r = await biliApiJson(url, { timeoutMs: CFG.SEARCH_TIMEOUT });
    var songs = (r && r.songs && r.songs.length !== undefined) ? r.songs : [];
    SEARCH_UI.lastResults = songs;
    SEARCH_UI.hasMore = !!(r && r.hasMore);
    SEARCH_UI.busy = false;

    if (opts.forDropdown) {
      renderSearchDropdown(q, songs);
    } else if (opts.forPage) {
      renderSearchPageList(q, songs);
      renderSearchPager();
    } else {
      renderSearchDropdown(q, songs);
      if (SEARCH_UI.pageOpen) {
        renderSearchPageList(q, songs);
        renderSearchPager();
      }
    }
  } catch (err) {
    SEARCH_UI.busy = false;
    console.warn('[search]', err);
    var msg = '搜索失败，请稍后重试';
    if (opts.forDropdown) {
      var box = document.getElementById('search-results');
      if (box) {
        box.innerHTML = '<div class="search-empty">' + biliEsc(msg) + '</div>';
        box.classList.add('show');
      }
    } else {
      var st = document.getElementById('search-page-status');
      if (st) st.textContent = msg;
    }
  }
}

/* ---------------------------------------------------------------- 下拉 */
