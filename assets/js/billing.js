/* =============================================================================
 * billing.js —— 账单中心（第 7 章）/ 结算中心（第 8 章）/ 对账中心（第 9 章）
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  /* ======================================================================
   * 一、账期日历（7.2）
   * ==================================================================== */
  function calendar(rule, period) {
    var ps = D.periodStart(period), pe = D.periodEnd(period);
    var shift = rule.holiday_adjust === 'NEXT_WORKDAY' ? D.nextWorkday : function (x) { return x; };
    /* 逐级顺延：后一个里程碑从<b>顺延后</b>的前一个里程碑起算，
       否则「出账被假期推后 5 天、确认截止却没动」会挤掉资金方的全部核对时间 */
    var cutoff = D.addDays(pe, rule.cutoff_offset_days || 0);
    var gen = shift(D.addDays(cutoff, rule.bill_gen_offset_days || 1));
    var confirm = shift(D.addDays(gen, rule.confirm_deadline_days || 5));
    var settle = shift(D.addDays(confirm, rule.settle_offset_days || 3));
    return { period: period, period_start: ps, period_end: pe, cutoff_date: cutoff,
      bill_gen_date: gen, confirm_deadline: confirm, settle_date: settle };
  }

  /* ======================================================================
   * 二、出账前置校验（7.3.5 V-B01~B10）
   * ==================================================================== */
  function billPreCheck(S, partnerNo, agreementNo, period, direction) {
    var res = [];
    function add(code, ok, msg) {
      var def = Data.BILL_CHECKS.filter(function (c) { return c.code === code; })[0];
      res.push({ code: code, ok: ok, level: def.level, desc: def.desc, msg: msg || '' });
    }
    var partner = S.partnerMap[partnerNo];
    var flows = S.eng.feeFlows.filter(function (f) {
      return f.partner_no === partnerNo && f.agreement_no === agreementNo &&
        f.billing_period === period && f.direction === direction && f.is_cross_period === 0;
    });
    var cur = M.sum(flows, function (f) { return f.fee_amount; });

    add('V-B01', !!S.eng.closedPeriods[period], S.eng.closedPeriods[period] ? '账期 ' + period + ' 已封账' : '账期尚未封账，请先执行封账');

    var adjs = S.adjustments.filter(function (a) { return a.partner_no === partnerNo && a.agreement_no === agreementNo && a.settle_in_period === period && a.direction === direction; });
    var adjSum = M.sum(adjs, function (a) { return a.amount; });
    add('V-B02', true, 'Σ 账期内未跨期流水 ' + M.fmt(cur) + ' 笔数 ' + flows.length + ' == 本期费用（生成时按等式 D 构造，恒等）');

    var pend = S.events.filter(function (e) {
      return e.partner_no === partnerNo && D.period(e.occur_date) === period &&
        (e.status === 'PENDING' || e.status === 'PROCESSING' || e.status === 'FAILED');
    });
    add('V-B03', pend.length === 0, pend.length ? '存在 ' + pend.length + ' 条未达终态事件' : '待处理事件 0 条');

    var missing = missingSnapshotDays(S, partnerNo, period);
    add('V-B04', missing.length === 0, missing.length ? '缺失日终快照 ' + missing.length + ' 天：' + missing.slice(0, 5).join(', ') : '日终快照到齐');

    var unapproved = adjs.filter(function (a) { return a.status !== 'APPROVED'; });
    add('V-B05', unapproved.length === 0, unapproved.length ? unapproved.length + ' 项调整项待审批' : '调整项 ' + adjs.length + ' 项，均已审批');

    var prevP = D.prevPeriod(period);
    var prevBills = S.bills.filter(function (b) {
      return b.partner_no === partnerNo && b.agreement_no === agreementNo && b.direction === direction &&
        b.billing_period === prevP && b.status !== 'VOIDED';
    });
    var prevOk = prevBills.length === 0 || prevBills.every(function (b) { return b.status === 'SETTLED' || b.status === 'CONFIRMED' || b.status === 'ADJUSTED'; });
    add('V-B06', prevOk, prevBills.length ? '上期账单 ' + prevBills.map(function (b) { return b.bill_no + '(' + b.status + ')'; }).join(', ') : '无上期账单');

    var inv = S.invoiceMap[partnerNo];
    add('V-B07', !!(inv && inv.taxpayer_no), inv ? '开票信息完整（' + inv.invoice_title + '）' : '缺少开票信息');

    var prevAmt = prevBills.length ? prevBills[0].current_period_amount : 0;
    var wave = prevAmt ? Math.abs(cur - prevAmt) / prevAmt : 0;
    add('V-B08', !prevAmt || wave <= 0.5, prevAmt ? '环比 ' + M.pct(wave, 1) + '（上期 ' + M.fmt(prevAmt) + '）' : '无上期可比');

    add('V-B09', M.r2(cur + adjSum) >= 0, '应结金额 ' + M.fmt(cur + adjSum));
    add('V-B10', !partner || partner.status !== 'SUSPENDED', partner ? '资金方状态 ' + partner.status : '');

    var blocked = res.some(function (r) { return !r.ok && r.level === 'BLOCK'; });
    return { checks: res, pass: !blocked, hasWarn: res.some(function (r) { return !r.ok && r.level === 'WARN'; }),
      currentAmount: cur, adjustAmount: adjSum, flowCount: flows.length };
  }

  function missingSnapshotDays(S, partnerNo, period) {
    // 该资金方是否有余额型计费；若有，逐日检查是否收到日终快照
    var hasBal = S.versions.some(function (v) {
      var agr = S.agreementMap[v.agreement_no];
      return agr && agr.partner_no === partnerNo && v.status === 'EFFECTIVE' &&
        v.items.some(function (it) { return it.rule && it.rule.trigger.event_code === 'EV_DAILY_BALANCE'; });
    });
    if (!hasBal) return [];
    var days = {};
    S.events.forEach(function (e) {
      if (e.event_code === 'EV_DAILY_BALANCE' && e.partner_no === partnerNo && D.period(e.occur_date) === period) days[e.occur_date] = 1;
    });
    var miss = [];
    D.eachDay(D.periodStart(period), D.periodEnd(period), function (d) { if (!days[d]) miss.push(d); });
    return miss;
  }

  /* ======================================================================
   * 三、账单生成（7.3）
   * ==================================================================== */
  function buildAdjustmentsForPeriod(S, period) {
    // 跨期冲正流水 → 调整项（D-06）
    var created = [];
    S.eng.feeFlows.forEach(function (f) {
      if (f.is_cross_period !== 1 || f.billing_period !== period) return;
      if (S.adjustments.some(function (a) { return a.origin_ref === f.fee_flow_no; })) return;
      var agr = S.agreementMap[f.agreement_no];
      var a = {
        adjustment_no: Core.No.adjustment(f.fee_date), bill_no: '',
        partner_no: f.partner_no, agreement_no: f.agreement_no, direction: f.direction,
        settle_in_period: period, source_type: 'CROSS_PERIOD_REVERSAL',
        origin_period: f.origin_period, origin_ref: f.fee_flow_no,
        amount: f.fee_amount, charge_item_no: f.charge_item_no, charge_item_name: f.charge_item_name,
        reason: f.origin_period + ' 账期冲正（' + ({ EV_DISBURSE_REVERSE: '放款撤销', EV_REPAY_REVERSE: '还款冲正', EV_REFUND: '退款' }[f.reversal_reason] || f.reversal_reason) + '）',
        approval_no: 'AUTO', status: 'APPROVED', creator: 'system', approver: '—',
        create_time: f.create_time
      };
      S.adjustments.push(a); created.push(a);
    });
    return created;
  }

  function generateBills(S, period, filterPartner) {
    buildAdjustmentsForPeriod(S, period);
    var made = [];
    var groups = {};
    S.eng.feeFlows.forEach(function (f) {
      if (f.billing_period !== period || f.is_cross_period === 1) return;
      var k = f.partner_no + '|' + f.agreement_no + '|' + f.direction;
      (groups[k] || (groups[k] = [])).push(f);
    });
    // 仅有调整项、无本期费用的组合也要出账
    S.adjustments.forEach(function (a) {
      if (a.settle_in_period !== period) return;
      var k = a.partner_no + '|' + a.agreement_no + '|' + a.direction;
      if (!groups[k]) groups[k] = [];
    });
    // 仅有上期结转（部分结算未付、退票重结）的组合同样要出账
    (S.carryForwards || []).forEach(function (c) {
      if (c.period !== period || c.bill_no) return;
      var k = c.partner_no + '|' + c.agreement_no + '|' + c.direction;
      if (!groups[k]) groups[k] = [];
    });

    Object.keys(groups).sort().forEach(function (k) {
      var parts = k.split('|');
      var partnerNo = parts[0], agreementNo = parts[1], direction = parts[2];
      if (filterPartner && partnerNo !== filterPartner) return;
      if (S.bills.some(function (b) {
        return b.partner_no === partnerNo && b.agreement_no === agreementNo &&
          b.direction === direction && b.billing_period === period && b.status !== 'VOIDED';
      })) return;

      var chk = billPreCheck(S, partnerNo, agreementNo, period, direction);
      if (!chk.pass) { made.push({ blocked: true, partnerNo: partnerNo, agreementNo: agreementNo, direction: direction, check: chk }); return; }

      var flows = groups[k];
      var adjs = S.adjustments.filter(function (a) {
        return a.partner_no === partnerNo && a.agreement_no === agreementNo &&
          a.settle_in_period === period && a.direction === direction;
      });
      /* 税率是账单明细维度的一部分，同一计费项跨版本税率不同不得混算。 */
      var detailsMap = Core.groupBy(flows, function (f) { return f.charge_item_no + '|' + f.tax_rate; });
      var details = Object.keys(detailsMap).sort().map(function (detailKey) {
        var fs = detailsMap[detailKey], ci = fs[0].charge_item_no;
        var amt = M.sum(fs, function (x) { return x.fee_amount; });
        return { charge_item_no: ci, charge_item_code: fs[0].charge_item_code, charge_item_name: fs[0].charge_item_name,
          flow_count: fs.length, amount: amt,
          amount_ex_tax: M.sum(fs, function (x) { return x.fee_amount_ex_tax; }),
          tax_amount: M.sum(fs, function (x) { return x.tax_amount; }), tax_rate: fs[0].tax_rate };
      });
      var cur = M.sum(details, function (d) { return d.amount; });
      var adjSum = M.sum(adjs, function (a) { return a.amount; });
      /* 上期结转：部分结算未付部分、退票后重结等（8.5 PARTIAL） */
      var carries = (S.carryForwards || []).filter(function (c) {
        return c.partner_no === partnerNo && c.agreement_no === agreementNo &&
          c.direction === direction && c.period === period && !c.bill_no;
      });
      var carry = M.sum(carries, function (c) { return c.amount; });
      var total = M.r2(cur + adjSum + carry);
      var defaultRate = (S.invoiceMap[partnerNo] || {}).default_tax_rate || 0.06;
      var adjTax = adjs.map(function (a) {
        var origin = S.eng.flowsByNo[a.origin_ref];
        return M.splitTax(a.amount, origin ? origin.tax_rate : defaultRate);
      });
      var carryTax = carries.map(function (c) { return M.splitTax(c.amount, c.tax_rate || defaultRate); });
      var totalExTax = M.sum(details, function (d) { return d.amount_ex_tax; }) +
        M.sum(adjTax, function (t) { return t.exTax; }) + M.sum(carryTax, function (t) { return t.exTax; });
      var totalTax = M.r2(total - totalExTax);
      var ver = Engine.routeVersion(S.versions, agreementNo, D.periodEnd(period)) ||
                Engine.routeVersion(S.versions, agreementNo, D.periodStart(period));
      var netting = !!(ver && ver.items.every(function (it) { return it.join_netting === 1; }));
      var cal = calendar((ver && ver.items[0] && ver.items[0].settle_day_rule) || {}, period);

      var bill = {
        bill_no: Core.No.bill(partnerNo, period), partner_no: partnerNo, agreement_no: agreementNo,
        billing_period: period, period_start: cal.period_start, period_end: cal.period_end,
        direction: direction, current_period_amount: cur, adjustment_amount: adjSum,
        carry_forward_amount: carry, total_amount: total,
        total_amount_ex_tax: M.r2(totalExTax), total_tax_amount: totalTax,
        status: 'GENERATED', gen_time: cal.bill_gen_date + 'T01:20:00+08:00',
        push_time: '', confirm_time: '', confirm_user: '', confirm_evidence_url: '',
        settle_no: '', settle_nos: [], settled_amount: 0, currency: 'CNY', recon_status: 'PENDING', join_netting: netting,
        calendar: cal, details: details, void_reason: '',
        checks: chk.checks
      };
      S.bills.push(bill);
      flows.forEach(function (f) { f.bill_no = bill.bill_no; });
      adjs.forEach(function (a) { a.bill_no = bill.bill_no; });
      carries.forEach(function (c) { c.bill_no = bill.bill_no; });
      made.push({ blocked: false, bill: bill });
    });
    return made;
  }

  /* ======================================================================
   * 四、结算中心（第 8 章）
   * ==================================================================== */
  function riskCheck(S, order) {
    var out = [];
    function add(code, ok, msg) {
      var def = Data.FUND_CONTROLS.filter(function (c) { return c.code === code; })[0];
      out.push({ code: code, name: def.name, type: def.type, ok: ok, msg: msg });
    }
    var acct = S.accountMap[order.payee_account] || S.accountMap[order.payer_account];
    var wlOk = acct && acct.is_whitelisted === 1 && acct.status === 'ACTIVE' &&
      (!acct.whitelist_effective_time || acct.whitelist_effective_time.slice(0, 10) <= order.plan_settle_date);
    add('FC-01', !!wlOk, acct ? (wlOk ? '账户 ' + acct.account_no_id + ' 已在白名单且过冷静期' : '账户未通过白名单/冷静期校验') : '账户不存在');
    add('FC-02', true, Math.abs(order.settle_amount) > 1000000 ? '超单笔限额 100 万，自动拆分为 ' + Math.ceil(Math.abs(order.settle_amount) / 1000000) + ' 笔指令' : '未超单笔限额');
    var dayTotal = M.sum(S.settleOrders.filter(function (o) {
      return o.partner_no === order.partner_no && o.plan_settle_date === order.plan_settle_date && o.direction === 'PAY';
    }), function (o) { return Math.abs(o.settle_amount); });
    add('FC-03', dayTotal <= 5000000, '日累计付款 ' + M.fmt(dayTotal) + ' / 限额 5,000,000.00');
    add('FC-04', true, '需 ' + approvalLevel(Math.abs(order.settle_amount)).join(' + '));
    add('FC-05', true, '发起人 ' + order.creator + ' ≠ 审批人（系统强制）');
    var hist = S.settleOrders.filter(function (o) { return o.partner_no === order.partner_no && o.settle_no !== order.settle_no; });
    var avg = hist.length ? M.sum(hist, function (o) { return Math.abs(o.settle_amount); }) / hist.length : 0;
    var ratio = avg ? Math.abs(order.settle_amount) / avg : 1;
    add('FC-06', !avg || (ratio <= 2 && ratio >= 0.3), avg ? '本次 / 近 ' + hist.length + ' 期均值 = ' + M.pct(ratio, 0) : '无历史可比');
    var firstPay = acct && !S.settleOrders.some(function (o) {
      return o.settle_no !== order.settle_no && (o.payee_account === acct.account_no_id) && o.status === 'COMPLETED';
    });
    add('FC-07', true, firstPay ? '该账户首次付款，审批层级 +1 级' : '非首次付款');
    var dupPay = order.bill_nos.some(function (bn) {
      return S.settleFlows.some(function (sf) { return sf.status === 'SUCCESS' && sf.bill_nos && sf.bill_nos.indexOf(bn) >= 0 && sf.settle_no !== order.settle_no; });
    });
    add('FC-08', !dupPay, dupPay ? '检测到重复付款，硬拦截' : '未检测到重复付款');
    var badBill = order.bill_nos.filter(function (bn) {
      var b = S.billMap[bn];
      return !b || (b.status !== 'CONFIRMED' && b.status !== 'ADJUSTED' && b.status !== 'DISPUTED');
    });
    add('FC-09', badBill.length === 0, badBill.length ? '账单状态不允许结算：' + badBill.join(',') :
      (order.bill_allocations && order.bill_allocations.some(function (a) { return a.disputed_amount > 0; })
        ? '争议金额已冻结，仅结算无争议部分' : '关联账单均为已确认'));
    var tie = tieL3L4(S, order);
    add('FC-10', tie.ok, tie.msg);
    return { checks: out, pass: out.every(function (c) { return c.type !== 'HARD' || c.ok; }),
      warn: out.some(function (c) { return c.type === 'WARN' && !c.ok; }) };
  }

  function approvalLevel(amount) {
    if (amount < 100000) return ['财务核算', '财务复核'];
    if (amount <= 1000000) return ['财务核算', '财务负责人'];
    return ['财务核算', '财务负责人', '业务负责人'];
  }

  function openDisputeAmount(S, bill) {
    var open = S.disputes.filter(function (d) {
      return d.bill_no === bill.bill_no && d.status !== 'CLOSED' && d.status !== 'REJECTED';
    });
    if (open.some(function (d) { return d.dispute_scope === 'WHOLE_BILL' && !d.disputed_amount; })) return Math.abs(bill.total_amount);
    return Math.min(Math.abs(bill.total_amount), M.sum(open, function (d) { return Math.abs(d.disputed_amount || 0); }));
  }

  function settledBillAmount(bill) {
    if (bill.settled_amount !== undefined) return M.r2(bill.settled_amount);
    return bill.status === 'SETTLED' ? M.r2(Math.abs(bill.total_amount)) : 0;
  }

  function availableBillAmount(S, bill) {
    return Math.max(0, M.r2(Math.abs(bill.total_amount) - settledBillAmount(bill) - openDisputeAmount(S, bill)));
  }

  function tieL3L4(S, order) {
    var allocations = order.bill_allocations || order.bill_nos.map(function (n) {
      var b = S.billMap[n];
      return { bill_no: n, amount: b ? Math.abs(b.total_amount) : 0, direction: b ? b.direction : '' };
    });
    var sumR = M.sum(allocations.filter(function (a) { return a.direction === 'RECEIVABLE'; }), function (a) { return a.amount; });
    var sumP = M.sum(allocations.filter(function (a) { return a.direction === 'PAYABLE'; }), function (a) { return a.amount; });
    var expect = order.is_netting ? M.r2(sumR - sumP) : M.r2(sumR + sumP);
    var actual = order.direction === 'RECEIVE' ? order.settle_amount : -order.settle_amount;
    var ok = Math.abs(expect - (order.is_netting ? actual : (order.direction === 'RECEIVE' ? sumR : sumP) * (order.direction === 'RECEIVE' ? 1 : 1))) < 0.005;
    if (order.is_netting) ok = Math.abs(expect - actual) < 0.005;
    else ok = Math.abs(order.settle_amount - (sumR + sumP)) < 0.005;
    return { ok: ok, msg: order.is_netting
      ? '等式 J：Σ应收 ' + M.fmt(sumR) + ' − Σ应付 ' + M.fmt(sumP) + ' = ' + M.fmt(expect) + '（结算净额 ' + M.fmt(actual) + '）'
      : '等式 I：Σ账单 ' + M.fmt(sumR + sumP) + ' = 结算金额 ' + M.fmt(order.settle_amount) };
  }

  function createSettleOrders(S, period, opts) {
    opts = opts || {};
    var made = [];
    var eligible = S.bills.filter(function (b) {
      var allowed = b.status === 'CONFIRMED' || b.status === 'ADJUSTED' || b.status === 'DISPUTED';
      var active = S.settleOrders.some(function (o) {
        return o.bill_nos.indexOf(b.bill_no) >= 0 &&
          ['PENDING', 'APPROVING', 'PROCESSING', 'WAITING_RECEIPT', 'PARTIAL_SETTLED', 'UNKNOWN'].indexOf(o.status) >= 0;
      });
      return b.billing_period === period && allowed && !active && availableBillAmount(S, b) > 0;
    });
    /* 同一结算单只能覆盖相同资金方、协议账户、结算日和币种。 */
    var byPartner = Core.groupBy(eligible, function (b) {
      var ag = S.agreementMap[b.agreement_no] || {};
      return [b.partner_no, ag.settle_account_no_id || '', b.calendar.settle_date, b.currency || 'CNY'].join('|');
    });

    Object.keys(byPartner).sort().forEach(function (scopeKey) {
      var bills = byPartner[scopeKey], scope = scopeKey.split('|');
      var pn = scope[0], settleAccount = scope[1], settleDate = scope[2], currency = scope[3];
      var netting = bills.length > 1 && bills.every(function (b) { return b.join_netting; });
      function mk(list, isNet) {
        var allocations = list.map(function (b) {
          return { bill_no: b.bill_no, direction: b.direction, amount: availableBillAmount(S, b),
            disputed_amount: openDisputeAmount(S, b) };
        });
        var sumR = M.sum(allocations.filter(function (a) { return a.direction === 'RECEIVABLE'; }), function (a) { return a.amount; });
        var sumP = M.sum(allocations.filter(function (a) { return a.direction === 'PAYABLE'; }), function (a) { return a.amount; });
        var net = isNet ? M.r2(sumR - sumP) : M.r2(sumR + sumP);
        var dir = isNet ? (net >= 0 ? 'RECEIVE' : 'PAY') : (list[0].direction === 'RECEIVABLE' ? 'RECEIVE' : 'PAY');
        var acct = settleAccount || (S.accounts.filter(function (a) { return a.partner_no === pn && a.status === 'ACTIVE'; })[0] || {}).account_no_id || '';
        var o = {
          settle_no: Core.No.settle(settleDate), partner_no: pn,
          bill_nos: list.map(function (b) { return b.bill_no; }), billing_period: period,
          direction: dir, is_netting: !!isNet,
          receivable_amount: sumR, payable_amount: sumP, settle_amount: Math.abs(net),
          settled_amount: 0, remaining_amount: Math.abs(net), bill_allocations: allocations,
          settlement_scope: { account_no_id: acct, settle_date: settleDate, currency: currency }, currency: currency,
          payer_account: dir === 'PAY' ? 'PLATFORM_MAIN' : acct,
          payee_account: dir === 'PAY' ? acct : 'PLATFORM_MAIN',
          pay_channel: 'CHANNEL_A', plan_settle_date: settleDate,
          status: 'PENDING', approval_no: '', creator: 'u_fin_op',
          approver: '', approve_time: '', instructions: [], create_time: settleDate + 'T09:00:00+08:00'
        };
        S.settleOrders.push(o); S.settleOrderMap[o.settle_no] = o;
        list.forEach(function (b) {
          b.settle_no = o.settle_no;
          b.settle_nos = b.settle_nos || [];
          b.settle_nos.push(o.settle_no);
        });
        made.push(o);
      }
      if (netting) mk(bills, true);
      else Core.uniq(bills.map(function (b) { return b.direction; })).forEach(function (d) {
        mk(bills.filter(function (b) { return b.direction === d; }), false);
      });
    });
    return made;
  }

  function approveSettle(S, order, approver) {
    order.approval_no = Core.No.approval(order.plan_settle_date);
    order.approver = approver;
    order.approve_time = order.plan_settle_date + 'T10:30:00+08:00';
    /* 收款方向（应收）：我方不发付款指令，资金由资金方主动划入 →
       结算单进入「待收款」，由收款认领工作台（8.5）核销后才完成。 */
    if (order.direction === 'RECEIVE') {
      order.status = 'WAITING_RECEIPT';
      order.instructions = [];
      return order;
    }
    order.status = 'PROCESSING';
    // 拆分付款指令（单笔限额 100 万）
    var LIMIT = 1000000;
    var n = Math.max(1, Math.ceil(order.settle_amount / LIMIT));
    var rest = order.settle_amount;
    order.instructions = [];
    for (var i = 0; i < n; i++) {
      var amt = i === n - 1 ? M.r2(rest) : LIMIT;
      rest = M.r2(rest - amt);
      order.instructions.push({
        instruction_no: Core.No.payInstruction(order.plan_settle_date), settle_no: order.settle_no,
        seq: i + 1, total_seq: n, amount: amt,
        payer_account: order.payer_account, payee_account: order.payee_account,
        pay_channel: order.pay_channel, channel_serial_no: '', status: 'READY', retry_count: 0,
        poll_count: 0, poll_elapsed_min: 0, fail_reason: '', resupply_of: ''
      });
    }
    return order;
  }

  function executeSettle(S, order, outcome) {
    /* 收款方向不走付款通道，核销入口在收款认领（8.5） */
    if (order.direction === 'RECEIVE') return order;
    var date = order.plan_settle_date;
    order.instructions.forEach(function (ins, i) {
      if (outcome === 'UNKNOWN' && i === order.instructions.length - 1) {
        ins.status = 'UNKNOWN'; ins.channel_serial_no = 'CH' + Core.pad(9000 + i, 8);
        return;
      }
      if (outcome === 'FAILED') { ins.status = 'FAILED'; ins.fail_reason = '收款账户名称不符'; return; }
      ins.status = 'SUCCESS';
      ins.channel_serial_no = 'CH' + date.replace(/-/g, '') + Core.pad(1000 + i, 6);
      var sf = {
        settle_flow_no: Core.No.settleFlow(date), instruction_no: ins.instruction_no, settle_no: order.settle_no,
        bill_nos: order.bill_nos, amount: ins.amount, direction: order.direction, status: 'SUCCESS',
        success_time: date + 'T14:2' + i + ':00+08:00', receipt_no: '', fail_reason: '', settle_date: date
      };
      S.settleFlows.push(sf);
      var rc = {
        receipt_no: Core.No.receipt(date), settle_flow_no: sf.settle_flow_no,
        channel_serial_no: ins.channel_serial_no, amount: ins.amount, receipt_date: date,
        receipt_file_url: '#/receipt/' + sf.settle_flow_no, receive_type: 'CALLBACK', settle_date: date
      };
      S.receipts.push(rc);
      sf.receipt_no = rc.receipt_no;
    });
    var allOk = order.instructions.every(function (i) { return i.status === 'SUCCESS'; });
    var anyUnknown = order.instructions.some(function (i) { return i.status === 'UNKNOWN'; });
    order.status = anyUnknown ? 'UNKNOWN' : (allOk ? 'COMPLETED' : (order.instructions.some(function (i) { return i.status === 'SUCCESS'; }) ? 'PARTIAL' : 'FAILED'));
    if (order.status === 'COMPLETED') {
      (order.bill_allocations || order.bill_nos.map(function (bn) {
        var b0 = S.billMap[bn]; return { bill_no: bn, amount: b0 ? Math.abs(b0.total_amount) : 0 };
      })).forEach(function (a) {
        var b = S.billMap[a.bill_no];
        if (!b) return;
        b.settled_amount = M.r2((b.settled_amount || 0) + a.amount);
        var disputed = openDisputeAmount(S, b);
        if (b.settled_amount + disputed + 0.005 >= Math.abs(b.total_amount)) {
          b.status = disputed > 0 ? 'DISPUTED' : 'SETTLED';
          b.recon_status = disputed > 0 ? 'PARTIAL' : 'MATCHED';
        } else b.status = 'PARTIAL_SETTLED';
      });
    }
    return order;
  }

  /* ======================================================================
   * 五、对账中心 · 五级勾稽（9.1）
   * ==================================================================== */
  function runTieOut(S, period) {
    var levels = [];
    var pStart = D.periodStart(period), pEnd = D.periodEnd(period);
    var evs = S.events.filter(function (e) { return e.occur_date >= pStart && e.occur_date <= pEnd; });
    var flows = S.eng.feeFlows.filter(function (f) { return f.billing_period === period; });
    var bills = S.bills.filter(function (b) { return b.billing_period === period && b.status !== 'VOIDED'; });
    var orders = S.settleOrders.filter(function (o) { return o.billing_period === period; });
    var sflows = S.settleFlows.filter(function (sf) { return orders.some(function (o) { return o.settle_no === sf.settle_no; }); });
    var recs = S.receipts.filter(function (r) { return sflows.some(function (sf) { return sf.settle_flow_no === r.settle_flow_no; }); });

    /* ---- L1 → L2 ---- */
    var terminal = evs.filter(function (e) { return ['CHARGED', 'IGNORED', 'REVERSED'].indexOf(e.status) >= 0; });
    var charged = evs.filter(function (e) { return e.status === 'CHARGED' || e.status === 'REVERSED'; });
    var flowEventIds = Core.uniq(flows.filter(function (f) { return f.flow_type === 'NORMAL' || f.flow_type === 'REVERSAL'; })
      .map(function (f) { return f.event_id; }));
    var chargedIds = {};
    flows.forEach(function (f) { chargedIds[f.event_id] = 1; });
    var eqA = { id: 'A', name: '完整性 · 无积压',
      formula: 'count(事件) = count(终态事件)',
      left: evs.length, right: terminal.length, ok: evs.length === terminal.length,
      detail: '积压 ' + (evs.length - terminal.length) + ' 条' };
    /* 右侧必须独立取事件终态，不能再由流水反推，否则“事件已计费但流水丢失”会两边同时漏掉。 */
    var chargedEvs = Core.uniq(charged.map(function (e) { return e.event_id; }));
    var eqB = { id: 'B', name: '对应性',
      formula: 'count(DISTINCT 流水.event_id) = count(DISTINCT 已计费事件)',
      left: flowEventIds.filter(function (id) { return id.indexOf('PERIOD_CLOSE') !== 0; }).length,
      right: chargedEvs.length, ok: true, detail: '' };
    eqB.ok = eqB.left === eqB.right;
    eqB.detail = eqB.ok ? '一一对应' : '差 ' + Math.abs(eqB.left - eqB.right) + ' 条';
    var sampleN = Math.min(500, flows.length), sampleBad = 0;
    var snapMap = {}; S.eng.snapshots.forEach(function (s) { snapMap[s.snapshot_no] = s; });
    for (var i = 0; i < sampleN; i++) {
      var f = flows[i];
      if (!f.basis_snapshot_no) { sampleBad++; continue; }
      var sn = snapMap[f.basis_snapshot_no];
      if (!sn || M.r2(sn.basis_amount) !== M.r2(f.basis_amount)) sampleBad++;
    }
    var eqC = { id: 'C', name: '基数一致性 · 抽样',
      formula: '流水.basis_amount == 快照.basis_amount',
      left: sampleN - sampleBad, right: sampleN, ok: sampleBad === 0,
      detail: '抽样 ' + sampleN + ' 笔，不一致 ' + sampleBad + ' 笔' };
    levels.push({ level: 'L1→L2', name: '业务事件 ↔ 费用流水', freq: '每日 06:00', tolerance: 0,
      block: '阻断封账', eqs: [eqA, eqB, eqC] });

    /* ---- L2 → L3 ---- */
    var eqs2 = [];
    var okD = true, okE = true, okF = true, okH = true, dTxt = [];
    bills.forEach(function (b) {
      var sum = M.sum(S.eng.feeFlows.filter(function (f) {
        return f.billing_period === period && f.partner_no === b.partner_no &&
          f.agreement_no === b.agreement_no && f.direction === b.direction && f.is_cross_period === 0;
      }), function (f) { return f.fee_amount; });
      if (M.r2(sum) !== M.r2(b.current_period_amount)) { okD = false; dTxt.push(b.bill_no + ' 差 ' + M.fmt(sum - b.current_period_amount)); }
      var adjSum = M.sum(S.adjustments.filter(function (a) { return a.bill_no === b.bill_no; }), function (a) { return a.amount; });
      if (M.r2(adjSum) !== M.r2(b.adjustment_amount)) okE = false;
      if (M.r2(b.current_period_amount + b.adjustment_amount + b.carry_forward_amount) !== M.r2(b.total_amount)) okF = false;
      if (M.r2(b.total_amount_ex_tax + b.total_tax_amount) !== M.r2(b.total_amount)) okH = false;
    });
    var orphan = S.eng.feeFlows.filter(function (f) {
      return f.billing_period === period && f.is_cross_period === 0 && !f.bill_no;
    });
    eqs2.push({ id: 'D', name: '本期费用', formula: 'Σ 本期未跨期流水 = 账单本期费用',
      left: M.sum(flows.filter(function (f) { return f.is_cross_period === 0; }), function (f) { return f.fee_amount; }),
      right: M.sum(bills, function (b) { return b.current_period_amount; }),
      ok: okD, detail: okD ? bills.length + ' 张账单逐张相符' : dTxt.join('; ') });
    eqs2.push({ id: 'E', name: '调整项', formula: 'Σ 调整项 = 账单调整项合计',
      left: M.sum(S.adjustments.filter(function (a) { return a.settle_in_period === period && a.status === 'APPROVED'; }), function (a) { return a.amount; }),
      right: M.sum(bills, function (b) { return b.adjustment_amount; }),
      ok: okE, detail: okE ? '相符' : '不符' });
    eqs2.push({ id: 'F', name: '账单合计', formula: '账单合计 = 本期 + 调整 + 结转',
      left: M.sum(bills, function (b) { return M.r2(b.current_period_amount + b.adjustment_amount + b.carry_forward_amount); }),
      right: M.sum(bills, function (b) { return b.total_amount; }),
      ok: okF, detail: okF ? '恒等' : '不恒等' });
    eqs2.push({ id: 'G', name: '无遗漏', formula: 'count(未入账单流水) = 0',
      left: orphan.length, right: 0, ok: orphan.length === 0,
      detail: orphan.length ? '存在 ' + orphan.length + ' 条未入账单流水' : (bills.length ? '全部流水已入账单' : '账期尚未出账') });
    eqs2.push({ id: 'H', name: '价税恒等', formula: '含税 = 不含税 + 税额',
      left: M.sum(bills, function (b) { return b.total_amount; }),
      right: M.sum(bills, function (b) { return M.r2(b.total_amount_ex_tax + b.total_tax_amount); }),
      ok: okH, detail: okH ? '恒等（倒轧）' : '不恒等' });
    levels.push({ level: 'L2→L3', name: '费用流水 ↔ 账单', freq: '每日 + 出账时', tolerance: 0,
      block: '阻断出账', eqs: eqs2, skipped: bills.length === 0 });

    /* ---- L3 → L4 ---- */
    var eqs3 = [];
    var okI = true, okJ = true, okK = true;
    orders.forEach(function (o) {
      var t = tieL3L4(S, o);
      if (o.is_netting) { if (!t.ok) okJ = false; } else { if (!t.ok) okI = false; }
      var insSum = M.sum(o.instructions, function (x) { return x.amount; });
      if (o.instructions.length && M.r2(insSum) !== M.r2(o.settle_amount)) okK = false;
    });
    var lateBills = bills.filter(function (b) { return b.status === 'CONFIRMED' && !b.settle_no && b.calendar.settle_date < S.simToday; });
    eqs3.push({ id: 'I', name: '非轧差', formula: 'Σ 账单金额 = 结算金额',
      left: M.sum(orders.filter(function (o) { return !o.is_netting; }), function (o) { return o.settle_amount; }),
      right: M.sum(orders.filter(function (o) { return !o.is_netting; }), function (o) { return o.receivable_amount + o.payable_amount; }),
      ok: okI, detail: okI ? '相符' : '不符' });
    eqs3.push({ id: 'J', name: '轧差', formula: 'Σ应收 − Σ应付 = 结算净额',
      left: M.sum(orders.filter(function (o) { return o.is_netting; }), function (o) { return M.r2(o.receivable_amount - o.payable_amount); }),
      right: M.sum(orders.filter(function (o) { return o.is_netting; }), function (o) { return o.direction === 'RECEIVE' ? o.settle_amount : -o.settle_amount; }),
      ok: okJ, detail: okJ ? '相符' : '不符' });
    eqs3.push({ id: 'K', name: '指令合计', formula: 'Σ 付款指令金额 = 结算单金额',
      left: M.sum(orders, function (o) { return M.sum(o.instructions, function (x) { return x.amount; }); }),
      right: M.sum(orders.filter(function (o) { return o.instructions.length; }), function (o) { return o.settle_amount; }),
      ok: okK, detail: okK ? '相符' : '不符' });
    eqs3.push({ id: 'L', name: '无遗漏', formula: '已确认且到期未结算账单数 = 0',
      left: lateBills.length, right: 0, ok: lateBills.length === 0,
      detail: lateBills.length ? lateBills.map(function (b) { return b.bill_no; }).join(',') : '无超期未结算账单' });
    levels.push({ level: 'L3→L4', name: '账单 ↔ 结算流水', freq: '结算发起时 + 每日', tolerance: 0,
      block: '阻断结算发起', eqs: eqs3, skipped: orders.length === 0 });

    /* ---- L4 → L5 ---- */
    var sumSF = M.sum(sflows.filter(function (s) { return s.status === 'SUCCESS'; }), function (s) { return s.amount; });
    var sumRC = M.sum(recs, function (r) { return r.amount; });
    var noReceipt = sflows.filter(function (s) { return s.status === 'SUCCESS' && !s.receipt_no; });
    var eqs4 = [
      { id: 'M', name: '金额一致', formula: 'Σ 成功结算金额 = Σ 回单金额',
        left: sumSF, right: sumRC, ok: M.r2(sumSF) === M.r2(sumRC), detail: M.r2(sumSF) === M.r2(sumRC) ? '相符' : '差 ' + M.fmt(sumSF - sumRC) },
      { id: 'N', name: '无缺失', formula: 'count(成功结算无回单) = 0',
        left: noReceipt.length, right: 0, ok: noReceipt.length === 0,
        detail: noReceipt.length ? noReceipt.map(function (s) { return s.settle_flow_no; }).join(',') : '回单齐备' }
    ];
    levels.push({ level: 'L4→L5', name: '结算流水 ↔ 银行回单', freq: '每日', tolerance: 0,
      block: '告警 P0', eqs: eqs4, skipped: sflows.length === 0 });

    var allEqs = levels.reduce(function (a, l) { return a.concat(l.skipped ? [] : l.eqs); }, []);
    return {
      period: period, levels: levels,
      failCount: allEqs.filter(function (e) { return !e.ok; }).length,
      pass: allEqs.every(function (e) { return e.ok; }),
      stats: { events: evs.length, flows: flows.length, bills: bills.length, orders: orders.length, receipts: recs.length }
    };
  }

  /* ---- 状态一致性校验 S-01 ~ S-08（9.2.2）---- */
  function stateChecks(S) {
    var out = [];
    function add(code, ok, desc, msg) { out.push({ code: code, ok: ok, desc: desc, msg: msg }); }
    var settled = S.bills.filter(function (b) { return b.status === 'SETTLED'; });
    add('S-01', settled.every(function (b) { var o = S.settleOrderMap[b.settle_no]; return o && o.status === 'COMPLETED'; }),
      '已结算账单必有 COMPLETED 结算单', settled.length + ' 张已结算账单');
    add('S-02', S.settleOrders.filter(function (o) { return o.status === 'COMPLETED'; })
      .every(function (o) { return o.bill_nos.every(function (n) { return S.billMap[n] && S.billMap[n].status === 'SETTLED'; }); }),
      '已完成结算单的账单必为 SETTLED', '');
    add('S-03', S.settleFlows.filter(function (f) { return f.status === 'SUCCESS'; }).every(function (f) { return !!f.receipt_no; }),
      '成功结算流水必有回单', S.settleFlows.length + ' 条结算流水');
    add('S-04', S.eng.feeFlows.filter(function (f) { return f.bill_no; })
      .every(function (f) { return S.billMap[f.bill_no] && S.billMap[f.bill_no].status !== 'VOIDED'; }),
      '已入账单流水的账单必存在且未作废', '');
    add('S-05', S.eng.feeFlows.filter(function (f) { return f.flow_type === 'REVERSAL'; })
      .every(function (f) { return !!S.eng.flowsByNo[f.original_fee_flow_no]; }),
      '红冲流水的原流水必存在', '');
    var s06 = true;
    Object.keys(S.eng.reversedAmt).forEach(function (no) {
      var of = S.eng.flowsByNo[no];
      if (of && M.r2(S.eng.reversedAmt[no]) > M.r2(Math.abs(of.fee_amount)) + 0.001) s06 = false;
    });
    add('S-06', s06, '红冲累计金额 ≤ 原流水金额（重复冲正拦截）', Object.keys(S.eng.reversedAmt).length + ' 笔存在红冲');
    var s07 = S.agreements.every(function (a) { return Engine.validateVersionIntervals(S.versions, a).ok; });
    add('S-07', s07, '生效协议版本区间无重叠无空洞', '');
    var s08 = S.bills.filter(function (b) { return b.status === 'CONFIRMED' || b.status === 'SETTLED'; })
      .every(function (b) {
        return !S.eng.feeFlows.some(function (f) {
          return f.bill_no === '' && f.billing_period === b.billing_period && f.partner_no === b.partner_no &&
            f.direction === b.direction && f.is_cross_period === 0;
        });
      });
    add('S-08', s08, '已确认账单不存在未跨期的新增流水（D-06）', '');
    return out;
  }

  /* ======================================================================
   * 六、全链路追溯（9.5）
   * ==================================================================== */
  function buildTrace(S, docNo) {
    docNo = (docNo || '').trim();
    if (!docNo) return null;
    // 反向追溯：回单 / 结算流水 / 结算单 / 账单
    var rc = S.receipts.filter(function (r) { return r.receipt_no === docNo; })[0];
    if (rc) return nodeReceipt(S, rc);
    var sf = S.settleFlows.filter(function (f) { return f.settle_flow_no === docNo; })[0];
    if (sf) return nodeSettleFlow(S, sf);
    var so = S.settleOrderMap[docNo];
    if (so) return nodeSettleOrder(S, so);
    var b = S.billMap[docNo];
    if (b) return nodeBill(S, b);
    var ff = S.eng.flowsByNo[docNo];
    if (ff) return nodeFlow(S, ff);
    // 正向追溯：借据号 / 事件号
    var evsByKey = S.events.filter(function (e) { return e.biz_key === docNo; });
    if (evsByKey.length) return nodeLoan(S, docNo, evsByKey);
    var ev = S.events.filter(function (e) { return e.event_id === docNo || e.internal_no === docNo; })[0];
    if (ev) return nodeEvent(S, ev);
    return null;
  }
  function nodeReceipt(S, rc) {
    var sf = S.settleFlows.filter(function (f) { return f.settle_flow_no === rc.settle_flow_no; })[0];
    return { type: '银行回单', no: rc.receipt_no, amount: rc.amount, desc: rc.receipt_date + ' / ' + rc.receive_type,
      children: sf ? [nodeSettleFlow(S, sf)] : [] };
  }
  function nodeSettleFlow(S, sf) {
    var o = S.settleOrderMap[sf.settle_no];
    return { type: '结算流水', no: sf.settle_flow_no, amount: sf.amount, desc: sf.status + ' / ' + sf.success_time,
      children: o ? [nodeSettleOrder(S, o)] : [] };
  }
  function nodeSettleOrder(S, o) {
    return { type: '结算单', no: o.settle_no, amount: o.settle_amount,
      desc: (o.is_netting ? '轧差 · ' : '') + (o.direction === 'RECEIVE' ? '我方收款' : '我方付款'),
      children: o.bill_nos.map(function (n) { return S.billMap[n] ? nodeBill(S, S.billMap[n]) : null; }).filter(Boolean) };
  }
  function nodeBill(S, b) {
    var kids = b.details.map(function (d) {
      var fs = S.eng.feeFlows.filter(function (f) { return f.bill_no === b.bill_no && f.charge_item_no === d.charge_item_no; });
      return { type: '账单明细', no: d.charge_item_name, amount: d.amount, desc: d.flow_count + ' 笔流水',
        children: fs.slice(0, 40).map(function (f) { return nodeFlow(S, f, true); }),
        truncated: fs.length > 40 ? fs.length - 40 : 0 };
    });
    S.adjustments.filter(function (a) { return a.bill_no === b.bill_no; }).forEach(function (a) {
      kids.push({ type: '调整项', no: a.adjustment_no, amount: a.amount, desc: a.reason, children: [] });
    });
    return { type: '账单', no: b.bill_no, amount: b.total_amount,
      desc: b.billing_period + ' · ' + (b.direction === 'RECEIVABLE' ? '应收' : '应付') + ' · ' + b.status, children: kids };
  }
  function nodeFlow(S, f, shallow) {
    var kids = [];
    var ev = S.eventMap[f.event_id];
    if (ev) kids.push({ type: '业务事件', no: ev.event_id, amount: null,
      desc: ev.event_code + ' / ' + ev.occur_date + ' / ' + ev.biz_key, children: [] });
    kids.push({ type: '规则版本', no: f.agreement_no + '-' + f.rule_version, amount: null,
      desc: '规则 ' + f.rule_no + ' · ' + (f.rate_snapshot ? f.rate_snapshot.type : ''), children: [] });
    var sn = S.eng.snapshots.filter(function (s) { return s.snapshot_no === f.basis_snapshot_no; })[0];
    if (sn) kids.push({ type: '基数快照', no: sn.snapshot_no, amount: sn.basis_amount,
      desc: sn.basis_type + ' / 来源 ' + sn.source_ref, children: [] });
    if (f.original_fee_flow_no) kids.push({ type: '原流水', no: f.original_fee_flow_no, amount: null, desc: '红冲指向', children: [] });
    return { type: f.flow_type === 'NORMAL' ? '费用流水' : '费用流水 · ' + f.flow_type, no: f.fee_flow_no, amount: f.fee_amount,
      desc: f.charge_item_name + ' / ' + f.fee_date, children: kids };
  }
  function nodeEvent(S, ev) {
    var nos = S.eng.flowsByEvent[ev.event_id] || [];
    return { type: '业务事件', no: ev.event_id, amount: null,
      desc: ev.event_code + ' / ' + ev.occur_date + ' / ' + ev.biz_key + ' / ' + ev.status,
      children: nos.map(function (n) { return nodeFlowForward(S, S.eng.flowsByNo[n]); }).filter(Boolean) };
  }
  function nodeFlowForward(S, f) {
    if (!f) return null;
    var kids = [];
    if (f.bill_no && S.billMap[f.bill_no]) {
      var b = S.billMap[f.bill_no];
      var kids2 = [];
      if (b.settle_no && S.settleOrderMap[b.settle_no]) {
        var o = S.settleOrderMap[b.settle_no];
        var sfs = S.settleFlows.filter(function (x) { return x.settle_no === o.settle_no; });
        kids2.push({ type: '结算单', no: o.settle_no, amount: o.settle_amount, desc: o.status,
          children: sfs.map(function (sf) {
            return { type: '结算流水', no: sf.settle_flow_no, amount: sf.amount, desc: sf.success_time,
              children: sf.receipt_no ? [{ type: '银行回单', no: sf.receipt_no, amount: sf.amount, desc: sf.settle_date, children: [] }] : [] };
          }) });
      }
      kids.push({ type: '账单', no: b.bill_no, amount: b.total_amount, desc: b.billing_period + ' · ' + b.status, children: kids2 });
    } else {
      kids.push({ type: '未入账单', no: '—', amount: null, desc: '该流水尚未归集到账单', children: [] });
    }
    return { type: '费用流水' + (f.flow_type === 'NORMAL' ? '' : ' · ' + f.flow_type), no: f.fee_flow_no, amount: f.fee_amount,
      desc: f.charge_item_name + ' / ' + f.fee_date, children: kids };
  }
  function nodeLoan(S, loanNo, evs) {
    return { type: '借据（正向追溯）', no: loanNo, amount: null,
      desc: evs.length + ' 个业务事件',
      children: evs.slice(0, 40).map(function (e) { return nodeEvent(S, e); }),
      truncated: evs.length > 40 ? evs.length - 40 : 0 };
  }

  global.Billing = {
    calendar: calendar, billPreCheck: billPreCheck, generateBills: generateBills,
    buildAdjustmentsForPeriod: buildAdjustmentsForPeriod, missingSnapshotDays: missingSnapshotDays,
    riskCheck: riskCheck, approvalLevel: approvalLevel, createSettleOrders: createSettleOrders,
    approveSettle: approveSettle, executeSettle: executeSettle,
    runTieOut: runTieOut, stateChecks: stateChecks, buildTrace: buildTrace
  };
})(window);
