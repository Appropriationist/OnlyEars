/* ==========================================================================
   搜索 UI · 整页搜索
   --------------------------------------------------------------------------
   按回车 / 点放大镜进入的全屏结果页：
     · 30 条结果（精确模式）或分页（模糊模式）
     · 顶部有返回、输入框、精确/模糊切换
     · 底部播放条常驻（由 98e 的 guard 维持）
   ========================================================================== */

function openSearchPage(q) {
  var page = document.getElementById('search-page');
  if (!page) return;
  SEARCH_UI.pageOpen = true;
  page.classList.add('show');
  page.setAttribute('aria-hidden', 'false');
  document.body.classList.add('search-page-open');

  /* 播放条常驻：直接去 class 并持续保持 */
  startBottomBarGuard();

  var inp = document.getElementById('search-page-input');
  if (inp) {
    inp.value = q || SEARCH_UI.lastQuery || '';
    setTimeout(function () {
      try { inp.focus(); } catch (e) {}
    }, CFG.MODAL_FOCUS_DELAY);
  }

  var query = q || SEARCH_UI.lastQuery;
  if (query) runSearchUi(query, { forPage: true, page: 1 });

  var box = document.getElementById('search-results');
  if (box) box.classList.remove('show');
}

function closeSearchPage() {
  var page = document.getElementById('search-page');
  if (!page) return;
  SEARCH_UI.pageOpen = false;
  page.classList.remove('show');
  page.setAttribute('aria-hidden', 'true');
  stopBottomBarGuard();

  var sp = document.getElementById('source-page');
  var spOpen = !!(sp && sp.classList.contains('show'));
  if (!spOpen) document.body.classList.remove('search-page-open');
}

function renderSearchPageList(q, songs) {
  var list = document.getElementById('search-page-list');
  var status = document.getElementById('search-page-status');
  if (!list) return;

  if (status) {
    status.textContent = songs.length ? ('「' + q + '」 · ' + songs.length + ' 个结果') : '';
  }

  if (!songs.length) {
    list.innerHTML = '<div class="search-empty">没有找到相关歌曲</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < songs.length; i++) html += searchPageRowHtml(songs[i], i);
  list.innerHTML = html;

  var rows = list.querySelectorAll('[data-page-idx]');
  for (var k = 0; k < rows.length; k++) {
    (function (el) {
      el.addEventListener('click', function () {
        var idx = parseInt(el.getAttribute('data-page-idx'), 10);
        var s = songs[idx];
        if (s) playFromSearch(s, false);
      });
    })(rows[k]);
  }
}

function searchPageRowHtml(s, i) {
  var cover = s.cover || s.picUrl || '';
  var img = cover
    ? '<img src="' + biliEsc(cover) + '" alt="" loading="lazy" onerror="this.style.opacity=.2">'
    : '<div class="sd-ph"></div>';
  var sub = [];
  if (s.artist) sub.push(s.artist);
  if (s.album) sub.push(s.album);
  if (s.duration_s) sub.push(biliFmtTime(s.duration_s));

  var extra = '';
  if (s.playText) extra = '<span class="spr-play">' + biliEsc(s.playText) + '</span>';

  var partsBtn = '';
  if (SEARCH_UI.mode === 'fuzzy' && s.bvid) {
    partsBtn = '<button class="spr-parts-btn" type="button" title="查看分P / 合集" ' +
               'onclick="event.stopPropagation();openPartsPanel(\'' + biliEsc(s.bvid) + '\')">分P</button>';
  }

  return '<div class="search-page-row" data-page-idx="' + i + '">' +
      img +
      '<div class="spr-info">' +
        '<div class="spr-title">' + biliEsc(s.name || '') +
          '<span class="tag-source bili">B站</span>' + extra + '</div>' +
        '<div class="spr-meta">' + biliEsc(sub.join(' · ')) + '</div>' +
      '</div>' +
      partsBtn +
      '<button class="dl-btn spr-dl" type="button" title="下载" ' +
        'data-dl-song="' + encodeURIComponent(JSON.stringify({bvid: s.bvid||"", cid: s.cid||0, name: s.name||"", artist: s.artist||"", duration: s.duration||0})) + '"' +
        ' onclick="event.stopPropagation()">' +
        '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>' +
      '</button>' +
      '<button class="sd-btn spr-add" type="button" title="加入歌单" ' +
        'onclick="event.stopPropagation();showAddToPlaylistMenu(this, ' +
          'SEARCH_UI.lastResults[' + i + '])">' +
        '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
      '</button>' +
      '<button class="spr-play-btn" type="button" title="播放">' +
        '<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
      '</button>' +
    '</div>';
}

/* ---------------------------------------------------------------- 分页 */
function renderSearchPager() {
  var list = document.getElementById('search-page-list');
  if (!list) return;

  var old = document.getElementById('search-page-pager');
  if (old) old.parentNode.removeChild(old);
  if (SEARCH_UI.mode !== 'fuzzy') return;

  var cur = SEARCH_UI.page;
  var hasMore = SEARCH_UI.hasMore;

  var html = '<div id="search-page-pager">';
  html += '<button class="spg-btn" ' + (cur <= 1 ? 'disabled' : '') +
          ' onclick="gotoSearchPage(' + (cur - 1) + ')">上一页</button>';

  var from = Math.max(1, cur - 2);
  var to = Math.max(from, cur + 2);
  for (var p = from; p <= to; p++) {
    if (p > cur && !hasMore && p === cur + 1) break;
    html += '<button class="spg-btn' + (p === cur ? ' on' : '') +
            '" onclick="gotoSearchPage(' + p + ')">' + p + '</button>';
  }

  html += '<button class="spg-btn" ' + (!hasMore ? 'disabled' : '') +
          ' onclick="gotoSearchPage(' + (cur + 1) + ')">下一页</button>';
  html += '<span class="spg-info">第 ' + cur + ' 页</span>';
  html += '</div>';

  list.insertAdjacentHTML('beforeend', html);
}

function gotoSearchPage(p) {
  if (p < 1) return;
  runSearchUi(SEARCH_UI.lastQuery, { forPage: true, page: p });
  var body = document.getElementById('search-page-body');
  if (body) body.scrollTop = 0;
}

/* ---------------------------------------------------------------- 播放 */
/**
 * 点搜索结果。
 *   fromDropdown = true  → 下拉框（随手搜）→ 直接播
 *   fromDropdown = false → 整页（专门找）→ 精确模式进找音源页
 * 模糊模式两者都直接播（B站视频本身就是音源）。
 */
/**
 * 点搜索结果。这是两套不同的意图：
 *
 *   下拉框（边打字边搜，随手点）→ **直接播**
 *       用户只是想听听这首歌，不想挑音源。
 *
 *   整页搜索（按回车 / 点放大镜，专门找）→ **进找音源页**
 *       用户是特地来找这首歌的，给 N 个候选让他挑最好的。
 *
 * 在找音源页里选完候选 → 播放，但**不关闭找音源页**（可继续试听别的）。
 */
