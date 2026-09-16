/* =============================================================================
 * views-recon.js —— 模块⑥ 对账中心：五级勾稽看板、差异工作台、外部对账、全链路追溯
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  function subnav(active) {
    var items = [['recon', '对账概览'], ['tieout', '五级勾稽看板'], ['diffs', '差异工作台'],
      ['external', '外部对账'], ['trace', '全链路追溯']];
    return h('div', { class: 'btn-row', style: 'margin-bottom:14px' }, items.map(function (i) {
      return h('button', { class: 'btn btn-sm' + (i[0] === active ? ' btn-primary' : ''), onclick: function () { U.goto('/' + i[0]); } }, i[1]);
    }));
  }

  /* =========================== 对账概览 =========================== */
  UI.route('recon', {
    title: '对账中心', crumbs: ['模块⑥', '对账中心'],
    render: function (root) {
      var S = Store.get();
      root.appendChild(U.pageHead('对账中心',
        '保证每一层之间不差一分钱。核心思想：每一级都是上一级的加工结果，因此每一级之间都存在可以用等式表达的确定关系。<b>把差错的发现从「靠人看」变成「靠等式算」。</b>'));
      root.appendChild(subnav('recon'));

      root.appendChild(h('div', { class: 'flowchain' }, [
        h('span', { class: 'fnode' }, '① 业务事件 biz_event'), h('span', { class: 'farrow' }, '→'),
        h('span', { class: 'fnode' }, '② 费用流水 fee_flow'), h('span', { class: 'farrow' }, '→'),
        h('span', { class: 'fnode' }, '③ 账单 bill'), h('span', { class: 'farrow' }, '→'),
        h('span', { class: 'fnode' }, '④ 结算流水 settle_flow'), h('span', { class: 'farrow' }, '→'),
        h('span', { class: 'fnode' }, '⑤ 银行回单 bank_receipt')
      ]));

      Data.PERIODS.forEach(function (p) {
        var r = S.reconRuns[p];
        root.appendChild(U.card('账期 ' + p + ' 勾稽状态', h('div', null, [
          r ? h('div', { class: 'grid g4' }, [
            U.stat('勾稽结论', r.pass ? '全部通过' : r.failCount + ' 项不平', '', r.pass ? 'ok' : 'danger'),
            U.stat('事件 / 流水', M.fmt(r.stats.events, 0) + ' / ' + M.fmt(r.stats.flows, 0)),
            U.stat('账单 / 结算单', r.stats.bills + ' / ' + r.stats.orders),
            U.stat('回单', r.stats.receipts)
          ]) : U.alertBox('info', '该账期尚未执行勾稽。'),
          h('div', { class: 'btn-row mt8' }, [
            h('button', { class: 'btn btn-primary', onclick: function () { Store.Actions.runTieOut(p); UI.toast('五级勾稽执行完成', 'ok'); U.goto('/tieout?period=' + p); } }, '执行五级勾稽'),
            h('button', { class: 'btn', onclick: function () { U.goto('/tieout?period=' + p); } }, '查看看板')
          ])
        ])));
      });

      root.appendChild(U.card('状态一致性校验 S-01 ~ S-08', U.checklist(Billing.stateChecks(S).map(function (c) {
        return { code: c.code, ok: c.ok, level: 'BLOCK', desc: c.desc, msg: c.msg };
      })), { tight: true, ref: '9.2.2' }));

      root.appendChild(U.card('资损监控指标', U.table([
        { label: '指标', key: 'k' }, { label: '当前值', key: 'v', num: true },
        { label: '目标', key: 't', width: '90px' }, { label: '告警阈值', key: 'a', width: '130px' }
      ], (function () {
        var openDiffs = S.diffs.filter(function (d) { return d.status !== 'CLOSED'; });
        var rev = M.sum(S.eng.feeFlows.filter(function (f) { return f.flow_type === 'REVERSAL'; }), function (f) { return Math.abs(f.fee_amount); });
        var gross = M.sum(S.eng.feeFlows.filter(function (f) { return f.fee_amount > 0; }), function (f) { return f.fee_amount; });
        var r3 = S.reconRuns['2026-03'];
        return [
          { k: '勾稽不平笔数', v: r3 ? r3.failCount : 0, t: '0', a: '> 0 即 P1' },
          { k: '事件积压数', v: S.events.filter(function (e) { return e.status === 'PENDING'; }).length, t: '0', a: '> 100 或超 24h' },
          { k: '快照缺失数', v: 0, t: '0', a: '> 0 即 P0' },
          { k: '冲正率', v: M.pct(gross ? rev / gross : 0, 2), t: '< 2%', a: '> 5%' },
          { k: '重复冲正拦截数', v: 0, t: '0', a: '> 0 即 P0' },
          { k: '未闭环差异', v: openDiffs.length, t: '0', a: '—' },
          { k: '差异老化（>15 天）', v: openDiffs.filter(function (d) { return d.aging_days > 15; }).length, t: '0', a: '> 5' },
          { k: '结算失败率', v: M.pct(S.settleOrders.length ? S.settleOrders.filter(function (o) { return o.status === 'FAILED'; }).length / S.settleOrders.length : 0, 1), t: '< 1%', a: '> 3%' },
          { k: '回单缺失数', v: S.settleFlows.filter(function (f) { return f.status === 'SUCCESS' && !f.receipt_no; }).length, t: '0', a: '> 0 即 P0' },
          { k: '支付状态未知笔数', v: S.settleOrders.filter(function (o) { return o.status === 'UNKNOWN'; }).length, t: '0', a: '> 0 即 P0' }
        ];
      })(), { compact: true }), { tight: true, ref: '9.6.1' }));
    }
  });

  /* =========================== 五级勾稽看板 =========================== */
  UI.route('tieout', {
    title: '五级勾稽看板', crumbs: ['模块⑥', '对账中心', '五级勾稽'],
    render: function (root, params) {
      var S = Store.get();
      var period = params.period || '2026-03';
      var r = S.reconRuns[period] || Store.Actions.runTieOut(period);

      root.appendChild(U.pageHead('五级勾稽看板 · ' + period,
        '每级的平衡等式、容差、告警级别与是否阻断下一环节。<b>强约束：勾稽不平则阻断出账。</b>',
        [
          U.selectEl(Data.PERIODS.map(function (p) { return { value: p, label: p + ' 账期' }; }), period, function (v) { U.goto('/tieout?period=' + v); }),
          h('button', { class: 'btn btn-primary', onclick: function () { Store.Actions.runTieOut(period); UI.toast('已重新执行勾稽', 'ok'); App.rerender(); } }, '重新执行')
        ]));
      root.appendChild(subnav('tieout'));

      root.appendChild(U.alertBox(r.pass ? 'ok' : 'danger',
        r.pass ? '<b>结论：全部通过。</b>共校验 ' + r.levels.reduce(function (a, l) { return a + (l.skipped ? 0 : l.eqs.length); }, 0) + ' 条平衡等式，无不平项。'
          : '<b>结论：存在 ' + r.failCount + ' 项不平</b>，已生成差异单并按级别告警；封账 / 出账 / 结算相应环节被阻断。'));

      r.levels.forEach(function (l) {
        var lvOk = l.skipped || l.eqs.every(function (e) { return e.ok; });
        var box = h('div', { class: 'recon-level' });
        box.appendChild(h('div', { class: 'recon-hd' }, [
          h('span', { class: 'lv' }, l.level),
          h('span', { class: 'nm' }, l.name),
          h('span', { class: 'faint', style: 'font-size:11.5px' }, '校验频率 ' + l.freq + ' ｜ 容差 ' + l.tolerance + ' ｜ ' + l.block),
          h('span', { class: 'res' }, l.skipped ? U.badge('无数据', '') : (lvOk ? U.badge('✓ 通过', 'ok') : U.badge('✕ 不平', 'danger')))
        ]));
        if (l.skipped) {
          box.appendChild(h('div', { class: 'eq-row faint' }, '该账期尚无对应数据（例如未出账 / 未结算），本级暂不参与结论。'));
        } else l.eqs.forEach(function (e) {
          box.appendChild(h('div', { class: 'eq-row' }, [
            h('span', { class: 'eqid ' + (e.ok ? 'pos' : 'neg') }, e.ok ? '✓' : '✕'),
            h('span', { class: 'eqid' }, e.id),
            h('span', { style: 'min-width:110px' }, e.name),
            h('span', { class: 'eqf' }, e.formula),
            h('span', { class: 'eqv' }, (typeof e.left === 'number' && e.left % 1 !== 0 ? M.fmt(e.left) : e.left) + ' ／ ' + (typeof e.right === 'number' && e.right % 1 !== 0 ? M.fmt(e.right) : e.right)),
            h('span', { class: e.ok ? 'faint' : 'neg', style: 'min-width:180px;text-align:right' }, e.detail)
          ]));
        });
        root.appendChild(box);
      });

      root.appendChild(U.card('全局恒等式', h('div', null, [
        h('pre', { class: 'code' },
          'Σ 银行回单金额（截至 T）\n' +
          '  == Σ 已确认账单应结金额（轧差后，截至 T） − 未结算余额\n' +
          '  == Σ 费用流水（含红冲、跨期调整归属后，截至 T） − 未出账部分 − 未结算余额'),
        U.alertBox('info', '这条等式是「<b>每笔结算款可反查至原始业务事件</b>」这一承诺的数学表达。它成立，则资金链路完整；不成立，则一定有环节丢了数据。'),
        U.table([
          { label: '口径', key: 'k' }, { label: '金额', key: 'v', num: true }
        ], (function () {
          var rec = M.sum(S.receipts, function (x) { return x.amount; });
          var conf = M.sum(S.bills.filter(function (b) { return ['CONFIRMED', 'SETTLED', 'ADJUSTED'].indexOf(b.status) >= 0; }), function (b) { return b.total_amount; });
          var flows = M.sum(S.eng.feeFlows, function (f) { return f.fee_amount; });
          return [
            { k: 'Σ 银行回单金额', v: M.fmt(rec) },
            { k: 'Σ 已确认 / 已结算账单应结金额（未轧差口径）', v: M.fmt(conf) },
            { k: 'Σ 全部费用流水（含红冲与找平）', v: M.fmt(flows) },
            { k: '未出账部分（尚未归集到账单的流水）', v: M.fmt(M.sum(S.eng.feeFlows.filter(function (f) { return !f.bill_no; }), function (f) { return f.fee_amount; })) }
          ];
        })(), { compact: true })
      ]), { ref: '9.1.3' }));

      root.appendChild(U.card('平衡等式速查表', U.table([
        { label: '等式', key: 'id', width: '55px' }, { label: '层级', key: 'lv', width: '80px' },
        { label: '表达式', key: 'f' }, { label: '容差', key: 't', width: '55px' }, { label: '阻断', key: 'b', width: '90px' }
      ], [
        { id: 'A', lv: 'L1→L2', f: '事件总数 = 终态事件数（积压为 0）', t: '0', b: '封账' },
        { id: 'B', lv: 'L1→L2', f: '流水关联事件去重数 = 已计费事件数', t: '0', b: '封账' },
        { id: 'C', lv: 'L1→L2', f: '流水基数 = 快照基数（抽样）', t: '0', b: '封账' },
        { id: 'D', lv: 'L2→L3', f: 'Σ 本期未跨期流水 = 账单本期费用', t: '0', b: '出账' },
        { id: 'E', lv: 'L2→L3', f: 'Σ 调整项 = 账单调整项合计', t: '0', b: '出账' },
        { id: 'F', lv: 'L2→L3', f: '账单合计 = 本期 + 调整 + 结转', t: '0', b: '出账' },
        { id: 'G', lv: 'L2→L3', f: '未入账单流水数 = 0', t: '0', b: '出账' },
        { id: 'H', lv: 'L2→L3', f: '含税 = 不含税 + 税额', t: '0', b: '出账' },
        { id: 'I', lv: 'L3→L4', f: 'Σ 账单金额 = 结算金额（非轧差）', t: '0', b: '结算' },
        { id: 'J', lv: 'L3→L4', f: 'Σ应收 − Σ应付 = 结算净额（轧差）', t: '0', b: '结算' },
        { id: 'K', lv: 'L3→L4', f: 'Σ 付款指令金额 = 结算单金额', t: '0', b: '结算' },
        { id: 'L', lv: 'L3→L4', f: '已确认且到期未结算账单数 = 0', t: '0', b: '告警' },
        { id: 'M', lv: 'L4→L5', f: 'Σ 成功结算金额 = Σ 回单金额', t: '0', b: '告警 P0' },
        { id: 'N', lv: 'L4→L5', f: '成功结算无回单数 = 0', t: '0', b: '告警 P0' }
      ], { compact: true }), { tight: true, ref: '18.7' }));
    }
  });

  /* =========================== 差异工作台 =========================== */
  UI.route('diffs', {
    title: '差异工作台', crumbs: ['模块⑥', '对账中心', '差异工作台'],
    render: function (root) {
      var S = Store.get();
      root.appendChild(U.pageHead('差异工作台',
        '外部争议与内部勾稽差异使用<b>同一套差异单模型与处理流程</b>，用 diff_source 区分即可，避免两套工作台、两套统计口径。'));
      root.appendChild(subnav('diffs'));

      var open = S.diffs.filter(function (d) { return d.status !== 'CLOSED'; });
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('差异单总数', S.diffs.length),
        U.stat('未闭环', open.length, '按金额 × 老化排序', open.length ? 'warn' : 'ok'),
        U.stat('差异金额', M.fmt(M.sum(open, function (d) { return Math.abs(d.diff_amount); }))),
        U.stat('老化 > 15 天', open.filter(function (d) { return d.aging_days > 15; }).length, '进入月度经营复盘', open.filter(function (d) { return d.aging_days > 15; }).length ? 'danger' : 'ok')
      ]));

      root.appendChild(U.card('差异单列表', U.table([
        { label: '差异单号', render: function (d) { return h('span', { class: 'mono' }, d.diff_no); } },
        { label: '来源', render: function (d) { return U.badge(d.diff_source === 'EXTERNAL' ? '外部对账' : '内部勾稽', 'info'); }, width: '85px' },
        { label: '资金方', render: function (d) { return (S.partnerMap[d.partner_no] || {}).partner_short_name; } },
        { label: '类型', render: function (d) { return ({ AMOUNT_DIFF: '金额不符', OURS_EXTRA: '己方多', THEIRS_EXTRA: '对方多', TIMING_DIFF: '时间差', STATUS_DIFF: '状态差' })[d.diff_type] || d.diff_type; } },
        { label: '我方', num: true, render: function (d) { return M.fmt(d.our_amount); } },
        { label: '对方', num: true, render: function (d) { return M.fmt(d.their_amount); } },
        { label: '差额', num: true, render: function (d) { return U.money(d.diff_amount, { signed: true }); } },
        { label: '老化', num: true, render: function (d) { return h('span', { class: d.aging_days > 15 ? 'neg' : '' }, d.aging_days + ' 天'); }, width: '70px' },
        { label: '状态', render: function (d) { return U.statusBadge(d.status); }, width: '90px' },
        { label: '', width: '80px', render: function (d) { return h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); showDiff(d); } }, '核查'); } }
      ], S.diffs, { onRow: showDiff, empty: '暂无差异单' }), { tight: true, ref: '9.4' }));

      root.appendChild(h('div', { class: 'grid g2' }, [
        U.card('容差与自动核销', U.table([
          { label: '差异金额', key: 'k' }, { label: '处理', key: 'v' }
        ], [
          { k: '≤ 0.05 元（舍入误差范围）', v: '自动核销，记录但不生成差异单；累计统计，月度超过 100 元触发口径复核' },
          { k: '> 0.05 元', v: '生成差异单，进入人工处理' }
        ], { compact: true }), { tight: true, ref: '9.3.4' }),
        U.card('SLA 与老化管理', U.table([
          { label: '差异金额', key: 'k' }, { label: '处理时限', key: 't' }, { label: '超时升级', key: 'u' }
        ], [
          { k: '< 100 元', t: 'T+5', u: '提醒' },
          { k: '100 ~ 10,000 元', t: 'T+3', u: 'T+3 升级财务负责人' },
          { k: '> 10,000 元', t: 'T+1', u: 'T+1 升级财务负责人 + 风控' },
          { k: 'P0 类（回单缺失、重复付款）', t: '当日', u: '立即升级' }
        ], { compact: true }), { tight: true, ref: '9.4.3' })
      ]));

      function showDiff(d) {
        var a = d.auto_analysis || {};
        var body = h('div');
        body.appendChild(U.kv([
          ['差异单号', h('span', { class: 'mono' }, d.diff_no)],
          ['来源 / 类型', (d.diff_source === 'EXTERNAL' ? '外部对账' : '内部勾稽') + ' / ' + d.diff_type],
          ['资金方', (S.partnerMap[d.partner_no] || {}).partner_short_name],
          ['计费对象', h('span', { class: 'mono' }, d.biz_key)],
          ['费用流水', d.fee_flow_no ? h('span', { class: 'mono' }, d.fee_flow_no) : '—'],
          ['账单', d.bill_no ? U.link(d.bill_no, '/bill/' + d.bill_no, 'mono') : '—'],
          ['我方 / 对方 / 差额', M.fmt(d.our_amount) + ' / ' + M.fmt(d.their_amount) + ' / ' + M.fmtSigned(d.diff_amount)],
          ['状态 / 定责', U.statusBadge(d.status)],
          ['创建 / 老化', d.create_time + ' · ' + d.aging_days + ' 天']
        ], 'kv-2col'));
        body.appendChild(h('h3', { class: 'sec' }, ['自动定位分析（核查包）', h('span', { class: 'tag-ref' }, '9.3.5')]));
        body.appendChild(h('div', { class: 'checklist' }, (a.steps || []).map(function (s) {
          return h('div', { class: 'check-row ' + (s.ok ? 'pass' : 'fail') }, [
            h('div', { class: 'st' }, s.ok ? '✓' : '✕'),
            h('div', { class: 'msg' }, s.text)
          ]);
        })));
        body.appendChild(h('div', { class: 'mt8' }, U.kv([
          ['疑似原因', h('b', null, a.suspect || '—')],
          ['关联证据', a.evidence || '—'],
          ['处理建议', a.advice || '—']
        ])));
        var footer = [];
        if (d.status !== 'CLOSED') footer.push(h('button', {
          class: 'btn btn-primary', disabled: !Store.can('diff.handle'),
          onclick: function () { Store.Actions.closeDiff(d.diff_no, '维持我方口径，已出具说明材料', 'THEIRS'); U.closeModal(); UI.toast('差异已闭环', 'ok'); App.rerender(); }
        }, '维持我方口径并闭环'));
        if (d.status !== 'CLOSED') footer.push(h('button', {
          class: 'btn', disabled: !Store.can('diff.handle'),
          onclick: function () {
            Store.Actions.addAdjustment({
              partner_no: d.partner_no, agreement_no: (S.billMap[d.bill_no] || {}).agreement_no || '',
              direction: 'RECEIVABLE', settle_in_period: '2026-04', source_type: 'RECON_ADJUST',
              origin_period: '2026-03', origin_ref: d.diff_no, amount: -Math.abs(d.diff_amount),
              reason: '对账差异处理结论（差异单 ' + d.diff_no + '）'
            });
            Store.Actions.closeDiff(d.diff_no, '己方调整，差额计入下期调整项', 'OURS');
            U.closeModal(); UI.toast('已生成调整项并闭环', 'ok'); App.rerender();
          }
        }, '己方调整（生成下期调整项）'));
        footer.push(h('button', { class: 'btn', onclick: U.closeModal }, '关闭'));
        U.modal('差异核查 ' + d.diff_no, body, footer, { size: 'wide' });
      }
    }
  });

  /* =========================== 全链路追溯 =========================== */
  UI.route('trace', {
    title: '全链路追溯', crumbs: ['横向支撑', '全链路追溯'],
    render: function (root, params) {
      var S = Store.get();
      var q = params.q || (S.receipts[0] ? S.receipts[0].receipt_no : '');
      var input = h('input', { type: 'text', value: q, placeholder: '回单号 / 结算单号 / 账单号 / 费用流水号 / 借据号 / 事件 ID', style: 'min-width:420px' });
      var out = h('div', { class: 'mt14' });

      root.appendChild(U.pageHead('全链路追溯',
        '<b>反向追溯</b>：从一笔银行回单，逐笔反查到构成它的每一条原始业务事件。<b>正向追溯</b>：从一笔放款，查到它产生了哪些费用、进了哪张账单、哪天结的款。'));
      root.appendChild(subnav('trace'));

      root.appendChild(U.card('追溯查询', h('div', null, [
        h('div', { class: 'inline-form' }, [
          U.field('单号', input),
          h('button', { class: 'btn btn-primary', onclick: function () { U.goto('/trace?q=' + encodeURIComponent(input.value.trim())); } }, '追溯'),
          h('button', { class: 'btn', onclick: function () { U.goto('/trace?q=' + (S.receipts[0] ? S.receipts[0].receipt_no : '')); } }, '示例：银行回单'),
          h('button', { class: 'btn', onclick: function () { var l = S.loans.filter(function (x) { return x.partner_no === 'P000012'; })[0]; U.goto('/trace?q=' + (l ? l.loan_no : '')); } }, '示例：借据正向追溯')
        ]),
        U.alertBox('info', '追溯能力依赖三个设计前提，缺一不可：<b>费用流水三向引用</b>（6.10.2）、<b>基数快照固化</b>（6.3.3）、<b>Append-Only + 红冲</b>（6.7.2）。')
      ])));
      root.appendChild(out);

      if (q) {
        var tree = Billing.buildTrace(S, q);
        if (!tree) out.appendChild(U.alertBox('warn', '未找到单号 <b>' + Core.esc(q) + '</b> 对应的记录。可尝试：回单号（RCP…）、结算单号（ST…）、账单号（BL…）、流水号（FF…）、借据号（L…）或事件 ID。'));
        else {
          out.appendChild(U.card('追溯树 · ' + tree.type + ' ' + tree.no, h('div', { class: 'tree' }, U.traceTree(tree)), {
            ref: '9.5', actions: [h('button', {
              class: 'btn btn-sm', onclick: function () { UI.toast('追溯报告导出为 Excel 多 Sheet（每层一个 Sheet），审计可直接取用', 'ok', '导出'); }
            }, '导出追溯报告')]
          }));
        }
      }
    }
  });
  window.ViewsRecon = { subnav: subnav };
})();
