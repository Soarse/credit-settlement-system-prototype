/* =============================================================================
 * generator.js —— 业务事件生成器（模拟上游：放款系统 / 还款系统 / 贷款核心）
 * 严格遵循 PRD 12.1 事件契约：event_id 全局唯一、occur_time 与 send_time 分离、
 * 反向业务用独立反向事件表达。
 * 使用固定随机种子，保证每次打开数据完全一致（可复算 / 可复现）。
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  function ev(o) {
    return Object.assign({
      event_id: '', event_code: '', occur_time: '', occur_date: '',
      receive_time: '', partner_no: '', agreement_no: '',
      product_code: 'P001', channel_code: 'CH001', biz_key: '',
      source_version: 1, payload: {},
      status: 'PENDING', ignore_reason: '', internal_no: ''
    }, o);
  }

  function generate() {
    var rng = new Core.Rng(20260907);
    var loans = [];
    var events = [];
    var seq = 0;
    function eid(prefix, date) { seq++; return prefix + '_' + date.replace(/-/g, '') + '_' + Core.pad(seq, 10); }

    function mkLoan(o) {
      var l = Object.assign({
        loan_no: '', partner_no: '', agreement_no: '', product_code: 'P001', channel_code: 'CH001',
        cust_no: '', contract_no: '', amount: 0, disburse_date: '', term: 12,
        funding_ratio: 1, overdueStart: null, overdueBase: 0, asset_status: 'NORMAL',
        settled_date: null, reversed: false
      }, o);
      loans.push(l);
      return l;
    }

    /** 简化的日终本金余额模型：等额本金按月递减，算头不算尾 */
    function balanceAt(loan, date) {
      if (loan.reversed) return 0;
      if (date < loan.disburse_date) return 0;
      if (loan.settled_date && date >= loan.settled_date) return 0;
      var months = (D.parse(date).getUTCFullYear() - D.parse(loan.disburse_date).getUTCFullYear()) * 12
        + (D.parse(date).getUTCMonth() - D.parse(loan.disburse_date).getUTCMonth());
      if (months < 0) months = 0;
      if (months >= loan.term) return 0;
      var b = loan.amount * (1 - months / loan.term);
      return M.r2(Math.max(0, b));
    }
    function overdueDaysAt(loan, date) {
      if (!loan.overdueStart || date < loan.overdueStart) return 0;
      return loan.overdueBase + D.diffDays(loan.overdueStart, date);
    }

    /* ---------------------------------------------------------------
     * ① P000012 华信银行 —— 放款额技术服务费 + 在贷余额资金成本
     *    跨版本：3/15 起费率下调（V01 → V02）
     * ------------------------------------------------------------- */
    var P12 = { partner: 'P000012', agr: 'AG202601000012' };
    // 存量借据（1–2 月放款，3 月起有余额）
    for (var i = 0; i < 12; i++) {
      mkLoan({
        loan_no: 'L2026' + (i < 6 ? '01' : '02') + Core.pad(100 + i, 4), partner_no: P12.partner,
        agreement_no: P12.agr, product_code: rng.pick(['P001', 'P002', 'P003']),
        channel_code: rng.pick(['CH001', 'CH005']),
        cust_no: 'U0001' + Core.pad(rng.int(1000, 9999), 5), contract_no: 'C2026' + Core.pad(1000 + i, 6),
        amount: rng.money(80000, 460000, 1000),
        disburse_date: (i < 6 ? '2026-01-' : '2026-02-') + Core.pad(rng.int(5, 25), 2),
        term: rng.pick([12, 18, 24]), funding_ratio: 1
      });
    }
    // 3 月新放款：一半在 3/15 前（V01 1.5%），一半在 3/15 后（V02 1.3%）
    var marDates12 = ['2026-03-03', '2026-03-08', '2026-03-12', '2026-03-18', '2026-03-23', '2026-03-28'];
    marDates12.forEach(function (dt, k) {
      var l = mkLoan({
        loan_no: 'L20260' + '3' + Core.pad(200 + k, 4), partner_no: P12.partner, agreement_no: P12.agr,
        product_code: rng.pick(['P001', 'P002']), channel_code: rng.pick(['CH001', 'CH005']),
        cust_no: 'U0002' + Core.pad(rng.int(1000, 9999), 5), contract_no: 'C2026' + Core.pad(2000 + k, 6),
        amount: k === 0 ? 50000 : rng.money(120000, 680000, 1000),
        disburse_date: dt, term: rng.pick([12, 18, 24]), funding_ratio: 1
      });
      events.push(ev({
        event_id: eid('DISB', dt), event_code: 'EV_DISBURSE_SUCCESS',
        occur_time: dt + 'T' + Core.pad(rng.int(9, 19), 2) + ':' + Core.pad(rng.int(0, 59), 2) + ':00+08:00',
        occur_date: dt, receive_time: dt + 'T' + Core.pad(rng.int(9, 19), 2) + ':30:12+08:00',
        partner_no: P12.partner, agreement_no: P12.agr, product_code: l.product_code,
        channel_code: l.channel_code, biz_key: l.loan_no,
        payload: { loan_no: l.loan_no, contract_no: l.contract_no, cust_no: l.cust_no,
          disburse_amount: l.amount, funding_ratio: 1, success_time: dt + 'T10:23:45+08:00', term: l.term }
      }));
    });
    // 4 月新放款（覆盖大部分自然日，使日增曲线接近真实业务节奏）
    var aprDates12 = [];
    for (var ad = 1; ad <= 30; ad++) { if (ad % 5 !== 0) aprDates12.push('2026-04-' + Core.pad(ad, 2)); }
    aprDates12.forEach(function (dt, k) {
      var l = mkLoan({
        loan_no: 'L202604' + Core.pad(300 + k, 4), partner_no: P12.partner, agreement_no: P12.agr,
        product_code: rng.pick(['P001', 'P002']), channel_code: rng.pick(['CH001', 'CH005']),
        cust_no: 'U0003' + Core.pad(rng.int(1000, 9999), 5), contract_no: 'C2026' + Core.pad(3000 + k, 6),
        amount: rng.money(150000, 720000, 1000), disburse_date: dt, term: rng.pick([12, 24]), funding_ratio: 1
      });
      events.push(ev({
        event_id: eid('DISB', dt), event_code: 'EV_DISBURSE_SUCCESS',
        occur_time: dt + 'T11:05:00+08:00', occur_date: dt, receive_time: dt + 'T11:05:03+08:00',
        partner_no: P12.partner, agreement_no: P12.agr, product_code: l.product_code,
        channel_code: l.channel_code, biz_key: l.loan_no,
        payload: { loan_no: l.loan_no, contract_no: l.contract_no, cust_no: l.cust_no,
          disburse_amount: l.amount, funding_ratio: 1, success_time: dt + 'T11:05:00+08:00', term: l.term }
      }));
    });

    /* ---------------------------------------------------------------
     * ② P000018 长安信托 —— 联合贷资金成本（日费率 6% / 360，出资比例 80%）
     *    含 P003 产品借据：规则过滤 product_codes=[P001,P002]，将命中 NO_RULE_MATCH
     * ------------------------------------------------------------- */
    for (var j = 0; j < 16; j++) {
      mkLoan({
        loan_no: 'L2026' + (j % 2 ? '01' : '02') + Core.pad(500 + j, 4), partner_no: 'P000018',
        agreement_no: 'AG202601000018',
        product_code: j >= 13 ? 'P003' : rng.pick(['P001', 'P002']),
        channel_code: rng.pick(['CH001', 'CH005', 'CH008']),
        cust_no: 'U0005' + Core.pad(rng.int(1000, 9999), 5), contract_no: 'C2026' + Core.pad(5000 + j, 6),
        amount: rng.money(200000, 1500000, 1000),
        disburse_date: (j % 2 ? '2026-01-' : '2026-02-') + Core.pad(rng.int(3, 26), 2),
        term: rng.pick([12, 24, 36]), funding_ratio: 0.8
      });
    }

    /* ---------------------------------------------------------------
     * ③ P000007 星辰消金 —— 累计放款额阶梯累进（PRD C-03 / C-05 复现）
     *    3 月累计放款额恰为 4.2 亿；其中第 2 笔 6,000 万于 3/30 撤销
     * ------------------------------------------------------------- */
    var marAmts07 = [80000000, 60000000, 30000000, 25000000, 45000000, 20000000, 35000000,
      15000000, 40000000, 22000000, 18000000, 12000000, 10000000, 8000000];
    var marDays07 = [2, 4, 6, 9, 11, 13, 16, 18, 20, 23, 24, 26, 27, 30];
    var loan07ToReverse = null, ev07ToReverse = null;
    marAmts07.forEach(function (amt, k) {
      var dt = '2026-03-' + Core.pad(marDays07[k], 2);
      var l = mkLoan({
        loan_no: 'L202603' + Core.pad(700 + k, 4), partner_no: 'P000007', agreement_no: 'AG202602000007',
        product_code: rng.pick(['P002', 'P004']), channel_code: 'CH005',
        cust_no: 'U0007' + Core.pad(rng.int(1000, 9999), 5), contract_no: 'C2026' + Core.pad(7000 + k, 6),
        amount: amt, disburse_date: dt, term: 24, funding_ratio: 1
      });
      var e = ev({
        event_id: eid('DISB', dt), event_code: 'EV_DISBURSE_SUCCESS',
        occur_time: dt + 'T14:20:00+08:00', occur_date: dt, receive_time: dt + 'T14:20:04+08:00',
        partner_no: 'P000007', agreement_no: 'AG202602000007', product_code: l.product_code,
        channel_code: l.channel_code, biz_key: l.loan_no,
        payload: { loan_no: l.loan_no, contract_no: l.contract_no, cust_no: l.cust_no,
          disburse_amount: amt, funding_ratio: 1, success_time: dt + 'T14:20:00+08:00', term: 24 }
      });
      events.push(e);
      if (k === 1) { loan07ToReverse = l; ev07ToReverse = e; }
    });
    // 3/30 撤销第 2 笔（6,000 万）→ 触发红冲 + 月末阶梯找平 +160,000.00
    events.push(ev({
      event_id: eid('DISBRV', '2026-03-30'), event_code: 'EV_DISBURSE_REVERSE',
      occur_time: '2026-03-30T16:40:00+08:00', occur_date: '2026-03-30',
      receive_time: '2026-03-30T16:40:05+08:00',
      partner_no: 'P000007', agreement_no: 'AG202602000007',
      product_code: loan07ToReverse.product_code, channel_code: loan07ToReverse.channel_code,
      biz_key: loan07ToReverse.loan_no,
      payload: { loan_no: loan07ToReverse.loan_no, origin_event_id: ev07ToReverse.event_id,
        reverse_amount: 60000000, reverse_time: '2026-03-30T16:40:00+08:00',
        reverse_reason: '资金方风控复核未通过，放款撤回' }
    }));
    loan07ToReverse.reversed = true;
    // 4 月放款（累计 2.68 亿，落第 2 档）—— 分布在 24 个自然日，贴近真实放款节奏
    var aprAmts07 = [12000000, 9000000, 15000000, 11000000, 8000000, 13000000, 10000000, 14000000,
      9000000, 12000000, 16000000, 11000000, 7000000, 13000000, 10000000, 12000000,
      8000000, 14000000, 11000000, 9000000, 12000000, 10000000, 13000000, 9000000];
    aprAmts07.forEach(function (amt, k) {
      var day = k + 2 + Math.floor(k / 6);           // 跳过若干日，模拟节假日
      var dt = '2026-04-' + Core.pad(Math.min(30, day), 2);
      var l = mkLoan({
        loan_no: 'L202604' + Core.pad(800 + k, 4), partner_no: 'P000007', agreement_no: 'AG202602000007',
        product_code: rng.pick(['P002', 'P004']), channel_code: 'CH005',
        cust_no: 'U0008' + Core.pad(rng.int(1000, 9999), 5), contract_no: 'C2026' + Core.pad(8000 + k, 6),
        amount: amt, disburse_date: dt, term: 24, funding_ratio: 1
      });
      events.push(ev({
        event_id: eid('DISB', dt), event_code: 'EV_DISBURSE_SUCCESS',
        occur_time: dt + 'T13:00:00+08:00', occur_date: dt, receive_time: dt + 'T13:00:06+08:00',
        partner_no: 'P000007', agreement_no: 'AG202602000007', product_code: l.product_code,
        channel_code: l.channel_code, biz_key: l.loan_no,
        payload: { loan_no: l.loan_no, contract_no: l.contract_no, cust_no: l.cust_no,
          disburse_amount: amt, funding_ratio: 1, success_time: dt + 'T13:00:00+08:00', term: 24 }
      }));
    });

    /* ---------------------------------------------------------------
     * ④ P000023 安泰担保 —— 余额型担保费，排除逾期 90 天以上资产
     * ------------------------------------------------------------- */
    for (var g = 0; g < 12; g++) {
      var od = null, ob = 0;
      if (g === 2) { od = '2026-03-05'; ob = 75; }   // 4 月中越过 90 天 → 停止计费
      if (g === 7) { od = '2026-03-20'; ob = 10; }   // 始终 < 90 天 → 继续计费
      mkLoan({
        loan_no: 'L2026' + (g % 2 ? '01' : '02') + Core.pad(900 + g, 4), partner_no: 'P000023',
        agreement_no: 'AG202601000023', product_code: rng.pick(['P001', 'P003']),
        channel_code: rng.pick(['CH001', 'CH008']),
        cust_no: 'U0009' + Core.pad(rng.int(1000, 9999), 5), contract_no: 'C2026' + Core.pad(9000 + g, 6),
        amount: rng.money(150000, 900000, 1000),
        disburse_date: (g % 2 ? '2026-01-' : '2026-02-') + Core.pad(rng.int(4, 24), 2),
        term: rng.pick([12, 18, 24]), funding_ratio: 1, overdueStart: od, overdueBase: ob
      });
    }

    /* ---------------------------------------------------------------
     * ⑤ P000031 瑞通银行 —— 回款分润 20% + 月度保底 50 万（PRD C-07 复现）
     *    3 月回款（本金+利息）合计 2,100,000 → 分润 420,000 < 保底 → 找平 +80,000
     *    4 月回款合计 2,900,000 → 分润 580,000 > 保底 → 无找平
     * ------------------------------------------------------------- */
    function genRepay(period, total, count, dayFrom) {
      var parts = [], rest = total;
      for (var k = 0; k < count - 1; k++) {
        var avg = rest / (count - k);
        var v = Math.round(avg * (0.6 + rng.next() * 0.8) / 100) * 100;
        if (v < 10000) v = 10000;
        if (v > rest - (count - k - 1) * 10000) v = Math.round((rest - (count - k - 1) * 10000) / 100) * 100;
        parts.push(v); rest -= v;
      }
      parts.push(Math.round(rest / 100) * 100);
      parts.forEach(function (amt, k) {
        var day = dayFrom + k * 2;
        if (day > 28) day = 28;
        var dt = period + '-' + Core.pad(day, 2);
        var prin = Math.round(amt * 0.82 / 100) * 100;
        var intr = amt - prin;
        var loanNo = 'L202602' + Core.pad(1100 + k, 4);
        if (!loans.some(function (x) { return x.loan_no === loanNo; })) {
          mkLoan({ loan_no: loanNo, partner_no: 'P000031', agreement_no: 'AG202603000031',
            product_code: 'P001', channel_code: 'CH001',
            cust_no: 'U0011' + Core.pad(1000 + k, 5), contract_no: 'C2026' + Core.pad(11000 + k, 6),
            amount: amt * 6, disburse_date: '2026-02-10', term: 12, funding_ratio: 1 });
        }
        events.push(ev({
          event_id: eid('REPAY', dt), event_code: 'EV_REPAY_SUCCESS',
          occur_time: dt + 'T20:15:00+08:00', occur_date: dt, receive_time: dt + 'T20:15:08+08:00',
          partner_no: 'P000031', agreement_no: 'AG202603000031', product_code: 'P001', channel_code: 'CH001',
          biz_key: loanNo,
          payload: { loan_no: loanNo, repay_no: 'RP' + dt.replace(/-/g, '') + Core.pad(k, 4),
            repay_principal: prin, repay_interest: intr, repay_penalty: 0, repay_liquidated: 0,
            repay_fee: 0, repay_source: 'SELF', clear_time: dt + 'T20:15:00+08:00' }
        }));
      });
      return parts;
    }
    genRepay('2026-03', 2100000, 10, 4);
    genRepay('2026-04', 2900000, 12, 3);

    /* ---------------------------------------------------------------
     * ⑥ 日终余额快照（贷款核心 T 日日切推送，逐笔一条事件）
     *    仅对含余额型计费的资金方生成：P000012 / P000018 / P000023
     * ------------------------------------------------------------- */
    var balPartners = ['P000012', 'P000018', 'P000023'];
    D.eachDay('2026-03-01', '2026-04-30', function (date) {
      loans.forEach(function (l) {
        if (balPartners.indexOf(l.partner_no) < 0) return;
        var bal = balanceAt(l, date);
        if (bal <= 0) return;
        var odd = overdueDaysAt(l, date);
        events.push(ev({
          event_id: 'BAL_' + l.loan_no + '_' + date.replace(/-/g, ''),
          event_code: 'EV_DAILY_BALANCE',
          occur_time: date + 'T23:59:59+08:00', occur_date: date,
          receive_time: D.addDays(date, 1) + 'T01:12:00+08:00',
          partner_no: l.partner_no, agreement_no: l.agreement_no,
          product_code: l.product_code, channel_code: l.channel_code, biz_key: l.loan_no,
          payload: { loan_no: l.loan_no, snapshot_date: date, principal_balance: bal,
            interest_receivable: M.r2(bal * 0.0004), overdue_days: odd,
            overdue_stage: odd === 0 ? 'M0' : (odd < 30 ? 'M1' : (odd < 60 ? 'M2' : (odd < 90 ? 'M3' : 'M4+'))),
            asset_status: odd >= 180 ? 'WRITE_OFF' : (odd > 0 ? 'OVERDUE' : 'NORMAL'),
            funding_ratio: l.funding_ratio, snapshot_version: 1 }
        }));
      });
    });

    /* ---------------------------------------------------------------
     * ⑦ 跨账期冲正（D-06 演示）：4/25 撤销 3 月的一笔华信银行放款
     * ------------------------------------------------------------- */
    var marDisb12 = events.filter(function (e) {
      return e.event_code === 'EV_DISBURSE_SUCCESS' && e.partner_no === 'P000012' && e.occur_date < '2026-04-01';
    });
    [2, 4].forEach(function (idx) {
      var src = marDisb12[idx];
      if (!src) return;
      events.push(ev({
        event_id: eid('DISBRV', '2026-04-25'), event_code: 'EV_DISBURSE_REVERSE',
        occur_time: '2026-04-25T10:12:00+08:00', occur_date: '2026-04-25',
        receive_time: '2026-04-25T10:12:03+08:00',
        partner_no: 'P000012', agreement_no: 'AG202601000012',
        product_code: src.product_code, channel_code: src.channel_code, biz_key: src.biz_key,
        payload: { loan_no: src.biz_key, origin_event_id: src.event_id,
          reverse_amount: src.payload.disburse_amount, reverse_time: '2026-04-25T10:12:00+08:00',
          reverse_reason: '客户放款后 T+n 申请撤销' }
      }));
    });

    /* ---------------------------------------------------------------
     * ⑧ 部分退款（PRD C-06 复现）：原放款 50,000 / 费用 750.00，退款 20,000 → 红冲 300.00
     * ------------------------------------------------------------- */
    var first12 = events.filter(function (e) {
      return e.event_code === 'EV_DISBURSE_SUCCESS' && e.partner_no === 'P000012'
        && e.payload.disburse_amount === 50000;
    })[0];
    if (first12) {
      events.push(ev({
        event_id: eid('REFUND', '2026-04-18'), event_code: 'EV_REFUND',
        occur_time: '2026-04-18T15:00:00+08:00', occur_date: '2026-04-18',
        receive_time: '2026-04-18T15:00:02+08:00',
        partner_no: 'P000012', agreement_no: 'AG202601000012',
        product_code: first12.product_code, channel_code: first12.channel_code, biz_key: first12.biz_key,
        payload: { loan_no: first12.biz_key, origin_event_id: first12.event_id,
          refund_amount: 20000, refund_time: '2026-04-18T15:00:00+08:00', refund_reason: '客户部分退款' }
      }));
    }

    /* ---------------------------------------------------------------
     * ⑨ 异常事件（用于演示 IGNORED 原因分类与待处理队列）
     * ------------------------------------------------------------- */
    // 协议不存在（未建档资金方）
    events.push(ev({
      event_id: eid('DISB', '2026-04-20'), event_code: 'EV_DISBURSE_SUCCESS',
      occur_time: '2026-04-20T09:30:00+08:00', occur_date: '2026-04-20',
      receive_time: '2026-04-20T09:30:02+08:00',
      partner_no: 'P000045', agreement_no: 'AG202609000045', product_code: 'P001', channel_code: 'CH001',
      biz_key: 'L2026040999',
      payload: { loan_no: 'L2026040999', contract_no: 'C202604099901', cust_no: 'U000104501',
        disburse_amount: 260000, funding_ratio: 1, success_time: '2026-04-20T09:30:00+08:00', term: 12 }
    }));
    // 资金方已暂停合作
    events.push(ev({
      event_id: eid('DISB', '2026-04-22'), event_code: 'EV_DISBURSE_SUCCESS',
      occur_time: '2026-04-22T14:00:00+08:00', occur_date: '2026-04-22',
      receive_time: '2026-04-22T14:00:01+08:00',
      partner_no: 'P000052', agreement_no: 'AG202506000052', product_code: 'P001', channel_code: 'CH001',
      biz_key: 'L2026040888',
      payload: { loan_no: 'L2026040888', contract_no: 'C202604088801', cust_no: 'U000105201',
        disburse_amount: 180000, funding_ratio: 1, success_time: '2026-04-22T14:00:00+08:00', term: 12 }
    }));
    // 重复投递（同 event_id）→ 幂等拦截
    if (marDisb12[1]) {
      var dup = Core.deep(marDisb12[1]);
      dup.receive_time = '2026-04-01T02:00:00+08:00';
      dup.status = 'PENDING';
      dup.__duplicate = true;
      events.push(dup);
    }
    // 5 月（当前在途账期）尚未处理的事件 —— 演示「待处理队列」
    ['2026-05-04', '2026-05-05'].forEach(function (dt, k) {
      var l = mkLoan({
        loan_no: 'L202605' + Core.pad(400 + k, 4), partner_no: 'P000012', agreement_no: 'AG202601000012',
        product_code: 'P001', channel_code: 'CH001',
        cust_no: 'U0004' + Core.pad(2000 + k, 5), contract_no: 'C2026' + Core.pad(4000 + k, 6),
        amount: 320000 + k * 55000, disburse_date: dt, term: 12, funding_ratio: 1
      });
      events.push(ev({
        event_id: eid('DISB', dt), event_code: 'EV_DISBURSE_SUCCESS',
        occur_time: dt + 'T10:00:00+08:00', occur_date: dt, receive_time: dt + 'T10:00:02+08:00',
        partner_no: 'P000012', agreement_no: 'AG202601000012', product_code: 'P001', channel_code: 'CH001',
        biz_key: l.loan_no,
        payload: { loan_no: l.loan_no, contract_no: l.contract_no, cust_no: l.cust_no,
          disburse_amount: l.amount, funding_ratio: 1, success_time: dt + 'T10:00:00+08:00', term: 12 },
        __holdPending: true
      }));
    });

    // 按 occur_time 排序（模拟到达顺序：日终快照在次日凌晨接收）
    events.sort(function (a, b) {
      if (a.receive_time !== b.receive_time) return a.receive_time < b.receive_time ? -1 : 1;
      return a.event_id < b.event_id ? -1 : 1;
    });
    events.forEach(function (e, i) { e.internal_no = Core.No.event(e.occur_date); e.__idx = i; });

    return { loans: loans, events: events };
  }

  global.Generator = { generate: generate };
})(window);
