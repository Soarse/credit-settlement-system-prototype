/* =============================================================================
 * views-daily.js —— T+1 日度核算调度视图 + 日度异常识别
 * 对应 PRD 3.5.1（一天中系统做什么）/ 6.8（试算与日度核算）/ 10.2（日常计费流程）
 * 「月末出账 5 天 → 3 小时」的技术支点：把计算工作从月末的时间瓶颈中移出，
 * 前置分摊到每日的 T+1 核算。
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  /* 一天中的调度编排（PRD 3.5.1） */
  var SCHEDULE = [
    { from: 0, to: 0.5, name: '业务日切', tm: '00:00', desc: '与贷款核心对齐，T 日日终快照在此刻固化', key: 'cutoff' },
    { from: 0.5, to: 2, name: '接收 T-1 日终余额快照', tm: '00:30–02:00', desc: '文件落地 → MD5 与 #TOTAL 校验 → 落不可变快照副本', key: 'snapshot' },
    { from: 2, to: 4, name: '事件完整性校验与回补', tm: '02:00–04:00', desc: '与上游核对 T-1 事件笔数，缺失则拉取回补', key: 'backfill' },
    { from: 4, to: 6, name: 'T+1 日度核算', tm: '04:00–06:00', desc: '对所有在途账期执行增量计费，产出当期累计费用', key: 'calc' },
    { from: 6, to: 7, name: '日度勾稽校验（L1→L2）', tm: '06:00–07:00', desc: '事件 ↔ 流水 笔数金额校验，异常告警', key: 'tieout' },
    { from: 7, to: 7.4, name: '监控大盘刷新', tm: '07:00', desc: '运营上班即可看到 T-1 全貌', key: 'dashboard' },
    { from: 7.4, to: 24, name: '实时事件计费', tm: '全天', desc: '时点型事件实时消费并计费，P99 < 3 秒', key: 'realtime' }
  ];

  /* ---------------- 当日统计 ---------------- */
  function balancePartners(S) {
    return S.partners.filter(function (p) {
      return S.versions.some(function (v) {
        var agr = S.agreementMap[v.agreement_no];
        return agr && agr.partner_no === p.partner_no && v.status === 'EFFECTIVE' &&
          v.items.some(function (it) { return it.rule && it.rule.trigger.event_code === 'EV_DAILY_BALANCE'; });
      });
    });
  }

  function dayStats(S, date) {
    var evs = S.events.filter(function (e) { return e.occur_date === date; });
    var flows = S.eng.feeFlows.filter(function (f) { return f.fee_date === date; });
    var bal = balancePartners(S);
    var snapOk = bal.filter(function (p) {
      return S.events.some(function (e) { return e.event_code === 'EV_DAILY_BALANCE' && e.partner_no === p.partner_no && e.occur_date === date; });
    });
    var amount = M.sum(flows.filter(function (f) { return f.fee_amount > 0; }), function (f) { return f.fee_amount; });
    var reversal = M.sum(flows.filter(function (f) { return f.fee_amount < 0; }), function (f) { return Math.abs(f.fee_amount); });
    return {
      date: date, events: evs.length,
      charged: evs.filter(function (e) { return e.status === 'CHARGED'; }).length,
      ignored: evs.filter(function (e) { return e.status === 'IGNORED'; }).length,
      pending: evs.filter(function (e) { return ['PENDING', 'PROCESSING', 'FAILED'].indexOf(e.status) >= 0; }).length,
      flows: flows.length, amount: amount, reversal: reversal,
      snapExpected: bal.length, snapOk: snapOk.length,
      snapMissing: bal.filter(function (p) { return snapOk.indexOf(p) < 0; }),
      flowList: flows
    };
  }

  /* ---------------- 日度异常识别规则（PRD 6.8.4）---------------- */
  function anomalies(S, date) {
    var cur = dayStats(S, date);
    var prev = dayStats(S, D.addDays(date, -1));
    var out = [];
    // ① 日增费用突变
    var ratio = prev.amount ? cur.amount / prev.amount : null;
    out.push({
      code: 'AN-1', name: '日增费用突变', threshold: '环比 > 300% 或 < 30%',
      value: ratio === null ? '无上日可比' : M.pct(ratio, 0) + '（' + M.fmtShort(prev.amount) + ' → ' + M.fmtShort(cur.amount) + '）',
      hit: ratio !== null && (ratio > 3 || ratio < 0.3),
      action: '告警，人工确认', level: 'P2'
    });
    // ② 事件积压
    var oldest = S.events.filter(function (e) { return ['PENDING', 'PROCESSING', 'FAILED'].indexOf(e.status) >= 0; })
      .map(function (e) { return e.occur_date; }).sort()[0];
    var backlogHours = oldest ? D.diffDays(oldest, S.simToday) * 24 : 0;
    var backlog = S.events.filter(function (e) { return ['PENDING', 'PROCESSING', 'FAILED'].indexOf(e.status) >= 0; }).length;
    out.push({
      code: 'AN-2', name: '事件积压', threshold: '> 100 笔 或 超 24 小时',
      value: backlog + ' 笔' + (oldest ? '，最老 ' + oldest + '（约 ' + backlogHours + ' 小时）' : ''),
      hit: backlog > 100 || backlogHours > 24, action: '告警', level: 'P1', link: '#/events?status=PENDING'
    });
    // ③ 快照缺失
    out.push({
      code: 'AN-3', name: '快照缺失', threshold: '任一资金方当日快照未到',
      value: cur.snapOk + ' / ' + cur.snapExpected + ' 到齐' + (cur.snapMissing.length ? '，缺 ' + cur.snapMissing.map(function (p) { return p.partner_short_name; }).join('、') : ''),
      hit: cur.snapMissing.length > 0,
      action: '阻断该资金方计费 + 告警；严禁用 T-1 外推', level: 'P0'
    });
    // ④ 冲正率异常
    var revRate = cur.amount ? cur.reversal / cur.amount : 0;
    out.push({
      code: 'AN-4', name: '冲正率异常', threshold: '当日冲正金额 / 当日计费金额 > 5%',
      value: M.pct(revRate, 2) + '（冲正 ' + M.fmt(cur.reversal) + '）',
      hit: revRate > 0.05, action: '告警', level: 'P2', link: '#/reversal'
    });
    // ⑤ 零费用协议
    var effAgrs = S.agreements.filter(function (a) { return a.status === 'EFFECTIVE'; });
    var zero = effAgrs.filter(function (a) {
      return !cur.flowList.some(function (f) { return f.agreement_no === a.agreement_no; });
    });
    out.push({
      code: 'AN-5', name: '零费用协议', threshold: '生效协议当日无任何费用产生',
      value: zero.length ? zero.length + ' 份：' + zero.map(function (a) { return a.agreement_no; }).join('、') : '全部生效协议均有费用产生',
      hit: zero.length > 0, action: '提示，人工确认是否正常', level: 'P3'
    });
    return { stats: cur, prev: prev, rules: out };
  }

  /* =========================================================================
   * 路由
   * ======================================================================= */
  UI.route('daily', {
    title: '日度核算调度',
    crumbs: ['模块③', '计费引擎', '日度核算调度'],
    render: function (root, params) {
      var S = Store.get();
      var date = params.date || '2026-04-30';
      var A = anomalies(S, date);
      var st = A.stats;

      root.appendChild(U.pageHead('T+1 日度核算调度',
        '「月末出账 5 天 → 3 小时」的<b>技术支点</b>：把计算工作从月末的时间瓶颈中移出，前置分摊到每日。' +
        '月末封账时当期费用流水已全部就绪，出账退化为「汇总 + 校验 + 生成凭证」，不再包含计算与纠错。',
        [
          h('input', { type: 'date', value: date, min: '2026-03-01', max: '2026-05-06', style: 'max-width:160px',
            onchange: function (e) { U.goto('/daily?date=' + e.target.value); } }),
          h('button', { class: 'btn', onclick: function () { U.goto('/tieout?period=' + D.period(date)); } }, '查看当期勾稽')
        ]));
      root.appendChild(ViewsCharge.subnav('daily'));

      /* ---- 调度时间轴 ---- */
      var runBox = h('div');
      root.appendChild(U.card('一天中系统做什么 · 调度编排', runBox, {
        ref: '3.5.1 / 10.2',
        actions: [
          h('button', {
            class: 'btn btn-sm btn-primary', disabled: !Store.can('sim.run'),
            onclick: function () { runSchedule(true); }
          }, '▶ 模拟执行 T+1 日度核算'),
          h('button', { class: 'btn btn-sm', onclick: function () { runSchedule(false); } }, '重置')
        ]
      }));

      var runState = { step: SCHEDULE.length, timers: [] };
      function runSchedule(animate) {
        runState.timers.forEach(clearTimeout); runState.timers = [];
        runState.step = animate ? 0 : SCHEDULE.length;
        drawSchedule();
        if (!animate) return;
        SCHEDULE.forEach(function (_, i) {
          runState.timers.push(setTimeout(function () { runState.step = i + 1; drawSchedule(); }, 420 * (i + 1)));
        });
      }
      function drawSchedule() {
        runBox.innerHTML = '';
        // 24 小时时间条
        var track = h('div', { class: 'sched-track' });
        var colors = ['#6b7893', '#2f7bff', '#2f7bff', '#7048c0', '#0f9960', '#b7791f', '#8592ab'];
        SCHEDULE.forEach(function (s, i) {
          track.appendChild(h('div', {
            class: 'sched-seg',
            style: 'left:' + (s.from / 24 * 100) + '%;width:' + ((s.to - s.from) / 24 * 100) + '%;background:' + colors[i] +
              ';opacity:' + (i < runState.step ? 1 : 0.28),
            title: s.tm + '　' + s.name
          }, (s.to - s.from) >= 1.5 ? s.name.slice(0, 6) : ''));
        });
        runBox.appendChild(track);
        runBox.appendChild(h('div', { class: 'sched-hours' },
          ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'].map(function (x) { return h('span', null, x); })));

        var results = {
          cutoff: '业务日 ' + date,
          snapshot: st.snapOk + ' / ' + st.snapExpected + ' 家到齐',
          backfill: '事件 ' + M.fmt(st.events, 0) + ' 条，缺口 ' + st.pending + ' 条',
          calc: '生成流水 ' + M.fmt(st.flows, 0) + ' 条 / ' + M.fmt(st.amount),
          tieout: st.pending === 0 ? '通过（积压 0）' : '不平（积压 ' + st.pending + ' 条）',
          dashboard: '已刷新',
          realtime: '时点事件实时计费'
        };
        var rows = h('div', { class: 'sched' });
        SCHEDULE.forEach(function (s, i) {
          var state = i < runState.step ? 'done' : (i === runState.step ? 'run' : 'wait');
          rows.appendChild(h('div', { class: 'sched-row ' + state }, [
            h('div', { class: 'st' }, state === 'done' ? '✓' : (state === 'run' ? '▶' : '○')),
            h('div', { class: 'tm' }, s.tm),
            h('div', { class: 'nm' }, s.name),
            h('div', { class: 'ds' }, s.desc),
            h('div', { class: 'rs' }, state === 'done' ? results[s.key] : (state === 'run' ? '执行中…' : '—'))
          ]));
        });
        runBox.appendChild(rows);
        runBox.appendChild(h('div', { class: 'mt8' }, U.alertBox('info',
          '<b>日度核算不是独立的影子计算</b>：时点事件在到达时就已产生正式费用流水；余额型事件在快照到达后也产生正式流水。' +
          '日度核算的实质是 ① 驱动余额型计费的执行 ② 汇总当期累计并留档 ③ 执行日度勾稽校验 —— 更准确的表述是「<b>日度核算 + 校验</b>」。')));
      }
      drawSchedule();

      /* ---- 当日核算结果 ---- */
      root.appendChild(h('h3', { class: 'sec' }, ['当日核算结果 · ' + date, h('span', { class: 'tag-ref' }, '6.8.2')]));
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('日终快照到齐', st.snapOk + ' / ' + st.snapExpected,
          st.snapMissing.length ? '缺 ' + st.snapMissing.map(function (p) { return p.partner_short_name; }).join('、') : '全部到齐',
          st.snapMissing.length ? 'danger' : 'ok'),
        U.stat('事件接入', M.fmt(st.events, 0), '已计费 ' + st.charged + ' · 已忽略 ' + st.ignored,
          '', function () { U.goto('/events?period=' + D.period(date)); }),
        U.stat('生成费用流水', M.fmt(st.flows, 0), '含红冲 ' + st.flowList.filter(function (f) { return f.fee_amount < 0; }).length + ' 条',
          '', function () { U.goto('/flows?period=' + D.period(date)); }),
        U.stat('当日费用金额', M.fmtShort(st.amount), '冲正 ' + M.fmt(st.reversal), '')
      ]));

      /* ---- 按资金方拆分 ---- */
      var byPartner = Core.groupBy(st.flowList, function (f) { return f.partner_no; });
      root.appendChild(U.card('当日核算明细（按资金方）', U.table([
        { label: '资金方', render: function (r) { return U.link((S.partnerMap[r.k] || {}).partner_short_name || r.k, '/partner/' + r.k); } },
        { label: '快照', render: function (r) {
          var p = S.partnerMap[r.k];
          var need = balancePartners(S).indexOf(p) >= 0;
          if (!need) return h('span', { class: 'faint' }, '不适用');
          return st.snapMissing.indexOf(p) >= 0 ? U.badge('缺失（阻断计费）', 'danger') : U.badge('已到齐', 'ok');
        } },
        { label: '流水笔数', num: true, render: function (r) { return M.fmt(r.v.length, 0); } },
        { label: '正向金额', num: true, render: function (r) { return M.fmt(M.sum(r.v.filter(function (f) { return f.fee_amount > 0; }), function (f) { return f.fee_amount; })); } },
        { label: '红冲金额', num: true, render: function (r) { return U.money(M.sum(r.v.filter(function (f) { return f.fee_amount < 0; }), function (f) { return f.fee_amount; })); } },
        { label: '净额', num: true, render: function (r) { return h('b', null, M.fmt(M.sum(r.v, function (f) { return f.fee_amount; }))); } },
        { label: '计费项', render: function (r) {
          return h('span', null, Core.uniq(r.v.map(function (f) { return f.charge_item_name; }))
            .map(function (n) { return U.badge(n, 'info'); }));
        } }
      ], Object.keys(byPartner).sort().map(function (k) { return { k: k, v: byPartner[k] }; }),
        { compact: true, empty: '当日无费用流水' }), { tight: true }));

      /* ---- 日度异常识别规则 ---- */
      root.appendChild(h('h3', { class: 'sec' }, ['日度异常识别规则', h('span', { class: 'tag-ref' }, '6.8.4')]));
      root.appendChild(U.card(null, U.table([
        { label: '编号', render: function (r) { return h('span', { class: 'mono' }, r.code); }, width: '60px' },
        { label: '规则', key: 'name', width: '120px' },
        { label: '阈值', key: 'threshold', width: '210px' },
        { label: '当前值', render: function (r) { return h('span', { class: r.hit ? 'neg' : '' }, r.value); } },
        { label: '动作', key: 'action', width: '230px' },
        { label: '级别', render: function (r) { return U.levelBadge(r.level); }, width: '60px' },
        { label: '状态', width: '90px', render: function (r) {
          return r.hit ? U.badge('已触发', 'danger') : U.badge('正常', 'ok');
        } },
        { label: '', width: '70px', render: function (r) {
          return r.hit && r.link ? h('button', { class: 'btn btn-sm', onclick: function () { location.hash = r.link.replace('#', ''); } }, '处理') : null;
        } }
      ], A.rules, { compact: true }), { tight: true }));

      var hits = A.rules.filter(function (r) { return r.hit; });
      root.appendChild(U.alertBox(hits.length ? 'warn' : 'ok',
        hits.length ? '当日触发 <b>' + hits.length + '</b> 条异常规则：' + hits.map(function (r) { return r.code + ' ' + r.name; }).join('、') + '。日度勾稽不阻断计费，但<b>阻断封账</b>。'
          : '当日 5 条异常识别规则全部正常。日度核算在 2 小时窗口内完成，问题<b>次日即暴露</b>，修复窗口充裕。'));

      /* ---- 日增费用趋势 ---- */
      root.appendChild(h('h3', { class: 'sec' }, ['日增费用趋势（近 30 日）', h('span', { class: 'tag-ref' }, '6.8.4 · AN-1')]));
      var days = [];
      for (var i = 29; i >= 0; i--) days.push(D.addDays(date, -i));
      var chartPartner = '';
      var chartBox = h('div');
      function drawChart() {
        chartBox.innerHTML = '';
        var series = [];
        days.forEach(function (d, idx) {
          var fl = S.eng.feeFlows.filter(function (f) {
            return f.fee_date === d && f.fee_amount > 0 && (!chartPartner || f.partner_no === chartPartner);
          });
          var amt = M.sum(fl, function (f) { return f.fee_amount; });
          var evc = S.events.filter(function (e) { return e.occur_date === d && (!chartPartner || e.partner_no === chartPartner); }).length;
          var pv = idx > 0 ? series[idx - 1].value : 0;
          var r = pv ? amt / pv : null;
          series.push({
            label: d, axis: d.slice(5), value: amt,
            anomaly: r !== null && pv > 0 && amt > 0 && (r > 3 || r < 0.3),
            anomalyText: r === null ? '' : '环比 ' + M.pct(r, 0),
            flows: fl.length, events: evc, ratio: r
          });
        });
        var hitDays = series.filter(function (x) { return x.anomaly; });
        chartBox.appendChild(U.barChart(series, {
          seriesName: '当日费用金额（正向，含税）' + (chartPartner ? ' · ' + (S.partnerMap[chartPartner] || {}).partner_short_name : ' · 全部资金方'),
          tipHtml: function (d) {
            return '费用 ' + M.fmt(d.value) + '<br>流水 ' + M.fmt(d.flows, 0) + ' 条 · 事件 ' + M.fmt(d.events, 0) + ' 条' +
              (d.ratio === null ? '' : '<br>环比 ' + M.pct(d.ratio, 0)) + (d.anomaly ? '<br><b>▲ 触发 AN-1 突变告警</b>' : '');
          },
          onClick: function (d) { U.goto('/daily?date=' + d.label); }
        }));
        chartBox.appendChild(h('div', { class: 'mt8' }, U.alertBox(hitDays.length ? 'warn' : 'ok',
          hitDays.length
            ? '近 30 日有 <b>' + hitDays.length + '</b> 天触发 AN-1 环比突变：' + hitDays.map(function (x) { return x.label.slice(5); }).join('、') +
              '。多数落在<b>无大额放款的自然日</b> —— 这正是该规则只做「告警 + 人工确认」而不自动阻断的原因。'
            : '近 30 日日增费用平稳，未触发 AN-1。')));
      }
      root.appendChild(U.card(null, h('div', null, [
        h('div', { class: 'inline-form', style: 'margin-bottom:10px' }, [
          U.field('按资金方查看', U.selectEl([{ value: '', label: '全部资金方（合计）' }].concat(
            S.partners.filter(function (p) { return p.status === 'ACTIVE'; })
              .map(function (p) { return { value: p.partner_no, label: p.partner_short_name }; })),
            '', function (v) { chartPartner = v; drawChart(); })),
          h('span', { class: 'faint' }, '余额型计费的资金方（如长安信托、安泰担保）日增曲线平稳；阶梯放款型（星辰消金）天然随放款节奏波动')
        ]),
        chartBox
      ])));
      drawChart();

      /* ---- 为什么能压到 3 小时 ---- */
      root.appendChild(h('div', { class: 'grid g2' }, [
        U.card('月末集中核算 vs T+1 日度核算', U.table([
          { label: '', key: 'k', width: '110px' }, { label: '月末集中核算', key: 'a' }, { label: 'T+1 日度核算', key: 'b' }
        ], [
          { k: '计算时点', a: '账期结束后一次性', b: '每日增量' },
          { k: '月末工作量', a: '计算 + 纠错 + 汇总 + 复核', b: '仅汇总 + 复核' },
          { k: '问题发现', a: '月末（延迟最长 30 天）', b: '次日' },
          { k: '修复窗口', a: '极窄，且在出账压力下', b: '充裕' },
          { k: '资源峰值', a: '月末极高', b: '平摊' }
        ], { compact: true }), { tight: true, ref: '6.8.1' }),
        U.card('容量目标与降级', h('div', null, [
          U.table([{ label: '指标', key: 'k' }, { label: '目标', key: 'v', num: true }], [
            { k: '日终快照事件量', v: '100 万条 / 日' },
            { k: '时点事件量', v: '约 5 万条 / 日' },
            { k: '日度核算窗口', v: '2 小时内（04:00–06:00）' },
            { k: '单资金方月末出账', v: '< 5 分钟' },
            { k: '实时计费延迟', v: 'P99 < 3 秒' }
          ], { compact: true }),
          h('div', { class: 'mt8' }, U.alertBox('warn',
            '<b>降级原则：计费可延迟，资金不可错。</b>日度核算超时 → 延后至次日补算，不阻断实时计费；' +
            '某资金方快照未到 → 仅阻断该资金方（隔离故障域）；<b>绝不降级</b>：幂等校验、基数快照固化、Append-Only 约束。'))
        ]), { ref: '6.11.1 / 6.11.3' })
      ]));

      /* ---- T+1 流程图 ---- */
      root.appendChild(U.card('日常计费流程（T+1）', h('pre', { class: 'code' },
        '00:00 业务日切\n' +
        '  └─▶ 00:30–02:00 接收 T-1 日终余额快照\n' +
        '        ├─ 缺失 ─▶ 阻断该资金方计费 + P0 告警（严禁用 T-1 外推）\n' +
        '        └─ 完整 ─▶ 02:00–04:00 事件完整性校验与回补\n' +
        '                     ├─ 与上游核对笔数，缺失即拉取回补\n' +
        '                     └─▶ 04:00–06:00 日度核算（余额型计费执行 + 当期累计）\n' +
        '                           └─▶ 06:00–07:00 日度勾稽 L1→L2\n' +
        '                                 ├─ 不通过 ─▶ 生成差异单 + 告警（不阻断计费，阻断封账）\n' +
        '                                 └─▶ 07:00 监控大盘刷新\n' +
        '全天：时点事件实时计费'), { ref: '10.2' }));
    }
  });
})();
