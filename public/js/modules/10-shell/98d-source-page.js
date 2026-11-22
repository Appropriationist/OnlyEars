/* ==========================================================================
   搜索 UI · 播放 + 找音源页 + 分P 面板
   --------------------------------------------------------------------------
   playFromSearch  点击搜索结果的分流（下拉直接播 / 整页进找音源）
   makeBiliItem    构造播放项
   pushAndPlay     入队并播放
   openSourcePage  找音源页（N 个 B站候选，带评分）
   openPartsPanel  分P / 合集面板
   queueAllParts   整单加入队列
   createPlaylistFromParts  整单创建歌单
   ========================================================================== */

function playFromSearch(song, fromDropdown) {
  if (!song) return;

  var box = document.getElementById('search-results');
  if (box) box.classList.remove('show');

  // 下拉框：直接播
  if (fromDropdown) {
    // 模糊搜索有 bvid（视频本身就是音源）；精确搜索让后台自动找
    pushAndPlay(makeBiliItem(song, SEARCH_UI.mode === 'fuzzy' ? (song.bvid || '') : '', song.cid || 0));
    return;
  }

  // 整页：模糊搜索直接播，精确搜索进找音源页
  if (SEARCH_UI.mode === 'fuzzy') {
    pushAndPlay(makeBiliItem(song, song.bvid || '', song.cid || 0));
    return;
  }
  openSourcePage(song);
}

function makeBiliItem(song, bvid, cid) {
  return {
    provider: 'bili',
    source: 'bili',
    type: 'song',
    id: bvid || song.id || song.mid || '',
    bvid: bvid || '',
    cid: cid || 0,
    name: song.name || song.title || '',
    artist: song.artist || '',
    album: song.album || '',
    cover: song.cover || song.picUrl || '',
    duration: song.duration || 0,
    duration_s: song.duration_s || 0,
    mid: song.mid || '',
  };
}

function pushAndPlay(item) {
  try {
    if (typeof playQueue !== 'undefined' && typeof playQueueAt === 'function') {
      playQueue.unshift(item);
      currentIdx = 0;
      playQueueAt(0);
      showNowPlayingHint(item);
      return;
    }
  } catch (e) { /* 继续尝试下一个 */ }
  try {
    if (typeof playSong === 'function') {
      playSong(item);
      showNowPlayingHint(item);
    }
  } catch (e) { console.warn('[pushAndPlay]', e); }
}

/**
 * 停在搜索页时，顶部浮一条「正在播放」提示。
 * 因为整页搜索盖住了播放栏，用户点了歌什么都看不到，会以为没反应。
 * 3 秒后淡出。
 */
var _nowHintTimer = null;
function showNowPlayingHint(item) {
  var host = document.getElementById('bili-now-hint');
  if (!host) {
    host = document.createElement('div');
    host.id = 'bili-now-hint';
    document.body.appendChild(host);
  }
  var name = (item && item.name) || '';
  var artist = (item && item.artist) || '';
  host.innerHTML =
    '<svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24">' +
      '<path d="M8 5v14l11-7z"/></svg>' +
    '<span class="bnh-text">正在播放：' + biliEsc(name) +
      (artist ? '<em>' + biliEsc(artist) + '</em>' : '') + '</span>';

  host.classList.add('show');
  clearTimeout(_nowHintTimer);
  _nowHintTimer = setTimeout(function () {
    host.classList.remove('show');
  }, CFG.HINT_DURATION);
}

/* ==========================================================================
   找音源页
   ========================================================================== */
async function openSourcePage(song) {
  if (!song) return;

  SRC_PAGE.song = song;
  SRC_PAGE.candidates = [];
  SRC_PAGE.fromSearchPage = SEARCH_UI.pageOpen;
  var reqId = ++SRC_PAGE.requestId;

  var page = document.getElementById('source-page');
  if (!page) return;

  page.classList.add('show');
  page.setAttribute('aria-hidden', 'false');
  document.body.classList.add('search-page-open');

  startBottomBarGuard();

  var cover = song.cover || song.picUrl || '';
  var title = song.name || song.title || '';
  var artist = song.artist || '';
  var durS = Math.round((song.duration || 0) / 1000) || song.duration_s || 0;

  var head = document.getElementById('source-page-head');
  if (head) {
    head.innerHTML =
      '<button id="source-page-back" type="button" onclick="closeSourcePage()" title="返回">' +
        '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M15 18l-6-6 6-6"/></svg>' +
      '</button>' +
      (cover
        ? '<img class="sp-head-cover" src="' + biliEsc(cover) + '" alt="" onerror="this.style.display=\'none\'">'
        : '<div class="sp-head-cover"></div>') +
      '<div class="sp-head-info">' +
        '<div class="sp-head-title">' + biliEsc(title) + '</div>' +
        '<div class="sp-head-meta">' + biliEsc(artist) +
          (durS ? ' · ' + biliFmtTime(durS) : '') + '</div>' +
      '</div>' +
      '<button class="sp-head-tool" type="button" onclick="refindSources()" title="重新搜索音源">' +
        '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>' +
      '</button>' +
      '<button class="sp-head-tool" type="button" onclick="goHomeFromSourcePage()" title="回到播放界面">' +
        '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M3 10.8 12 3l9 7.8"/><path d="M5 10v10h14V10"/><path d="M9.5 20v-5h5v5"/></svg>' +
      '</button>';
  }

  var status = document.getElementById('source-page-status');
  if (status) status.textContent = '正在从 B 站搜索音源…';

  var list = document.getElementById('source-page-list');
  if (list) list.innerHTML = '';

  try {
    var url = '/api/bili/source?title=' + encodeURIComponent(title) +
              '&artist=' + encodeURIComponent(artist) +
              '&duration=' + encodeURIComponent(String(durS)) +
              '&mode=balanced';
    var r = await biliApiJson(url, { timeoutMs: CFG.SOURCE_TIMEOUT });
    if (reqId !== SRC_PAGE.requestId) return;

    var cands = (r && r.candidates) ? r.candidates : [];
    SRC_PAGE.candidates = cands;

    if (status) {
      status.textContent = cands.length
        ? (cands.length + ' 个音源候选，按匹配度排序 · 用时 ' + (r.elapsed || 0) + 'ms')
        : '没有找到音源';
    }
    renderSourceList(cands);

    if (cands.length) {
      clearTimeout(SRC_PAGE.autoPlayTimer);
      SRC_PAGE.autoPlayTimer = setTimeout(function () {
        if (reqId === SRC_PAGE.requestId) playSourceCandidate(0, true);
      }, CFG.AUTOPLAY_DELAY);
    }
  } catch (e) {
    if (status) status.textContent = '搜索失败：' + (e && e.message ? e.message : '');
  }
}

function renderSourceList(cands) {
  var list = document.getElementById('source-page-list');
  if (!list) return;

  if (!cands.length) {
    list.innerHTML = '<div class="search-empty">没有找到可用的 B 站音源</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    var cover = c.cover || '';
    var img = cover
      ? '<img src="' + biliEsc(cover) + '" alt="" loading="lazy" onerror="this.style.opacity=.2">'
      : '<div class="sd-ph"></div>';

    var durTxt = c.duration_s ? biliFmtTime(c.duration_s) : '';
    var delta = '';
    if (c.delta !== null && c.delta !== undefined) {
      delta = '<span class="spc-delta">Δ' + (c.delta > 0 ? '+' : '') + c.delta + 's</span>';
    }

    var sc = Number(c.score) || 0;
    var scoreCls = sc >= 60 ? 'high' : (sc >= 30 ? 'mid' : 'low');

    var whyHtml = '';
    var why = c.why || [];
    for (var w = 0; w < why.length && w < 4; w++) {
      var t = why[w];
      var cls = 'n';
      if (/精确|接近|MV区|白名单|官方/.test(t)) cls = 'good';
      else if (/黑名单|偏离|非单曲|无关|超长/.test(t)) cls = 'bad';
      whyHtml += '<span class="spc-why ' + cls + '">' + biliEsc(t) + '</span>';
    }

    html += '<div class="source-cand" data-cand-idx="' + i + '">' +
        img +
        '<div class="spc-info">' +
          '<div class="spc-title">' + biliEsc(c.title || '') + '</div>' +
          '<div class="spc-meta">' +
            biliEsc(c.author || '') +
            (durTxt ? ' · ' + durTxt : '') +
            (c.playText ? ' · ' + biliEsc(c.playText) : '') +
            delta +
          '</div>' +
          '<div class="spc-whys">' + whyHtml + '</div>' +
        '</div>' +
        '<div class="spc-score ' + scoreCls + '">' + Math.round(sc) + '</div>' +
        '<button class="dl-btn spr-dl" type="button" title="下载这个音源" ' +
          'data-dl-song="' + encodeURIComponent(JSON.stringify({bvid: c.bvid||"", cid: 0, name: (SRC_PAGE.song && SRC_PAGE.song.name)||"", artist: (SRC_PAGE.song && SRC_PAGE.song.artist)||"", duration: 0})) + '"' +
          ' onclick="event.stopPropagation()">' +
          '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
            '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>' +
        '</button>' +
        '<button class="spc-play" type="button" title="播放这个音源">' +
          '<svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
        '</button>' +
      '</div>';
  }
  list.innerHTML = html;

  var rows = list.querySelectorAll('[data-cand-idx]');
  for (var k = 0; k < rows.length; k++) {
    (function (el) {
      el.addEventListener('click', function () {
        playSourceCandidate(parseInt(el.getAttribute('data-cand-idx'), 10), false);
      });
    })(rows[k]);
  }
}

function playSourceCandidate(idx, auto) {
  var c = SRC_PAGE.candidates[idx];
  var song = SRC_PAGE.song;
  if (!c || !song) return;

  clearTimeout(SRC_PAGE.autoPlayTimer);

  var rows = document.querySelectorAll('#source-page-list .source-cand');
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.toggle('cur', i === idx);
  }

  var item = makeBiliItem(song, c.bvid, 0);
  item.biliCandidates = SRC_PAGE.candidates;
  item.biliScore = c.score;
  item.biliWhy = c.why;
  if (c.duration) item.playbackDuration = c.duration;

  pushAndPlay(item);

  /* 播放后**不关闭找音源页** —— 用户可能想换一个候选再试试哪个音质好。
     之前这里 setTimeout(closeSourcePage, 300)，
     导致选完音源就跳回搜索结果，要再点一次歌。现在留在原地。 */
}

function refindSources() {
  if (SRC_PAGE.song) openSourcePage(SRC_PAGE.song);
}

function closeSourcePage() {
  clearTimeout(SRC_PAGE.autoPlayTimer);
  SRC_PAGE.requestId++;

  var page = document.getElementById('source-page');
  if (page) {
    page.classList.remove('show');
    page.setAttribute('aria-hidden', 'true');
  }
  stopBottomBarGuard();

  var sp = document.getElementById('search-page');
  var stillOpen = !!(sp && sp.classList.contains('show'));
  if (!stillOpen) document.body.classList.remove('search-page-open');
}

function goHomeFromSourcePage() {
  clearTimeout(SRC_PAGE.autoPlayTimer);
  SRC_PAGE.requestId++;
  stopBottomBarGuard();

  var a = document.getElementById('source-page');
  if (a) { a.classList.remove('show'); a.setAttribute('aria-hidden', 'true'); }
  var b = document.getElementById('search-page');
  if (b) { b.classList.remove('show'); b.setAttribute('aria-hidden', 'true'); }
  document.body.classList.remove('search-page-open');
  SEARCH_UI.pageOpen = false;

  try {
    if (typeof goHome === 'function') goHome();
  } catch (e) { /* 忽略 */ }
}

/* ==========================================================================
   分P 面板
   ========================================================================== */
async function openPartsPanel(bvid) {
  if (!bvid) return;

  var old = document.getElementById('parts-panel');
  if (old) old.parentNode.removeChild(old);

  var d = document.createElement('div');
  d.id = 'parts-panel';
  d.className = 'parts-panel';
  d.innerHTML = '<div class="pp-card">' +
      '<div class="pp-head"><b>加载中…</b></div>' +
      '<div class="pp-list"></div>' +
    '</div>';
  document.body.appendChild(d);

  d.addEventListener('click', function (e) {
    if (e.target === d) d.parentNode.removeChild(d);
  });

  try {
    var r = await biliApiJson('/api/bili/parts?bvid=' + encodeURIComponent(bvid), { timeoutMs: CFG.PARTS_TIMEOUT });
    var kind = r.kind || 'single';
    var items = r.items || [];

    var head = d.querySelector('.pp-head');
    var list = d.querySelector('.pp-list');

    if (kind === 'single' || items.length <= 1) {
      head.innerHTML = '<b>' + biliEsc(r.title || '这个视频') + '</b><small>没有分P，直接播放即可</small>';
      list.innerHTML = '';
      if (items.length === 1) {
        list.innerHTML = '<button class="pp-item" onclick="playPartItem(\'' +
          biliEsc(bvid) + '\',' + (items[0].cid || 0) + ',\'' +
          biliEsc(items[0].title || '').replace(/'/g, '&#39;') + '\',' +
          (items[0].duration || 0) + ')">▶ 播放：' + biliEsc(items[0].title || r.title || '') + '</button>';
      }
      return;
    }

    head.innerHTML = '<b>' + biliEsc(r.title || '') + '</b><small>' +
      items.length + ' 个' + (kind === 'season' ? '（合集）' : '（分P）') + '</small>';

    /* 整单操作：100 集挨个点太累。
       两个动作：
         · 创建一个真歌单（保存到本地，能命名、能随时调出来）
         · 或者只塞进当前播放队列（临时，关软件就没了） */
    var actions = document.createElement('div');
    actions.className = 'pp-actions';
    actions.innerHTML =
      '<button class="pp-action-btn" onclick="createPlaylistFromParts(\'' + biliEsc(bvid) + '\')">' +
        '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
        '创建歌单（' + items.length + ' 首）' +
      '</button>' +
      '<button class="pp-action-btn ghost" onclick="queueAllParts(\'' + biliEsc(bvid) + '\', true)">' +
        '直接开始播' +
      '</button>';
    var card = d.querySelector('.pp-card');
    if (card) card.insertBefore(actions, list);

    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var target = it.bvid || bvid;
      html += '<button class="pp-item" onclick="playPartItem(\'' +
        biliEsc(target) + '\',' + (it.cid || 0) + ',\'' +
        biliEsc(it.title || '').replace(/'/g, '&#39;') + '\',' +
        (it.duration || 0) + ')">' +
        '<span class="pp-idx">' + it.index + '</span>' +
        '<span class="pp-name">' + biliEsc(it.title || ('P' + it.index)) + '</span>' +
        (it.duration ? '<span class="pp-dur">' + biliFmtTime(it.duration) + '</span>' : '') +
        '</button>';
    }
    list.innerHTML = html;
  } catch (e) {
    var h = d.querySelector('.pp-head');
    if (h) h.innerHTML = '<b>加载失败</b><small>' + biliEsc(e && e.message ? e.message : '') + '</small>';
  }
}

function playPartItem(bvid, cid, title, duration) {
  var panel = document.getElementById('parts-panel');
  if (panel) panel.parentNode.removeChild(panel);

  var song = SRC_PAGE.song || {};
  var item = makeBiliItem(song, bvid, cid);
  item.name = title || item.name;
  if (duration) item.duration = duration * 1000;

  // 只关分P弹层，不关整页搜索（让用户能接着挑别的）
  pushAndPlay(item);
}

/* ---------------------------------------------------------------- 整单操作 */
/**
 * 把分P / 合集的所有条目一次性变成播放队列。
 * 100 集的合集挨个点太累，这个函数解决它。
 *
 * 队列项的 bvid/cid 都带上了，播放时不用再搜音源，直接取流。
 */
async function queueAllParts(bvid, autoplay) {
  var panel = document.getElementById('parts-panel');
  try {
    var r = await biliApiJson('/api/bili/parts?bvid=' + encodeURIComponent(bvid), { timeoutMs: 25000 });
    var items = r.items || [];
    if (!items.length) {
      if (typeof showToast === 'function') showToast('这个视频没有分P');
      return;
    }

    var song = SRC_PAGE.song || {};
    var baseName = song.name || r.title || '';

    // 构造队列项
    var queueItems = items.map(function (it) {
      var it2 = makeBiliItem({
        name: it.title || baseName,
        artist: song.artist || r.owner || '',
        album: song.album || '',
        cover: it.pic || song.cover || '',
        duration: (it.duration || 0) * 1000,
        duration_s: it.duration || 0,
      }, it.bvid || bvid, it.cid || 0);
      // 显示用：歌名取分P标题（去掉序号前缀）
      it2.name = String(it.title || ('P' + it.index)).replace(/^\d+[.、\s]+/, '');
      return it2;
    });

    if (typeof playQueue === 'undefined') {
      if (typeof showToast === 'function') showToast('播放队列不可用');
      return;
    }

    /* 入队策略：
         用 unshift 会把整个列表倒序，所以先把队列项反转再逐个 unshift。
         然后让第一首在队首。 */
    var reversed = queueItems.slice().reverse();
    for (var i = 0; i < reversed.length; i++) playQueue.unshift(reversed[i]);

    if (panel) panel.parentNode.removeChild(panel);
    closeSearchPage();

    if (autoplay) {
      currentIdx = 0;
      if (typeof playQueueAt === 'function') playQueueAt(0);
    } else {
      if (typeof renderQueue === 'function') { try { renderQueue(); } catch (e) {} }
      if (typeof showToast === 'function') {
        showToast('已加入 ' + queueItems.length + ' 首到播放队列');
      }
    }
  } catch (e) {
    console.warn('[queueAllParts]', e);
    if (typeof showToast === 'function') showToast('加载分P失败');
  }
}

function playAllParts(bvid) {
  queueAllParts(bvid, true);
}

/* ---------------------------------------------------------------- 创建歌单 */
/**
 * 把一个分P / 合集变成一个真歌单（存在本地 data/local-playlists.json）。
 *
 * 流程：取分P列表 → 弹一个输入框让用户命名 → 存本地 → 提示成功
 */
async function createPlaylistFromParts(bvid) {
  var panel = document.getElementById('parts-panel');
  try {
    var r = await biliApiJson('/api/bili/parts?bvid=' + encodeURIComponent(bvid), { timeoutMs: 25000 });
    var items = r.items || [];
    if (!items.length) {
      if (typeof showToast === 'function') showToast('这个视频没有分P');
      return;
    }

    var song = SRC_PAGE.song || {};
    var defaultName = (r.title || song.name || '新建歌单').slice(0, 40);

    // 命名对话框
    var name = await askPlaylistName(defaultName, items.length);
    if (name === null) return;   // 用户取消

    // 组装歌曲
    var songs = items.map(function (it) {
      return {
        bvid: it.bvid || bvid,
        cid: it.cid || 0,
        name: String(it.title || ('P' + it.index)).replace(/^\d+[.、\s]+/, ''),
        artist: song.artist || r.owner || '',
        album: '',
        cover: it.pic || song.cover || '',
        duration: (it.duration || 0) * 1000,
        duration_s: it.duration || 0,
      };
    });

    var res = await fetch('/api/local-pl/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, songs: songs }),
    }).then(function (x) { return x.json(); });

    if (panel) panel.parentNode.removeChild(panel);

    if (res && res.id) {
      if (typeof showToast === 'function') {
        showToast('已创建歌单「' + res.name + '」，共 ' + songs.length + ' 首');
      }
      // 通知其他地方刷新歌单列表（如果有监听）
      try {
        window.dispatchEvent(new CustomEvent('bili:playlist-created', { detail: res }));
      } catch (e) {}
    } else {
      if (typeof showToast === 'function') showToast('创建失败：' + (res && res.error || '未知错误'));
    }
  } catch (e) {
    console.warn('[createPlaylistFromParts]', e);
    if (typeof showToast === 'function') showToast('创建歌单失败');
  }
}

/**
 * 弹一个小的命名对话框。返回 Promise<string|null>。
 * 用自有 DOM，不用 window.prompt（Electron 里 prompt 被禁用了）。
 */
