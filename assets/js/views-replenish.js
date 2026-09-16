/* =============================================================================
 * views-replenish.js —— 模块③ 计费引擎 · 事件完整性核对与回补（PRD 12.1.5 / 10.2）
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  UI.route('replenish', {
    title: '事件核对与回补', crumbs: ['模块③', '计费引擎', '事件核对与回补'],
    render: function (root, params) {
      var S = Store.get();
      var from = params.from || '2026-04-01';
      var to = params.to || '2026-04-30';
      var pn = params.p || '';

      root.appendChild(U.pageHead('事件完整性核对与回补',
        '上游漏推一条放款事件，本期就少收一笔钱 —— 而这种少收<b>不会自己暴露</b>：' +
        '账单照样出、勾稽照样平，因为系统压根不知道那条事件存在过。' +
        '唯一的发现方式是<b>与上游按日核对事件笔数</b>，差异即拉取回补。' +
        '<b>不允许带着缺口进入计费</b>（10.2）。'));
      root.appendChild(ViewsCharge.subnav('replenish'));

      var sum = Store.Actions.eventGapSummary(from, to, pn || undefined);

      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('核对区间', from.slice(5) + ' ~ ' + to.slice(5), '按日 × 资金方 × 事件类型'),
        U.stat('存在缺口的日期', String(sum.gapDays), sum.gapDays ? '需回补' : '无缺口',
          sum.gapDays ? 'danger' : 'ok'),
        U.stat('缺失事件笔数', String(sum.gapCount), sum.gapCount ? '上游有、我方无' : '双方一致',
          sum.gapCount ? 'danger' : 'ok'),
        U.stat('涉及资金方', String(sum.partners.length),
          sum.partners.map(function (p) { return (S.partnerMap[p] || {}).partner_short_name; }).join('、') || '—')
      ]));

      /* ---------- 核对条件 ---------- */
      var fromI = h('input', { type: 'date', value: from });
      var toI = h('input', { type: 'date', value: to });
      var pSel = U.selectEl([{ value: '', label: '全部资金方' }].concat(
        S.partners.filter(function (p) { return p.status === 'ACTIVE'; }).map(function (p) {
          return { value: p.partner_no, label: p.partner_short_name };
        })), pn, function (v) { pn = v; });
      root.appendChild(U.card('与上游核对事件笔数', h('div', null, [
        U.alertBox('info', '核对口径：<b>日期 × 资金方 × 事件类型</b> 三维分组比对笔数。' +
          '上游多于我方即为缺口；我方多于上游意味着重复投递，已在事件网关被幂等拦截。'),
        h('div', { class: 'inline-form' }, [
          U.field('起', fromI), U.field('止', toI), U.field('资金方', pSel),
          h('button', {
            class: 'btn btn-primary', onclick: function () {
              U.goto('/replenish?from=' + fromI.value + '&to=' + toI.value + (pn ? '&p=' + pn : ''));
            }
          }, '执行核对')
        ])
      ]), { ref: '10.2' }));

      /* ---------- 缺口明细 ---------- */
      if (sum.rows.length) {
        root.appendChild(U.card('核对结果 · 存在缺口', h('div', null, [
          U.alertBox('danger', '发现 <b>' + sum.gapCount + '</b> 条事件上游已产生但本系统未收到，分布在 <b>' +
            sum.gapDays + '</b> 天。这些事件如果不回补，本期账单会<b>少收</b>，且账单与勾稽都不会报错。'),
          U.table([
            { label: '业务日期', render: function (r) { return r.date; }, width: '110px' },
            { label: '资金方', render: function (r) { return (S.partnerMap[r.partner_no] || {}).partner_short_name; } },
            { label: '事件类型', render: function (r) {
              var d = Data.EVENT_DICT.filter(function (e) { return e.code === r.event_code; })[0];
              return h('div', null, [h('div', null, d ? d.name : r.event_code),
                h('div', { class: 'faint', style: 'font-size:11px' }, d ? d.src : '')]);
            } },
            { label: '上游笔数', num: true, render: function (r) { return r.upstream; } },
            { label: '我方笔数', num: true, render: function (r) { return r.ours; } },
            { label: '缺口', num: true, render: function (r) { return h('span', { class: 'neg' }, '−' + r.gap); }, width: '80px' }
          ], sum.rows, { compact: true })
        ]), { ref: '12.1.5' }));
      } else {
        root.appendChild(U.card('核对结果', U.alertBox('ok',
          '区间内上游与我方事件笔数<b>逐日逐类一致</b>，无缺口。'), { tight: true, ref: '10.2' }));
      }

      /* ---------- 回补 ---------- */
      var scope = { from: from, to: to, partner_no: pn || '', event_code: '' };
      var evSel = U.selectEl([{ value: '', label: '全部事件类型' }].concat(
        Replenish.REPLENISH_EVENTS.map(function (e) {
          return { value: e.code, label: e.name + '（' + e.src + '）' };
        })), '', function (v) { scope.event_code = v; });
      var preview = Replenish.pull(S, scope);

      root.appendChild(U.card('拉取回补', h('div', null, [
        h('div', { class: 'code mb8' },
          'POST /events/replenish\n' +
          '{ "event_code": "' + (scope.event_code || '*') + '",\n' +
          '  "date_range": { "from": "' + from + '", "to": "' + to + '" },\n' +
          '  "partner_no": "' + (pn || '*') + '" }\n\n' +
          '→ 本系统主动调用上游查询接口拉取该范围全部事件，与已有事件比对，补齐缺失。\n' +
          '→ 已存在的事件由幂等拦截，安全可重复执行。'),
        U.kv([
          ['将拉取', preview.pulled + ' 条（该范围上游全量）'],
          ['其中已存在', preview.duplicated + ' 条 —— 幂等拦截，不重复计费'],
          ['将补齐', h('b', { class: preview.replenished ? 'neg' : '' }, preview.replenished + ' 条')]
        ], 'kv-2col'),
        h('div', { class: 'inline-form mt8' }, [
          U.field('事件类型', evSel),
          h('button', {
            class: 'btn btn-primary', disabled: !Store.can('event.replay'),
            onclick: function () {
              var r = Store.Actions.replenishEvents(scope);
              if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
              var x = r.result;
              UI.toast('拉取 ' + x.pulled + ' 条，幂等拦截 ' + x.duplicated + ' 条，补齐 ' + x.replenished +
                ' 条，新增流水 ' + (r.flows ? r.flows.length : 0) + ' 条',
                x.replenished ? 'ok' : '', '回补完成');
              App.rerender();
            }
          }, '执行回补'),
          h('button', { class: 'btn', onclick: function () { U.goto('/events?replenished=1'); } }, '查看已回补事件')
        ]),
        U.alertBox('warn', '<b>回补是幂等的，所以它可以被反复执行。</b>' +
          '这不是实现上的巧合 —— 事件网关按 <code>event_id</code> 做唯一约束，' +
          '重复投递一律 <code>IGNORED·DUPLICATE</code>。正因为重复执行零风险，' +
          '回补才敢做成「有疑就拉一次」而不是「先查清楚再小心翼翼地补」。')
      ]), { ref: '12.1.5' }));

      /* ---------- 已回补事件 ---------- */
      var done = S.events.filter(function (e) { return e.replenished; });
      if (done.length) {
        root.appendChild(U.card('已回补事件（' + done.length + ' 条）', U.pagedTable([
          { label: '事件 ID', render: function (e) { return h('span', { class: 'mono', style: 'font-size:11px' }, e.event_id); } },
          { label: '事件类型', render: function (e) {
            var d = Data.EVENT_DICT.filter(function (x) { return x.code === e.event_code; })[0];
            return d ? d.name : e.event_code;
          } },
          { label: '资金方', render: function (e) { return (S.partnerMap[e.partner_no] || {}).partner_short_name; } },
          { label: '业务主键', render: function (e) { return h('span', { class: 'mono' }, e.biz_key); } },
          { label: '发生日', render: function (e) { return e.occur_date; }, width: '100px' },
          { label: '回补时间', render: function (e) { return (e.replenish_time || '').slice(0, 16); }, width: '135px' },
          { label: '处理结果', render: function (e) { return U.statusBadge(e.status); }, width: '100px' },
          { label: '产生流水', num: true, render: function (e) {
            return (S.eng.flowsByEvent[e.event_id] || []).length;
          }, width: '80px' }
        ], done, { compact: true, pageSize: 10 }), { ref: '12.1.5' }));
      }

      /* ---------- 事件类异常兜底策略 ---------- */
      root.appendChild(U.card('事件类异常与兜底策略', U.table([
        { label: '场景', key: 'k', width: '190px' },
        { label: '系统行为', render: function (r) { return h('span', { html: r.v }); } },
        { label: '人工动作', key: 'a', width: '150px' }
      ], [
        { k: '事件缺失（上游漏推）', v: '每日事件笔数核对发现 → 告警', a: '触发回补拉取' },
        { k: '事件重复投递', v: '幂等拦截，<code>IGNORED·DUPLICATE</code>', a: '无' },
        { k: '事件乱序（冲正先到）', v: '进 <code>PENDING_ORIGIN</code> 队列，24h 超时告警', a: '超时后人工核查' },
        { k: '事件迟到（跨已封账账期）', v: '正常计费，标 <code>is_cross_period=1</code>，入下期调整项', a: '确认调整项' },
        { k: '事件字段缺失', v: '校验失败 → <code>FAILED</code> + 告警，进待处理队列', a: '联系上游补数' },
        { k: '上游更正已推事件', v: '<b>拒绝更新</b>；要求投递反向事件 + 新事件', a: '协调上游' }
      ], { compact: true }), { tight: true, ref: '10.7.1' }));
    }
  });
})();
