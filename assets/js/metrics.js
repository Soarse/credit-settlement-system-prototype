/* =============================================================================
 * metrics.js —— 对账中心 · 资损监控指标（PRD 9.6）
 *
 * 六个指标不是「运营看板上的数字」，而是<b>资损的六个入口</b>：
 * 每一个为真，都意味着钱可能已经算错、少收、多付或收不回来。
 * 所以每个指标都带阈值与级别，越线即产生告警，而不是等人去看。
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  /* ---------------- 指标定义（9.6） ---------------- */
  var METRICS = [
    { code: 'TIE_BREAK', name: '勾稽不平', unit: '项',
      why: '五级勾稽任一等式不成立，意味着上下游对不上 —— 钱可能已经算错',
      warn: 1, crit: 1, level: 'P0', block: '阻断出账',
      fmt: function (v) { return v + ' 项'; },
      ref: '9.1' },
    { code: 'EVENT_BACKLOG', name: '事件未计费积压', unit: '条',
      why: '事件已接收但未达终态，本期就会少算 —— 积压带进封账即形成缺口',
      warn: 1, crit: 50, level: 'P1', block: '阻断封账',
      fmt: function (v) { return v + ' 条'; },
      ref: '6.2 / 7.2.3' },
    { code: 'REVERSAL_RATE', name: '冲正率', unit: '%',
      why: '冲正率异常升高通常不是业务波动，而是上游数据或规则口径出了问题',
      warn: 0.05, crit: 0.1, level: 'P1', block: '触发口径复核',
      fmt: function (v) { return M.pct(v, 2); }, pct: true,
      ref: '6.7' },
    { code: 'DIFF_AGING', name: '差异老化', unit: '天',
      why: '差异单越拖越难查 —— 相关人记不清、上游日志已归档，最终只能协商了事',
      warn: 5, crit: 10, level: 'P1', block: '升级处理',
      fmt: function (v) { return v + ' 天'; },
      ref: '9.4' },
    { code: 'SETTLE_FAIL', name: '结算失败率', unit: '%',
      why: '失败率升高往往指向账户信息、限额或通道问题，放任不管会累积成大额未付',
      warn: 0.05, crit: 0.15, level: 'P1', block: '核查通道与账户',
      fmt: function (v) { return M.pct(v, 2); }, pct: true,
      ref: '8.5' },
    { code: 'RECEIPT_MISSING', name: '回单缺失', unit: '笔',
      why: '结算成功但没有回单，L4→L5 勾稽就无法完成 —— 钱付出去了却证明不了',
      warn: 1, crit: 1, level: 'P0', block: '阻断勾稽闭环',
      fmt: function (v) { return v + ' 笔'; },
      ref: '8.7.3' }
  ];
  var BY_CODE = {};
  METRICS.forEach(function (m) { BY_CODE[m.code] = m; });

  /* ---------------- 单个指标在某一天的取值 ---------------- */
  function valueAt(S, code, asOf) {
    switch (code) {
      case 'TIE_BREAK': {
        var bad = 0, amt = 0;
        Object.keys(S.reconRuns).forEach(function (p) {
          if (D.periodEnd(p) > asOf) return;
          var run = S.reconRuns[p];
          (run.levels || []).forEach(function (l) {
            if (l.skipped) return;
            l.eqs.forEach(function (e) {
              if (!e.ok) { bad++; amt += Math.abs((+e.left || 0) - (+e.right || 0)); }
            });
          });
        });
        return { value: bad, amount: M.r2(amt) };
      }
      case 'EVENT_BACKLOG': {
        var n = S.events.filter(function (e) {
          return e.occur_date <= asOf && (e.status === 'PENDING' || e.status === 'FAILED' || e.status === 'PROCESSING');
        }).length;
        return { value: n, amount: 0 };
      }
      case 'REVERSAL_RATE': {
        var period = D.period(asOf);
        var flows = S.eng.feeFlows.filter(function (f) {
          return f.billing_period === period && f.fee_date <= asOf;
        });
        var normal = M.sum(flows.filter(function (f) { return f.fee_amount > 0; }), function (f) { return f.fee_amount; });
        var rev = Math.abs(M.sum(flows.filter(function (f) { return f.flow_type === 'REVERSAL'; }), function (f) { return f.fee_amount; }));
        return { value: normal ? rev / normal : 0, amount: M.r2(rev) };
      }
      case 'DIFF_AGING': {
        var open = S.diffs.filter(function (d) {
          return d.create_time.slice(0, 10) <= asOf && (d.status !== 'CLOSED' || (d.close_time || '9999').slice(0, 10) > asOf);
        });
        var mx = 0, sum = 0;
        open.forEach(function (d) {
          var age = D.diffDays(d.create_time.slice(0, 10), asOf);
          mx = Math.max(mx, age); sum += Math.abs(d.diff_amount || 0);
        });
        return { value: mx, amount: M.r2(sum), count: open.length };
      }
      case 'SETTLE_FAIL': {
        var ins = [];
        S.settleOrders.forEach(function (o) {
          if (o.plan_settle_date > asOf) return;
          o.instructions.forEach(function (i) { ins.push(i); });
        });
        var bad2 = ins.filter(function (i) {
          return i.status === 'FAILED' || i.status === 'UNKNOWN' || i.status === 'RETURNED';
        });
        return { value: ins.length ? bad2.length / ins.length : 0,
          amount: M.r2(M.sum(bad2, function (i) { return i.amount; })), count: ins.length };
      }
      case 'RECEIPT_MISSING': {
        var miss = S.settleFlows.filter(function (f) {
          return f.settle_date <= asOf && f.status === 'SUCCESS' && !f.receipt_no;
        });
        return { value: miss.length, amount: M.r2(M.sum(miss, function (f) { return f.amount; })) };
      }
    }
    return { value: 0, amount: 0 };
  }

  /* ---------------- 状态判定 ---------------- */
  function statusOf(m, v) {
    if (v >= m.crit) return { code: 'CRIT', name: '超阈值', cls: 'danger', icon: '✕', level: m.level };
    if (v >= m.warn) return { code: 'WARN', name: '接近阈值', cls: 'warn', icon: '!', level: 'P2' };
    return { code: 'OK', name: '正常', cls: 'ok', icon: '✓', level: '' };
  }

  /** 当前快照：六个指标的当日值、状态、金额 */
  function snapshot(S, asOf) {
    var day = asOf || S.simToday;
    return METRICS.map(function (m) {
      var r = valueAt(S, m.code, day);
      return { metric: m, date: day, value: r.value, amount: r.amount, count: r.count,
        status: statusOf(m, r.value) };
    });
  }

  /** 近 N 个业务日的序列 */
  function series(S, code, days, endDate) {
    var m = BY_CODE[code];
    var end = endDate || S.simToday;
    var out = [];
    for (var i = (days || 30) - 1; i >= 0; i--) {
      var d = D.addDays(end, -i);
      var r = valueAt(S, code, d);
      out.push({ date: d, label: d.slice(5), axis: d.slice(8), value: r.value,
        amount: r.amount, breach: r.value >= m.crit });
    }
    return out;
  }

  global.Metrics = {
    METRICS: METRICS, BY_CODE: BY_CODE,
    valueAt: valueAt, statusOf: statusOf, snapshot: snapshot, series: series
  };
})(window);
