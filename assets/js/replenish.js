/* =============================================================================
 * replenish.js —— 模块③ 计费引擎 · 事件完整性核对与回补（PRD 12.1.5 / 10.2 / 10.7.1）
 *
 * 「不允许带着缺口进入计费」——上游漏推一条放款事件，本期就少收一笔钱，
 * 而且这种少收<b>不会自己暴露</b>：账单照样出、勾稽照样平，因为系统压根不知道那条事件存在过。
 * 唯一的发现方式是<b>与上游按日核对事件笔数</b>，差异即拉取回补。
 * ========================================================================== */
(function (global) {
  'use strict';
  var D = Core.D;

  /* 可回补的事件类型（对应 12.1 三条核心上游链路） */
  var REPLENISH_EVENTS = [
    { code: 'EV_DISBURSE_SUCCESS', name: '放款成功', src: '放款系统' },
    { code: 'EV_REPAY_SUCCESS', name: '还款入账成功', src: '还款系统' },
    { code: 'EV_DAILY_BALANCE', name: '日终余额快照', src: '贷款核心' },
    { code: 'EV_DISBURSE_REVERSE', name: '放款撤销', src: '放款系统' },
    { code: 'EV_REFUND', name: '退款', src: '还款系统' }
  ];

  /**
   * 与上游按日核对事件笔数（10.2）。
   * S.upstream 是「上游事实源」的镜像，S.events 是本系统实际收到的。
   * 返回按 日期 × 资金方 × 事件类型 的差异行，只列有缺口的。
   */
  function reconcileCounts(S, from, to, partnerNo) {
    var ours = {}, theirs = {};
    function key(e) { return e.occur_date + '|' + e.partner_no + '|' + e.event_code; }
    function inRange(e) {
      return e.occur_date >= from && e.occur_date <= to && (!partnerNo || e.partner_no === partnerNo);
    }
    S.events.forEach(function (e) { if (inRange(e)) ours[key(e)] = (ours[key(e)] || 0) + 1; });
    (S.upstream || []).forEach(function (e) { if (inRange(e)) theirs[key(e)] = (theirs[key(e)] || 0) + 1; });

    var rows = [];
    Object.keys(theirs).forEach(function (k) {
      var parts = k.split('|');
      var up = theirs[k], mine = ours[k] || 0;
      if (up === mine) return;
      rows.push({ date: parts[0], partner_no: parts[1], event_code: parts[2],
        upstream: up, ours: mine, gap: up - mine });
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    return rows;
  }

  /** 汇总：本区间是否存在缺口 */
  function gapSummary(S, from, to, partnerNo) {
    var rows = reconcileCounts(S, from, to, partnerNo);
    return {
      rows: rows, gapDays: Core.uniq(rows.map(function (r) { return r.date; })).length,
      gapCount: rows.reduce(function (a, r) { return a + r.gap; }, 0),
      partners: Core.uniq(rows.map(function (r) { return r.partner_no; }))
    };
  }

  /**
   * 拉取回补（12.1.5）：按范围从上游拉取全部事件，与已有事件比对，补齐缺失。
   * 已存在的由幂等拦截 —— 所以这个动作<b>可以安全地重复执行</b>。
   * 返回 { pulled, duplicated, replenished, events }
   */
  function pull(S, scope) {
    var from = scope.from, to = scope.to;
    var pool = (S.upstream || []).filter(function (e) {
      return e.occur_date >= from && e.occur_date <= to &&
        (!scope.partner_no || e.partner_no === scope.partner_no) &&
        (!scope.event_code || e.event_code === scope.event_code);
    });
    var missing = pool.filter(function (e) { return !S.eventMap[e.event_id]; });
    return { pulled: pool.length, duplicated: pool.length - missing.length,
      replenished: missing.length, events: missing };
  }

  global.Replenish = {
    REPLENISH_EVENTS: REPLENISH_EVENTS,
    reconcileCounts: reconcileCounts, gapSummary: gapSummary, pull: pull
  };
})(window);
