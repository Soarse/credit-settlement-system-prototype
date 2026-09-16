/* =============================================================================
 * views-scenarios.js —— 可复现验收场景
 * 每个场景从同一份基准数据重置并执行，便于产品、财务与测试复核预期结果。
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, U = UI;
  var last = null;

  function switchRole(role) {
    Store.Actions.setRole(role);
    var sel = document.getElementById('role-select');
    if (sel) sel.value = role;
  }
  function reset(role) {
    Store.Actions.reset();
    switchRole(role || 'FIN_OP');
  }
  function finish(name, ok, facts, link, linkText) {
    last = { name: name, ok: ok, facts: facts, link: link, linkText: linkText };
    App.rerender();
    UI.toast(ok ? '场景执行完成，结果符合预期' : '场景执行异常，请检查结果', ok ? 'ok' : 'danger', name);
  }

  function partialReceipt() {
    reset('FIN_OP');
    var S = Store.get();
    var o = S.settleOrders.filter(function (x) { return x.direction === 'RECEIVE'; })[0];
    o.status = 'WAITING_RECEIPT'; o.settled_amount = 0; o.remaining_amount = o.settle_amount;
    var inb = { inbound_no: 'DEMO_PARTIAL_RECEIPT', amount: 100, value_date: S.simToday,
      status: 'SUSPENSE', settle_nos: [], logs: [], channel_serial_no: 'DEMO-100' };
    S.inbounds.push(inb);
    Store.Actions.claimInbound(inb.inbound_no, [o.settle_no], '验收：仅到账 100 元');
    switchRole('FIN_REVIEW');
    var review = Store.Actions.reviewClaim(inb.inbound_no, true, '验收：复核部分到账');
    var ok = review.ok && o.status === 'PARTIAL_SETTLED' && o.settled_amount === 100 &&
      o.remaining_amount === M.r2(o.settle_amount - 100);
    finish('部分到账续收', ok, [
      ['结算单应收', M.fmt(o.settle_amount) + ' 元'], ['本次实收', M.fmt(o.settled_amount) + ' 元'],
      ['剩余应收', M.fmt(o.remaining_amount) + ' 元'], ['结算单状态', '部分结算，保留续收']
    ], '/settleorder?id=' + o.settle_no, '查看结算单');
  }

  function partialDispute() {
    reset('FIN_OP');
    var S = Store.get(), b = S.bills[0], disputed = 100;
    S.settleOrders = S.settleOrders.filter(function (o) { return o.bill_nos.indexOf(b.bill_no) < 0; });
    S.settleOrderMap = Core.byId(S.settleOrders, 'settle_no');
    S.disputes = S.disputes.filter(function (d) { return d.bill_no !== b.bill_no; });
    b.status = 'CONFIRMED'; b.settle_no = ''; b.settle_nos = []; b.settled_amount = 0;
    Store.Actions.disputeBill(b.bill_no, '验收：仅其中 100 元存在争议', disputed, 'AMOUNT');
    var made = Billing.createSettleOrders(S, b.billing_period);
    var o = made.filter(function (x) { return x.bill_nos.indexOf(b.bill_no) >= 0; })[0];
    var available = M.r2(Math.abs(b.total_amount) - disputed);
    var ok = !!o && o.settle_amount === available;
    finish('部分争议可结算', ok, [
      ['账单总额', M.fmt(b.total_amount) + ' 元'], ['冻结争议额', M.fmt(disputed) + ' 元'],
      ['本次可结算', M.fmt(o ? o.settle_amount : 0) + ' 元'], ['控制结论', '仅冻结争议部分']
    ], o ? '/settleorder?id=' + o.settle_no : '/bills', o ? '查看结算单' : '查看账单');
  }

  function missingFlow() {
    reset('FIN_OP');
    var S = Store.get();
    var flow = S.eng.feeFlows.filter(function (f) {
      return f.billing_period === '2026-03' && (f.flow_type === 'NORMAL' || f.flow_type === 'REVERSAL');
    })[0];
    S.eng.feeFlows = S.eng.feeFlows.filter(function (f) { return f.fee_flow_no !== flow.fee_flow_no; });
    delete S.eng.flowsByNo[flow.fee_flow_no];
    var run = Billing.runTieOut(S, '2026-03');
    S.reconRuns['2026-03'] = run;
    var eqB = run.levels[0].eqs.filter(function (e) { return e.id === 'B'; })[0];
    finish('计费流水缺失拦截', !run.pass && !eqB.ok, [
      ['已计费事件数', String(eqB.right)], ['费用流水事件数', String(eqB.left)],
      ['差异', eqB.detail], ['控制结论', '勾稽失败，阻断后续出账']
    ], '/tieout?period=2026-03', '查看五级勾稽');
  }

  function resultCard() {
    if (!last) return U.alertBox('info', '选择任一场景后，系统会先恢复基准数据，再执行完整业务动作并显示可核对结果。');
    return U.card('最近一次执行结果', h('div', null, [
      U.alertBox(last.ok ? 'ok' : 'danger', '<b>' + Core.esc(last.name) + '：</b>' + (last.ok ? '结果符合预期' : '结果不符合预期')),
      U.kv(last.facts, 'kv-2col'),
      h('div', { class: 'mt14' }, h('button', { class: 'btn btn-primary', onclick: function () { U.goto(last.link); } }, last.linkText))
    ]));
  }

  function scenario(title, desc, expectation, action) {
    return U.card(title, h('div', null, [
      h('p', { class: 'faint' }, desc),
      U.alertBox('info', '<b>验收标准：</b>' + expectation),
      h('button', { class: 'btn btn-primary mt14', onclick: action }, '重置并执行')
    ]));
  }

  UI.route('scenarios', {
    title: '验收场景', crumbs: ['总览', '可复现验收场景'],
    render: function (root) {
      root.appendChild(U.pageHead('可复现验收场景',
        '把高风险业务边界固化为一键场景。每次均从同一基准数据开始，执行结果可直接进入业务页面继续检查。',
        [h('button', { class: 'btn', onclick: function () { reset('FIN_OP'); last = null; App.rerender(); UI.toast('已恢复基准数据', 'ok'); } }, '恢复基准数据')]));
      root.appendChild(h('div', { class: 'grid g3' }, [
        scenario('部分到账续收', '用 100 元到账认领一张大额应收结算单。', '只生成 100 元流水与回单，结算单保留剩余应收。', partialReceipt),
        scenario('部分争议可结算', '对账单中的 100 元登记金额争议。', '冻结 100 元，其余无争议金额仍可生成结算单。', partialDispute),
        scenario('计费流水缺失拦截', '删除一笔已计费事件对应的费用流水。', '事件与流水数量独立核对失败，五级勾稽明确阻断。', missingFlow)
      ]));
      root.appendChild(resultCard());
      root.appendChild(U.card('验收说明', h('div', null, [
        h('p', null, '场景执行会改动当前浏览器内存中的模拟数据，不会写入外部系统。点击“恢复基准数据”即可重新开始。'),
        h('p', { class: 'faint' }, '自动校验还覆盖：金额小数精度、勾稽左右值独立、结算账户 / 结算日 / 币种分组边界。')
      ])));
    }
  });
})();
