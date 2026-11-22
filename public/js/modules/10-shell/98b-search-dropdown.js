/* ==========================================================================
   搜索 UI · 下拉结果框
   --------------------------------------------------------------------------
   边打字边搜时的下拉列表：
     · 最多渲染 20 条，可视 6 行（CSS 控制 max-height）
     · 最后一行固定「使用模糊搜索查看更多」
   ========================================================================== */

function renderSearchDropdown(q, songs) {
  var box = document.getElementById('search-results');
  if (!box) return;

  if (!songs.length) {
    box.innerHTML = '<div class="search-empty">没有找到相关歌曲</div>';
    box.classList.add('show');
    return;
  }

  var shown = songs.slice(0, 20);
  var html = '';
  for (var i = 0; i < shown.length; i++) html += searchDropRowHtml(shown[i], i);

  var moreLabel = SEARCH_UI.mode === 'fuzzy'
    ? '在整页中查看全部结果'
    : '使用模糊搜索查看更多';
  html += '<button type="button" class="search-more-row" onclick="dropdownMoreAction()">' +
            '<span>' + biliEsc(moreLabel) + '</span>' +
            '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
              '<path d="M9 18l6-6-6-6"/></svg>' +
          '</button>';

  box.innerHTML = html;
  box.classList.add('show');

  var rows = box.querySelectorAll('[data-drop-idx]');
  for (var k = 0; k < rows.length; k++) {
    (function (el) {
      el.addEventListener('click', function () {
        var idx = parseInt(el.getAttribute('data-drop-idx'), 10);
        var s = shown[idx];
        if (s) playFromSearch(s, true);
      });
    })(rows[k]);
  }
}

function searchDropRowHtml(s, i) {
  var cover = s.cover || s.picUrl || '';
  var img = cover
    ? '<img src="' + biliEsc(cover) + '" alt="" loading="lazy" onerror="this.style.opacity=.2">'
    : '<div class="sd-ph"></div>';
  var sub = [];
  if (s.artist) sub.push(s.artist);
  if (s.album) sub.push(s.album);
  if (s.duration_s) sub.push(biliFmtTime(s.duration_s));

  return '<div class="search-drop-row" data-drop-idx="' + i + '">' +
      img +
      '<div class="sd-info">' +
        '<div class="sd-title">' + biliEsc(s.name || '') +
          '<span class="tag-source bili">B站</span></div>' +
        '<div class="sd-meta">' + biliEsc(sub.join(' · ')) + '</div>' +
      '</div>' +
      /* 行尾三个按钮：下载、加入歌单、播放 */
      '<button class="sd-btn" type="button" title="下载" ' +
        'data-dl-song="' + encodeURIComponent(JSON.stringify({bvid: s.bvid||"", cid: s.cid||0, name: s.name||"", artist: s.artist||"", duration: s.duration||0})) + '"' +
        ' onclick="event.stopPropagation()">' +
        '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>' +
      '</button>' +
      '<button class="sd-btn" type="button" title="加入歌单" ' +
        'onclick="event.stopPropagation();showAddToPlaylistMenu(this, ' +
          'SEARCH_UI.lastResults[' + i + '])">' +
        '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
      '</button>' +
      '<button class="sd-play" type="button" title="播放">' +
        '<svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24">' +
          '<path d="M8 5v14l11-7z"/></svg>' +
      '</button>' +
    '</div>';
}

function dropdownMoreAction() {
  if (SEARCH_UI.mode === 'precise') {
    setSearchUiMode('fuzzy');
    runSearchUi(SEARCH_UI.lastQuery, { forDropdown: true });
  } else {
    openSearchPage(SEARCH_UI.lastQuery);
  }
}

/* ---------------------------------------------------------------- 整页 */
