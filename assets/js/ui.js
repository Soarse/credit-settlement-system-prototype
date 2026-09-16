/* =============================================================================
 * ui.js —— 通用 UI 组件与路由注册表（零依赖）
 * ========================================================================== */
(function (global) {
  'use strict';
  var h = Core.h, M = Core.Money, esc = Core.esc;

  var routes = {};          // name -> { title, crumbs, render(container, params) }
  function route(name, def) { routes[name] = def; }

  /* ---------------- 导航 ---------------- */
  var NAV = [
    { group: '总览', items: [
      { key: 'dashboard', label: '运营监控大盘', idx: '◎',
        capabilities: ['大盘', '个人待办', '账期进度'],
        note: '统一查看账期、资金、风险与当前岗位待办。' },
      { key: 'onboard', label: '接入 SOP（5 天）', idx: '⚑',
        capabilities: ['新资金方接入 SOP'],
        note: '串联主体准入、账户验证、协议签署、规则试算和上线检查。' },
      { key: 'scenarios', label: '验收场景', idx: '✓',
        capabilities: ['部分到账验收', '部分争议验收', '流水缺失拦截验收'],
        note: '一键复现高风险业务边界，供培训和验收使用。' }
    ] },
    { group: '六大模块', items: [
      { key: 'partners', label: '资金方主数据', idx: '①',
        capabilities: ['资金方', '账户', '开票信息', '协议', '结算条款', '协议版本'],
        note: '“主数据中心”和“协议中心”的能力统一归入本菜单。' },
      { key: 'rules', label: '规则中心', idx: '②',
        capabilities: ['计费规则', '试算', '发布'],
        note: '维护版本化计费规则，并在审批后按生效日发布。' },
      { key: 'charge', label: '计费引擎', idx: '③',
        capabilities: ['业务事件接入', '幂等', '补数', '基数快照', '费用计算', '费用流水', '冲正重算'],
        note: '“事件中心”和“计费引擎”的能力统一归入本菜单。',
        external: ['信贷核心'] },
      { key: 'bills', label: '账单中心', idx: '④',
        capabilities: ['封账', '账单', '调整项', '争议', '开票', '收票', '红冲'],
        note: '“账单中心”和“发票中心”的能力统一归入本菜单。',
        external: ['发票平台'] },
      { key: 'settle', label: '结算中心', idx: '⑤',
        capabilities: ['结算单', '付款指令', '收款认领', '银行回单'],
        note: '覆盖应付执行、应收认领、部分结算和回单管理。',
        external: ['支付渠道', '银行'] },
      { key: 'recon', label: '对账中心', idx: '⑥',
        capabilities: ['五级勾稽', '外部对账', '差异处理'],
        note: '对内部五层数据和资金方外部账单进行独立核对。',
        external: ['资金方对账平台'] }
    ] },
    { group: '横向支撑', items: [
      { key: 'approvals', label: '审批中心 · 待办', idx: '✎',
        capabilities: ['分级审批', '双人复核', '证据留存'],
        note: '审批链按业务类型、影响金额和风险标记自动生成。',
        external: ['统一身份认证'] },
      { key: 'alerts', label: '告警中心', idx: '⚠',
        capabilities: ['风险告警', '超时升级'],
        note: '按 P0—P3 分级处理资损风险、数据异常和时效问题。' },
      { key: 'trace', label: '全链路追溯', idx: '⌕',
        capabilities: ['全链路查询'],
        note: '串联业务事件、规则、费用流水、账单、结算单和银行回单。' },
      { key: 'ops', label: '运营与审计', idx: '⚙',
        capabilities: ['操作日志', '变更记录'],
        note: '“追溯与审计中心”的审计能力归入本菜单。' },
      { key: 'about', label: '设计决策 · 说明', idx: 'ℹ',
        capabilities: ['业务边界说明', '关键控制原则', '外部集成说明'],
        note: '说明系统为什么这样设计，以及各模块的职责边界。',
        external: ['信贷核心', '支付渠道', '银行', '发票平台', '资金方对账平台', '统一身份认证'] }
    ] }
  ];
  // 子路由 → 所属一级导航
  var NAV_PARENT = {
    'onboard-task': 'onboard',
    partner: 'partners', 'partner-edit': 'partners', 'agreement-edit': 'partners',
    rulewizard: 'rules', trial: 'rules', versions: 'rules',
    events: 'charge', flows: 'charge', recalc: 'charge', reversal: 'charge', daily: 'charge', replenish: 'charge',
    bill: 'bills', workbench: 'bills', prebill: 'bills', adjustments: 'bills', disputes: 'bills', invoices: 'bills', calendar: 'bills',
    settleorder: 'settle', receipts: 'settle', claim: 'settle', payexc: 'settle',
    diffs: 'recon', tieout: 'recon', external: 'recon', metrics: 'recon'
  };

  /* ---------------- 基础组件 ---------------- */
  function pageHead(title, desc, actions) {
    return h('div', { class: 'page-head' }, [
      h('div', null, [
        h('h2', { class: 'page-title' }, title),
        desc ? h('p', { class: 'page-desc', html: desc }) : null
      ]),
      actions && actions.length ? h('div', { class: 'page-actions' }, actions) : null
    ]);
  }
  function card(title, body, opts) {
    opts = opts || {};
    return h('div', { class: 'card ' + (opts.class || '') }, [
      title ? h('div', { class: 'card-head' }, [
        h('h4', null, [title].concat(opts.ref ? [h('span', { class: 'tag-ref' }, opts.ref)] : [])),
        opts.actions ? h('div', { class: 'btn-row' }, opts.actions) : null
      ]) : null,
      h('div', { class: 'card-body' + (opts.tight ? ' tight' : '') }, body)
    ]);
  }
  function stat(label, value, sub, cls, onclick) {
    return h('div', { class: 'stat ' + (cls || '') + (onclick ? ' clickable' : ''), onclick: onclick }, [
      h('div', { class: 'stat-label' }, label),
      h('div', { class: 'stat-value' + (String(value).length > 11 ? ' sm' : '') }, value),
      sub ? h('div', { class: 'stat-sub' }, sub) : null
    ]);
  }
  function badge(text, cls) { return h('span', { class: 'badge ' + (cls || '') }, text); }

  var STATUS_MAP = {
    // 通用
    ACTIVE: ['合作中', 'ok'], PENDING: ['待处理', ''], ADMITTED: ['已准入', 'info'],
    SUSPENDED: ['暂停合作', 'warn'], TERMINATED: ['已终止', 'danger'],
    DRAFT: ['草稿', ''], TRIALING: ['试算中', 'info'], PENDING_APPROVAL: ['待审批', 'warn'],
    PENDING_EFFECTIVE: ['待生效', 'purple'], EFFECTIVE: ['生效中', 'ok'], EXPIRED: ['已失效', ''],
    VOIDED: ['已作废', 'danger'], PENDING_REVIEW: ['待复核', 'warn'], FROZEN: ['已冻结', 'danger'],
    DISABLED: ['已停用', ''],
    // 事件
    CHARGED: ['已计费', 'ok'], IGNORED: ['已忽略', ''], REVERSED: ['已冲正', 'purple'],
    FAILED: ['失败', 'danger'], PROCESSING: ['处理中', 'info'],
    // 账单
    GENERATED: ['已生成', 'info'], CONFIRMING: ['待确认', 'warn'], CONFIRMED: ['已确认', 'ok'],
    DISPUTED: ['争议中', 'danger'], ADJUSTED: ['已调整', 'purple'], SETTLED: ['已结算', 'ok'],
    // 结算
    APPROVING: ['审批中', 'warn'], SUCCESS: ['成功', 'ok'], PARTIAL: ['部分成功', 'warn'],
    UNKNOWN: ['状态未知', 'danger'], COMPLETED: ['已完成', 'ok'], RETURNED: ['已退票', 'danger'],
    CANCELLED: ['已取消', ''], READY: ['待发送', ''], WAITING_RECEIPT: ['待收款', 'warn'],
    // 收款认领
    AUTO_MATCHED: ['自动匹配待核销', 'info'], SUSPENSE: ['挂账待认领', 'danger'],
    EXCLUDED: ['非本系统款项', ''],
    PARTIAL_SETTLED: ['部分结算', 'warn'], SENT: ['已发送', 'info'],
    // 发票
    SUBMITTED: ['已提交发票系统', 'info'], ISSUED: ['已开票', 'ok'], APPLIED: ['已生成开票申请', 'info'],
    // 重算 / 差异
    SHADOW_RUNNING: ['影子计算中', 'info'], COMPARED: ['已比对', 'info'], ABORTED: ['已中止', ''],
    CHECKING: ['核查中', 'info'], CLOSED: ['已闭环', 'ok'], APPROVED: ['已审批', 'ok'],
    HOLDING: ['已挂账', 'warn']
  };
  function statusBadge(code) {
    var m = STATUS_MAP[code] || [code, ''];
    return h('span', { class: 'badge dot ' + m[1] }, m[0]);
  }
  function statusText(code) { return (STATUS_MAP[code] || [code])[0]; }

  function money(v, opts) {
    opts = opts || {};
    var cls = 'num' + (v < 0 ? ' neg' : (opts.pos && v > 0 ? ' pos' : ''));
    return h('span', { class: cls }, opts.signed ? M.fmtSigned(v) : M.fmt(v));
  }
  function dirBadge(d) {
    return d === 'RECEIVABLE' || d === 'RECEIVE'
      ? h('span', { class: 'badge ok' }, '应收')
      : h('span', { class: 'badge danger' }, '应付');
  }

  /* ---------------- 表格 ---------------- */
  function table(cols, rows, opts) {
    opts = opts || {};
    var thead = h('thead', null, h('tr', null, cols.map(function (c) {
      return h('th', { class: c.num ? 'num' : '', style: c.width ? 'width:' + c.width : null }, c.label);
    })));
    var tbody = h('tbody', null, rows.length ? rows.map(function (r, i) {
      return h('tr', { class: opts.onRow ? 'rowclick' : '', onclick: opts.onRow ? function () { opts.onRow(r, i); } : null },
        cols.map(function (c) {
          var v = c.render ? c.render(r, i) : r[c.key];
          return h('td', { class: c.num ? 'num' : (c.class || '') },
            (v && v.nodeType) ? v : (v === null || v === undefined ? '—' : String(v)));
        }));
    }) : [h('tr', null, h('td', { colspan: cols.length }, h('div', { class: 'empty' }, opts.empty || '暂无数据')))]);
    var foot = opts.foot ? h('tfoot', null, h('tr', null, opts.foot.map(function (f) {
      return h('td', { class: f.num ? 'num' : '' }, (f.value && f.value.nodeType) ? f.value : String(f.value === undefined ? '' : f.value));
    }))) : null;
    return h('div', { class: 'tbl-wrap' + (opts.scroll ? ' scroll-y' : '') },
      h('table', { class: 'tbl' + (opts.compact ? ' compact' : '') }, [thead, tbody, foot]));
  }

  /** 带分页的表格 */
  function pagedTable(cols, rows, opts) {
    opts = opts || {};
    var size = opts.pageSize || 20, page = 0;
    var wrap = h('div');
    function draw() {
      wrap.innerHTML = '';
      var slice = rows.slice(page * size, (page + 1) * size);
      wrap.appendChild(table(cols, slice, opts));
      if (rows.length > size) {
        var total = Math.ceil(rows.length / size);
        wrap.appendChild(h('div', { class: 'pager' }, [
          h('span', null, '共 ' + rows.length + ' 条 · 第 ' + (page + 1) + ' / ' + total + ' 页'),
          h('button', { class: 'btn btn-sm', disabled: page === 0, onclick: function () { page--; draw(); } }, '上一页'),
          h('button', { class: 'btn btn-sm', disabled: page >= total - 1, onclick: function () { page++; draw(); } }, '下一页')
        ]));
      }
      return wrap;
    }
    return draw();
  }

  function kv(pairs, cls) {
    var dl = h('dl', { class: 'kv ' + (cls || '') });
    pairs.forEach(function (p) {
      if (!p) return;
      dl.appendChild(h('dt', null, p[0]));
      dl.appendChild(h('dd', null, (p[1] && p[1].nodeType) ? p[1] : String(p[1] === undefined || p[1] === null || p[1] === '' ? '—' : p[1])));
    });
    return dl;
  }

  function tabs(items, active, onChange) {
    return h('div', { class: 'tabs' }, items.map(function (it) {
      return h('button', { class: 'tab' + (it.key === active ? ' active' : ''), onclick: function () { onChange(it.key); } }, it.label);
    }));
  }

  function alertBox(kind, text, ico) {
    return h('div', { class: 'alert ' + kind }, [
      h('span', { class: 'ico' }, ico || ({ ok: '✓', warn: '!', danger: '✕', info: 'i' }[kind] || 'i')),
      h('div', { html: text })
    ]);
  }

  function checklist(rows) {
    return h('div', { class: 'checklist' }, rows.map(function (r) {
      var cls = r.ok ? 'pass' : (r.level === 'WARN' ? 'warn' : 'fail');
      return h('div', { class: 'check-row ' + cls }, [
        h('div', { class: 'st' }, r.ok ? '✓' : (r.level === 'WARN' ? '!' : '✕')),
        h('div', { class: 'code' }, r.code),
        h('div', { class: 'msg' }, [h('div', null, r.desc), r.msg ? h('div', { class: 'faint', style: 'font-size:11.5px' }, r.msg) : null]),
        h('div', { class: 'lvl' }, badge(r.level === 'BLOCK' ? '阻断' : '警告', r.ok ? '' : (r.level === 'WARN' ? 'warn' : 'danger')))
      ]);
    }));
  }

  /* ---------------- Modal / Toast ---------------- */
  function modal(title, bodyEl, footEl, opts) {
    opts = opts || {};
    var host = document.getElementById('modal-host');
    host.innerHTML = '';
    host.hidden = false;
    var m = h('div', { class: 'modal ' + (opts.size || '') }, [
      h('div', { class: 'modal-head' }, [
        h('h4', null, title),
        h('button', { class: 'icon-btn', onclick: closeModal }, '✕')
      ]),
      h('div', { class: 'modal-body' }, bodyEl),
      footEl ? h('div', { class: 'modal-foot' }, footEl) : null
    ]);
    host.appendChild(m);
    host.onclick = function (e) { if (e.target === host) closeModal(); };
    return m;
  }
  function closeModal() {
    var host = document.getElementById('modal-host');
    host.hidden = true; host.innerHTML = '';
  }
  function toast(msg, kind, title) {
    var host = document.getElementById('toast-host');
    var t = h('div', { class: 'toast ' + (kind || '') }, [
      title ? h('div', { class: 'tt' }, title) : null,
      h('div', { html: msg })
    ]);
    host.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(function () { t.remove(); }, 320); }, 3600);
  }

  /* ---------------- 追溯树 ---------------- */
  function traceTree(node, level) {
    level = level || 0;
    var wrap = h('div', { class: 'tnode' + (level === 0 ? ' root' : '') });
    var open = level < 3;
    var kidsBox = h('div', { hidden: !open });
    var hasKids = node.children && node.children.length;
    var row = h('div', { class: 'trow', onclick: function () { if (hasKids) { kidsBox.hidden = !kidsBox.hidden; caret.textContent = kidsBox.hidden ? '▶' : '▼'; } } }, [
      h('span', { class: 'tw' }, hasKids ? (open ? '▼' : '▶') : '·'),
      h('span', { class: 'tt' }, node.type),
      h('span', { class: 'tno' }, node.no),
      h('span', { class: 'tdesc' }, node.desc || ''),
      node.amount !== null && node.amount !== undefined ? h('span', { class: 'tamt' + (node.amount < 0 ? ' neg' : '') }, M.fmt(node.amount)) : null
    ]);
    var caret = row.firstChild;
    wrap.appendChild(row);
    if (hasKids) {
      node.children.forEach(function (c) { kidsBox.appendChild(traceTree(c, level + 1)); });
      if (node.truncated) kidsBox.appendChild(h('div', { class: 'trow faint' }, '… 另有 ' + node.truncated + ' 条，请使用「导出追溯报告」查看完整明细'));
      wrap.appendChild(kidsBox);
    }
    return wrap;
  }

  /* ---------------- 柱状图（单序列 + 状态标记）----------------
   * 单序列不设图例（标题即序列名）；异常用状态色 + ▲ 标记 + 文字说明，
   * 不依赖颜色单独传达信息；网格线弱化；仅对峰值与异常做直接标注。
   * ------------------------------------------------------------ */
  function barChart(data, opts) {
    opts = opts || {};
    var max = 0;
    data.forEach(function (d) { max = Math.max(max, d.value || 0); });
    if (max <= 0) max = 1;
    var peak = data.reduce(function (a, b) { return (b.value || 0) > (a.value || 0) ? b : a; }, data[0] || {});
    var wrap = h('div', { class: 'chart' });
    var tip = h('div', { class: 'chart-tip', hidden: true });
    var plot = h('div', { class: 'chart-plot' });

    // 网格线（0 / 50% / 100%）
    var grid = h('div', { class: 'chart-grid' });
    [0, 0.5, 1].forEach(function (p) {
      grid.appendChild(h('div', { style: 'bottom:' + (p * 100) + '%' },
        h('span', null, opts.fmtAxis ? opts.fmtAxis(max * p) : M.fmtShort(max * p))));
    });
    plot.appendChild(grid);

    if (opts.threshold !== undefined && opts.threshold !== null && opts.threshold <= max) {
      var tp = opts.threshold / max * 100;
      plot.appendChild(h('div', { class: 'chart-thr', style: 'bottom:' + tp + '%' },
        h('span', null, '阈值 ' + (opts.fmtAxis ? opts.fmtAxis(opts.threshold) : M.fmtShort(opts.threshold)))));
    }
    data.forEach(function (d) {
      var pct = Math.max(1.5, (d.value || 0) / max * 100);
      var breach = opts.threshold !== undefined && opts.threshold !== null && (d.value || 0) > opts.threshold;
      var bar = h('div', {
        class: 'chart-bar' + (d.anomaly ? ' anom' : '') + (breach ? ' breach' : '') + ((d.value || 0) === 0 ? ' zero' : ''),
        style: 'height:' + pct + '%',
        onmouseenter: function (e) {
          tip.hidden = false;
          tip.innerHTML = '<b>' + esc(d.label) + '</b><br>' + (opts.tipHtml ? opts.tipHtml(d) : M.fmt(d.value));
          var r = bar.getBoundingClientRect(), w = wrap.getBoundingClientRect();
          tip.style.left = (r.left - w.left + r.width / 2) + 'px';
          tip.style.top = (r.top - w.top - 6) + 'px';
        },
        onmouseleave: function () { tip.hidden = true; },
        onclick: function () { if (opts.onClick) opts.onClick(d); }
      });
      if (d.anomaly || breach) bar.appendChild(h('span', { class: 'mk', title: d.anomalyText || (breach ? '超阈值' : '异常') }, '▲'));
      else if (d === peak && opts.labelPeak !== false) bar.appendChild(h('span', { class: 'dlab' }, M.fmtShort(d.value)));
      plot.appendChild(bar);
    });

    var axis = h('div', { class: 'chart-axis' });
    var step = Math.max(1, Math.ceil(data.length / 10));
    data.forEach(function (d, i) { axis.appendChild(h('span', null, i % step === 0 ? (d.axis || d.label) : '')); });

    wrap.appendChild(plot);
    wrap.appendChild(axis);
    wrap.appendChild(tip);
    wrap.appendChild(h('div', { class: 'chart-note' }, [
      h('span', null, [h('i', { style: 'background:var(--brand)' }), opts.seriesName || '当日费用金额']),
      h('span', null, [h('i', { style: 'background:var(--danger)' }), '▲ ' + (opts.anomalyName || '环比突变（> 300% 或 < 30%）')]),
      h('span', { class: 'faint' }, '悬停查看当日明细' + (opts.onClick ? '，点击下钻' : ''))
    ]));
    return wrap;
  }

  /** 迷你趋势条（指标卡内嵌；单序列 + 超阈值状态色，无图例——卡片标题即序列名） */
  function sparkline(values, threshold) {
    var mx = 0;
    values.forEach(function (v) { mx = Math.max(mx, v || 0); });
    if (mx <= 0) mx = 1;
    return h('div', { class: 'spark' }, values.map(function (v, i) {
      var over = threshold !== undefined && threshold !== null && (v || 0) > threshold;
      return h('i', {
        class: (over ? 'breach' : '') + (i === values.length - 1 ? ' last' : ''),
        style: 'height:' + Math.max(6, (v || 0) / mx * 100) + '%',
        title: (v || 0)
      });
    }));
  }

  /* ---------------- 小工具 ---------------- */
  /** 触发浏览器下载（零依赖，Blob URL） */
  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
      return true;
    } catch (e) { console.error(e); return false; }
  }

  function goto(hash) { location.hash = hash; }
  function link(text, hash, cls) {
    return h('a', { href: '#' + hash, class: cls || '' }, text);
  }
  function selectEl(options, value, onChange, attrs) {
    var s = h('select', Object.assign({ onchange: function () { onChange(s.value); } }, attrs || {}));
    options.forEach(function (o) {
      s.appendChild(h('option', { value: o.value, selected: o.value === value }, o.label));
    });
    s.value = value;
    return s;
  }
  function field(label, control, hint) {
    return h('div', { class: 'field' }, [h('label', null, label), control, hint ? h('div', { class: 'hint' }, hint) : null]);
  }
  function progress(p) { return h('div', { class: 'progress' }, h('i', { style: 'width:' + Math.max(0, Math.min(100, p * 100)) + '%' })); }

  function levelBadge(lv) {
    var map = { P0: 'danger', P1: 'danger', P2: 'warn', P3: '' };
    return badge(lv, map[lv]);
  }

  global.UI = {
    route: route, routes: routes, NAV: NAV, NAV_PARENT: NAV_PARENT,
    pageHead: pageHead, card: card, stat: stat, badge: badge, statusBadge: statusBadge, statusText: statusText,
    money: money, dirBadge: dirBadge, table: table, pagedTable: pagedTable, kv: kv, tabs: tabs,
    sparkline: sparkline,
    alertBox: alertBox, checklist: checklist, modal: modal, closeModal: closeModal, toast: toast,
    traceTree: traceTree, barChart: barChart, download: download,
    goto: goto, link: link, selectEl: selectEl, field: field,
    progress: progress, levelBadge: levelBadge
  };
})(window);
