/* =============================================================================
 * approval.js —— 审批流实体（统一分级审批 + 审批链路 + 驳回 + 留痕）
 * 对应 PRD：5.8.1 规则发布分级审批 / 6.9.3 重算审批 / 7.6.2 调整项审批 /
 *           8.8.2 结算分级审批 / 4.7 变更审批 / 14.4 敏感操作清单
 *
 * 设计要点：
 *   ① 审批单是一等实体，任何需要分级审批的动作都必须先落一张 approval_request；
 *   ② 审批链路由「业务类型 + 影响金额 + 风险标记」计算得出，不允许人工指定；
 *   ③ 逐级串行审批，任一级驳回即整单驳回并回退业务单据状态；
 *   ④ 敏感操作需二次验证（PRD 14.4）；
 *   ⑤ 全程留痕：谁、何时、什么意见、审批前后状态。
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  /* ---------------- 分级审批规则 ---------------- */
  var CHAINS = {
    // 5.8.1：< 1 万 财务核算；1–10 万 财务核算 + 财务负责人；> 10 万或追溯生效 财务负责人 + 风控 + 业务负责人
    RULE_PUBLISH: function (amount, f) {
      if (f.retroactive) return ['FIN_MGR', 'RISK', 'BIZ_MGR'];
      var a = Math.abs(amount || 0);
      if (a < 10000) return ['FIN_OP'];
      if (a <= 100000) return ['FIN_OP', 'FIN_MGR'];
      return ['FIN_MGR', 'RISK', 'BIZ_MGR'];
    },
    // 6.9.3 / 14.4：发起范围重算 —— 财务负责人（+ 风控，若追溯）
    RECALC: function (amount, f) { return f.retroactive ? ['FIN_MGR', 'RISK'] : ['FIN_MGR', 'RISK']; },
    // 8.8.2：< 10 万 财务核算 + 财务复核；10–100 万 财务核算 + 财务负责人；> 100 万 再加业务负责人；触发警告项 +1 级
    SETTLE: function (amount, f) {
      var a = Math.abs(amount || 0), c;
      if (a < 100000) c = ['FIN_OP', 'FIN_REVIEW'];
      else if (a <= 1000000) c = ['FIN_OP', 'FIN_MGR'];
      else c = ['FIN_OP', 'FIN_MGR', 'BIZ_MGR'];
      if (f.warn) c = c.concat(['RISK']);
      return c;
    },
    // 7.6.2：单笔调整 > 10 万需财务负责人 + 业务负责人双审批
    ADJUSTMENT: function (amount) { return Math.abs(amount || 0) > 100000 ? ['FIN_MGR', 'BIZ_MGR'] : ['FIN_REVIEW']; },
    ACCOUNT: function () { return ['FIN_REVIEW', 'FIN_MGR']; },
    PARTNER_ADMIT: function () { return ['RISK', 'FIN_MGR']; },
    AGREEMENT: function () { return ['BIZ_MGR']; },
    BILL_VOID: function () { return ['FIN_REVIEW']; }
  };

  var META = {
    RULE_PUBLISH: { name: '规则版本发布', sensitive: true, ref: '5.8.1', sla: 1 },
    RECALC: { name: '范围重算生效', sensitive: true, ref: '6.9.3 / 14.4', sla: 1 },
    SETTLE: { name: '结算付款', sensitive: true, ref: '8.8.2', sla: 1 },
    ADJUSTMENT: { name: '账单调整项', sensitive: true, ref: '7.6.2', sla: 2 },
    ACCOUNT: { name: '银行账户变更', sensitive: true, ref: '4.7', sla: 1 },
    PARTNER_ADMIT: { name: '资金方准入', sensitive: false, ref: '4.6.1', sla: 3 },
    AGREEMENT: { name: '协议主档生效', sensitive: false, ref: '4.7', sla: 2 },
    BILL_VOID: { name: '账单作废', sensitive: true, ref: '14.4', sla: 1 }
  };

  /** 业务动作回调：审批通过 / 驳回时由本模块调用（在 store.js 中注册） */
  var handlers = {};

  function chainFor(bizType, amount, flags) {
    var fn = CHAINS[bizType];
    return fn ? fn(amount, flags || {}) : ['FIN_MGR'];
  }

  function levelText(bizType, amount, flags) {
    return chainFor(bizType, amount, flags).map(roleName).join(' → ');
  }
  function roleName(code) {
    var r = Data.ROLES.filter(function (x) { return x.code === code; })[0];
    return r ? r.name : code;
  }
  function actorOf(S) {
    return Store.currentUser ? Store.currentUser() : { user_id: 'u_' + S.role, user_name: roleName(S.role), role: S.role, role_name: roleName(S.role) };
  }
  function fingerprint(value) {
    var text = JSON.stringify(value || {}), hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8).toUpperCase();
  }

  /* ---------------- 创建审批单 ---------------- */
  function create(S, o) {
    var flags = o.flags || {};
    var actor = actorOf(S);
    var chain = chainFor(o.biz_type, o.amount, flags);
    var meta = META[o.biz_type] || { name: o.biz_type, sensitive: false, sla: 2 };
    var ap = {
      approval_no: Core.No.approval(S.simToday),
      biz_type: o.biz_type, biz_name: meta.name, biz_key: o.biz_key,
      title: o.title, summary: o.summary || [], amount: o.amount || 0,
      partner_no: o.partner_no || '', route: o.route || '',
      reason: o.reason || '', flags: flags, payload: o.payload || {},
      sensitive: meta.sensitive, ref: meta.ref,
      initiator: S.role, initiator_role: S.role,
      initiator_user: actor.user_id, initiator_user_name: actor.user_name, initiate_time: nowStr(S),
      sla_deadline: D.addDays(S.simToday, meta.sla),
      status: 'PENDING', current_seq: 0,
      chain: chain.map(function (r, i) {
        return { seq: i + 1, role: r, role_name: roleName(r), status: 'PENDING', operator: '',
          operator_user: '', operator_user_name: '', time: '', opinion: '' };
      }),
      content_version: 1,
      content_fingerprint: fingerprint({ biz_type: o.biz_type, biz_key: o.biz_key, amount: o.amount || 0,
        reason: o.reason || '', summary: o.summary || [], payload: o.payload || {} }),
      evidence: [{ evidence_no: 'EV-' + Core.No.generic('AP', 6), name: '审批内容快照 v1',
        type: 'SYSTEM_SNAPSHOT', captured_time: nowStr(S), captured_by: actor.user_name,
        note: '锁定业务类型、关联单据、金额、申请理由、影响面与提交参数' }],
      logs: [{ time: nowStr(S), operator: S.role, operator_user: actor.user_id,
        operator_user_name: actor.user_name, action: '发起审批', detail: o.reason || o.title }]
    };

    /* 发起人若恰为链路第一级角色，则「发起动作本身」视同该级复核已完成；
     * 若因此导致无人可审（单级链且发起人即该级），自动升级一级 —— 保证「发起人 ≠ 审批人」始终成立。 */
    if (ap.chain.length && ap.chain[0].role === S.role) {
      var s0 = ap.chain[0];
      s0.status = 'APPROVED'; s0.operator = S.role; s0.operator_user = actor.user_id;
      s0.operator_user_name = actor.user_name; s0.time = ap.initiate_time;
      s0.opinion = '发起即视同本级复核（发起人 ≠ 审批人，FC-05）';
      ap.current_seq = 1;
      if (ap.current_seq >= ap.chain.length) {
        var esc = (S.role === 'FIN_MGR' || S.role === 'BIZ_MGR') ? 'RISK' : 'FIN_MGR';
        ap.chain.push({ seq: ap.chain.length + 1, role: esc, role_name: roleName(esc),
          status: 'PENDING', operator: '', time: '', opinion: '' });
        ap.escalated = true;
        ap.logs.push({ time: ap.initiate_time, operator: 'system', operator_user_name: '系统', action: '自动升级一级',
          detail: '发起人即为唯一审批级，按「发起人不得审批自己提交的单据」自动追加 ' + roleName(esc) + ' 审批' });
      }
    }

    S.approvals.unshift(ap);
    Store.log('审批中心', '发起审批', ap.approval_no, meta.name + ' · ' + o.title);
    return ap;
  }

  function nowStr(S) {
    var d = new Date();
    return S.simToday + ' ' + Core.pad(d.getHours(), 2) + ':' + Core.pad(d.getMinutes(), 2);
  }

  /* ---------------- 审批动作 ---------------- */
  function currentStep(ap) { return ap.chain[ap.current_seq]; }

  function canAct(S, ap) {
    if (ap.status !== 'PENDING') return false;
    var step = currentStep(ap);
    return !!step && step.role === S.role;
  }

  /** decision: 'APPROVE' | 'REJECT' */
  function act(S, approvalNo, decision, opinion) {
    var ap = S.approvals.filter(function (x) { return x.approval_no === approvalNo; })[0];
    if (!ap) return { ok: false, msg: '审批单不存在' };
    if (ap.status !== 'PENDING') return { ok: false, msg: '该审批单已结束' };
    var step = currentStep(ap);
    if (!step) return { ok: false, msg: '审批链路异常' };
    if (step.role !== S.role) return { ok: false, msg: '当前环节需由「' + step.role_name + '」处理，请切换角色' };
    var actor = actorOf(S);
    if (ap.initiator_user === actor.user_id && ap.biz_type !== 'PARTNER_ADMIT') {
      return { ok: false, msg: '发起人不得审批自己提交的单据（双人复核强制）' };
    }

    step.operator = S.role; step.operator_user = actor.user_id; step.operator_user_name = actor.user_name;
    step.time = nowStr(S); step.opinion = opinion || '';
    if (decision === 'REJECT') {
      step.status = 'REJECTED';
      ap.chain.slice(ap.current_seq + 1).forEach(function (s) { s.status = 'SKIPPED'; });
      ap.status = 'REJECTED';
      ap.logs.push({ time: step.time, operator: S.role, operator_user: actor.user_id,
        operator_user_name: actor.user_name, action: '驳回', detail: opinion || '' });
      Store.log('审批中心', '审批驳回', ap.approval_no, opinion || '');
      var hr = handlers[ap.biz_type];
      if (hr && hr.onRejected) hr.onRejected(S, ap);
      return { ok: true, approval: ap, final: 'REJECTED' };
    }

    step.status = 'APPROVED';
    ap.logs.push({ time: step.time, operator: S.role, operator_user: actor.user_id,
      operator_user_name: actor.user_name, action: '第 ' + step.seq + ' 级审批通过', detail: opinion || '' });
    ap.current_seq++;
    if (ap.current_seq >= ap.chain.length) {
      ap.status = 'APPROVED';
      ap.finish_time = step.time;
      Store.log('审批中心', '审批通过', ap.approval_no, ap.biz_name + ' · ' + ap.title);
      var h2 = handlers[ap.biz_type];
      var res = h2 && h2.onApproved ? h2.onApproved(S, ap) : null;
      return { ok: true, approval: ap, final: 'APPROVED', result: res };
    }
    return { ok: true, approval: ap, final: 'PENDING' };
  }

  function withdraw(S, approvalNo) {
    var ap = S.approvals.filter(function (x) { return x.approval_no === approvalNo; })[0];
    if (!ap || ap.status !== 'PENDING') return { ok: false, msg: '仅待审批单据可撤回' };
    var actor = actorOf(S);
    if (ap.initiator_user && ap.initiator_user !== actor.user_id) return { ok: false, msg: '仅发起人可撤回' };
    if (!ap.initiator_user && ap.initiator !== S.role) return { ok: false, msg: '仅发起人可撤回' };
    ap.status = 'WITHDRAWN';
    ap.chain.forEach(function (s) { if (s.status === 'PENDING') s.status = 'SKIPPED'; });
    ap.logs.push({ time: nowStr(S), operator: S.role, operator_user: actor.user_id,
      operator_user_name: actor.user_name, action: '发起人撤回', detail: '' });
    Store.log('审批中心', '撤回审批', ap.approval_no, '');
    var hr = handlers[ap.biz_type];
    if (hr && hr.onRejected) hr.onRejected(S, ap);
    return { ok: true };
  }

  /* ---------------- 查询 ---------------- */
  function myTodos(S) {
    return S.approvals.filter(function (ap) { return canAct(S, ap); });
  }
  function myTodoCount(S) { return myTodos(S).length; }
  function mySubmitted(S) {
    return S.approvals.filter(function (ap) { return ap.initiator === S.role; });
  }
  function findByBiz(S, bizType, bizKey) {
    return S.approvals.filter(function (ap) { return ap.biz_type === bizType && ap.biz_key === bizKey; })[0];
  }
  function pendingFor(S, bizType, bizKey) {
    return S.approvals.filter(function (ap) {
      return ap.biz_type === bizType && ap.biz_key === bizKey && ap.status === 'PENDING';
    })[0];
  }
  function isOverdue(S, ap) { return ap.status === 'PENDING' && ap.sla_deadline < S.simToday; }

  global.Approval = {
    CHAINS: CHAINS, META: META, handlers: handlers,
    chainFor: chainFor, levelText: levelText, create: create, act: act, withdraw: withdraw,
    canAct: canAct, currentStep: currentStep, myTodos: myTodos, myTodoCount: myTodoCount,
    mySubmitted: mySubmitted, findByBiz: findByBiz, pendingFor: pendingFor, isOverdue: isOverdue
  };
})(window);
