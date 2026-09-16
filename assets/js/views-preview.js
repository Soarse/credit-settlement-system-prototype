/* =============================================================================
 * views-preview.js —— 账单中心 · 预出账（PRD 7.2）
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  function subnav(active) {
    var items = [['workbench', '出账工作台'], ['prebill', '预出账'], ['calendar', '出账日历'],
      ['bills', '账单列表'], ['adjustments', '调整项'], ['invoices', '发票管理'], ['disputes', '争议工作台']];
    return h('div', { class: 'btn-row', style: 'margin-bottom:14px' }, items.map(function (i) {
      return h('button', { class: 'btn btn-sm' + (i[0] === active ? ' btn-primary' : ''), onclick: function () { U.goto('/' + i[0]); } }, i[1]);
    }));
  }

  /* 可预出账的账期：已有流水的两个 + 当前在途账期 */
  function periodOptions(S) {
    var ps = Data.PERIODS.slice();
    var cur = D.period(S.simToday);
    if (ps.indexOf(cur) < 0) ps.push(cur);
    return ps;
  }
  function defaultAsOf(S, period) {
    var e = D.periodEnd(period);
    /* 账期已过完就停在期末，否则停在系统业务日 */
    return S.simToday > e ? D.addDays(D.periodStart(period), 19) : S.simToday;
  }

  UI.route('prebill', {
    title: '预出账', crumbs: ['模块④', '账单中心', '预出账'],
    render: function (root, q) {
      var S = Store.get();
      var periods = periodOptions(S);
      var period = periods.indexOf(q.p) >= 0 ? q.p : (periods.indexOf('2026-04') >= 0 ? '2026-04' : periods[0]);
      var asOf = q.d && q.d >= D.periodStart(period) && q.d <= D.periodEnd(period) ? q.d : defaultAsOf(S, period);

      root.appendChild(U.pageHead('预出账（账期结束前预览）',
        '预出账不是「提前出账」，是<b>把出账日的体检提前到账期中</b>。「月末 3 小时」的前提是问题在月中就被发现 —— ' +
        '真到了出账日才发现缺 8 天快照，补数 + 重算 + 复核根本压不进 3 小时。' +
        '<b>不落库、不占账单号、不锁流水</b>；与正式出账共用同一套构造逻辑与校验清单。',
        [
          h('button', {
            class: 'btn', disabled: !Store.can('bill.preview'),
            onclick: function () {
              var r = Store.Actions.savePreview(period, asOf);
              if (!r.ok) { U.toast(r.msg, 'warn'); return; }
              U.toast('已留档 ' + r.snapshot.preview_no + '，出账后可回来比对', 'ok', '预出账快照');
              App.rerender();
            }
          }, '留档本次预出账'),
          h('button', { class: 'btn btn-ghost', onclick: function () { U.goto('/workbench'); } }, '前往出账工作台')
        ]));
      root.appendChild(subnav('prebill'));

      var pv = Preview.build(S, period, asOf);
      var prog = pv.progress;

      /* ---------- 账期进度与口径 ---------- */
      var ctrl = h('div', { class: 'btn-row', style: 'align-items:flex-end;flex-wrap:wrap;gap:12px' }, [
        U.field('账期', U.selectEl(periods.map(function (p) {
          return { value: p, label: p + (S.eng.closedPeriods[p] ? '（已封账）' : (D.periodEnd(p) < S.simToday ? '（待封账）' : '（在途）')) };
        }), period, function (v) { U.goto('/prebill?p=' + v); })),
        U.field('预览截至业务日', h('input', {
          type: 'date', value: asOf, min: D.periodStart(period), max: D.periodEnd(period),
          onchange: function (e) { if (e.target.value) U.goto('/prebill?p=' + period + '&d=' + e.target.value); }
        }), '拖到不同日期，看同一账期在不同时点的样子')
      ]);

      var closedNote = S.eng.closedPeriods[period]
        ? U.alertBox('info', '账期 <b>' + period + '</b> 已封账。此处仍可回看任一时点的预出账形态，用于复盘「当时能不能提前发现问题」。')
        : null;

      root.appendChild(U.card('账期进度', h('div', null, [
        ctrl,
        closedNote,
        h('div', { class: 'grid g4 mb8', style: 'margin-top:12px' }, [
          U.stat('账期进度', M.pct(prog.pct, 0), prog.start + ' ~ ' + prog.end + ' · 第 ' + prog.day + ' / ' + prog.total + ' 天'),
          U.stat('截至今日累计', M.fmt(pv.total), pv.groups.length + ' 个出账组合 · 三项构成合计'),
          U.stat('全月落点区间', M.fmtShort(pv.projLo) + ' ~ ' + M.fmtShort(pv.projHi),
            prog.closed ? '账期已走完，区间即实际' : '两种口径并列，不给单一数字'),
          U.stat(pv.blockedCount ? '存在阻断项' : '出账条件已就绪',
            pv.blockedCount ? pv.blockedCount + ' / ' + pv.groups.length : pv.readyCount + ' / ' + pv.groups.length,
            pv.blockedCount ? '现在修还来得及' : '按当前状态可直接出账', pv.blockedCount ? 'danger' : 'ok')
        ]),
        U.progress(prog.pct),
        h('div', { class: 'faint mt8', html: '进度条按<b>自然日</b>走。剩余 ' + prog.remain + ' 天。预出账读的是<b>已生成的费用流水</b>（T+1 日度核算的产物），所以它看到什么，出账日就会算出什么 —— 两者同源。' })
      ]), { ref: '7.2.4' }));

      /* ---------- 现在就能修的事（预出账的真正价值） ---------- */
      if (pv.actionable.length) {
        var byCode = {};
        pv.actionable.forEach(function (a) {
          (byCode[a.check.code] || (byCode[a.check.code] = { check: a.check, groups: [] })).groups.push(a.group);
        });
        var rows = Object.keys(byCode).sort().map(function (code) {
          var it = byCode[code];
          return h('div', { class: 'check-row fail' }, [
            h('div', { class: 'st' }, '✕'),
            h('div', { class: 'code' }, code),
            h('div', { class: 'msg' }, [
              h('div', null, it.check.desc),
              h('div', { class: 'faint', style: 'font-size:11.5px' },
                it.groups.map(function (g) { return g.partner_name + '（' + g.partner_no + '）'; }).join('、') +
                ' —— ' + it.check.hint),
              h('div', { class: 'faint', style: 'font-size:11.5px' }, it.groups[0].checks.filter(function (c) { return c.code === code; })[0].msg)
            ]),
            h('div', { class: 'lvl' }, h('button', {
              class: 'btn btn-sm btn-primary', onclick: function () { U.goto('/' + it.check.route); }
            }, it.check.actLabel))
          ]);
        });
        root.appendChild(U.card('现在就能修的事（' + Object.keys(byCode).length + ' 类）', h('div', null, [
          U.alertBox('warn',
            '这一栏是预出账存在的理由。出账日发现这些问题，只能推迟出账；<b>账期中发现，还有 ' + prog.remain + ' 天可以补</b>。' +
            '每一条都直接跳到能修的地方 —— 预出账不负责修，它负责让人现在就知道。'),
          h('div', { class: 'checklist' }, rows)
        ]), { ref: '7.2.4' }));
      } else {
        root.appendChild(U.alertBox('ok',
          '截至 <b>' + asOf + '</b>，' + pv.groups.length + ' 个出账组合的阻断类校验全部通过 —— 按当前状态走到出账日不会被挡。' +
          '<b>V-B01 封账</b>与 <b>V-B02 恒等</b>两条在预出账阶段不适用（账期未结束 / 生成时构造），出账时再判。'));
      }

      /* ---------- 逐组合明细 ---------- */
      var cols = [
        { label: '资金方', render: function (r) { return h('div', null, [h('div', null, r.partner_name), h('div', { class: 'faint', style: 'font-size:11px' }, r.partner_no + ' · ' + r.agreement_no)]); } },
        { label: '方向', width: '78px', render: function (r) { return U.dirBadge(r.direction); } },
        { label: '本期费用', num: true, render: function (r) { return U.money(r.current_period_amount); } },
        { label: '调整项', num: true, render: function (r) { return r.adjustment_amount ? U.money(r.adjustment_amount, { signed: true }) : '—'; } },
        { label: '上期结转', num: true, render: function (r) { return r.carry_forward_amount ? U.money(r.carry_forward_amount, { signed: true }) : '—'; } },
        { label: '截至今日', num: true, render: function (r) { return h('b', null, M.fmt(r.total_amount)); } },
        { label: '全月落点区间', num: true, render: function (r) {
          if (prog.closed) return h('span', { class: 'faint' }, '账期已走完');
          return h('div', null, [
            h('div', null, M.fmtShort(r.forecast.lo) + ' ~ ' + M.fmtShort(r.forecast.hi)),
            h('div', { class: 'faint', style: 'font-size:11px' },
              r.forecast.hasPeer ? '两法差 ' + M.pct(r.forecast.spread, 0) : '无上期可比，仅线性')
          ]);
        } },
        { label: '出账条件', width: '96px', render: function (r) {
          return r.ready ? U.badge('✓ 就绪', 'ok') : U.badge('✕ ' + r.blockers.length + ' 项阻断', 'danger');
        } }
      ];
      root.appendChild(U.card('逐组合预出账 · ' + period + ' 截至 ' + asOf, h('div', null, [
        U.table(cols, pv.groups, { onRow: function (r) { detail(S, r, period, asOf); }, empty: '该账期截至所选日期尚无费用流水' }),
        h('div', { class: 'faint mt8', html:
          '汇总维度与正式出账完全一致：<b>资金方 × 协议 × 收付方向</b>（D-01）。构成公式同样是三项：' +
          '<code>应结金额 = 本期费用 + 调整项 + 上期结转</code>。点任一行看明细与完整校验清单。' })
      ]), { ref: '7.2.1 / 7.2.2' }));

      /* ---------- 落点预测的两种口径 ---------- */
      if (!prog.closed && pv.groups.length) {
        root.appendChild(U.card('落点预测：为什么给区间而不给一个数', h('div', null, [
          U.table([
            { label: '口径', key: 'n', width: '120px' }, { label: '算法', key: 'f' },
            { label: '什么时候准', key: 'g' }, { label: '什么时候不准', key: 'b' }
          ], [
            { n: '线性外推', f: '当前累计 ÷ 账期进度',
              g: '日费率型计费（资金成本、日终余额型）——费用天然按日均匀累积',
              b: '一次性事件费（放款比例费）——放款集中在月初或月末就会严重偏' },
            { n: '同期比对', f: '当前累计 × (上期全月 ÷ 上期同进度点累计)',
              g: '业务节奏与上期相近时——它吸收了「月内分布形状」这个信息',
              b: '本期业务节奏变了（新渠道上量、大额放款提前 / 推迟）' }
          ]),
          U.alertBox('info',
            '两种口径都不完美，所以<b>并列给出、取区间</b>。真正有用的不是区间中点，而是<b>两法的差</b>：' +
            '差得小说明本期节奏与上期一致，差得大本身就是信号 —— 值得点进去看看是哪个计费项的节奏变了。' +
            '留档后走完正式出账，回到「快照比对」还能检验区间有没有套住实际值。')
        ]), { ref: '7.2.4' }));
      }

      /* ---------- 快照留档与比对 ---------- */
      var snaps = S.previews.filter(function (p) { return p.period === period; });
      var sCols = [
        { label: '快照号', key: 'preview_no', width: '150px' },
        { label: '截至业务日', render: function (r) { return r.as_of + '（' + M.pct(r.progress_pct, 0) + '）'; } },
        { label: '留档人 / 时间', render: function (r) { return r.creator + ' · ' + String(r.create_time).replace('T', ' ').slice(0, 16); } },
        { label: '当时累计', num: true, render: function (r) { return U.money(r.total); } },
        { label: '当时落点区间', num: true, render: function (r) { return M.fmtShort(r.proj_lo) + ' ~ ' + M.fmtShort(r.proj_hi); } },
        { label: '当时阻断', width: '90px', render: function (r) { return r.blocked ? U.badge(r.blocked + ' 个组合', 'danger') : U.badge('无', 'ok'); } },
        { label: '', width: '90px', render: function (r) {
          return h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); compare(r.preview_no); } }, '与账单比对');
        } }
      ];
      root.appendChild(U.card('预出账快照留档（' + snaps.length + '）', h('div', null, [
        U.table(sCols, snaps, { empty: '尚未留档。点右上角「留档本次预出账」保存当前时点的快照。' }),
        h('div', { class: 'faint mt8', html:
          '「预出账看到的 = 正式出账出来的」不是一句承诺，是一条<b>可验证的断言</b>。留档后走完封账与出账，' +
          '回来逐项比对：<b>在账期末（' + D.periodEnd(period) + '）留的快照，应与正式账单分文不差</b>；' +
          '账期中留的快照差在哪里，就是那之后新发生的费用与调整项 —— 差额本身是可解释的，不是口径漂移。' })
      ]), { ref: '7.2.4' }));

      /* ---------- 预出账 vs 正式出账 的边界 ---------- */
      function rich(k) { return function (r) { return h('span', { html: r[k] }); }; }
      root.appendChild(U.card('预出账与正式出账的边界', U.table([
        { label: '维度', key: 'd', width: '140px' },
        { label: '预出账', render: rich('p') }, { label: '正式出账', render: rich('f') }
      ], [
        { d: '触发时点', p: '账期中任意业务日，可反复执行', f: '封账后，出账日执行一次' },
        { d: '是否落库', p: '<b>不落库</b>。不占账单号、不回写 fee_flow.bill_no、不改任何实体状态', f: '生成 bill + bill_detail，回写流水与调整项的 bill_no' },
        { d: '幂等影响', p: '零。多跑一百次与跑一次完全等价', f: '同组合同账期已有非作废账单则不重复生成' },
        { d: '校验清单', p: 'V-B03 ~ V-B10 全跑；V-B01 / V-B02 标为「出账时判」', f: 'V-B01 ~ V-B10 全跑，任一 BLOCK 失败即阻断' },
        { d: '数据口径', p: '截至所选业务日的累计', f: '整个账期的全量' },
        { d: '产物', p: '预览视图 + 可留档快照（供事后比对）', f: '正式账单，可推送、可开票、可结算' },
        { d: '谁能做', p: 'BD / 财务核算 / 财务复核 / 财务负责人 / 运营（只读动作，放开）', f: '财务核算 / 管理员（bill.generate）' }
      ]), { ref: '7.2' }));

      function compare(no) {
        var r = Store.Actions.comparePreview(no);
        if (!r) return;
        var res = r.result, snap = r.snapshot;
        var cCols = [
          { label: '资金方', render: function (x) { return x.partner_name + ' · ' + (x.direction === 'RECEIVABLE' ? '应收' : '应付'); } },
          { label: '预出账', num: true, render: function (x) { return x.preview === null ? '—' : M.fmt(x.preview); } },
          { label: '当时落点区间', num: true, render: function (x) { return x.proj_lo === null ? '—' : M.fmtShort(x.proj_lo) + ' ~ ' + M.fmtShort(x.proj_hi); } },
          { label: '正式账单', num: true, render: function (x) { return x.actual === null ? '—' : M.fmt(x.actual); } },
          { label: '差额', num: true, render: function (x) {
            if (x.diff === null) return h('span', { class: 'faint' }, x.state === 'PREVIEW_ONLY' ? '尚未出账' : '预出账时无此组合');
            return Math.abs(x.diff) < 0.005 ? U.badge('✓ 分文不差', 'ok') : U.money(x.diff, { signed: true });
          } },
          { label: '落点是否套住', width: '100px', render: function (x) {
            if (x.inRange === null) return '—';
            return x.inRange ? U.badge('✓ 命中', 'ok') : U.badge('! 落在区间外', 'warn');
          } }
        ];
        var atEnd = snap.as_of === D.periodEnd(snap.period);
        U.modal('快照比对 · ' + snap.preview_no, h('div', null, [
          U.kv([
            ['快照时点', snap.as_of + '（账期进度 ' + M.pct(snap.progress_pct, 0) + '）'],
            ['比对账单数', res.matched + ' 张'],
            ['金额完全一致', res.exact + ' / ' + res.matched + (res.matched && res.exact === res.matched ? '　✓' : '')],
            ['最大差额', M.fmt(res.maxDiff)],
            ['落点区间命中', res.matched ? res.inRange + ' / ' + res.matched : '—']
          ]),
          res.matched === 0
            ? U.alertBox('info', '账期 <b>' + snap.period + '</b> 尚未正式出账，无法比对。先去出账工作台完成封账与出账，再回来。')
            : (atEnd
              ? U.alertBox(res.exact === res.matched ? 'ok' : 'danger',
                res.exact === res.matched
                  ? '这是<b>账期末</b>留的快照，' + res.matched + ' 张账单<b>逐张分文不差</b> —— 「预出账看到的 = 正式出账出来的」在本账期成立。'
                  : '账期末快照与正式账单出现差额，说明预出账与出账走了不同口径，属于<b>必须查</b>的情况。')
              : U.alertBox('info',
                '这是<b>账期中</b>（进度 ' + M.pct(snap.progress_pct, 0) + '）留的快照，与正式账单存在差额是正常的 —— ' +
                '差额 = 快照时点之后新发生的费用流水 + 新增调整项。要验证口径一致，请在账期末（' +
                D.periodEnd(snap.period) + '）再留一张快照比对。')),
          U.table(cCols, res.rows)
        ]), [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'wide' });
      }
    }
  });

  /* ================= 单组合预出账明细 ================= */
  function detail(S, g, period, asOf) {
    var body = h('div');
    body.appendChild(U.kv([
      ['资金方 / 协议', g.partner_name + '（' + g.partner_no + '） · ' + g.agreement_no],
      ['方向', U.dirBadge(g.direction)],
      ['账期 / 截至', period + ' · ' + asOf + '（进度 ' + M.pct(g.progress.pct, 0) + '，剩余 ' + g.progress.remain + ' 天）'],
      ['费用流水', g.flow_count + ' 条（截至所选日期）']
    ]));

    body.appendChild(h('h3', { class: 'sec' }, ['三项构成', h('span', { class: 'tag-ref' }, '7.2.2')]));
    body.appendChild(U.table([
      { label: '构成项', key: 'n' }, { label: '来源', key: 's' }, { label: '金额', num: true, render: function (r) { return U.money(r.v, { signed: r.signed }); } }
    ], [
      { n: '本期费用', s: '账期内未跨期的费用流水合计（' + g.flow_count + ' 条）', v: g.current_period_amount },
      { n: '调整项', s: g.adjustments.length ? g.adjustments.length + ' 项（跨期冲正 / 争议调整 / 协商减免）' : '无', v: g.adjustment_amount, signed: true },
      { n: '上期结转', s: g.carries.length ? g.carries.length + ' 笔（部分结算未付 / 退票重结）' : '无', v: g.carry_forward_amount, signed: true }
    ], { foot: [{ value: '截至今日应结金额' }, { value: '' }, { num: true, value: M.fmt(g.total_amount) }] }));

    if (!g.progress.closed) {
      body.appendChild(h('h3', { class: 'sec' }, ['全月落点预测', h('span', { class: 'tag-ref' }, '7.2.4')]));
      body.appendChild(U.table([
        { label: '口径', key: 'n', width: '130px' }, { label: '推算', key: 'c' },
        { label: '本期费用落点', num: true, render: function (r) { return r.v ? M.fmt(r.v) : '—'; } }
      ], [
        { n: '线性外推', c: M.fmt(g.current_period_amount) + ' ÷ ' + M.pct(g.progress.pct, 0) + '（账期进度）', v: g.forecast.linear },
        { n: '同期比对', c: g.forecast.hasPeer
            ? M.fmt(g.current_period_amount) + ' × ' + g.forecast.ratio.toFixed(3) +
              '（上期全月 ' + M.fmtShort(g.forecast.prevFull) + ' ÷ 上期同进度点 ' + M.fmtShort(g.forecast.prevAccum) + '）'
            : '上期（' + g.forecast.prevPeriod + '）同进度点无累计，该法不可用',
          v: g.forecast.peer }
      ], { foot: [
        { value: '＋ 调整项与上期结转（已知定量，不外推）' }, { value: '' },
        { num: true, value: M.fmtSigned(g.forecast.known) }
      ] }));
      body.appendChild(U.kv([['全月应结金额落点区间',
        h('b', null, M.fmt(g.forecast.lo) + '　~　' + M.fmt(g.forecast.hi))]]));
      body.appendChild(U.alertBox(g.forecast.spread > 0.25 ? 'warn' : 'info',
        g.forecast.hasPeer
          ? '两法相差 <b>' + M.pct(g.forecast.spread, 0) + '</b>。' +
            (g.forecast.spread > 0.25
              ? '差得不小 —— 说明本期的月内分布与上期明显不同（可能是大额放款提前或推迟、新渠道上量）。' +
                '这本身就值得在账期中看一眼，而不是等出账后再解释环比为什么异常。'
              : '两法接近，说明本期业务节奏与上期一致，落点可信度较高。') +
            '　与上期全月（' + M.fmt(g.forecast.prevFull) + '）相比，预计环比 <b>' + M.pct(g.forecast.wave, 1) + '</b>' +
            (Math.abs(g.forecast.wave) > 0.5 ? '，<b>已超 V-B08 的 50% 波动阈值，出账时会告警</b>。' : '，在 V-B08 的 50% 阈值内。')
          : '上期该组合无可比数据（新接入或上期无费用），只能线性外推，落点仅供参考。'));
    }

    body.appendChild(h('h3', { class: 'sec' }, ['出账前置校验（与正式出账同一套）', h('span', { class: 'tag-ref' }, '7.2.3')]));
    body.appendChild(U.checklist(g.checks.map(function (c) {
      return { code: c.code, desc: c.desc + (c.deferred ? '　—— 预出账阶段不适用' : ''),
        ok: c.ok, level: c.level, msg: c.msg };
    })));
    body.appendChild(h('div', { class: 'faint mt8', html:
      '<b>V-B01</b>（账期已封账）与 <b>V-B02</b>（L2→L3 恒等）在预出账阶段不判：前者账期还没结束，后者由账单生成逻辑按等式 D 构造、恒等成立。' +
      '其余八条现在就跑 —— 它们正是预出账要提前暴露的东西。' }));

    var foot = [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')];
    g.checks.forEach(function (c) {
      if (!c.actionable) return;
      foot.unshift(h('button', { class: 'btn btn-primary', onclick: function () { U.closeModal(); U.goto('/' + c.route); } }, c.actLabel));
    });
    U.modal('预出账明细 · ' + g.partner_name + ' · ' + (g.direction === 'RECEIVABLE' ? '应收' : '应付'), body, foot, { size: 'wide' });
  }
})();
