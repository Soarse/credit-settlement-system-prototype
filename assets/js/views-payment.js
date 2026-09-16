/* =============================================================================
 * views-payment.js —— 模块⑤ 结算中心 · 支付异常处理台
 *   PRD 8.4.3 状态未知 / 8.4.4 重试策略 / 8.5 部分成功 · 失败 · 退票
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money;
  var U = UI;

  function insBadge(code) {
    var m = Payment.INS_META[code] || { name: code, cls: '' };
    return h('span', { class: 'badge dot ' + m.cls }, m.name);
  }

  /* 供结算详情页复用的付款指令面板 */
  function instructionPanel(o, onChange) {
    var S = Store.get();
    var box = h('div');
    draw();
    return box;

    function draw() {
      box.innerHTML = '';
      box.appendChild(U.table([
        { label: '指令号', render: function (i) { return h('span', { class: 'mono', style: 'font-size:11px' }, i.instruction_no); } },
        { label: '分笔', render: function (i) {
          return h('div', null, [h('div', null, i.seq + ' / ' + i.total_seq),
            i.resupply_of ? h('div', { class: 'faint', style: 'font-size:11px' }, '补发自 ' + i.resupply_of) : null]);
        }, width: '110px' },
        { label: '金额', num: true, render: function (i) { return M.fmt(i.amount); } },
        { label: '通道流水号', render: function (i) { return h('span', { class: 'mono faint', style: 'font-size:11px' }, i.channel_serial_no || '—'); } },
        { label: '状态', render: function (i) { return insBadge(i.status); }, width: '110px' },
        { label: '重试 / 查询', num: true, render: function (i) {
          return (i.retry_count || 0) + ' / ' + (i.poll_count || 0);
        }, width: '90px' },
        { label: '失败原因', render: function (i) { return i.fail_reason ? h('span', { class: 'neg' }, i.fail_reason) : '—'; } },
        { label: '', width: '80px', render: function (i) {
          var need = ['FAILED', 'UNKNOWN', 'PROCESSING', 'SENT', 'READY'].indexOf(i.status) >= 0;
          return need ? h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); insModal(o, i, refresh); } }, '处理') : '—';
        } }
      ], o.instructions, { compact: true }));

      var un = o.instructions.filter(function (i) { return i.status === 'UNKNOWN'; });
      if (un.length) box.appendChild(h('div', { class: 'mt8' }, U.alertBox('danger',
        '<b>存在 ' + un.length + ' 条状态未知指令</b>：请求已发出但结果不明。' +
        '系统<b>不会自动重试</b>（重试可能造成重复付款），须人工在支付系统 / 银行端确认实际结果后回填最终状态（8.4.3）。')));
      var pr = o.instructions.filter(function (i) { return i.status === 'PROCESSING' && i.unknown_pending; });
      if (pr.length) box.appendChild(h('div', { class: 'mt8' }, U.alertBox('warn',
        '<b>' + pr.length + ' 条指令通道未给出明确结果</b>，已转主动查询（30 秒 / 2 分钟 / 10 分钟 / 30 分钟递增），' +
        '累计 ' + Payment.POLL_TIMEOUT_MIN + ' 分钟仍未明确即置 UNKNOWN 并转人工。')));
    }
    function refresh() { draw(); if (onChange) onChange(); }
  }

  /* 单条指令的处理弹窗 */
  function insModal(o, ins, refresh) {
    var S = Store.get();
    var body = h('div');
    body.appendChild(U.kv([
      ['指令号', h('span', { class: 'mono' }, ins.instruction_no)],
      ['所属结算单', U.link(o.settle_no, '/settleorder/' + o.settle_no, 'mono')],
      ['分笔 / 金额', ins.seq + ' / ' + ins.total_seq + '　' + M.fmt(ins.amount)],
      ['收付账户', ins.payer_account + ' → ' + ins.payee_account],
      ['通道 / 流水号', ins.pay_channel + '　' + (ins.channel_serial_no || '—')],
      ['当前状态', insBadge(ins.status)],
      ['重试次数', String(ins.retry_count || 0)],
      ['失败原因', ins.fail_reason || '—']
    ], 'kv-2col'));

    /* 重试策略（8.4.4） */
    var c = Payment.canRetry(ins);
    body.appendChild(h('h3', { class: 'sec' }, ['重试策略判定', h('span', { class: 'tag-ref' }, '8.4.4')]));
    body.appendChild(U.alertBox(c.can ? 'ok' : 'danger',
      (c.can ? '<b>本条指令可以重试</b>：' : '<b>本条指令禁止重试</b>：') + c.why));

    /* 主动查询编排（8.4.3） */
    if (ins.status === 'PROCESSING' || ins.status === 'SENT' || ins.status === 'UNKNOWN') {
      body.appendChild(h('h3', { class: 'sec' }, ['主动查询编排', h('span', { class: 'tag-ref' }, '8.4.3 / 12.2.3')]));
      body.appendChild(U.table([
        { label: '轮次', render: function (p) { return String(p.seq); }, width: '60px' },
        { label: '间隔', render: function (p) { return p.interval; } },
        { label: '累计耗时', render: function (p) { return p.elapsed; }, width: '110px' },
        { label: '状态', render: function (p) {
          return p.done ? U.badge(p.timeout ? '已超时转人工' : '已执行', p.timeout ? 'danger' : 'ok')
            : h('span', { class: 'faint' }, '待执行');
        }, width: '120px' }
      ], Payment.pollPlan(ins), { compact: true }));
      body.appendChild(h('div', { class: 'faint mt8' },
        '已查询 ' + (ins.poll_count || 0) + ' 次，累计 ' + Payment.fmtMin((ins.poll_elapsed_min || 0) * 60) +
        '，超时阈值 ' + Payment.POLL_TIMEOUT_MIN + ' 分钟。'));
    }

    var foot = [];
    if (ins.status === 'READY' || ins.status === 'SENT' || ins.status === 'PROCESSING') {
      foot.push(h('button', {
        class: 'btn btn-ok', onclick: function () {
          act(Store.Actions.instructionCallback(ins.instruction_no, 'SUCCESS'), '通道回调成功，已生成结算流水与回单');
        }
      }, '模拟：通道回调成功'));
      foot.push(h('button', {
        class: 'btn btn-danger', onclick: function () {
          act(Store.Actions.instructionCallback(ins.instruction_no, 'FAILED', '收款账户名称与账号不匹配'), '通道明确失败，已告警');
        }
      }, '模拟：通道明确失败'));
    }
    if (ins.status === 'PROCESSING' || ins.status === 'SENT') {
      foot.push(h('button', {
        class: 'btn', onclick: function () {
          var r = Store.Actions.pollInstruction(ins.instruction_no, '');
          if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
          U.closeModal();
          UI.toast(r.timeout
            ? '累计查询超过 ' + Payment.POLL_TIMEOUT_MIN + ' 分钟仍未明确，已置 UNKNOWN 并触发 P0'
            : r.note + '，通道仍未给出明确结果', r.timeout ? 'danger' : 'warn');
          App.rerender();
        }
      }, '主动查询一次'));
    }
    if (ins.status === 'FAILED') {
      var reason = h('input', { type: 'text', placeholder: '已确认的失败原因（必填）', style: 'min-width:280px' });
      body.appendChild(h('div', { class: 'inline-form mt14' }, [U.field('人工确认失败原因', reason)]));
      body.appendChild(U.alertBox('warn', '通道明确失败意味着<b>资金未动</b>，可以重试；' +
        '但必须先查清失败原因（账户信息有误？余额不足？限额？），否则重试只会再失败一次。'));
      foot.push(h('button', {
        class: 'btn btn-primary', onclick: function () {
          var r = Store.Actions.retryInstruction(ins.instruction_no, reason.value.trim());
          if (!r.ok) { UI.toast(r.msg.replace(/<[^>]+>/g, ''), 'danger'); return; }
          act(r, '已重新下发，第 ' + r.ins.retry_count + ' 次重试');
        }
      }, '确认原因并重试'));
    }
    if (ins.status === 'UNKNOWN') {
      var opinion = h('input', { type: 'text', placeholder: '银行端核实结论', style: 'min-width:280px' });
      body.appendChild(h('div', { class: 'inline-form mt14' }, [U.field('人工核实结论', opinion)]));
      body.appendChild(U.alertBox('danger',
        '<b>支付领域最危险的状态是「未知」。</b>此时系统只提供两个出口：确认为成功（补记结算流水与回单）' +
        '或确认为失败（转入可重试）。<b>没有「重试」按钮</b> —— 这不是遗漏，是设计。'));
      foot.push(h('button', {
        class: 'btn btn-ok', disabled: !Store.can('settle.approve'),
        onclick: function () {
          act(Store.Actions.manualConfirmInstruction(ins.instruction_no, 'SUCCESS', opinion.value.trim() || '银行端确认已出账'),
            '已确认为成功，补记结算流水与回单');
        }
      }, '人工确认：实际已成功'));
      foot.push(h('button', {
        class: 'btn btn-danger', disabled: !Store.can('settle.approve'),
        onclick: function () {
          act(Store.Actions.manualConfirmInstruction(ins.instruction_no, 'FAILED', opinion.value.trim() || '银行端确认未出账'),
            '已确认为失败，可确认原因后重试');
        }
      }, '人工确认：实际未出账'));
    }
    foot.push(h('button', { class: 'btn', onclick: U.closeModal }, '关闭'));

    U.modal('付款指令 ' + ins.instruction_no, body, foot, { size: 'wide' });

    function act(r, msg) {
      if (!r.ok) { UI.toast((r.msg || '').replace(/<[^>]+>/g, ''), 'danger'); return; }
      U.closeModal(); UI.toast(msg, 'ok'); App.rerender();
    }
  }

  /* =========================== 异常处理台 =========================== */
  UI.route('payexc', {
    title: '支付异常处理', crumbs: ['模块⑤', '结算中心', '支付异常处理'],
    render: function (root, params) {
      var S = Store.get();

      root.appendChild(U.pageHead('支付异常处理台',
        '付款不是二值的：除了成功与失败，还有<b>部分成功</b>、<b>退票</b>和最危险的<b>状态未知</b>。' +
        '本页把这三条旁支做成可操作的闭环 —— 补发与结转、账单回退与账户冻结、递增主动查询与人工兜底。'));
      root.appendChild(ViewsSettle.subnav('payexc'));

      var abnormal = S.settleOrders.filter(Payment.hasException);
      var allIns = [];
      S.settleOrders.forEach(function (o) {
        o.instructions.forEach(function (i) { allIns.push({ o: o, i: i }); });
      });
      var unknowns = allIns.filter(function (x) { return x.i.status === 'UNKNOWN'; });
      var polling = allIns.filter(function (x) { return x.i.status === 'PROCESSING' && x.i.unknown_pending; });
      var failedIns = allIns.filter(function (x) { return x.i.status === 'FAILED'; });

      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('异常结算单', String(abnormal.length), '部分成功 / 失败 / 未知 / 退票', abnormal.length ? 'warn' : 'ok'),
        U.stat('状态未知指令', String(unknowns.length), '禁止自动重试，须人工确认', unknowns.length ? 'danger' : 'ok'),
        U.stat('主动查询中', String(polling.length), '递增间隔轮询通道', polling.length ? 'info' : ''),
        U.stat('失败待重试', String(failedIns.length), '需先确认失败原因', failedIns.length ? 'warn' : '')
      ]));

      /* ---------- 异常结算单 ---------- */
      root.appendChild(U.card('异常结算单', U.table([
        { label: '结算单号', render: function (o) { return U.link(o.settle_no, '/settleorder/' + o.settle_no, 'mono'); } },
        { label: '资金方', render: function (o) { return (S.partnerMap[o.partner_no] || {}).partner_short_name; } },
        { label: '账期', render: function (o) { return o.billing_period; }, width: '80px' },
        { label: '结算金额', num: true, render: function (o) { return M.fmt(o.settle_amount); } },
        { label: '已付', num: true, render: function (o) { return M.fmt(Payment.shortfall(o).paid); } },
        { label: '未付', num: true, render: function (o) {
          var s = Payment.shortfall(o);
          return h('span', { class: s.unpaid ? 'neg' : '' }, M.fmt(s.unpaid));
        } },
        { label: '状态', render: function (o) { return U.statusBadge(o.status); }, width: '100px' },
        { label: '', width: '90px', render: function (o) {
          return h('button', { class: 'btn btn-sm btn-primary', onclick: function (e) { e.stopPropagation(); orderModal(o); } }, '异常处理');
        } }
      ], abnormal, { compact: true, empty: '当前无异常结算单。可在结算详情页用「模拟：部分成功 / 状态未知 / 银行退票」制造一个。' }),
        { tight: true, ref: '8.5' }));

      if (!abnormal.length) {
        root.appendChild(U.alertBox('info',
          '想体验三条旁支：先驱动 4 月出账与结算审批，在<b>结算详情</b>页对某张<b>应付</b>结算单点' +
          '「模拟：部分成功」「模拟：状态未知」或「模拟：银行退票」，异常单就会出现在这里。'));
      }

      /* ---------- 结算状态机 ---------- */
      root.appendChild(U.card('结算状态机与后续动作', U.table([
        { label: '状态', key: 'k', width: '150px' },
        { label: '含义', key: 'm' },
        { label: '后续动作', render: function (r) { return h('span', { html: r.v }); } }
      ], [
        { k: 'COMPLETED 已完成', m: '全部指令成功且回单齐备', v: '账单置为已结算，L4→L5 勾稽可完成' },
        { k: 'PARTIAL 部分成功', m: '多笔指令中一部分成功', v: '对失败部分<b>生成新指令补发</b>；账单标记部分结算，<b>未付余额进入下期结转</b>' },
        { k: 'FAILED 失败', m: '全部指令通道明确失败', v: '资金未动；确认失败原因后重试，或作废重开' },
        { k: 'UNKNOWN 状态未知', m: '请求已发出，结果不明', v: '<b>绝不自动重试</b>；递增主动查询，2 小时未明确转人工确认' },
        { k: 'RETURNED 已退票', m: '银行原路退回（账户异常等）', v: '结算单置退票，<b>账单回退至已确认</b>，<b>收款账户冻结并移出白名单</b>，须重新验证后重结' }
      ], { compact: true }), { tight: true, ref: '8.5' }));

      /* ---------- 重试策略矩阵 ---------- */
      root.appendChild(U.card('重试策略矩阵', U.table([
        { label: '指令状态', render: function (r) { return h('span', { class: 'mono' }, r.status); }, width: '130px' },
        { label: '可否重试', render: function (r) { return U.badge(r.can ? '可以' : '禁止', r.can ? 'ok' : 'danger'); }, width: '90px' },
        { label: '理由', render: function (r) { return h('span', { html: r.why }); } }
      ], Payment.RETRY_POLICY, { compact: true }), { tight: true, ref: '8.4.4' }));

      /* ---------- 状态未知的处理原则 ---------- */
      root.appendChild(U.card('状态未知的处理原则', h('div', null, [
        U.alertBox('danger', '<b>支付领域最危险的状态是「未知」</b>：请求已发出，但未收到明确成功或失败。' +
          '此时任何一次「顺手重试」都可能变成重复付款，而重复付出去的钱要靠对方配合才退得回来。'),
        U.table([
          { label: '原则', key: 'k', width: '150px' }, { label: '说明', key: 'v' }
        ], [
          { k: '绝不自动重试', v: '系统层面不提供自动重发路径，界面上也不给「重试」按钮' },
          { k: '转主动查询', v: '按 ' + Payment.POLL_SCHEDULE.map(function (s) { return s < 60 ? s + 's' : (s / 60) + 'min'; }).join(' / ') + ' 递增间隔主动查询通道状态' },
          { k: '超时转人工', v: Payment.POLL_TIMEOUT_MIN + ' 分钟内仍未明确 → 置 UNKNOWN + P0 告警 + 人工介入' },
          { k: '人工确认后处理', v: '由人工在支付系统 / 银行端确认实际结果，再在本系统回填最终状态' }
        ], { compact: true })
      ]), { ref: '8.4.3' }));

      /* ---------- 结转记录 ---------- */
      if (S.carryForwards.length) {
        root.appendChild(U.card('未付结转（进入下期账单第三项）', U.table([
          { label: '结转单号', render: function (c) { return h('span', { class: 'mono' }, c.carry_no); } },
          { label: '资金方', render: function (c) { return (S.partnerMap[c.partner_no] || {}).partner_short_name; } },
          { label: '结转至账期', render: function (c) { return c.period; }, width: '110px' },
          { label: '金额', num: true, render: function (c) { return M.fmt(c.amount); } },
          { label: '来源结算单', render: function (c) { return U.link(c.source_settle_no, '/settleorder/' + c.source_settle_no, 'mono'); } },
          { label: '已入账单', render: function (c) { return c.bill_no ? U.link(c.bill_no, '/bill/' + c.bill_no, 'mono') : U.badge('待出账', 'warn'); } }
        ], S.carryForwards, { compact: true }), { tight: true, ref: '7.3' }));
      }

      if (params.order) {
        var t = S.settleOrderMap[params.order];
        if (t) setTimeout(function () { orderModal(t); }, 60);
      }
      if (params.ins) {
        var f = Store.Actions.findInstruction(params.ins);
        if (f) setTimeout(function () { insModal(f.order, f.ins, null); }, 60);
      }

      /* ---------- 结算单异常处理 ---------- */
      function orderModal(o) {
        var body = h('div');
        var sf = Payment.shortfall(o);
        body.appendChild(U.kv([
          ['结算单', h('span', { class: 'mono' }, o.settle_no)],
          ['资金方 / 账期', (S.partnerMap[o.partner_no] || {}).partner_short_name + '　' + o.billing_period],
          ['结算金额', M.fmt(o.settle_amount)],
          ['已付 / 未付', M.fmt(sf.paid) + '　/　' + h('span', null, M.fmt(sf.unpaid)).textContent],
          ['当前状态', U.statusBadge(o.status)],
          ['关联账单', o.bill_nos.join('、')],
          ['退票原因', o.return_reason || '—']
        ], 'kv-2col'));

        body.appendChild(h('h3', { class: 'sec' }, ['付款指令', h('span', { class: 'tag-ref' }, '8.4.1')]));
        body.appendChild(instructionPanel(o, null));

        var opBox = h('div', { class: 'mt14' });
        body.appendChild(opBox);
        drawOps();

        function drawOps() {
          opBox.innerHTML = '';
          sf = Payment.shortfall(o);
          var needResupplyOrCarry = o.status === 'PARTIAL' || o.status === 'FAILED' ||
            (M.r2(sf.unpaid) !== 0 && o.status !== 'RETURNED' && o.instructions.some(function (i) { return i.resupply_of || i.status === 'FAILED'; }));
          if (needResupplyOrCarry) {
            opBox.appendChild(h('h3', { class: 'sec' }, ['部分成功的两件事', h('span', { class: 'tag-ref' }, '8.5')]));
            opBox.appendChild(U.alertBox('info',
              '① 对<b>失败的那几笔</b>生成新指令补发（结算单不拆，序号续号并记录补发来源）；' +
              '② 本期确实没收到的钱，<b>作为结转进入下期账单</b>，而不是留在这张单上等。' +
              '这两件事是并列的：补发解决「钱还要付」，结转解决「账要对得上」。'));
            var pendingFailed = o.instructions.filter(function (i) { return i.status === 'FAILED' && !i.resupplied; }).length;
            var carried = S.carryForwards.some(function (c) { return c.source_settle_no === o.settle_no; });
            opBox.appendChild(h('div', { class: 'btn-row' }, [
              h('button', {
                class: 'btn btn-primary', disabled: !pendingFailed || !Store.can('settle.create'),
                onclick: function () {
                  var r = Store.Actions.resupplyOrder(o.settle_no);
                  if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
                  UI.toast('已对 ' + r.instructions.length + ' 条失败指令生成补发指令', 'ok');
                  drawOps(); App.rerender();
                }
              }, pendingFailed ? '补发 ' + pendingFailed + ' 条失败指令' : '无待补发指令'),
              h('button', {
                class: 'btn', disabled: carried || M.r2(sf.unpaid) === 0 || !Store.can('settle.create'),
                onclick: function () {
                  var r = Store.Actions.carryForwardShortfall(o.settle_no);
                  if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
                  UI.toast('未付 ' + M.fmt(r.shortfall.unpaid) + ' 元已结转至 ' + r.carry.period, 'ok');
                  drawOps(); App.rerender();
                }
              }, carried ? '未付部分已结转' : '未付 ' + M.fmt(sf.unpaid) + ' 元结转下期')
            ]));
          }

          if (o.status === 'COMPLETED' || o.status === 'PARTIAL') {
            opBox.appendChild(h('h3', { class: 'sec' }, ['银行退票', h('span', { class: 'tag-ref' }, '8.5 RETURNED')]));
            var rr = h('input', { type: 'text', placeholder: '退票原因', style: 'min-width:280px' });
            opBox.appendChild(U.alertBox('warn',
              '退票不是「失败」的同义词 —— 钱出去过又回来了。所以要做三件事：结算单置退票、' +
              '<b>账单回退至已确认</b>（重新可结算）、<b>收款账户冻结并移出白名单</b>（FC-01 会在下次结算时硬拦截）。'));
            opBox.appendChild(h('div', { class: 'inline-form' }, [
              U.field('退票原因', rr),
              h('button', {
                class: 'btn btn-danger', disabled: !Store.can('settle.approve'),
                onclick: function () {
                  var r = Store.Actions.returnSettle(o.settle_no, rr.value.trim());
                  if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
                  U.closeModal();
                  UI.toast('已按退票处理：账单回退、账户 ' + (r.account ? r.account.account_no_id : '') + ' 冻结', 'danger');
                  App.rerender();
                }
              }, '模拟：银行退票')
            ]));
          }

          if (o.status === 'RETURNED') {
            opBox.appendChild(h('h3', { class: 'sec' }, ['退票后重新结算', h('span', { class: 'tag-ref' }, '8.5')]));
            var acctId = o.direction === 'PAY' ? o.payee_account : o.payer_account;
            var acct = S.accountMap[acctId];
            var frozen = acct && acct.status === 'FROZEN';
            opBox.appendChild(U.alertBox(frozen ? 'danger' : 'ok', frozen
              ? '收款账户 <b>' + acctId + '</b> 已冻结并移出白名单，<b>重新结算会被 FC-01 硬拦截</b>。' +
                '正确顺序是：先在资金方主数据变更 / 重新验证账户并完成双人复核与 T+1 冷静期，再回来重结。'
              : '收款账户已恢复，可重新生成结算单。'));
            opBox.appendChild(h('div', { class: 'btn-row' }, [
              h('button', {
                class: 'btn', onclick: function () { U.goto('/partner/' + o.partner_no + '?tab=account'); }
              }, '前往处理收款账户'),
              h('button', {
                class: 'btn btn-primary', disabled: !Store.can('settle.create'),
                onclick: function () {
                  var r = Store.Actions.resettleOrder(o.settle_no);
                  if (!r.ok) { UI.toast(r.msg.replace(/<[^>]+>/g, ''), 'danger'); return; }
                  U.closeModal();
                  UI.toast('已重新生成结算单 ' + r.orders.map(function (x) { return x.settle_no; }).join('、'), 'ok');
                  App.rerender();
                }
              }, '重新结算'),
              o.resettled_to ? h('span', { class: 'faint' }, '已重结为 ' + o.resettled_to) : null
            ]));
          }
        }

        U.modal('异常处理 · ' + o.settle_no, body,
          [h('button', { class: 'btn', onclick: function () { U.goto('/settleorder/' + o.settle_no); } }, '打开结算详情'),
           h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'wide' });
      }
    }
  });

  window.ViewsPayment = { instructionPanel: instructionPanel, insModal: insModal, insBadge: insBadge };
})();
