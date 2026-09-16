/* =============================================================================
 * dispute.js —— 模块④ 账单中心 · 争议处理闭环内核（PRD 7.7）
 *   7.7.1 争议单        7.7.2 争议类型与定位路径      7.7.3 处理流程与 SLA
 *
 * 这一模块的产品主张只有一句：把争议处理从「翻 Excel 扯皮」变成「查系统给答案」。
 * 做到这一点靠的不是话术，而是每种争议类型都有一条<确定的定位路径>，
 * 系统按类型自动拉数生成核查包，运营拿着核查包给结论，而不是从零开始查。
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  /* ---------------- SLA（7.7.3） ---------------- */
  var SLA = {
    CHECK_DAYS: 2,          // 运营核查：T+2 内
    ESCALATE_FIN: 3,        // T+3 未闭环 → 升级财务负责人
    ESCALATE_BIZ: 5,        // T+5 未闭环 → 升级业务负责人 + 进入月度质量复盘
    TOTAL_DAYS: 5           // 全流程 SLA：T+5 工作日
  };

  /* ---------------- 争议状态机 ---------------- */
  var STATUS_META = {
    PENDING:   { name: '待受理', cls: 'warn' },
    LOCATING:  { name: '系统定位中', cls: 'info' },
    CHECKING:  { name: '运营核查中', cls: 'info' },
    CONCLUDED: { name: '已出结论待确认', cls: 'purple' },
    CLOSED:    { name: '已闭环', cls: 'ok' },
    REJECTED:  { name: '资金方不认可', cls: 'danger' }
  };

  /* ---------------- 争议类型与定位路径（7.7.2） ---------------- */
  var TYPES = [
    { code: 'CALIBER', name: '口径分歧', symptom: '双方对「在贷余额」等口径理解不同',
      path: '调取协议附件口径条款 + 2.4 章定义比对' },
    { code: 'BASIS_DIFF', name: '基数不符', symptom: '资金方算出的放款额与我方不同',
      path: '下钻至逐笔事件，比对借据清单' },
    { code: 'RATE_APPLY', name: '费率适用错误', symptom: '资金方认为应适用其他档位',
      path: '调取规则版本快照 + 阶梯计算明细' },
    { code: 'PERIOD_ATTR', name: '时间归属分歧', symptom: '跨月放款归属哪个账期',
      path: '调取事件 occur_time 与 2.4.5 归属规则' },
    { code: 'DUPLICATE', name: '重复计费', symptom: '同一笔被算两次',
      path: '查幂等记录与流水的 event_id 分布' },
    { code: 'MISSING', name: '漏算', symptom: '资金方认为有笔未计费',
      path: '查该事件的 IGNORED 原因' },
    { code: 'REVERSAL', name: '冲正未体现', symptom: '已撤销业务仍在收费',
      path: '查红冲流水与跨期调整项' }
  ];
  var TYPE_BY_CODE = {};
  TYPES.forEach(function (t) { TYPE_BY_CODE[t.code] = t; });

  /* ---------------- 结论分支（7.7.3） ---------------- */
  var RESOLUTIONS = [
    { code: 'MAINTAIN', name: '维持原账单', cls: 'ok',
      next: '出具说明材料 → 资金方确认 → 闭环',
      desc: '核查后确认我方口径与计算无误，向资金方出具带追溯链路的说明材料' },
    { code: 'OUR_ERROR', name: '己方有误 · 生成调整项', cls: 'warn',
      next: '生成调整项 → 审批 → 计入下期 → 通知资金方 → 闭环',
      desc: '差额明确且无需重算，直接按差额生成调整项计入下期账单（D-06：不重开已确认账单）' },
    { code: 'RECALC', name: '需重算', cls: 'danger',
      next: '发起范围重算（6.9）→ 差额计入调整项 → 闭环',
      desc: '影响面超出单笔、需按范围重新计算的，走影子表重算流程，差额再计入调整项' }
  ];
  var RESOLUTION_BY_CODE = {};
  RESOLUTIONS.forEach(function (r) { RESOLUTION_BY_CODE[r.code] = r; });

  /* ---------------- SLA 计算 ---------------- */
  function workdaysBetween(from, to) {
    var d = D.parse(from), end = D.parse(to), n = 0;
    while (d < end) {
      d = D.parse(D.fmt(D.addDays(D.fmt(d), 1)));
      var w = d.getDay();
      if (w !== 0 && w !== 6) n++;
    }
    return n;
  }
  function addWorkdays(from, n) {
    var d = from, k = 0;
    while (k < n) {
      d = D.addDays(d, 1);
      var w = D.parse(d).getDay();
      if (w !== 0 && w !== 6) k++;
    }
    return d;
  }
  /** 返回 { elapsed, remain, level, levelName, deadline, checkDeadline, breached } */
  function slaOf(S, d) {
    var closed = d.status === 'CLOSED' || d.status === 'REJECTED';
    var asOf = closed ? (d.close_time || S.simToday).slice(0, 10) : S.simToday;
    var elapsed = workdaysBetween(d.create_time, asOf);
    var deadline = addWorkdays(d.create_time, SLA.TOTAL_DAYS);
    var checkDeadline = addWorkdays(d.create_time, SLA.CHECK_DAYS);
    var level = 'NORMAL', levelName = '在 SLA 内';
    if (!closed) {
      if (elapsed > SLA.ESCALATE_BIZ) { level = 'BIZ'; levelName = '超 T+5，升级业务负责人 + 月度质量复盘'; }
      else if (elapsed > SLA.ESCALATE_FIN) { level = 'FIN'; levelName = '超 T+3，升级财务负责人'; }
      else if (elapsed > SLA.CHECK_DAYS) { level = 'CHECK'; levelName = '超 T+2 核查时限'; }
    }
    return { elapsed: elapsed, remain: SLA.TOTAL_DAYS - elapsed, level: level, levelName: levelName,
      deadline: deadline, checkDeadline: checkDeadline, closed: closed,
      breached: !closed && elapsed > SLA.TOTAL_DAYS };
  }

  /* ---------------- 自动定位：按争议类型拉数生成核查包（7.7.2 / 7.7.3） ----------------
   * 每一步都是一条可判定的事实，而不是「建议人工核查」。
   */
  function autoLocate(S, d) {
    var bill = S.billMap[d.bill_no] || {};
    var flows = S.eng.feeFlows.filter(function (f) { return f.bill_no === d.bill_no; });
    var steps = [], refs = [], conclusion = '', suggest = 'MAINTAIN';
    var t = TYPE_BY_CODE[d.dispute_type] || TYPE_BY_CODE.CALIBER;

    function step(ok, text, detail) { steps.push({ ok: ok, text: text, detail: detail || '' }); }

    /* 公共第一步：账单与流水的对应关系 */
    step(true, '账单 ' + d.bill_no + ' 本期费用 ' + M.fmt(bill.current_period_amount) +
      '，由 ' + flows.length + ' 条费用流水汇总而来',
      '每条流水都带三向引用（业务事件 / 规则版本快照 / 基数快照），可逐笔下钻');

    if (t.code === 'RATE_APPLY') {
      var ver = S.versions.filter(function (v) { return v.agreement_no === bill.agreement_no; });
      var used = Core.uniq(flows.map(function (f) { return f.rule_version; }));
      step(true, '本期实际适用的规则版本：' + used.join('、'),
        ver.map(function (v) { return v.version_no + ' [' + v.effective_date + ', ' + v.expiry_date + ') ' + v.status; }).join('；'));
      var tier = flows.filter(function (f) { return f.flow_type === 'TIER_TRUEUP'; });
      if (tier.length) {
        step(true, '存在阶梯月末找平流水 ' + tier.length + ' 条，合计 ' +
          M.fmt(M.sum(tier, function (f) { return f.fee_amount; })),
          '阶梯采用<b>增量法逐笔计费 + 月末按期末累计基数找平</b>：逐笔累加的结果与「期末一次性按累计基数算」必然有差额，找平流水补的正是这个差额');
        conclusion = '差额来自<b>阶梯计费的月末找平</b>，不是费率适用错误。资金方若按「期末累计基数一次性套档」自行汇总，' +
          '会漏掉逐笔计费与找平的组合过程，从而少算 ' +
          M.fmt(M.sum(tier, function (f) { return f.fee_amount; })) + '。';
        suggest = 'MAINTAIN';
        refs.push({ label: '阶梯找平流水', link: '/flows?bill=' + d.bill_no });
      } else {
        step(false, '未发现找平流水，需逐笔比对费率档位', '');
        conclusion = '需调取规则版本快照与逐笔计算明细，与资金方口径逐档比对。';
        suggest = 'RECALC';
      }
      refs.push({ label: '协议版本时间轴', link: '/versions?id=' + bill.agreement_no });
    } else if (t.code === 'DUPLICATE') {
      var byEvent = Core.groupBy(flows.filter(function (f) { return f.flow_type === 'NORMAL'; }),
        function (f) { return f.event_id + '|' + f.charge_item_no; });
      var dup = Object.keys(byEvent).filter(function (k) { return byEvent[k].length > 1; });
      step(dup.length === 0, dup.length === 0
        ? '幂等键（event_id + charge_item_no + rule_version）无重复，未发现同一事件被计费两次'
        : '发现 ' + dup.length + ' 组疑似重复计费', dup.slice(0, 3).join('；'));
      var idem = S.events.filter(function (e) { return e.ignore_reason === 'DUPLICATE'; });
      step(true, '事件网关幂等拦截记录 ' + idem.length + ' 条', '重复投递在入口即被拦截，不会进入计费');
      conclusion = dup.length === 0
        ? '未发现重复计费：幂等键唯一约束在写入时即生效，重复投递已在事件网关被拦截。可向资金方出示幂等记录。'
        : '存在重复流水，需红冲多计部分并计入下期调整项。';
      suggest = dup.length === 0 ? 'MAINTAIN' : 'OUR_ERROR';
      refs.push({ label: '事件中心（幂等拦截）', link: '/events?reason=DUPLICATE' });
    } else if (t.code === 'MISSING') {
      var ignored = S.events.filter(function (e) {
        return e.partner_no === d.partner_no && e.status === 'IGNORED' &&
          D.period(e.occur_date) === bill.billing_period;
      });
      var byReason = Core.groupBy(ignored, function (e) { return e.ignore_reason; });
      step(ignored.length === 0, ignored.length === 0
        ? '本账期无被忽略的事件'
        : '本账期有 ' + ignored.length + ' 条事件被忽略，需逐条核对忽略原因是否符合协议约定',
        Object.keys(byReason).map(function (k) { return k + ' ' + byReason[k].length + ' 条'; }).join('；'));
      conclusion = ignored.length
        ? '「漏算」多数来自<b>规则过滤命中</b>而非系统遗漏：' +
          Object.keys(byReason).map(function (k) { return k + ' ' + byReason[k].length + ' 条'; }).join('、') +
          '。需与资金方逐条确认这些过滤条件是否符合协议约定。'
        : '本账期无被忽略事件，需向上游核查事件是否送达（可发起事件回补）。';
      suggest = ignored.length ? 'MAINTAIN' : 'RECALC';
      refs.push({ label: '事件中心（已忽略）', link: '/events?status=IGNORED' });
    } else if (t.code === 'REVERSAL') {
      var rev = S.eng.feeFlows.filter(function (f) {
        return f.partner_no === d.partner_no && f.flow_type === 'REVERSAL';
      });
      var adjs = S.adjustments.filter(function (a) {
        return a.partner_no === d.partner_no && a.source_type === 'CROSS_PERIOD_REVERSAL';
      });
      step(rev.length > 0, '红冲流水 ' + rev.length + ' 条，合计 ' +
        M.fmt(M.sum(rev, function (f) { return f.fee_amount; })), '');
      step(true, '跨期冲正调整项 ' + adjs.length + ' 项，合计 ' +
        M.fmt(M.sum(adjs, function (a) { return a.amount; })),
        '账单确认后发生的冲正<b>不重开原账单</b>，按 D-06 计入下期调整项');
      conclusion = adjs.length
        ? '冲正<b>已体现</b>，只是按 D-06 落在下期账单的调整项里而不是原账单上。可向资金方出示调整项清单与原始红冲流水。'
        : '未找到对应的红冲流水或调整项，需核查冲正事件是否送达。';
      suggest = adjs.length ? 'MAINTAIN' : 'RECALC';
      refs.push({ label: '调整项清单', link: '/adjustments' });
    } else if (t.code === 'BASIS_DIFF') {
      var snapIds = Core.uniq(flows.map(function (f) { return f.basis_snapshot_no; }).filter(Boolean));
      step(true, '本期基数快照 ' + snapIds.length + ' 份，全部已固化留存',
        '基数在计费时点固化为不可变快照，事后上游数据变化不会改变已出账单');
      var basisSum = M.sum(flows, function (f) { return f.basis_amount; });
      step(true, '本期计费基数合计 ' + M.fmt(basisSum), '可逐笔下钻至借据清单与原始事件');
      conclusion = '基数取自<b>固化快照</b>而非实时查询。若资金方基数不同，多为统计口径（时点 vs 日均、是否含逾期资产）或统计范围（产品过滤）差异，' +
        '建议按借据清单逐笔比对定位到具体差异笔。';
      suggest = 'MAINTAIN';
      refs.push({ label: '费用流水（可下钻快照）', link: '/flows?bill=' + d.bill_no });
    } else if (t.code === 'PERIOD_ATTR') {
      var ps = bill.period_start, pe = bill.period_end;
      var edge = flows.filter(function (f) { return f.fee_date === ps || f.fee_date === pe; });
      step(true, '账期区间 [' + ps + ', ' + pe + ']，边界日流水 ' + edge.length + ' 条',
        '归属规则：按<b>事件发生日 occur_date</b> 落账期，而非事件接收日或计费日');
      conclusion = '账期归属按事件发生日判定（2.4.5），跨月放款归属发生当日所在账期。' +
        '边界笔可逐条出示 occur_time 与账期区间的比对结果。';
      suggest = 'MAINTAIN';
      refs.push({ label: '账单明细', link: '/bill/' + d.bill_no });
    } else {
      var agr = S.agreementMap[bill.agreement_no] || {};
      step(true, '协议 ' + bill.agreement_no + '，生效版本按事件发生日路由',
        '口径定义以协议附件条款为准，系统实现与条款的对应关系记录在接入 SOP 的条款拆解表中');
      conclusion = '口径分歧须回到<b>条款拆解表</b>：该表在接入 D1 由 BD + 财务 + 资金方三方会签，' +
        '逐条记录了每个要素的口径与系统取值。分歧应对照该表定位，而不是各自解释。';
      suggest = 'MAINTAIN';
      refs.push({ label: '接入 SOP · 条款拆解表', link: '/onboard' });
    }

    refs.push({ label: '全链路追溯', link: '/trace?q=' + d.bill_no });
    return { type: t, steps: steps, conclusion: conclusion, suggest: suggest, refs: refs,
      packageTime: S.simToday };
  }

  global.Dispute = {
    SLA: SLA, STATUS_META: STATUS_META, TYPES: TYPES, TYPE_BY_CODE: TYPE_BY_CODE,
    RESOLUTIONS: RESOLUTIONS, RESOLUTION_BY_CODE: RESOLUTION_BY_CODE,
    workdaysBetween: workdaysBetween, addWorkdays: addWorkdays,
    slaOf: slaOf, autoLocate: autoLocate
  };
})(window);
