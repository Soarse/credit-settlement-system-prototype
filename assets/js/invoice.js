/* =============================================================================
 * invoice.js —— 模块④ 账单中心 · 发票与税务内核（PRD 7.8，对应决策 D-08）
 *
 * 7.8.1 价税分离（倒轧，三段恒等）—— 计算已在 Core.Money.splitTax 实现，本文件负责「出票」
 * 7.8.2 开票申请：账单确认后自动生成 → 发送发票系统 → 回传结果 → 回写账单
 * 7.8.3 红蓝票与调整项的对应（负调整项 → 红字冲回 or 下期蓝票净额）
 * 7.8.4 轧差与开票的关系：轧差只影响资金划付，不影响开票金额
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money;

  /* ---------------- 申请状态机 ---------------- */
  var STATUS_META = {
    PENDING:   { name: '待提交', cls: '' },
    SUBMITTED: { name: '已提交发票系统', cls: 'info' },
    ISSUED:    { name: '已开票', cls: 'ok' },
    FAILED:    { name: '开票失败', cls: 'danger' },
    VOIDED:    { name: '已作废', cls: '' }
  };
  var KIND_META = {
    BLUE: { name: '蓝票（正数发票）', cls: 'info' },
    RED:  { name: '红字发票（冲回）', cls: 'danger' }
  };

  /* ---------------- 负调整项的票据处理策略（7.8.3）---------------- */
  var RED_POLICY = {
    RED_INVOICE:  { name: '开红字发票冲回', cls: 'danger' },
    NET_IN_BLUE:  { name: '在下期蓝票中体现净额', cls: 'info' },
    NO_ACTION:    { name: '原票未开，无需处理', cls: '' }
  };
  /* 金额低于此值不单独开红票，直接在下期蓝票冲减（避免为几十块钱走一遍红字流程） */
  var RED_MIN_AMOUNT = 1000;

  /**
   * 判定一条负调整项该开红票还是并入下期蓝票（7.8.3）
   * 规则：原发票已开 且 未跨年 且 金额 ≥ 阈值 → 红字发票；否则并入下期蓝票净额
   */
  function redPolicy(S, adj) {
    var origin = originInvoiceOf(S, adj);
    if (!origin || origin.status !== 'ISSUED') {
      return { policy: 'NO_ACTION', origin: origin || null,
        why: origin ? '原账期开票申请尚未开出（' + STATUS_META[origin.status].name + '），负调整直接在本期账单内冲减'
          : '未找到原账期的开票记录，负调整直接在本期账单内冲减' };
    }
    var originYear = String(origin.issue_date || origin.apply_date).slice(0, 4);
    var thisYear = String(adj.create_time || adj.settle_in_period).slice(0, 4);
    if (originYear !== thisYear) {
      return { policy: 'NET_IN_BLUE', origin: origin,
        why: '原发票开于 ' + originYear + ' 年，本期为 ' + thisYear + ' 年，<b>跨年不开红字</b>（跨年调整的税务处理须提前与税务顾问确认），在下期蓝票中体现净额' };
    }
    if (Math.abs(adj.amount) < RED_MIN_AMOUNT) {
      return { policy: 'NET_IN_BLUE', origin: origin,
        why: '金额 ' + M.fmt(Math.abs(adj.amount)) + ' 元低于红字发票起开金额 ' + M.fmt(RED_MIN_AMOUNT) + ' 元，在下期蓝票中体现净额' };
    }
    return { policy: 'RED_INVOICE', origin: origin,
      why: '原发票 ' + origin.invoice_no + ' 已开于 ' + origin.issue_date + '，与本期同年，按 7.8.3 <b>开红字发票冲回</b>' };
  }

  /** 找到这条调整项所冲回的那张原始发票（按 资金方 + 方向 + 原账期） */
  function originInvoiceOf(S, adj) {
    var op = adj.origin_period || null;
    if (!op) {
      var m = /(\d{4})\s*年?\s*[-]?\s*(\d{1,2})?/.exec(adj.reason || '');
      op = adj.reason && /(\d{4}-\d{2})/.test(adj.reason) ? /(\d{4}-\d{2})/.exec(adj.reason)[1] : null;
    }
    return S.invoiceApplies.filter(function (a) {
      return a.partner_no === adj.partner_no && a.direction === adj.direction &&
        a.kind === 'BLUE' && (!op || a.billing_period === op);
    }).sort(function (x, y) { return x.apply_no < y.apply_no ? 1 : -1; })[0] || null;
  }

  /* ---------------- 购销方（7.8.2）---------------- */
  /**
   * 方向决定谁开票给谁：
   *   RECEIVABLE（平台向资金方收）→ 销方 = 平台，购方 = 资金方
   *   PAYABLE  （平台向资金方付）→ 销方 = 资金方，购方 = 平台
   */
  function parties(S, partnerNo, direction) {
    var p = S.invoiceMap[partnerNo] || {};
    var pf = Data.PLATFORM_INVOICE;
    var partnerSide = {
      title: p.invoice_title || (S.partnerMap[partnerNo] || {}).partner_name,
      taxpayer_no: p.taxpayer_no || '', reg_address: p.reg_address || '', reg_phone: p.reg_phone || '',
      bank_name: p.bank_name || '', bank_account: p.bank_account || ''
    };
    var platformSide = {
      title: pf.invoice_title, taxpayer_no: pf.taxpayer_no, reg_address: pf.reg_address,
      reg_phone: pf.reg_phone, bank_name: pf.bank_name, bank_account: pf.bank_account
    };
    return direction === 'RECEIVABLE'
      ? { seller: platformSide, buyer: partnerSide, seller_side: 'PLATFORM', buyer_side: 'PARTNER' }
      : { seller: partnerSide, buyer: platformSide, seller_side: 'PARTNER', buyer_side: 'PLATFORM' };
  }

  function taxCategory(code) {
    return Data.TAX_CATEGORY[code] || { code: '3040000', name: '现代服务*其他现代服务' };
  }

  /* ---------------- 生成开票申请（7.8.2）---------------- */
  /**
   * 从一张账单生成开票申请。返回 { blue, reds:[], checks }
   *   blue —— 蓝票申请（本期费用 + 正调整项 + 并入净额的负调整项）
   *   reds —— 需单独开红字发票的负调整项，每条一张
   * 恒等约束：蓝票金额 + Σ红票金额（负数）= 账单应结金额
   */
  function planFor(S, bill) {
    var adjs = S.adjustments.filter(function (a) { return a.bill_no === bill.bill_no; });
    var reds = [], netAdjs = [];
    adjs.forEach(function (a) {
      if (a.amount >= 0) { netAdjs.push({ adj: a, decision: { policy: 'NET_IN_BLUE', origin: null,
        why: '正调整项（补收）按 7.8.3 计入下期蓝票' } }); return; }
      var d = redPolicy(S, a);
      if (d.policy === 'RED_INVOICE') reds.push({ adj: a, decision: d });
      else netAdjs.push({ adj: a, decision: d });
    });
    var redSum = M.sum(reds, function (r) { return r.adj.amount; });        // 负数
    var blueAmount = M.r2(bill.total_amount - redSum);
    return { bill: bill, reds: reds, netAdjs: netAdjs, redSum: redSum, blueAmount: blueAmount,
      identity: M.r2(blueAmount + redSum) === M.r2(bill.total_amount) };
  }

  function lineOf(d) {
    var tc = taxCategory(d.charge_item_code);
    return {
      goods_name: '*' + tc.name.split('*')[0] + '*' + d.charge_item_name,
      tax_category_code: tc.code, tax_category_name: tc.name,
      amount: d.amount, amount_ex_tax: d.amount_ex_tax, tax_amount: d.tax_amount, tax_rate: d.tax_rate
    };
  }

  /** 生成蓝票申请对象（不入库，由 Store 负责写入与编号） */
  function buildBlue(S, bill, plan, applyDate) {
    var pr = parties(S, bill.partner_no, bill.direction);
    var inv = S.invoiceMap[bill.partner_no] || {};
    var lines = bill.details.map(lineOf);
    /* 并入蓝票的调整项各成一行（按 7.8.3 在下期蓝票中体现净额） */
    plan.netAdjs.forEach(function (x) {
      var t = M.splitTax(x.adj.amount, bill.details[0] ? bill.details[0].tax_rate : 0.06);
      var tc = taxCategory((bill.details[0] || {}).charge_item_code || '');
      lines.push({
        goods_name: '*' + tc.name.split('*')[0] + '*' + (x.adj.amount < 0 ? '费用冲减' : '费用补收') + '（' + x.adj.adjustment_no + '）',
        tax_category_code: tc.code, tax_category_name: tc.name,
        amount: x.adj.amount, amount_ex_tax: t.exTax, tax_amount: t.tax,
        tax_rate: bill.details[0] ? bill.details[0].tax_rate : 0.06, adjustment_no: x.adj.adjustment_no
      });
    });
    var total = M.sum(lines, function (l) { return l.amount; });
    var tt = M.splitTax(total, lines[0] ? lines[0].tax_rate : 0.06);
    return {
      kind: 'BLUE', bill_no: bill.bill_no, partner_no: bill.partner_no, agreement_no: bill.agreement_no,
      billing_period: bill.billing_period, direction: bill.direction,
      seller: pr.seller, buyer: pr.buyer, seller_side: pr.seller_side, buyer_side: pr.buyer_side,
      invoice_type: inv.invoice_type || 'SPECIAL', lines: lines,
      amount: total, amount_ex_tax: tt.exTax, tax_amount: tt.tax,
      remark: bill.billing_period + ' 账期　账单号 ' + bill.bill_no,
      receiver_info: inv.receiver_info || '', apply_date: applyDate,
      status: 'PENDING', submit_time: '', invoice_code: '', invoice_no: '', issue_date: '',
      pdf_url: '', fail_reason: '', red_of: '', void_reason: '', logs: []
    };
  }

  /** 生成红字发票申请对象 */
  function buildRed(S, bill, item, applyDate) {
    var pr = parties(S, bill.partner_no, bill.direction);
    var inv = S.invoiceMap[bill.partner_no] || {};
    var rate = bill.details[0] ? bill.details[0].tax_rate : 0.06;
    var t = M.splitTax(item.adj.amount, rate);
    var tc = taxCategory((bill.details[0] || {}).charge_item_code || '');
    return {
      kind: 'RED', bill_no: bill.bill_no, partner_no: bill.partner_no, agreement_no: bill.agreement_no,
      billing_period: bill.billing_period, direction: bill.direction,
      seller: pr.seller, buyer: pr.buyer, seller_side: pr.seller_side, buyer_side: pr.buyer_side,
      invoice_type: inv.invoice_type || 'SPECIAL',
      lines: [{
        goods_name: '*' + tc.name.split('*')[0] + '*' + (bill.details[0] ? bill.details[0].charge_item_name : '服务费') + '（红字冲回）',
        tax_category_code: tc.code, tax_category_name: tc.name,
        amount: item.adj.amount, amount_ex_tax: t.exTax, tax_amount: t.tax, tax_rate: rate,
        adjustment_no: item.adj.adjustment_no
      }],
      amount: item.adj.amount, amount_ex_tax: t.exTax, tax_amount: t.tax,
      remark: '冲回原发票 ' + item.decision.origin.invoice_no + '　依据调整项 ' + item.adj.adjustment_no +
        '　原因：' + (item.adj.reason || ''),
      receiver_info: inv.receiver_info || '', apply_date: applyDate,
      status: 'PENDING', submit_time: '', invoice_code: '', invoice_no: '', issue_date: '',
      pdf_url: '', fail_reason: '',
      red_of: item.decision.origin.apply_no, red_of_invoice_no: item.decision.origin.invoice_no,
      adjustment_no: item.adj.adjustment_no, policy_why: item.decision.why,
      void_reason: '', logs: []
    };
  }

  /* ---------------- 开票前置校验 ---------------- */
  function preCheck(S, bill) {
    var out = [];
    function add(code, name, ok, msg, hard) {
      out.push({ code: code, name: name, ok: ok, msg: msg, type: hard === false ? 'WARN' : 'HARD' });
    }
    add('V-I01', '账单状态可开票',
      ['CONFIRMED', 'ADJUSTED', 'SETTLED'].indexOf(bill.status) >= 0,
      ['CONFIRMED', 'ADJUSTED', 'SETTLED'].indexOf(bill.status) >= 0
        ? '账单状态 ' + bill.status + '，资金方已确认'
        : '账单尚未经资金方确认（当前 ' + bill.status + '）—— <b>未确认的账单不得开票</b>，否则争议调整后要走红冲');
    add('V-I02', '账单未作废', bill.status !== 'VOIDED',
      bill.status !== 'VOIDED' ? '账单有效' : '已作废账单不开票（7.8.3：未确认即作废，无需票据处理）');
    var inv = S.invoiceMap[bill.partner_no];
    add('V-I03', '开票信息完整', !!(inv && inv.invoice_title && inv.taxpayer_no),
      inv && inv.taxpayer_no ? '抬头「' + inv.invoice_title + '」／税号 ' + inv.taxpayer_no
        : '资金方开票信息缺失，请先在主数据补录（4.4）');
    add('V-I04', '价税三段恒等',
      M.r2(bill.total_amount_ex_tax + bill.total_tax_amount) === M.r2(bill.total_amount),
      M.fmt(bill.total_amount_ex_tax) + ' + ' + M.fmt(bill.total_tax_amount) + ' = ' + M.fmt(bill.total_amount));
    var exist = S.invoiceApplies.filter(function (a) {
      return a.bill_no === bill.bill_no && a.status !== 'VOIDED' && a.status !== 'FAILED';
    });
    add('V-I05', '未重复开票', exist.length === 0,
      exist.length ? '该账单已存在开票申请：' + exist.map(function (x) { return x.apply_no; }).join('、') : '无重复申请');
    add('V-I06', '金额不为零', M.r2(bill.total_amount) !== 0,
      M.r2(bill.total_amount) !== 0 ? '应结金额 ' + M.fmt(bill.total_amount) : '零金额账单不开票', false);
    return { checks: out, pass: out.every(function (c) { return c.type !== 'HARD' || c.ok; }) };
  }

  /* ---------------- 轧差与开票的关系（7.8.4）---------------- */
  /** 对一张轧差结算单，算出「各自全额开票 vs 银行按净额划转」的对照 */
  function nettingView(S, order) {
    if (!order || !order.is_netting) return null;
    var bills = order.bill_nos.map(function (n) { return S.billMap[n]; }).filter(Boolean);
    var recv = bills.filter(function (b) { return b.direction === 'RECEIVABLE'; });
    var pay = bills.filter(function (b) { return b.direction === 'PAYABLE'; });
    function side(list, sellerName) {
      return {
        seller: sellerName, bills: list,
        amount: M.sum(list, function (b) { return b.total_amount; }),
        tax: M.sum(list, function (b) { return b.total_tax_amount; })
      };
    }
    var pn = (S.partnerMap[order.partner_no] || {}).partner_short_name;
    return {
      order: order,
      platformIssues: side(recv, '平台 → ' + pn),
      partnerIssues: side(pay, pn + ' → 平台'),
      transfer: order.settle_amount, direction: order.direction
    };
  }

  global.Invoice = {
    STATUS_META: STATUS_META, KIND_META: KIND_META, RED_POLICY: RED_POLICY, RED_MIN_AMOUNT: RED_MIN_AMOUNT,
    redPolicy: redPolicy, originInvoiceOf: originInvoiceOf, parties: parties, taxCategory: taxCategory,
    planFor: planFor, buildBlue: buildBlue, buildRed: buildRed,
    preCheck: preCheck, nettingView: nettingView
  };
})(window);
