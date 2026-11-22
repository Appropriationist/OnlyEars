/* ==========================================================================
   意见反馈面板
   --------------------------------------------------------------------------
   首页「意见反馈」卡片点开的弹窗。

   内容：
     · QQ 群号（大号显示，一键复制）
     · 反馈什么（引导用户说清楚问题）
     · 常见问题（减少重复提问）
     · 软件版本信息（方便定位）
   ========================================================================== */

var FEEDBACK_QQ_GROUP = '418363567';

function ensureFeedbackPanel() {
  var old = document.getElementById('fb-panel');
  if (old) return old;

  var d = document.createElement('div');
  d.id = 'fb-panel';
  d.className = 'fb-mask';
  d.innerHTML =
    '<div class="fb-card">' +
      '<div class="fb-head">' +
        '<div class="fb-title">意见反馈</div>' +
        '<button type="button" class="fb-close" data-fb-close="1" title="关闭">×</button>' +
      '</div>' +

      '<div class="fb-body">' +
        /* QQ 群号 */
        '<div class="fb-group">' +
          '<div class="fb-group-label">QQ 群</div>' +
          '<div class="fb-group-row">' +
            '<span class="fb-group-num" id="fb-group-num">' + FEEDBACK_QQ_GROUP + '</span>' +
            '<button type="button" class="fb-copy-btn" onclick="copyFeedbackGroup()">' +
              '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
                '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
                '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
              '</svg>' +
              '复制群号' +
            '</button>' +
          '</div>' +
          '<div class="fb-group-hint">加群后在群里说遇到的问题，回复会比邮件快</div>' +
        '</div>' +

        /* 反馈什么 */
        '<div class="fb-section">' +
          '<div class="fb-section-title">说什么比较有用</div>' +
          '<ul class="fb-list">' +
            '<li><b>播放问题</b>：哪首歌、点了没反应、还是报错</li>' +
            '<li><b>搜索结果不对</b>：搜什么词、出现了什么</li>' +
            '<li><b>界面问题</b>：哪里错位、哪个按钮点不到</li>' +
            '<li><b>想要的功能</b>：缺什么，什么用起来别扭</li>' +
          '</ul>' +
          '<div class="fb-tip">带上截图会快很多</div>' +
        '</div>' +

        /* 常见问题 */
        '<div class="fb-section">' +
          '<div class="fb-section-title">先看看这些（可能已经有了）</div>' +
          '<ul class="fb-list fb-faq">' +
            '<li><b>搜不到歌</b> → 换成「模糊」模式再搜，或者只搜歌名</li>' +
            '<li><b>播放报错</b> → B站 那个视频可能被删了，去「找音源」换一个</li>' +
            '<li><b>启动页卡住</b> → 点一下屏幕就进去了</li>' +
            '<li><b>界面很卡</b> → 设置里开「极简模式」</li>' +
            '<li><b>下载的文件在哪</b> → 首页「下载设置」里能看到路径</li>' +
          '</ul>' +
        '</div>' +

        /* 版本信息 */
        '<div class="fb-meta" id="fb-meta">OnlyEars · 基于 Mineradio 创作</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(d);

  d.addEventListener('click', function (e) {
    if (e.target === d || e.target.closest('[data-fb-close]')) closeFeedbackPanel();
  });

  return d;
}

function openFeedbackPanel() {
  var d = ensureFeedbackPanel();
  d.classList.add('show');

  // 填入版本信息
  var meta = document.getElementById('fb-meta');
  if (meta) {
    var ua = navigator.userAgent || '';
    var chrome = (ua.match(/Chrome\/(\d+)/) || [])[1] || '';
    meta.textContent = 'OnlyEars · 基于 Mineradio 创作' +
      (chrome ? ' · Electron ' + chrome : '');
  }
}

function closeFeedbackPanel() {
  var d = document.getElementById('fb-panel');
  if (d) d.classList.remove('show');
}

/** 复制群号 */
function copyFeedbackGroup() {
  var text = FEEDBACK_QQ_GROUP;

  // 优先用 Clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      showToastSafe('群号已复制：' + text);
      markCopied();
    }).catch(function () {
      fallbackCopy(text);
    });
    return;
  }

  fallbackCopy(text);
}

function fallbackCopy(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToastSafe('群号已复制：' + text);
    markCopied();
  } catch (e) {
    showToastSafe('复制失败，请手动记下：' + text);
  }
}

function markCopied() {
  var btn = document.querySelector('.fb-copy-btn');
  if (!btn) return;
  btn.classList.add('copied');
  var orig = btn.innerHTML;
  btn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">' +
    '<path d="M20 6L9 17l-5-5"/></svg>已复制';
  setTimeout(function () {
    btn.classList.remove('copied');
    btn.innerHTML = orig;
  }, 2200);
}
