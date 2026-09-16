/* =============================================================================
 * views-settle.js —— 模块⑤ 结算中心：结算单、轧差、付款审批、回单
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money;
  var U = UI;

  function subnav(active) {
    var items = [['settle', '结算单'], ['claim', '收款认领'], ['payexc', '支付异常'], ['receipts', '回单管理']];
    return h('div', { class: 'btn-row', style: 'margin-bottom:14px' }, items.map(function (i) {
      return h('button', { class: 'btn btn-sm' + (i[0] === active ? ' btn-primary' : ''), onclick: function () { U.goto('/' + i[0]); } }, i[1]);
    }));
  }

  UI.route('settle', {
    title: '结算中心', crumbs: ['模块⑤', '结算中心'],
    render: function (root) {
      var S = Store.get();
      root.appendChild(U.pageHead('结算中心',
        '把已确认账单变成真实、安全、可追溯的资金收付。<b>本模块的容错原则与计费引擎相反</b>：计费可以延迟、可以重算；<b>资金付出去就收不回来</b>。因此一切设计优先保证「不错付」，其次才是效率。'));
      root.appendChild(subnav('settle'));

      var ready = S.bills.filter(function (b) {
        if (b.status !== 'CONFIRMED' && b.status !== 'ADJUSTED' && b.status !== 'DISPUTED') return false;
        var openOrder = S.settleOrders.some(function (o) {
          return o.bill_nos.indexOf(b.bill_no) >= 0 && ['PENDING', 'APPROVING', 'PROCESSING', 'WAITING_RECEIPT', 'PARTIAL_SETTLED', 'UNKNOWN'].indexOf(o.status) >= 0;
        });
        var openDispute = M.sum(S.disputes.filter(function (d) {
          return d.bill_no === b.bill_no && d.status !== 'CLOSED' && d.status !== 'REJECTED';
        }), function (d) { return Math.abs(d.disputed_amount || 0); });
        return !openOrder && M.r2(Math.abs(b.total_amount) - (b.settled_amount || 0) - openDispute) > 0;
      });
      if (ready.length) {
        root.appendChild(U.card('待发起结算', h('div', null, [
          U.alertBox('info', '有 <b>' + ready.length + '</b> 张账单存在可结算金额。争议金额自动冻结，其余部分继续结算。生成边界：资金方 × 协议账户 × 结算日 × 币种；仅边界一致且协议允许时轧差。'),
          h('button', {
            class: 'btn btn-primary', disabled: !Store.can('settle.create'),
            onclick: function () {
              var periods = Core.uniq(ready.map(function (b) { return b.billing_period; }));
              var n = 0;
              periods.forEach(function (p) { n += Store.Actions.createSettleOrders(p).length; });
              UI.toast('已生成 ' + n + ' 张结算单', 'ok'); App.rerender();
            }
          }, '生成结算单')
        ]), { ref: '8.2' }));
      }

      root.appendChild(U.card('结算单列表', U.table([
        { label: '结算单号', render: function (o) { return U.link(o.settle_no, '/settleorder/' + o.settle_no, 'mono'); } },
        { label: '资金方', render: function (o) { return (S.partnerMap[o.partner_no] || {}).partner_short_name; } },
        { label: '账期', key: 'billing_period', width: '80px' },
        { label: '方向', render: function (o) { return o.direction === 'RECEIVE' ? U.badge('我方收款', 'ok') : U.badge('我方付款', 'danger'); } },
        { label: '轧差', render: function (o) { return o.is_netting ? U.badge('是', 'purple') : '—'; }, width: '55px' },
        { label: '应收', num: true, render: function (o) { return M.fmt(o.receivable_amount); } },
        { label: '应付', num: true, render: function (o) { return M.fmt(o.payable_amount); } },
        { label: '结算金额', num: true, render: function (o) { return h('b', null, M.fmt(o.settle_amount)); } },
        { label: '计划结算日', key: 'plan_settle_date', width: '100px' },
        { label: '指令数', num: true, render: function (o) { return o.instructions.length; } },
        { label: '状态', render: function (o) { return U.statusBadge(o.status); }, width: '90px' }
      ], S.settleOrders, { onRow: function (o) { U.goto('/settleorder/' + o.settle_no); }, empty: '暂无结算单' }), { tight: true }));

      root.appendChild(h('div', { class: 'grid g2' }, [
        U.card('资金安全控制矩阵（资损防线三）', U.table([
          { label: '编号', render: function (c) { return h('span', { class: 'mono' }, c.code); }, width: '60px' },
          { label: '控制', key: 'name', width: '110px' },
          { label: '规则', key: 'desc' },
          { label: '拦截', render: function (c) { return U.badge(({ HARD: '硬拦截', AUTO: '自动处理', WARN: '警告' })[c.type], c.type === 'HARD' ? 'danger' : (c.type === 'WARN' ? 'warn' : 'info')); }, width: '80px' }
        ], Data.FUND_CONTROLS, { compact: true }), { tight: true, ref: '8.8.1' }),
        U.card('「宁可不付，不可错付」', h('div', null, [
          U.alertBox('danger', '任一硬拦截项不通过，结算单一律停在 PENDING，<b>不提供跳过或强制执行入口</b>。如确需紧急处理，走线下审批 + 系统补录流程，且补录动作本身需三人审批并全程留痕 —— 把绕过控制的成本设置得足够高。'),
          h('h3', { class: 'sec' }, '支付状态未知的处理（8.4.3）'),
          U.table([{ label: '处理原则', key: 'k' }, { label: '说明', key: 'v' }], [
            { k: '绝不自动重试', v: '状态未知时重试可能造成重复付款' },
            { k: '转主动查询', v: '按 30 秒 / 2 分钟 / 10 分钟 / 30 分钟递增间隔主动查询通道状态' },
            { k: '超时转人工', v: '2 小时内仍未明确 → 置 UNKNOWN + 高优先级告警 + 人工介入' },
            { k: '人工确认后处理', v: '由人工在支付系统 / 银行端确认实际结果后，在本系统标记最终状态' }
          ], { compact: true })
        ]), { ref: '8.4.3' })
      ]));
    }
  });

  UI.route('settleorder', {
    title: '结算详情', crumbs: ['模块⑤', '结算中心', '结算详情'],
    render: function (root, params) {
      var S = Store.get();
      var o = S.settleOrderMap[params.id];
      if (!o) { root.appendChild(U.alertBox('danger', '未找到结算单 ' + params.id)); return; }
      var risk = Billing.riskCheck(S, o);
      var partner = S.partnerMap[o.partner_no];
      var acct = S.accountMap[o.direction === 'PAY' ? o.payee_account : o.payer_account];

      var acts = [];
      var pendAp = Approval.pendingFor(S, 'SETTLE', o.settle_no);
      if (o.status === 'PENDING') acts.push(h('button', {
        class: 'btn btn-primary', disabled: !Store.can('approval.submit') || !risk.pass,
        onclick: function () {
          var r = Store.Actions.submitSettleApproval(o.settle_no);
          if (!r.ok) { UI.toast(r.msg || '存在未通过的硬拦截项', 'danger', '提交被阻断'); return; }
          UI.toast('审批单 ' + r.approval.approval_no + ' 已生成：' +
            r.approval.chain.map(function (s) { return s.role_name; }).join(' → ') +
            (r.risk.warn ? '（触发警告项，已 +1 级风控审批）' : ''), 'ok', '已提交结算审批');
          App.rerender();
        }
      }, '提交结算审批'));
      if (pendAp) acts.push(h('button', {
        class: 'btn', onclick: function () { ViewsApproval.openApproval(pendAp); }
      }, '审批中 · ' + pendAp.approval_no));
      if (o.status === 'WAITING_RECEIPT') {
        acts.push(h('button', {
          class: 'btn btn-primary', onclick: function () { U.goto('/claim'); }
        }, '前往收款认领工作台'));
      }
      if (o.status === 'PARTIAL_SETTLED' && o.direction === 'RECEIVE') {
        acts.push(h('button', { class: 'btn btn-primary', onclick: function () { U.goto('/claim'); } }, '继续认领剩余到账'));
      }
      if (o.status === 'PROCESSING') {
        acts.push(h('button', { class: 'btn btn-ok', onclick: function () { Store.Actions.executeSettle(o.settle_no, 'SUCCESS'); UI.toast('付款成功，回单已回写', 'ok'); App.rerender(); } }, '模拟：付款成功'));
        acts.push(h('button', { class: 'btn btn-danger', onclick: function () { Store.Actions.executeSettle(o.settle_no, 'PARTIAL'); UI.toast('部分成功：末笔指令失败，需补发并结转未付部分', 'warn'); App.rerender(); } }, '模拟：部分成功'));
        acts.push(h('button', { class: 'btn btn-danger', onclick: function () { Store.Actions.executeSettle(o.settle_no, 'UNKNOWN'); UI.toast('末笔通道未给出明确结果，已转主动查询（不自动重试）', 'danger'); App.rerender(); } }, '模拟：状态未知'));
      }
      if (['PARTIAL', 'FAILED', 'UNKNOWN', 'RETURNED'].indexOf(o.status) >= 0) {
        acts.push(h('button', { class: 'btn btn-primary', onclick: function () { U.goto('/payexc?order=' + o.settle_no); } }, '异常处理台'));
      }
      if (o.status === 'COMPLETED') {
        acts.push(h('button', { class: 'btn btn-danger', onclick: function () { U.goto('/payexc?order=' + o.settle_no); } }, '模拟：银行退票'));
      }
      acts.push(h('button', { class: 'btn', onclick: function () { U.goto('/trace?q=' + o.settle_no); } }, '全链路追溯'));

      root.appendChild(U.pageHead('结算单 ' + o.settle_no,
        partner.partner_short_name + ' ｜ ' + o.billing_period + ' ｜ ' + (o.direction === 'RECEIVE' ? '我方收款' : '我方付款') +
        (o.is_netting ? ' ｜ 轧差结算' : ''), acts));

      root.appendChild(h('div', { class: 'grid g-2-1' }, [
        (function () {
          var led = h('div', { class: 'ledger' });
          (o.bill_allocations || o.bill_nos.map(function (n) {
            var b0 = S.billMap[n]; return { bill_no: n, direction: b0 ? b0.direction : '', amount: b0 ? b0.total_amount : 0, disputed_amount: 0 };
          })).forEach(function (a) {
            var b = S.billMap[a.bill_no]; if (!b) return;
            led.appendChild(h('div', { class: 'lrow' }, [
              h('span', null, b.bill_no + '　' + (b.direction === 'RECEIVABLE' ? '应收' : '应付') +
                (a.disputed_amount ? '（冻结争议 ' + M.fmt(a.disputed_amount) + '）' : '')),
              h('span', { class: b.direction === 'PAYABLE' ? 'neg' : '' }, (b.direction === 'PAYABLE' ? '−' : '+') + M.fmt(a.amount))
            ]));
          });
          led.appendChild(h('div', { class: 'lsep' }));
          if (o.is_netting) {
            led.appendChild(h('div', { class: 'lrow' }, [h('span', null, 'Σ 应收'), h('span', null, M.fmt(o.receivable_amount))]));
            led.appendChild(h('div', { class: 'lrow' }, [h('span', null, 'Σ 应付'), h('span', { class: 'neg' }, M.fmt(o.payable_amount))]));
            led.appendChild(h('div', { class: 'ldbl' }));
            led.appendChild(h('div', { class: 'lrow ltotal' }, [
              h('span', null, 'net = Σ应收 − Σ应付'),
              h('span', null, M.fmt(M.r2(o.receivable_amount - o.payable_amount)))]));
          } else {
            led.appendChild(h('div', { class: 'lrow ltotal' }, [h('span', null, '结算金额'), h('span', null, M.fmt(o.settle_amount))]));
          }
          led.appendChild(h('div', { class: 'lrow' }, [h('span', null, '累计实结 / 剩余'),
            h('span', null, M.fmt(o.settled_amount || 0) + ' / ' + M.fmt(o.remaining_amount === undefined ? o.settle_amount : o.remaining_amount))]));
          return U.card('轧差计算过程', h('div', null, [
            led,
            o.is_netting ? U.alertBox('info', '<b>开票不受轧差影响</b>：平台向资金方开票 ' + M.fmt(o.receivable_amount) +
              '，资金方向平台开票 ' + M.fmt(o.payable_amount) + '，银行实际划转 ' + M.fmt(o.settle_amount) + '（7.8.4）。') : null,
            o.is_netting ? U.alertBox('warn', '轧差必须有<b>合同条款支持</b>。未经约定的轧差可能被认定为擅自抵销，存在法律风险；规则中心的 join_netting 开关必须与协议条款一一对应。') : null
          ]), { ref: '8.3' });
        })(),
        U.card('结算单信息', U.kv([
          ['状态', U.statusBadge(o.status)],
          ['计划结算日', o.plan_settle_date],
          ['币种 / 结算边界', (o.currency || 'CNY') + ' / ' + ((o.settlement_scope || {}).account_no_id || '默认账户')],
          ['付款账户', h('span', { class: 'mono' }, o.payer_account)],
          ['收款账户', h('span', { class: 'mono' }, o.payee_account)],
          ['账户户名', acct ? acct.account_name : '平台主账户'],
          ['开户行', acct ? acct.bank_name : '—'],
          ['支付通道', o.pay_channel],
          ['审批单号', o.approval_no || '—'],
          ['发起人 / 审批人', o.creator + ' / ' + (o.approver ? Store.roleName(o.approver) : '—')],
          ['所需审批层级', h('span', null, Billing.approvalLevel(o.settle_amount).map(function (x) { return U.badge(x, 'brand'); }))]
        ]))
      ]));

      root.appendChild(U.card('付款审批 · 风险提示区', h('div', null, [
        h('div', { class: 'checklist' }, risk.checks.map(function (c) {
          return h('div', { class: 'check-row ' + (c.ok ? 'pass' : (c.type === 'WARN' ? 'warn' : 'fail')) }, [
            h('div', { class: 'st' }, c.ok ? '✓' : (c.type === 'WARN' ? '!' : '✕')),
            h('div', { class: 'code' }, c.code),
            h('div', { class: 'msg' }, [h('div', null, c.name), h('div', { class: 'faint', style: 'font-size:11.5px' }, c.msg)]),
            h('div', { class: 'lvl' }, U.badge(({ HARD: '硬拦截', AUTO: '自动', WARN: '警告' })[c.type], c.ok ? '' : (c.type === 'WARN' ? 'warn' : 'danger')))
          ]);
        })),
        h('div', { class: 'mt8' }, U.alertBox(risk.pass ? 'ok' : 'danger',
          risk.pass ? '全部硬拦截项通过，可提交审批。' : '存在未通过的硬拦截项，结算单停留在 PENDING，系统不提供跳过入口。'))
      ]), { tight: true, ref: '8.8' }));

      if (o.instructions.length) {
        root.appendChild(U.card('付款指令（单笔限额 100 万自动拆分）',
          ViewsPayment.instructionPanel(o, null), { tight: true, ref: '8.4.1 / 8.4.3 / 8.4.4' }));
      }
      if (o.status === 'RETURNED') {
        root.appendChild(U.card('退票处理', h('div', null, [
          U.alertBox('danger', '本单已退票：' + Core.esc(o.return_reason || '') +
            '。关联账单已回退至<b>已确认</b>，收款账户已<b>冻结并移出白名单</b>，' +
            '重新结算前须先完成账户变更与双人复核（FC-01）。'),
          h('button', { class: 'btn btn-primary', onclick: function () { U.goto('/payexc?order=' + o.settle_no); } }, '前往异常处理台')
        ]), { ref: '8.5' }));
      }

      var sfs = S.settleFlows.filter(function (f) { return f.settle_no === o.settle_no; });
      if (sfs.length) {
        root.appendChild(U.card('结算流水与银行回单', U.table([
          { label: '结算流水号', render: function (f) { return h('span', { class: 'mono' }, f.settle_flow_no); } },
          { label: '金额', num: true, render: function (f) { return M.fmt(f.amount); } },
          { label: '状态', render: function (f) { return U.statusBadge(f.status); } },
          { label: '成功时间', render: function (f) { return f.success_time.replace('T', ' ').slice(0, 16); } },
          { label: '回单号', render: function (f) { return f.receipt_no ? h('span', { class: 'mono' }, f.receipt_no) : U.badge('缺失（P0）', 'danger'); } }
        ], sfs, { compact: true }), { tight: true, ref: '8.7' }));
      }
    }
  });

  UI.route('receipts', {
    title: '回单管理', crumbs: ['模块⑤', '结算中心', '回单管理'],
    render: function (root) {
      var S = Store.get();
      root.appendChild(U.pageHead('银行回单管理',
        '回单是 L4→L5 勾稽的凭据。每日校验：成功结算但无回单且超过 24 小时 → <b>P0 告警</b>（回单缺失意味着 L4→L5 勾稽无法完成）。'));
      root.appendChild(subnav('receipts'));
      var missing = S.settleFlows.filter(function (f) { return f.status === 'SUCCESS' && !f.receipt_no; });
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('回单总数', S.receipts.length),
        U.stat('回单金额', M.fmt(M.sum(S.receipts, function (r) { return r.amount; }))),
        U.stat('成功结算流水', S.settleFlows.filter(function (f) { return f.status === 'SUCCESS'; }).length),
        U.stat('回单缺失', missing.length, missing.length ? 'P0 告警' : '回单齐备', missing.length ? 'danger' : 'ok')
      ]));
      root.appendChild(U.card('回单列表', U.table([
        { label: '回单号', render: function (r) { return h('span', { class: 'mono' }, r.receipt_no); } },
        { label: '结算流水号', render: function (r) { return h('span', { class: 'mono' }, r.settle_flow_no); } },
        { label: '通道流水号', render: function (r) { return h('span', { class: 'mono faint' }, r.channel_serial_no); } },
        { label: '金额', num: true, render: function (r) { return M.fmt(r.amount); } },
        { label: '回单日期', key: 'receipt_date', width: '100px' },
        { label: '获取方式', render: function (r) { return U.badge(({ CALLBACK: '支付系统回调', PULL: '定时批量拉取', MANUAL: '人工上传' })[r.receive_type], 'info'); } },
        { label: '', render: function (r) { return h('button', { class: 'btn btn-sm', onclick: function () { U.goto('/trace?q=' + r.receipt_no); } }, '反向追溯'); } }
      ], S.receipts, { compact: true, empty: '暂无回单' }), { tight: true }));
    }
  });
  window.ViewsSettle = { subnav: subnav };
})();
