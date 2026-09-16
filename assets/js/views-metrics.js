/* =============================================================================
 * views-metrics.js —— 对账中心 · 资损监控指标看板 + 告警中心（PRD 9.6）
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  function stBadge(st) {
    return h('span', { class: 'badge ' + st.cls }, st.icon + ' ' + st.name);
  }

  /* =========================== 指标看板 =========================== */
  UI.route('metrics', {
    title: '资损监控指标', crumbs: ['模块⑥', '对账中心', '资损监控指标'],
    render: function (root, params) {
      var S = Store.get();
      var snap = Metrics.snapshot(S);
      var sel = params.m || (snap.filter(function (r) { return r.status.code === 'CRIT'; })[0] || snap[0]).metric.code;
      var selRow = snap.filter(function (r) { return r.metric.code === sel; })[0];

      root.appendChild(U.pageHead('资损监控指标',
        '这六个指标不是「看板上的数字」，而是<b>资损的六个入口</b> —— ' +
        '每一个为真，都意味着钱可能已经算错、少收、多付或收不回来。' +
        '所以每个指标都带<b>阈值与级别</b>，越线即产生告警，而不是等人去看。',
        [h('button', {
          class: 'btn btn-primary', disabled: !Store.can('alert.close'),
          onclick: function () {
            var r = Store.Actions.scanMetrics();
            UI.toast('扫描完成：新增告警 ' + r.made.length + ' 条，指标回落自动关闭 ' + r.autoClosed.length + ' 条',
              r.made.length ? 'warn' : 'ok');
            App.rerender();
          }
        }, '立即扫描指标'),
        h('button', { class: 'btn', onclick: function () { U.goto('/alerts'); } }, '前往告警中心')]));
      root.appendChild(ViewsRecon.subnav('metrics'));

      /* ---------- 六个指标卡（KPI 行） ---------- */
      var bad = snap.filter(function (r) { return r.status.code === 'CRIT'; });
      if (bad.length) {
        root.appendChild(U.alertBox('danger', '<b>' + bad.length + ' 项指标已越阈值</b>：' +
          bad.map(function (r) { return r.metric.name + ' ' + r.metric.fmt(r.value) + '（' + r.metric.block + '）'; }).join('；')));
      }

      var grid = h('div', { class: 'grid g3' });
      snap.forEach(function (row) {
        var m = row.metric;
        var ser = Metrics.series(S, m.code, 30);
        var card = h('div', {
          class: 'mcard' + (m.code === sel ? ' sel' : ''),
          onclick: function () { U.goto('/metrics?m=' + m.code); }
        }, [
          h('div', { class: 'mcard-h' }, [
            h('span', { class: 'mcard-l' }, m.name),
            stBadge(row.status)
          ]),
          h('div', { class: 'mcard-v ' + (row.status.code === 'CRIT' ? 'bad' : (row.status.code === 'WARN' ? 'warn' : '')) },
            m.fmt(row.value)),
          h('div', { class: 'mcard-s' },
            '阈值 ' + m.fmt(m.crit) + '　·　' + m.level + '　·　' + m.block +
            (row.amount ? '　·　涉及 ' + M.fmtShort(row.amount) + ' 元' : '')),
          U.sparkline(ser.map(function (x) { return x.value; }), m.crit)
        ]);
        grid.appendChild(card);
      });
      root.appendChild(U.card('资损监控指标 · ' + S.simToday, h('div', null, [
        grid,
        h('div', { class: 'faint mt8' }, '卡片内嵌迷你趋势覆盖最近 30 个业务日，超阈值的日子以状态色标出。点击任一卡片查看该指标的完整趋势与明细。')
      ]), { ref: '9.6.1' }));

      /* ---------- 选中指标的趋势 ---------- */
      var m = selRow.metric;
      var series = Metrics.series(S, m.code, 30);
      root.appendChild(U.card(m.name + ' · 近 30 个业务日', h('div', null, [
        U.alertBox(selRow.status.code === 'CRIT' ? 'danger' : 'info',
          '<b>为什么盯这个指标：</b>' + m.why + '　<b>阈值</b> ' + m.fmt(m.crit) +
          '，越线即 ' + m.level + ' 告警并 ' + m.block + '。'),
        U.barChart(series.map(function (x) {
          return { label: x.date, axis: x.axis, value: x.value, anomalyText: '超阈值' };
        }), {
          threshold: m.crit,
          seriesName: m.name,
          anomalyName: '超阈值（≥ ' + m.fmt(m.crit) + '）',
          fmtAxis: function (v) { return m.pct ? M.pct(v, 1) : M.fmtShort(v); },
          tipHtml: function (d) {
            var row = series.filter(function (x) { return x.date === d.label; })[0] || {};
            return m.fmt(d.value) + (row.amount ? '<br>涉及金额 ' + M.fmt(row.amount) : '');
          }
        }),
        h('div', { class: 'mt14' }, U.pagedTable([
          { label: '业务日', render: function (x) { return x.date; }, width: '110px' },
          { label: m.name, num: true, render: function (x) {
            return h('span', { class: x.breach ? 'neg' : '' }, m.fmt(x.value));
          } },
          { label: '涉及金额', num: true, render: function (x) { return x.amount ? M.fmt(x.amount) : '—'; } },
          { label: '状态', render: function (x) { return stBadge(Metrics.statusOf(m, x.value)); }, width: '110px' }
        ], series.slice().reverse(), { compact: true, pageSize: 10 }))
      ]), { ref: m.ref }));

      /* ---------- 指标口径表 ---------- */
      root.appendChild(U.card('指标口径与阈值', U.table([
        { label: '指标', render: function (x) { return x.name; }, width: '140px' },
        { label: '为什么盯它', render: function (x) { return h('span', { class: 'faint' }, x.why); } },
        { label: '阈值', render: function (x) { return x.fmt(x.crit); }, width: '90px' },
        { label: '级别', render: function (x) {
          return U.badge(x.level, x.level === 'P0' ? 'danger' : 'warn');
        }, width: '70px' },
        { label: '越线后果', render: function (x) { return x.block; }, width: '130px' },
        { label: 'PRD', render: function (x) { return h('span', { class: 'tag-ref' }, x.ref); }, width: '90px' }
      ], Metrics.METRICS, { compact: true }), { tight: true, ref: '9.6.1' }));
    }
  });

  /* =========================== 告警中心 =========================== */
  UI.route('alerts', {
    title: '告警中心', crumbs: ['横向支撑', '告警中心'],
    render: function (root, params) {
      var S = Store.get();
      var view = params.v || 'OPEN';
      var lv = params.l || '';

      root.appendChild(U.pageHead('告警中心',
        '告警的价值不在「响」，而在<b>关得掉</b>。所以每条告警都要走完闭环：' +
        '<b>产生 → 处理 → 填写处理方式与说明 → 关闭</b>，关闭后仍可重新打开。' +
        '指标类告警还有一条硬约束：<b>指标未回落不得关闭</b>，除非明确判定为误报。',
        [h('button', {
          class: 'btn', disabled: !Store.can('alert.close'),
          onclick: function () {
            var r = Store.Actions.scanMetrics();
            UI.toast('扫描完成：新增 ' + r.made.length + ' 条，自动关闭 ' + r.autoClosed.length + ' 条', 'ok');
            App.rerender();
          }
        }, '重新扫描指标'),
        h('button', { class: 'btn', onclick: function () { U.goto('/metrics'); } }, '查看指标看板')]));

      var open = S.alerts.filter(function (a) { return !a.closed; });
      var closed = S.alerts.filter(function (a) { return a.closed; });
      function cnt(l) { return open.filter(function (a) { return a.level === l; }).length; }
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('P0 未关闭', String(cnt('P0')), '资损级，必须立即处理', cnt('P0') ? 'danger' : 'ok'),
        U.stat('P1 未关闭', String(cnt('P1')), '需当日处理', cnt('P1') ? 'warn' : 'ok'),
        U.stat('P2 / P3 未关闭', String(cnt('P2') + cnt('P3')), '可批量确认'),
        U.stat('已关闭', String(closed.length),
          closed.length ? '其中重新打开过 ' + closed.filter(function (a) { return a.reopen_count; }).length + ' 条' : '—')
      ]));

      /* ---------- 列表 ---------- */
      var rows = S.alerts.filter(function (a) {
        if (view === 'OPEN' && a.closed) return false;
        if (view === 'CLOSED' && !a.closed) return false;
        if (lv && a.level !== lv) return false;
        return true;
      });
      var picked = {};
      var listBox = h('div');

      root.appendChild(U.card('告警列表', h('div', null, [
        h('div', { class: 'inline-form' }, [
          U.field('查看', U.selectEl([
            { value: 'OPEN', label: '未关闭' }, { value: 'CLOSED', label: '已关闭' }, { value: 'ALL', label: '全部' }
          ], view, function (v) { U.goto('/alerts?v=' + v + (lv ? '&l=' + lv : '')); })),
          U.field('级别', U.selectEl([
            { value: '', label: '全部级别' }, { value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' },
            { value: 'P2', label: 'P2' }, { value: 'P3', label: 'P3' }
          ], lv, function (v) { U.goto('/alerts?v=' + view + (v ? '&l=' + v : '')); })),
          h('button', {
            class: 'btn', disabled: !Store.can('alert.close'),
            onclick: function () {
              var ids = Object.keys(picked).filter(function (k) { return picked[k]; });
              if (!ids.length) { UI.toast('请先勾选要批量关闭的告警', 'warn'); return; }
              var r = Store.Actions.batchCloseAlerts(ids, '批量确认处理完毕');
              UI.toast('已关闭 ' + r.closed.length + ' 条' +
                (r.refused.length ? '；' + r.refused.length + ' 条为 P0 / P1，必须逐条处理并填写说明' : ''),
                r.refused.length ? 'warn' : 'ok');
              App.rerender();
            }
          }, '批量关闭（仅限 P2 / P3）')
        ]),
        listBox
      ]), { ref: '9.6.2' }));
      drawList();

      function drawList() {
        listBox.innerHTML = '';
        listBox.appendChild(h('div', { class: 'mt8' }, U.pagedTable([
          { label: '', width: '34px', render: function (a) {
            if (a.closed || a.level === 'P0' || a.level === 'P1') return h('span', { class: 'faint' }, '—');
            var cb = h('input', { type: 'checkbox' });
            cb.checked = !!picked[a.id];
            cb.addEventListener('change', function () { picked[a.id] = cb.checked; });
            /* 勾选不应触发行点击（否则会顺手弹出详情） */
            cb.addEventListener('click', function (e) { e.stopPropagation(); });
            return cb;
          } },
          { label: '级别', render: function (a) {
            return U.badge(a.level, a.level === 'P0' ? 'danger' : (a.level === 'P1' ? 'warn' : ''));
          }, width: '60px' },
          { label: '告警', render: function (a) {
            return h('div', null, [
              h('div', null, [a.title, a.repeat > 1 ? h('span', { class: 'badge', style: 'margin-left:6px' }, '×' + a.repeat) : null]),
              h('div', { class: 'faint', style: 'font-size:11px' }, String(a.msg).replace(/<[^>]+>/g, '').slice(0, 60))
            ]);
          } },
          { label: '来源', render: function (a) { return a.source || '—'; }, width: '110px' },
          { label: '首次 / 最近', render: function (a) {
            return h('div', null, [h('div', null, a.time),
              a.last_time !== a.time ? h('div', { class: 'faint', style: 'font-size:11px' }, a.last_time) : null]);
          }, width: '130px' },
          { label: '状态', render: function (a) {
            if (!a.closed) return U.badge('未关闭', 'danger');
            var act = Data.ALERT_ACTIONS.filter(function (x) { return x.code === a.close_action; })[0];
            return h('div', null, [U.badge('已关闭', 'ok'),
              act ? h('div', { class: 'faint', style: 'font-size:11px' }, act.name) : null]);
          }, width: '110px' },
          { label: '重开', num: true, render: function (a) { return a.reopen_count || '—'; }, width: '60px' },
          { label: '', width: '70px', render: function (a) {
            return h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); detail(a); } }, '处理');
          } }
        ], rows, { compact: true, pageSize: 12, empty: '无告警', onRow: detail })));
      }

      /* ---------- 关闭方式说明 ---------- */
      root.appendChild(U.card('告警关闭方式', U.table([
        { label: '方式', render: function (x) { return U.badge(x.name, x.cls); }, width: '150px' },
        { label: '编码', render: function (x) { return h('span', { class: 'mono' }, x.code); }, width: '140px' },
        { label: '含义', render: function (x) { return h('span', { html: x.desc }); } }
      ], Data.ALERT_ACTIONS, { compact: true }), { tight: true, ref: '9.6.2' }));

      root.appendChild(U.alertBox('warn',
        '<b>为什么关闭要填说明</b>：一个永远有 40 条未读的告警面板，等于没有告警面板。' +
        '要让人真的去关，就必须让「关掉」这个动作有成本也有意义 —— 写清是修好了、是误报、还是已评估接受。' +
        '这三种处理方式在月度质量复盘时的含义完全不同：误报多说明阈值该调，接受多说明风险在累积。'));

      if (params.id) {
        var t = Store.Actions.findAlert(params.id);
        if (t) setTimeout(function () { detail(t); }, 60);
      }

      /* ---------- 告警详情与关闭 ---------- */
      function detail(a) {
        var body = h('div');
        var mrow = a.metric_code
          ? Metrics.snapshot(S).filter(function (r) { return r.metric.code === a.metric_code; })[0] : null;

        body.appendChild(U.kv([
          ['告警编号', h('span', { class: 'mono' }, a.id)],
          ['级别', U.badge(a.level, a.level === 'P0' ? 'danger' : (a.level === 'P1' ? 'warn' : ''))],
          ['标题', a.title],
          ['来源模块', a.source || '—'],
          ['首次发生', a.time],
          ['最近发生', a.last_time + (a.repeat > 1 ? '（累计 ' + a.repeat + ' 次）' : '')],
          ['当前状态', a.closed ? U.badge('已关闭', 'ok') : U.badge('未关闭', 'danger')],
          ['重新打开次数', String(a.reopen_count || 0)]
        ], 'kv-2col'));
        body.appendChild(h('div', { class: 'mt8' }, U.alertBox(
          a.level === 'P0' ? 'danger' : (a.level === 'P1' ? 'warn' : 'info'), a.msg)));

        if (mrow) {
          body.appendChild(h('h3', { class: 'sec' }, ['关联指标当前值', h('span', { class: 'tag-ref' }, '9.6.1')]));
          body.appendChild(U.kv([
            ['指标', mrow.metric.name],
            ['当前值', h('b', { class: mrow.status.code === 'CRIT' ? 'neg' : '' }, mrow.metric.fmt(mrow.value))],
            ['阈值', mrow.metric.fmt(mrow.metric.crit)],
            ['状态', stBadge(mrow.status)]
          ], 'kv-2col'));
          body.appendChild(U.alertBox(mrow.status.code === 'CRIT' ? 'danger' : 'ok',
            mrow.status.code === 'CRIT'
              ? '<b>指标仍在阈值之上，不得以「已修复」关闭</b> —— 先把指标压回去，或明确判定为误报并说明理由。'
              : '指标已回落至阈值内，可以关闭（系统扫描时也会自动关闭）。'));
        }

        if (a.link) {
          body.appendChild(h('div', { class: 'btn-row mt8' }, [
            h('button', { class: 'btn btn-sm', onclick: function () { U.closeModal(); U.goto(a.link.replace(/^#/, '')); } },
              '跳转到问题现场')
          ]));
        }

        var opBox = h('div', { class: 'mt14' });
        body.appendChild(opBox);
        drawOps();

        function drawOps() {
          opBox.innerHTML = '';
          if (a.closed) {
            var act = Data.ALERT_ACTIONS.filter(function (x) { return x.code === a.close_action; })[0] || {};
            opBox.appendChild(U.alertBox('ok', '<b>已关闭（' + (act.name || '') + '）</b>：' +
              Core.esc(a.close_note) + '　关闭人 ' + a.close_by + '　' + a.close_time));
            var rr = h('input', { type: 'text', placeholder: '重新打开的原因', style: 'min-width:280px' });
            opBox.appendChild(h('div', { class: 'inline-form mt8' }, [
              U.field('原因', rr),
              h('button', {
                class: 'btn btn-danger', disabled: !Store.can('alert.close'),
                onclick: function () {
                  var r = Store.Actions.reopenAlert(a.id, rr.value.trim());
                  if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
                  UI.toast('已重新打开', 'warn'); drawOps(); drawList(); App.rerender();
                }
              }, '重新打开')
            ]));
            return;
          }

          var action = 'FIXED';
          var note = h('textarea', { rows: '2', style: 'width:100%',
            placeholder: '处理说明（必填，不少于 4 个字）——写清做了什么、为什么可以关' });
          opBox.appendChild(h('h3', { class: 'sec' }, ['关闭告警', h('span', { class: 'tag-ref' }, '9.6.2')]));
          opBox.appendChild(h('div', { class: 'inline-form' }, [
            U.field('处理方式', U.selectEl(Data.ALERT_ACTIONS.map(function (x) {
              return { value: x.code, label: x.name + '　—　' + x.desc.replace(/<[^>]+>/g, '') };
            }), action, function (v) { action = v; }))
          ]));
          opBox.appendChild(h('div', { class: 'mt8' }, U.field('处理说明', note)));
          if (a.level === 'P0') {
            opBox.appendChild(U.alertBox('danger',
              '<b>P0 是资损级告警</b>：只能以「已修复」或「误报」关闭，不接受「暂不处理」，也不参与批量关闭。'));
          }
          opBox.appendChild(h('div', { class: 'btn-row mt8' }, [
            h('button', {
              class: 'btn btn-primary', disabled: !Store.can('alert.close'),
              onclick: function () {
                var r = Store.Actions.closeAlert(a.id, action, note.value);
                if (!r.ok) { UI.toast(r.msg.replace(/<[^>]+>/g, ''), 'danger'); return; }
                U.closeModal(); UI.toast('告警已关闭', 'ok', a.id); App.rerender();
              }
            }, '关闭告警')
          ]));
        }

        if (a.logs && a.logs.length) {
          body.appendChild(h('h3', { class: 'sec' }, ['告警留痕', h('span', { class: 'tag-ref' }, '14.5')]));
          body.appendChild(U.table([
            { label: '时间', render: function (l) { return l.time; }, width: '135px' },
            { label: '操作方', render: function (l) { return l.actor; }, width: '110px' },
            { label: '动作', render: function (l) { return l.action; }, width: '130px' },
            { label: '说明', render: function (l) { return h('span', { class: 'faint' }, String(l.detail).replace(/<[^>]+>/g, '')); } }
          ], a.logs, { compact: true }));
        }

        U.modal('告警 ' + a.id, body,
          [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'wide' });
      }
    }
  });
})();
