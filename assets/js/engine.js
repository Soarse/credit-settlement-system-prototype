/* =============================================================================
 * engine.js —— 计费引擎内核（PRD 第 6 章）
 * 五要素：触发事件 + 计费对象 + 计费基数 + 费率模型 + 冲正机制
 *   费用金额 = RateModel.apply( Basis.evaluate(ChargeObject, SnapshotTime) )
 *
 * 关键不变式：
 *   ① 版本按业务事件发生日 occur_date 路由（5.4.3）
 *   ② 基数取值固化为 basis_snapshot，复算只读快照（6.3.3）
 *   ③ 费用流水 Append-Only，任何修正走红冲（6.7.2）
 *   ④ 幂等键 = event_id + charge_item_no + rule_version（6.6.1）
 *   ⑤ 试算与正式计费共用同一份计算内核，仅输出目标不同（5.7.2）
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  /* ===================== 引擎运行态 ===================== */
  function createState() {
    return {
      feeFlows: [],          // 费用流水（Append-Only）
      snapshots: [],         // 基数快照
      idem: {},              // 幂等表 event_id|item|ruleVersion -> fee_flow_no
      tierAccum: {},         // 阶梯累计基数 agreement|item|period -> amount
      flowsByEvent: {},      // event_id -> [fee_flow_no]
      flowsByNo: {},         // fee_flow_no -> flow
      reversedAmt: {},       // 原流水号 -> 已红冲金额绝对值合计（6.7.3 累计校验）
      closedPeriods: {},     // period -> true
      eventLog: []           // 引擎处理日志（用于「执行流程」可视化）
    };
  }

  /* ===================== 版本路由（5.4.3）===================== */
  function routeVersion(versions, agreementNo, occurDate) {
    for (var i = 0; i < versions.length; i++) {
      var v = versions[i];
      if (v.agreement_no !== agreementNo) continue;
      if (v.status !== 'EFFECTIVE' && v.status !== 'EXPIRED') continue;
      if (v.effective_date <= occurDate && occurDate < v.expiry_date) return v;
    }
    return null;
  }

  /* ===================== 版本区间不变式校验（5.4.2）===================== */
  function validateVersionIntervals(versions, agreement) {
    var vs = versions.filter(function (v) {
      return v.agreement_no === agreement.agreement_no &&
        (v.status === 'EFFECTIVE' || v.status === 'PENDING_EFFECTIVE' || v.status === 'EXPIRED');
    }).sort(function (a, b) { return a.effective_date < b.effective_date ? -1 : 1; });
    var issues = [];
    if (!vs.length) { issues.push({ type: 'EMPTY', msg: '协议下无任何生效版本' }); return { ok: false, issues: issues, versions: vs }; }
    if (vs[0].effective_date !== agreement.coop_start_date) {
      issues.push({ type: 'HEAD', msg: '首个版本生效日 ' + vs[0].effective_date + ' ≠ 合作起始日 ' + agreement.coop_start_date });
    }
    for (var i = 0; i + 1 < vs.length; i++) {
      if (vs[i].expiry_date !== vs[i + 1].effective_date) {
        issues.push({
          type: vs[i].expiry_date < vs[i + 1].effective_date ? 'GAP' : 'OVERLAP',
          msg: vs[i].version_no + ' 失效日 ' + vs[i].expiry_date + ' 与 ' + vs[i + 1].version_no +
            ' 生效日 ' + vs[i + 1].effective_date + (vs[i].expiry_date < vs[i + 1].effective_date ? ' 之间存在空洞' : ' 存在重叠'),
          from: vs[i].expiry_date, to: vs[i + 1].effective_date
        });
      }
    }
    var last = vs[vs.length - 1];
    if (last.expiry_date < agreement.coop_end_date) {
      issues.push({ type: 'TAIL', msg: '末版本失效日 ' + last.expiry_date + ' 未覆盖到合作结束日 ' + agreement.coop_end_date });
    }
    return { ok: issues.length === 0, issues: issues, versions: vs };
  }

  /* ===================== 过滤条件求值（6.3.4）===================== */
  function evalFilter(filter, ev) {
    var f = filter || {}, p = ev.payload || {}, hit = [], miss = [];
    function chk(name, pass, detail) { (pass ? hit : miss).push(name + (detail ? '(' + detail + ')' : '')); return pass; }
    var ok = true;
    if (f.product_codes && f.product_codes.length && f.product_codes[0] !== '*') {
      ok = chk('product_code IN', f.product_codes.indexOf(ev.product_code) >= 0, ev.product_code) && ok;
    }
    if (f.channel_codes && f.channel_codes.length && f.channel_codes[0] !== '*') {
      ok = chk('channel_code IN', f.channel_codes.indexOf(ev.channel_code) >= 0, ev.channel_code) && ok;
    }
    if (f.amount_range) {
      var amt = p.disburse_amount || p.principal_balance || p.repay_principal || 0;
      var pass = (f.amount_range.min === null || f.amount_range.min === undefined || amt >= f.amount_range.min) &&
        (f.amount_range.max === null || f.amount_range.max === undefined || amt <= f.amount_range.max);
      ok = chk('amount BETWEEN', pass, M.fmt(amt)) && ok;
    }
    if (f.overdue_days_range) {
      var od = p.overdue_days || 0;
      var pass2 = (f.overdue_days_range.min === null || f.overdue_days_range.min === undefined || od >= f.overdue_days_range.min) &&
        (f.overdue_days_range.max === null || f.overdue_days_range.max === undefined || od <= f.overdue_days_range.max);
      ok = chk('overdue_days BETWEEN', pass2, od + ' 天') && ok;
    }
    if (f.asset_tags_exclude && f.asset_tags_exclude.length) {
      ok = chk('asset_status NOT IN', f.asset_tags_exclude.indexOf(p.asset_status) < 0, p.asset_status || '—') && ok;
    }
    if (f.repay_source && f.repay_source.length) {
      ok = chk('repay_source IN', f.repay_source.indexOf(p.repay_source) >= 0, p.repay_source || '—') && ok;
    }
    return { ok: ok, hit: hit, miss: miss };
  }

  /* ===================== 计费基数取值（6.3）===================== */
  function evalBasis(basisCfg, ev) {
    var p = ev.payload || {}, raw = 0, srcType = 'EVENT', srcRef = ev.event_id;
    switch (basisCfg.type) {
      case 'EVENT_AMOUNT':
        if (Array.isArray(basisCfg.source_field)) {
          raw = basisCfg.source_field.reduce(function (s, f) { return s + (p[f] || 0); }, 0);
        } else raw = p[basisCfg.source_field] || 0;
        break;
      case 'OUTSTANDING_BALANCE':
        raw = p.principal_balance || 0; srcType = 'DAILY_SNAPSHOT';
        srcRef = p.loan_no + '@' + p.snapshot_date + '#v' + (p.snapshot_version || 1);
        break;
      case 'OUTSTANDING_PRIN_INT':
        raw = (p.principal_balance || 0) + (p.interest_receivable || 0); srcType = 'DAILY_SNAPSHOT';
        srcRef = p.loan_no + '@' + p.snapshot_date; break;
      case 'OVERDUE_BALANCE':
        raw = (p.overdue_days || 0) >= (basisCfg.overdue_threshold || 1) ? (p.principal_balance || 0) : 0;
        srcType = 'DAILY_SNAPSHOT'; srcRef = p.loan_no + '@' + p.snapshot_date; break;
      case 'EVENT_COUNT': raw = 1; break;
      default: raw = 0;
    }
    if (raw === null || raw === undefined || isNaN(raw)) return { error: 'BASIS_NOT_FOUND' };
    var ratio = basisCfg.funding_ratio_apply ? (p.funding_ratio === undefined || p.funding_ratio === null ? 1 : p.funding_ratio) : 1;
    return { amount: M.mul(raw, ratio, 6), raw: raw, ratio: ratio, srcType: srcType, srcRef: srcRef };
  }

  /* ===================== 阶梯计算（6.4.4 / 6.4.5）===================== */
  function tierCalc(tiers, base, flat) {
    if (base <= 0) return 0;
    if (flat) {
      var r = 0;
      for (var k = 0; k < tiers.length; k++) {
        var t = tiers[k];
        if (base > t.lower && (t.upper === null || t.upper === undefined || base <= t.upper)) { r = t.ratio; break; }
        if (t.upper === null || t.upper === undefined) r = t.ratio;
      }
      return M.mul(base, r, 2);
    }
    var total = 0;
    for (var i = 0; i < tiers.length; i++) {
      var ti = tiers[i];
      if (base <= ti.lower) continue;
      var up = (ti.upper === null || ti.upper === undefined) ? base : Math.min(base, ti.upper);
      total = M.sum([total, M.mul(up - ti.lower, ti.ratio, 2)]);   // 每档分别舍入至分，再求和（6.4.9）
    }
    return M.r2(total);
  }

  /* ===================== 费率模型（6.4）===================== */
  function applyRate(rateCfg, basisAmount, st, accumKey) {
    var detail = {};
    switch (rateCfg.type) {
      case 'FIXED_RATIO':
        detail = { formula: '基数 × 费率', expr: M.fmt(basisAmount) + ' × ' + M.pct(rateCfg.ratio, 3) };
        return { amount: M.mul(basisAmount, rateCfg.ratio, 2), detail: detail };
      case 'FIXED_AMOUNT':
        detail = { formula: '单价 × 数量', expr: M.fmt(rateCfg.unit_price) + ' × ' + basisAmount };
        return { amount: M.mul(rateCfg.unit_price || 0, basisAmount, 2), detail: detail };
      case 'DAILY_RATE':
        var dr = rateCfg.annual_ratio / (rateCfg.day_count_basis || 360);
        detail = { formula: '日终余额 × (年化 ÷ 基准)', dailyRate: dr,
          expr: M.fmt(basisAmount) + ' × ' + (dr * 100).toFixed(6) + '%' };
        return { amount: M.mul(basisAmount, dr, 2), detail: detail };
      case 'TIER_PROGRESSIVE':
      case 'TIER_FLAT':
        var flat = rateCfg.type === 'TIER_FLAT';
        var before = st.tierAccum[accumKey] || 0;
        var after = M.r2(before + basisAmount);
        var cBefore = tierCalc(rateCfg.tiers, before, flat);
        var cAfter = tierCalc(rateCfg.tiers, after, flat);
        st.tierAccum[accumKey] = after;
        detail = { formula: '增量法：TierCalc(累计后) − TierCalc(累计前)',
          accumBefore: before, accumAfter: after, calcBefore: cBefore, calcAfter: cAfter,
          expr: M.fmt(cAfter) + ' − ' + M.fmt(cBefore) };
        return { amount: M.r2(cAfter - cBefore), detail: detail };
      default:
        return { amount: 0, detail: { formula: '未知费率模型' } };
    }
  }

  /* ===================== 生成一条费用流水 ===================== */
  function mkFlow(o) {
    var incl = M.r2(o.fee_amount);
    var tax = M.splitTax(incl, o.tax_rate);
    return Object.assign({
      fee_flow_no: '', event_id: '', agreement_no: '', agreement_version_id: 0,
      rule_no: '', rule_version: '', basis_snapshot_no: '', partner_no: '',
      charge_item_no: '', charge_item_code: '', charge_item_name: '',
      charge_object_level: 'LOAN', charge_object_id: '',
      basis_amount: 0, rate_snapshot: null,
      fee_amount: incl, fee_amount_ex_tax: tax.exTax, tax_amount: tax.tax, tax_rate: o.tax_rate,
      direction: 'RECEIVABLE', currency: 'CNY', fee_date: '', billing_period: '',
      flow_type: 'NORMAL', original_fee_flow_no: '', reversal_reason: '',
      is_cross_period: 0, origin_period: '', bill_no: '', recon_status: 'PENDING',
      reversal_policy: 'PROPORTIONAL', calc_detail: null, create_time: ''
    }, o, { fee_amount: incl, fee_amount_ex_tax: tax.exTax, tax_amount: tax.tax });
  }

  /* ===================== 主流程：处理单个事件（6.5.1）===================== */
  function processEvent(st, ev, ctx) {
    var log = { event_id: ev.event_id, steps: [] };
    function step(name, result, note) { log.steps.push({ name: name, result: result, note: note || '' }); }

    // 1. 幂等校验
    if (ev.__duplicate || st.idem['EVT|' + ev.event_id]) {
      ev.status = 'IGNORED'; ev.ignore_reason = 'DUPLICATE';
      step('幂等校验', 'DUP', '相同 event_id 已处理，直接返回成功');
      st.eventLog.push(log); return { flows: [], ignored: 'DUPLICATE' };
    }
    st.idem['EVT|' + ev.event_id] = 1;
    step('幂等校验', 'PASS', '幂等键 event_id + charge_item_no + rule_version');

    // 2. 反向事件走冲正分支
    if (ev.event_code === 'EV_DISBURSE_REVERSE' || ev.event_code === 'EV_REPAY_REVERSE' || ev.event_code === 'EV_REFUND') {
      var r = processReversal(st, ev, ctx, step);
      st.eventLog.push(log); return r;
    }

    // 3. 资金方状态 → 协议解析
    var partner = ctx.partners.filter(function (p) { return p.partner_no === ev.partner_no; })[0];
    if (partner && partner.status === 'SUSPENDED') {
      ev.status = 'IGNORED'; ev.ignore_reason = 'PARTNER_SUSPENDED';
      step('资金方状态', 'FAIL', '资金方已暂停合作，不新增计费（告警）');
      st.eventLog.push(log); return { flows: [], ignored: 'PARTNER_SUSPENDED' };
    }
    var agr = ctx.agreements.filter(function (a) { return a.agreement_no === ev.agreement_no; })[0];
    if (!agr) {
      ev.status = 'IGNORED'; ev.ignore_reason = 'NO_AGREEMENT';
      step('协议解析', 'FAIL', '找不到协议 ' + ev.agreement_no + '（告警）');
      st.eventLog.push(log); return { flows: [], ignored: 'NO_AGREEMENT' };
    }
    step('协议解析', 'PASS', agr.agreement_no);

    // 4. 版本路由（按 occur_date）
    var ver = routeVersion(ctx.versions, ev.agreement_no, ev.occur_date);
    if (!ver) {
      ev.status = 'IGNORED'; ev.ignore_reason = 'NO_VERSION';
      step('版本路由', 'FAIL', '事件发生日 ' + ev.occur_date + ' 无生效版本（告警）');
      st.eventLog.push(log); return { flows: [], ignored: 'NO_VERSION' };
    }
    step('版本路由', 'PASS', ver.version_no + '  [' + ver.effective_date + ', ' + ver.expiry_date + ')');

    // 5. 遍历计费项 → 规则过滤 → 基数 → 费率 → 流水
    var flows = [], matched = 0;
    ver.items.forEach(function (it) {
      var rule = it.rule;
      if (!rule || it.status !== 'ENABLED') return;
      if (rule.trigger.event_code !== ev.event_code) return;
      var fr = evalFilter(rule.trigger.event_filter, ev);
      if (!fr.ok) { step('规则过滤 · ' + it.charge_item_no, 'MISS', fr.miss.join(', ')); return; }
      matched++;

      var idemKey = ev.event_id + '|' + it.charge_item_no + '|' + ver.agreement_version_id;
      if (st.idem[idemKey]) return;

      // 基数取值 + 快照固化
      var b = evalBasis(rule.basis, ev);
      if (b.error) {
        ev.status = 'FAILED'; step('基数取值 · ' + it.charge_item_no, 'FAIL', '基数取不到，进待处理队列');
        return;
      }
      var snap = {
        snapshot_no: Core.No.snapshot(ev.occur_date), basis_type: rule.basis.type,
        basis_amount: b.amount, source_type: b.srcType, source_ref: b.srcRef,
        source_raw: ev.payload, funding_ratio: b.ratio,
        filter_result: { hit: fr.hit, miss: fr.miss }, snapshot_time: ev.receive_time
      };
      st.snapshots.push(snap);

      // 费率计算
      var accumKey = ev.agreement_no + '|' + it.charge_item_no + '|' + D.period(ev.occur_date);
      var res = applyRate(rule.rate_model, b.amount, st, accumKey);

      var period = D.period(ev.occur_date);
      var cross = st.closedPeriods[period] ? 1 : 0;
      var flow = mkFlow({
        fee_flow_no: Core.No.feeFlow(ev.occur_date), event_id: ev.event_id,
        agreement_no: ev.agreement_no, agreement_version_id: ver.agreement_version_id,
        rule_no: rule.rule_no, rule_version: ver.version_no, basis_snapshot_no: snap.snapshot_no,
        partner_no: ev.partner_no, charge_item_no: it.charge_item_no,
        charge_item_code: it.charge_item_code, charge_item_name: it.charge_item_name,
        charge_object_level: rule.charge_object.level, charge_object_id: ev.biz_key,
        basis_amount: b.amount, rate_snapshot: rule.rate_model,
        fee_amount: res.amount, tax_rate: it.tax_rate, direction: it.direction,
        fee_date: ev.occur_date, billing_period: period,
        flow_type: 'NORMAL', reversal_policy: rule.reversal_policy,
        calc_detail: res.detail, create_time: ev.receive_time,
        is_cross_period: cross, origin_period: cross ? period : ''
      });
      st.feeFlows.push(flow);
      st.flowsByNo[flow.fee_flow_no] = flow;
      (st.flowsByEvent[ev.event_id] || (st.flowsByEvent[ev.event_id] = [])).push(flow.fee_flow_no);
      st.idem[idemKey] = flow.fee_flow_no;
      flows.push(flow);
      step('计费 · ' + it.charge_item_no, 'OK',
        '基数 ' + M.fmt(b.amount) + ' → 费用 ' + M.fmt(res.amount) + '（' + res.detail.expr + '）');
    });

    if (!matched) {
      ev.status = 'IGNORED'; ev.ignore_reason = 'NO_RULE_MATCH';
    } else {
      ev.status = flows.length ? 'CHARGED' : (ev.status === 'FAILED' ? 'FAILED' : 'IGNORED');
      if (ev.status === 'IGNORED' && !ev.ignore_reason) ev.ignore_reason = 'NO_RULE_MATCH';
    }
    st.eventLog.push(log);
    return { flows: flows };
  }

  /* ===================== 冲正（6.7）===================== */
  function processReversal(st, ev, ctx, step) {
    var originId = ev.payload.origin_event_id;
    var originFlowNos = st.flowsByEvent[originId] || [];
    if (!originFlowNos.length) {
      ev.status = 'PENDING'; ev.ignore_reason = 'PENDING_ORIGIN';
      step('定位原流水', 'FAIL', '未找到原事件 ' + originId + ' 的费用流水，进 PENDING_ORIGIN 队列（24h 超时告警）');
      return { flows: [], ignored: 'PENDING_ORIGIN' };
    }
    step('定位原流水', 'PASS', originFlowNos.join(', '));
    var reverseAmt = ev.payload.reverse_amount || ev.payload.refund_amount || 0;
    var flows = [];
    originFlowNos.forEach(function (no) {
      var of = st.flowsByNo[no];
      if (!of) return;
      if (of.reversal_policy === 'NONE') {
        step('冲正策略 · ' + of.charge_item_no, 'SKIP', '策略 NONE，不生成红冲流水');
        return;
      }
      var origBasis = of.basis_amount || 0;
      var amt;
      if (of.reversal_policy === 'FULL') amt = of.fee_amount;
      else amt = M.mul(of.fee_amount, (origBasis > 0 ? Math.min(1, M.div(reverseAmt, origBasis, 9)) : 1), 2);

      // 6.7.3 部分冲正累计校验：Σ|红冲| ≤ 原流水金额
      var already = st.reversedAmt[no] || 0;
      if (M.r2(already + amt) > M.r2(Math.abs(of.fee_amount)) + 0.001) {
        step('累计校验 · ' + of.charge_item_no, 'BLOCK',
          '重复冲正拦截：已冲 ' + M.fmt(already) + ' + 本次 ' + M.fmt(amt) + ' > 原流水 ' + M.fmt(of.fee_amount));
        ev.status = 'FAILED'; ev.ignore_reason = 'REVERSAL_EXCEED';
        return;
      }
      st.reversedAmt[no] = M.r2(already + amt);

      var period = D.period(ev.occur_date);
      var crossPeriod = of.billing_period !== period && st.closedPeriods[of.billing_period] ? 1 : 0;
      var rf = mkFlow({
        fee_flow_no: Core.No.feeFlow(ev.occur_date), event_id: ev.event_id,
        agreement_no: of.agreement_no, agreement_version_id: of.agreement_version_id,
        rule_no: of.rule_no, rule_version: of.rule_version, basis_snapshot_no: of.basis_snapshot_no,
        partner_no: of.partner_no, charge_item_no: of.charge_item_no,
        charge_item_code: of.charge_item_code, charge_item_name: of.charge_item_name,
        charge_object_level: of.charge_object_level, charge_object_id: of.charge_object_id,
        basis_amount: -M.mul(origBasis, (of.reversal_policy === 'FULL' ? 1 : (origBasis > 0 ? Math.min(1, M.div(reverseAmt, origBasis, 9)) : 1)), 2),
        rate_snapshot: of.rate_snapshot, fee_amount: -amt, tax_rate: of.tax_rate,
        direction: of.direction, fee_date: ev.occur_date,
        billing_period: crossPeriod ? period : of.billing_period,
        flow_type: 'REVERSAL', original_fee_flow_no: of.fee_flow_no,
        reversal_reason: ev.event_code, reversal_policy: of.reversal_policy,
        is_cross_period: crossPeriod, origin_period: crossPeriod ? of.billing_period : '',
        calc_detail: { formula: of.reversal_policy === 'FULL' ? '全额冲正' : '按比例冲正',
          expr: M.fmt(of.fee_amount) + ' × (' + M.fmt(reverseAmt) + ' ÷ ' + M.fmt(origBasis) + ') = ' + M.fmt(amt) },
        create_time: ev.receive_time
      });
      st.feeFlows.push(rf);
      st.flowsByNo[rf.fee_flow_no] = rf;
      (st.flowsByEvent[ev.event_id] || (st.flowsByEvent[ev.event_id] = [])).push(rf.fee_flow_no);
      flows.push(rf);
      step('红冲 · ' + of.charge_item_no, 'OK',
        '生成负金额流水 ' + M.fmt(-amt) + (crossPeriod ? '（跨账期，计入下期调整项 D-06）' : ''));

      // 阶梯累计基数回退（5.5.3 tier_accum_reverse_deduct）
      var rm = of.rate_snapshot;
      if (rm && (rm.type === 'TIER_PROGRESSIVE' || rm.type === 'TIER_FLAT') && rm.tier_accum_reverse_deduct !== false) {
        var ak = of.agreement_no + '|' + of.charge_item_no + '|' + of.billing_period;
        st.tierAccum[ak] = M.r2((st.tierAccum[ak] || 0) - origBasis);
        step('阶梯累计回退', 'OK', '累计基数扣减 ' + M.fmt(origBasis) + ' → ' + M.fmt(st.tierAccum[ak]));
      }
    });
    // 原事件状态
    var oEv = ctx.eventsById && ctx.eventsById[originId];
    if (oEv) oEv.status = 'REVERSED';
    ev.status = flows.length ? 'CHARGED' : (ev.status === 'FAILED' ? 'FAILED' : 'IGNORED');
    if (ev.status === 'IGNORED' && !ev.ignore_reason) ev.ignore_reason = 'NO_RULE_MATCH';
    return { flows: flows };
  }

  /* ===================== 账期结束：阶梯找平 + 保底封顶（6.4.6 / 6.4.7）===================== */
  function periodClose(st, period, ctx) {
    var produced = [];
    var closeDate = D.periodEnd(period);
    ctx.versions.forEach(function (ver) {
      if (ver.status !== 'EFFECTIVE' && ver.status !== 'EXPIRED') return;
      var agr = ctx.agreements.filter(function (a) { return a.agreement_no === ver.agreement_no; })[0];
      if (!agr) return;
      // 该版本在本账期内是否生效过
      if (ver.expiry_date <= D.periodStart(period) || ver.effective_date > D.periodEnd(period)) return;
      ver.items.forEach(function (it) {
        var rm = it.rule && it.rule.rate_model; if (!rm) return;
        var itemFlows = st.feeFlows.filter(function (f) {
          return f.agreement_no === ver.agreement_no && f.charge_item_no === it.charge_item_no &&
            f.billing_period === period && f.is_cross_period === 0;
        });
        // 同一计费项在跨版本时会重复遍历，只处理一次
        if (produced.some(function (p) { return p.__key === ver.agreement_no + '|' + it.charge_item_no; })) return;

        // ① 阶梯找平
        if ((rm.type === 'TIER_PROGRESSIVE' || rm.type === 'TIER_FLAT') && rm.tier_trueup_enabled !== false) {
          var accumKey = ver.agreement_no + '|' + it.charge_item_no + '|' + period;
          var finalAccum = st.tierAccum[accumKey] || 0;
          var shouldTotal = tierCalc(rm.tiers, finalAccum, rm.type === 'TIER_FLAT');
          var chargedTotal = M.sum(itemFlows, function (f) { return f.fee_amount; });
          var trueup = M.r2(shouldTotal - chargedTotal);
          if (Math.abs(trueup) >= 0.01) {
            var tf = mkFlow({
              fee_flow_no: Core.No.feeFlow(closeDate), event_id: 'PERIOD_CLOSE|' + ver.agreement_no + '|' + it.charge_item_no + '|' + period,
              agreement_no: ver.agreement_no, agreement_version_id: ver.agreement_version_id,
              rule_no: it.rule.rule_no, rule_version: ver.version_no, basis_snapshot_no: '',
              partner_no: agr.partner_no, charge_item_no: it.charge_item_no,
              charge_item_code: it.charge_item_code, charge_item_name: it.charge_item_name,
              charge_object_level: 'PARTNER', charge_object_id: agr.partner_no,
              basis_amount: finalAccum, rate_snapshot: rm, fee_amount: trueup, tax_rate: it.tax_rate,
              direction: it.direction, fee_date: closeDate, billing_period: period,
              flow_type: 'TIER_TRUEUP', reversal_policy: 'NONE',
              calc_detail: { formula: '找平 = TierCalc(期末累计) − 已计费合计',
                expr: M.fmt(shouldTotal) + ' − ' + M.fmt(chargedTotal) + ' = ' + M.fmtSigned(trueup),
                accumFinal: finalAccum, shouldTotal: shouldTotal, chargedTotal: chargedTotal },
              create_time: closeDate + 'T00:30:00+08:00'
            });
            st.feeFlows.push(tf); st.flowsByNo[tf.fee_flow_no] = tf;
            tf.__key = ver.agreement_no + '|' + it.charge_item_no;
            produced.push(tf);
            itemFlows.push(tf);
          }
        }
        // ② 保底 / 封顶
        var total = M.sum(itemFlows, function (f) { return f.fee_amount; });
        var adj = 0, ftype = '';
        if (rm.floor_amount !== undefined && rm.floor_amount !== null && total < rm.floor_amount) {
          adj = M.r2(rm.floor_amount - total); ftype = 'FLOOR_ADJUST';
        } else if (rm.cap_amount !== undefined && rm.cap_amount !== null && total > rm.cap_amount) {
          adj = M.r2(rm.cap_amount - total); ftype = 'CAP_ADJUST';
        }
        if (ftype && Math.abs(adj) >= 0.01) {
          var ff = mkFlow({
            fee_flow_no: Core.No.feeFlow(closeDate),
            event_id: 'PERIOD_CLOSE|' + ver.agreement_no + '|' + it.charge_item_no + '|' + period,
            agreement_no: ver.agreement_no, agreement_version_id: ver.agreement_version_id,
            rule_no: it.rule.rule_no, rule_version: ver.version_no, basis_snapshot_no: '',
            partner_no: agr.partner_no, charge_item_no: it.charge_item_no,
            charge_item_code: it.charge_item_code, charge_item_name: it.charge_item_name,
            charge_object_level: 'PARTNER', charge_object_id: agr.partner_no,
            basis_amount: 0, rate_snapshot: rm, fee_amount: adj, tax_rate: it.tax_rate,
            direction: it.direction, fee_date: closeDate, billing_period: period,
            flow_type: ftype, reversal_policy: 'NONE',
            calc_detail: { formula: ftype === 'FLOOR_ADJUST' ? '保底差额 = 保底金额 − 本期合计' : '封顶差额 = 封顶金额 − 本期合计',
              expr: M.fmt(ftype === 'FLOOR_ADJUST' ? rm.floor_amount : rm.cap_amount) + ' − ' + M.fmt(total) + ' = ' + M.fmtSigned(adj) },
            create_time: closeDate + 'T00:35:00+08:00'
          });
          st.feeFlows.push(ff); st.flowsByNo[ff.fee_flow_no] = ff;
          ff.__key = ver.agreement_no + '|' + it.charge_item_no;
          produced.push(ff);
        }
      });
    });
    st.closedPeriods[period] = true;
    return produced;
  }

  /* ===================== 批量处理 ===================== */
  function processEvents(st, events, ctx) {
    var out = [];
    events.forEach(function (e) {
      if (e.__holdPending) { e.status = 'PENDING'; return; }
      out.push(processEvent(st, e, ctx));
    });
    return out;
  }

  /* ===================== 试算 / 影子计算（5.7 / 6.9.3）=====================
   * 复用同一内核：把 versions 替换为「待验证版本集合」，输出到独立的 state。
   * ======================================================================= */
  function shadowRun(events, ctx, versionsOverride) {
    var st = createState();
    var c = Object.assign({}, ctx, { versions: versionsOverride || ctx.versions });
    var evs = Core.deep(events);
    evs.forEach(function (e) { e.status = 'PENDING'; e.ignore_reason = ''; });
    c.eventsById = Core.byId(evs, 'event_id');
    processEvents(st, evs, c);
    // 影子运行同样执行账期结束处理
    Core.uniq(evs.map(function (e) { return D.period(e.occur_date); })).sort().forEach(function (p) {
      periodClose(st, p, c);
    });
    return st;
  }

  /* ===================== 规则自然语言预览（5.10）===================== */
  function ruleToText(item) {
    var r = item.rule; if (!r) return '（未配置规则）';
    var evName = (Data.EVENT_DICT.filter(function (e) { return e.code === r.trigger.event_code; })[0] || {}).name || r.trigger.event_code;
    var objMap = { LOAN: '每笔借据', CONTRACT: '每份合同', CUSTOMER: '每位客户', ASSET_POOL: '每个资产包', PARTNER: '资金方整体' };
    var basisMap = {
      EVENT_AMOUNT: '事件金额', OUTSTANDING_BALANCE: '日终在贷本金余额',
      OUTSTANDING_PRIN_INT: '含息在贷余额', OVERDUE_BALANCE: '逾期资产余额',
      PERIOD_AGGREGATE: '周期聚合金额', DAILY_AVERAGE: '日均在贷余额', EVENT_COUNT: '事件笔数'
    };
    var basisTxt = basisMap[r.basis.type] || r.basis.type;
    if (r.basis.type === 'EVENT_AMOUNT') {
      var f = Array.isArray(r.basis.source_field) ? r.basis.source_field.join(' + ') : r.basis.source_field;
      var fMap = { disburse_amount: '放款本金', repay_principal: '回款本金', repay_interest: '回款利息' };
      basisTxt = (Array.isArray(r.basis.source_field) ? r.basis.source_field : [r.basis.source_field])
        .map(function (x) { return fMap[x] || x; }).join(' + ');
    }
    if (r.basis.funding_ratio_apply) basisTxt += ' × 出资比例';
    var rateTxt;
    var rm = r.rate_model;
    if (rm.type === 'FIXED_RATIO') rateTxt = '固定比例 ' + M.pct(rm.ratio, 3);
    else if (rm.type === 'FIXED_AMOUNT') rateTxt = '固定金额 ' + M.fmt(rm.unit_price) + ' 元/笔';
    else if (rm.type === 'DAILY_RATE') rateTxt = '日费率（年化 ' + M.pct(rm.annual_ratio, 2) + '，基准 ' + rm.day_count_basis + ' 天，日费率 ' + (rm.annual_ratio / rm.day_count_basis * 100).toFixed(6) + '%）';
    else if (rm.type === 'TIER_PROGRESSIVE') rateTxt = '阶梯【分档累进计算】共 ' + rm.tiers.length + ' 档';
    else if (rm.type === 'TIER_FLAT') rateTxt = '阶梯【整体适用最高档费率】共 ' + rm.tiers.length + ' 档';
    else rateTxt = rm.type;

    var filters = [];
    var f2 = r.trigger.event_filter || {};
    if (f2.product_codes && f2.product_codes[0] !== '*') filters.push('产品限 ' + f2.product_codes.join('/'));
    if (f2.channel_codes && f2.channel_codes[0] !== '*') filters.push('渠道限 ' + f2.channel_codes.join('/'));
    if (f2.overdue_days_range) filters.push('逾期天数 ' + (f2.overdue_days_range.min || 0) + '–' + (f2.overdue_days_range.max === null ? '∞' : f2.overdue_days_range.max) + ' 天');
    if (f2.asset_tags_exclude) filters.push('排除资产状态 ' + f2.asset_tags_exclude.join('/'));
    if (f2.repay_source) filters.push('回款来源限 ' + f2.repay_source.join('/'));

    var extra = [];
    if (rm.floor_amount) extra.push('设月度保底 ' + M.fmt(rm.floor_amount) + ' 元');
    if (rm.cap_amount) extra.push('设封顶 ' + M.fmt(rm.cap_amount) + ' 元');
    var cycleMap = { DAILY: '按日', WEEKLY: '按周', MONTHLY: '按月', QUARTERLY: '按季' };
    var granMap = { PER_EVENT: '每事件一条流水', PER_DAY: '每日一条流水', PER_PERIOD: '每账期一条流水' };

    return '当发生【' + evName + '】时' + (filters.length ? '（' + filters.join('；') + '）' : '') +
      '，对【' + (objMap[r.charge_object.level] || r.charge_object.level) + '】，' +
      '以【' + basisTxt + '】为计费基数，适用【' + rateTxt + '】，' +
      (item.tax_included ? '计算结果为含税价' : '计算结果为不含税价') + '，税率 ' + M.pct(item.tax_rate, 0) + '，' +
      '【' + (item.direction === 'RECEIVABLE' ? '我方向资金方收取' : '我方向资金方支付') + '】，' +
      '【' + (cycleMap[item.settle_cycle] || item.settle_cycle) + '结算】，' +
      granMap[r.output.fee_flow_granularity] + '，四舍五入至分' +
      (extra.length ? '，' + extra.join('，') : '') +
      '；冲正策略：' + ({ FULL: '全额冲正', PROPORTIONAL: '按比例冲正', NONE: '不冲正' }[r.reversal_policy]) + '。';
  }

  /* ===================== 规则校验（5.3.4 V-R01~R09）===================== */
  function validateRules(version, agreement, opts) {
    opts = opts || {};
    var results = [];
    function add(code, ok, msg) {
      var def = Data.RULE_CHECKS.filter(function (c) { return c.code === code; })[0] || {};
      results.push({ code: code, ok: ok, level: def.level, desc: def.desc, msg: msg || '' });
    }
    var evCodes = Data.EVENT_DICT.map(function (e) { return e.code; });
    var okAll = true, sigSet = {};
    version.items.forEach(function (it) {
      var r = it.rule; if (!r) return;
      okAll = evCodes.indexOf(r.trigger.event_code) >= 0 && okAll;
      // V-R02 基数与事件兼容
      var balBasis = ['OUTSTANDING_BALANCE', 'OUTSTANDING_PRIN_INT', 'OVERDUE_BALANCE'];
      if (balBasis.indexOf(r.basis.type) >= 0 && r.trigger.event_code !== 'EV_DAILY_BALANCE') okAll = false;
    });
    add('V-R01', version.items.every(function (it) { return !it.rule || evCodes.indexOf(it.rule.trigger.event_code) >= 0; }),
      '全部触发事件均在事件字典内');
    add('V-R02', version.items.every(function (it) {
      if (!it.rule) return true;
      var bal = ['OUTSTANDING_BALANCE', 'OUTSTANDING_PRIN_INT', 'OVERDUE_BALANCE'];
      return bal.indexOf(it.rule.basis.type) < 0 || it.rule.trigger.event_code === 'EV_DAILY_BALANCE';
    }), '余额型基数只能配 EV_DAILY_BALANCE');
    add('V-R03', version.items.every(function (it) {
      if (!it.rule) return true;
      if (it.rule.rate_model.type !== 'DAILY_RATE') return true;
      return ['OUTSTANDING_BALANCE', 'OUTSTANDING_PRIN_INT', 'OVERDUE_BALANCE'].indexOf(it.rule.basis.type) >= 0;
    }), 'DAILY_RATE 只能配余额型基数');
    var dupe = false;
    version.items.forEach(function (it) {
      if (!it.rule) return;
      var sig = it.rule.trigger.event_code + '|' + it.rule.charge_object.level + '|' + JSON.stringify(it.rule.trigger.event_filter || {});
      if (sigSet[sig]) dupe = true; sigSet[sig] = 1;
    });
    add('V-R04', !dupe, dupe ? '存在两条规则命中相同「事件 + 计费对象 + 过滤条件」组合' : '无重叠规则');
    var tierOk = true, tierMsg = '无阶梯规则或档位连续';
    version.items.forEach(function (it) {
      var rm = it.rule && it.rule.rate_model;
      if (!rm || !rm.tiers) return;
      var ts = rm.tiers.slice().sort(function (a, b) { return a.lower - b.lower; });
      if (ts[0].lower !== 0) { tierOk = false; tierMsg = '首档下界必须为 0'; }
      for (var i = 0; i + 1 < ts.length; i++) {
        if (ts[i].upper !== ts[i + 1].lower) { tierOk = false; tierMsg = '第 ' + (i + 1) + ' 档与第 ' + (i + 2) + ' 档不连续'; }
      }
      if (ts[ts.length - 1].upper !== null && ts[ts.length - 1].upper !== undefined) { tierOk = false; tierMsg = '末档上界必须为无穷大（null）'; }
    });
    add('V-R05', tierOk, tierMsg);
    var rateWarn = [];
    version.items.forEach(function (it) {
      var rm = it.rule && it.rule.rate_model; if (!rm) return;
      if (rm.type === 'FIXED_RATIO' && (rm.ratio <= 0 || rm.ratio > 1)) rateWarn.push(it.charge_item_no + ' 比例 ' + M.pct(rm.ratio));
      if (rm.type === 'DAILY_RATE' && (rm.annual_ratio / rm.day_count_basis) > 0.01) rateWarn.push(it.charge_item_no + ' 日费率超 1%');
    });
    add('V-R06', rateWarn.length === 0, rateWarn.length ? rateWarn.join('；') : '费率均在合理区间');
    add('V-R07', version.items.every(function (it) {
      var rm = it.rule && it.rule.rate_model; if (!rm) return true;
      if (rm.floor_amount != null && rm.cap_amount != null) return rm.floor_amount <= rm.cap_amount;
      return true;
    }), '保底不高于封顶');
    add('V-R08', version.effective_date >= agreement.coop_start_date &&
      (version.expiry_date === '9999-12-31' || version.expiry_date <= D.addDays(agreement.coop_end_date, 1)),
      '生效区间 [' + version.effective_date + ', ' + version.expiry_date + ') 落在合作期内');
    add('V-R09', !!opts.trialDone, opts.trialDone ? '已完成试算 ' + (opts.trialNo || '') : '尚未完成试算，禁止发布');
    return results;
  }

  global.Engine = {
    createState: createState, routeVersion: routeVersion, validateVersionIntervals: validateVersionIntervals,
    evalFilter: evalFilter, evalBasis: evalBasis, tierCalc: tierCalc, applyRate: applyRate,
    processEvent: processEvent, processEvents: processEvents, periodClose: periodClose,
    shadowRun: shadowRun, ruleToText: ruleToText, validateRules: validateRules, mkFlow: mkFlow
  };
})(window);
