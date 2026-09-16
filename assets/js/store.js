/* =============================================================================
 * store.js —— 全局状态、初始化流水线、业务动作、权限与操作留痕
 * 初始状态设计：2026-03 账期已跑完整链路（封账→出账→确认→结算→回单→对账），
 *               2026-04 账期费用流水已就绪但「待封账」，由使用者亲手驱动。
 *               2026-05 留 2 条未处理事件，用于演示待处理队列。
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  var listeners = [];
  var S = null;

  function emit() { listeners.forEach(function (fn) { try { fn(S); } catch (e) { console.error(e); } }); }
  function subscribe(fn) { listeners.push(fn); }

  function log(module, action, bizKey, detail) {
    S.opLogs.unshift({
      log_no: Core.No.generic('LOG', 8), module: module, action: action, biz_key: bizKey,
      detail: detail || '', operator: S.role, operate_time: nowStr(), ip: '10.20.30.41'
    });
  }
  function changeLog(objType, objId, op, before, after) {
    S.changeLogs.unshift({
      log_no: Core.No.generic('CHG', 8), object_type: objType, object_id: objId, operation: op,
      before_json: before, after_json: after, operator: S.role, operate_time: nowStr(), approval_no: ''
    });
  }
  function nowStr() {
    var d = new Date();
    return S.simToday + ' ' + Core.pad(d.getHours(), 2) + ':' + Core.pad(d.getMinutes(), 2);
  }

  /**
   * 产生告警（9.6.2）。第 5 个参数 meta 可带 { source, metric_code, dedupe }。
   * dedupe 为真时，若已存在同 title + 同 dedupe 键的未关闭告警则只累加计数，不重复刷屏。
   */
  function alert_(level, title, msg, link, meta) {
    meta = meta || {};
    if (meta.dedupe) {
      var same = S.alerts.filter(function (a) {
        return !a.closed && a.title === title && a.dedupe === meta.dedupe;
      })[0];
      if (same) {
        same.repeat = (same.repeat || 1) + 1;
        same.last_time = nowStr();
        same.msg = msg;
        return same;
      }
    }
    var a = {
      id: Core.No.generic('AL', 6), level: level, title: title, msg: msg, link: link || '',
      source: meta.source || '', metric_code: meta.metric_code || '', dedupe: meta.dedupe || '',
      time: nowStr(), last_time: nowStr(), repeat: 1,
      closed: false, close_by: '', close_time: '', close_note: '', close_action: '',
      reopen_count: 0, logs: [{ time: nowStr(), actor: '系统', action: '产生告警', detail: msg }]
    };
    S.alerts.unshift(a);
    return a;
  }

  /* ======================================================================
   * 初始化
   * ==================================================================== */
  function init() {
    Core.No.reset();
    var gen = Generator.generate();

    S = {
      role: 'FIN_OP',
      simToday: Data.SIM_TODAY,
      partners: Core.deep(Data.PARTNERS),
      accounts: Core.deep(Data.ACCOUNTS),
      invoiceInfos: Core.deep(Data.INVOICE_INFOS),
      agreements: Core.deep(Data.AGREEMENTS),
      versions: Core.deep(Data.VERSIONS),
      loans: gen.loans,
      /* 上游事实源镜像：本系统「实际收到」的事件是它的子集。
         seedEventGap() 会从 events 里摘掉几条，用来演示 12.1.5 的核对与回补。 */
      upstream: gen.events.slice(),
      events: gen.events,
      eng: Engine.createState(),
      bills: [], billMap: {}, adjustments: [], disputes: [],
      settleOrders: [], settleOrderMap: {}, settleFlows: [], receipts: [],
      diffs: [], reconRuns: {}, trials: [], recalcs: [],
      opLogs: [], changeLogs: [], alerts: [],
      wizardDraft: null, onboardings: [], approvals: [], reconTasks: [], inbounds: [], invoiceApplies: [], carryForwards: [],
      previews: []
    };
    S.partnerMap = Core.byId(S.partners, 'partner_no');
    S.accountMap = Core.byId(S.accounts, 'account_no_id');
    S.invoiceMap = Core.byId(S.invoiceInfos, 'partner_no');
    S.agreementMap = Core.byId(S.agreements, 'agreement_no');
    /* ---- 制造上游漏推：4 月 P000012 三笔放款事件未送达（12.1.5 演示）---- */
    seedEventGap();
    S.eventMap = Core.byId(S.events, 'event_id');

    var ctx = { partners: S.partners, agreements: S.agreements, versions: S.versions, eventsById: S.eventMap };

    /* ---- Phase 1：处理 3 月及以前的事件 ---- */
    var p1 = S.events.filter(function (e) { return e.occur_date <= '2026-03-31'; });
    Engine.processEvents(S.eng, p1, ctx);
    Engine.periodClose(S.eng, '2026-03', ctx);

    /* ---- 3 月账单：出账 → 推送 → 确认 ---- */
    Billing.generateBills(S, '2026-03');
    S.billMap = Core.byId(S.bills, 'bill_no');
    S.bills.forEach(function (b) {
      b.status = 'CONFIRMING'; b.push_time = b.calendar.bill_gen_date + 'T09:30:00+08:00';
      b.status = 'CONFIRMED'; b.confirm_time = b.calendar.confirm_deadline + 'T16:00:00+08:00';
      b.confirm_user = '资金方对接人'; b.confirm_evidence_url = '#/evidence/' + b.bill_no;
    });

    /* ---- 3 月结算：生成 → 审批 → 执行 → 回单 ---- */
    var orders = Billing.createSettleOrders(S, '2026-03');
    orders.forEach(function (o) {
      Billing.approveSettle(S, o, 'u_fin_mgr');
      Billing.executeSettle(S, o, 'SUCCESS');
    });

    /* ---- 3 月收款方向：银行入账 → 自动匹配 → 认领核销（8.5）---- */
    seedInbounds();

    /* ---- 3 月开票：账单确认后自动生成开票申请 → 已开票（7.8.2）---- */
    seedInvoices();

    /* ---- Phase 2：处理 4 月事件（3 月已封账 → 跨期冲正走调整项 D-06） ---- */
    var p2 = S.events.filter(function (e) { return e.occur_date >= '2026-04-01' && e.occur_date <= '2026-04-30'; });
    Engine.processEvents(S.eng, p2, ctx);
    Billing.buildAdjustmentsForPeriod(S, '2026-04');

    /* ---- Phase 3：5 月事件保持待处理 ---- */
    S.events.filter(function (e) { return e.occur_date >= '2026-05-01'; })
      .forEach(function (e) { if (!e.status || e.status === 'PENDING') e.status = 'PENDING'; });

    /* ---- 外部对账差异（3 月，与资金方口径分歧）---- */
    seedDiffs();
    /* ---- 争议单 ---- */
    seedDisputes();
    /* ---- 外部对账任务 ---- */
    seedReconTasks();
    /* ---- 在途审批单 ---- */
    seedApprovals();
    /* ---- 告警 ---- */
    seedAlerts();
    /* ---- 3 月勾稽结果留档 ---- */
    S.reconRuns['2026-03'] = Billing.runTieOut(S, '2026-03');

    log('系统', '初始化', '', '载入 3 月已结算账期 + 4 月待封账账期');
    return S;
  }

  /* ==================== 上游漏推事件（12.1.5 演示） ====================
   * 从「已收到」的事件里摘掉 4 月 P000012 的三笔放款，制造一个<b>不会自己暴露</b>的缺口：
   * 账单照样出、勾稽照样平，只有与上游按日核对笔数才能发现。
   */
  function seedEventGap() {
    var cand = S.events.filter(function (e) {
      return e.partner_no === 'P000012' && e.event_code === 'EV_DISBURSE_SUCCESS' &&
        e.occur_date >= '2026-04-14' && e.occur_date <= '2026-04-22';
    }).slice(0, 3);
    S.eventGapSeed = cand.map(function (e) { return e.event_id; });
    S.events = S.events.filter(function (e) { return S.eventGapSeed.indexOf(e.event_id) < 0; });
  }

  /* ==================== 收款认领种子（8.5） ====================
   * 3 月三张应收结算单分别演示三种自动匹配级别；另外两笔挂账演示无法匹配的处理分支。
   */
  function seedInbounds() {
    var SD = '2026-04-09';
    function mk(o) {
      var inb = {
        inbound_no: 'IB' + o.value_date.replace(/-/g, '') + Core.pad(S.inbounds.length + 1, 6),
        value_date: o.value_date, payer_name: o.payer_name, payer_account: o.payer_account,
        payer_bank: o.payer_bank, amount: o.amount, currency: 'CNY', remark: o.remark,
        channel_serial_no: 'BK' + o.value_date.replace(/-/g, '') + Core.pad(S.inbounds.length + 1, 8),
        source: o.source || 'BANK_FILE',
        status: 'SUSPENSE', match_level: 0, match_reason: '', settle_nos: [],
        claim_by: '', claim_time: '', claim_note: '',
        review_by: '', review_time: '', review_opinion: '',
        exclude_reason: '', logs: []
      };
      S.inbounds.push(inb);
      return inb;
    }
    function autoAndConfirm(inb, claimer, reviewer) {
      var r = Claim.autoMatch(S, inb);
      inb.match_level = r.level; inb.match_reason = r.reason; inb.settle_nos = r.settle_nos;
      inb.logs.push({ time: inb.value_date + 'T09:05:00+08:00', actor: '系统',
        action: '自动匹配', detail: r.level ? '命中规则 ' + r.level + '「' + r.rule.name + '」：' + r.reason : r.reason });
      if (!r.level) { inb.status = 'SUSPENSE'; return inb; }
      if (r.auto) {
        inb.status = 'AUTO_MATCHED';
      } else {
        inb.status = 'PENDING_REVIEW'; inb.claim_by = claimer;
        inb.claim_time = inb.value_date + 'T10:20:00+08:00';
        inb.claim_note = '可靠性为「' + (r.rule.reliability === 'MEDIUM' ? '中' : '低') + '」，按 8.5.2 提交二级复核';
        inb.logs.push({ time: inb.claim_time, actor: claimer, action: '认领', detail: '关联 ' + r.settle_nos.join('、') });
      }
      inb.review_by = reviewer; inb.review_time = inb.value_date + 'T11:00:00+08:00';
      inb.review_opinion = '已比对银行入账信息与结算单，同意核销';
      inb.logs.push({ time: inb.review_time, actor: reviewer, action: '复核通过', detail: inb.review_opinion });
      Claim.settleByInbound(S, inb);
      inb.status = 'CONFIRMED';
      inb.logs.push({ time: inb.review_time, actor: '系统', action: '核销',
        detail: '生成结算流水与银行回单，结算单置为已完成，关联账单置为已结算' });
      return inb;
    }

    /* 规则 1：备注含结算单号 */
    var o1 = S.settleOrders.filter(function (o) { return o.partner_no === 'P000007' && o.direction === 'RECEIVE'; })[0];
    if (o1) autoAndConfirm(mk({
      value_date: SD, payer_name: '星辰消费金融有限公司', payer_account: '3100016000077701234',
      payer_bank: '中国工商银行上海分行', amount: o1.settle_amount,
      remark: '2026年3月账期技术服务费结算款 ' + o1.settle_no
    }), 'u_fin_op', 'u_fin_review');

    /* 规则 2：付款账户 + 金额精确匹配唯一 */
    var o2 = S.settleOrders.filter(function (o) { return o.partner_no === 'P000012' && o.direction === 'RECEIVE'; })[0];
    if (o2) autoAndConfirm(mk({
      value_date: SD, payer_name: '华信银行股份有限公司', payer_account: '6222020200088812345',
      payer_bank: '华信银行总行营业部', amount: o2.settle_amount,
      remark: '2026年3月技术服务费与资金成本轧差净额'
    }), 'u_fin_op', 'u_fin_review');

    /* 规则 3：容差 ±0.01（跨行手续费导致少到 0.01 元）→ 需人工复核 */
    var o3 = S.settleOrders.filter(function (o) { return o.partner_no === 'P000031' && o.direction === 'RECEIVE'; })[0];
    if (o3) autoAndConfirm(mk({
      value_date: SD, payer_name: '瑞通银行股份有限公司', payer_account: '1200093100055509876',
      payer_bank: '瑞通银行天津分行', amount: M.r2(o3.settle_amount - 0.01),
      remark: '2026年3月回款分润（含保底找平）'
    }), 'u_fin_op', 'u_fin_review');

    /* 挂账一：付款方可识别，但无任何待收结算单可对应 —— 需人工判断是预付还是错付 */
    var s1 = mk({
      value_date: '2026-05-05', payer_name: '星辰消费金融有限公司', payer_account: '3100016000077701234',
      payer_bank: '中国工商银行上海分行', amount: 88000, remark: '业务往来款'
    });
    s1.match_reason = Claim.autoMatch(S, s1).reason;
    s1.logs.push({ time: '2026-05-05T09:05:00+08:00', actor: '系统', action: '自动匹配', detail: s1.match_reason });

    /* 挂账二：付款方账户不在任何资金方白名单 —— 典型「非本系统款项」，且已超 3 个工作日 */
    var s2 = mk({
      value_date: '2026-04-27', payer_name: '宁川商贸有限公司', payer_account: '6217000010009988776',
      payer_bank: '中国银行天津和平支行', amount: 156800, remark: '货款'
    });
    s2.match_reason = Claim.autoMatch(S, s2).reason;
    s2.logs.push({ time: '2026-04-27T09:05:00+08:00', actor: '系统', action: '自动匹配', detail: s2.match_reason });
    alert_('P1', '挂账超期', '入账流水 ' + s2.inbound_no + '（' + M.fmt(s2.amount) +
      ' 元）挂账已超 ' + Claim.SUSPENSE_ALERT_DAYS + ' 个工作日，需运营认领或退回', '#/claim');
  }

  /* ==================== 开票种子（7.8.2） ====================
   * 3 月账单已经资金方确认 → 自动生成开票申请 → 提交发票系统 → 回传开票结果。
   */
  function seedInvoices() {
    var applyDate = '2026-04-10';
    S.bills.filter(function (b) { return b.billing_period === '2026-03'; }).forEach(function (b) {
      var plan = Invoice.planFor(S, b);
      var a = Invoice.buildBlue(S, b, plan, applyDate);
      registerApply(a, applyDate);
      a.status = 'SUBMITTED'; a.submit_time = applyDate + 'T10:05:00+08:00';
      a.logs.push({ time: a.submit_time, actor: 'u_fin_op', action: '提交发票系统',
        detail: '推送开票申请报文（购方 ' + a.buyer.title + '／销方 ' + a.seller.title + '）' });
      issueApply(a, '2026-04-11', true);
    });
  }

  /** 编号并入库 */
  function registerApply(a, applyDate) {
    a.apply_no = 'IV' + applyDate.replace(/-/g, '') + Core.pad(S.invoiceApplies.length + 1, 6);
    a.logs.push({ time: applyDate + 'T09:40:00+08:00', actor: '系统', action: '生成开票申请',
      detail: '账单 ' + a.bill_no + ' 已确认，按 7.8.2 自动生成' + (a.kind === 'RED' ? '红字' : '蓝字') +
        '开票申请，金额 ' + M.fmt(a.amount) + ' 元（税额 ' + M.fmt(a.tax_amount) + '）' });
    S.invoiceApplies.push(a);
    var b = S.billMap[a.bill_no];
    if (b) { b.invoice_apply_nos = (b.invoice_apply_nos || []).concat([a.apply_no]); }
    return a;
  }

  /** 发票系统回传开票结果 → 回写账单（7.8.2） */
  function issueApply(a, date, ok, failReason) {
    if (!ok) {
      a.status = 'FAILED'; a.fail_reason = failReason || '购方税号校验不通过，发票系统拒绝受理';
      a.logs.push({ time: date + 'T14:20:00+08:00', actor: '发票系统', action: '开票失败', detail: a.fail_reason });
      return a;
    }
    var seq = S.invoiceApplies.filter(function (x) { return x.status === 'ISSUED'; }).length + 1;
    a.status = 'ISSUED';
    a.invoice_code = (a.kind === 'RED' ? '011002' : '011001') + date.slice(0, 4) + '99';
    a.invoice_no = Core.pad(20260000 + seq, 8);
    a.issue_date = date;
    a.pdf_url = '#/invoice-pdf/' + a.invoice_no;
    a.logs.push({ time: date + 'T14:20:00+08:00', actor: '发票系统', action: '开票成功',
      detail: '发票代码 ' + a.invoice_code + '　号码 ' + a.invoice_no + '　开票日期 ' + date +
        '　' + (a.kind === 'RED' ? '红字' : '蓝字') + (a.invoice_type === 'SPECIAL' ? '增值税专用发票' : '增值税普通发票') });
    var b = S.billMap[a.bill_no];
    if (b) { b.invoice_status = 'ISSUED'; b.invoice_no = a.invoice_no; }
    return a;
  }

  function seedDiffs() {
    var flows12 = S.eng.feeFlows.filter(function (f) {
      return f.partner_no === 'P000012' && f.charge_item_code === 'TECH_SERVICE_FEE' &&
        f.billing_period === '2026-03' && f.flow_type === 'NORMAL' && f.rule_version === 'V01';
    });
    if (flows12[0]) {
      var f = flows12[0];
      S.diffs.push({
        diff_no: Core.No.diff('2026-04-10'), recon_task_no: 'RT202603P000012',
        diff_source: 'EXTERNAL', diff_level: 'EXTERNAL', diff_type: 'AMOUNT_DIFF',
        partner_no: 'P000012', biz_key: f.charge_object_id, fee_flow_no: f.fee_flow_no,
        bill_no: f.bill_no, settle_no: '',
        our_amount: f.fee_amount, their_amount: M.r2(f.basis_amount * 0.013),
        diff_amount: M.r2(f.fee_amount - f.basis_amount * 0.013),
        auto_analysis: {
          steps: [
            { ok: true, text: '事件存在性：双方均有 ' + f.fee_date + ' 放款事件' },
            { ok: true, text: '基数一致性：我方基数 ' + M.fmt(f.basis_amount) + '，与对方一致' },
            { ok: false, text: '费率差异：我方适用 1.500%（版本 V01），对方适用 1.300%（V02）' }
          ],
          suspect: '协议版本路由分歧',
          evidence: 'V01 生效区间 [2026-01-01, 2026-03-15)；V02 生效区间 [2026-03-15, 9999-12-31)；事件发生日 ' + f.fee_date + ' 落于 V01',
          advice: '向资金方出示版本条款与 PRD 5.4.3 路由规则，我方口径正确概率高'
        },
        status: 'PENDING', responsibility: 'UNDETERMINED', resolution: '',
        create_time: '2026-04-10', close_time: '', aging_days: 26
      });
    }
    var flows18 = S.eng.feeFlows.filter(function (f) { return f.partner_no === 'P000018' && f.billing_period === '2026-03'; });
    if (flows18[0]) {
      S.diffs.push({
        diff_no: Core.No.diff('2026-04-11'), recon_task_no: 'RT202603P000018',
        diff_source: 'EXTERNAL', diff_level: 'EXTERNAL', diff_type: 'AMOUNT_DIFF',
        partner_no: 'P000018', biz_key: flows18[0].charge_object_id, fee_flow_no: flows18[0].fee_flow_no,
        bill_no: flows18[0].bill_no, settle_no: '',
        our_amount: flows18[0].fee_amount, their_amount: M.r2(flows18[0].fee_amount - 0.01),
        diff_amount: 0.01,
        auto_analysis: {
          steps: [
            { ok: true, text: '事件存在性：一致' },
            { ok: true, text: '基数一致性：一致' },
            { ok: false, text: '流水粒度差异：我方 PER_DAY 逐日舍入，对方按期末一次性计算（PRD 6.4.3）' }
          ],
          suspect: '舍入粒度口径差异',
          evidence: '单笔差 0.01 元，落在容差 0.05 元内',
          advice: '自动核销并计入容差累计；若持续单向偏移需复核口径'
        },
        status: 'CLOSED', responsibility: 'BOTH', resolution: '维持（容差内自动核销）',
        create_time: '2026-04-11', close_time: '2026-04-11', aging_days: 0
      });
    }
    var flows07 = S.eng.feeFlows.filter(function (f) { return f.partner_no === 'P000007' && f.flow_type === 'TIER_TRUEUP'; });
    if (flows07[0]) {
      S.diffs.push({
        diff_no: Core.No.diff('2026-04-12'), recon_task_no: 'RT202603P000007',
        diff_source: 'EXTERNAL', diff_level: 'EXTERNAL', diff_type: 'THEIRS_EXTRA',
        partner_no: 'P000007', biz_key: '—', fee_flow_no: flows07[0].fee_flow_no,
        bill_no: flows07[0].bill_no, settle_no: '',
        our_amount: flows07[0].fee_amount, their_amount: 0, diff_amount: flows07[0].fee_amount,
        auto_analysis: {
          steps: [
            { ok: true, text: '双方 3 月累计放款额一致：360,000,000.00（已扣除撤销 60,000,000.00）' },
            { ok: false, text: '对方未记录「月末阶梯找平」流水，按逐笔临时计费结果直接汇总' }
          ],
          suspect: '阶梯找平机制未对齐',
          evidence: 'TierCalc(360,000,000) = 4,760,000.00；逐笔已计费合计 4,600,000.00；找平差额 +160,000.00',
          advice: '向资金方说明累进阶梯的期末找平逻辑（PRD 6.4.6），并附分档明细'
        },
        status: 'CHECKING', responsibility: 'THEIRS', resolution: '',
        create_time: '2026-04-12', close_time: '', aging_days: 24
      });
    }
  }

  function mkDispute(o) {
    var d = {
      dispute_no: Core.No.dispute(o.create_time), bill_no: o.bill_no, partner_no: o.partner_no,
      dispute_type: o.dispute_type, dispute_scope: o.dispute_scope || 'CHARGE_ITEM',
      disputed_amount: o.disputed_amount || 0, partner_claim: o.partner_claim,
      evidence_urls: o.evidence_urls || [], our_evidence: o.our_evidence || [],
      status: o.status || 'PENDING', locate: null,
      resolution: '', conclusion: '', conclusion_by: '', conclusion_time: '',
      adjustment_no: '', recalc_task_no: '', statement_url: '',
      confirm_by: '', confirm_time: '', close_time: '',
      escalated_to: '', escalate_time: '',
      sla_deadline: Dispute.addWorkdays(o.create_time, Dispute.SLA.TOTAL_DAYS),
      create_time: o.create_time, logs: [
        { time: o.create_time + 'T09:10:00+08:00', actor: '资金方对接人', action: '提出争议',
          detail: o.partner_claim }
      ]
    };
    S.disputes.push(d);
    var b = S.billMap[d.bill_no];
    if (b && b.status !== 'SETTLED') b.status = 'DISPUTED';
    return d;
  }

  function seedDisputes() {
    var b7 = S.bills.filter(function (x) { return x.partner_no === 'P000007'; })[0];
    var b12 = S.bills.filter(function (x) { return x.partner_no === 'P000012' && x.direction === 'RECEIVABLE'; })[0];
    var b18 = S.bills.filter(function (x) { return x.partner_no === 'P000018'; })[0];

    /* ① 费率适用错误 —— 已自动定位、运营核查中，仍在 SLA 内 */
    if (b7) {
      var d1 = mkDispute({
        bill_no: b7.bill_no, partner_no: 'P000007', dispute_type: 'RATE_APPLY',
        disputed_amount: 160000, create_time: '2026-05-04', status: 'CHECKING',
        partner_claim: '我方按期末累计放款额 3.6 亿一次性套档汇总为 4,600,000.00，与贵方账单 4,760,000.00 相差 160,000.00，请说明。',
        evidence_urls: ['#/evidence/xc-202603-calc.xlsx']
      });
      d1.locate = Dispute.autoLocate(S, d1);
      d1.logs.push({ time: '2026-05-04T09:12:00+08:00', actor: '系统', action: '自动定位',
        detail: '按争议类型「费率适用错误」拉取规则版本快照与阶梯找平流水，生成核查包' });
    }

    /* ② 冲正未体现 —— 刚提出，待受理 */
    if (b12) {
      mkDispute({
        bill_no: b12.bill_no, partner_no: 'P000012', dispute_type: 'REVERSAL',
        disputed_amount: 16162, create_time: '2026-05-06',
        partner_claim: '3 月有三笔放款已撤销 / 退款，但 3 月账单仍按原额收费，未见冲减。',
        evidence_urls: ['#/evidence/hx-202603-reverse.pdf']
      });
    }

    /* ③ 基数不符 —— 已超 T+3，升级财务负责人 */
    if (b18) {
      var d3 = mkDispute({
        bill_no: b18.bill_no, partner_no: 'P000018', dispute_type: 'BASIS_DIFF',
        disputed_amount: 4200, create_time: '2026-04-27', status: 'CHECKING',
        partner_claim: '我方统计 3 月日均在贷余额与贵方计费基数存在差异，涉及金额约 4,200.00。',
        evidence_urls: ['#/evidence/ca-202603-balance.xlsx']
      });
      d3.locate = Dispute.autoLocate(S, d3);
      d3.logs.push({ time: '2026-04-27T09:15:00+08:00', actor: '系统', action: '自动定位',
        detail: '按争议类型「基数不符」拉取基数快照与借据清单，生成核查包' });
      alert_('P1', '争议超期', '争议单 ' + d3.dispute_no + ' 已超 T+3 未闭环，按 7.7.3 升级至财务负责人',
        '#/disputes?id=' + d3.dispute_no);
    }
  }

  function seedReconTasks() {
    S.partners.filter(function (p) { return p.status === 'ACTIVE'; }).forEach(function (p) {
      Data.PERIODS.forEach(function (period) {
        var n = S.eng.feeFlows.filter(function (f) { return f.partner_no === p.partner_no && f.billing_period === period; }).length;
        if (!n) return;
        S.reconTasks.push({
          recon_task_no: 'RT' + period.replace('-', '') + p.partner_no,
          partner_no: p.partner_no, period: period, recon_type: 'EXTERNAL',
          status: period === '2026-03' ? 'SENT' : 'PENDING_SEND',
          sent_time: period === '2026-03' ? '2026-04-01 09:30' : '',
          our_count: n, file_out: '', file_in: '', in_rows: null,
          match: null, diff_created: 0, create_time: nowStr()
        });
      });
    });
  }

  function seedApprovals() {
    var keep = S.role;
    // ① 协商减免调整项（财务核算发起 → 财务复核审批）
    S.role = 'FIN_OP';
    var adj = Actions.addAdjustment({
      partner_no: 'P000018', agreement_no: 'AG202601000018', direction: 'PAYABLE',
      settle_in_period: '2026-05', source_type: 'DISCOUNT', amount: -38000,
      reason: '商务协商：因 3 月系统切换导致的对账工作量补偿，本期资金成本减免 38,000.00（依据：商务纪要 BZ-2026-041）'
    });
    Actions.submitAdjustmentApproval(adj.adjustment_no);
    // ② 银行账户变更（BD 发起 → 财务复核 → 财务负责人）
    S.role = 'BD';
    var acct = S.accountMap['PA000012002'];
    if (acct) {
      Approval.create(S, {
        biz_type: 'ACCOUNT', biz_key: acct.account_no_id,
        title: '华信银行 新增收款账户 ' + acct.account_no_id,
        amount: 0, partner_no: acct.partner_no, route: '/partner/P000012?tab=account',
        reason: '资金方新增北京分行收款账户，用于 4 月起的应收结算',
        payload: { acctNo: acct.account_no_id },
        summary: [
          ['户名', acct.account_name], ['开户行', acct.bank_name],
          ['账号（脱敏）', acct.bank_account_no.slice(0, 4) + ' **** **** ' + acct.bank_account_no.slice(-4)],
          ['账户用途', '我方收款用'], ['录入人', acct.first_maker_id],
          ['白名单', '审批通过后进入白名单，T+1 冷静期生效']
        ]
      });
    }
    S.role = keep;
  }

  function seedAlerts() {
    alert_('P2', '外部对账差异待处理', '存在 2 条未闭环差异单（P000012 版本路由分歧、P000007 阶梯找平口径）',
      '#/diffs', { source: '对账中心' });
    alert_('P2', '账户待复核', 'PA000012002 处于 PENDING_REVIEW，需财务复核后方可进入白名单',
      '#/partner/P000012', { source: '资金方主数据' });
    alert_('P3', '4 月账期待封账', '2026-04 账期费用流水已就绪，等待封账与出账',
      '#/workbench', { source: '账单中心' });
    /* 一条已闭环的历史告警，用来演示关闭闭环的留痕形态 */
    var done = alert_('P1', '日终快照延迟到达', '2026-03-18 长安信托日终快照延迟 2 小时到达，已自动补算',
      '#/daily?date=2026-03-18', { source: '计费引擎' });
    done.closed = true; done.close_by = 'u_ops'; done.close_time = '2026-03-18 11:20';
    done.close_action = 'FIXED';
    done.close_note = '已与贷款核心确认为批量任务排队所致，快照到达后自动补算完成，当日流水无缺口';
    done.logs.push({ time: done.close_time, actor: 'u_ops', action: '关闭告警',
      detail: '处理方式：已修复　' + done.close_note });
    /* 指标越线的告警在初始化末尾统一扫描产生 */
    Actions.scanMetrics();
  }

  /* ======================================================================
   * 权限
   * ==================================================================== */
  function can(action) {
    var allow = Data.PERMS[action];
    if (!allow) return true;
    if (S.role === 'AUDIT') return false;
    return allow.indexOf(S.role) >= 0;
  }
  function roleName(code) {
    var r = Data.ROLES.filter(function (x) { return x.code === code; })[0];
    return r ? r.name : code;
  }
  function currentUser() {
    var u = (Data.ROLE_USERS || {})[S.role] || { user_id: 'u_' + String(S.role || '').toLowerCase(), user_name: roleName(S.role) };
    return { user_id: u.user_id, user_name: u.user_name, role: S.role, role_name: roleName(S.role) };
  }

  /* ======================================================================
   * 业务动作
   * ==================================================================== */
  var Actions = {
    /* ---- 预出账（7.2）：只读预览，不落库；快照可留档与正式账单比对 ---- */
    previewBills: function (period, asOf, partnerNo) {
      return Preview.build(S, period, asOf || S.simToday, partnerNo || '');
    },
    savePreview: function (period, asOf, partnerNo) {
      if (!can('bill.preview')) return { ok: false, msg: '当前角色无预出账权限' };
      var pv = Preview.build(S, period, asOf || S.simToday, partnerNo || '');
      var snap = Preview.snapshot(pv, S.role);
      snap.create_time = nowStr();
      S.previews.unshift(snap);
      log('账单中心', '预出账快照', snap.preview_no,
        period + ' 截至 ' + snap.as_of + '（进度 ' + Core.Money.pct(snap.progress_pct, 0) +
        '）累计 ' + Core.Money.fmt(snap.total) + '，' + snap.blocked + ' 个组合存在阻断项');
      emit();
      return { ok: true, snapshot: snap, preview: pv };
    },
    comparePreview: function (previewNo) {
      var snap = S.previews.filter(function (p) { return p.preview_no === previewNo; })[0];
      if (!snap) return null;
      return { snapshot: snap, result: Preview.compare(S, snap) };
    },

    /* ---- 事件重跑（待处理队列）---- */
    replayPendingEvents: function () {
      var ctx = { partners: S.partners, agreements: S.agreements, versions: S.versions, eventsById: S.eventMap };
      var pend = S.events.filter(function (e) { return e.status === 'PENDING'; });
      pend.forEach(function (e) { delete e.__holdPending; });
      Engine.processEvents(S.eng, pend, ctx);
      log('计费引擎', '重跑待处理事件', '', pend.length + ' 条');
      emit();
      return pend.length;
    },

    /* ---- 封账（7.2.3）---- */
    closePeriod: function (period) {
      var blockers = [];
      var pend = S.events.filter(function (e) {
        return D.period(e.occur_date) === period && ['PENDING', 'PROCESSING', 'FAILED'].indexOf(e.status) >= 0;
      });
      if (pend.length) blockers.push('存在 ' + pend.length + ' 条未达终态事件');
      S.partners.forEach(function (p) {
        var miss = Billing.missingSnapshotDays(S, p.partner_no, period);
        if (miss.length) blockers.push(p.partner_short_name + ' 缺失日终快照 ' + miss.length + ' 天');
      });
      var tie = Billing.runTieOut(S, period);
      var l1 = tie.levels[0];
      if (l1.eqs.some(function (e) { return !e.ok; })) blockers.push('L1→L2 日度勾稽未通过');
      if (blockers.length) return { ok: false, blockers: blockers };
      var ctx = { partners: S.partners, agreements: S.agreements, versions: S.versions, eventsById: S.eventMap };
      var produced = Engine.periodClose(S.eng, period, ctx);
      log('账单中心', '封账', period, '生成周期性流水 ' + produced.length + ' 条');
      emit();
      return { ok: true, produced: produced };
    },

    /* ---- 出账 ---- */
    generateBills: function (period) {
      var made = Billing.generateBills(S, period);
      S.billMap = Core.byId(S.bills, 'bill_no');
      log('账单中心', '出账', period, '生成账单 ' + made.filter(function (m) { return !m.blocked; }).length + ' 张');
      emit();
      return made;
    },
    pushBill: function (billNo) {
      var b = S.billMap[billNo]; if (!b) return;
      b.status = 'CONFIRMING'; b.push_time = S.simToday + 'T09:30:00+08:00';
      log('账单中心', '推送账单', billNo, '文件 + 接口双通道'); emit();
    },
    confirmBill: function (billNo, auto) {
      var b = S.billMap[billNo]; if (!b) return;
      b.status = 'CONFIRMED'; b.confirm_time = S.simToday + 'T16:00:00+08:00';
      b.confirm_user = auto ? '（超期默认确认）' : '资金方对接人';
      b.confirm_evidence_url = '#/evidence/' + billNo;
      log('账单中心', '账单确认', billNo, auto ? '超期默认确认' : '资金方回执确认');
      /* 7.8.2：账单确认后自动生成开票申请（含负调整项的红蓝票判定） */
      var iv = Actions.createInvoiceApply(billNo, { silent: true });
      if (iv.ok) log('账单中心', '自动生成开票申请', billNo,
        iv.applies.map(function (x) { return x.apply_no; }).join('、'));
      emit();
      return { ok: true, bill: b, invoice: iv };
    },
    disputeBill: function (billNo, claim, amount, type) {
      var b = S.billMap[billNo]; if (!b) return;
      var d = mkDispute({
        bill_no: billNo, partner_no: b.partner_no, dispute_type: type || 'CALIBER',
        dispute_scope: amount && Math.abs(amount) < Math.abs(b.total_amount) ? 'PARTIAL_AMOUNT' : 'WHOLE_BILL',
        disputed_amount: amount || 0,
        partner_claim: claim || '对账单金额有异议', create_time: S.simToday
      });
      log('账单中心', '登记争议', billNo, claim || ''); emit();
      return d;
    },
    voidBill: function (billNo, reason) {
      var b = S.billMap[billNo]; if (!b) return;
      b.status = 'VOIDED'; b.void_reason = reason || '';
      S.eng.feeFlows.forEach(function (f) { if (f.bill_no === billNo) f.bill_no = ''; });
      S.adjustments.forEach(function (a) { if (a.bill_no === billNo) a.bill_no = ''; });
      /* 7.8.3：账单作废（未开票）→ 开票申请随之作废；已开票的必须走红字发票 */
      S.invoiceApplies.filter(function (a) { return a.bill_no === billNo; }).forEach(function (a) {
        if (a.status === 'ISSUED') {
          alert_('P1', '账单作废但发票已开出', '账单 ' + billNo + ' 的发票 ' + a.invoice_no +
            ' 已开出，须开红字发票冲回，不能仅作废申请', '#/invoices?apply=' + a.apply_no);
          return;
        }
        a.status = 'VOIDED'; a.void_reason = '账单作废：' + (reason || '');
        a.logs.push({ time: nowStr(), actor: S.role, action: '作废申请', detail: a.void_reason });
      });
      b.invoice_status = ''; b.invoice_no = '';
      log('账单中心', '作废账单', billNo, reason || ''); emit();
    },
    addAdjustment: function (o) {
      var a = Object.assign({
        adjustment_no: Core.No.adjustment(S.simToday), bill_no: '', settle_in_period: '',
        source_type: 'DISCOUNT', origin_period: '', origin_ref: '', amount: 0, reason: '',
        approval_no: '', status: 'PENDING_APPROVAL', creator: S.role, approver: '', create_time: S.simToday
      }, o);
      S.adjustments.push(a);
      log('账单中心', '新增调整项', a.adjustment_no, a.reason); emit();
      return a;
    },
    approveAdjustment: function (no) {
      var a = S.adjustments.filter(function (x) { return x.adjustment_no === no; })[0];
      if (!a) return;
      a.status = 'APPROVED'; a.approver = S.role; a.approval_no = Core.No.approval(S.simToday);
      log('账单中心', '审批调整项', no, ''); emit();
    },

    /* ---- 结算 ---- */
    createSettleOrders: function (period) {
      var made = Billing.createSettleOrders(S, period);
      log('结算中心', '生成结算单', period, made.length + ' 张'); emit();
      return made;
    },
    approveSettle: function (settleNo) {
      var o = S.settleOrderMap[settleNo]; if (!o) return;
      var risk = Billing.riskCheck(S, o);
      if (!risk.pass) return { ok: false, risk: risk };
      Billing.approveSettle(S, o, S.role);
      log('结算中心', '结算审批通过', settleNo, '审批链 ' + Billing.approvalLevel(o.settle_amount).join(' + '));
      changeLog('settle_order', settleNo, 'APPROVE', 'PENDING', 'PROCESSING');
      emit();
      return { ok: true, order: o };
    },
    /**
     * 模拟通道执行结果（8.5）。scenario：
     *   SUCCESS 全部成功 / PARTIAL 部分成功 / FAILED 全部失败 / UNKNOWN 末笔无明确结果
     */
    executeSettle: function (settleNo, outcome) {
      var o = S.settleOrderMap[settleNo]; if (!o) return;
      var sc = outcome || 'SUCCESS';
      if (o.direction === 'RECEIVE') return o;
      if (!o.instructions.length) return o;
      var last = o.instructions.length - 1;
      o.instructions.forEach(function (ins, i) {
        if (ins.status !== 'READY' && ins.status !== 'SENT' && ins.status !== 'PROCESSING') return;
        if (sc === 'SUCCESS') Actions.instructionCallback(ins.instruction_no, 'SUCCESS');
        else if (sc === 'FAILED') Actions.instructionCallback(ins.instruction_no, 'FAILED');
        else if (sc === 'PARTIAL') Actions.instructionCallback(ins.instruction_no, i === last && o.instructions.length > 1 ? 'FAILED' : 'SUCCESS');
        else if (sc === 'UNKNOWN') Actions.instructionCallback(ins.instruction_no, i === last ? 'UNKNOWN' : 'SUCCESS');
      });
      Actions.syncOrder(o);
      if (sc === 'PARTIAL') {
        var sfl = Payment.shortfall(o);
        alert_('P1', '结算部分成功', '结算单 ' + settleNo + ' 已付 ' + M.fmt(sfl.paid) +
          '，未付 ' + M.fmt(sfl.unpaid) + '，需对失败部分补发指令并把未付部分结转下期',
          '#/payexc?order=' + settleNo);
      }
      log('结算中心', '执行付款', settleNo, '结果 ' + o.status); emit();
      return o;
    },

    /* ---- 规则中心 ---- */
    runTrial: function (versionId, compareVersionId, range) {
      var draft = S.versions.filter(function (v) { return v.agreement_version_id === versionId; })[0];
      var base = S.versions.filter(function (v) { return v.agreement_version_id === compareVersionId; })[0];
      if (!draft) return null;
      var agr = S.agreementMap[draft.agreement_no];
      var evs = S.events.filter(function (e) {
        return e.agreement_no === draft.agreement_no && e.occur_date >= range.from && e.occur_date <= range.to
          && e.status !== 'PENDING';
      });
      var ctx = { partners: S.partners, agreements: S.agreements, versions: S.versions };
      function widen(v) {
        var c = Core.deep(v);
        c.status = 'EFFECTIVE'; c.effective_date = '1900-01-01'; c.expiry_date = '9999-12-31';
        return [c];
      }
      var stNew = Engine.shadowRun(evs, ctx, widen(draft));
      var stOld = base ? Engine.shadowRun(evs, ctx, widen(base)) : null;
      function summarize(st) {
        var byItem = Core.groupBy(st.feeFlows, function (f) { return f.charge_item_code; });
        var rows = {};
        Object.keys(byItem).forEach(function (k) {
          rows[k] = { code: k, name: byItem[k][0].charge_item_name, amount: M.sum(byItem[k], function (f) { return f.fee_amount; }), count: byItem[k].length };
        });
        return rows;
      }
      var rNew = summarize(stNew), rOld = stOld ? summarize(stOld) : {};
      var keys = Core.uniq(Object.keys(rOld).concat(Object.keys(rNew)));
      var rows = keys.map(function (k) {
        var o = rOld[k] || { amount: 0, count: 0, name: (rNew[k] || {}).name };
        var n = rNew[k] || { amount: 0, count: 0, name: (rOld[k] || {}).name };
        return { code: k, name: n.name || o.name, oldAmount: o.amount, newAmount: n.amount,
          diff: M.r2(n.amount - o.amount), pct: o.amount ? (n.amount - o.amount) / o.amount : null,
          isNew: !rOld[k], count: n.count || o.count };
      });
      var trial = {
        trial_no: Core.No.trial(S.simToday), agreement_no: draft.agreement_no,
        partner_no: agr.partner_no, draft_version: draft.version_no, base_version: base ? base.version_no : '—',
        draft_version_id: versionId, range: range, event_count: evs.length,
        rows: rows,
        oldTotal: M.sum(rows, function (r) { return r.oldAmount; }),
        newTotal: M.sum(rows, function (r) { return r.newAmount; }),
        flowsNew: stNew.feeFlows, flowsOld: stOld ? stOld.feeFlows : [],
        create_time: S.simToday, creator: S.role,
        touchedBills: S.bills.filter(function (b) {
          return b.agreement_no === draft.agreement_no && b.billing_period >= D.period(range.from) &&
            b.billing_period <= D.period(range.to) && (b.status === 'CONFIRMED' || b.status === 'SETTLED');
        }).map(function (b) { return b.bill_no; })
      };
      trial.diffTotal = M.r2(trial.newTotal - trial.oldTotal);
      S.trials.unshift(trial);
      draft.__trialNo = trial.trial_no;
      log('规则中心', '发起试算', draft.agreement_no + '-' + draft.version_no,
        '范围 ' + range.from + ' ~ ' + range.to + '，事件 ' + evs.length + ' 条');
      emit();
      return trial;
    },
    publishVersion: function (versionId) {
      var v = S.versions.filter(function (x) { return x.agreement_version_id === versionId; })[0];
      if (!v) return { ok: false, msg: '版本不存在' };
      var agr = S.agreementMap[v.agreement_no];
      var checks = Engine.validateRules(v, agr, { trialDone: !!v.__trialNo, trialNo: v.__trialNo });
      if (checks.some(function (c) { return !c.ok && c.level === 'BLOCK'; })) return { ok: false, checks: checks };
      // 原子发布：截断当前生效版本 → 插入新版本 → 校验区间不变式
      var cur = S.versions.filter(function (x) {
        return x.agreement_no === v.agreement_no && x.status === 'EFFECTIVE' && x.expiry_date === '9999-12-31';
      })[0];
      var before = cur ? cur.expiry_date : null;
      if (cur && cur.agreement_version_id !== v.agreement_version_id) cur.expiry_date = v.effective_date;
      v.status = v.effective_date <= S.simToday ? 'EFFECTIVE' : 'PENDING_EFFECTIVE';
      v.publish_time = nowStr();
      v.approval_no = Core.No.approval(S.simToday);
      var iv = Engine.validateVersionIntervals(S.versions, agr);
      log('规则中心', '发布版本', v.agreement_no + '-' + v.version_no,
        '生效日 ' + v.effective_date + '，状态 ' + v.status);
      changeLog('agreement_version', v.agreement_no + '-' + v.version_no, 'PUBLISH',
        cur ? '{"expiry_date":"' + before + '"}' : '', '{"status":"' + v.status + '"}');
      emit();
      return { ok: true, version: v, intervals: iv, checks: checks };
    },
    saveWizardVersion: function (draft) {
      var id = 20000 + S.versions.length;
      var v = {
        agreement_version_id: id, agreement_no: draft.agreement_no, version_no: draft.version_no,
        effective_date: draft.effective_date, expiry_date: draft.expiry_date, status: 'DRAFT',
        change_reason: draft.change_reason, is_retroactive: draft.effective_date < S.simToday ? 1 : 0,
        approval_no: '', publish_time: '', items: draft.items
      };
      S.versions.push(v);
      log('规则中心', '保存草稿版本', v.agreement_no + '-' + v.version_no, draft.change_reason);
      emit();
      return v;
    },

    /* ---- 范围重算（6.9）---- */
    createRecalc: function (scope, reason) {
      var task = {
        recalc_task_no: Core.No.recalc(S.simToday), scope: scope, reason: reason,
        initiator: S.role, approval_no: '', status: 'DRAFT',
        affected_count: 0, amount_old: 0, amount_new: 0, amount_diff: 0,
        rows: [], create_time: nowStr(), start_time: '', end_time: ''
      };
      S.recalcs.unshift(task);
      log('计费引擎', '发起范围重算', task.recalc_task_no, reason);
      emit();
      return task;
    },
    runShadow: function (taskNo) {
      var t = S.recalcs.filter(function (x) { return x.recalc_task_no === taskNo; })[0];
      if (!t) return;
      t.status = 'SHADOW_RUNNING'; t.start_time = nowStr();
      var sc = t.scope;
      var origin = S.eng.feeFlows.filter(function (f) {
        return f.fee_date >= sc.from && f.fee_date <= sc.to &&
          (!sc.partner_nos.length || sc.partner_nos.indexOf(f.partner_no) >= 0) &&
          (!sc.charge_item_nos.length || sc.charge_item_nos.indexOf(f.charge_item_no) >= 0) &&
          ['NORMAL', 'TIER_TRUEUP', 'FLOOR_ADJUST', 'CAP_ADJUST'].indexOf(f.flow_type) >= 0;
      });
      var evIds = Core.uniq(origin.map(function (f) { return f.event_id; }));
      var evs = S.events.filter(function (e) { return evIds.indexOf(e.event_id) >= 0; });
      var ctx = { partners: S.partners, agreements: S.agreements, versions: S.versions };
      var shadow = Engine.shadowRun(evs, ctx, S.versions);
      var shadowByKey = {};
      shadow.feeFlows.forEach(function (f) { shadowByKey[f.event_id + '|' + f.charge_item_no] = f; });
      var rows = [];
      origin.forEach(function (f) {
        var k = f.event_id + '|' + f.charge_item_no;
        var sf = shadowByKey[k];
        if (!sf) { rows.push({ key: k, flow: f, old: f.fee_amount, neu: 0, result: 'SHOULD_REVERSE', diff: -f.fee_amount }); return; }
        delete shadowByKey[k];
        if (M.r2(sf.fee_amount) === M.r2(f.fee_amount)) rows.push({ key: k, flow: f, old: f.fee_amount, neu: sf.fee_amount, result: 'NO_CHANGE', diff: 0 });
        else rows.push({ key: k, flow: f, old: f.fee_amount, neu: sf.fee_amount, result: 'AMOUNT_CHANGED', diff: M.r2(sf.fee_amount - f.fee_amount) });
      });
      Object.keys(shadowByKey).forEach(function (k) {
        var sf = shadowByKey[k];
        rows.push({ key: k, flow: null, shadow: sf, old: 0, neu: sf.fee_amount, result: 'SHOULD_ADD', diff: sf.fee_amount });
      });
      t.rows = rows;
      t.affected_count = rows.filter(function (r) { return r.result !== 'NO_CHANGE'; }).length;
      t.amount_old = M.sum(rows, function (r) { return r.old; });
      t.amount_new = M.sum(rows, function (r) { return r.neu; });
      t.amount_diff = M.r2(t.amount_new - t.amount_old);
      t.status = 'COMPARED'; t.end_time = nowStr();
      log('计费引擎', '影子计算完成', taskNo, '影响 ' + t.affected_count + ' 笔，差额 ' + M.fmtSigned(t.amount_diff));
      emit();
      return t;
    },
    applyRecalc: function (taskNo) {
      var t = S.recalcs.filter(function (x) { return x.recalc_task_no === taskNo; })[0];
      if (!t || t.status !== 'APPROVING') return { ok: false };
      var made = [];
      t.rows.forEach(function (r) {
        if (r.result === 'NO_CHANGE') return;
        if (r.flow && (r.result === 'AMOUNT_CHANGED' || r.result === 'SHOULD_REVERSE')) {
          var rev = Engine.mkFlow(Object.assign({}, r.flow, {
            fee_flow_no: Core.No.feeFlow(S.simToday), fee_amount: -r.flow.fee_amount,
            flow_type: 'RECALC_REVERSAL', original_fee_flow_no: r.flow.fee_flow_no,
            reversal_reason: 'RECALC:' + taskNo, fee_date: S.simToday,
            billing_period: D.period(S.simToday), bill_no: '',
            is_cross_period: 1, origin_period: r.flow.billing_period,
            calc_detail: { formula: '范围重算红冲', expr: '原 ' + M.fmt(r.flow.fee_amount) }
          }));
          S.eng.feeFlows.push(rev); S.eng.flowsByNo[rev.fee_flow_no] = rev; made.push(rev);
        }
        if (r.result === 'AMOUNT_CHANGED' || r.result === 'SHOULD_ADD') {
          var src = r.shadow || r.flow;
          var neu = Engine.mkFlow(Object.assign({}, src, {
            fee_flow_no: Core.No.feeFlow(S.simToday), fee_amount: r.neu,
            flow_type: 'RECALC_NEW', original_fee_flow_no: r.flow ? r.flow.fee_flow_no : '',
            reversal_reason: 'RECALC:' + taskNo, fee_date: S.simToday,
            billing_period: D.period(S.simToday), bill_no: '',
            is_cross_period: 1, origin_period: r.flow ? r.flow.billing_period : D.period(src.fee_date),
            calc_detail: { formula: '范围重算补记', expr: '新 ' + M.fmt(r.neu) }
          }));
          S.eng.feeFlows.push(neu); S.eng.flowsByNo[neu.fee_flow_no] = neu; made.push(neu);
        }
      });
      t.status = 'COMPLETED';
      log('计费引擎', '重算生效', taskNo, '生成 ' + made.length + ' 条红冲/补记流水，差额计入下期调整项 (D-06)');
      emit();
      return { ok: true, flows: made };
    },
    approveRecalc: function (taskNo) {
      var t = S.recalcs.filter(function (x) { return x.recalc_task_no === taskNo; })[0];
      if (!t) return;
      t.status = 'APPROVING'; t.approval_no = Core.No.approval(S.simToday);
      log('计费引擎', '重算审批', taskNo, '财务负责人 + 风控'); emit();
    },

    /* ---- 账户复核（4.3.2）---- */
    reviewAccount: function (acctNo) {
      var a = S.accountMap[acctNo]; if (!a) return { ok: false };
      if (a.first_maker_id === S.role) return { ok: false, msg: 'V-P03：录入人不得为复核人' };
      a.second_checker_id = S.role;
      a.status = 'ACTIVE'; a.verify_status = 'VERIFIED'; a.is_whitelisted = 1;
      a.whitelist_effective_time = D.addDays(S.simToday, 1) + ' 00:00';
      changeLog('partner_account', acctNo, 'REVIEW', '{"status":"PENDING_REVIEW"}', '{"status":"ACTIVE","is_whitelisted":1}');
      log('资金方主数据', '账户复核通过', acctNo, '白名单 T+1 冷静期至 ' + a.whitelist_effective_time);
      emit();
      return { ok: true, account: a };
    },

    /* ==================== 主数据写入（模块①） ==================== */
    savePartner: function (p, isNew) {
      if (isNew) {
        var maxNo = 0;
        S.partners.forEach(function (x) { maxNo = Math.max(maxNo, +x.partner_no.slice(1)); });
        p.partner_no = 'P' + Core.pad(maxNo + 3, 6);
        p.status = 'PENDING';
        S.partners.push(p);
        changeLog('partner', p.partner_no, 'CREATE', '', JSON.stringify({ name: p.partner_name, type: p.partner_type }));
        log('资金方主数据', '新建资金方档案', p.partner_no, p.partner_name);
      } else {
        var old = S.partnerMap[p.partner_no];
        var before = old ? JSON.stringify({ name: old.partner_name, type: old.partner_type, roles: old.partner_roles }) : '';
        Object.assign(old, p);
        p = old;
        changeLog('partner', p.partner_no, 'UPDATE', before, JSON.stringify({ name: p.partner_name, type: p.partner_type, roles: p.partner_roles }));
        log('资金方主数据', '修改资金方档案', p.partner_no, p.partner_name);
      }
      S.partnerMap = Core.byId(S.partners, 'partner_no');
      emit();
      return p;
    },
    submitAdmission: function (partnerNo) {
      var p = S.partnerMap[partnerNo]; if (!p) return { ok: false };
      p.admission_approval_no = 'ADM' + S.simToday.replace(/-/g, '') + Core.pad(S.partners.length, 3);
      changeLog('partner', partnerNo, 'SUBMIT_ADMISSION', '{"status":"PENDING"}', '{"approval_no":"' + p.admission_approval_no + '"}');
      log('资金方主数据', '提交准入审批', partnerNo, p.admission_approval_no);
      emit();
      return { ok: true, approval_no: p.admission_approval_no };
    },
    approveAdmission: function (partnerNo) {
      var p = S.partnerMap[partnerNo]; if (!p) return { ok: false };
      if (!p.admission_approval_no) return { ok: false, msg: '尚未提交准入审批' };
      p.status = 'ADMITTED';
      changeLog('partner', partnerNo, 'APPROVE_ADMISSION', '{"status":"PENDING"}', '{"status":"ADMITTED"}');
      log('资金方主数据', '准入审批通过', partnerNo, '状态 PENDING → ADMITTED');
      emit();
      return { ok: true };
    },
    setPartnerStatus: function (partnerNo, status) {
      var p = S.partnerMap[partnerNo]; if (!p) return;
      var before = p.status; p.status = status;
      changeLog('partner', partnerNo, 'STATUS', '{"status":"' + before + '"}', '{"status":"' + status + '"}');
      log('资金方主数据', '资金方状态流转', partnerNo, before + ' → ' + status);
      emit();
    },
    saveAccount: function (a, isNew) {
      if (isNew) {
        var n = S.accounts.filter(function (x) { return x.partner_no === a.partner_no; }).length + 1;
        a.account_no_id = 'PA' + a.partner_no.slice(1) + Core.pad(n, 3);
        a.status = 'PENDING_REVIEW'; a.is_whitelisted = 0; a.whitelist_effective_time = '';
        a.verify_status = a.verify_status || 'UNVERIFIED';
        a.first_maker_id = S.role; a.second_checker_id = '';
        S.accounts.push(a);
        changeLog('partner_account', a.account_no_id, 'CREATE', '', JSON.stringify({ bank: a.bank_name, usage: a.account_usage }));
        log('资金方主数据', '新增银行账户', a.account_no_id, '待双人复核');
      } else {
        var old = S.accountMap[a.account_no_id];
        var before = JSON.stringify({ bank_name: old.bank_name, usage: old.account_usage, mask: String(old.bank_account_no).slice(-4) });
        Object.assign(old, a);
        old.status = 'PENDING_REVIEW'; old.is_whitelisted = 0; old.second_checker_id = '';
        old.first_maker_id = S.role;
        a = old;
        changeLog('partner_account', a.account_no_id, 'UPDATE', before,
          JSON.stringify({ bank_name: a.bank_name, usage: a.account_usage, mask: String(a.bank_account_no).slice(-4) }));
        log('资金方主数据', '修改银行账户', a.account_no_id, '变更后需重新双人复核');
      }
      S.accountMap = Core.byId(S.accounts, 'account_no_id');
      emit();
      return a;
    },
    verifyAccount: function (acctNo) {
      var a = S.accountMap[acctNo]; if (!a) return;
      a.verify_status = 'VERIFIED';
      log('资金方主数据', '小额打款验证通过', acctNo, 'V-P04 前置条件满足');
      emit();
    },
    disableAccount: function (acctNo) {
      var a = S.accountMap[acctNo]; if (!a) return { ok: false };
      var checks = Validate.accountDisable(S, a);
      if (!Validate.pass(checks)) return { ok: false, checks: checks };
      a.status = 'DISABLED'; a.is_whitelisted = 0;
      changeLog('partner_account', acctNo, 'DISABLE', '{"status":"ACTIVE"}', '{"status":"DISABLED"}');
      log('资金方主数据', '停用银行账户', acctNo, '');
      emit();
      return { ok: true, checks: checks };
    },
    saveInvoiceInfo: function (info) {
      var old = S.invoiceMap[info.partner_no];
      if (old) {
        changeLog('partner_invoice_info', info.partner_no, 'UPDATE',
          JSON.stringify({ title: old.invoice_title, rate: old.default_tax_rate }),
          JSON.stringify({ title: info.invoice_title, rate: info.default_tax_rate }));
        Object.assign(old, info);
      } else {
        S.invoiceInfos.push(info);
        changeLog('partner_invoice_info', info.partner_no, 'CREATE', '', JSON.stringify({ title: info.invoice_title }));
      }
      S.invoiceMap = Core.byId(S.invoiceInfos, 'partner_no');
      log('资金方主数据', '维护开票信息', info.partner_no, info.invoice_title);
      emit();
    },
    saveAgreement: function (ag, isNew) {
      if (isNew) {
        var ym = S.simToday.slice(0, 7).replace('-', '');
        ag.agreement_no = 'AG' + ym + ag.partner_no.slice(1);
        ag.status = 'DRAFT';
        /* 超期未确认策略缺省为挂起：默认确认必须有协议条款支持（7.4.2） */
        if (!ag.confirm_policy) {
          ag.confirm_policy = 'HOLD';
          ag.confirm_policy_clause = '协议未约定默认确认条款，按缺省策略挂起并升级';
        }
        S.agreements.push(ag);
        changeLog('agreement', ag.agreement_no, 'CREATE', '', JSON.stringify({ name: ag.agreement_name, type: ag.agreement_type }));
        log('资金方主数据', '新建协议主档', ag.agreement_no, ag.agreement_name);
      } else {
        var old = S.agreementMap[ag.agreement_no];
        var before = JSON.stringify({ limit: old.credit_limit, scope: old.product_scope });
        Object.assign(old, ag); ag = old;
        changeLog('agreement', ag.agreement_no, 'UPDATE', before, JSON.stringify({ limit: ag.credit_limit, scope: ag.product_scope }));
        log('资金方主数据', '修改协议主档', ag.agreement_no, '');
      }
      S.agreementMap = Core.byId(S.agreements, 'agreement_no');
      emit();
      return ag;
    },
    setAgreementStatus: function (agrNo, status) {
      var ag = S.agreementMap[agrNo]; if (!ag) return { ok: false };
      if (status === 'TERMINATED') {
        var checks = Validate.agreementTerminate(S, ag);
        if (!Validate.pass(checks)) return { ok: false, checks: checks };
      }
      var before = ag.status; ag.status = status;
      if (status === 'EFFECTIVE') {
        var p = S.partnerMap[ag.partner_no];
        if (p && p.status === 'ADMITTED') p.status = 'ACTIVE';
      }
      changeLog('agreement', agrNo, 'STATUS', '{"status":"' + before + '"}', '{"status":"' + status + '"}');
      log('资金方主数据', '协议状态流转', agrNo, before + ' → ' + status);
      emit();
      return { ok: true };
    },

    /* ==================== 接入 SOP（PRD 10.1） ==================== */
    createOnboarding: function (o) {
      var t = Object.assign({
        task_no: Core.No.generic('OB', 4), partner_no: '', partner_name: '',
        stage: 1, status: 'RUNNING', owner: S.role,
        start_date: S.simToday, deadline: D.addDays(S.simToday, 4),
        d1: { rows: [], signedBiz: false, signedFin: false, signedPartner: false },
        d2: { partnerDone: false, accountDone: false, invoiceDone: false, agreementDone: false, versionId: null },
        d3: { cases: [], ran: false },
        d4: { estMonthly: 0, approvals: [], approval_no: '' },
        d5: { published: false, calendarDone: false, monitorDone: false },
        create_time: nowStr()
      }, o);
      S.onboardings.unshift(t);
      log('接入 SOP', '创建接入任务', t.task_no, t.partner_name);
      emit();
      return t;
    },
    updateOnboarding: function (taskNo, fn) {
      var t = S.onboardings.filter(function (x) { return x.task_no === taskNo; })[0];
      if (!t) return null;
      fn(t);
      emit();
      return t;
    },
    advanceOnboarding: function (taskNo, stage, note) {
      var t = S.onboardings.filter(function (x) { return x.task_no === taskNo; })[0];
      if (!t) return;
      t.stage = stage;
      if (stage > 5) { t.status = 'DONE'; t.finish_date = S.simToday; }
      log('接入 SOP', '进入 D' + Math.min(stage, 5) + ' 阶段', taskNo, note || '');
      emit();
    },

    /* ==================== 审批流：提交与执行 ==================== */
    submitRulePublish: function (versionId) {
      var v = S.versions.filter(function (x) { return x.agreement_version_id === versionId; })[0];
      if (!v) return { ok: false, msg: '版本不存在' };
      var agr = S.agreementMap[v.agreement_no];
      var checks = Engine.validateRules(v, agr, { trialDone: !!v.__trialNo, trialNo: v.__trialNo });
      if (checks.some(function (c) { return !c.ok && c.level === 'BLOCK'; })) return { ok: false, checks: checks };
      if (Approval.pendingFor(S, 'RULE_PUBLISH', v.agreement_no + '-' + v.version_no)) return { ok: false, msg: '已有待审批单据' };
      var trial = S.trials.filter(function (t) { return t.draft_version_id === versionId; })[0];
      var diff = trial ? trial.diffTotal : 0;
      var retro = v.effective_date < S.simToday;
      var ap = Approval.create(S, {
        biz_type: 'RULE_PUBLISH', biz_key: v.agreement_no + '-' + v.version_no,
        title: (S.partnerMap[agr.partner_no] || {}).partner_short_name + ' · ' + v.agreement_no + ' 版本 ' + v.version_no + ' 发布',
        amount: diff, partner_no: agr.partner_no, route: '/trial?v=' + versionId,
        reason: v.change_reason, flags: { retroactive: retro },
        payload: { versionId: versionId },
        summary: [
          ['生效区间', '[' + v.effective_date + ', ' + v.expiry_date + ')'],
          ['生效方式', retro ? '追溯生效（发布后需显式发起范围重算）' : (v.effective_date <= S.simToday ? '当日生效' : '未来生效')],
          ['计费项', v.items.map(function (i) { return i.charge_item_name; }).join('、')],
          ['试算批次', trial ? trial.trial_no : '（未试算）'],
          ['试算差额', trial ? M.fmtSigned(trial.diffTotal) : '—'],
          ['触及已确认账单', trial && trial.touchedBills.length ? trial.touchedBills.join(', ') : '无']
        ]
      });
      v.status = 'PENDING_APPROVAL';
      emit();
      return { ok: true, approval: ap };
    },
    submitRecalcApproval: function (taskNo) {
      var t = S.recalcs.filter(function (x) { return x.recalc_task_no === taskNo; })[0];
      if (!t || t.status !== 'COMPARED') return { ok: false, msg: '仅「已比对」状态可提交审批' };
      var retro = t.scope.to < S.simToday;
      var ap = Approval.create(S, {
        biz_type: 'RECALC', biz_key: taskNo,
        title: '范围重算生效 · ' + taskNo,
        amount: t.amount_diff, partner_no: (t.scope.partner_nos || [])[0] || '',
        route: '/recalc', reason: t.reason, flags: { retroactive: retro },
        payload: { taskNo: taskNo },
        summary: [
          ['重算范围', t.scope.from + ' ~ ' + t.scope.to + (t.scope.partner_nos.length ? ' · ' + t.scope.partner_nos.join(',') : ' · 全部资金方')],
          ['影响笔数', M.fmt(t.affected_count, 0) + ' / ' + M.fmt(t.rows.length, 0)],
          ['原金额 → 新金额', M.fmt(t.amount_old) + ' → ' + M.fmt(t.amount_new)],
          ['差额', M.fmtSigned(t.amount_diff)],
          ['生效方式', '红冲 + 补记（Append-Only），差额按 D-06 计入下期调整项']
        ]
      });
      t.status = 'PENDING_APPROVAL';
      emit();
      return { ok: true, approval: ap };
    },
    submitSettleApproval: function (settleNo) {
      var o = S.settleOrderMap[settleNo];
      if (!o || o.status !== 'PENDING') return { ok: false, msg: '仅待结算单据可提交审批' };
      var risk = Billing.riskCheck(S, o);
      if (!risk.pass) return { ok: false, risk: risk };
      var ap = Approval.create(S, {
        biz_type: 'SETTLE', biz_key: settleNo,
        title: (S.partnerMap[o.partner_no] || {}).partner_short_name + ' · ' + o.billing_period + ' ' +
          (o.direction === 'RECEIVE' ? '收款' : '付款') + ' ' + M.fmt(o.settle_amount),
        amount: o.settle_amount, partner_no: o.partner_no,
        route: '/settleorder/' + settleNo, reason: '账期 ' + o.billing_period + ' 结算',
        flags: { warn: risk.warn },
        payload: { settleNo: settleNo },
        summary: [
          ['结算方向', o.direction === 'RECEIVE' ? '我方收款' : '我方付款'],
          ['是否轧差', o.is_netting ? '是（应收 ' + M.fmt(o.receivable_amount) + ' − 应付 ' + M.fmt(o.payable_amount) + '）' : '否'],
          ['关联账单', o.bill_nos.join(', ')],
          ['收款账户', o.payee_account],
          ['资金安全控制', risk.checks.filter(function (c) { return !c.ok; }).length
            ? '存在 ' + risk.checks.filter(function (c) { return !c.ok; }).length + ' 项警告' : '10 项全部通过'],
          ['计划结算日', o.plan_settle_date]
        ]
      });
      o.status = 'APPROVING';
      emit();
      return { ok: true, approval: ap, risk: risk };
    },
    submitAdjustmentApproval: function (adjNo) {
      var a = S.adjustments.filter(function (x) { return x.adjustment_no === adjNo; })[0];
      if (!a || a.status === 'APPROVED') return { ok: false, msg: '调整项不存在或已审批' };
      if (Approval.pendingFor(S, 'ADJUSTMENT', adjNo)) return { ok: false, msg: '已有待审批单据' };
      var ap = Approval.create(S, {
        biz_type: 'ADJUSTMENT', biz_key: adjNo,
        title: '账单调整项 ' + adjNo + ' · ' + M.fmtSigned(a.amount),
        amount: a.amount, partner_no: a.partner_no, route: '/adjustments', reason: a.reason,
        payload: { adjNo: adjNo },
        summary: [
          ['来源类型', a.source_type], ['来源账期', a.origin_period || '—'],
          ['来源引用', a.origin_ref || '—'], ['结算账期', a.settle_in_period],
          ['金额', M.fmtSigned(a.amount)], ['原因', a.reason]
        ]
      });
      a.status = 'PENDING_APPROVAL';
      emit();
      return { ok: true, approval: ap };
    },
    submitBillVoid: function (billNo, reason) {
      var b = S.billMap[billNo]; if (!b) return { ok: false };
      var ap = Approval.create(S, {
        biz_type: 'BILL_VOID', biz_key: billNo,
        title: '账单作废 ' + billNo, amount: b.total_amount, partner_no: b.partner_no,
        route: '/bill/' + billNo, reason: reason || '',
        payload: { billNo: billNo, reason: reason },
        summary: [['账期', b.billing_period], ['方向', b.direction], ['应结金额', M.fmt(b.total_amount)],
          ['当前状态', b.status], ['作废原因', reason || '']]
      });
      emit();
      return { ok: true, approval: ap };
    },
    approvalAct: function (approvalNo, decision, opinion) {
      var r = Approval.act(S, approvalNo, decision, opinion);
      emit();
      return r;
    },
    approvalWithdraw: function (approvalNo) {
      var r = Approval.withdraw(S, approvalNo);
      emit();
      return r;
    },

    /* ============ 付款执行与异常分支（PRD 8.4.3 / 8.4.4 / 8.5） ============ */
    findInstruction: function (insNo) {
      var out = null;
      S.settleOrders.forEach(function (o) {
        o.instructions.forEach(function (i) { if (i.instruction_no === insNo) out = { order: o, ins: i }; });
      });
      return out;
    },
    /** 刷新结算单状态并在完成时回写账单 */
    syncOrder: function (o) {
      var was = o.status;
      o.status = Payment.deriveOrderStatus(o);
      o.settled_amount = M.sum(o.instructions.filter(function (i) { return i.status === 'SUCCESS'; }), function (i) { return i.amount; });
      o.remaining_amount = Math.max(0, M.r2(o.settle_amount - o.settled_amount));
      if (o.status === 'COMPLETED') {
        if (!o.bill_settlement_posted) {
          (o.bill_allocations || o.bill_nos.map(function (bn) {
            var b0 = S.billMap[bn]; return { bill_no: bn, amount: b0 ? Math.abs(b0.total_amount) : 0 };
          })).forEach(function (a) {
            var b = S.billMap[a.bill_no]; if (!b) return;
            b.settled_amount = M.r2((b.settled_amount || 0) + a.amount);
            var disputed = M.sum(S.disputes.filter(function (d) {
              return d.bill_no === b.bill_no && d.status !== 'CLOSED' && d.status !== 'REJECTED';
            }), function (d) { return Math.abs(d.disputed_amount || 0); });
            b.status = disputed > 0 ? 'DISPUTED' : 'SETTLED';
            b.recon_status = disputed > 0 ? 'PARTIAL' : 'MATCHED';
          });
          o.bill_settlement_posted = 1;
        }
      }
      if (o.status === 'PARTIAL') {
        o.bill_nos.forEach(function (bn) {
          var b = S.billMap[bn]; if (b) b.status = 'PARTIAL_SETTLED';
        });
      }
      if (was !== o.status) changeLog('settle_order', o.settle_no, 'STATUS', was, o.status);
      return o.status;
    },
    /** 通道回调：对单条指令写入明确结果（12.2.2） */
    instructionCallback: function (insNo, outcome, failReason) {
      var f = Actions.findInstruction(insNo);
      if (!f) return { ok: false, msg: '指令不存在' };
      var o = f.order, ins = f.ins;
      if (ins.status === 'SUCCESS' || ins.status === 'RETURNED') return { ok: false, msg: '该指令已达终态' };
      var date = o.plan_settle_date;
      if (outcome === 'SUCCESS') {
        Payment.succeed(S, o, ins, date);
      } else if (outcome === 'FAILED') {
        ins.status = 'FAILED';
        ins.fail_reason = failReason || '收款账户名称与账号不匹配';
        ins.channel_serial_no = ins.channel_serial_no || 'CH' + date.replace(/-/g, '') + Core.pad(2000 + ins.seq, 6);
        alert_('P1', '付款指令失败', '指令 ' + insNo + '（' + M.fmt(ins.amount) + ' 元）通道明确失败：' +
          ins.fail_reason + '，需人工确认原因后重试', '#/settleorder/' + o.settle_no);
      } else if (outcome === 'UNKNOWN') {
        ins.status = 'PROCESSING';
        ins.channel_serial_no = ins.channel_serial_no || 'CH' + date.replace(/-/g, '') + Core.pad(9000 + ins.seq, 6);
        ins.poll_count = 0; ins.poll_elapsed_min = 0;
        ins.unknown_pending = 1;
        log('结算中心', '通道无明确结果', insNo, '转主动查询（8.4.3），禁止自动重试');
      }
      Actions.syncOrder(o);
      log('结算中心', '通道回调', insNo, outcome + (failReason ? '：' + failReason : ''));
      emit();
      return { ok: true, order: o, ins: ins };
    },
    /** 主动查询一次（8.4.3 递增间隔）。resolve 为空表示通道仍未给出明确结果 */
    pollInstruction: function (insNo, resolve) {
      var f = Actions.findInstruction(insNo);
      if (!f) return { ok: false, msg: '指令不存在' };
      var ins = f.ins, o = f.order;
      if (['SUCCESS', 'FAILED', 'RETURNED'].indexOf(ins.status) >= 0) return { ok: false, msg: '该指令已有明确结果，无需查询' };
      ins.poll_count = (ins.poll_count || 0) + 1;
      var idx = Math.min(ins.poll_count - 1, Payment.POLL_SCHEDULE.length - 1);
      ins.poll_elapsed_min = M.r2((ins.poll_elapsed_min || 0) + Payment.POLL_SCHEDULE[idx] / 60);
      var note = '第 ' + ins.poll_count + ' 次主动查询（间隔 ' + Payment.pollLabel(idx) +
        '，累计 ' + Payment.fmtMin(ins.poll_elapsed_min * 60) + '）';
      if (resolve === 'SUCCESS' || resolve === 'FAILED') {
        log('结算中心', '主动查询', insNo, note + ' → 通道返回 ' + resolve);
        return Actions.instructionCallback(insNo, resolve, '通道查询返回失败');
      }
      if (ins.poll_elapsed_min >= Payment.POLL_TIMEOUT_MIN) {
        ins.status = 'UNKNOWN';
        Actions.syncOrder(o);
        alert_('P0', '支付状态未知', '指令 ' + insNo + '（' + M.fmt(ins.amount) + ' 元）累计查询 ' +
          Payment.POLL_TIMEOUT_MIN + ' 分钟仍无明确结果，已置 UNKNOWN。<b>禁止自动重试</b>，须人工在支付系统/银行端确认后回填最终状态。',
          '#/payexc?ins=' + insNo);
        log('结算中心', '查询超时', insNo, note + ' → 超过 ' + Payment.POLL_TIMEOUT_MIN + ' 分钟，置 UNKNOWN 并转人工');
        emit();
        return { ok: true, timeout: true, ins: ins, order: o };
      }
      log('结算中心', '主动查询', insNo, note + ' → 通道仍未给出明确结果');
      emit();
      return { ok: true, ins: ins, order: o, note: note };
    },
    /** 重试一条指令（受 8.4.4 策略约束） */
    retryInstruction: function (insNo, confirmedReason) {
      var f = Actions.findInstruction(insNo);
      if (!f) return { ok: false, msg: '指令不存在' };
      var ins = f.ins, o = f.order;
      if (!Store.can('settle.approve') && !Store.can('settle.create')) return { ok: false, msg: '当前角色无重试权限' };
      var c = Payment.canRetry(ins);
      if (!c.can) return { ok: false, msg: c.why.replace(/<[^>]+>/g, '') };
      if (ins.status === 'FAILED' && !confirmedReason) {
        return { ok: false, msg: '通道明确失败的指令须先<b>人工确认失败原因</b>再重试（8.4.4）', needReason: true };
      }
      ins.retry_count = (ins.retry_count || 0) + 1;
      ins.status = 'SENT'; ins.fail_reason = '';
      ins.retry_reason = confirmedReason || '';
      Actions.syncOrder(o);
      log('结算中心', '重试付款指令', insNo, '第 ' + ins.retry_count + ' 次重试' +
        (confirmedReason ? '（已确认原因：' + confirmedReason + '）' : ''));
      emit();
      return { ok: true, ins: ins, order: o };
    },
    /** 状态未知 → 人工在银行端确认后回填最终状态（8.4.3） */
    manualConfirmInstruction: function (insNo, finalStatus, opinion) {
      var f = Actions.findInstruction(insNo);
      if (!f) return { ok: false, msg: '指令不存在' };
      var ins = f.ins, o = f.order;
      if (ins.status !== 'UNKNOWN') return { ok: false, msg: '仅「状态未知」的指令需要人工确认' };
      if (!Store.can('settle.approve')) return { ok: false, msg: '人工确认最终状态需财务复核及以上角色' };
      ins.manual_confirm_by = S.role; ins.manual_confirm_time = nowStr();
      ins.manual_confirm_opinion = opinion || '';
      ins.unknown_pending = 0;
      if (finalStatus === 'SUCCESS') {
        Payment.succeed(S, o, ins, o.plan_settle_date);
        log('结算中心', '人工确认状态未知指令', insNo, '确认为成功，补记结算流水与回单');
      } else {
        ins.status = 'FAILED';
        ins.fail_reason = opinion || '人工在银行端确认为未出账';
        log('结算中心', '人工确认状态未知指令', insNo, '确认为失败');
      }
      Actions.syncOrder(o);
      S.alerts.forEach(function (a) {
        if (a.title === '支付状态未知' && String(a.msg || '').indexOf(insNo) >= 0) a.closed = true;
      });
      emit();
      return { ok: true, ins: ins, order: o };
    },
    /** 部分成功 → 对失败部分补发新指令，未付部分进下期结转（8.5 PARTIAL） */
    resupplyOrder: function (settleNo) {
      var o = S.settleOrderMap[settleNo];
      if (!o) return { ok: false, msg: '结算单不存在' };
      if (o.status !== 'PARTIAL' && o.status !== 'FAILED') return { ok: false, msg: '仅部分成功 / 全部失败的结算单需要补发' };
      if (!Store.can('settle.create')) return { ok: false, msg: '当前角色无补发权限' };
      var made = Payment.buildResupply(o, o.plan_settle_date);
      if (!made.length) return { ok: false, msg: '没有待补发的失败指令' };
      Actions.syncOrder(o);
      log('结算中心', '部分成功补发', settleNo, '对 ' + made.length + ' 条失败指令生成补发指令');
      emit();
      return { ok: true, instructions: made, order: o };
    },
    /** 未付部分计入下期结转（7.3 构成公式的第三项） */
    carryForwardShortfall: function (settleNo, targetPeriod) {
      var o = S.settleOrderMap[settleNo];
      if (!o) return { ok: false, msg: '结算单不存在' };
      var sf = Payment.shortfall(o);
      if (M.r2(sf.unpaid) === 0) return { ok: false, msg: '不存在未付金额' };
      if (S.carryForwards.some(function (c) { return c.source_settle_no === settleNo; })) {
        return { ok: false, msg: '该结算单的未付部分已生成结转' };
      }
      var period = targetPeriod || D.nextPeriod(o.billing_period);
      var bill = S.billMap[o.bill_nos[0]];
      if (!bill) {
        /* 兜底：结算单未绑定账单时，按资金方 + 方向回溯最近一张账单取协议 */
        bill = S.bills.filter(function (b) {
          return b.partner_no === o.partner_no &&
            (o.direction === 'PAY' ? b.direction === 'PAYABLE' : b.direction === 'RECEIVABLE');
        }).sort(function (a, b) { return a.bill_no < b.bill_no ? 1 : -1; })[0] || {};
      }
      var c = {
        carry_no: 'CF' + S.simToday.replace(/-/g, '') + Core.pad(S.carryForwards.length + 1, 4),
        partner_no: o.partner_no, agreement_no: bill.agreement_no || '', direction: bill.direction || 'RECEIVABLE',
        period: period, amount: sf.unpaid, source_settle_no: settleNo, bill_no: '',
        reason: o.billing_period + ' 账期结算部分成功，未付 ' + M.fmt(sf.unpaid) + ' 元结转至 ' + period,
        create_time: nowStr()
      };
      S.carryForwards.push(c);
      log('结算中心', '未付部分结转下期', settleNo, M.fmt(sf.unpaid) + ' → ' + period);
      emit();
      return { ok: true, carry: c, shortfall: sf };
    },
    /** 银行退票（8.5 RETURNED）：结算单退票 + 账单回退 + 账户冻结 */
    returnSettle: function (settleNo, reason) {
      var o = S.settleOrderMap[settleNo];
      if (!o) return { ok: false, msg: '结算单不存在' };
      if (!Store.can('settle.approve')) return { ok: false, msg: '退票处理需财务复核及以上角色' };
      var why = reason || '收款账户已销户，银行原路退回';
      o.instructions.forEach(function (i) { if (i.status === 'SUCCESS') i.status = 'RETURNED'; });
      S.settleFlows.forEach(function (sf) {
        if (sf.settle_no === settleNo && sf.status === 'SUCCESS') {
          sf.status = 'RETURNED'; sf.fail_reason = why;
        }
      });
      o.status = 'RETURNED'; o.return_reason = why; o.return_time = nowStr();
      /* 账单回退至已确认，并解绑结算单以便重新结算 */
      o.bill_nos.forEach(function (bn) {
        var b = S.billMap[bn];
        if (b) { b.status = 'CONFIRMED'; b.settle_no = ''; b.recon_status = 'PENDING'; }
      });
      /* 收款账户标记异常并冻结（与 4.2 白名单联动） */
      var acctId = o.direction === 'PAY' ? o.payee_account : o.payer_account;
      var acct = S.accountMap[acctId];
      if (acct) {
        acct.status = 'FROZEN'; acct.is_whitelisted = 0;
        acct.freeze_reason = '结算单 ' + settleNo + ' 退票：' + why;
        changeLog('partner_account', acctId, 'FREEZE', 'ACTIVE', 'FROZEN');
      }
      alert_('P0', '结算退票', '结算单 ' + settleNo + '（' + M.fmt(o.settle_amount) + ' 元）银行退票：' + why +
        '。账单已回退至已确认，收款账户 ' + acctId + ' 已冻结并移出白名单，需重新验证后方可重结。',
        '#/payexc?order=' + settleNo);
      log('结算中心', '银行退票', settleNo, why);
      changeLog('settle_order', settleNo, 'RETURN', 'COMPLETED', 'RETURNED');
      emit();
      return { ok: true, order: o, account: acct };
    },
    /** 退票后重新结算：账单重新生成结算单（8.5） */
    resettleOrder: function (settleNo) {
      var o = S.settleOrderMap[settleNo];
      if (!o) return { ok: false, msg: '结算单不存在' };
      if (o.status !== 'RETURNED') return { ok: false, msg: '仅退票的结算单可重新结算' };
      if (!Store.can('settle.create')) return { ok: false, msg: '当前角色无重新结算权限' };
      var acctId = o.direction === 'PAY' ? o.payee_account : o.payer_account;
      var acct = S.accountMap[acctId];
      if (acct && acct.status === 'FROZEN') {
        return { ok: false, msg: '收款账户 ' + acctId + ' 仍处于冻结状态，须先在<b>资金方主数据</b>完成账户变更与双人复核（FC-01）' };
      }
      var made = Billing.createSettleOrders(S, o.billing_period);
      if (!made.length) return { ok: false, msg: '未生成新的结算单，请检查账单状态' };
      made.forEach(function (n) { n.resettle_of = settleNo; });
      o.resettled_to = made.map(function (n) { return n.settle_no; }).join('、');
      log('结算中心', '退票后重新结算', settleNo, '生成 ' + o.resettled_to);
      emit();
      return { ok: true, orders: made };
    },

    /* ==================== 发票与开票申请（PRD 7.8 / D-08） ==================== */
    findInvoiceApply: function (no) {
      return S.invoiceApplies.filter(function (a) { return a.apply_no === no; })[0];
    },
    invoicePreCheck: function (billNo) {
      var b = S.billMap[billNo];
      return b ? Invoice.preCheck(S, b) : { checks: [], pass: false };
    },
    invoicePlan: function (billNo) {
      var b = S.billMap[billNo];
      return b ? Invoice.planFor(S, b) : null;
    },
    /** 生成开票申请：一张蓝票 + 若干张红字发票（7.8.2 / 7.8.3） */
    createInvoiceApply: function (billNo, opts) {
      opts = opts || {};
      var b = S.billMap[billNo];
      if (!b) return { ok: false, msg: '账单不存在' };
      if (!opts.silent && !Store.can('invoice.apply')) return { ok: false, msg: '当前角色无开票申请权限' };
      var pre = Invoice.preCheck(S, b);
      if (!pre.pass) return { ok: false, msg: '开票前置校验未通过', checks: pre.checks };
      var date = opts.date || S.simToday;
      var plan = Invoice.planFor(S, b);
      var made = [];
      var blue = Invoice.buildBlue(S, b, plan, date);
      registerApply(blue, date); made.push(blue);
      plan.reds.forEach(function (item) {
        var red = Invoice.buildRed(S, b, item, date);
        registerApply(red, date);
        red.logs.push({ time: date + 'T09:40:00+08:00', actor: '系统', action: '红蓝票判定',
          detail: item.decision.why.replace(/<\/?b>/g, '') });
        made.push(red);
      });
      b.invoice_status = 'APPLIED';
      log('账单中心', '生成开票申请', billNo,
        made.map(function (x) { return x.apply_no + '(' + x.kind + ' ' + M.fmt(x.amount) + ')'; }).join('、'));
      emit();
      return { ok: true, applies: made, plan: plan };
    },
    /** 提交发票系统（7.8.2） */
    submitInvoiceApply: function (no) {
      var a = Actions.findInvoiceApply(no);
      if (!a) return { ok: false, msg: '开票申请不存在' };
      if (!Store.can('invoice.issue')) return { ok: false, msg: '当前角色无提交开票权限' };
      if (a.status !== 'PENDING' && a.status !== 'FAILED') return { ok: false, msg: '当前状态不可提交' };
      a.status = 'SUBMITTED'; a.submit_time = nowStr(); a.fail_reason = '';
      a.logs.push({ time: a.submit_time, actor: S.role, action: '提交发票系统',
        detail: '推送开票申请报文（购方 ' + a.buyer.title + '／销方 ' + a.seller.title + '）' });
      log('账单中心', '提交开票申请', no, M.fmt(a.amount));
      emit();
      return { ok: true, apply: a };
    },
    /** 模拟发票系统回传开票结果（7.8.2） */
    issueInvoice: function (no, ok, failReason) {
      var a = Actions.findInvoiceApply(no);
      if (!a) return { ok: false, msg: '开票申请不存在' };
      if (!Store.can('invoice.issue')) return { ok: false, msg: '当前角色无开票权限' };
      if (a.status !== 'SUBMITTED') return { ok: false, msg: '仅「已提交发票系统」的申请可回传结果' };
      issueApply(a, S.simToday, ok !== false, failReason);
      if (a.status === 'FAILED') alert_('P2', '开票失败',
        '开票申请 ' + no + ' 被发票系统拒绝：' + a.fail_reason, '#/invoices?apply=' + no);
      log('账单中心', '发票系统回传', no, a.status === 'ISSUED' ? '发票号 ' + a.invoice_no : a.fail_reason);
      emit();
      return { ok: true, apply: a };
    },
    /** 作废开票申请（尚未开出时）（7.8.3：账单作废且未开票 → 无需票据处理） */
    voidInvoiceApply: function (no, reason) {
      var a = Actions.findInvoiceApply(no);
      if (!a) return { ok: false, msg: '开票申请不存在' };
      if (!Store.can('invoice.void')) return { ok: false, msg: '当前角色无作废权限' };
      if (a.status === 'ISSUED') return { ok: false, msg: '发票已开出，不能作废申请 —— 应通过<b>红字发票</b>冲回' };
      a.status = 'VOIDED'; a.void_reason = reason || '账单作废，开票申请随之作废';
      a.logs.push({ time: nowStr(), actor: S.role, action: '作废申请', detail: a.void_reason });
      var b = S.billMap[a.bill_no];
      if (b && !S.invoiceApplies.some(function (x) { return x.bill_no === b.bill_no && x.status !== 'VOIDED'; })) {
        b.invoice_status = ''; b.invoice_no = '';
      }
      log('账单中心', '作废开票申请', no, a.void_reason);
      emit();
      return { ok: true, apply: a };
    },

    /* ==================== 收款认领（PRD 8.5） ==================== */
    findInbound: function (no) {
      return S.inbounds.filter(function (x) { return x.inbound_no === no; })[0];
    },
    /** 模拟银行入账文件到达：对指定待收款结算单按指定场景生成一笔入账流水 */
    simulateInbound: function (settleNo, scenario) {
      var o = settleNo ? S.settleOrderMap[settleNo] : null;
      var pn = o ? o.partner_no : 'P000007';
      var acct = S.accounts.filter(function (a) { return a.partner_no === pn && a.status === 'ACTIVE'; })[0];
      var p = S.partnerMap[pn] || {};
      var amt = o ? o.settle_amount : 128000;
      var remark = '2026年账期结算款';
      var payerAcct = acct ? acct.bank_account_no : '';
      var payerName = acct ? acct.account_name : p.partner_name;
      var payerBank = acct ? acct.bank_name : '';
      if (scenario === 'L1') remark = (o ? o.billing_period : '') + '账期结算款 ' + settleNo;
      else if (scenario === 'L3') amt = M.r2(amt - 0.01);
      else if (scenario === 'MISMATCH') { amt = M.r2(amt + 3200); remark = '业务往来款'; }
      else if (scenario === 'FOREIGN') {
        payerName = '宁川商贸有限公司'; payerAcct = '6217000010009988776';
        payerBank = '中国银行天津和平支行'; amt = 96500; remark = '货款';
      }
      var inb = {
        inbound_no: 'IB' + S.simToday.replace(/-/g, '') + Core.pad(S.inbounds.length + 1, 6),
        value_date: S.simToday, payer_name: payerName, payer_account: payerAcct, payer_bank: payerBank,
        amount: amt, currency: 'CNY', remark: remark,
        channel_serial_no: 'BK' + S.simToday.replace(/-/g, '') + Core.pad(S.inbounds.length + 1, 8),
        source: 'BANK_FILE', status: 'SUSPENSE', match_level: 0, match_reason: '', settle_nos: [],
        claim_by: '', claim_time: '', claim_note: '', review_by: '', review_time: '', review_opinion: '',
        exclude_reason: '', logs: []
      };
      S.inbounds.unshift(inb);
      log('结算中心', '接收银行入账流水', inb.inbound_no, M.fmt(inb.amount) + ' 元 · ' + inb.payer_name);
      Actions.runInboundMatch(inb.inbound_no);
      return inb;
    },
    /** 执行四级自动匹配（8.5.1） */
    runInboundMatch: function (no) {
      var inb = Actions.findInbound(no);
      if (!inb || inb.status === 'CONFIRMED' || inb.status === 'PARTIAL_SETTLED' || inb.status === 'EXCLUDED' || inb.status === 'RETURNED') {
        return { ok: false, msg: '该笔入账流水已终态，不可重新匹配' };
      }
      var r = Claim.autoMatch(S, inb);
      inb.match_level = r.level; inb.match_reason = r.reason; inb.settle_nos = r.settle_nos;
      inb.logs.push({ time: nowStr(), actor: '系统', action: '自动匹配',
        detail: r.level ? '命中规则 ' + r.level + '「' + r.rule.name + '」：' + r.reason : r.reason });
      if (!r.level) {
        inb.status = 'SUSPENSE';
        alert_('P2', '款项挂账', '入账流水 ' + inb.inbound_no + '（' + M.fmt(inb.amount) +
          ' 元）自动匹配未命中，已挂账待人工认领', '#/claim?inb=' + inb.inbound_no);
      } else if (r.auto) {
        inb.status = 'AUTO_MATCHED';
      } else {
        inb.status = 'SUSPENSE';   // 中/低可靠性不自动占用，等人工认领确认
      }
      log('结算中心', '自动匹配', no, r.level ? '规则 ' + r.level : '未命中，挂账');
      emit();
      return { ok: true, result: r, inbound: inb };
    },
    /** 人工认领：把挂账款项关联到一张或多张待收款结算单（8.5.2） */
    claimInbound: function (no, settleNos, note) {
      var inb = Actions.findInbound(no);
      if (!inb) return { ok: false, msg: '入账流水不存在' };
      if (!Store.can('settle.claim')) return { ok: false, msg: '当前角色无收款认领权限' };
      if (!settleNos || !settleNos.length) return { ok: false, msg: '请至少选择一张待收款结算单' };
      var bad = settleNos.filter(function (n) {
        var o = S.settleOrderMap[n]; return !o || o.status !== 'WAITING_RECEIPT';
      });
      if (bad.length) return { ok: false, msg: '结算单 ' + bad.join('、') + ' 不处于待收款状态' };
      inb.settle_nos = settleNos.slice();
      inb.claim_by = S.role; inb.claim_time = nowStr(); inb.claim_note = note || '';
      inb.status = 'PENDING_REVIEW';
      var gap = Claim.amountGap(S, inb);
      inb.logs.push({ time: inb.claim_time, actor: S.role, action: '人工认领',
        detail: '关联 ' + settleNos.join('、') + '；应收合计 ' + M.fmt(gap.expect) +
          '，实际到账 ' + M.fmt(gap.actual) + (gap.gap ? '，差额 ' + M.fmtSigned(gap.gap) : '，无差额') +
          (note ? '；' + note : '') });
      log('结算中心', '收款认领', no, '关联 ' + settleNos.length + ' 张结算单，待二级复核');
      emit();
      return { ok: true, inbound: inb, gap: gap };
    },
    /** 二级复核（认领人 ≠ 复核人，8.5.2） */
    reviewClaim: function (no, pass, opinion) {
      var inb = Actions.findInbound(no);
      if (!inb) return { ok: false, msg: '入账流水不存在' };
      if (inb.status !== 'PENDING_REVIEW' && inb.status !== 'AUTO_MATCHED') return { ok: false, msg: '当前状态不需要复核' };
      if (!Store.can('settle.claim.review')) return { ok: false, msg: '当前角色无收款复核权限' };
      if (inb.claim_by && inb.claim_by === S.role) return { ok: false, msg: '认领人不得复核自己认领的款项（双人复核强制）' };
      if (!pass) {
        inb.status = 'SUSPENSE'; inb.settle_nos = []; inb.claim_by = ''; inb.claim_time = '';
        inb.logs.push({ time: nowStr(), actor: S.role, action: '复核驳回', detail: opinion || '关联关系存疑，退回重新认领' });
        log('结算中心', '收款复核驳回', no, opinion || '');
        emit();
        return { ok: true, final: 'REJECTED', inbound: inb };
      }
      inb.review_by = S.role; inb.review_time = nowStr(); inb.review_opinion = opinion || '同意核销';
      inb.logs.push({ time: inb.review_time, actor: S.role, action: '复核通过', detail: inb.review_opinion });
      var made = Claim.settleByInbound(S, inb);
      inb.applied_amount = made.applied_amount || 0;
      inb.unallocated_amount = made.unallocated_amount || 0;
      inb.status = made.unallocated_amount > 0 || made.some(function (x) { return x.remaining > 0; }) ? 'PARTIAL_SETTLED' : 'CONFIRMED';
      inb.logs.push({ time: inb.review_time, actor: '系统', action: '核销',
        detail: '生成结算流水 ' + made.map(function (x) { return x.flow.settle_flow_no; }).join('、') +
          ' 与银行回单 ' + made.map(function (x) { return x.receipt.receipt_no; }).join('、') +
          '；本次核销 ' + M.fmt(inb.applied_amount) + ' 元' +
          (inb.unallocated_amount ? '，未分配到账 ' + M.fmt(inb.unallocated_amount) + ' 元继续挂账' : '') });
      made.forEach(function (x) {
        changeLog('settle_order', x.order.settle_no, 'CLAIM_SETTLE', 'WAITING_RECEIPT', x.order.status);
      });
      log('结算中心', '收款核销', no, made.length + ' 张结算单已处理，本次实收核销 ' + M.fmt(inb.applied_amount));
      emit();
      return { ok: true, final: 'CONFIRMED', inbound: inb, made: made };
    },
    /** 标记为非本系统款项（8.5.2） */
    excludeInbound: function (no, reason) {
      var inb = Actions.findInbound(no);
      if (!inb) return { ok: false, msg: '入账流水不存在' };
      if (!Store.can('settle.claim')) return { ok: false, msg: '当前角色无收款认领权限' };
      if (inb.status === 'CONFIRMED' || inb.status === 'PARTIAL_SETTLED') return { ok: false, msg: '已发生核销的款项不可标记' };
      inb.status = 'EXCLUDED'; inb.exclude_reason = reason || '与本系统业务无关';
      inb.settle_nos = [];
      inb.logs.push({ time: nowStr(), actor: S.role, action: '标记为非本系统款项', detail: inb.exclude_reason });
      log('结算中心', '标记非本系统款项', no, inb.exclude_reason);
      emit();
      return { ok: true, inbound: inb };
    },
    /** 原路退回付款方（8.5.2） */
    returnInbound: function (no, reason) {
      var inb = Actions.findInbound(no);
      if (!inb) return { ok: false, msg: '入账流水不存在' };
      if (!Store.can('settle.claim')) return { ok: false, msg: '当前角色无收款认领权限' };
      if (inb.status === 'CONFIRMED' || inb.status === 'PARTIAL_SETTLED') return { ok: false, msg: '已发生核销的款项不可退回' };
      inb.status = 'RETURNED'; inb.exclude_reason = reason || '款项性质无法确认，原路退回';
      inb.settle_nos = [];
      inb.logs.push({ time: nowStr(), actor: S.role, action: '退回付款方', detail: inb.exclude_reason });
      log('结算中心', '退回款项', no, inb.exclude_reason);
      emit();
      return { ok: true, inbound: inb };
    },

    /* ==================== 外部对账（PRD 9.3） ==================== */
    findReconTask: function (taskNo) {
      return S.reconTasks.filter(function (t) { return t.recon_task_no === taskNo; })[0];
    },
    markReconSent: function (taskNo, fname) {
      var t = Actions.findReconTask(taskNo); if (!t) return;
      t.status = 'SENT'; t.file_out = fname; t.sent_time = nowStr();
      log('对账中心', '发出对账明细文件', taskNo, fname);
      emit();
      return t;
    },
    attachReconFile: function (taskNo, fname, rows) {
      var t = Actions.findReconTask(taskNo); if (!t) return { ok: false };
      t.file_in = fname; t.in_rows = rows; t.upload_time = nowStr();
      t.status = 'RECEIVED'; t.match = null; t.diff_created = 0;
      log('对账中心', '接收资金方回传文件', taskNo, fname + ' · ' + rows.length + ' 行');
      emit();
      return { ok: true, task: t };
    },
    runReconMatch: function (taskNo) {
      var t = Actions.findReconTask(taskNo);
      if (!t || !t.in_rows) return { ok: false, msg: '尚未上传资金方回传文件' };
      var ourRows = Recon.buildOurRows(S, t.partner_no, t.period);
      t.match = Recon.match(S, ourRows, t.in_rows);
      t.status = 'MATCHED';
      log('对账中心', '执行逐笔匹配', taskNo,
        '我方 ' + t.match.summary.ourCount + ' 笔 / 对方 ' + t.match.summary.theirCount +
        ' 笔，差异 ' + (t.match.summary.total - t.match.summary.byResult.MATCH - t.match.summary.byResult.TOLERANCE) + ' 笔');
      emit();
      return { ok: true, task: t };
    },
    createReconDiffs: function (taskNo) {
      var t = Actions.findReconTask(taskNo);
      if (!t || !t.match) return { ok: false, msg: '尚未执行匹配' };
      var made = Recon.createDiffs(S, t);
      t.diff_created = (t.diff_created || 0) + made.length;
      if (made.length === 0 && t.status === 'MATCHED') t.status = 'CLOSED';
      log('对账中心', '生成差异单', taskNo, made.length + ' 张');
      if (made.length) alert_('P2', '外部对账差异', (S.partnerMap[t.partner_no] || {}).partner_short_name +
        ' ' + t.period + ' 账期生成 ' + made.length + ' 张差异单', '#/diffs');
      emit();
      return { ok: true, diffs: made };
    },
    resetReconTask: function (taskNo) {
      var t = Actions.findReconTask(taskNo); if (!t) return;
      t.in_rows = null; t.file_in = ''; t.match = null; t.diff_created = 0;
      t.status = t.file_out ? 'SENT' : 'PENDING_SEND';
      emit();
    },

    /* ============ 资损监控指标与告警中心（PRD 9.6） ============ */
    metricsSnapshot: function (asOf) { return Metrics.snapshot(S, asOf); },
    metricSeries: function (code, days) { return Metrics.series(S, code, days); },
    /**
     * 扫描六项指标，越线即产生告警（同一指标不重复刷屏，只累加发生次数）。
     * 指标回落到阈值内时，对应的未关闭告警自动关闭并留痕 —— 告警闭环的另一半。
     */
    scanMetrics: function () {
      var made = [], autoClosed = [];
      Metrics.snapshot(S).forEach(function (row) {
        var m = row.metric, st = row.status;
        if (st.code === 'CRIT') {
          var a = alert_(m.level, '指标越线 · ' + m.name,
            m.name + ' 当前 ' + m.fmt(row.value) + '，已达阈值 ' + m.fmt(m.crit) +
            '（' + m.block + '）。' + m.why,
            '#/metrics?m=' + m.code,
            { source: '资损监控', metric_code: m.code, dedupe: 'METRIC:' + m.code });
          if (a.repeat === 1) made.push(a);
        } else {
          S.alerts.forEach(function (a2) {
            if (a2.closed || a2.metric_code !== m.code) return;
            a2.closed = true; a2.close_by = '系统'; a2.close_time = nowStr();
            a2.close_action = 'RECOVERED';
            a2.close_note = m.name + ' 已回落至 ' + m.fmt(row.value) + '，低于阈值 ' + m.fmt(m.crit) + '，自动关闭';
            a2.logs.push({ time: a2.close_time, actor: '系统', action: '指标回落自动关闭', detail: a2.close_note });
            autoClosed.push(a2);
          });
        }
      });
      if (made.length || autoClosed.length) emit();
      return { made: made, autoClosed: autoClosed };
    },
    findAlert: function (id) { return S.alerts.filter(function (a) { return a.id === id; })[0]; },
    /**
     * 关闭告警（9.6.2 闭环）：必须给出处理方式与说明。
     * P0 不允许「忽略」—— 资损级告警只能是已修复或误报，且误报要写清为什么是误报。
     */
    closeAlert: function (id, action, note) {
      var a = Actions.findAlert(id);
      if (!a) return { ok: false, msg: '告警不存在' };
      if (!Store.can('alert.close')) return { ok: false, msg: '当前角色无告警关闭权限' };
      if (a.closed) return { ok: false, msg: '该告警已关闭' };
      if (!note || note.trim().length < 4) return { ok: false, msg: '关闭告警必须填写处理说明（不少于 4 个字）' };
      if (a.level === 'P0' && action === 'IGNORE') {
        return { ok: false, msg: 'P0 告警不允许「暂不处理」—— 资损级告警只能是<b>已修复</b>或<b>误报</b>' };
      }
      if (a.metric_code) {
        var row = Metrics.snapshot(S).filter(function (r) { return r.metric.code === a.metric_code; })[0];
        if (row && row.status.code === 'CRIT' && action !== 'FALSE_POSITIVE') {
          return { ok: false, msg: '指标 ' + row.metric.name + ' 仍为 ' + row.metric.fmt(row.value) +
            '（阈值 ' + row.metric.fmt(row.metric.crit) + '），<b>指标未回落不得关闭</b>；确属误报请选「误报」并说明' };
        }
      }
      a.closed = true; a.close_by = S.role; a.close_time = nowStr();
      a.close_action = action || 'FIXED'; a.close_note = note.trim();
      a.logs.push({ time: a.close_time, actor: S.role, action: '关闭告警',
        detail: '处理方式：' + (Data.ALERT_ACTIONS.filter(function (x) { return x.code === a.close_action; })[0] || {}).name +
          '　' + a.close_note });
      log('运营与审计', '关闭告警', a.id, a.title + '：' + a.close_note);
      emit();
      return { ok: true, alert: a };
    },
    reopenAlert: function (id, reason) {
      var a = Actions.findAlert(id);
      if (!a) return { ok: false, msg: '告警不存在' };
      if (!Store.can('alert.close')) return { ok: false, msg: '当前角色无告警处理权限' };
      if (!a.closed) return { ok: false, msg: '该告警未关闭' };
      a.closed = false; a.reopen_count = (a.reopen_count || 0) + 1;
      a.logs.push({ time: nowStr(), actor: S.role, action: '重新打开',
        detail: reason || '问题复现，重新打开跟进（第 ' + a.reopen_count + ' 次）' });
      a.close_by = ''; a.close_time = ''; a.close_note = ''; a.close_action = '';
      log('运营与审计', '重新打开告警', a.id, reason || '');
      emit();
      return { ok: true, alert: a };
    },
    /** 批量关闭：仅限 P2 / P3，P0 / P1 必须逐条处理 */
    batchCloseAlerts: function (ids, note) {
      if (!Store.can('alert.close')) return { ok: false, msg: '当前角色无告警关闭权限' };
      var done = [], refused = [];
      (ids || []).forEach(function (id) {
        var a = Actions.findAlert(id);
        if (!a || a.closed) return;
        if (a.level === 'P0' || a.level === 'P1') { refused.push(a); return; }
        var r = Actions.closeAlert(id, 'FIXED', note || '批量确认处理完毕');
        if (r.ok) done.push(a); else refused.push(a);
      });
      emit();
      return { ok: true, closed: done, refused: refused };
    },

    /* ============ 出账日历与超期未确认（PRD 7.2 / 7.4.2） ============ */
    /**
     * 执行超期未确认策略（7.4.2）。
     *   AUTO_CONFIRM → 视同确认并打「超期默认确认」标记
     *   HOLD        → 保持待确认、触发升级提醒、不进入结算
     */
    runConfirmDeadline: function () {
      var handled = [];
      Cal.overdueBills(S).forEach(function (x) {
        var b = x.bill;
        if (x.policy.code === 'AUTO_CONFIRM') {
          b.status = 'CONFIRMED';
          b.confirm_time = S.simToday + 'T00:05:00+08:00';
          b.confirm_user = '（超期默认确认）';
          b.auto_confirmed = 1;
          b.confirm_evidence_url = '#/evidence/auto-' + b.bill_no;
          b.confirm_policy_clause = x.policy.clause;
          var iv = Actions.createInvoiceApply(b.bill_no, { silent: true });
          log('账单中心', '超期默认确认', b.bill_no,
            '超确认截止日 ' + x.overdueDays + ' 个工作日，按协议条款视同确认' +
            (iv.ok ? '；已生成开票申请' : ''));
          alert_('P2', '超期默认确认', '账单 ' + b.bill_no + ' 超确认截止日 ' +
            b.calendar.confirm_deadline + ' 未回执，按协议条款自动视同确认', '#/bill/' + b.bill_no);
          handled.push({ bill: b, action: 'AUTO_CONFIRM' });
        } else {
          b.hold_flag = 1;
          b.hold_since = b.hold_since || S.simToday;
          b.escalate_level = x.overdueDays > 3 ? 'BIZ_MGR' : 'FIN_MGR';
          log('账单中心', '超期未确认挂起', b.bill_no,
            '超 ' + x.overdueDays + ' 个工作日，协议未约定默认确认，挂起并升级至 ' +
            (b.escalate_level === 'BIZ_MGR' ? '业务负责人' : '财务负责人'));
          alert_(b.escalate_level === 'BIZ_MGR' ? 'P1' : 'P2', '账单超期未确认',
            '账单 ' + b.bill_no + ' 超确认截止日 ' + x.overdueDays +
            ' 个工作日仍未回执，<b>协议无默认确认条款，已挂起不得进入结算</b>，需商务催办',
            '#/bill/' + b.bill_no);
          handled.push({ bill: b, action: 'HOLD' });
        }
      });
      if (handled.length) emit();
      return handled;
    },

    /* ============ 事件完整性核对与回补（PRD 12.1.5） ============ */
    eventGapSummary: function (from, to, partnerNo) {
      return Replenish.gapSummary(S, from, to, partnerNo);
    },
    /**
     * 拉取回补：按范围从上游拉全量 → 与已有比对 → 补齐缺失 → 立即进入计费。
     * 已存在的事件由幂等拦截，可安全重复执行（12.1.5）。
     */
    replenishEvents: function (scope) {
      if (!Store.can('event.replay')) return { ok: false, msg: '当前角色无事件回补权限' };
      if (!scope || !scope.from || !scope.to) return { ok: false, msg: '请指定回补范围' };
      var r = Replenish.pull(S, scope);
      if (!r.replenished) {
        log('计费引擎', '事件回补', scope.from + '~' + scope.to,
          '拉取 ' + r.pulled + ' 条，全部已存在（幂等拦截），无缺口');
        emit();
        return { ok: true, result: r, produced: [] };
      }
      r.events.forEach(function (e) {
        e.status = 'PENDING';
        e.replenished = 1;
        e.replenish_time = nowStr();
        S.events.push(e);
        S.eventMap[e.event_id] = e;
      });
      /* 补齐后立即进入计费；若所属账期已封账，冲正/计费会按 D-06 落到下期调整项 */
      var ctx = { partners: S.partners, agreements: S.agreements, versions: S.versions, eventsById: S.eventMap };
      Engine.processEvents(S.eng, r.events, ctx);
      var charged = r.events.filter(function (e) { return e.status === 'CHARGED'; });
      var flows = [];
      r.events.forEach(function (e) {
        (S.eng.flowsByEvent[e.event_id] || []).forEach(function (f) { flows.push(f); });
      });
      log('计费引擎', '事件回补', scope.from + '~' + scope.to,
        '拉取 ' + r.pulled + ' 条，幂等拦截 ' + r.duplicated + ' 条，补齐 ' + r.replenished +
        ' 条，其中已计费 ' + charged.length + ' 条，新增流水 ' + flows.length + ' 条');
      changeLog('biz_event', scope.from + '~' + scope.to, 'REPLENISH', r.duplicated + ' 条已存在', r.replenished + ' 条补齐');
      alert_('P2', '事件回补完成', '范围 ' + scope.from + ' ~ ' + scope.to +
        ' 补齐 ' + r.replenished + ' 条缺失事件，新增费用流水 ' + flows.length + ' 条', '#/replenish');
      emit();
      return { ok: true, result: r, produced: r.events, flows: flows };
    },
    /** 模拟：上游再补推一批事件（演示幂等重复执行安全） */
    simulateUpstreamPush: function (n) {
      return { ok: true, msg: '上游事实源已就绪，可直接执行回补' };
    },

    /* ==================== 争议处理闭环（PRD 7.7） ==================== */
    findDispute: function (no) {
      return S.disputes.filter(function (d) { return d.dispute_no === no; })[0];
    },
    /** 受理并自动定位：按争议类型拉数生成核查包（7.7.3 T+0） */
    locateDispute: function (no) {
      var d = Actions.findDispute(no);
      if (!d) return { ok: false, msg: '争议单不存在' };
      if (!Store.can('dispute.handle')) return { ok: false, msg: '当前角色无争议处理权限' };
      d.locate = Dispute.autoLocate(S, d);
      if (d.status === 'PENDING') d.status = 'CHECKING';
      d.logs.push({ time: nowStr(), actor: '系统', action: '自动定位',
        detail: '按争议类型「' + d.locate.type.name + '」' + d.locate.type.path + '，生成核查包（' +
          d.locate.steps.length + ' 条判定）' });
      log('账单中心', '争议自动定位', no, d.locate.type.name);
      emit();
      return { ok: true, dispute: d, locate: d.locate };
    },
    /** 补充举证材料 */
    addDisputeEvidence: function (no, label, side) {
      var d = Actions.findDispute(no);
      if (!d) return { ok: false, msg: '争议单不存在' };
      if (!Store.can('dispute.handle')) return { ok: false, msg: '当前角色无争议处理权限' };
      if (!label) return { ok: false, msg: '请填写材料名称' };
      var item = { label: label, url: '#/evidence/' + Core.No.generic('EV', 6), time: nowStr(), side: side || 'OURS' };
      (side === 'THEIRS' ? d.evidence_urls : d.our_evidence).push(side === 'THEIRS' ? item.url : item);
      d.logs.push({ time: item.time, actor: S.role, action: '补充举证材料', detail: label });
      emit();
      return { ok: true, item: item };
    },
    /**
     * 出结论（7.7.3 三分支）
     *   MAINTAIN   维持原账单 → 出具说明材料
     *   OUR_ERROR  己方有误   → 生成调整项（走审批 → 计入下期）
     *   RECALC     需重算     → 发起范围重算（差额再计入调整项）
     */
    concludeDispute: function (no, resolution, opinion, amount) {
      var d = Actions.findDispute(no);
      if (!d) return { ok: false, msg: '争议单不存在' };
      if (!Store.can('dispute.handle')) return { ok: false, msg: '当前角色无争议处理权限' };
      if (d.status === 'CLOSED') return { ok: false, msg: '该争议已闭环' };
      if (!d.locate) return { ok: false, msg: '请先执行<b>自动定位</b>生成核查包再出结论（7.7.3）' };
      var meta = Dispute.RESOLUTION_BY_CODE[resolution];
      if (!meta) return { ok: false, msg: '未知的结论类型' };
      var bill = S.billMap[d.bill_no] || {};
      d.resolution = resolution;
      d.conclusion = opinion || meta.desc;
      d.conclusion_by = S.role;
      d.conclusion_time = nowStr();
      d.status = 'CONCLUDED';
      d.logs.push({ time: d.conclusion_time, actor: S.role, action: '出具结论',
        detail: meta.name + '：' + d.conclusion });

      if (resolution === 'MAINTAIN') {
        d.statement_url = '#/statement/' + d.dispute_no;
        d.logs.push({ time: d.conclusion_time, actor: '系统', action: '生成说明材料',
          detail: '含核查包判定过程 + 逐笔追溯链路，可直接发给资金方' });
      } else if (resolution === 'OUR_ERROR') {
        var amt = amount === undefined || amount === null || amount === '' ? -Math.abs(d.disputed_amount) : Number(amount);
        var adj = Actions.addAdjustment({
          partner_no: d.partner_no, agreement_no: bill.agreement_no, direction: bill.direction,
          settle_in_period: D.nextPeriod(bill.billing_period || S.simToday.slice(0, 7)),
          source_type: 'DISPUTE_RESOLUTION', amount: M.r2(amt),
          charge_item_no: (bill.details && bill.details[0] ? bill.details[0].charge_item_no : 'CI001'),
          charge_item_name: (bill.details && bill.details[0] ? bill.details[0].charge_item_name : '费用调整'),
          reason: '争议 ' + d.dispute_no + ' 处理结论（己方有误）：' + d.conclusion,
          origin_period: bill.billing_period || ''
        });
        d.adjustment_no = adj.adjustment_no;
        d.logs.push({ time: d.conclusion_time, actor: '系统', action: '生成调整项',
          detail: adj.adjustment_no + '　' + M.fmtSigned(adj.amount) + '　计入 ' + adj.settle_in_period +
            '（D-06：不重开已确认账单）' });
      } else if (resolution === 'RECALC') {
        var task = Actions.createRecalc({
          from: bill.period_start || D.periodStart(bill.billing_period || '2026-03'),
          to: bill.period_end || D.periodEnd(bill.billing_period || '2026-03'),
          partner_nos: [d.partner_no], charge_item_nos: []
        }, '争议 ' + d.dispute_no + ' 处理结论（需重算）：' + d.conclusion);
        d.recalc_task_no = task.recalc_task_no;
        d.logs.push({ time: d.conclusion_time, actor: '系统', action: '发起范围重算',
          detail: task.recalc_task_no + '　范围 ' + task.scope.from + ' ~ ' + task.scope.to +
            '　差额将计入下期调整项' });
      }
      log('账单中心', '争议出结论', no, meta.name);
      emit();
      return { ok: true, dispute: d, meta: meta };
    },
    /** 资金方确认结论 → 闭环；不认可 → 退回核查（7.7.3） */
    confirmDispute: function (no, accept, note) {
      var d = Actions.findDispute(no);
      if (!d) return { ok: false, msg: '争议单不存在' };
      if (d.status !== 'CONCLUDED') return { ok: false, msg: '仅「已出结论待确认」的争议可由资金方确认' };
      if (!accept) {
        d.status = 'CHECKING';
        d.logs.push({ time: nowStr(), actor: '资金方对接人', action: '不认可结论',
          detail: note || '对结论有异议，退回重新核查' });
        log('账单中心', '资金方不认可争议结论', no, note || '');
        emit();
        return { ok: true, dispute: d, final: 'REOPEN' };
      }
      d.status = 'CLOSED';
      d.confirm_by = '资金方对接人';
      d.confirm_time = nowStr();
      d.close_time = nowStr();
      d.logs.push({ time: d.close_time, actor: '资金方对接人', action: '确认结论并闭环',
        detail: note || '认可处理结论' });
      /* 账单从争议中恢复：有调整项走 ADJUSTED，否则回到原状态 */
      var b = S.billMap[d.bill_no];
      if (b && b.status === 'DISPUTED') b.status = d.adjustment_no ? 'ADJUSTED' : 'CONFIRMED';
      S.alerts.forEach(function (a) {
        if (a.title === '争议超期' && String(a.msg || '').indexOf(no) >= 0) a.closed = true;
      });
      log('账单中心', '争议闭环', no, Dispute.RESOLUTION_BY_CODE[d.resolution] ?
        Dispute.RESOLUTION_BY_CODE[d.resolution].name : '');
      emit();
      return { ok: true, dispute: d, final: 'CLOSED' };
    },
    /** SLA 超时升级（7.7.3）：T+3 → 财务负责人；T+5 → 业务负责人 + 月度质量复盘 */
    escalateDisputes: function () {
      var made = [];
      S.disputes.forEach(function (d) {
        var sla = Dispute.slaOf(S, d);
        if (sla.closed || sla.level === 'NORMAL' || sla.level === 'CHECK') return;
        var target = sla.level === 'BIZ' ? 'BIZ_MGR' : 'FIN_MGR';
        if (d.escalated_to === target) return;
        d.escalated_to = target;
        d.escalate_time = nowStr();
        d.logs.push({ time: d.escalate_time, actor: '系统', action: 'SLA 超时升级',
          detail: sla.levelName + '（已耗 ' + sla.elapsed + ' 个工作日，SLA ' + Dispute.SLA.TOTAL_DAYS + ' 个工作日）' });
        alert_(sla.level === 'BIZ' ? 'P0' : 'P1', '争议超期',
          '争议单 ' + d.dispute_no + ' ' + sla.levelName, '#/disputes?id=' + d.dispute_no);
        made.push(d);
      });
      if (made.length) { log('账单中心', '争议 SLA 升级', '', made.length + ' 单'); emit(); }
      return made;
    },

    /* ---- 差异处理 ---- */
    closeDiff: function (diffNo, resolution, responsibility) {
      var d = S.diffs.filter(function (x) { return x.diff_no === diffNo; })[0]; if (!d) return;
      d.status = 'CLOSED'; d.resolution = resolution; d.responsibility = responsibility;
      d.close_time = S.simToday;
      log('对账中心', '差异闭环', diffNo, resolution); emit();
    },

    /* ---- 对账 ---- */
    runTieOut: function (period) {
      var r = Billing.runTieOut(S, period);
      S.reconRuns[period] = r;
      log('对账中心', '执行五级勾稽', period, r.pass ? '全部通过' : r.failCount + ' 项不平');
      emit();
      return r;
    },

    setRole: function (role) {
      S.role = role;
      try { localStorage.setItem('rcs.role', role); } catch (e) { }
      emit();
    },
    reset: function () { init(); emit(); }
  };

  global.Store = {
    init: init, get: function () { return S; }, subscribe: subscribe, emit: emit,
    can: can, roleName: roleName, currentUser: currentUser, Actions: Actions, log: log, alert: alert_
  };

  /* ==================== 审批通过 / 驳回后的业务动作回调 ==================== */
  Approval.handlers.RULE_PUBLISH = {
    onApproved: function (st, ap) {
      var r = Actions.publishVersion(ap.payload.versionId);
      if (r.ok) r.version.approval_no = ap.approval_no;
      return r;
    },
    onRejected: function (st, ap) {
      var v = st.versions.filter(function (x) { return x.agreement_version_id === ap.payload.versionId; })[0];
      if (v && v.status === 'PENDING_APPROVAL') v.status = 'DRAFT';
    }
  };
  Approval.handlers.RECALC = {
    onApproved: function (st, ap) {
      var t = st.recalcs.filter(function (x) { return x.recalc_task_no === ap.payload.taskNo; })[0];
      if (t) t.status = 'COMPARED';
      Actions.approveRecalc(ap.payload.taskNo);
      if (t) t.approval_no = ap.approval_no;
      return t;
    },
    onRejected: function (st, ap) {
      var t = st.recalcs.filter(function (x) { return x.recalc_task_no === ap.payload.taskNo; })[0];
      if (t && t.status === 'PENDING_APPROVAL') t.status = 'COMPARED';
    }
  };
  Approval.handlers.SETTLE = {
    onApproved: function (st, ap) {
      var o = st.settleOrderMap[ap.payload.settleNo];
      if (o) o.status = 'PENDING';
      var r = Actions.approveSettle(ap.payload.settleNo);
      if (r && r.ok) r.order.approval_no = ap.approval_no;
      return r;
    },
    onRejected: function (st, ap) {
      var o = st.settleOrderMap[ap.payload.settleNo];
      if (o && o.status === 'APPROVING') o.status = 'PENDING';
    }
  };
  Approval.handlers.ADJUSTMENT = {
    onApproved: function (st, ap) { Actions.approveAdjustment(ap.payload.adjNo); },
    onRejected: function (st, ap) {
      var a = st.adjustments.filter(function (x) { return x.adjustment_no === ap.payload.adjNo; })[0];
      if (a) a.status = 'REJECTED';
    }
  };
  Approval.handlers.BILL_VOID = {
    onApproved: function (st, ap) { Actions.voidBill(ap.payload.billNo, ap.payload.reason); }
  };
  Approval.handlers.ACCOUNT = {
    onApproved: function (st, ap) {
      var a = st.accountMap[ap.payload.acctNo];
      if (!a) return;
      a.second_checker_id = ap.chain[0].operator || 'FIN_REVIEW';
      a.status = 'ACTIVE'; a.verify_status = 'VERIFIED'; a.is_whitelisted = 1;
      a.whitelist_effective_time = D.addDays(st.simToday, 1) + ' 00:00';
      changeLog('partner_account', a.account_no_id, 'REVIEW', '{"status":"PENDING_REVIEW"}',
        '{"status":"ACTIVE","is_whitelisted":1,"approval_no":"' + ap.approval_no + '"}');
      log('资金方主数据', '账户变更审批通过', a.account_no_id, '白名单 T+1 冷静期至 ' + a.whitelist_effective_time);
    },
    onRejected: function (st, ap) {
      var a = st.accountMap[ap.payload.acctNo];
      if (a) log('资金方主数据', '账户变更被驳回', a.account_no_id, '');
    }
  };
})(window);
