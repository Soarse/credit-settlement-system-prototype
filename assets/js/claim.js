/* =============================================================================
 * claim.js —— 模块⑤ 结算中心 · 收款认领内核（PRD 8.5）
 *
 * 我方收款场景（应收方向）：资金由资金方主动划入，本系统收到银行入账流水后，
 * 需与「待收款」结算单匹配。匹配不上的挂账（suspense），进入运营认领工作台。
 *
 * 与付款方向的本质差别：
 *   付款方向 —— 我方主动发指令，风险是「不该付的付出去了」→ 事前硬拦截（FC-01~FC-10）
 *   收款方向 —— 钱已经到账，风险是「记错账、挂着没人认、错冲别人的单」→ 事后双人复核
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  /* 自动匹配容差：±0.01 元（8.5.1 优先级 3） */
  var MATCH_TOLERANCE = 0.01;
  /* 挂账超过 3 个工作日告警升级（8.5.2） */
  var SUSPENSE_ALERT_DAYS = 3;

  /* ---------------- 匹配规则（8.5.1 按优先级依次尝试）---------------- */
  var RULES = [
    { level: 1, key: 'REMARK_SETTLE_NO', name: '付款备注含结算单号',
      reliability: 'HIGH', auto: true,
      desc: '备注里能直接解析出 ST 开头的结算单号，且该单待收金额一致' },
    { level: 2, key: 'ACCOUNT_AMOUNT_EXACT', name: '付款账户 + 金额精确匹配唯一',
      reliability: 'HIGH', auto: true,
      desc: '付款方账户命中该资金方白名单账户，且金额与唯一一张待收结算单完全相等' },
    { level: 3, key: 'ACCOUNT_AMOUNT_TOLERANCE', name: '付款账户 + 金额容差内匹配唯一',
      reliability: 'MEDIUM', auto: false,
      desc: '差额 ≤ ' + MATCH_TOLERANCE + ' 元（多为跨行手续费或分转舍入），自动匹配但需人工复核' },
    { level: 4, key: 'ACCOUNT_COMBINATION', name: '付款账户匹配 + 金额匹配多笔组合',
      reliability: 'LOW', auto: false,
      desc: '一笔到账对应多张待收结算单的合计，可靠性低，必须人工确认组合关系' }
  ];
  var RULE_BY_LEVEL = {};
  RULES.forEach(function (r) { RULE_BY_LEVEL[r.level] = r; });

  /* ---------------- 入账流水状态机（8.5.2）---------------- */
  var STATUS_META = {
    AUTO_MATCHED: { name: '自动匹配待核销', cls: 'info' },
    PENDING_REVIEW: { name: '已认领待复核', cls: 'warn' },
    SUSPENSE: { name: '挂账待认领', cls: 'danger' },
    CONFIRMED: { name: '已核销', cls: 'ok' },
    EXCLUDED: { name: '非本系统款项', cls: '' },
    RETURNED: { name: '已退回付款方', cls: 'purple' }
  };

  function remainingOf(order) {
    if (order.remaining_amount !== undefined) return Math.max(0, M.r2(order.remaining_amount));
    return Math.max(0, M.r2(order.settle_amount - (order.settled_amount || 0)));
  }

  /* ---------------- 待收款结算单 ---------------- */
  function openReceiveOrders(S, partnerNo) {
    return S.settleOrders.filter(function (o) {
      return o.direction === 'RECEIVE' && (o.status === 'WAITING_RECEIPT' || o.status === 'PARTIAL_SETTLED') && remainingOf(o) > 0 &&
        (!partnerNo || o.partner_no === partnerNo);
    });
  }

  /** 入账流水的付款方账户 → 资金方 */
  function partnerOfAccount(S, bankAccountNo) {
    var a = S.accounts.filter(function (x) { return x.bank_account_no === bankAccountNo; })[0];
    return a ? a.partner_no : '';
  }

  /* ---------------- 自动匹配（8.5.1）---------------- */
  /**
   * 按优先级依次尝试，命中即止。
   * 返回 { level, rule, settle_nos, auto, reason, candidates }
   *   level 0 表示全部规则未命中 → 挂账
   */
  function autoMatch(S, inb) {
    var tried = [];
    var pn = partnerOfAccount(S, inb.payer_account);
    var pool = openReceiveOrders(S, pn);

    /* 规则 1：备注含结算单号 */
    var m = /ST\d{18}/.exec(inb.remark || '');
    if (m) {
      var byNo = pool.filter(function (o) { return o.settle_no === m[0]; });
      if (byNo.length === 1 && M.r2(remainingOf(byNo[0])) === M.r2(inb.amount)) {
        return hit(1, [byNo[0].settle_no], '备注解析出 ' + m[0] + '，金额与该单待收金额一致');
      }
      tried.push({ level: 1, why: byNo.length ? '备注解析出 ' + m[0] + '，但金额与该单不符' : '备注中的单号 ' + m[0] + ' 不在待收清单内' });
    } else tried.push({ level: 1, why: '备注中未解析到结算单号' });

    /* 规则 2：付款账户 + 金额精确 */
    if (!pn) {
      tried.push({ level: 2, why: '付款方账户不在任何资金方的白名单账户中' });
      return miss(tried, pn, pool);
    }
    var exact = pool.filter(function (o) { return M.r2(remainingOf(o)) === M.r2(inb.amount); });
    if (exact.length === 1) return hit(2, [exact[0].settle_no], '付款账户归属 ' + pn + '，金额精确命中唯一待收单');
    tried.push({ level: 2, why: exact.length === 0 ? '无金额完全相等的待收单' : '金额相等的待收单有 ' + exact.length + ' 张，不唯一' });

    /* 规则 3：付款账户 + 金额容差内 */
    var tol = pool.filter(function (o) { return Math.abs(M.r2(remainingOf(o) - inb.amount)) <= MATCH_TOLERANCE; });
    if (tol.length === 1) {
      return hit(3, [tol[0].settle_no], '与待收单剩余应收差额 ' + M.fmt(Math.abs(M.r2(remainingOf(tol[0]) - inb.amount))) +
        ' 元，在 ' + MATCH_TOLERANCE + ' 元容差内');
    }
    tried.push({ level: 3, why: tol.length === 0 ? '无落在 ' + MATCH_TOLERANCE + ' 元容差内的待收单' : '容差内的待收单有 ' + tol.length + ' 张，不唯一' });

    /* 规则 4：金额匹配多笔组合（穷举 2~3 张） */
    var combo = findCombination(pool, inb.amount);
    if (combo) {
      return hit(4, combo, '该资金方 ' + combo.length + ' 张待收单合计 ' + M.fmt(inb.amount) + ' 元，与到账金额一致');
    }
    tried.push({ level: 4, why: '未找到金额合计等于到账金额的待收单组合' });

    return miss(tried, pn, pool);

    function hit(level, nos, reason) {
      return { level: level, rule: RULE_BY_LEVEL[level], settle_nos: nos,
        auto: RULE_BY_LEVEL[level].auto, reason: reason, tried: tried, partner_no: pn, candidates: pool };
    }
    function miss(tr, partnerNo, cand) {
      return { level: 0, rule: null, settle_nos: [], auto: false,
        reason: '四级自动匹配规则全部未命中，转挂账（suspense）等待人工认领',
        tried: tr, partner_no: partnerNo, candidates: cand };
    }
  }

  /** 在待收单里找合计等于目标金额的组合（2~3 张，确定性：按单号升序取第一个解） */
  function findCombination(pool, target) {
    var t = M.r2(target), n = pool.length;
    var arr = pool.slice().sort(function (a, b) { return a.settle_no < b.settle_no ? -1 : 1; });
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        if (M.r2(remainingOf(arr[i]) + remainingOf(arr[j])) === t) return [arr[i].settle_no, arr[j].settle_no];
        for (var k = j + 1; k < n; k++) {
          if (M.r2(remainingOf(arr[i]) + remainingOf(arr[j]) + remainingOf(arr[k])) === t)
            return [arr[i].settle_no, arr[j].settle_no, arr[k].settle_no];
        }
      }
    }
    return null;
  }

  /* ---------------- 挂账老化（8.5.2）---------------- */
  function agingDays(S, inb) {
    if (inb.status === 'CONFIRMED' || inb.status === 'EXCLUDED' || inb.status === 'RETURNED') return 0;
    var d = D.parse(inb.value_date), end = D.parse(S.simToday), n = 0;
    while (d < end) {
      d = D.addDays(D.fmt(d), 1); d = D.parse(D.fmt(d));
      var w = d.getDay();
      if (w !== 0 && w !== 6) n++;
    }
    return n;
  }
  function isOverdue(S, inb) { return agingDays(S, inb) > SUSPENSE_ALERT_DAYS; }

  /* ---------------- 核销：生成结算流水 + 回单（L4→L5 落点）---------------- */
  /**
   * 收款方向没有付款指令，回单来源是银行入账流水本身（8.7.1「人工上传 / 批量拉取」）。
   * 核销后：结算单 COMPLETED → 关联账单 SETTLED，五级勾稽 L4→L5 在收款方向才有落点。
   */
  function settleByInbound(S, inb) {
    var date = inb.value_date;
    var made = [], available = M.r2(inb.amount);
    inb.settle_nos.forEach(function (sn, i) {
      var o = S.settleOrderMap[sn];
      if (!o || o.status === 'COMPLETED' || available <= 0) return;
      var before = remainingOf(o), applied = Math.min(before, available);
      if (applied <= 0) return;
      var sf = {
        settle_flow_no: Core.No.settleFlow(date), instruction_no: '', settle_no: o.settle_no,
        bill_nos: o.bill_nos, amount: applied, direction: 'RECEIVE', status: 'SUCCESS',
        success_time: date + 'T1' + (5 + i) + ':10:00+08:00', receipt_no: '', fail_reason: '',
        settle_date: date, inbound_no: inb.inbound_no
      };
      S.settleFlows.push(sf);
      var rc = {
        receipt_no: Core.No.receipt(date), settle_flow_no: sf.settle_flow_no,
        channel_serial_no: inb.channel_serial_no, amount: applied, receipt_date: date,
        receipt_file_url: '#/receipt/' + sf.settle_flow_no, receive_type: 'INBOUND_CLAIM', settle_date: date
      };
      S.receipts.push(rc);
      sf.receipt_no = rc.receipt_no;
      o.settled_amount = M.r2((o.settled_amount || 0) + applied);
      o.remaining_amount = Math.max(0, M.r2(o.settle_amount - o.settled_amount));
      o.status = o.remaining_amount === 0 ? 'COMPLETED' : 'PARTIAL_SETTLED';
      o.inbound_no = inb.inbound_no;
      o.bill_settled_amount = o.bill_settled_amount || {};
      var allocations = o.bill_allocations || o.bill_nos.map(function (bn) {
        var b0 = S.billMap[bn]; return { bill_no: bn, amount: b0 ? Math.abs(b0.total_amount) : 0 };
      });
      allocations.forEach(function (a, ai) {
        var b = S.billMap[a.bill_no]; if (!b) return;
        var share = o.remaining_amount === 0 ? M.r2(a.amount - (o.bill_settled_amount[a.bill_no] || 0)) :
          (ai === allocations.length - 1 ? M.r2(applied - M.sum(allocations.slice(0, ai), function (x) {
            return M.mul(applied, M.div(x.amount, o.settle_amount, 9), 2);
          })) : M.mul(applied, M.div(a.amount, o.settle_amount, 9), 2));
        o.bill_settled_amount[a.bill_no] = M.r2((o.bill_settled_amount[a.bill_no] || 0) + share);
        b.settled_amount = M.r2((b.settled_amount || 0) + share);
        var dispute = M.sum(S.disputes.filter(function (d) {
          return d.bill_no === b.bill_no && d.status !== 'CLOSED' && d.status !== 'REJECTED';
        }), function (d) { return Math.abs(d.disputed_amount || 0); });
        if (b.settled_amount + dispute + 0.005 >= Math.abs(b.total_amount)) {
          b.status = dispute > 0 ? 'DISPUTED' : 'SETTLED';
          b.recon_status = dispute > 0 ? 'PARTIAL' : 'MATCHED';
        } else { b.status = 'PARTIAL_SETTLED'; b.recon_status = 'PARTIAL'; }
      });
      available = M.r2(available - applied);
      made.push({ order: o, flow: sf, receipt: rc, applied: applied, remaining: o.remaining_amount });
    });
    made.applied_amount = M.r2(inb.amount - available);
    made.unallocated_amount = available;
    return made;
  }

  /* ---------------- 差额处理：到账金额 ≠ 结算单金额 ---------------- */
  function amountGap(S, inb) {
    var expect = M.sum(inb.settle_nos.map(function (n) { return S.settleOrderMap[n]; })
      .filter(Boolean), function (o) { return remainingOf(o); });
    return { expect: expect, actual: inb.amount, gap: M.r2(inb.amount - expect) };
  }

  global.Claim = {
    MATCH_TOLERANCE: MATCH_TOLERANCE, SUSPENSE_ALERT_DAYS: SUSPENSE_ALERT_DAYS,
    RULES: RULES, RULE_BY_LEVEL: RULE_BY_LEVEL, STATUS_META: STATUS_META,
    openReceiveOrders: openReceiveOrders, partnerOfAccount: partnerOfAccount,
    autoMatch: autoMatch, findCombination: findCombination,
    remainingOf: remainingOf,
    agingDays: agingDays, isOverdue: isOverdue,
    settleByInbound: settleByInbound, amountGap: amountGap
  };
})(window);
