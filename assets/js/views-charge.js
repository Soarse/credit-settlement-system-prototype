/* =============================================================================
 * views-charge.js —— 模块③ 计费引擎：概览、事件中心、费用流水、冲正、范围重算
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  function subnav(active) {
    var items = [['charge', '引擎概览'], ['daily', '日度核算调度'], ['events', '事件中心'],
      ['flows', '费用流水'], ['replenish', '事件核对与回补'], ['reversal', '冲正工作台'], ['recalc', '范围重算']];
    return h('div', { class: 'btn-row', style: 'margin-bottom:14px' }, items.map(function (i) {
      return h('button', { class: 'btn btn-sm' + (i[0] === active ? ' btn-primary' : ''), onclick: function () { U.goto('/' + i[0]); } }, i[1]);
    }));
  }

  /* ---------------- 流水详情弹窗（三向引用 + 验算）---------------- */
  function showFlow(f) {
    var S = Store.get();
    var ev = S.eventMap[f.event_id];
    var snap = S.eng.snapshots.filter(function (s) { return s.snapshot_no === f.basis_snapshot_no; })[0];
    var body = h('div');
    body.appendChild(U.kv([
      ['流水号', h('span', { class: 'mono' }, f.fee_flow_no)],
      ['流水类型', U.badge(({ NORMAL: '正常', REVERSAL: '红冲', TIER_TRUEUP: '阶梯找平', FLOOR_ADJUST: '保底调整', CAP_ADJUST: '封顶调整', RECALC_REVERSAL: '重算红冲', RECALC_NEW: '重算补记' })[f.flow_type] || f.flow_type,
        f.flow_type === 'NORMAL' ? 'ok' : (f.flow_type === 'REVERSAL' || f.flow_type === 'RECALC_REVERSAL' ? 'danger' : 'purple'))],
      ['资金方', (S.partnerMap[f.partner_no] || {}).partner_short_name + ' / ' + f.partner_no],
      ['计费项', f.charge_item_no + ' ' + f.charge_item_name + '（' + f.charge_item_code + '）'],
      ['计费对象', f.charge_object_level + ' / ' + f.charge_object_id],
      ['收付方向', U.dirBadge(f.direction)],
      ['费用归属日', f.fee_date], ['归属账期', f.billing_period],
      ['跨期标记', f.is_cross_period ? U.badge('是（来源账期 ' + f.origin_period + '）', 'warn') : '否'],
      ['入账单', f.bill_no ? U.link(f.bill_no, '/bill/' + f.bill_no, 'mono') : '未入账单'],
      ['币种', f.currency]
    ], 'kv-2col'));

    body.appendChild(h('h3', { class: 'sec' }, ['金额与价税分离', h('span', { class: 'tag-ref' }, 'D-08 / 6.4.9')]));
    body.appendChild(U.table([
      { label: '基数金额', num: true, render: function () { return M.fmt(f.basis_amount); } },
      { label: '含税费用', num: true, render: function () { return h('b', { class: f.fee_amount < 0 ? 'neg' : '' }, M.fmt(f.fee_amount)); } },
      { label: '不含税', num: true, render: function () { return M.fmt(f.fee_amount_ex_tax); } },
      { label: '税额', num: true, render: function () { return M.fmt(f.tax_amount); } },
      { label: '税率', num: true, render: function () { return M.pct(f.tax_rate, 0); } },
      { label: '恒等校验', render: function () { return M.r2(f.fee_amount_ex_tax + f.tax_amount) === M.r2(f.fee_amount) ? U.badge('✓ 三段恒等', 'ok') : U.badge('✗', 'danger'); } }
    ], [f], { compact: true }));

    if (f.calc_detail) {
      body.appendChild(h('h3', { class: 'sec' }, '验算过程'));
      var d = f.calc_detail;
      var lines = [d.formula, d.expr ? '  = ' + d.expr : ''];
      if (d.accumBefore !== undefined) {
        lines.push('');
        lines.push('阶梯增量法：');
        lines.push('  累计前基数  ' + M.fmt(d.accumBefore));
        lines.push('  累计后基数  ' + M.fmt(d.accumAfter));
        lines.push('  TierCalc(前) ' + M.fmt(d.calcBefore));
        lines.push('  TierCalc(后) ' + M.fmt(d.calcAfter));
        lines.push('  本笔费用    ' + M.fmt(f.fee_amount));
      }
      if (d.dailyRate) { lines.push(''); lines.push('日费率 = ' + (d.dailyRate * 100).toFixed(6) + '%（年化 ÷ 基准，D-05）'); }
      if (d.accumFinal !== undefined) {
        lines.push(''); lines.push('期末找平：');
        lines.push('  期末累计基数     ' + M.fmt(d.accumFinal));
        lines.push('  应计费合计       ' + M.fmt(d.shouldTotal));
        lines.push('  已计费合计       ' + M.fmt(d.chargedTotal));
        lines.push('  找平金额         ' + M.fmtSigned(f.fee_amount));
      }
      lines.push(''); lines.push('价税分离（倒轧）：');
      lines.push('  不含税 = ' + M.fmt(f.fee_amount) + ' ÷ (1 + ' + f.tax_rate + ') = ' + M.fmt(f.fee_amount_ex_tax));
      lines.push('  税额   = ' + M.fmt(f.fee_amount) + ' − ' + M.fmt(f.fee_amount_ex_tax) + ' = ' + M.fmt(f.tax_amount));
      body.appendChild(h('pre', { class: 'code' }, lines.join('\n')));
    }

    body.appendChild(h('h3', { class: 'sec' }, ['三向引用（可复算、可追溯的完整证据链）', h('span', { class: 'tag-ref' }, '6.10.2')]));
    body.appendChild(h('div', { class: 'grid g3' }, [
      U.card('① 业务事件', ev ? U.kv([
        ['event_id', h('span', { class: 'mono' }, ev.event_id)],
        ['事件类型', ev.event_code], ['发生时间', ev.occur_time],
        ['接收时间', ev.receive_time], ['业务主键', ev.biz_key], ['状态', U.statusBadge(ev.status)]
      ]) : h('div', { class: 'faint' }, f.event_id.indexOf('PERIOD_CLOSE') === 0 ? '账期结束事件（本系统调度生成）' : '—')),
      U.card('② 规则版本快照', U.kv([
        ['协议 / 版本', h('span', { class: 'mono' }, f.agreement_no + ' · ' + f.rule_version)],
        ['规则编号', h('span', { class: 'mono' }, f.rule_no)],
        ['费率模型', f.rate_snapshot ? f.rate_snapshot.type : '—'],
        ['费率快照', h('span', { class: 'mono', style: 'font-size:11px' }, f.rate_snapshot ? JSON.stringify(
          f.rate_snapshot.ratio !== undefined ? { ratio: f.rate_snapshot.ratio } :
            (f.rate_snapshot.annual_ratio !== undefined ? { annual_ratio: f.rate_snapshot.annual_ratio, basis: f.rate_snapshot.day_count_basis } : { tiers: (f.rate_snapshot.tiers || []).length + ' 档' })) : '—')]
      ])),
      U.card('③ 基数快照', snap ? U.kv([
        ['快照号', h('span', { class: 'mono' }, snap.snapshot_no)],
        ['基数类型', snap.basis_type], ['固化基数', M.fmt(snap.basis_amount)],
        ['来源类型', snap.source_type], ['来源引用', h('span', { class: 'mono', style: 'font-size:11px' }, snap.source_ref)],
        ['出资比例', M.pct(snap.funding_ratio, 0)],
        ['过滤命中', (snap.filter_result.hit || []).join(', ') || '（无过滤条件）']
      ]) : h('div', { class: 'faint' }, '周期性流水无基数快照'))
    ]));

    if (f.original_fee_flow_no) {
      var of = S.eng.flowsByNo[f.original_fee_flow_no];
      body.appendChild(h('h3', { class: 'sec' }, '红冲关系'));
      body.appendChild(U.alertBox('warn', '本流水为红冲流水，指向原流水 <b>' + f.original_fee_flow_no + '</b>（原金额 ' +
        (of ? M.fmt(of.fee_amount) : '—') + '）。冲正原因：' + f.reversal_reason +
        '。<b>绝不 UPDATE / DELETE 原流水</b>，查询时两条流水同时存在，净额为差额。'));
    }
    var revs = S.eng.feeFlows.filter(function (x) { return x.original_fee_flow_no === f.fee_flow_no; });
    if (revs.length) {
      body.appendChild(h('h3', { class: 'sec' }, '本流水被红冲的记录'));
      body.appendChild(U.table([
        { label: '红冲流水号', render: function (x) { return h('span', { class: 'mono' }, x.fee_flow_no); } },
        { label: '日期', key: 'fee_date' }, { label: '原因', key: 'reversal_reason' },
        { label: '金额', num: true, render: function (x) { return U.money(x.fee_amount); } }
      ], revs, { compact: true, foot: [{ value: '累计红冲 ' + M.fmt(M.sum(revs, function (x) { return Math.abs(x.fee_amount); })) + ' ≤ 原流水 ' + M.fmt(Math.abs(f.fee_amount)) }, {}, {}, { num: true, value: M.fmt(M.sum(revs, function (x) { return x.fee_amount; })) }] }));
    }

    U.modal('费用流水 ' + f.fee_flow_no, body, [
      h('button', { class: 'btn', onclick: function () { U.closeModal(); U.goto('/trace?q=' + f.fee_flow_no); } }, '全链路追溯'),
      h('button', { class: 'btn', onclick: U.closeModal }, '关闭')
    ], { size: 'wide' });
  }

  /* =========================================================================
   * 引擎概览
   * ======================================================================= */
  UI.route('charge', {
    title: '计费引擎',
    crumbs: ['模块③', '计费引擎'],
    render: function (root, params) {
      var S = Store.get();
      root.appendChild(U.pageHead('计费引擎',
        '把业务事件按规则算成钱。五要素：<b>触发事件 + 计费对象 + 计费基数 + 费率模型 + 冲正机制</b>；核心表达式 <code>费用金额 = RateModel.apply( Basis.evaluate(ChargeObject, SnapshotTime) )</code>。'));
      root.appendChild(subnav('charge'));

      var evs = S.events;
      var flows = S.eng.feeFlows;
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('业务事件', M.fmt(evs.length, 0), '已计费 ' + evs.filter(function (e) { return e.status === 'CHARGED'; }).length, '', function () { U.goto('/events'); }),
        U.stat('费用流水', M.fmt(flows.length, 0), '含红冲 ' + flows.filter(function (f) { return f.fee_amount < 0; }).length + ' 条', '', function () { U.goto('/flows'); }),
        U.stat('基数快照', M.fmt(S.eng.snapshots.length, 0), '固化基数取值与来源'),
        U.stat('幂等记录', M.fmt(Object.keys(S.eng.idem).length, 0), 'event_id + 计费项 + 规则版本')
      ]));

      root.appendChild(U.card('规则执行主流程', h('pre', { class: 'code' },
        '事件到达\n' +
        '  └─▶ ① 幂等校验 ──重复──▶ IGNORED·DUPLICATE（返回成功）\n' +
        '  └─▶ ② 落库 biz_event\n' +
        '  └─▶ ③ 资金方状态 / 协议解析 ──未找到──▶ IGNORED·NO_AGREEMENT + 告警\n' +
        '  └─▶ ④ 版本路由（按 occur_date）──无生效版本──▶ IGNORED·NO_VERSION + 告警\n' +
        '  └─▶ ⑤ 遍历计费项 → 过滤条件求值 ──不命中──▶ IGNORED·NO_RULE_MATCH\n' +
        '  └─▶ ⑥ 解析计费对象 → 基数取值 ──取不到──▶ FAILED + 待处理队列 + 告警\n' +
        '  └─▶ ⑦ 固化 basis_snapshot\n' +
        '  └─▶ ⑧ 费率模型计算 → 精度处理与价税分离\n' +
        '  └─▶ ⑨ 生成 fee_flow（Append-Only）→ 写幂等表 → 事件置 CHARGED'), { ref: '6.5.1' }));

      root.appendChild(h('div', { class: 'grid g2' }, [
        U.card('兜底原则', h('div', null, [
          U.alertBox('danger', '<b>一律不静默跳过。</b>任何无法完成计费的事件，都必须进入「待处理队列」并在监控看板上可见。运营每日必须清空待处理队列，或对每一条给出明确的忽略理由。'),
          U.table([
            { label: '原因码', render: function (r) { return h('span', { class: 'mono' }, r.c); }, width: '160px' },
            { label: '说明', key: 'd' }, { label: '告警', render: function (r) { return r.a ? U.badge('是', 'danger') : U.badge('否', ''); }, width: '60px' },
            { label: '当前数量', num: true, render: function (r) { return S.events.filter(function (e) { return e.ignore_reason === r.c; }).length; } }
          ], [
            { c: 'DUPLICATE', d: '重复事件，幂等拦截', a: false },
            { c: 'NO_AGREEMENT', d: '找不到对应协议', a: true },
            { c: 'NO_VERSION', d: '协议存在但事件发生日无生效版本', a: true },
            { c: 'NO_RULE_MATCH', d: '有版本但无规则命中（过滤条件排除）', a: false },
            { c: 'PARTNER_SUSPENDED', d: '资金方已暂停合作', a: true },
            { c: 'OUT_OF_SCOPE', d: '产品或渠道不在协议范围内', a: false }
          ], { compact: true })
        ]), { ref: '6.2.4' }),
        U.card('幂等与去重（资损防线一）', h('div', null, [
          h('pre', { class: 'code' }, '幂等键 = event_id + charge_item_no + rule_version'),
          U.table([
            { label: '情形', key: 'k' }, { label: '处理', key: 'v' }
          ], [
            { k: '上游重复投递（相同 event_id）', v: '拦截，标记 IGNORED·DUPLICATE，返回成功' },
            { k: 'MQ 重复消费', v: '同上' },
            { k: '并发消费同一事件', v: '唯一索引冲突，后到者直接返回成功' },
            { k: '部分成功（3 个计费项成功 2 个）', v: '逐计费项幂等，重跑时只补算失败的那个' },
            { k: '重算（规则版本变更）', v: 'rule_version 不同，允许重新计算，走影子表' },
            { k: '快照更正后重算', v: '由重算任务显式清除幂等记录后重跑，并记录清除操作' }
          ], { compact: true })
        ]), { ref: '6.6' })
      ]));

      root.appendChild(U.card('事件字典', U.table([
        { label: '事件编码', render: function (e) { return h('span', { class: 'mono' }, e.code); } },
        { label: '名称', key: 'name' }, { label: '来源', key: 'src', width: '100px' },
        { label: '类别', render: function (e) { return U.badge(({ POINT: '时点', PERIODIC: '时段', CYCLE: '周期', REVERSE: '反向' })[e.kind], e.kind === 'REVERSE' ? 'danger' : 'info'); }, width: '70px' },
        { label: '幂等键构成', render: function (e) { return h('span', { class: 'mono faint' }, e.idem); } },
        { label: '关键字段', render: function (e) { return h('span', { class: 'faint', style: 'font-size:11px' }, e.fields.join(', ')); } },
        { label: '本期事件数', num: true, render: function (e) { return M.fmt(S.events.filter(function (x) { return x.event_code === e.code; }).length, 0); } }
      ], Data.EVENT_DICT, { compact: true }), { tight: true, ref: '6.2.2' }));

      root.appendChild(U.card('降级策略（呼应 13.3）', U.table([
        { label: '场景', key: 'k' }, { label: '降级动作', key: 'a' }, { label: '原则', key: 'p' }
      ], [
        { k: '日度核算超时', a: '延后至次日补算，不阻断实时计费', p: '计费可延迟' },
        { k: '某资金方快照未到', a: '仅阻断该资金方，其余正常', p: '隔离故障域' },
        { k: '规则缓存失效', a: '降级为直接查库，性能下降但不中断', p: '可用性优先' },
        { k: '数据库主库故障', a: '计费暂停，事件在 MQ 中堆积，恢复后重放', p: '宁可不算，不可算错' }
      ], { compact: true }), { tight: true, ref: '6.11.3' }));
      root.appendChild(U.alertBox('danger', '<b>绝不降级的部分：</b>幂等校验、基数快照固化、Append-Only 约束。这三项一旦降级即产生资损风险。'));
    }
  });

  /* =========================================================================
   * 事件中心
   * ======================================================================= */
  UI.route('events', {
    title: '事件中心',
    crumbs: ['模块③', '计费引擎', '事件中心'],
    render: function (root, params) {
      var S = Store.get();
      var f = { code: params.code || '', status: params.status || '', partner: '', kw: '', period: '' };
      var box = h('div');

      root.appendChild(U.pageHead('事件中心 · 待处理队列',
        '事件契约三条硬性要求：<b>event_id 全局唯一且重发不变</b>、<b>occur_time 与推送时间分开</b>、<b>反向业务用独立反向事件表达</b>（PRD 12.1.2）。'));
      root.appendChild(subnav('events'));

      var pend = S.events.filter(function (e) { return ['PENDING', 'PROCESSING', 'FAILED'].indexOf(e.status) >= 0; });
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('事件总数', M.fmt(S.events.length, 0)),
        U.stat('已计费', M.fmt(S.events.filter(function (e) { return e.status === 'CHARGED'; }).length, 0), '', 'ok'),
        U.stat('已忽略', M.fmt(S.events.filter(function (e) { return e.status === 'IGNORED'; }).length, 0), '均有原因码可审计'),
        U.stat('待处理队列', pend.length, pend.length ? '阻断封账，需清空' : '队列已清空', pend.length ? 'danger' : 'ok')
      ]));

      if (pend.length) {
        root.appendChild(h('div', { class: 'mt14' }, U.card('待处理队列', h('div', null, [
          U.alertBox('warn', '存在 <b>' + pend.length + '</b> 条未达终态事件。运营每日必须清空待处理队列，或对每一条给出明确的忽略理由；否则 <b>V-B03 将阻断出账</b>。'),
          U.table([
            { label: '事件 ID', render: function (e) { return h('span', { class: 'mono' }, e.event_id); } },
            { label: '类型', key: 'event_code' }, { label: '发生日', key: 'occur_date' },
            { label: '资金方', render: function (e) { return (S.partnerMap[e.partner_no] || {}).partner_short_name || e.partner_no; } },
            { label: '业务主键', key: 'biz_key' },
            { label: '状态', render: function (e) { return U.statusBadge(e.status); } },
            { label: '原因', key: 'ignore_reason' }
          ], pend, { compact: true }),
          h('div', { class: 'btn-row mt8' }, [
            h('button', {
              class: 'btn btn-primary', disabled: !Store.can('event.replay'),
              onclick: function () {
                var n = Store.Actions.replayPendingEvents();
                UI.toast('已重跑 ' + n + ' 条事件，结果幂等（与首次成功执行完全一致）', 'ok', '重跑完成');
                App.rerender();
              }
            }, '▶ 重跑待处理事件'),
            h('span', { class: 'faint' }, '整个流程设计为幂等可重入：任何一步失败后重跑，结果与首次成功执行完全一致（6.5.2）。')
          ])
        ]), { ref: '6.5.3' })));
      }

      root.appendChild(h('div', { class: 'filters mt14' }, [
        U.field('事件类型', U.selectEl([{ value: '', label: '全部' }].concat(Data.EVENT_DICT.map(function (e) { return { value: e.code, label: e.name }; })), f.code, function (v) { f.code = v; draw(); })),
        U.field('状态', U.selectEl([{ value: '', label: '全部' }].concat(['CHARGED', 'IGNORED', 'REVERSED', 'PENDING', 'FAILED'].map(function (s) { return { value: s, label: U.statusText(s) }; })), f.status, function (v) { f.status = v; draw(); })),
        U.field('资金方', U.selectEl([{ value: '', label: '全部' }].concat(S.partners.map(function (p) { return { value: p.partner_no, label: p.partner_short_name }; })), '', function (v) { f.partner = v; draw(); })),
        U.field('账期', U.selectEl([{ value: '', label: '全部' }, { value: '2026-03', label: '2026-03' }, { value: '2026-04', label: '2026-04' }, { value: '2026-05', label: '2026-05' }], '', function (v) { f.period = v; draw(); })),
        U.field('业务主键 / 事件 ID', h('input', { type: 'text', placeholder: '借据号或事件号', oninput: function (e) { f.kw = e.target.value; draw(); } }))
      ]));
      root.appendChild(box);

      function draw() {
        box.innerHTML = '';
        var rows = S.events.filter(function (e) {
          return (!f.code || e.event_code === f.code) && (!f.status || e.status === f.status) &&
            (!f.partner || e.partner_no === f.partner) && (!f.period || D.period(e.occur_date) === f.period) &&
            (!f.kw || (e.biz_key + e.event_id).indexOf(f.kw) >= 0);
        });
        box.appendChild(U.card(null, U.pagedTable([
          { label: '事件 ID', render: function (e) { return h('span', { class: 'mono', style: 'font-size:11px' }, e.event_id); } },
          { label: '类型', render: function (e) { return (Data.EVENT_DICT.filter(function (d) { return d.code === e.event_code; })[0] || {}).name || e.event_code; }, width: '110px' },
          { label: '发生日', key: 'occur_date', width: '90px' },
          { label: '接收时间', render: function (e) { return h('span', { class: 'faint', style: 'font-size:11px' }, e.receive_time.replace('T', ' ').slice(0, 16)); } },
          { label: '资金方', render: function (e) { return (S.partnerMap[e.partner_no] || {}).partner_short_name || e.partner_no; }, width: '90px' },
          { label: '业务主键', render: function (e) { return h('span', { class: 'mono' }, e.biz_key); } },
          { label: '金额要素', num: true, render: function (e) {
            var p = e.payload;
            var v = p.disburse_amount || p.principal_balance || ((p.repay_principal || 0) + (p.repay_interest || 0)) || p.reverse_amount || p.refund_amount || 0;
            return M.fmt(v);
          } },
          { label: '状态', render: function (e) { return U.statusBadge(e.status); }, width: '90px' },
          { label: '忽略原因', render: function (e) { return e.ignore_reason ? U.badge(e.ignore_reason, ['NO_AGREEMENT', 'NO_VERSION', 'PARTNER_SUSPENDED'].indexOf(e.ignore_reason) >= 0 ? 'danger' : '') : '—'; } },
          { label: '产生流水', num: true, render: function (e) { return (S.eng.flowsByEvent[e.event_id] || []).length; } }
        ], rows, { compact: true, pageSize: 20, onRow: showEvent })), { tight: true });
      }
      draw();

      function showEvent(e) {
        var flows = (S.eng.flowsByEvent[e.event_id] || []).map(function (n) { return S.eng.flowsByNo[n]; });
        var lg = S.eng.eventLog.filter(function (l) { return l.event_id === e.event_id; })[0];
        var body = h('div');
        body.appendChild(U.kv([
          ['event_id', h('span', { class: 'mono' }, e.event_id)],
          ['本系统登记号', h('span', { class: 'mono' }, e.internal_no)],
          ['事件类型', e.event_code],
          ['occur_time（业务发生时间）', h('b', null, e.occur_time)],
          ['receive_time（接收时间）', e.receive_time],
          ['资金方 / 协议', e.partner_no + ' / ' + e.agreement_no],
          ['产品 / 渠道', e.product_code + ' / ' + e.channel_code],
          ['业务主键', e.biz_key], ['上游数据版本', e.source_version],
          ['状态', U.statusBadge(e.status)], ['忽略原因', e.ignore_reason || '—']
        ], 'kv-2col'));
        body.appendChild(U.alertBox('info', 'occur_time 决定<b>协议版本路由</b>与<b>账期归属</b>；receive_time 仅用于监控延迟与积压。迟到事件按 occur_time 归属，可能触发跨期调整（D-06）。'));
        body.appendChild(h('h3', { class: 'sec' }, 'payload'));
        body.appendChild(h('pre', { class: 'code' }, JSON.stringify(e.payload, null, 2)));
        if (lg) {
          body.appendChild(h('h3', { class: 'sec' }, '引擎处理步骤'));
          body.appendChild(U.table([
            { label: '步骤', key: 'name', width: '150px' },
            { label: '结果', render: function (s) { return U.badge(s.result, s.result === 'OK' || s.result === 'PASS' ? 'ok' : (s.result === 'FAIL' || s.result === 'BLOCK' ? 'danger' : '')); }, width: '80px' },
            { label: '说明', key: 'note' }
          ], lg.steps, { compact: true }));
        }
        if (flows.length) {
          body.appendChild(h('h3', { class: 'sec' }, '产生的费用流水'));
          body.appendChild(U.table([
            { label: '流水号', render: function (x) { return h('span', { class: 'mono' }, x.fee_flow_no); } },
            { label: '计费项', key: 'charge_item_name' },
            { label: '基数', num: true, render: function (x) { return M.fmt(x.basis_amount); } },
            { label: '费用', num: true, render: function (x) { return U.money(x.fee_amount); } },
            { label: '规则版本', key: 'rule_version' },
            { label: '', render: function (x) { return h('button', { class: 'btn btn-sm', onclick: function () { U.closeModal(); showFlow(x); } }, '详情'); } }
          ], flows, { compact: true }));
        }
        U.modal('业务事件 ' + e.event_id, body, [
          h('button', { class: 'btn', onclick: function () { U.closeModal(); U.goto('/trace?q=' + e.event_id); } }, '正向追溯'),
          h('button', { class: 'btn', onclick: U.closeModal }, '关闭')
        ], { size: 'wide' });
      }
    }
  });

  /* =========================================================================
   * 费用流水
   * ======================================================================= */
  UI.route('flows', {
    title: '费用流水',
    crumbs: ['模块③', '计费引擎', '费用流水'],
    render: function (root, params) {
      var S = Store.get();
      var f = { partner: params.partner || '', period: params.period || '', item: '', type: '', kw: params.q || '' };
      var box = h('div');
      root.appendChild(U.pageHead('费用流水 fee_flow',
        '全系统的<b>金额事实源</b>，Append-Only。任何修正都通过生成新的红冲流水实现，绝不 UPDATE 或 DELETE 已有流水。允许更新的字段仅 <code>bill_no</code>（入账单回写）与 <code>recon_status</code>。'));
      root.appendChild(subnav('flows'));
      root.appendChild(h('div', { class: 'filters' }, [
        U.field('资金方', U.selectEl([{ value: '', label: '全部' }].concat(S.partners.map(function (p) { return { value: p.partner_no, label: p.partner_short_name }; })), f.partner, function (v) { f.partner = v; draw(); })),
        U.field('账期', U.selectEl([{ value: '', label: '全部' }, { value: '2026-03', label: '2026-03' }, { value: '2026-04', label: '2026-04' }], f.period, function (v) { f.period = v; draw(); })),
        U.field('费种', U.selectEl([{ value: '', label: '全部' }].concat(Data.CHARGE_ITEM_DICT.map(function (d) { return { value: d.code, label: d.name }; })), '', function (v) { f.item = v; draw(); })),
        U.field('流水类型', U.selectEl([{ value: '', label: '全部' },
          { value: 'NORMAL', label: '正常' }, { value: 'REVERSAL', label: '红冲' },
          { value: 'TIER_TRUEUP', label: '阶梯找平' }, { value: 'FLOOR_ADJUST', label: '保底调整' },
          { value: 'RECALC_REVERSAL', label: '重算红冲' }, { value: 'RECALC_NEW', label: '重算补记' }], '', function (v) { f.type = v; draw(); })),
        U.field('借据号 / 流水号', h('input', { type: 'text', value: f.kw, placeholder: '模糊匹配', oninput: function (e) { f.kw = e.target.value; draw(); } }))
      ]));
      root.appendChild(box);
      function draw() {
        box.innerHTML = '';
        var rows = S.eng.feeFlows.filter(function (x) {
          return (!f.partner || x.partner_no === f.partner) && (!f.period || x.billing_period === f.period) &&
            (!f.item || x.charge_item_code === f.item) && (!f.type || x.flow_type === f.type) &&
            (!f.kw || (x.charge_object_id + x.fee_flow_no).indexOf(f.kw) >= 0);
        });
        var sum = M.sum(rows, function (x) { return x.fee_amount; });
        box.appendChild(h('div', { class: 'grid g4 mb8' }, [
          U.stat('流水笔数', M.fmt(rows.length, 0)),
          U.stat('含税合计', M.fmt(sum), '', sum < 0 ? 'danger' : ''),
          U.stat('不含税合计', M.fmt(M.sum(rows, function (x) { return x.fee_amount_ex_tax; }))),
          U.stat('税额合计', M.fmt(M.sum(rows, function (x) { return x.tax_amount; })))
        ]));
        box.appendChild(U.card(null, U.pagedTable([
          { label: '流水号', render: function (x) { return h('span', { class: 'mono', style: 'font-size:11px' }, x.fee_flow_no); } },
          { label: '归属日', key: 'fee_date', width: '90px' },
          { label: '账期', key: 'billing_period', width: '75px' },
          { label: '资金方', render: function (x) { return (S.partnerMap[x.partner_no] || {}).partner_short_name; }, width: '85px' },
          { label: '计费项', key: 'charge_item_name', width: '110px' },
          { label: '计费对象', render: function (x) { return h('span', { class: 'mono' }, x.charge_object_id); } },
          { label: '基数', num: true, render: function (x) { return M.fmt(x.basis_amount); } },
          { label: '费用(含税)', num: true, render: function (x) { return U.money(x.fee_amount); } },
          { label: '方向', render: function (x) { return U.dirBadge(x.direction); }, width: '60px' },
          { label: '版本', key: 'rule_version', width: '55px' },
          { label: '类型', render: function (x) {
            var m = { NORMAL: ['正常', ''], REVERSAL: ['红冲', 'danger'], TIER_TRUEUP: ['找平', 'purple'],
              FLOOR_ADJUST: ['保底', 'purple'], CAP_ADJUST: ['封顶', 'purple'],
              RECALC_REVERSAL: ['重算红冲', 'danger'], RECALC_NEW: ['重算补记', 'purple'] }[x.flow_type] || [x.flow_type, ''];
            return U.badge(m[0] + (x.is_cross_period ? ' · 跨期' : ''), m[1]);
          }, width: '95px' },
          { label: '账单', render: function (x) { return x.bill_no ? U.link(x.bill_no, '/bill/' + x.bill_no, 'mono') : h('span', { class: 'faint' }, '未入账'); } }
        ], rows, { compact: true, pageSize: 20, onRow: showFlow })), { tight: true });
      }
      draw();
    }
  });

  /* =========================================================================
   * 冲正工作台
   * ======================================================================= */
  UI.route('reversal', {
    title: '冲正工作台',
    crumbs: ['模块③', '计费引擎', '冲正工作台'],
    render: function (root) {
      var S = Store.get();
      root.appendChild(U.pageHead('冲正机制（资损防线二）',
        '<b>红冲式反向流水</b>：生成负金额流水，<code>original_fee_flow_no</code> 指向原流水；<b>绝不 UPDATE / DELETE</b>。部分冲正强制累计校验：Σ|红冲| ≤ 原流水金额，违反则阻断并 P0 告警。'));
      root.appendChild(subnav('reversal'));

      var revs = S.eng.feeFlows.filter(function (f) { return f.flow_type === 'REVERSAL' || f.flow_type === 'RECALC_REVERSAL'; });
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('红冲流水', revs.length),
        U.stat('红冲金额', M.fmt(M.sum(revs, function (f) { return f.fee_amount; })), '', 'danger'),
        U.stat('跨账期冲正', revs.filter(function (f) { return f.is_cross_period; }).length, '计入下期调整项 (D-06)'),
        U.stat('重复冲正拦截', 0, 'S-06 校验', 'ok')
      ]));

      root.appendChild(U.card('红冲流水清单', U.table([
        { label: '红冲流水号', render: function (f) { return h('span', { class: 'mono', style: 'font-size:11px' }, f.fee_flow_no); } },
        { label: '原流水号', render: function (f) { return h('span', { class: 'mono faint', style: 'font-size:11px' }, f.original_fee_flow_no); } },
        { label: '计费对象', render: function (f) { return h('span', { class: 'mono' }, f.charge_object_id); } },
        { label: '计费项', key: 'charge_item_name' },
        { label: '原金额', num: true, render: function (f) { var o = S.eng.flowsByNo[f.original_fee_flow_no]; return o ? M.fmt(o.fee_amount) : '—'; } },
        { label: '红冲金额', num: true, render: function (f) { return U.money(f.fee_amount); } },
        { label: '策略', render: function (f) { return U.badge(({ FULL: '全额', PROPORTIONAL: '按比例', NONE: '不冲正' })[f.reversal_policy], 'info'); } },
        { label: '原因', key: 'reversal_reason' },
        { label: '账期处理', render: function (f) { return f.is_cross_period ? U.badge('跨期 → 下期调整项', 'warn') : U.badge('计入本期', 'ok'); } }
      ], revs, { compact: true, onRow: showFlow }), { tight: true, ref: '6.7' }));

      root.appendChild(h('div', { class: 'grid g2' }, [
        U.card('冲正与账单状态的联动矩阵', U.table([
          { label: '原账单状态', key: 'k' }, { label: '处理', key: 'v' }
        ], [
          { k: '账单未生成', v: '红冲流水直接落在本账期，正常汇总' },
          { k: '已生成未确认', v: '作废原账单，重新生成（对外未发出，无影响）' },
          { k: '已确认', v: '不重开账单。红冲标记 is_cross_period=1 + origin_period，在下期账单作为调整项呈现' },
          { k: '已结算', v: '同上，计入下期调整项' }
        ], { compact: true }), { tight: true, ref: '6.7.4 / D-06' }),
        U.card('冲正触发场景', U.table([
          { label: '场景', key: 'k' }, { label: '触发事件', key: 'e' }, { label: '冲正范围', key: 'v' }
        ], [
          { k: '放款撤销', e: 'EV_DISBURSE_REVERSE', v: '该笔放款驱动的全部费用' },
          { k: '还款冲正', e: 'EV_REPAY_REVERSE', v: '该笔还款驱动的费用' },
          { k: '退款', e: 'EV_REFUND', v: '按退款金额比例冲正' },
          { k: '提前结清', e: 'EV_PREPAY_SETTLE', v: '不冲正历史，但终止后续余额型计费' },
          { k: '核销 / 回购', e: 'EV_WRITE_OFF / EV_ASSET_BUYBACK', v: '视协议约定' },
          { k: '规则纠错', e: '人工发起', v: '走范围重算，不走冲正' }
        ], { compact: true }), { tight: true, ref: '6.7.1' })
      ]));

      /* ---- 注入反向事件（含重复冲正拦截演示）---- */
      var candidates = S.eng.feeFlows.filter(function (f) {
        return f.flow_type === 'NORMAL' && f.reversal_policy !== 'NONE' && f.fee_amount > 0;
      }).slice(0, 60);
      var selNo = candidates.length ? candidates[0].fee_flow_no : '';
      var amtIn = h('input', { type: 'number', value: candidates.length ? candidates[0].basis_amount : 0, style: 'max-width:180px' });
      var out = h('div', { class: 'mt8' });
      root.appendChild(U.card('模拟：注入反向事件', h('div', null, [
        U.alertBox('info', '选择一条正常流水并投递反向事件，观察红冲计算与<b>累计校验</b>。把冲正金额设为大于剩余可冲金额，可看到「重复冲正拦截 + P0 告警」。'),
        h('div', { class: 'inline-form' }, [
          U.field('原费用流水', U.selectEl(candidates.map(function (f) {
            return { value: f.fee_flow_no, label: f.fee_flow_no + ' · ' + f.charge_item_name + ' · ' + M.fmt(f.fee_amount) };
          }), selNo, function (v) {
            selNo = v; var fl = S.eng.flowsByNo[v]; amtIn.value = fl.basis_amount;
          }, { style: 'min-width:380px' })),
          U.field('反向金额（基数口径）', amtIn),
          h('button', {
            class: 'btn btn-danger', disabled: !Store.can('event.replay'),
            onclick: function () { doReverse(); }
          }, '投递反向事件')
        ]),
        out
      ]), { ref: '6.7.3' }));

      function doReverse() {
        var of = S.eng.flowsByNo[selNo];
        if (!of) return;
        var amt = +amtIn.value || 0;
        var ratio = of.basis_amount > 0 ? Math.min(1, amt / of.basis_amount) : 1;
        var want = M.r2(of.fee_amount * (of.reversal_policy === 'FULL' ? 1 : ratio));
        var already = S.eng.reversedAmt[selNo] || 0;
        out.innerHTML = '';
        if (M.r2(already + want) > M.r2(Math.abs(of.fee_amount)) + 0.001) {
          Store.alert('P0', '重复冲正被拦截', '流水 ' + selNo + ' 累计红冲 ' + M.fmt(already + want) + ' 超过原金额 ' + M.fmt(of.fee_amount), '#/reversal');
          out.appendChild(U.alertBox('danger',
            '<b>🔴 P0 · 重复冲正拦截（S-06）</b><br>已冲 ' + M.fmt(already) + ' ＋ 本次 ' + M.fmt(want) +
            ' ＝ ' + M.fmt(already + want) + ' ＞ 原流水 ' + M.fmt(of.fee_amount) +
            '<br>系统硬拦截，不生成红冲流水，并触发 P0 告警（这是「重复冲正导致多退」的防线）。'));
          UI.toast('重复冲正被拦截，已触发 P0 告警', 'danger', '硬拦截');
          return;
        }
        var ev = {
          event_id: 'MANUAL_RV_' + Date.now(), event_code: 'EV_REFUND',
          occur_time: S.simToday + 'T12:00:00+08:00', occur_date: S.simToday,
          receive_time: S.simToday + 'T12:00:01+08:00',
          partner_no: of.partner_no, agreement_no: of.agreement_no,
          product_code: 'P001', channel_code: 'CH001', biz_key: of.charge_object_id,
          source_version: 1, status: 'PENDING', ignore_reason: '',
          internal_no: Core.No.event(S.simToday),
          payload: { loan_no: of.charge_object_id, origin_event_id: of.event_id, refund_amount: amt,
            refund_time: S.simToday + 'T12:00:00+08:00', refund_reason: '（模拟注入）' }
        };
        S.events.push(ev); S.eventMap[ev.event_id] = ev;
        var before = S.eng.feeFlows.length;
        Engine.processEvent(S.eng, ev, { partners: S.partners, agreements: S.agreements, versions: S.versions, eventsById: S.eventMap });
        var made = S.eng.feeFlows.slice(before);
        made.forEach(function (m) { (S.eng.flowsByEvent[ev.event_id] || (S.eng.flowsByEvent[ev.event_id] = [])).push(m.fee_flow_no); });
        Store.log('计费引擎', '注入反向事件', of.charge_object_id, '生成红冲 ' + made.length + ' 条');
        out.appendChild(made.length
          ? U.alertBox('ok', '生成红冲流水 <b>' + made.map(function (m) { return m.fee_flow_no + '（' + M.fmt(m.fee_amount) + '）'; }).join('、') +
            '</b>；' + (made[0].is_cross_period ? '原账期已确认 → 标记跨期，计入下期账单调整项（D-06）' : '计入本期账单'))
          : U.alertBox('warn', '未生成红冲流水（可能冲正策略为 NONE）'));
        UI.toast('反向事件已处理', 'ok', '冲正完成');
        App.rerender();
      }
    }
  });

  /* =========================================================================
   * 范围重算
   * ======================================================================= */
  UI.route('recalc', {
    title: '范围重算',
    crumbs: ['模块③', '计费引擎', '范围重算'],
    render: function (root) {
      var S = Store.get();
      root.appendChild(U.pageHead('范围重算（影子计算 + 人工确认）',
        '重算是本系统<b>权限最高、风险最大</b>的操作。采用「影子计算 → 差异比对 → 分级审批 → 原子生效」，生效方式仍是<b>红冲 + 补记</b>而非修改原流水，保证 Append-Only 在重算场景下依然成立（ADR-7）。'));
      root.appendChild(subnav('recalc'));

      var scope = { from: '2026-04-01', to: '2026-04-30', partner_nos: [], charge_item_nos: [] };
      var reason = '';
      root.appendChild(U.card('发起重算任务', h('div', null, [
        h('div', { class: 'inline-form' }, [
          U.field('时间范围起', h('input', { type: 'date', value: scope.from, onchange: function (e) { scope.from = e.target.value; } })),
          U.field('时间范围止', h('input', { type: 'date', value: scope.to, onchange: function (e) { scope.to = e.target.value; } })),
          U.field('资金方', U.selectEl([{ value: '', label: '全部' }].concat(S.partners.map(function (p) { return { value: p.partner_no, label: p.partner_short_name }; })), '', function (v) { scope.partner_nos = v ? [v] : []; })),
          U.field('重算原因（必填）', h('input', { type: 'text', placeholder: '如：技术服务费率配置错误，应为 1.3% 误配为 1.5%', style: 'min-width:320px', oninput: function (e) { reason = e.target.value; } })),
          h('button', {
            class: 'btn btn-primary', disabled: !Store.can('recalc.create'),
            onclick: function () {
              if (!reason) { UI.toast('请填写重算原因（留痕必需）', 'warn'); return; }
              var t = Store.Actions.createRecalc(Core.deep(scope), reason);
              Store.Actions.runShadow(t.recalc_task_no);
              UI.toast('影子计算完成，比对 ' + t.rows.length + ' 笔', 'ok', t.recalc_task_no);
              App.rerender();
            }
          }, '① 圈定范围并执行影子计算')
        ]),
        U.alertBox('info', '影子计算写入 <code>recalc_shadow</code> 表，<b>不写 fee_flow，不写 event_idempotent</b>。审批未通过或人工放弃时，影子数据保留 30 天供排查，不生效、不删除。')
      ]), { ref: '6.9' }));

      S.recalcs.forEach(function (t) {
        var byResult = Core.groupBy(t.rows, function (r) { return r.result; });
        root.appendChild(U.card('重算任务 ' + t.recalc_task_no, h('div', null, [
          U.kv([
            ['状态', U.statusBadge(t.status)], ['发起人', Store.roleName(t.initiator)],
            ['范围', t.scope.from + ' ~ ' + t.scope.to + (t.scope.partner_nos.length ? ' · ' + t.scope.partner_nos.join(',') : ' · 全部资金方')],
            ['原因', t.reason],
            ['影响笔数', M.fmt(t.affected_count, 0) + ' / ' + M.fmt(t.rows.length, 0)],
            ['原金额 → 新金额', M.fmt(t.amount_old) + ' → ' + M.fmt(t.amount_new)],
            ['差额', h('b', { class: t.amount_diff < 0 ? 'neg' : 'pos' }, M.fmtSigned(t.amount_diff))],
            ['审批单号', t.approval_no || '—']
          ], 'kv-2col'),
          h('h3', { class: 'sec' }, '差异比对报告'),
          U.table([
            { label: '比对结果', render: function (r) { return U.badge(({ NO_CHANGE: '金额一致', AMOUNT_CHANGED: '金额不同', SHOULD_REVERSE: '应冲正', SHOULD_ADD: '应补记' })[r.k], r.k === 'NO_CHANGE' ? 'ok' : 'warn'); } },
            { label: '笔数', num: true, render: function (r) { return r.v.length; } },
            { label: '原金额', num: true, render: function (r) { return M.fmt(M.sum(r.v, function (x) { return x.old; })); } },
            { label: '新金额', num: true, render: function (r) { return M.fmt(M.sum(r.v, function (x) { return x.neu; })); } },
            { label: '差额', num: true, render: function (r) { return U.money(M.sum(r.v, function (x) { return x.diff; }), { signed: true }); } }
          ], Object.keys(byResult).map(function (k) { return { k: k, v: byResult[k] }; }), { compact: true }),
          h('div', { class: 'btn-row mt14' }, [
            h('button', {
              class: 'btn', disabled: t.status !== 'COMPARED' || !Store.can('approval.submit'),
              onclick: function () {
                var r = Store.Actions.submitRecalcApproval(t.recalc_task_no);
                if (!r.ok) { UI.toast(r.msg, 'warn'); return; }
                UI.toast('审批单 ' + r.approval.approval_no + ' 已生成：' +
                  r.approval.chain.map(function (s) { return s.role_name; }).join(' → '), 'ok', '已提交审批');
                App.rerender();
              }
            }, '② 提交重算审批（财务负责人 + 风控）'),
            t.status === 'PENDING_APPROVAL' ? h('button', {
              class: 'btn btn-ghost', onclick: function () { U.goto('/approvals'); }
            }, '审批中 → 前往审批中心') : null,
            h('button', {
              class: 'btn btn-danger', disabled: t.status !== 'APPROVING',
              onclick: function () {
                var r = Store.Actions.applyRecalc(t.recalc_task_no);
                UI.toast('已生成 ' + r.flows.length + ' 条红冲/补记流水，差额计入下期调整项', 'ok', '重算生效');
                App.rerender();
              }
            }, '③ 原子生效（红冲 + 补记）'),
            h('button', { class: 'btn btn-ghost', onclick: function () { showRows(t); } }, '查看逐笔明细')
          ])
        ]), { ref: '6.9.3' }));
      });

      if (!S.recalcs.length) {
        root.appendChild(U.card('影子计算流程', h('pre', { class: 'code' },
          '┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌────────┐  ┌────────┐\n' +
          '│ 发起    │─▶│ 圈定范围  │─▶│ 影子计算  │─▶│ 差异比对│─▶│ 审批   │─▶│ 生效   │\n' +
          '└─────────┘  └──────────┘  └──────────┘  └────────┘  └────────┘  └────────┘\n' +
          '                 │              │             │            │           │\n' +
          '            列出受影响      写入 recalc_    逐笔对比    影响面报告   原子替换\n' +
          '            事件与流水       shadow 表      新旧金额     分级审批    + 生成红冲'), { ref: '6.9.3' }));
      }

      function showRows(t) {
        U.modal('重算逐笔比对 ' + t.recalc_task_no, U.pagedTable([
          { label: '原流水号', render: function (r) { return h('span', { class: 'mono', style: 'font-size:11px' }, r.flow ? r.flow.fee_flow_no : '（新增）'); } },
          { label: '计费对象', render: function (r) { return h('span', { class: 'mono' }, (r.flow || r.shadow).charge_object_id); } },
          { label: '计费项', render: function (r) { return (r.flow || r.shadow).charge_item_name; } },
          { label: '原金额', num: true, render: function (r) { return M.fmt(r.old); } },
          { label: '影子金额', num: true, render: function (r) { return M.fmt(r.neu); } },
          { label: '差额', num: true, render: function (r) { return U.money(r.diff, { signed: true }); } },
          { label: '结果', render: function (r) { return U.badge(r.result, r.result === 'NO_CHANGE' ? 'ok' : 'warn'); } }
        ], t.rows, { compact: true, pageSize: 15 }), [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'wide' });
      }
    }
  });

  window.ViewsCharge = { showFlow: showFlow, subnav: subnav };
})();
