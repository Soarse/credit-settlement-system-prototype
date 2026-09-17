const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = __dirname;
const context = vm.createContext({
  console,
  Date,
  setTimeout,
  clearTimeout,
  document: { readyState: 'loading', addEventListener() {} }
});
context.window = context;

const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
for (const src of scripts) {
  const fileSrc = src.split('?')[0];
  new vm.Script(fs.readFileSync(path.join(app, fileSrc), 'utf8'), { filename: fileSrc }).runInContext(context);
}

const { Store, Billing, Core, Approval, Guide, FlowGuide, UI } = context;
const results = {};
const failures = [];
function check(name, condition, facts) {
  results[name] = { pass: !!condition, ...facts };
  if (!condition) failures.push(name);
}

// The selectable process guide contains all 30 documented flows plus combined journeys.
{
  const standard = FlowGuide.flows.filter((flow) => /^\d{2}$/.test(flow.id));
  const ids = standard.map((flow) => flow.id);
  const expected = Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0'));
  check('selectableProcessGuides', FlowGuide.flows.length >= 32 && JSON.stringify(ids) === JSON.stringify(expected) &&
      FlowGuide.flows.every((flow) => flow.title && flow.modules && flow.modules.length && flow.steps.length >= 3 &&
        flow.steps.every((step) => step.business && step.operation && step.checkpoint)),
    { totalFlows: FlowGuide.flows.length, standardFlowIds: ids,
      combinedFlows: FlowGuide.flows.filter((flow) => !/^\d{2}$/.test(flow.id)).map((flow) => flow.title) });
}

// The process catalog follows the business lifecycle and covers every flow exactly once.
{
  const categoryFlowIds = FlowGuide.categories.flatMap((category) => category.flowIds);
  const allFlowIds = FlowGuide.flows.map((flow) => flow.id);
  const uniqueCategoryFlowIds = [...new Set(categoryFlowIds)];
  const expectedCategoryNames = ['运营启程与准入建档', '合同条款与规则生效', '业务事件与计费核算',
    '账单确认与发票管理', '资金结算与收付执行', '对账风控与审计闭环', '跨模块综合演练'];
  check('businessClassifiedProcessCatalog', FlowGuide.categories.length === 7 &&
      JSON.stringify(FlowGuide.categories.map((category) => category.name)) === JSON.stringify(expectedCategoryNames) &&
      categoryFlowIds.length === allFlowIds.length && uniqueCategoryFlowIds.length === allFlowIds.length &&
      allFlowIds.every((id) => uniqueCategoryFlowIds.includes(id)) &&
      FlowGuide.flows.every((flow) => flow.categoryId && flow.categoryName && flow.categoryOrder),
    { categoryCount: FlowGuide.categories.length, categoryNames: FlowGuide.categories.map((category) => category.name),
      coveredFlowIds: categoryFlowIds });
}

// The versioned design document stays aligned with the process catalog shown in the prototype.
{
  const designDoc = fs.readFileSync(path.join(app, 'docs', '信贷资方结算系统_30个流程与模块关系说明.md'), 'utf8');
  const improvements = fs.readFileSync(path.join(app, 'IMPROVEMENTS.md'), 'utf8');
  const documentedCategories = FlowGuide.categories.every((category) =>
    designDoc.includes(category.name) && improvements.includes(category.name));
  const documentedFlows = FlowGuide.flows.every((flow) => designDoc.includes(flow.id) && designDoc.includes(flow.title));
  check('processGuideDocumentationSync', documentedCategories && documentedFlows &&
      designDoc.includes('30 个标准业务流程') && designDoc.includes('2 个综合演练'),
    { designDocument: 'docs/信贷资方结算系统_30个流程与模块关系说明.md',
      documentedCategoryCount: FlowGuide.categories.length, documentedFlowCount: FlowGuide.flows.length });
}

// Both guide modes expose the same fixed top-center previous/next controls.
{
  const guideSource = fs.readFileSync(path.join(app, 'assets/js/guide.js'), 'utf8');
  const flowGuideSource = fs.readFileSync(path.join(app, 'assets/js/flow-guide.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(app, 'assets/css/app.css'), 'utf8');
  const htmlSource = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
  check('guideTopNavigation', guideSource.includes("class: 'guide-top-nav'") &&
      flowGuideSource.includes("class: 'guide-top-nav flow-guide-top-nav'") &&
      htmlSource.includes('id="guide-top-controls"') &&
      cssSource.includes('#guide-top-controls {') && cssSource.includes('left: 50%'),
    { noviceGuide: true, processGuide: true, position: 'top-center' });
  check('flowGuideWithoutCatalogButton',
    !flowGuideSource.includes("onclick: backToCatalog }, '← 流程目录'") &&
      !flowGuideSource.includes("onclick: backToCatalog }, '流程目录'"),
    { removedControl: '流程目录' });
}
function eqOf(run, id) {
  return run.levels.flatMap((level) => level.eqs).find((eq) => eq.id === id);
}

// Decimal edge cases that used to be vulnerable to binary floating point rounding.
check('decimalPrecision',
  Core.Money.r2(1.005) === 1.01 && Core.Money.mul(0.1, 0.2, 6) === 0.02,
  { round_1_005: Core.Money.r2(1.005), multiply_0_1_0_2: Core.Money.mul(0.1, 0.2, 6) });

// Every left-nav tab exposes its capabilities while preserving the prototype's canonical names.
{
  const expectedLabels = ['运营监控大盘', '接入 SOP（5 天）', '验收场景', '资金方主数据', '规则中心',
    '计费引擎', '账单中心', '结算中心', '对账中心', '审批中心 · 待办', '告警中心',
    '全链路追溯', '运营与审计', '设计决策 · 说明'];
  const items = UI.NAV.flatMap((group) => group.items);
  check('navigationCapabilityHints', JSON.stringify(items.map((item) => item.label)) === JSON.stringify(expectedLabels) &&
      items.every((item) => Array.isArray(item.capabilities) && item.capabilities.length > 0 && item.note),
    { labels: items.map((item) => item.label), hintedModules: items.length });
}

// The onboarding guide covers the full process and keeps business and system guidance distinct.
{
  const requiredRoutes = ['onboard', 'partners', 'rules', 'charge', 'bills', 'settle', 'approvals', 'claim', 'tieout', 'trace', 'alerts', 'scenarios'];
  const covered = new Set(Guide.steps.map((step) => String(step.route || '').split('?')[0].replace(/^\//, '')));
  check('guidedTourCoverage', Guide.steps.length >= 18 && Guide.steps.every((step) =>
      step.business && step.operation && step.checkpoint) && requiredRoutes.every((route) => covered.has(route)),
    { stepCount: Guide.steps.length, requiredRoutes, coveredRoutes: [...covered] });
}

// Approval audit evidence records a named user, their role and an immutable content version.
{
  const S = Store.init();
  S.role = 'FIN_OP';
  const ap = Approval.create(S, { biz_type: 'SETTLE', biz_key: 'AUDIT_SAMPLE', title: '审批审计样例',
    amount: 200000, reason: '验收具名审批留痕', payload: { sample: true } });
  check('approvalEvidence', !!ap.initiator_user && !!ap.initiator_user_name && ap.initiator_role === 'FIN_OP' &&
      ap.content_version === 1 && !!ap.content_fingerprint && ap.evidence.length === 1,
    { initiator: `${ap.initiator_user_name} / ${ap.initiator_role}`,
      contentVersion: ap.content_version, fingerprint: ap.content_fingerprint,
      evidence: ap.evidence[0] && ap.evidence[0].name });
}

// Baseline application state must still initialize and tie out.
{
  const S = Store.init();
  const run = Billing.runTieOut(S, '2026-03');
  check('baselineTieout', run.pass, { failCount: run.failCount, levels: run.levels });
}

// A charged event without a fee flow must now be detected by an independently sourced right side.
{
  const S = Store.init();
  const e = S.events.find((event) => event.status === 'CHARGED' && event.occur_date.startsWith('2026-03'));
  S.events = [e];
  S.eng.feeFlows = [];
  S.bills = [];
  S.settleOrders = [];
  S.settleFlows = [];
  S.receipts = [];
  const run = Billing.runTieOut(S, '2026-03');
  const b = eqOf(run, 'B');
  check('missingFeeFlow', !run.pass && !b.ok && b.left === 0 && b.right === 1,
    { overallPass: run.pass, equation: b });
}

// Tie-out display must show independent values when a fee flow no longer matches the bill.
{
  const S = Store.init();
  const f = S.eng.feeFlows.find((flow) => flow.billing_period === '2026-03' && flow.bill_no && !flow.is_cross_period);
  f.fee_amount = Core.Money.r2(f.fee_amount + 100);
  const d = eqOf(Billing.runTieOut(S, '2026-03'), 'D');
  check('independentTieoutDisplay', !d.ok && d.left !== d.right,
    { equation: d });
}

// A partial inbound receipt must only settle the money actually received and retain the remainder.
{
  const S = Store.init();
  const o = S.settleOrders.find((order) => order.direction === 'RECEIVE');
  o.status = 'WAITING_RECEIPT';
  o.settled_amount = 0;
  o.remaining_amount = o.settle_amount;
  const inb = {
    inbound_no: 'CHECK_PARTIAL', amount: 100, value_date: S.simToday, status: 'SUSPENSE',
    settle_nos: [], logs: [], channel_serial_no: 'CHECK_ONLY'
  };
  S.inbounds.push(inb);
  S.role = 'FIN_OP';
  const claim = Store.Actions.claimInbound(inb.inbound_no, [o.settle_no], '部分到账');
  S.role = 'FIN_REVIEW';
  const review = Store.Actions.reviewClaim(inb.inbound_no, true, '复核部分到账');
  const flow = review.made && review.made[0] && review.made[0].flow;
  const receipt = review.made && review.made[0] && review.made[0].receipt;
  check('partialReceipt', claim.ok && review.ok && flow.amount === 100 && receipt.amount === 100 &&
      o.status === 'PARTIAL_SETTLED' && o.remaining_amount === Core.Money.r2(o.settle_amount - 100),
    { claimOk: claim.ok, reviewOk: review.ok, expected: o.settle_amount,
      flowAmount: flow && flow.amount, receiptAmount: receipt && receipt.amount,
      orderStatus: o.status, settledAmount: o.settled_amount, remainingAmount: o.remaining_amount,
      inboundStatus: inb.status });
}

// Only the disputed portion is frozen; the undisputed portion remains eligible for settlement.
{
  const S = Store.init();
  const b = S.bills[0];
  S.settleOrders = [];
  S.settleOrderMap = {};
  S.disputes = [];
  b.status = 'CONFIRMED';
  b.settle_no = '';
  b.settle_nos = [];
  b.settled_amount = 0;
  S.role = 'FIN_OP';
  const disputed = 100;
  const dispute = Store.Actions.disputeBill(b.bill_no, '仅其中100元有争议', disputed, 'AMOUNT');
  const made = Billing.createSettleOrders(S, b.billing_period);
  const order = made.find((item) => item.bill_nos.includes(b.bill_no));
  const expected = Core.Money.r2(Math.abs(b.total_amount) - disputed);
  check('partialDispute', !!dispute && !!order && order.settle_amount === expected &&
      order.bill_allocations[0].disputed_amount === disputed,
    { billTotal: b.total_amount, disputedAmount: disputed, expectedSettlement: expected,
      actualSettlement: order && order.settle_amount, billStatus: b.status,
      disputeScope: dispute && dispute.dispute_scope });
}

// Settlement grouping must respect account, settlement date and currency boundaries.
{
  const S = Store.init();
  const originals = S.bills.slice(0, 2).map((bill, i) => ({ ...bill,
    bill_no: `GROUP_${i + 1}`, billing_period: '2026-03', partner_no: S.bills[0].partner_no,
    agreement_no: S.bills[0].agreement_no, direction: 'RECEIVABLE', status: 'CONFIRMED',
    total_amount: 1000, current_period_amount: 1000, adjustment_amount: 0, carry_forward_amount: 0,
    settled_amount: 0, settle_no: '', settle_nos: [], currency: i ? 'USD' : 'CNY',
    calendar: { ...S.bills[0].calendar, settle_date: '2026-04-15' }
  }));
  S.bills = originals;
  S.billMap = Object.fromEntries(originals.map((bill) => [bill.bill_no, bill]));
  S.settleOrders = [];
  S.settleOrderMap = {};
  S.disputes = [];
  const made = Billing.createSettleOrders(S, '2026-03');
  check('settlementBoundary', made.length === 2 && new Set(made.map((o) => o.currency)).size === 2,
    { orderCount: made.length, scopes: made.map((o) => o.settlement_scope) });
}

fs.writeFileSync(path.join(app, 'review-results.json'), JSON.stringify({ failures, results }, null, 2));
console.log(JSON.stringify({ failures, results }, null, 2));
process.exitCode = failures.length ? 1 : 0;
