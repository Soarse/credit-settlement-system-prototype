/* =============================================================================
 * payment.js —— 模块⑤ 结算中心 · 付款执行与异常分支内核
 *   PRD 8.4.3 状态未知的处理（绝不自动重试 / 递增主动查询 / 超时转人工）
 *   PRD 8.4.4 重试策略矩阵
 *   PRD 8.5   结算状态机：成功 / 部分成功 / 失败 / 状态未知 / 退票
 *
 * 本模块的容错原则与计费引擎相反：计费可以延迟、可以重算；钱付出去就收不回来。
 * 因此这里的每一个分支都优先保证「不重复付、不错付」，其次才是效率。
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  /* ---------------- 指令状态（8.4.1） ---------------- */
  var INS_META = {
    READY:      { name: '待发送', cls: '' },
    SENT:       { name: '已发送', cls: 'info' },
    PROCESSING: { name: '通道处理中', cls: 'info' },
    SUCCESS:    { name: '成功', cls: 'ok' },
    FAILED:     { name: '失败', cls: 'danger' },
    UNKNOWN:    { name: '状态未知', cls: 'danger' },
    RETURNED:   { name: '已退票', cls: 'purple' },
    CANCELLED:  { name: '已作废', cls: '' }
  };

  /* ---------------- 重试策略矩阵（8.4.4） ---------------- */
  var RETRY_POLICY = [
    { status: 'READY', can: true, why: '尚未发出，通道一定没收到，重发安全' },
    { status: 'SEND_FAILED', can: true, why: '网络错误未达通道 —— 但须先确认通道确实未收到，否则等同于状态未知' },
    { status: 'FAILED', can: true, why: '通道明确返回失败，资金未动；需人工确认失败原因后重试，不自动重发' },
    { status: 'UNKNOWN', can: false, why: '<b>请求已发出但结果不明，重试可能造成重复付款</b> —— 转主动查询，绝不自动重试' },
    { status: 'SUCCESS', can: false, why: '已成功，重试即重复付款' },
    { status: 'RETURNED', can: false, why: '已退票，须走「重新结算」而非重试同一条指令' }
  ];
  function canRetry(ins) {
    if (ins.status === 'READY') return { can: true, why: '尚未发出，重发安全' };
    if (ins.status === 'FAILED') return { can: true, why: '通道明确失败，资金未动，确认原因后可重试' };
    if (ins.status === 'UNKNOWN') return { can: false, why: '状态未知禁止重试（8.4.3），只能主动查询或人工确认' };
    if (ins.status === 'SUCCESS') return { can: false, why: '已成功，重试即重复付款' };
    if (ins.status === 'RETURNED') return { can: false, why: '已退票，应走重新结算' };
    return { can: false, why: '当前状态不允许重试' };
  }

  /* ---------------- 主动查询编排（8.4.3 / 12.2.3） ---------------- */
  /* 对「已发送 / 处理中」且超过 5 分钟的指令，按递增间隔主动查询通道状态 */
  var POLL_SCHEDULE = [30, 120, 600, 1800];        // 秒：30s / 2min / 10min / 30min
  var POLL_TIMEOUT_MIN = 120;                       // 2 小时未明确 → UNKNOWN + P0
  function pollLabel(i) {
    var s = POLL_SCHEDULE[Math.min(i, POLL_SCHEDULE.length - 1)];
    return s < 60 ? s + ' 秒' : (s / 60) + ' 分钟';
  }
  function pollPlan(ins) {
    var out = [], acc = 0;
    for (var i = 0; i < POLL_SCHEDULE.length; i++) {
      acc += POLL_SCHEDULE[i];
      out.push({ seq: i + 1, interval: pollLabel(i), elapsed: fmtMin(acc),
        done: (ins.poll_count || 0) > i });
    }
    out.push({ seq: '—', interval: '累计 ' + POLL_TIMEOUT_MIN + ' 分钟仍未明确',
      elapsed: fmtMin(POLL_TIMEOUT_MIN * 60), done: ins.status === 'UNKNOWN', timeout: true });
    return out;
  }
  function fmtMin(sec) {
    if (sec < 60) return sec + ' 秒';
    var m = Math.round(sec / 60);
    return m < 60 ? m + ' 分钟' : (m / 60).toFixed(m % 60 ? 1 : 0) + ' 小时';
  }

  /* ---------------- 结算单状态推导（8.5） ---------------- */
  function deriveOrderStatus(order) {
    /* 已被补发替代的失败指令不再参与状态推导（8.5：补发解决「钱还要付」） */
    var ins = order.instructions.filter(function (i) {
      return i.status !== 'CANCELLED' && !i.resupplied;
    });
    if (!ins.length) return order.status;
    var has = function (s) { return ins.some(function (i) { return i.status === s; }); };
    var all = function (s) { return ins.every(function (i) { return i.status === s; }); };
    if (has('RETURNED')) return 'RETURNED';
    if (has('UNKNOWN')) return 'UNKNOWN';
    if (all('SUCCESS')) return 'COMPLETED';
    if (has('SUCCESS') && (has('FAILED'))) return 'PARTIAL';
    if (all('FAILED')) return 'FAILED';
    return 'PROCESSING';
  }

  /* ---------------- 成功一条指令 → 结算流水 + 回单（8.7） ---------------- */
  function succeed(S, order, ins, date) {
    ins.status = 'SUCCESS';
    ins.success_time = date + 'T14:2' + (ins.seq % 10) + ':00+08:00';
    if (!ins.channel_serial_no) ins.channel_serial_no = 'CH' + date.replace(/-/g, '') + Core.pad(1000 + ins.seq, 6);
    var sf = {
      settle_flow_no: Core.No.settleFlow(date), instruction_no: ins.instruction_no, settle_no: order.settle_no,
      bill_nos: order.bill_nos, amount: ins.amount, direction: order.direction, status: 'SUCCESS',
      success_time: ins.success_time, receipt_no: '', fail_reason: '', settle_date: date
    };
    S.settleFlows.push(sf);
    var rc = {
      receipt_no: Core.No.receipt(date), settle_flow_no: sf.settle_flow_no,
      channel_serial_no: ins.channel_serial_no, amount: ins.amount, receipt_date: date,
      receipt_file_url: '#/receipt/' + sf.settle_flow_no, receive_type: 'CALLBACK', settle_date: date
    };
    S.receipts.push(rc);
    sf.receipt_no = rc.receipt_no;
    return { flow: sf, receipt: rc };
  }

  /* ---------------- 部分成功：补发（8.5 PARTIAL） ---------------- */
  /** 对失败的指令生成新指令补发；结算单不拆，序号续号并记录 resupply_of */
  function buildResupply(order, date) {
    var failed = order.instructions.filter(function (i) { return i.status === 'FAILED' && !i.resupplied; });
    if (!failed.length) return [];
    var base = order.instructions.length;
    var made = [];
    failed.forEach(function (f, k) {
      f.resupplied = 1;
      var ni = {
        instruction_no: Core.No.payInstruction(date), settle_no: order.settle_no,
        seq: base + k + 1, total_seq: base + failed.length, amount: f.amount,
        payer_account: order.payer_account, payee_account: order.payee_account,
        pay_channel: order.pay_channel, channel_serial_no: '', status: 'READY', retry_count: 0,
        resupply_of: f.instruction_no, poll_count: 0, fail_reason: ''
      };
      order.instructions.push(ni);
      made.push(ni);
    });
    order.instructions.forEach(function (i) { i.total_seq = order.instructions.length; });
    return made;
  }

  /** 结算单是否处于异常处理范围内（含补发在途、未付未结转） */
  function hasException(order) {
    if (['PARTIAL', 'FAILED', 'UNKNOWN', 'RETURNED'].indexOf(order.status) >= 0) return true;
    if (order.status === 'PENDING' || order.status === 'APPROVING' || order.status === 'WAITING_RECEIPT') return false;
    if (order.instructions.some(function (i) { return i.status === 'FAILED' || i.status === 'UNKNOWN'; })) return true;
    if (order.instructions.some(function (i) { return i.resupply_of; }) && order.status !== 'COMPLETED') return true;
    return false;
  }

  /** 部分结算的未付金额（进入下期结转） */
  function shortfall(order) {
    var paid = M.sum(order.instructions.filter(function (i) { return i.status === 'SUCCESS'; }),
      function (i) { return i.amount; });
    return { paid: paid, unpaid: M.r2(order.settle_amount - paid) };
  }

  global.Payment = {
    INS_META: INS_META, RETRY_POLICY: RETRY_POLICY, canRetry: canRetry,
    POLL_SCHEDULE: POLL_SCHEDULE, POLL_TIMEOUT_MIN: POLL_TIMEOUT_MIN,
    pollPlan: pollPlan, pollLabel: pollLabel, fmtMin: fmtMin,
    deriveOrderStatus: deriveOrderStatus, succeed: succeed, hasException: hasException,
    buildResupply: buildResupply, shortfall: shortfall
  };
})(window);
