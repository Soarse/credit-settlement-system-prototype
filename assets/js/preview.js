/* =============================================================================
 * preview.js —— 账单中心 · 预出账（PRD 7.2「预出账（账期结束前预览）与正式出账」）
 *
 * 预出账不是「提前出账」，是<b>把出账日的体检提前到账期中</b>。
 * 月末 3 小时的前提，是问题在月中就被发现 —— 真到了出账日才发现缺 8 天快照，
 * 补数 + 重算 + 复核根本压不进 3 小时。所以预出账要回答三件事：
 *   ① 现在算出来是多少，照这个势头走全月会是多少（落点预测）
 *   ② 出账日会被什么挡住，其中<b>哪些现在就能修</b>
 *   ③ 预出账看到的数，和正式出账出来的数，是不是同一个数（口径一致性）
 *
 * 三条硬约束：
 *   · 不落库 —— 不占账单号、不回写 fee_flow.bill_no、不改任何实体状态
 *   · 同源 —— 与正式出账共用 billPreCheck / 明细构造 / 三项构成公式，不另写一套
 *   · 留档可比 —— 生成的快照可与后续正式账单逐项比对差额，证明口径一致
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  /* 预出账阶段「不适用」的两条校验：
     V-B01 账期尚未结束，天然未封账；V-B02 由生成逻辑按等式 D 构造，恒等成立。
     其余八条现在就该跑 —— 它们正是预出账的价值所在。 */
  var DEFERRED = {
    'V-B01': '账期未结束，封账在出账日执行',
    'V-B02': '账单生成时按等式 D 构造，恒等成立'
  };
  /* 这几条不修，出账日一定被挡；且都能在账期中修完 */
  var ACTIONABLE = {
    'V-B03': { route: 'events', label: '去事件中心处理', hint: '事件未达终态即少算，补齐后重跑日度核算' },
    'V-B04': { route: 'replenish', label: '去核对与回补', hint: '缺快照严禁外推，只能向上游补拉' },
    'V-B05': { route: 'adjustments', label: '去调整项', hint: '调整项未审批不得进账单' },
    'V-B07': { route: 'partners', label: '去开票信息', hint: '开票信息不全则账单无法开票' }
  };

  /* ---------------- 账期进度 ---------------- */
  function progress(period, asOf) {
    var s = D.periodStart(period), e = D.periodEnd(period);
    var total = D.diffDays(s, e) + 1;
    var day = asOf < s ? 0 : (asOf > e ? total : D.diffDays(s, asOf) + 1);
    return { start: s, end: e, total: total, day: day,
      pct: total ? day / total : 0, remain: Math.max(0, total - day), closed: asOf >= e };
  }

  /* ---------------- 截至某日的累计（同一构成口径） ---------------- */
  function accumFlows(S, key, period, asOf) {
    return S.eng.feeFlows.filter(function (f) {
      return f.billing_period === period && f.is_cross_period !== 1 &&
        f.fee_date <= asOf &&
        f.partner_no === key.partner_no && f.agreement_no === key.agreement_no &&
        f.direction === key.direction;
    });
  }

  function detailsOf(flows) {
    var map = Core.groupBy(flows, function (f) { return f.charge_item_no; });
    return Object.keys(map).sort().map(function (ci) {
      var fs = map[ci];
      var amt = M.sum(fs, function (x) { return x.fee_amount; });
      var t = M.splitTax(amt, fs[0].tax_rate);
      return { charge_item_no: ci, charge_item_code: fs[0].charge_item_code,
        charge_item_name: fs[0].charge_item_name, flow_count: fs.length,
        amount: amt, amount_ex_tax: t.exTax, tax_amount: t.tax, tax_rate: fs[0].tax_rate };
    });
  }

  /* ---------------- 落点预测（两种口径并列，不给单一数字） ----------------
   * 线性外推：当前累计 ÷ 账期进度。对日费率型准，对一次性事件费不准。
   * 同期比对：当前累计 × (上期全月 ÷ 上期同进度点累计)。吸收了月内分布形状。
   * 两者差得远，本身就是信号 —— 说明本期节奏与上期不同，值得看一眼。 */
  function project(S, key, period, asOf, curAccum, prog) {
    var linear = prog.pct > 0 ? M.r2(curAccum / prog.pct) : 0;
    var prevP = D.prevPeriod(period);
    var prevStart = D.periodStart(prevP), prevEnd = D.periodEnd(prevP);
    var prevTotal = D.diffDays(prevStart, prevEnd) + 1;
    /* 按「进度百分比」而非「第几天」对齐，避免 30 / 31 天账期错位 */
    var idx = Math.max(1, Math.min(prevTotal, Math.round(prog.pct * prevTotal)));
    var prevSameDay = D.addDays(prevStart, idx - 1);
    var prevAccum = M.sum(accumFlows(S, key, prevP, prevSameDay), function (f) { return f.fee_amount; });
    var prevFull = M.sum(accumFlows(S, key, prevP, prevEnd), function (f) { return f.fee_amount; });
    var ratio = prevAccum ? prevFull / prevAccum : 0;
    var peer = ratio ? M.r2(curAccum * ratio) : 0;
    var spread = (linear && peer) ? Math.abs(linear - peer) / Math.max(linear, peer) : 0;
    /* 落点是一个区间，不是一个数。把区间给出去，比给一个假装精确的数诚实。
       注意：这里预测的只是<b>本期费用</b>；调整项与上期结转是已知定量，由调用方叠加。 */
    var lo = peer ? Math.min(linear, peer) : linear;
    var hi = peer ? Math.max(linear, peer) : linear;
    return { linear: linear, peer: peer, hasPeer: !!prevAccum, feeLo: M.r2(lo), feeHi: M.r2(hi),
      prevPeriod: prevP, prevSameDay: prevSameDay, prevAccum: M.r2(prevAccum), prevFull: M.r2(prevFull),
      ratio: ratio, spread: spread,
      /* 环比用「上期全月」比，口径与 V-B08 一致 */
      wave: prevFull ? ((peer || linear) - prevFull) / prevFull : 0 };
  }

  /* ---------------- 单个组合的预出账 ---------------- */
  function buildGroup(S, key, period, asOf) {
    var prog = progress(period, asOf);
    var flows = accumFlows(S, key, period, asOf);
    var details = detailsOf(flows);
    var cur = M.sum(details, function (d) { return d.amount; });

    var adjs = S.adjustments.filter(function (a) {
      return a.partner_no === key.partner_no && a.agreement_no === key.agreement_no &&
        a.direction === key.direction && a.settle_in_period === period;
    });
    var adjSum = M.sum(adjs, function (a) { return a.amount; });
    var carries = (S.carryForwards || []).filter(function (c) {
      return c.partner_no === key.partner_no && c.agreement_no === key.agreement_no &&
        c.direction === key.direction && c.period === period && !c.bill_no;
    });
    var carry = M.sum(carries, function (c) { return c.amount; });
    var total = M.r2(cur + adjSum + carry);
    var taxRate = details.length ? details[0].tax_rate : 0.06;
    var tt = M.splitTax(total, taxRate);

    /* 校验：与正式出账同源，只是把两条与「账期已结束」绑定的标为不适用 */
    /* 落点 = 预测的本期费用 + 已知的调整项 + 已知的上期结转。
       后两项不随账期推进而增长（调整项一经审批即定量、结转在上期结算时即确定），
       所以只对本期费用做预测，其余直接叠加 —— 否则会把一笔负调整也按进度外推，落点必偏。 */
    var fc = project(S, key, period, asOf, cur, prog);
    var known = M.r2(adjSum + carry);
    fc.known = known;
    fc.lo = M.r2(fc.feeLo + known);
    fc.hi = M.r2(fc.feeHi + known);

    var raw = Billing.billPreCheck(S, key.partner_no, key.agreement_no, period, key.direction);
    var checks = raw.checks.map(function (c) {
      if (DEFERRED[c.code]) {
        return { code: c.code, desc: c.desc, ok: true, level: c.level,
          deferred: true, msg: DEFERRED[c.code] };
      }
      var act = ACTIONABLE[c.code];
      return { code: c.code, desc: c.desc, ok: c.ok, level: c.level, msg: c.msg,
        actionable: !c.ok && !!act, route: act && act.route, actLabel: act && act.label, hint: act && act.hint };
    });
    var blockers = checks.filter(function (c) { return !c.ok && c.level === 'BLOCK'; });
    var warns = checks.filter(function (c) { return !c.ok && c.level === 'WARN'; });

    return {
      key: key, partner_no: key.partner_no, agreement_no: key.agreement_no, direction: key.direction,
      partner_name: (S.partnerMap[key.partner_no] || {}).partner_name || key.partner_no,
      period: period, as_of: asOf, progress: prog,
      details: details, flow_count: flows.length,
      current_period_amount: M.r2(cur), adjustment_amount: M.r2(adjSum), carry_forward_amount: M.r2(carry),
      total_amount: total, total_amount_ex_tax: tt.exTax, total_tax_amount: tt.tax,
      adjustments: adjs, carries: carries,
      forecast: fc,
      checks: checks, blockers: blockers, warns: warns,
      ready: blockers.length === 0
    };
  }

  /* ---------------- 全量预出账 ---------------- */
  function build(S, period, asOf, filterPartner) {
    var day = asOf || S.simToday;
    var keys = {}, out = [];
    function push(p, a, d) {
      var k = p + '|' + a + '|' + d;
      if (!keys[k]) { keys[k] = 1; out.push({ partner_no: p, agreement_no: a, direction: d }); }
    }
    S.eng.feeFlows.forEach(function (f) {
      if (f.billing_period !== period || f.is_cross_period === 1 || f.fee_date > day) return;
      push(f.partner_no, f.agreement_no, f.direction);
    });
    S.adjustments.forEach(function (a) {
      if (a.settle_in_period === period) push(a.partner_no, a.agreement_no, a.direction);
    });
    (S.carryForwards || []).forEach(function (c) {
      if (c.period === period && !c.bill_no) push(c.partner_no, c.agreement_no, c.direction);
    });

    var groups = out
      .filter(function (k) { return !filterPartner || k.partner_no === filterPartner; })
      .map(function (k) { return buildGroup(S, k, period, day); })
      .sort(function (a, b) { return b.total_amount - a.total_amount; });

    var actionable = [];
    groups.forEach(function (g) {
      g.checks.forEach(function (c) {
        if (c.actionable) actionable.push({ group: g, check: c });
      });
    });

    return {
      period: period, as_of: day, progress: progress(period, day),
      groups: groups,
      total: M.r2(M.sum(groups, function (g) { return g.total_amount; })),
      /* 全量落点同样给区间：各组合下界之和 ~ 上界之和 */
      projLo: M.r2(M.sum(groups, function (g) { return g.forecast.lo || g.total_amount; })),
      projHi: M.r2(M.sum(groups, function (g) { return g.forecast.hi || g.total_amount; })),
      readyCount: groups.filter(function (g) { return g.ready; }).length,
      blockedCount: groups.filter(function (g) { return !g.ready; }).length,
      actionable: actionable
    };
  }

  /* ---------------- 预出账快照 → 与正式账单比对 ----------------
   * 「预出账看到的 = 正式出账出来的」不是承诺，是可验证的断言。
   * 快照留档后，正式出账完再回来比一次差额，差在哪一项一目了然。 */
  function snapshot(pv, actor) {
    return {
      preview_no: 'PV' + pv.period.replace('-', '') + String(Date.now()).slice(-6),
      period: pv.period, as_of: pv.as_of, create_time: Core.nowStr ? Core.nowStr() : pv.as_of,
      creator: actor || '—',
      progress_pct: pv.progress.pct, total: pv.total,
      proj_lo: pv.projLo, proj_hi: pv.projHi,
      ready: pv.readyCount, blocked: pv.blockedCount,
      lines: pv.groups.map(function (g) {
        return { partner_no: g.partner_no, partner_name: g.partner_name,
          agreement_no: g.agreement_no, direction: g.direction,
          current_period_amount: g.current_period_amount,
          adjustment_amount: g.adjustment_amount, carry_forward_amount: g.carry_forward_amount,
          total_amount: g.total_amount,
          proj_lo: g.forecast.lo || g.total_amount, proj_hi: g.forecast.hi || g.total_amount,
          ready: g.ready, blockers: g.blockers.map(function (b) { return b.code; }) };
      })
    };
  }

  /** 快照 × 正式账单 逐项比对 */
  function compare(S, snap) {
    var rows = [], seen = {};
    snap.lines.forEach(function (l) {
      var k = l.partner_no + '|' + l.agreement_no + '|' + l.direction;
      seen[k] = 1;
      var bill = S.bills.filter(function (b) {
        return b.partner_no === l.partner_no && b.agreement_no === l.agreement_no &&
          b.direction === l.direction && b.billing_period === snap.period && b.status !== 'VOIDED';
      })[0];
      var act = bill ? bill.total_amount : null;
      rows.push({
        partner_no: l.partner_no, partner_name: l.partner_name, direction: l.direction,
        preview: l.total_amount, proj_lo: l.proj_lo, proj_hi: l.proj_hi,
        bill_no: bill ? bill.bill_no : '', actual: act,
        diff: bill ? M.r2(act - l.total_amount) : null,
        /* 落点区间是否套住了实际值 —— 这是对预测方法本身的检验 */
        inRange: bill ? (act >= l.proj_lo - 0.005 && act <= l.proj_hi + 0.005) : null,
        state: bill ? 'BOTH' : 'PREVIEW_ONLY'
      });
    });
    S.bills.forEach(function (b) {
      if (b.billing_period !== snap.period || b.status === 'VOIDED') return;
      var k = b.partner_no + '|' + b.agreement_no + '|' + b.direction;
      if (seen[k]) return;
      rows.push({ partner_no: b.partner_no,
        partner_name: (S.partnerMap[b.partner_no] || {}).partner_name || b.partner_no,
        direction: b.direction, preview: null, proj_lo: null, proj_hi: null,
        bill_no: b.bill_no, actual: b.total_amount, diff: null, inRange: null, state: 'BILL_ONLY' });
    });
    var matched = rows.filter(function (r) { return r.state === 'BOTH'; });
    return { rows: rows, matched: matched.length,
      exact: matched.filter(function (r) { return Math.abs(r.diff) < 0.005; }).length,
      inRange: matched.filter(function (r) { return r.inRange; }).length,
      previewOnly: rows.filter(function (r) { return r.state === 'PREVIEW_ONLY'; }).length,
      billOnly: rows.filter(function (r) { return r.state === 'BILL_ONLY'; }).length,
      maxDiff: M.r2(Math.max.apply(null, [0].concat(matched.map(function (r) { return Math.abs(r.diff); })))) };
  }

  global.Preview = {
    DEFERRED: DEFERRED, ACTIONABLE: ACTIONABLE,
    progress: progress, detailsOf: detailsOf, project: project,
    buildGroup: buildGroup, build: build, snapshot: snapshot, compare: compare
  };
})(window);
