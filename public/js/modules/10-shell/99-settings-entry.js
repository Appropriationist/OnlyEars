/* ==========================================================================
   设置入口
   --------------------------------------------------------------------------
   原来右上角是「登录账号」按钮（网易云/QQ/酷狗/汽水的账号体系）。
   我们用 B站 音源，不需要登录，把它改成「设置」。

   设置面板 = Mineradio 原有的视觉控制台 #fx-panel。
   它原本只能通过右下角 fx-fab 打开，而且必须先开「DIY 玩家模式」。
   这里直接调，不要求 DIY 模式。

   点击空白处自动关闭（用户要求）。
   ========================================================================== */

function openSettingsFromUserBtn() {
  var el = document.getElementById('fx-panel');
  if (!el) {
    if (typeof showToast === 'function') showToast('设置面板不可用');
    return;
  }

  /* simple-mode 是 Mineradio 的「非 DIY 模式」，它的 CSS 里有
     body.simple-mode #fx-panel { display: none !important }
     所以点齿轮打不开。这里临时移除，关闭时再恢复。 */
  var wasSimple = document.body.classList.contains('simple-mode');
  if (wasSimple) {
    document.body.classList.remove('simple-mode');
    document.body.classList.remove('simple-mode-preload');
    try { document.documentElement.classList.remove('simple-mode-preload'); } catch (e) {}
    el.dataset.liteWasSimple = '1';
  }

  var open = el.classList.contains('show') || el.classList.contains('peek');
  if (open) {
    closeSettingsPanel();
    return;
  }

  /* 打开时刷新极简模式卡片（状态可能变了） */
  try {
    if (typeof ensureLiteModeCard === 'function') ensureLiteModeCard();
    var slot = document.getElementById('lite-mode-slot');
    if (slot && typeof liteModeCardHtml === 'function') {
      slot.innerHTML = '<div style="font-size:10.5px;color:rgba(255,255,255,.32);letter-spacing:.06em;margin-bottom:9px">PERFORMANCE · 性能</div>' + liteModeCardHtml();
    }
  } catch (e) {}

  // 清掉 peek 自动收起的定时器，避免刚开就被收
  try {
    if (typeof peekTimers !== 'undefined' && peekTimers && peekTimers.fx) {
      clearTimeout(peekTimers.fx);
      peekTimers.fx = null;
    }
  } catch (e) { /* 忽略 */ }

  el.classList.remove('closing', 'peek');
  el.classList.add('show');

  var fab = document.getElementById('fx-fab');
  if (fab) fab.classList.add('active');

  var btn = document.getElementById('user-btn');
  if (btn) btn.classList.add('active');
}

function closeSettingsPanel() {
  var el = document.getElementById('fx-panel');
  if (!el) return;
  el.classList.remove('show', 'peek');

  /* 如果打开时移除了 simple-mode，关闭时恢复 */
  if (el.dataset && el.dataset.liteWasSimple === '1') {
    document.body.classList.add('simple-mode');
    delete el.dataset.liteWasSimple;
  }
  el.classList.add('closing');
  setTimeout(function () { el.classList.remove('closing'); }, 280);

  var fab = document.getElementById('fx-fab');
  if (fab) fab.classList.remove('active');

  var btn = document.getElementById('user-btn');
  if (btn) btn.classList.remove('active');
}

/* 点空白处关闭设置面板
   —— 但不能一点就关：面板内部的点击要排除，齿轮按钮本身也要排除
      （否则点齿轮先开再关）。 */
(function bindSettingsOutsideClick() {
  document.addEventListener('click', function (e) {
    var el = document.getElementById('fx-panel');
    if (!el || !el.classList.contains('show')) return;

    var btn = document.getElementById('user-btn');
    if (btn && btn.contains(e.target)) return;
    if (el.contains(e.target)) return;

    closeSettingsPanel();
  }, true);   // 捕获阶段，确保先于其他 handler
})();

/* ==========================================================================
   极简模式开关 · 注入到设置面板顶部
   --------------------------------------------------------------------------
   fx-panel 是 Mineradio 的视觉控制台，内容很多。
   极简模式放在最上面，因为它是「一键降性能」，比逐项调更重要。
   ========================================================================== */
function ensureLiteModeCard() {
  var panel = document.getElementById('fx-panel');
  if (!panel) return;

  // 已经有就不重复加
  if (document.getElementById('lite-mode-slot')) return;

  // 找 panel 的内容容器（第一个 scroll 区）
  var host = panel.querySelector('.fx-panel-scroll')
    || panel.querySelector('.fx-panel-body')
    || panel;

  var slot = document.createElement('div');
  slot.id = 'lite-mode-slot';
  slot.className = 'lite-mode-slot';
  slot.style.cssText = 'padding:14px 16px 6px;';
  slot.innerHTML =
    '<div style="font-size:10.5px;color:rgba(255,255,255,.32);letter-spacing:.06em;margin-bottom:9px">' +
      'PERFORMANCE · 性能' +
    '</div>' +
    (typeof liteModeCardHtml === 'function' ? liteModeCardHtml() : '');

  // 插到最前面
  if (host.firstChild) host.insertBefore(slot, host.firstChild);
  else host.appendChild(slot);
}

/* 每次打开设置面板时确保卡片存在 */
(function bindLiteModeCard() {
  var tries = 0;
  function tryBind() {
    tries++;
    ensureLiteModeCard();
    if (tries < 40 && !document.getElementById('lite-mode-slot')) {
      setTimeout(tryBind, 500);
    }
  }
  // 等 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tryBind, 1200); });
  } else {
    setTimeout(tryBind, 1200);
  }
})();
