/* =============================================================================
 * calendar.js —— 模块④ 账单中心 · 出账日历与超期未确认策略
 *   PRD 7.2.1 账期模型 / 7.2.2 出账日历 / 7.4.2 超期未确认策略 / 7.9 页面
 *
 * 出账日历回答的是一个很朴素但很要命的问题：这个月，哪天该做什么。
 * 五家资金方的封账日、出账日、确认截止日、结算日各不相同，靠人记必然漏。
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  var MILESTONES = {
    CUTOFF:  { code: 'CUTOFF',  name: '封账日', short: '封', cls: 'info' },
    BILL:    { code: 'BILL',    name: '出账日', short: '账', cls: 'purple' },
    CONFIRM: { code: 'CONFIRM', name: '确认截止', short: '确', cls: 'warn' },
    SETTLE:  { code: 'SETTLE',  name: '结算日', short: '结', cls: 'ok' }
  };

  /** 协议级确认策略（7.4.2）；未配置时按缺省 HOLD */
  function confirmPolicy(S, agreementNo) {
    var agr = S.agreementMap[agreementNo] || {};
    var code = agr.confirm_policy || 'HOLD';
    var meta = Data.CONFIRM_POLICIES.filter(function (p) { return p.code === code; })[0];
    return { code: code, meta: meta, clause: agr.confirm_policy_clause || '（协议未记录条款依据）' };
  }

  /** 某协议某账期的日历 */
  function calendarOf(S, agreementNo, period) {
    var ver = Engine.routeVersion(S.versions, agreementNo, D.periodEnd(period)) ||
              Engine.routeVersion(S.versions, agreementNo, D.periodStart(period)) ||
              S.versions.filter(function (v) { return v.agreement_no === agreementNo; })[0];
    var rule = (ver && ver.items && ver.items[0] && ver.items[0].settle_day_rule) || {};
    return Billing.calendar(rule, period);
  }

  /** 生成未来 N 个账期的日历（7.2.2：系统按协议版本生成未来 12 个月） */
  function schedule(S, fromPeriod, months) {
    var rows = [], p = fromPeriod;
    for (var i = 0; i < (months || 12); i++) {
      S.agreements.filter(function (a) { return a.status === 'EFFECTIVE'; }).forEach(function (a) {
        var cal = calendarOf(S, a.agreement_no, p);
        var bills = S.bills.filter(function (b) {
          return b.agreement_no === a.agreement_no && b.billing_period === p && b.status !== 'VOIDED';
        });
        rows.push({
          agreement_no: a.agreement_no, partner_no: a.partner_no, period: p, cal: cal,
          policy: confirmPolicy(S, a.agreement_no), bills: bills,
          closed: !!S.eng.closedPeriods[p]
        });
      });
      p = D.nextPeriod(p);
    }
    return rows;
  }

  /** 把一个自然月里所有资金方的里程碑摊到日期上，供月视图渲染 */
  function monthMap(S, ym, months) {
    var byDate = {};
    function put(date, item) {
      if (date.slice(0, 7) !== ym) return;
      (byDate[date] || (byDate[date] = [])).push(item);
    }
    schedule(S, D.prevPeriod(ym), months || 3).forEach(function (r) {
      var p = S.partnerMap[r.partner_no] || {};
      var base = { partner_no: r.partner_no, name: p.partner_short_name, period: r.period, row: r };
      put(r.cal.cutoff_date, Object.assign({ m: MILESTONES.CUTOFF }, base));
      put(r.cal.bill_gen_date, Object.assign({ m: MILESTONES.BILL }, base));
      put(r.cal.confirm_deadline, Object.assign({ m: MILESTONES.CONFIRM }, base));
      put(r.cal.settle_date, Object.assign({ m: MILESTONES.SETTLE }, base));
    });
    return byDate;
  }

  /** 月视图的格子（周一起始，补齐前后空格） */
  function monthGrid(ym) {
    var first = D.parse(ym + '-01');
    var lead = (first.getDay() + 6) % 7;          // 周一 = 0
    var days = D.parse(D.periodEnd(ym)).getDate();
    var cells = [];
    for (var i = 0; i < lead; i++) cells.push(null);
    for (var d = 1; d <= days; d++) cells.push(ym + '-' + Core.pad(d, 2));
    while (cells.length % 7) cells.push(null);
    return cells;
  }

  /* ---------------- 超期未确认（7.4.2） ---------------- */
  /** 已推送但过了确认截止日仍未确认的账单 */
  function overdueBills(S, asOf) {
    var today = asOf || S.simToday;
    return S.bills.filter(function (b) {
      return b.status === 'CONFIRMING' && b.calendar && b.calendar.confirm_deadline < today;
    }).map(function (b) {
      return { bill: b, policy: confirmPolicy(S, b.agreement_no),
        overdueDays: Dispute.workdaysBetween(b.calendar.confirm_deadline, today) };
    });
  }

  /** 即将到期（尚未超期但已进入最后 1 个工作日）的账单，用于提前催办 */
  function dueSoonBills(S, asOf) {
    var today = asOf || S.simToday;
    return S.bills.filter(function (b) {
      return b.status === 'CONFIRMING' && b.calendar &&
        b.calendar.confirm_deadline >= today &&
        Dispute.workdaysBetween(today, b.calendar.confirm_deadline) <= 1;
    });
  }

  global.Cal = {
    MILESTONES: MILESTONES, confirmPolicy: confirmPolicy, calendarOf: calendarOf,
    schedule: schedule, monthMap: monthMap, monthGrid: monthGrid,
    overdueBills: overdueBills, dueSoonBills: dueSoonBills
  };
})(window);
