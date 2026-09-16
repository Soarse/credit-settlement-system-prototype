/* =============================================================================
 * views-bill.js —— 模块④ 账单中心：出账工作台、账单列表、账单详情（四级下钻）
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  function subnav(active) {
    var items = [['workbench', '出账工作台'], ['prebill', '预出账'], ['calendar', '出账日历'], ['bills', '账单列表'],
      ['adjustments', '调整项'], ['invoices', '发票管理'], ['disputes', '争议工作台']];
    return h('div', { class: 'btn-row', style: 'margin-bottom:14px' }, items.map(function (i) {
      return h('button', { class: 'btn btn-sm' + (i[0] === active ? ' btn-primary' : ''), onclick: function () { U.goto('/' + i[0]); } }, i[1]);
    }));
  }

  /* ================= 出账工作台 ================= */
  UI.route('workbench', {
    title: '出账工作台', crumbs: ['模块④', '账单中心', '出账工作台'],
    render: function (root) {
      var S = Store.get();
      root.appendChild(U.pageHead('出账工作台',
        '「月末出账 5 天 → 3 小时」的落点：把计算工作前置分摊到每日 T+1 核算，月末只做<b>汇总 + 校验 + 生成凭证</b>。<b>勾稽不平不得出账</b>。'));
      root.appendChild(subnav('workbench'));

      Data.PERIODS.forEach(function (period) {
        var closed = !!S.eng.closedPeriods[period];
        var bills = S.bills.filter(function (b) { return b.billing_period === period && b.status !== 'VOIDED'; });
        var flows = S.eng.feeFlows.filter(function (f) { return f.billing_period === period; });
        var groups = {};
        flows.forEach(function (f) { if (f.is_cross_period === 0) groups[f.partner_no + '|' + f.agreement_no + '|' + f.direction] = 1; });

        var actions = [];
        if (!closed) actions.push(h('button', {
          class: 'btn btn-primary', disabled: !Store.can('bill.generate'),
          onclick: function () {
            var r = Store.Actions.closePeriod(period);
            if (!r.ok) U.modal('封账被阻断', h('div', null, [
              U.alertBox('danger', '任一校验失败则阻断封账。封账不可逆，若封账后发现需要补录事件，只能通过跨期调整（D-06）或范围重算处理。'),
              h('ul', null, r.blockers.map(function (b) { return h('li', null, b); }))
            ]), [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'narrow' });
            else { UI.toast('封账完成，生成周期性流水（阶梯找平 / 保底封顶）' + r.produced.length + ' 条', 'ok', period + ' 已封账'); App.rerender(); }
          }
        }, '① 封账'));
        else if (!bills.length) actions.push(h('button', {
          class: 'btn btn-primary', disabled: !Store.can('bill.generate'),
          onclick: function () {
            var made = Store.Actions.generateBills(period);
            var blocked = made.filter(function (m) { return m.blocked; });
            if (blocked.length) U.modal('出账被阻断', h('div', null, blocked.map(function (b) {
              return U.card(b.partnerNo + ' · ' + b.agreementNo + ' · ' + b.direction, U.checklist(b.check.checks), { tight: true });
            })), [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'wide' });
            else UI.toast('已生成 ' + made.length + ' 张账单', 'ok', period + ' 出账完成');
            App.rerender();
          }
        }, '② 出账'));

        var pending = S.events.filter(function (e) { return D.period(e.occur_date) === period && ['PENDING', 'PROCESSING', 'FAILED'].indexOf(e.status) >= 0; });
        root.appendChild(U.card('账期 ' + period + (closed ? '（已封账）' : '（待封账）'), h('div', null, [
          h('div', { class: 'grid g4 mb8' }, [
            U.stat('费用流水', M.fmt(flows.length, 0)),
            U.stat('待出账组合', Object.keys(groups).length - bills.length, '资金方 × 协议 × 方向'),
            U.stat('已生成账单', bills.length, '', bills.length ? 'ok' : ''),
            U.stat('未达终态事件', pending.length, pending.length ? '阻断封账' : '队列已清空', pending.length ? 'danger' : 'ok')
          ]),
          h('div', { class: 'btn-row' }, actions.concat([
            h('button', { class: 'btn', onclick: function () { U.goto('/prebill?p=' + period); } }, '⓪ 预出账'),
            h('button', { class: 'btn', onclick: function () { U.goto('/bills?period=' + period); } }, '查看账单'),
            h('button', { class: 'btn', onclick: function () { U.goto('/tieout?period=' + period); } }, '五级勾稽')
          ])),
          closed ? null : h('div', { class: 'mt8' }, U.alertBox('warn',
            '封账前先走一遍<b>预出账</b>：出账日才发现缺快照、事件卡住、调整项没批，补数 + 重算 + 复核压不进 3 小时；' +
            '账期中发现还有时间修。预出账不落库、不占账单号，随便跑。')),
          closed ? null : h('div', { class: 'mt8' }, U.alertBox('info',
            '<b>封账时执行：</b>① 校验该账期所有事件已处理完毕 ② 校验日终快照已到齐 ③ 校验日度勾稽通过 ④ 生成 EV_PERIOD_CLOSE 触发阶梯找平/保底封顶 ⑤ 锁定账期。'))
        ]), { ref: '7.2.3 / 7.3' }));

        bills.forEach(function (b) {
          root.appendChild(U.card('出账前置校验 · ' + b.bill_no, U.checklist(b.checks || []), { tight: true, ref: '7.3.5' }));
        });
      });

      root.appendChild(U.card('月末出账结算流程（3 小时）', U.table([
        { label: '时段', key: 't', width: '130px' }, { label: '动作', key: 'a' }, { label: '耗时', key: 'c', width: '70px' }, { label: '说明', key: 'd' }
      ], [
        { t: 'T+1 00:00–00:30', a: '封账', c: '30 min', d: '校验事件清零、快照到齐、日度勾稽通过；生成 EV_PERIOD_CLOSE' },
        { t: '00:30–01:00', a: '周期性计费', c: '30 min', d: '阶梯找平、保底封顶、日均基数计算' },
        { t: '01:00–01:30', a: '账单生成', c: '30 min', d: '按资金方 × 协议 × 方向汇总，含调整项与结转' },
        { t: '01:30–02:00', a: '出账前置校验', c: '30 min', d: 'V-B01~B10；L2→L3 勾稽等式 D~H；不通过则阻断' },
        { t: '02:00–02:30', a: '内部复核', c: '30 min', d: '环比波动、大额调整项、负金额账单' },
        { t: '02:30–03:00', a: '推送资金方', c: '30 min', d: '账单 + 明细 + 口径说明' }
      ], { compact: true }), { tight: true, ref: '10.3' }));
    }
  });

  /* ================= 账单列表 ================= */
  UI.route('bills', {
    title: '账单列表', crumbs: ['模块④', '账单中心', '账单列表'],
    render: function (root, params) {
      var S = Store.get();
      var f = { period: params.period || '', status: params.status || '', partner: '', dir: '' };
      var box = h('div');
      root.appendChild(U.pageHead('账单中心',
        '账单是<b>内部计算结果</b>与<b>外部商务确认</b>之间的界面。账单一经资金方确认即成为具有商务约束力的凭证 —— 这是 D-06「已确认账单不重开」的根本原因。'));
      root.appendChild(subnav('bills'));
      root.appendChild(h('div', { class: 'filters' }, [
        U.field('账期', U.selectEl([{ value: '', label: '全部' }, { value: '2026-03', label: '2026-03' }, { value: '2026-04', label: '2026-04' }], f.period, function (v) { f.period = v; draw(); })),
        U.field('状态', U.selectEl([{ value: '', label: '全部' }].concat(['GENERATED', 'CONFIRMING', 'CONFIRMED', 'DISPUTED', 'PARTIAL_SETTLED', 'ADJUSTED', 'SETTLED', 'VOIDED'].map(function (s) { return { value: s, label: U.statusText(s) }; })), f.status, function (v) { f.status = v; draw(); })),
        U.field('资金方', U.selectEl([{ value: '', label: '全部' }].concat(S.partners.map(function (p) { return { value: p.partner_no, label: p.partner_short_name }; })), '', function (v) { f.partner = v; draw(); })),
        U.field('方向', U.selectEl([{ value: '', label: '全部' }, { value: 'RECEIVABLE', label: '应收' }, { value: 'PAYABLE', label: '应付' }], '', function (v) { f.dir = v; draw(); }))
      ]));
      root.appendChild(box);
      function draw() {
        box.innerHTML = '';
        var rows = S.bills.filter(function (b) {
          return (!f.period || b.billing_period === f.period) && (!f.status || b.status === f.status) &&
            (!f.partner || b.partner_no === f.partner) && (!f.dir || b.direction === f.dir);
        });
        box.appendChild(U.card(null, U.table([
          { label: '账单号', render: function (b) { return U.link(b.bill_no, '/bill/' + b.bill_no, 'mono'); } },
          { label: '资金方', render: function (b) { return (S.partnerMap[b.partner_no] || {}).partner_short_name; } },
          { label: '账期', key: 'billing_period', width: '80px' },
          { label: '方向', render: function (b) { return U.dirBadge(b.direction); }, width: '60px' },
          { label: '本期费用', num: true, render: function (b) { return U.money(b.current_period_amount); } },
          { label: '调整项', num: true, render: function (b) { return U.money(b.adjustment_amount, { signed: true }); } },
          { label: '上期结转', num: true, render: function (b) { return M.fmt(b.carry_forward_amount); } },
          { label: '应结金额', num: true, render: function (b) { return h('b', null, M.fmt(b.total_amount)); } },
          { label: '已结 / 争议', num: true, render: function (b) {
            var disputed = M.sum(S.disputes.filter(function (d) { return d.bill_no === b.bill_no && d.status !== 'CLOSED' && d.status !== 'REJECTED'; }), function (d) { return Math.abs(d.disputed_amount || 0); });
            return M.fmt(b.settled_amount || 0) + ' / ' + M.fmt(disputed);
          } },
          { label: '不含税 / 税额', num: true, render: function (b) { return M.fmt(b.total_amount_ex_tax) + ' / ' + M.fmt(b.total_tax_amount); } },
          { label: '轧差', render: function (b) { return b.join_netting ? U.badge('参与', 'purple') : '—'; }, width: '60px' },
          { label: '状态', render: function (b) { return U.statusBadge(b.status); }, width: '90px' },
          { label: '结算单', render: function (b) { return b.settle_no ? U.link(b.settle_no, '/settleorder/' + b.settle_no, 'mono') : '—'; } }
        ], rows, { onRow: function (b) { U.goto('/bill/' + b.bill_no); }, empty: '该账期尚未出账，请前往「出账工作台」' }), { tight: true }));
      }
      draw();
      root.appendChild(U.card('账单状态机', h('pre', { class: 'code' },
        '待出账 PENDING ──出账──▶ 已生成 GENERATED ──推送──▶ 待确认 CONFIRMING\n' +
        '                                                        │\n' +
        '                        资金方确认 ◀───────────────────┴──────────▶ 资金方提异议\n' +
        '                            ▼                                          ▼\n' +
        '                      已确认 CONFIRMED ──结算完成──▶ 已结算 SETTLED   争议中 DISPUTED\n\n' +
        'CONFIRMED 是不可逆的分界点：一旦资金方确认，账单金额即固化，\n' +
        '所有后续变化通过下期调整项体现，永不修改已确认账单。'), { ref: '7.4' }));
    }
  });

  /* ================= 账单详情（四级下钻） ================= */
  UI.route('bill', {
    title: '账单详情', crumbs: ['模块④', '账单中心', '账单详情'],
    render: function (root, params) {
      var S = Store.get();
      var b = S.billMap[params.id];
      if (!b) { root.appendChild(U.alertBox('danger', '未找到账单 ' + params.id)); return; }
      var partner = S.partnerMap[b.partner_no];
      var adjs = S.adjustments.filter(function (a) { return a.bill_no === b.bill_no; });

      var acts = [];
      if (b.status === 'GENERATED') acts.push(h('button', { class: 'btn btn-primary', onclick: function () { Store.Actions.pushBill(b.bill_no); UI.toast('账单已推送（文件 + 接口）', 'ok'); App.rerender(); } }, '推送资金方'));
      if (b.status === 'CONFIRMING') {
        acts.push(h('button', { class: 'btn btn-ok', onclick: function () { Store.Actions.confirmBill(b.bill_no); UI.toast('资金方已确认，凭据已归档', 'ok'); App.rerender(); } }, '登记资金方确认'));
        acts.push(h('button', { class: 'btn btn-danger', onclick: function () { Store.Actions.disputeBill(b.bill_no, '资金方对本期金额有异议', b.total_amount * 0.02); UI.toast('已登记争议单，SLA T+5', 'warn'); App.rerender(); } }, '登记争议'));
      }
      var voidAp = Approval.pendingFor(S, 'BILL_VOID', b.bill_no);
      if (['GENERATED', 'CONFIRMING'].indexOf(b.status) >= 0 && !voidAp) {
        acts.push(h('button', {
          class: 'btn', disabled: !Store.can('approval.submit'),
          onclick: function () {
            var r = Store.Actions.submitBillVoid(b.bill_no, '人工作废重出');
            UI.toast('账单作废需财务复核审批（敏感操作，需二次验证）', 'warn', r.approval.approval_no);
            App.rerender();
          }
        }, '申请作废重出'));
      }
      if (voidAp) acts.push(h('button', { class: 'btn', onclick: function () { ViewsApproval.openApproval(voidAp); } }, '作废审批中 · ' + voidAp.approval_no));
      acts.push(h('button', { class: 'btn', onclick: function () { U.goto('/trace?q=' + b.bill_no); } }, '全链路追溯'));

      root.appendChild(U.pageHead('账单 ' + b.bill_no,
        partner.partner_short_name + ' ｜ ' + b.agreement_no + ' ｜ ' + D.cnPeriod(b.billing_period) + ' ｜ ' +
        (b.direction === 'RECEIVABLE' ? '应收' : '应付'), acts));

      root.appendChild(h('div', { class: 'grid g-2-1' }, [
        (function () {
          var led = h('div', { class: 'ledger' });
          led.appendChild(h('div', { class: 'lsec' }, '本期费用'));
          b.details.forEach(function (d) {
            led.appendChild(h('div', { class: 'lrow sub' }, [h('span', null, d.charge_item_name + '（' + d.flow_count + ' 笔）'), h('span', null, M.fmt(d.amount))]));
          });
          led.appendChild(h('div', { class: 'lsep' }));
          led.appendChild(h('div', { class: 'lrow' }, [h('span', null, '小计'), h('span', null, M.fmt(b.current_period_amount))]));
          led.appendChild(h('div', { class: 'lsec' }, '调整项'));
          if (adjs.length) adjs.forEach(function (a) {
            led.appendChild(h('div', { class: 'lrow sub' }, [h('span', null, a.reason), h('span', { class: a.amount < 0 ? 'neg' : '' }, M.fmt(a.amount))]));
          }); else led.appendChild(h('div', { class: 'lrow sub' }, [h('span', null, '（无）'), h('span', null, '0.00')]));
          led.appendChild(h('div', { class: 'lsep' }));
          led.appendChild(h('div', { class: 'lrow' }, [h('span', null, '小计'), h('span', { class: b.adjustment_amount < 0 ? 'neg' : '' }, M.fmt(b.adjustment_amount))]));
          led.appendChild(h('div', { class: 'lrow lsec' }, [h('span', null, '上期结转'), h('span', null, M.fmt(b.carry_forward_amount))]));
          led.appendChild(h('div', { class: 'ldbl' }));
          led.appendChild(h('div', { class: 'lrow ltotal' }, [h('span', null, '应结金额（含税）'), h('span', null, M.fmt(b.total_amount))]));
          led.appendChild(h('div', { class: 'lrow sub' }, [h('span', null, '其中：不含税'), h('span', null, M.fmt(b.total_amount_ex_tax))]));
          led.appendChild(h('div', { class: 'lrow sub' }, [h('span', null, '　　　税额'), h('span', null, M.fmt(b.total_tax_amount))]));
          return U.card('账单构成：应结金额 = 本期费用 + 调整项 + 上期结转', led, { ref: '7.3.2' });
        })(),
        U.card('账单信息', U.kv([
          ['状态', U.statusBadge(b.status)],
          ['账期起止', b.period_start + ' ~ ' + b.period_end],
          ['封账日', b.calendar.cutoff_date], ['出账日', b.calendar.bill_gen_date],
          ['确认截止', b.calendar.confirm_deadline], ['结算日', b.calendar.settle_date],
          ['推送时间', b.push_time ? b.push_time.replace('T', ' ').slice(0, 16) : '—'],
          ['确认时间', b.confirm_time ? b.confirm_time.replace('T', ' ').slice(0, 16) : '—'],
          ['确认人 / 凭据', b.confirm_user ? b.confirm_user : '—'],
          ['结算单', b.settle_no ? U.link(b.settle_no, '/settleorder/' + b.settle_no, 'mono') : '—'],
          ['对账状态', b.recon_status]
        ]), { ref: '7.2' })
      ]));

      /* 四级下钻 */
      root.appendChild(h('h3', { class: 'sec' }, ['账单明细与四级下钻', h('span', { class: 'tag-ref' }, '7.3.4')]));
      root.appendChild(U.alertBox('info', '账单 → 明细 → 费用流水 → 业务事件 / 基数快照。资金方对任何一个数字提出疑问，都必须能在界面上点到最底层的原始事件与基数来源。'));
      b.details.forEach(function (d) {
        var fs = S.eng.feeFlows.filter(function (x) { return x.bill_no === b.bill_no && x.charge_item_no === d.charge_item_no; });
        root.appendChild(U.card(d.charge_item_no + ' ' + d.charge_item_name + ' · ' + M.fmt(d.amount) + '（' + d.flow_count + ' 笔）',
          U.pagedTable([
            { label: '流水号', render: function (x) { return h('span', { class: 'mono', style: 'font-size:11px' }, x.fee_flow_no); } },
            { label: '归属日', key: 'fee_date', width: '90px' },
            { label: '计费对象', render: function (x) { return h('span', { class: 'mono' }, x.charge_object_id); } },
            { label: '基数', num: true, render: function (x) { return M.fmt(x.basis_amount); } },
            { label: '费率版本', key: 'rule_version', width: '60px' },
            { label: '费用（含税）', num: true, render: function (x) { return U.money(x.fee_amount); } },
            { label: '不含税', num: true, render: function (x) { return M.fmt(x.fee_amount_ex_tax); } },
            { label: '税额', num: true, render: function (x) { return M.fmt(x.tax_amount); } },
            { label: '类型', render: function (x) { return U.badge(({ NORMAL: '正常', REVERSAL: '红冲', TIER_TRUEUP: '找平', FLOOR_ADJUST: '保底' })[x.flow_type] || x.flow_type, x.flow_type === 'NORMAL' ? '' : 'purple'); } }
          ], fs, { compact: true, pageSize: 10, onRow: function (x) { ViewsCharge.showFlow(x); } }),
          { tight: true }));
      });

      var applies = S.invoiceApplies.filter(function (a) { return a.bill_no === b.bill_no; });
      var ivActs = [];
      if (applies.length) ivActs.push(h('button', { class: 'btn btn-sm', onclick: function () { U.goto('/invoices?apply=' + applies[0].apply_no); } }, '查看开票申请'));
      else if (['CONFIRMED', 'ADJUSTED', 'SETTLED'].indexOf(b.status) >= 0) {
        ivActs.push(h('button', {
          class: 'btn btn-sm btn-primary', disabled: !Store.can('invoice.apply'),
          onclick: function () {
            var r = Store.Actions.createInvoiceApply(b.bill_no);
            if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
            UI.toast('已生成 ' + r.applies.length + ' 张开票申请', 'ok'); App.rerender();
          }
        }, '生成开票申请'));
      }
      root.appendChild(U.card('价税分离与开票（D-08）', h('div', null, [
        U.table([
          { label: '项', key: 'k' }, { label: '金额', key: 'v', num: true }
        ], [
          { k: '含税金额 total_amount', v: M.fmt(b.total_amount) },
          { k: '不含税 = 含税 ÷ (1 + 税率)，舍入至分', v: M.fmt(b.total_amount_ex_tax) },
          { k: '税额 = 含税 − 不含税（倒轧，保证三者恒等）', v: M.fmt(b.total_tax_amount) }
        ], { compact: true }),
        U.alertBox(M.r2(b.total_amount_ex_tax + b.total_tax_amount) === M.r2(b.total_amount) ? 'ok' : 'danger',
          '等式 H 校验：' + M.fmt(b.total_amount_ex_tax) + ' + ' + M.fmt(b.total_tax_amount) + ' = ' + M.fmt(M.r2(b.total_amount_ex_tax + b.total_tax_amount)) +
          '，与含税金额 ' + M.fmt(b.total_amount) + ' ' + (M.r2(b.total_amount_ex_tax + b.total_tax_amount) === M.r2(b.total_amount) ? '恒等 ✓' : '不等 ✗')),
        applies.length
          ? h('div', { class: 'mt8' }, U.table([
              { label: '开票申请', render: function (a) { return h('span', { class: 'mono', style: 'font-size:11px' }, a.apply_no); } },
              { label: '票种', render: function (a) { return U.badge(a.kind === 'RED' ? '红字' : '蓝字', a.kind === 'RED' ? 'danger' : 'info'); }, width: '60px' },
              { label: '销方 → 购方', render: function (a) { return a.seller.title + ' → ' + a.buyer.title; } },
              { label: '价税合计', num: true, render: function (a) { return h('span', { class: a.amount < 0 ? 'neg' : '' }, M.fmt(a.amount)); } },
              { label: '发票号码', render: function (a) { return a.invoice_no ? h('span', { class: 'mono' }, a.invoice_no) : '—'; }, width: '95px' },
              { label: '状态', render: function (a) { return U.badge(Invoice.STATUS_META[a.status].name, Invoice.STATUS_META[a.status].cls); }, width: '120px' },
              { label: '', width: '60px', render: function (a) {
                return h('button', { class: 'btn btn-sm', onclick: function () { U.goto('/invoices?apply=' + a.apply_no); } }, '详情');
              } }
            ], applies, { compact: true }))
          : U.alertBox('info', ['CONFIRMED', 'ADJUSTED', 'SETTLED'].indexOf(b.status) >= 0
              ? '该账单尚未生成开票申请，可在右上角发起。'
              : '<b>账单经资金方确认后才自动生成开票申请</b>（7.8.2）—— 未确认就开票，一旦争议调整就要走红冲。'),
        U.alertBox('info', '<b>轧差只影响资金划付，不影响开票金额</b>：应收与应付各自按全额开票，银行按净额划转（7.8.4）。')
      ]), { ref: '7.8', actions: ivActs }));
    }
  });

  /* ================= 调整项 ================= */
  UI.route('adjustments', {
    title: '调整项', crumbs: ['模块④', '账单中心', '调整项'],
    render: function (root) {
      var S = Store.get();
      root.appendChild(U.pageHead('调整项管理 bill_adjustment',
        '来源分类：跨期冲正（D-06 自动）、重算差额、争议调整、协商减免、对账差异结论、结转冲抵。手工录入的减免必须关联商务依据文件；单笔 &gt; 10 万需财务负责人 + 业务负责人双审批。'));
      root.appendChild(subnav('adjustments'));
      root.appendChild(h('div', { class: 'btn-row mb8' }, [
        h('button', {
          class: 'btn btn-primary', disabled: !Store.can('adjustment.create'),
          onclick: openAdjForm
        }, '＋ 新增调整项（协商减免）'),
        h('button', { class: 'btn', onclick: function () { U.goto('/approvals'); } }, '审批中心'),
        h('span', { class: 'faint' }, '手工调整项必须关联商务依据；单笔 > 10 万元需财务负责人 + 业务负责人双审批')
      ]));
      root.appendChild(U.card(null, U.table([
        { label: '调整项号', render: function (a) { return h('span', { class: 'mono' }, a.adjustment_no); } },
        { label: '归属账单', render: function (a) { return a.bill_no ? U.link(a.bill_no, '/bill/' + a.bill_no, 'mono') : h('span', { class: 'faint' }, '待归集'); } },
        { label: '资金方', render: function (a) { return (S.partnerMap[a.partner_no] || {}).partner_short_name; } },
        { label: '结算账期', key: 'settle_in_period', width: '85px' },
        { label: '来源', render: function (a) { return U.badge(({ CROSS_PERIOD_REVERSAL: '跨期冲正', RECALC_DIFF: '重算差额', DISPUTE_ADJUST: '争议调整', DISCOUNT: '协商减免', RECON_ADJUST: '差异处理', CARRY_OFFSET: '结转冲抵' })[a.source_type] || a.source_type, 'info'); } },
        { label: '来源账期', key: 'origin_period', width: '85px' },
        { label: '来源引用', render: function (a) { return h('span', { class: 'mono faint', style: 'font-size:11px' }, a.origin_ref || '—'); } },
        { label: '金额', num: true, render: function (a) { return U.money(a.amount, { signed: true }); } },
        { label: '原因', key: 'reason' },
        { label: '状态', render: function (a) {
          var ap = Approval.findByBiz(S, 'ADJUSTMENT', a.adjustment_no);
          return h('span', null, [U.statusBadge(a.status), ap && ap.status === 'PENDING' ? U.badge('审批中', 'warn') : null]);
        } },
        { label: '', width: '110px', render: function (a) {
          var ap = Approval.pendingFor(S, 'ADJUSTMENT', a.adjustment_no);
          if (ap) return h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); ViewsApproval.openApproval(ap); } }, '查看审批');
          if (a.status === 'APPROVED') return h('span', { class: 'faint' }, '—');
          return h('button', {
            class: 'btn btn-sm btn-primary', disabled: !Store.can('approval.submit'),
            onclick: function (e) {
              e.stopPropagation();
              var r = Store.Actions.submitAdjustmentApproval(a.adjustment_no);
              if (!r.ok) { UI.toast(r.msg, 'warn'); return; }
              UI.toast('审批链路：' + r.approval.chain.map(function (s) { return s.role_name; }).join(' → '), 'ok', r.approval.approval_no);
              App.rerender();
            }
          }, '提交审批');
        } }
      ], S.adjustments, { compact: true, empty: '暂无调整项' }), { tight: true, ref: '7.6' }));

      function openAdjForm() {
        var a = { partner_no: S.partners[0].partner_no, agreement_no: '', direction: 'RECEIVABLE',
          settle_in_period: '2026-04', source_type: 'DISCOUNT', amount: 0, reason: '', evidence: '' };
        var body = h('div', null, [
          U.alertBox('warn', '手工录入的调整项（协商减免）必须<b>关联商务依据文件</b>；单笔调整金额 > 10 万元需<b>财务负责人 + 业务负责人</b>双审批；调整项一经账单生成即冻结，不可修改（需修改则在下期再调）。'),
          h('div', { class: 'grid g2' }, [
            U.field('资金方', U.selectEl(S.partners.map(function (p) { return { value: p.partner_no, label: p.partner_short_name }; }),
              a.partner_no, function (v) { a.partner_no = v; })),
            U.field('结算账期', U.selectEl([{ value: '2026-04', label: '2026-04' }, { value: '2026-05', label: '2026-05' }],
              a.settle_in_period, function (v) { a.settle_in_period = v; }))
          ]),
          h('div', { class: 'grid g2' }, [
            U.field('收付方向', U.selectEl([{ value: 'RECEIVABLE', label: '应收' }, { value: 'PAYABLE', label: '应付' }], a.direction, function (v) { a.direction = v; })),
            U.field('调整金额（可正可负，含税）', h('input', { type: 'number', step: '0.01', value: 0, oninput: function (e) { a.amount = +e.target.value; } }))
          ]),
          U.field('原因说明（必填，≥ 10 字符）', h('textarea', { rows: 2, oninput: function (e) { a.reason = e.target.value; } })),
          U.field('商务依据文件', h('input', { type: 'text', placeholder: '如 商务纪要 BZ-2026-0xx', oninput: function (e) { a.evidence = e.target.value; } }))
        ]);
        U.modal('新增调整项', body, [
          h('button', { class: 'btn', onclick: U.closeModal }, '取消'),
          h('button', {
            class: 'btn btn-primary', onclick: function () {
              if (!a.reason || a.reason.length < 10) { UI.toast('原因说明必填且不少于 10 字符', 'warn'); return; }
              if (!a.amount) { UI.toast('调整金额不能为 0', 'warn'); return; }
              var agr = S.agreements.filter(function (x) { return x.partner_no === a.partner_no; })[0];
              a.agreement_no = agr ? agr.agreement_no : '';
              a.reason = a.reason + (a.evidence ? '（依据：' + a.evidence + '）' : '');
              var created = Store.Actions.addAdjustment(a);
              var r = Store.Actions.submitAdjustmentApproval(created.adjustment_no);
              U.closeModal();
              UI.toast(r.ok ? '已提交审批：' + r.approval.chain.map(function (s) { return s.role_name; }).join(' → ') : '已保存', 'ok', created.adjustment_no);
              App.rerender();
            }
          }, '保存并提交审批')
        ], { size: 'wide' });
      }
    }
  });

  /* ================= 争议工作台 ================= */
  window.ViewsBill = { subnav: subnav };
})();
