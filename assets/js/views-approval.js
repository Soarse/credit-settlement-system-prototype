/* =============================================================================
 * views-approval.js —— 审批中心 · 我的待办
 * 统一入口：规则发布、范围重算、结算付款、账单调整项、账户变更、账单作废……
 * 对应 PRD：5.8.1 / 6.9.3 / 7.6.2 / 8.8.2 / 4.7 / 14.4
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  function bizBadge(t) {
    var map = {
      RULE_PUBLISH: ['规则发布', 'brand'], RECALC: ['范围重算', 'purple'],
      SETTLE: ['结算付款', 'danger'], ADJUSTMENT: ['调整项', 'warn'],
      ACCOUNT: ['账户变更', 'danger'], PARTNER_ADMIT: ['资金方准入', 'info'],
      AGREEMENT: ['协议生效', 'info'], BILL_VOID: ['账单作废', 'warn']
    };
    var m = map[t] || [t, ''];
    return U.badge(m[0], m[1]);
  }
  function apStatus(s) {
    var map = { PENDING: ['审批中', 'warn'], APPROVED: ['已通过', 'ok'], REJECTED: ['已驳回', 'danger'], WITHDRAWN: ['已撤回', ''] };
    var m = map[s] || [s, ''];
    return h('span', { class: 'badge dot ' + m[1] }, m[0]);
  }
  function actorLabel(role, userName) {
    return (userName ? userName + ' / ' : '') + Store.roleName(role);
  }

  /* ---------------- 审批链路时间轴 ---------------- */
  function chainView(ap) {
    return h('div', { class: 'sched' }, ap.chain.map(function (s) {
      var cls = s.status === 'APPROVED' ? 'done' : (s.status === 'REJECTED' ? 'run' : (s.seq === ap.current_seq + 1 && ap.status === 'PENDING' ? 'run' : 'wait'));
      return h('div', { class: 'sched-row ' + cls }, [
        h('div', { class: 'st' }, s.status === 'APPROVED' ? '✓' : (s.status === 'REJECTED' ? '✕' : (s.status === 'SKIPPED' ? '—' : '○'))),
        h('div', { class: 'tm' }, '第 ' + s.seq + ' 级'),
        h('div', { class: 'nm' }, s.role_name),
        h('div', { class: 'ds' }, s.opinion || (s.status === 'PENDING' ? (s.seq === ap.current_seq + 1 && ap.status === 'PENDING' ? '待处理' : '等待前序环节') : '')),
        h('div', { class: 'rs' }, s.time ? (s.operator ? actorLabel(s.operator, s.operator_user_name) + ' · ' + s.time : s.time) : '—')
      ]);
    }));
  }

  /* ---------------- 审批详情 / 处理 ---------------- */
  function openApproval(ap) {
    var S = Store.get();
    var body = h('div');
    body.appendChild(U.kv([
      ['审批单号', h('span', { class: 'mono' }, ap.approval_no)],
      ['业务类型', h('span', null, [bizBadge(ap.biz_type), ' ', h('span', { class: 'tag-ref' }, ap.ref)])],
      ['关联单据', ap.route ? U.link(ap.biz_key, ap.route, 'mono') : h('span', { class: 'mono' }, ap.biz_key)],
      ['影响金额', h('b', null, M.fmtSigned(ap.amount))],
      ['资金方', ap.partner_no ? ((S.partnerMap[ap.partner_no] || {}).partner_short_name || ap.partner_no) : '—'],
      ['发起人 / 角色', actorLabel(ap.initiator_role || ap.initiator, ap.initiator_user_name)],
      ['发起时间', ap.initiate_time],
      ['内容版本 / 指纹', 'v' + (ap.content_version || 1) + ' / ' + (ap.content_fingerprint || '历史单据')],
      ['SLA', ap.sla_deadline + (Approval.isOverdue(S, ap) ? '（已超期）' : '')],
      ['状态', apStatus(ap.status)],
      ['申请理由', ap.reason || '—']
    ], 'kv-2col'));

    if (ap.summary && ap.summary.length) {
      body.appendChild(h('h3', { class: 'sec' }, '影响面摘要'));
      body.appendChild(U.table([
        { label: '项', render: function (r) { return r[0]; }, width: '160px' },
        { label: '内容', render: function (r) { return r[1]; } }
      ], ap.summary, { compact: true }));
    }

    if (ap.evidence && ap.evidence.length) {
      body.appendChild(h('h3', { class: 'sec' }, '审批证据包'));
      body.appendChild(U.table([
        { label: '证据编号', key: 'evidence_no', width: '150px' },
        { label: '名称', key: 'name' },
        { label: '类型', render: function (e) { return U.badge(e.type === 'SYSTEM_SNAPSHOT' ? '系统快照' : e.type, 'info'); }, width: '100px' },
        { label: '固化人 / 时间', render: function (e) { return e.captured_by + ' · ' + e.captured_time; }, width: '190px' },
        { label: '说明', key: 'note' }
      ], ap.evidence, { compact: true }));
      body.appendChild(U.alertBox('info', '审批依据已按内容版本固化。提交后若业务内容变化，原审批结论失效，必须以新版本重新发起审批。'));
    }

    body.appendChild(h('h3', { class: 'sec' }, ['审批链路（按' + (ap.flags && ap.flags.retroactive ? '追溯生效' : '影响金额') + '分级生成，不可人工指定）',
      h('span', { class: 'tag-ref' }, ap.ref)]));
    body.appendChild(chainView(ap));

    body.appendChild(h('h3', { class: 'sec' }, '操作留痕'));
    body.appendChild(U.table([
      { label: '时间', render: function (l) { return l.time; }, width: '130px' },
      { label: '操作人 / 角色', render: function (l) { return actorLabel(l.operator, l.operator_user_name); }, width: '165px' },
      { label: '动作', render: function (l) { return l.action; }, width: '150px' },
      { label: '说明', render: function (l) { return l.detail || '—'; } }
    ], ap.logs, { compact: true }));

    var footer = [];
    if (Approval.canAct(S, ap)) {
      var opinion = h('textarea', { rows: 2, placeholder: '审批意见（驳回时必填）' });
      var otpInput = null, otp = '';
      var actBox = h('div', null, [h('h3', { class: 'sec' }, '审批处理'), U.field('审批意见', opinion)]);
      if (ap.sensitive) {
        otp = String(Math.floor(100000 + Math.random() * 900000));
        otpInput = h('input', { type: 'text', maxlength: 6, placeholder: '请输入 6 位验证码', style: 'max-width:180px' });
        actBox.appendChild(U.field('二次身份验证（敏感操作，PRD 14.4）',
          h('div', { class: 'inline-form' }, [
            otpInput,
            h('button', { class: 'btn btn-sm', onclick: function () { otpInput.value = otp; } }, '填入模拟验证码'),
            h('span', { class: 'faint' }, '模拟短信验证码：' + otp)
          ])));
      }
      if ((ap.initiator_user && ap.initiator_user === Store.currentUser().user_id) || (!ap.initiator_user && ap.initiator === S.role)) {
        actBox.appendChild(U.alertBox('danger', '你是本单发起人，<b>发起人不得审批自己提交的单据</b>（双人复核强制）。'));
      }
      body.appendChild(actBox);

      footer.push(h('button', {
        class: 'btn btn-danger',
        onclick: function () {
          if (!opinion.value.trim()) { UI.toast('驳回必须填写审批意见', 'warn'); return; }
          if (ap.sensitive && otpInput.value !== otp) { UI.toast('二次验证码不正确', 'danger'); return; }
          var r = Store.Actions.approvalAct(ap.approval_no, 'REJECT', opinion.value.trim());
          if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
          U.closeModal(); UI.toast('已驳回，业务单据状态已回退', 'warn', ap.approval_no); App.rerender();
        }
      }, '驳回'));
      footer.push(h('button', {
        class: 'btn btn-primary',
        onclick: function () {
          if (ap.sensitive && otpInput.value !== otp) { UI.toast('请先完成二次身份验证', 'danger'); return; }
          var r = Store.Actions.approvalAct(ap.approval_no, 'APPROVE', opinion.value.trim());
          if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
          U.closeModal();
          UI.toast(r.final === 'APPROVED' ? '审批链路全部通过，业务动作已执行' : '本级已通过，流转至下一级审批', 'ok', ap.approval_no);
          App.rerender();
        }
      }, '审批通过'));
    } else if (ap.status === 'PENDING') {
      var step = Approval.currentStep(ap);
      body.appendChild(U.alertBox('info', '当前环节需由「<b>' + step.role_name + '</b>」处理，请切换右上角角色。'));
      if ((ap.initiator_user && ap.initiator_user === Store.currentUser().user_id) || (!ap.initiator_user && ap.initiator === S.role)) {
        footer.push(h('button', {
          class: 'btn', onclick: function () {
            var r = Store.Actions.approvalWithdraw(ap.approval_no);
            if (!r.ok) { UI.toast(r.msg, 'warn'); return; }
            U.closeModal(); UI.toast('已撤回', 'warn'); App.rerender();
          }
        }, '撤回申请'));
      }
    }
    if (ap.route) footer.push(h('button', { class: 'btn', onclick: function () { U.closeModal(); U.goto(ap.route); } }, '查看业务单据'));
    footer.push(h('button', { class: 'btn btn-ghost', onclick: U.closeModal }, '关闭'));

    U.modal('审批单 ' + ap.approval_no, body, footer, { size: 'wide' });
  }

  /* ---------------- 列表列定义 ---------------- */
  function cols(S, showAction) {
    var c = [
      { label: '审批单号', render: function (a) { return h('span', { class: 'mono', style: 'font-size:11.5px' }, a.approval_no); } },
      { label: '类型', render: function (a) { return bizBadge(a.biz_type); }, width: '95px' },
      { label: '事项', render: function (a) { return a.title; } },
      { label: '影响金额', num: true, render: function (a) { return U.money(a.amount, { signed: true }); } },
      { label: '发起人 / 角色', render: function (a) { return actorLabel(a.initiator_role || a.initiator, a.initiator_user_name); }, width: '145px' },
      { label: '当前环节', render: function (a) {
        if (a.status !== 'PENDING') return h('span', { class: 'faint' }, '—');
        var s = Approval.currentStep(a);
        return h('span', null, [U.badge('第 ' + s.seq + ' / ' + a.chain.length + ' 级', 'brand'), ' ', s.role_name]);
      } },
      { label: '审批链', render: function (a) {
        return h('span', { class: 'faint', style: 'font-size:11px' }, a.chain.map(function (s) { return s.role_name; }).join(' → '));
      } },
      { label: 'SLA', render: function (a) {
        return h('span', { class: Approval.isOverdue(S, a) ? 'neg' : '' }, a.sla_deadline + (Approval.isOverdue(S, a) ? ' ⚠' : ''));
      }, width: '110px' },
      { label: '状态', render: function (a) { return apStatus(a.status); }, width: '85px' }
    ];
    if (showAction) c.push({
      label: '', width: '80px', render: function (a) {
        return h('button', {
          class: 'btn btn-sm ' + (Approval.canAct(S, a) ? 'btn-primary' : ''),
          onclick: function (e) { e.stopPropagation(); openApproval(a); }
        }, Approval.canAct(S, a) ? '去审批' : '查看');
      }
    });
    return c;
  }

  /* =========================================================================
   * 审批中心
   * ======================================================================= */
  UI.route('approvals', {
    title: '审批中心',
    crumbs: ['横向支撑', '审批中心 · 我的待办'],
    render: function (root, params) {
      var S = Store.get();
      var active = params.tab || 'todo';
      var todos = Approval.myTodos(S);
      var mine = Approval.mySubmitted(S);
      var pending = S.approvals.filter(function (a) { return a.status === 'PENDING'; });
      var overdue = pending.filter(function (a) { return Approval.isOverdue(S, a); });

      root.appendChild(U.pageHead('审批中心 · 我的待办',
        '规则发布、范围重算、结算付款、调整项、账户变更、账单作废等所有需要分级审批的动作，统一在此处理。' +
        '<b>审批链路由「业务类型 + 影响金额 + 风险标记」自动生成，不允许人工指定</b>；发起人不得审批自己提交的单据；敏感操作需二次身份验证。',
        [h('span', { class: 'faint' }, '当前操作人：' + Store.currentUser().user_name + ' / ' + Store.roleName(S.role))]));

      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('待我审批', todos.length, todos.length ? '切换角色可看到不同待办' : '当前角色暂无待办', todos.length ? 'warn' : 'ok'),
        U.stat('审批中', pending.length, '全系统在途审批单'),
        U.stat('超期未审', overdue.length, overdue.length ? '已超 SLA，需升级' : '无超期', overdue.length ? 'danger' : 'ok'),
        U.stat('我发起的', mine.length, '通过 ' + mine.filter(function (a) { return a.status === 'APPROVED'; }).length +
          ' · 驳回 ' + mine.filter(function (a) { return a.status === 'REJECTED'; }).length)
      ]));

      var body = h('div');
      root.appendChild(U.tabs([
        { key: 'todo', label: '我的待办' + (todos.length ? '（' + todos.length + '）' : '') },
        { key: 'mine', label: '我发起的' },
        { key: 'all', label: '全部审批单' },
        { key: 'rules', label: '分级审批规则' }
      ], active, function (k) { U.goto('/approvals?tab=' + k); }));
      root.appendChild(body);

      if (active === 'todo') {
        body.appendChild(todos.length
          ? U.card(null, U.table(cols(S, true), todos, { onRow: openApproval }), { tight: true })
          : U.card(null, h('div', { class: 'empty' }, '当前角色「' + Store.roleName(S.role) + '」暂无待办。切换右上角角色可看到其他环节的待办。'), { tight: true }));
        body.appendChild(U.alertBox('info',
          '待办按<b>当前角色</b>过滤：审批单流转到哪一级，就只有那一级对应的角色能看到「去审批」。' +
          '这样审批链路既可见又不可跳级，也不会出现「谁都能批」的情况。'));
      }
      if (active === 'mine') {
        body.appendChild(U.card(null, U.table(cols(S, true), mine, { onRow: openApproval, empty: '当前角色未发起过审批' }), { tight: true }));
      }
      if (active === 'all') {
        body.appendChild(U.card(null, U.pagedTable(cols(S, true), S.approvals, { onRow: openApproval, pageSize: 15, empty: '暂无审批单' }), { tight: true }));
      }
      if (active === 'rules') {
        body.appendChild(U.card('分级审批规则（系统按此自动生成审批链）', U.table([
          { label: '业务类型', render: function (r) { return bizBadge(r.t); }, width: '100px' },
          { label: '分级条件', key: 'c' },
          { label: '审批链路', render: function (r) { return h('span', null, r.chain.map(function (x) { return U.badge(x, 'brand'); })); } },
          { label: '二次验证', render: function (r) { return r.s ? U.badge('需要', 'danger') : '—'; }, width: '80px' },
          { label: '出处', render: function (r) { return h('span', { class: 'tag-ref' }, r.ref); }, width: '110px' }
        ], [
          { t: 'RULE_PUBLISH', c: '月度差额 < 1 万元', chain: ['财务核算'], s: true, ref: '5.8.1' },
          { t: 'RULE_PUBLISH', c: '1 万 ~ 10 万元', chain: ['财务核算', '财务负责人'], s: true, ref: '5.8.1' },
          { t: 'RULE_PUBLISH', c: '> 10 万元 或 追溯生效', chain: ['财务负责人', '风控', '业务负责人'], s: true, ref: '5.8.1' },
          { t: 'RECALC', c: '全部范围重算', chain: ['财务负责人', '风控'], s: true, ref: '6.9.3 / 14.4' },
          { t: 'SETTLE', c: '单笔 < 10 万元', chain: ['财务核算', '财务复核'], s: true, ref: '8.8.2' },
          { t: 'SETTLE', c: '10 万 ~ 100 万元', chain: ['财务核算', '财务负责人'], s: true, ref: '8.8.2' },
          { t: 'SETTLE', c: '> 100 万元', chain: ['财务核算', '财务负责人', '业务负责人'], s: true, ref: '8.8.2' },
          { t: 'SETTLE', c: '触发任一警告项 → 在原层级 +1 级', chain: ['…', '风控'], s: true, ref: '8.8.2' },
          { t: 'ADJUSTMENT', c: '单笔 ≤ 10 万元', chain: ['财务复核'], s: true, ref: '7.6.2' },
          { t: 'ADJUSTMENT', c: '单笔 > 10 万元', chain: ['财务负责人', '业务负责人'], s: true, ref: '7.6.2' },
          { t: 'ACCOUNT', c: '银行账户新增 / 修改', chain: ['财务复核', '财务负责人'], s: true, ref: '4.7 / 14.4' },
          { t: 'BILL_VOID', c: '账单作废', chain: ['财务复核'], s: true, ref: '14.4' }
        ], { compact: true }), { tight: true }));
        body.appendChild(U.card('审批流的三条硬约束', h('div', null, [
          U.alertBox('danger', '<b>① 审批链不可人工指定</b>：由业务类型 + 影响金额 + 风险标记计算得出。想少一级审批，只能把影响金额做小，不能改流程。'),
          U.alertBox('danger', '<b>② 发起人不得审批自己提交的单据</b>：与银行账户的双人复核（V-P03）、结算的 FC-05 同源，防单人作案与单人失误。' +
            '发起人若恰为链路第一级角色，<b>发起动作本身视同该级复核已完成</b>；若因此导致无人可审（单级链），系统<b>自动升级一级</b>。'),
          U.alertBox('danger', '<b>③ 敏感操作需二次身份验证</b>：改费率、发布规则、发起重算、变更账户、发起付款、作废账单 —— PRD 14.4 敏感操作清单全部覆盖，且不提供「跳过校验」入口。')
        ])));
      }
    }
  });

  window.ViewsApproval = { openApproval: openApproval, bizBadge: bizBadge, apStatus: apStatus, chainView: chainView };
})();
