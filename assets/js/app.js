/* =============================================================================
 * app.js —— 应用启动、Hash 路由、导航与全局交互
 * 路由形如 #/partner/P000012?tab=account
 * ========================================================================== */
(function (global) {
  'use strict';
  var h = Core.h;

  var current = { name: 'dashboard', params: {} };
  var navTipAnchor = null;

  function navTipEl() {
    var tip = document.getElementById('nav-capability-tip');
    if (!tip) {
      tip = h('div', { id: 'nav-capability-tip', class: 'nav-capability-tip', role: 'tooltip', hidden: true });
      document.body.appendChild(tip);
    }
    return tip;
  }

  function showNavTip(item, anchor) {
    if (!item || !item.capabilities || !anchor) return;
    var tip = navTipEl();
    navTipAnchor = anchor;
    tip.innerHTML = '';
    tip.appendChild(h('div', { class: 'nav-tip-title' }, item.label));
    tip.appendChild(h('div', { class: 'nav-tip-label' }, '主要能力'));
    tip.appendChild(h('div', { class: 'nav-tip-chips' }, item.capabilities.map(function (x) {
      return h('span', null, x);
    })));
    if (item.note) tip.appendChild(h('p', { class: 'nav-tip-note' }, item.note));
    if (item.external && item.external.length) {
      tip.appendChild(h('div', { class: 'nav-tip-external' }, [
        h('b', null, '外部集成'),
        h('span', null, item.external.join('、'))
      ]));
    }
    tip.hidden = false;
    var r = anchor.getBoundingClientRect();
    var top = Math.max(10, Math.min(window.innerHeight - tip.offsetHeight - 10, r.top - 4));
    tip.style.left = (r.right + 10) + 'px';
    tip.style.top = top + 'px';
  }

  function hideNavTip(anchor) {
    if (anchor && navTipAnchor && anchor !== navTipAnchor) return;
    var tip = document.getElementById('nav-capability-tip');
    if (tip) tip.hidden = true;
    navTipAnchor = null;
  }

  function parseHash() {
    var raw = location.hash.replace(/^#/, '') || '/dashboard';
    var qs = '', path = raw;
    var qi = raw.indexOf('?');
    if (qi >= 0) { path = raw.slice(0, qi); qs = raw.slice(qi + 1); }
    var seg = path.split('/').filter(Boolean);
    var name = seg[0] || 'dashboard';
    var params = {};
    if (seg[1]) params.id = decodeURIComponent(seg[1]);
    qs.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      if (i < 0) params[kv] = true;
      else params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return { name: name, params: params };
  }

  function renderNav() {
    var nav = document.getElementById('nav');
    hideNavTip();
    nav.innerHTML = '';
    var activeTop = UI.NAV_PARENT[current.name] || current.name;
    var S = Store.get();
    UI.NAV.forEach(function (g) {
      nav.appendChild(h('div', { class: 'nav-group' }, [
        h('div', { class: 'nav-group-title' }, g.group)
      ].concat(g.items.map(function (it) {
        var badge = null;
        if (it.key === 'charge') {
          var pend = S.events.filter(function (e) { return e.status === 'PENDING' || e.status === 'FAILED'; }).length;
          if (pend) badge = h('span', { class: 'nav-badge' }, pend);
        }
        if (it.key === 'recon') {
          var od = S.diffs.filter(function (d) { return d.status !== 'CLOSED'; }).length;
          if (od) badge = h('span', { class: 'nav-badge' }, od);
        }
        if (it.key === 'approvals') {
          var td = Approval.myTodoCount(S);
          if (td) badge = h('span', { class: 'nav-badge' }, td);
        }
        var navBtn = h('button', {
          class: 'nav-item' + (it.key === activeTop ? ' active' : ''),
          dataset: { guide: 'nav-' + it.key },
          'aria-describedby': 'nav-capability-tip',
          onclick: function () { hideNavTip(); UI.goto('/' + it.key); },
          onmouseenter: function () { showNavTip(it, navBtn); },
          onmouseleave: function () { hideNavTip(navBtn); },
          onfocus: function () { showNavTip(it, navBtn); },
          onblur: function () { hideNavTip(navBtn); }
        }, [h('span', { class: 'nav-idx' }, it.idx), h('span', null, it.label), badge]);
        return navBtn;
      }))));
    });
  }

  function renderTop() {
    var def = UI.routes[current.name];
    var crumbs = (def && def.crumbs) || ['未知页面'];
    var box = document.getElementById('crumbs');
    box.innerHTML = '';
    crumbs.forEach(function (c, i) {
      if (i) box.appendChild(h('span', { class: 'sep' }, '/'));
      box.appendChild(i === crumbs.length - 1 ? h('b', null, c) : h('span', null, c));
    });
    document.getElementById('sim-date').textContent = Store.get().simToday;
  }

  function render() {
    var view = document.getElementById('view');
    view.innerHTML = '';
    UI.closeModal();
    var def = UI.routes[current.name];
    if (!def) {
      view.appendChild(UI.pageHead('页面不存在', '路由 <code>#/' + Core.esc(current.name) + '</code> 未注册。'));
      view.appendChild(h('button', { class: 'btn btn-primary', onclick: function () { UI.goto('/dashboard'); } }, '返回大盘'));
      return;
    }
    document.title = def.title + ' · 零售信贷资金方计费结算系统';
    try {
      def.render(view, current.params);
    } catch (err) {
      console.error(err);
      view.appendChild(UI.alertBox('danger', '页面渲染出错：<b>' + Core.esc(err.message) + '</b><br><pre class="code">' + Core.esc(err.stack || '') + '</pre>'));
    }
    renderNav();
    renderTop();
    window.scrollTo(0, 0);
    if (global.Guide && Guide.isActive()) Guide.refresh();
    if (global.FlowGuide && FlowGuide.isActive()) FlowGuide.refresh();
  }

  function onHashChange() {
    current = parseHash();
    render();
  }

  /* ---------------- 主题 ---------------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('rcs.theme', t); } catch (e) { }
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var savedTheme = null, savedRole = null;
    try { savedTheme = localStorage.getItem('rcs.theme'); savedRole = localStorage.getItem('rcs.role'); } catch (e) { }
    applyTheme(savedTheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

    Store.init();
    if (savedRole) Store.get().role = savedRole;

    // 角色选择器
    var sel = document.getElementById('role-select');
    Data.ROLES.forEach(function (r) {
      var u = (Data.ROLE_USERS || {})[r.code];
      sel.appendChild(h('option', { value: r.code, selected: r.code === Store.get().role },
        (u ? u.user_name + ' / ' : '') + r.name));
    });
    sel.value = Store.get().role;
    sel.addEventListener('change', function () {
      Store.Actions.setRole(sel.value);
      UI.toast('已切换为「' + Store.roleName(sel.value) + '」，按钮可用性按 PRD 第 14 章权限矩阵变化', '', '角色切换');
      render();
    });

    document.getElementById('btn-theme').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    document.getElementById('btn-reset').addEventListener('click', function () {
      UI.modal('重置模拟数据', h('div', null, [
        UI.alertBox('warn', '将丢弃本次会话中的所有操作（封账、出账、结算、重算、规则发布等），恢复到初始状态：<b>2026-03 账期已结算 / 2026-04 账期待封账</b>。')
      ]), [
        h('button', { class: 'btn', onclick: UI.closeModal }, '取消'),
        h('button', {
          class: 'btn btn-danger', onclick: function () {
            var role = Store.get().role;
            Store.Actions.reset();
            Store.get().role = role;
            UI.closeModal(); render();
            UI.toast('模拟数据已重置', 'ok');
          }
        }, '确认重置')
      ], { size: 'narrow' });
    });

    window.addEventListener('hashchange', onHashChange);
    onHashChange();
    if (global.Guide) Guide.init();
    if (global.FlowGuide) FlowGuide.init();

    console.log('%c 零售信贷资金方计费结算系统 · 模拟原型 ',
      'background:#2563eb;color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold');
    var S = Store.get();
    console.log('事件 %d 条 / 费用流水 %d 条 / 基数快照 %d 条 / 账单 %d 张 / 结算单 %d 张',
      S.events.length, S.eng.feeFlows.length, S.eng.snapshots.length, S.bills.length, S.settleOrders.length);
  }

  global.App = { rerender: render, boot: boot, current: function () { return current; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
