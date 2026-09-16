/* =============================================================================
 * views-master.js —— 运营监控大盘 / 模块① 资金方主数据 / 运营与审计 / 设计说明
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  /* =========================================================================
   * 运营监控大盘（PRD 15.1）
   * ======================================================================= */
  UI.route('dashboard', {
    title: '运营监控大盘',
    crumbs: ['总览', '运营监控大盘'],
    render: function (root, params) {
      var S = Store.get();
      var period = params.period || '2026-04', prevPeriod = D.prevPeriod(period);
      var evs = S.events.filter(function (e) { return D.period(e.occur_date) === period; });
      var terminal = evs.filter(function (e) { return ['CHARGED', 'IGNORED', 'REVERSED'].indexOf(e.status) >= 0; });
      var pending = evs.filter(function (e) { return ['PENDING', 'PROCESSING', 'FAILED'].indexOf(e.status) >= 0; });
      var charged = evs.filter(function (e) { return e.status === 'CHARGED'; });
      var successRate = evs.length ? (terminal.length / evs.length) : 1;
      var activePartners = S.partners.filter(function (p) { return p.status === 'ACTIVE'; });
      var snapshotOk = activePartners.filter(function (p) { return Billing.missingSnapshotDays(S, p.partner_no, period).length === 0; });
      var tie3 = S.reconRuns[period] || Store.Actions.runTieOut(period);
      var p0 = S.alerts.filter(function (a) { return a.level === 'P0' && !a.closed; });
      var p1 = S.alerts.filter(function (a) { return a.level === 'P1' && !a.closed; });
      var p2 = S.alerts.filter(function (a) { return a.level === 'P2' && !a.closed; });

      var billsAll = S.bills.filter(function (b) { return b.status !== 'VOIDED'; });
      var toGen = [period].filter(function (p) { return !S.bills.some(function (b) { return b.billing_period === p && b.status !== 'VOIDED'; }); });
      var confirming = billsAll.filter(function (b) { return b.status === 'CONFIRMING'; });
      var disputed = billsAll.filter(function (b) { return b.status === 'DISPUTED'; });
      var confirmedNoSettle = billsAll.filter(function (b) { return b.status === 'CONFIRMED' && !b.settle_no; });

      var settledAmt = M.sum(S.settleFlows.filter(function (f) { return f.status === 'SUCCESS'; }), function (f) { return f.amount; });
      var pendingSettleAmt = M.sum(S.settleOrders.filter(function (o) { return o.status === 'PENDING' || o.status === 'APPROVING'; }), function (o) { return o.settle_amount; });
      var failCnt = S.settleOrders.filter(function (o) { return o.status === 'FAILED' || o.status === 'UNKNOWN'; }).length;
      var noReceipt = S.settleFlows.filter(function (f) { return f.status === 'SUCCESS' && !f.receipt_no; }).length;
      var openDiffs = S.diffs.filter(function (d) { return d.status !== 'CLOSED'; });
      var aging = openDiffs.filter(function (d) { return d.aging_days > 15; });

      root.appendChild(U.pageHead('运营监控大盘',
        '「每天知道有没有出问题、问题在哪」。看板每个数字均可下钻至明细，不出现「看得见但点不进去」的指标（PRD 15.1.2）。',
        [
          U.selectEl(Data.PERIODS.map(function (p) { return { value: p, label: p + ' 账期' }; }), period,
            function (v) { U.goto('/dashboard?period=' + v); }),
          h('button', { class: 'btn', onclick: function () { U.goto('/daily'); } }, 'T+1 日度核算调度'),
          h('button', { class: 'btn', onclick: function () { U.goto('/tieout'); } }, '查看五级勾稽'),
          h('button', { class: 'btn btn-primary', onclick: function () { U.goto('/workbench'); } }, '前往出账工作台')
        ]));

      // 主链路
      root.appendChild(h('div', { class: 'flowchain' }, [
        h('span', { class: 'fnode' }, '① 资金方主数据'), h('span', { class: 'farrow' }, '→'),
        h('span', { class: 'fnode' }, '② 规则中心'), h('span', { class: 'farrow' }, '→'),
        h('span', { class: 'fnode' }, '③ 计费引擎'), h('span', { class: 'farrow' }, '→'),
        h('span', { class: 'fnode' }, '④ 账单中心'), h('span', { class: 'farrow' }, '→'),
        h('span', { class: 'fnode' }, '⑤ 结算中心'), h('span', { class: 'farrow' }, '→'),
        h('span', { class: 'fnode' }, '⑥ 对账中心'),
        h('span', { class: 'faint', style: 'margin-left:10px' }, '协议 → 计费 → 账单 → 结算 → 对账')
      ]));

      var roleTasks = [];
      function task(title, count, deadline, route, level) {
        if (count > 0) roleTasks.push({ title: title, count: count, deadline: deadline, route: route, level: level || '待处理' });
      }
      if (S.role === 'BD') task('待准入资金方', S.partners.filter(function (p) { return p.status === 'PENDING'; }).length, '接入 D1', '/onboard', '业务');
      if (S.role === 'FIN_OP' || S.role === 'FIN_MGR') {
        task(period + ' 待出账', toGen.length, '月结窗口', '/workbench', '阻断项优先');
        task('挂账待认领', S.inbounds.filter(function (i) { return i.status === 'SUSPENSE'; }).length, 'T+3', '/claim', '资金');
      }
      if (S.role === 'FIN_REVIEW' || S.role === 'FIN_MGR') {
        task('收款认领待复核', S.inbounds.filter(function (i) { return i.status === 'PENDING_REVIEW' || i.status === 'AUTO_MATCHED'; }).length, '当日', '/claim', '双人复核');
        task('审批待办', Approval.myTodos(S).length, '按审批 SLA', '/approvals', '审批');
      }
      if (S.role === 'OPS' || S.role === 'RISK' || S.role === 'FIN_MGR') {
        task('未闭环差异', S.diffs.filter(function (d) { return d.status !== 'CLOSED'; }).length, 'T+3', '/diffs', '异常');
        task('未闭环争议', S.disputes.filter(function (d) { return d.status !== 'CLOSED'; }).length, 'T+5', '/disputes', '异常');
      }
      root.appendChild(U.card('我的工作台 · ' + Store.roleName(S.role), roleTasks.length ? U.table([
        { label: '事项', key: 'title' },
        { label: '数量', num: true, render: function (t) { return U.badge(t.count, t.level === '异常' ? 'warn' : 'brand'); }, width: '70px' },
        { label: '处理时限', key: 'deadline', width: '110px' },
        { label: '控制点', key: 'level', width: '110px' },
        { label: '', width: '80px', render: function (t) { return h('button', { class: 'btn btn-sm', onclick: function () { U.goto(t.route); } }, '去处理'); } }
      ], roleTasks, { compact: true }) : U.alertBox('ok', '当前角色暂无待办。'), { tight: true }));

      /* --- 接入 SOP 快捷区 --- */
      var running = S.onboardings.filter(function (o) { return o.status === 'RUNNING'; });
      var pendingAdmit = S.partners.filter(function (p) { return p.status === 'PENDING'; });
      root.appendChild(U.card('新资金方接入（5 天 SOP）', h('div', { class: 'grid g4' }, [
        U.stat('进行中接入任务', running.length, running.length ? running.map(function (o) { return o.partner_name + ' · D' + Math.min(o.stage, 5); }).join('；') : '暂无', running.length ? 'warn' : '', function () { U.goto('/onboard'); }),
        U.stat('待准入资金方', pendingAdmit.length, pendingAdmit.map(function (p) { return p.partner_short_name; }).join('、') || '—', pendingAdmit.length ? 'warn' : '', function () { U.goto('/partners?status=PENDING'); }),
        U.stat('已完成接入', S.onboardings.filter(function (o) { return o.status === 'DONE'; }).length, '目标周期 5 天', 'ok', function () { U.goto('/onboard'); }),
        h('div', { class: 'stat', style: 'display:flex;flex-direction:column;justify-content:center;gap:6px' }, [
          h('button', { class: 'btn btn-primary', onclick: function () { U.goto('/onboard'); } }, '进入接入 SOP 工作台'),
          h('button', { class: 'btn', onclick: function () { U.goto('/partner-edit'); } }, '＋ 新建资金方档案')
        ])
      ]), { ref: '10.1' }));

      /* --- 账期概览：所有指标使用同一账期，避免累计、当期和历史口径混用 --- */
      root.appendChild(h('h3', { class: 'sec' }, ['账期概览 · ' + period,
        h('span', { class: 'tag-ref' }, '统计截至业务日 ' + S.simToday)]));
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('事件接入', M.fmt(evs.length, 0), '已计费 ' + charged.length + ' · 已忽略 ' + (terminal.length - charged.length), '', function () { U.goto('/events'); }),
        U.stat('事件处理率', M.pct(successRate, 2), '待处理 ' + pending.length + ' 条', pending.length ? 'warn' : 'ok', function () { U.goto('/events?status=PENDING'); }),
        U.stat('快照到齐', snapshotOk.length + ' / ' + activePartners.length, period + ' 账期日终余额快照', snapshotOk.length === activePartners.length ? 'ok' : 'danger', function () { U.goto('/daily'); }),
        U.stat('五级勾稽', tie3 && tie3.pass ? '通过' : '不平', period + ' 账期 · ' + (tie3 ? tie3.failCount : '—') + ' 项不平', tie3 && tie3.pass ? 'ok' : 'danger', function () { U.goto('/tieout?period=' + period); })
      ]));

      /* --- 账期进度 / 资金进度 --- */
      root.appendChild(h('div', { class: 'grid g2 mt14' }, [
        U.card('账期进度', h('div', { class: 'grid g2' }, [
          U.stat('待出账账期', toGen.length, toGen.join(', ') || '—', toGen.length ? 'warn' : 'ok', function () { U.goto('/workbench'); }),
          U.stat('待确认账单', confirming.length, '推送后等待资金方确认', '', function () { U.goto('/bills?status=CONFIRMING'); }),
          U.stat('争议中', disputed.length, '争议单 ' + S.disputes.filter(function (d) { return d.status !== 'CLOSED'; }).length + ' 条', disputed.length ? 'warn' : '', function () { U.goto('/disputes'); }),
          U.stat('已确认待结算', confirmedNoSettle.length, '等待发起结算', '', function () { U.goto('/settle'); })
        ]), { ref: '15.1.1' }),
        U.card('资金进度', h('div', { class: 'grid g2' }, [
          U.stat('待结算金额', M.fmtShort(pendingSettleAmt), '结算单待审批/待发起', '', function () { U.goto('/settle'); }),
          U.stat('已结算金额', M.fmtShort(settledAmt), S.settleFlows.length + ' 笔结算流水', 'ok', function () { U.goto('/settle'); }),
          U.stat('失败 / 未知', failCnt, failCnt ? '需人工确认，禁止自动重试' : '无异常', failCnt ? 'danger' : 'ok', function () { U.goto('/settle'); }),
          U.stat('回单缺失', noReceipt, 'L4→L5 勾稽前置', noReceipt ? 'danger' : 'ok', function () { U.goto('/receipts'); })
        ]), { ref: '8.9' })
      ]));

      /* --- 异常与待办 --- */
      root.appendChild(h('h3', { class: 'sec' }, ['异常与待办', h('span', { class: 'tag-ref' }, '9.6 资损监控 / 14.4 敏感操作')]));
      var todos = Approval.myTodos(S);
      var apPending = S.approvals.filter(function (a) { return a.status === 'PENDING'; });
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('🔴 P0', p0.length, '已发生或极可能发生资损', p0.length ? 'danger' : 'ok'),
        U.stat('🟠 P1 / 🟡 P2', p1.length + ' / ' + p2.length, '数据不一致 / 效率质量', p1.length ? 'danger' : (p2.length ? 'warn' : 'ok')),
        U.stat('待我审批', todos.length, '在途审批单 ' + apPending.length + ' 张 · 当前角色 ' + Store.roleName(S.role),
          todos.length ? 'warn' : 'ok', function () { U.goto('/approvals'); }),
        U.stat('待处理差异', openDiffs.length, '老化 > 15 天：' + aging.length, openDiffs.length ? 'warn' : 'ok', function () { U.goto('/diffs'); })
      ]));

      if (S.alerts.length) {
        root.appendChild(U.card('告警列表', U.table([
          { label: '级别', width: '70px', render: function (a) { return U.levelBadge(a.level); } },
          { label: '标题', key: 'title', width: '220px' },
          { label: '说明', key: 'msg' },
          { label: '时间', key: 'time', width: '120px' },
          { label: '', width: '80px', render: function (a) { return a.link ? h('button', { class: 'btn btn-sm', onclick: function () { location.hash = a.link.replace('#', ''); } }, '处理') : null; } }
        ], S.alerts, { compact: true }), { tight: true, ref: '9.6.2' }));
      }

      /* --- 资金方健康度 --- */
      root.appendChild(h('h3', { class: 'sec' }, '资金方健康度'));
      var rows = activePartners.map(function (p) {
        var all = S.eng.feeFlows.filter(function (f) { return f.partner_no === p.partner_no; });
        var pf = all.filter(function (f) { return f.billing_period === period; });
        var m3 = M.sum(all.filter(function (f) { return f.billing_period === prevPeriod; }), function (f) { return f.fee_amount; });
        var m4 = M.sum(pf, function (f) { return f.fee_amount; });
        var rev = M.sum(pf.filter(function (f) { return f.flow_type === 'REVERSAL'; }), function (f) { return Math.abs(f.fee_amount); });
        var gross = M.sum(pf.filter(function (f) { return f.fee_amount > 0; }), function (f) { return f.fee_amount; });
        var revRate = gross ? rev / gross : 0;
        var diffs = S.diffs.filter(function (d) { return d.partner_no === p.partner_no && d.status !== 'CLOSED'; });
        return { p: p, flows: pf.length, m3: m3, m4: m4, revRate: revRate, diffs: diffs.length };
      });
      root.appendChild(U.card(null, U.table([
        { label: '资金方', render: function (r) { return U.link(r.p.partner_short_name, '/partner/' + r.p.partner_no); } },
        { label: '编号', render: function (r) { return h('span', { class: 'mono' }, r.p.partner_no); } },
        { label: '类型', render: function (r) { return U.badge(({ BANK: '银行', TRUST: '信托', CONSUMER_FINANCE: '消金', GUARANTEE: '担保', ABS: 'ABS', CHANNEL: '通道', OTHER: '其他' })[r.p.partner_type], 'info'); } },
        { label: '费用流水', num: true, render: function (r) { return M.fmt(r.flows, 0); } },
        { label: prevPeriod + ' 费用', num: true, render: function (r) { return U.money(r.m3); } },
        { label: period + ' 费用', num: true, render: function (r) { return U.money(r.m4); } },
        { label: '冲正率', num: true, render: function (r) { return h('span', { class: 'num ' + (r.revRate > 0.05 ? 'neg' : '') }, M.pct(r.revRate, 2)); } },
        { label: '未闭环差异', num: true, render: function (r) { return r.diffs ? U.badge(r.diffs, 'warn') : '0'; } },
        { label: '状态', render: function (r) { return U.statusBadge(r.p.status); } }
      ], rows, { onRow: function (r) { U.goto('/partner/' + r.p.partner_no); } }), { tight: true }));

      /* --- 度量指标 --- */
      root.appendChild(h('h3', { class: 'sec' }, ['度量指标', h('span', { class: 'tag-ref' }, '15.4 / 1.7')]));
      var cfgRate = 1;
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('新资金方接入周期', '5 天', '现状 20 天 → 目标 5 天', 'ok'),
        U.stat('月末出账时长', '3 小时', '现状 5 天（日度核算前置分摊）', 'ok'),
        U.stat('配置化率', M.pct(cfgRate, 0), '免发版即可完成的协议变更占比', 'ok'),
        U.stat('资损金额', '0.00', '勾稽不平即阻断出账', 'ok')
      ]));
    }
  });

  /* =========================================================================
   * 模块① 资金方主数据 —— 列表
   * ======================================================================= */
  UI.route('partners', {
    title: '资金方主数据',
    crumbs: ['模块①', '资金方主数据'],
    render: function (root, params) {
      var S = Store.get();
      var f = { type: '', status: (params && params.status) || '', kw: '' };
      var listBox = h('div');
      function draw() {
        listBox.innerHTML = '';
        var rows = S.partners.filter(function (p) {
          return (!f.type || p.partner_type === f.type) && (!f.status || p.status === f.status) &&
            (!f.kw || (p.partner_name + p.partner_no + p.partner_short_name).indexOf(f.kw) >= 0);
        });
        listBox.appendChild(U.card(null, U.table([
          { label: '编号', width: '90px', render: function (p) { return h('span', { class: 'mono' }, p.partner_no); } },
          { label: '机构名称', render: function (p) { return h('div', null, [h('div', null, p.partner_short_name), h('div', { class: 'faint', style: 'font-size:11px' }, p.partner_name)]); } },
          { label: '类型', render: function (p) { return ({ BANK: '银行', TRUST: '信托', CONSUMER_FINANCE: '消费金融', GUARANTEE: '融资担保', ABS: 'ABS 计划', CHANNEL: '通道', OTHER: '其他' })[p.partner_type]; } },
          { label: '角色', render: function (p) { return h('span', null, p.partner_roles.map(function (r) { return U.badge(({ FUNDER: '资金方', GUARANTOR: '担保方', CHANNEL: '通道方' })[r], 'info'); })); } },
          { label: '合作起始', key: 'coop_start_date', width: '95px' },
          { label: '在线协议', num: true, render: function (p) { return S.agreements.filter(function (a) { return a.partner_no === p.partner_no; }).length; } },
          { label: '本月费用', num: true, render: function (p) { return U.money(M.sum(S.eng.feeFlows.filter(function (x) { return x.partner_no === p.partner_no && x.billing_period === '2026-04'; }), function (x) { return x.fee_amount; })); } },
          { label: '状态', width: '90px', render: function (p) { return U.statusBadge(p.status); } },
          { label: '归属 BD', key: 'owner_user_id', width: '100px' }
        ], rows, { onRow: function (p) { U.goto('/partner/' + p.partner_no); }, empty: '无匹配资金方' }), { tight: true }));
      }
      root.appendChild(U.pageHead('资金方主数据',
        '管住「和谁合作、钱走哪个账户、协议的不变要素是什么」。本模块只承载<b>合作期内不变</b>的要素；任何会变、且变了可能影响历史费用的要素都在规则中心（PRD 3.2.2）。',
        [
          h('button', { class: 'btn', onclick: function () { U.goto('/onboard'); } }, '接入 SOP（5 天）'),
          h('button', { class: 'btn', onclick: function () { U.goto('/rules'); } }, '前往规则中心 →'),
          h('button', { class: 'btn btn-primary', disabled: !Store.can('partner.edit'), onclick: function () { U.goto('/partner-edit'); } }, '＋ 新建资金方')
        ]));

      root.appendChild(h('div', { class: 'filters' }, [
        U.field('机构类型', U.selectEl([{ value: '', label: '全部' }].concat(
          [['BANK', '银行'], ['TRUST', '信托'], ['CONSUMER_FINANCE', '消费金融'], ['GUARANTEE', '融资担保'], ['OTHER', '其他']]
            .map(function (x) { return { value: x[0], label: x[1] }; })), '', function (v) { f.type = v; draw(); })),
        U.field('状态', U.selectEl([{ value: '', label: '全部' }].concat(
          ['PENDING', 'ADMITTED', 'ACTIVE', 'SUSPENDED', 'TERMINATED'].map(function (x) { return { value: x, label: U.statusText(x) }; })),
          f.status, function (v) { f.status = v; draw(); })),
        U.field('关键词', h('input', { type: 'text', placeholder: '名称 / 编号', oninput: function (e) { f.kw = e.target.value; draw(); } }))
      ]));
      root.appendChild(listBox);
      draw();

      root.appendChild(U.card('模块边界：资金方主数据 vs 规则中心', U.table([
        { label: '维度', key: 'k', width: '110px' },
        { label: '① 资金方主数据', key: 'a' },
        { label: '② 规则中心', key: 'b' }
      ], [
        { k: '承载内容', a: '主体、账户、开票信息、协议类型与期限、额度、适用产品与渠道', b: '计费项、计费基数、费率、阶梯档位、结算周期、生效区间' },
        { k: '变更频率', a: '低（开户、换账户、续签）', b: '高（费率调整、新增计费项、阶梯换档）' },
        { k: '版本化', a: '变更留痕即可，不做时间切片路由', b: '必须版本化，按事件发生日路由' },
        { k: '主要责任人', a: '资金合作 BD + 财务（账户需双人复核）', b: 'BD + 财务核算（需试算验证后发布）' },
        { k: '变更影响', a: '不改变历史费用', b: '可能追溯影响历史费用，需评估影响面并可能触发重算' }
      ], { compact: true }), { tight: true, ref: 'ADR-9 / 3.2.2' }));
    }
  });

  /* =========================================================================
   * 资金方详情
   * ======================================================================= */
  UI.route('partner', {
    title: '资金方详情',
    crumbs: ['模块①', '资金方主数据', '详情'],
    render: function (root, params) {
      var S = Store.get();
      var p = S.partnerMap[params.id];
      if (!p) { root.appendChild(U.alertBox('danger', '未找到资金方 ' + params.id)); return; }
      root.appendChild(U.pageHead(p.partner_short_name + ' · ' + p.partner_no,
        p.partner_name + ' ｜ ' + p.remark,
        [
          U.statusBadge(p.status),
          h('button', { class: 'btn btn-primary', disabled: !Store.can('partner.edit'), onclick: function () { U.goto('/partner-edit/' + p.partner_no); } }, '编辑档案 / 状态流转'),
          h('button', { class: 'btn', onclick: function () { U.goto('/partners'); } }, '返回列表')
        ]));

      var active = params.tab || 'base';
      var body = h('div');
      root.appendChild(U.tabs([
        { key: 'base', label: '基础信息' }, { key: 'account', label: '银行账户' },
        { key: 'invoice', label: '开票信息' }, { key: 'agreement', label: '协议列表' },
        { key: 'change', label: '变更历史' }
      ], active, function (k) { U.goto('/partner/' + p.partner_no + '?tab=' + k); }));
      root.appendChild(body);

      if (active === 'base') {
        body.appendChild(U.card('主体信息', U.kv([
          ['机构全称', p.partner_name], ['简称', p.partner_short_name],
          ['统一社会信用代码', h('span', { class: 'mono' }, p.unified_social_credit_code)],
          ['机构类型', ({ BANK: '银行', TRUST: '信托', CONSUMER_FINANCE: '消费金融', GUARANTEE: '融资担保', OTHER: '其他' })[p.partner_type]],
          ['角色标签', h('span', null, p.partner_roles.map(function (r) { return U.badge(({ FUNDER: '资金方', GUARANTOR: '担保方', CHANNEL: '通道方' })[r], 'info'); }))],
          ['金融许可证号', p.license_no], ['监管机构', p.regulator],
          ['合作起始日', p.coop_start_date], ['准入审批单号', p.admission_approval_no],
          ['归属 BD', p.owner_user_id], ['状态', U.statusBadge(p.status)]
        ], 'kv-2col'), { ref: '4.2' }));
        body.appendChild(U.card('生命周期状态机', h('div', null, [
          h('pre', { class: 'code' },
            '待准入 PENDING ──审批通过──▶ 已准入 ADMITTED ──首份协议生效──▶ 合作中 ACTIVE\n' +
            '                                                                    │\n' +
            '                                              暂停合作 ◀──SUSPENDED──┤\n' +
            '                                                    │                │\n' +
            '                                                    └──恢复──────────┘\n' +
            '                                                                     │\n' +
            '                                                       终止 TERMINATED ◀──所有协议终止'),
          h('div', { class: 'mt8' }, U.table([
            { label: '状态', key: 's', width: '120px' }, { label: '可执行操作', key: 'o' }, { label: '约束', key: 'c' }
          ], [
            { s: 'PENDING 待准入', o: '编辑、提交审批', c: '不可创建协议' },
            { s: 'ADMITTED 已准入', o: '创建协议、维护账户', c: '不可发起结算' },
            { s: 'ACTIVE 合作中', o: '全部操作', c: '—' },
            { s: 'SUSPENDED 暂停', o: '查询、存量结算', c: '不可新增协议版本，不可新增计费；存量账单仍可结算' },
            { s: 'TERMINATED 终止', o: '仅查询', c: '需先确认无未结清账单' }
          ], { compact: true }))
        ]), { ref: '4.6.1' }));
      }

      if (active === 'account') {
        var accts = S.accounts.filter(function (a) { return a.partner_no === p.partner_no; });
        body.appendChild(U.alertBox('warn',
          '<b>资损防控第一道闸门。</b>计费算错会产生错误账单，但账户配错会把钱直接付给错误的对象，且极难追回。三重控制：<b>双人复核</b>（录入人 ≠ 复核人）、<b>白名单</b>（未入白名单不可付款）、<b>冷静期</b>（复核通过后 T+1 生效）。'));
        body.appendChild(h('div', { class: 'btn-row mb8' }, [
          h('button', {
            class: 'btn btn-primary', disabled: !Store.can('account.create'),
            onclick: function () { ViewsForm.openAccountForm(p.partner_no); }
          }, '＋ 新增银行账户'),
          h('span', { class: 'faint' }, '录入人记为当前角色（' + Store.roleName(S.role) + '），须由另一角色复核')
        ]));
        accts.forEach(function (a) {
          var mask = a.bank_account_no.slice(0, 4) + ' **** **** ' + a.bank_account_no.slice(-4);
          var inflight = S.settleOrders.filter(function (o) {
            return (o.payee_account === a.account_no_id || o.payer_account === a.account_no_id) &&
              ['PENDING', 'APPROVING', 'PROCESSING'].indexOf(o.status) >= 0;
          });
          var showFull = false;
          var maskEl = h('span', { class: 'mono' }, mask);
          body.appendChild(U.card(a.account_no_id + ' · ' + a.account_name, h('div', null, [
            U.kv([
              ['银行账号', h('span', null, [maskEl, ' ',
                h('button', {
                  class: 'btn-link', onclick: function () {
                    showFull = !showFull; maskEl.textContent = showFull ? a.bank_account_no : mask;
                    if (showFull) Store.log('资金方主数据', '查看完整账号', a.account_no_id, '敏感查询已留痕');
                  }
                }, '查看完整')])],
              ['开户行', a.bank_name], ['联行号', h('span', { class: 'mono' }, a.bank_code)],
              ['账户用途', ({ RECEIVE: '我方收款用', PAY: '我方付款用', BOTH: '收付两用' })[a.account_usage]],
              ['白名单', a.is_whitelisted ? U.badge('已进入白名单', 'ok') : U.badge('未进入白名单', 'danger')],
              ['白名单生效', a.whitelist_effective_time || '—'],
              ['打款验证', a.verify_status === 'VERIFIED' ? U.badge('已验证', 'ok') : U.badge('未验证', 'warn')],
              ['录入人 / 复核人', a.first_maker_id + ' / ' + (a.second_checker_id || '（待复核）')],
              ['状态', U.statusBadge(a.status)]
            ], 'kv-2col'),
            inflight.length ? h('div', { class: 'mt8' }, U.alertBox('info',
              '存在 <b>' + inflight.length + '</b> 张在途结算单引用该账户（' + inflight.map(function (o) { return o.settle_no; }).join(', ') +
              '）。变更请求将进入「待生效」状态，不影响在途单据（V-P08）。')) : null,
            (function () {
              var ap = Approval.pendingFor(S, 'ACCOUNT', a.account_no_id);
              return ap ? h('div', { class: 'mt8' }, U.alertBox('warn',
                '该账户变更已提交审批（<b>' + ap.approval_no + '</b>），当前环节：<b>' + Approval.currentStep(ap).role_name +
                '</b>。审批链路：' + ap.chain.map(function (s) { return s.role_name; }).join(' → ') + '。请到「审批中心 · 待办」处理。')) : null;
            })(),
            h('div', { class: 'mt8 btn-row' }, [
              a.status === 'PENDING_REVIEW' && !Approval.pendingFor(S, 'ACCOUNT', a.account_no_id) ? h('button', {
                class: 'btn btn-primary', disabled: !Store.can('account.review'),
                onclick: function () {
                  var vr = Validate.account(S, a, { reviewing: true, checker: S.role });
                  if (!Validate.pass(vr)) {
                    U.modal('复核被阻断', U.checklist(vr), [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'narrow' });
                    return;
                  }
                  var r = Store.Actions.reviewAccount(a.account_no_id);
                  if (!r.ok) UI.toast(r.msg || '无权限', 'danger', '复核失败');
                  else { UI.toast('账户已通过复核，白名单将于 ' + r.account.whitelist_effective_time + ' 生效（T+1 冷静期）', 'ok', '复核通过'); App.rerender(); }
                }
              }, '复核通过（需财务复核角色）') : null,
              a.verify_status !== 'VERIFIED' ? h('button', {
                class: 'btn', disabled: !Store.can('account.verify'),
                onclick: function () { Store.Actions.verifyAccount(a.account_no_id); UI.toast('小额打款验证已通过（V-P04）', 'ok'); App.rerender(); }
              }, '登记小额打款验证') : null,
              h('button', {
                class: 'btn', disabled: !Store.can('account.create'),
                onclick: function () { ViewsForm.openAccountForm(p.partner_no, a); }
              }, '编辑'),
              a.status !== 'DISABLED' ? h('button', {
                class: 'btn btn-danger', disabled: !Store.can('account.create'),
                onclick: function () {
                  var r = Store.Actions.disableAccount(a.account_no_id);
                  if (!r.ok) U.modal('停用被阻断（V-P08）', U.checklist(r.checks), [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'narrow' });
                  else { UI.toast('账户已停用', 'warn'); App.rerender(); }
                }
              }, '停用') : null,
              h('span', { class: 'faint' }, 'V-P03 强制录入人 ≠ 复核人；当前角色 ' + Store.roleName(S.role))
            ])
          ]), { ref: '4.3' }));
        });
        body.appendChild(U.card('账户安全三重控制', U.table([
          { label: '控制', key: 'k', width: '90px' }, { label: '规则', key: 'r' }, { label: '目的', key: 'p' }
        ], [
          { k: '双人复核', r: '账户新增与修改必须由 A 录入、B 复核，系统强制 first_maker_id ≠ second_checker_id', p: '防单人作案与单人失误' },
          { k: '白名单', r: '只有 is_whitelisted = 1 且 status = ACTIVE 的账户可被结算单引用', p: '防止临时改账户后立即付款' },
          { k: '冷静期', r: '白名单生效时间默认为复核通过后 T+1 日 00:00', p: '给异常发现留出时间窗' }
        ], { compact: true }), { tight: true, ref: '4.3.2' }));
      }

      if (active === 'invoice') {
        var inv = S.invoiceMap[p.partner_no];
        body.appendChild(h('div', { class: 'btn-row mb8' }, [
          h('button', {
            class: 'btn btn-primary', disabled: !Store.can('invoice.edit'),
            onclick: function () { ViewsForm.openInvoiceForm(p.partner_no); }
          }, inv ? '编辑开票信息' : '＋ 维护开票信息')
        ]));
        body.appendChild(inv ? U.card('开票与税务信息', U.kv([
          ['开票抬头', inv.invoice_title], ['纳税人识别号', h('span', { class: 'mono' }, inv.taxpayer_no)],
          ['注册地址', inv.reg_address], ['注册电话', inv.reg_phone],
          ['开票开户行', inv.bank_name], ['开票账号', h('span', { class: 'mono' }, inv.bank_account)],
          ['默认税率', M.pct(inv.default_tax_rate, 0)], ['票种', inv.invoice_type === 'SPECIAL' ? '增值税专用发票' : '增值税普通发票'],
          ['收票人', inv.receiver_info]
        ], 'kv-2col'), { ref: '4.4' }) : U.alertBox('warn', '未维护开票信息，出账前置校验 V-B07 将阻断出账。'));
        body.appendChild(U.alertBox('info', '税率在<b>计费项级别可覆盖</b>（不同费种适用税率可能不同），此处仅为默认值。'));
      }

      if (active === 'agreement') {
        var agrs = S.agreements.filter(function (a) { return a.partner_no === p.partner_no; });
        body.appendChild(h('div', { class: 'btn-row mb8' }, [
          h('button', {
            class: 'btn btn-primary',
            disabled: !Store.can('agreement.edit') || ['ADMITTED', 'ACTIVE'].indexOf(p.status) < 0,
            onclick: function () { U.goto('/agreement-edit?partner=' + p.partner_no); }
          }, '＋ 新建协议'),
          ['ADMITTED', 'ACTIVE'].indexOf(p.status) < 0
            ? h('span', { class: 'faint' }, '资金方状态为 ' + U.statusText(p.status) + '，不可创建协议（4.6.1 约束）') : null
        ]));
        body.appendChild(U.card('协议主档', U.table([
          { label: '协议号', render: function (a) { return U.link(a.agreement_no, '/versions/' + a.agreement_no, 'mono'); } },
          { label: '协议名称', key: 'agreement_name' },
          { label: '类型', render: function (a) { return ({ LOAN_FACILITATION: '助贷', JOINT_LOAN: '联合贷', GUARANTEE: '融担', PROFIT_SHARING: '分润' })[a.agreement_type]; } },
          { label: '合作期', render: function (a) { return a.coop_start_date + ' ~ ' + a.coop_end_date; } },
          { label: '授信额度', num: true, render: function (a) { return a.credit_limit ? M.fmtShort(a.credit_limit) : '—'; } },
          { label: '出资比例', num: true, render: function (a) { return a.funding_ratio ? M.pct(a.funding_ratio, 0) : '—'; } },
          { label: '在线版本', num: true, render: function (a) { return S.versions.filter(function (v) { return v.agreement_no === a.agreement_no; }).length; } },
          { label: '状态', render: function (a) { return U.statusBadge(a.status); } },
          { label: '', width: '90px', render: function (a) {
            return h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); U.goto('/agreement-edit/' + a.agreement_no); } }, '编辑');
          } }
        ], agrs, { onRow: function (a) { U.goto('/versions/' + a.agreement_no); } }), { tight: true, ref: '4.5' }));
        body.appendChild(U.card('协议主档不承载的内容', h('div', null, [
          h('p', { class: 'muted mb8' }, '以下要素一律下沉到规则中心（第 5 章），协议主档中不得出现：'),
          h('div', { class: 'btn-row' }, ['费率、费率类型、阶梯档位', '计费基数类型', '结算周期、账期规则', '税率（计费项级）', '保底、封顶、减免条款']
            .map(function (t) { return U.badge('❌ ' + t, 'danger'); })),
          h('p', { class: 'mt8 muted' }, h('b', null, '判定标准：'), '如果这个字段改了之后，可能需要重算历史费用，它就属于规则中心。')
        ]), { ref: '4.5.2' }));
      }

      if (active === 'change') {
        var logs = S.changeLogs.filter(function (l) { return String(l.object_id).indexOf(p.partner_no) >= 0; });
        body.appendChild(U.card('变更留痕', U.table([
          { label: '时间', key: 'operate_time', width: '130px' },
          { label: '对象类型', key: 'object_type', width: '140px' },
          { label: '对象', key: 'object_id' },
          { label: '操作', key: 'operation', width: '90px' },
          { label: '变更前', render: function (l) { return h('span', { class: 'mono faint' }, l.before_json || '—'); } },
          { label: '变更后', render: function (l) { return h('span', { class: 'mono' }, l.after_json || '—'); } },
          { label: '操作人', render: function (l) { return Store.roleName(l.operator); }, width: '100px' }
        ], logs, { compact: true, empty: '暂无变更记录（尝试到「银行账户」页复核待审账户）' }), { tight: true, ref: '4.7' }));
        body.appendChild(U.card('变更审批要求', U.table([
          { label: '变更类型', key: 'k' }, { label: '审批要求', key: 'a' }, { label: '留痕内容', key: 'l' }
        ], [
          { k: '资金方基础信息', a: '单人提交 + 单人审批', l: '变更前后快照' },
          { k: '银行账户新增 / 修改', a: '双人复核 + 财务负责人审批', l: '变更前后快照 + 复核记录 + 冷静期设置' },
          { k: '开票信息', a: '单人提交 + 财务审批', l: '变更前后快照' },
          { k: '协议主档（额度、范围）', a: '单人提交 + 业务负责人审批', l: '变更前后快照 + 影响的协议版本清单' },
          { k: '协议终止', a: '双人 + 财务 + 风控', l: '未结清金额确认单' }
        ], { compact: true }), { tight: true, ref: '4.7' }));
      }
    }
  });

  /* =========================================================================
   * 运营与审计
   * ======================================================================= */
  UI.route('ops', {
    title: '运营与审计',
    crumbs: ['横向支撑', '运营与审计'],
    render: function (root, params) {
      var S = Store.get();
      var active = params.tab || 'log';
      root.appendChild(U.pageHead('运营支撑与度量体系',
        '监控、报表、操作留痕与审计不作为独立模块，降为横向支撑能力（PRD 第 15 章）。'));
      var body = h('div');
      root.appendChild(U.tabs([
        { key: 'log', label: '操作日志' }, { key: 'perm', label: '权限矩阵' },
        { key: 'metric', label: '度量指标' }, { key: 'report', label: '报表体系' }
      ], active, function (k) { U.goto('/ops?tab=' + k); }));
      root.appendChild(body);

      if (active === 'log') {
        body.appendChild(U.card('操作日志 operation_log', U.pagedTable([
          { label: '时间', key: 'operate_time', width: '130px' },
          { label: '模块', key: 'module', width: '110px' },
          { label: '动作', key: 'action', width: '140px' },
          { label: '业务主键', render: function (l) { return h('span', { class: 'mono' }, l.biz_key || '—'); } },
          { label: '详情', key: 'detail' },
          { label: '操作人', render: function (l) { return Store.roleName(l.operator); }, width: '100px' },
          { label: 'IP', key: 'ip', width: '110px' }
        ], S.opLogs, { compact: true, pageSize: 15 }), { tight: true, ref: '15.3' }));
        body.appendChild(U.card('配置变更日志 config_change_log', U.table([
          { label: '时间', key: 'operate_time', width: '130px' },
          { label: '对象类型', key: 'object_type', width: '150px' },
          { label: '对象', key: 'object_id' },
          { label: '操作', key: 'operation', width: '90px' },
          { label: '变更前', render: function (l) { return h('span', { class: 'mono faint' }, l.before_json || '—'); } },
          { label: '变更后', render: function (l) { return h('span', { class: 'mono' }, l.after_json || '—'); } },
          { label: '操作人', render: function (l) { return Store.roleName(l.operator); }, width: '100px' }
        ], S.changeLogs, { compact: true, empty: '暂无配置变更' }), { tight: true }));
      }

      if (active === 'perm') {
        body.appendChild(U.alertBox('info', '当前角色：<b>' + Store.roleName(S.role) + '</b>。切换右上角角色可体验不同权限下的按钮可用性（数据权限：BD 仅可见归属资金方）。'));
        var funcs = Object.keys(Data.PERMS);
        body.appendChild(U.card('功能权限矩阵', U.table(
          [{ label: '功能', render: function (r) { return r.f; }, width: '190px' }].concat(
            Data.ROLES.map(function (ro) {
              return { label: ro.name.replace(/（.*）/, ''), num: false, render: function (r) {
                return Data.PERMS[r.f].indexOf(ro.code) >= 0 ? h('span', { class: 'pos' }, '●') : h('span', { class: 'faint' }, '—');
              } };
            })),
          funcs.map(function (f) { return { f: f }; }), { compact: true }), { tight: true, ref: '14.2' }));
        body.appendChild(U.card('敏感操作清单', U.table([
          { label: '操作', key: 'o' }, { label: '审批', key: 'a' }, { label: '二次验证', key: 'v', width: '90px' }
        ], [
          { o: '银行账户新增 / 修改', a: '双人复核 + 财务负责人', v: '✓' },
          { o: '规则发布（追溯生效）', a: '财务负责人 + 风控', v: '✓' },
          { o: '发起范围重算', a: '财务负责人（+ 风控若追溯）', v: '✓' },
          { o: '手工调整项 > 10 万', a: '财务负责人 + 业务负责人', v: '✓' },
          { o: '账单作废', a: '财务复核', v: '✓' },
          { o: '结算发起 > 100 万', a: '财务负责人 + 风控', v: '✓' },
          { o: '修改费种字典 / 模板', a: '财务负责人', v: '✓' },
          { o: '跳过校验', a: '不提供入口', v: '—' }
        ], { compact: true }), { tight: true, ref: '14.4' }));
      }

      if (active === 'metric') {
        body.appendChild(U.card('效率指标', U.table([
          { label: '指标', key: 'k' }, { label: '定义', key: 'd' }, { label: '现状', key: 'a' }, { label: '目标', key: 'b' }
        ], [
          { k: '新资金方接入周期', d: '条款拆解到首笔计费的日历日', a: '20 天', b: '5 天' },
          { k: '存量协议变更周期', d: '变更申请到生效的日历日', a: '周级（需发版）', b: '当日' },
          { k: '配置化率', d: '无需发版即可完成的变更数 / 总变更数', a: '0%', b: '≥ 95%' },
          { k: '月末出账时长', d: '封账到推送完成', a: '5 天', b: '3 小时' },
          { k: '日度核算完成时长', d: '04:00–06:00 批处理窗口', a: '—', b: '< 2 小时' },
          { k: '试算覆盖率', d: '发布前完成试算的版本占比', a: '—', b: '100%' }
        ], { compact: true }), { tight: true, ref: '15.4.2' }));
        var S2 = Store.get();
        var openDiffs = S2.diffs.filter(function (d) { return d.status !== 'CLOSED'; });
        var rev = M.sum(S2.eng.feeFlows.filter(function (f) { return f.flow_type === 'REVERSAL'; }), function (f) { return Math.abs(f.fee_amount); });
        var gross = M.sum(S2.eng.feeFlows.filter(function (f) { return f.fee_amount > 0; }), function (f) { return f.fee_amount; });
        body.appendChild(U.card('质量指标（实时）', U.table([
          { label: '指标', key: 'k' }, { label: '当前值', key: 'v', num: true }, { label: '目标', key: 't' }, { label: '状态', render: function (r) { return r.ok ? U.badge('达标', 'ok') : U.badge('关注', 'warn'); } }
        ], [
          { k: '勾稽不平笔数', v: (S2.reconRuns['2026-03'] ? S2.reconRuns['2026-03'].failCount : 0), t: '0', ok: !(S2.reconRuns['2026-03'] && S2.reconRuns['2026-03'].failCount) },
          { k: '事件积压', v: S2.events.filter(function (e) { return e.status === 'PENDING'; }).length, t: '0', ok: S2.events.filter(function (e) { return e.status === 'PENDING'; }).length === 0 },
          { k: '冲正率', v: M.pct(gross ? rev / gross : 0, 2), t: '< 2%', ok: (gross ? rev / gross : 0) < 0.02 },
          { k: '未闭环差异', v: openDiffs.length, t: '0', ok: openDiffs.length === 0 },
          { k: '差异老化 > 15 天', v: openDiffs.filter(function (d) { return d.aging_days > 15; }).length, t: '0', ok: openDiffs.filter(function (d) { return d.aging_days > 15; }).length === 0 },
          { k: '回单缺失', v: S2.settleFlows.filter(function (f) { return f.status === 'SUCCESS' && !f.receipt_no; }).length, t: '0', ok: true },
          { k: '账单作废率', v: M.pct(S2.bills.length ? S2.bills.filter(function (b) { return b.status === 'VOIDED'; }).length / S2.bills.length : 0, 1), t: '< 1%', ok: true }
        ], { compact: true }), { tight: true, ref: '15.4.3' }));
      }

      if (active === 'report') {
        body.appendChild(U.card('报表体系', U.table([
          { label: '分类', key: 'c', width: '100px' }, { label: '报表', key: 'n' }, { label: '使用方', key: 'u', width: '130px' }, { label: '频率', key: 'f', width: '70px' }
        ], [
          { c: '管理报表', n: '收入构成分析（按费种、资金方、产品）', u: '管理层', f: '月' },
          { c: '管理报表', n: '资金方贡献度排名', u: '管理层 / BD', f: '月' },
          { c: '财务报表', n: '应收应付台账', u: '财务', f: '日 / 月' },
          { c: '财务报表', n: '账龄分析（未结算账单）', u: '财务', f: '月' },
          { c: '财务报表', n: '税额汇总（供申报）', u: '财务', f: '月' },
          { c: '运营报表', n: '事件处理日报', u: '运营', f: '日' },
          { c: '运营报表', n: '差异处理月报（含定责分布）', u: '运营 / 管理层', f: '月' },
          { c: '对外报表', n: '资金方账单与明细', u: '资金方', f: '每账期' }
        ], { compact: true }), { tight: true, ref: '15.2' }));
        var S3 = Store.get();
        var byItem = Core.groupBy(S3.eng.feeFlows, function (f) { return f.charge_item_code; });
        var rows = Object.keys(byItem).map(function (k) {
          var fs = byItem[k];
          return { code: k, name: fs[0].charge_item_name, dir: fs[0].direction,
            m3: M.sum(fs.filter(function (f) { return f.billing_period === '2026-03'; }), function (f) { return f.fee_amount; }),
            m4: M.sum(fs.filter(function (f) { return f.billing_period === '2026-04'; }), function (f) { return f.fee_amount; }),
            cnt: fs.length };
        });
        body.appendChild(U.card('收入构成（按费种，实时）', U.table([
          { label: '费种编码', render: function (r) { return h('span', { class: 'mono' }, r.code); } },
          { label: '名称', key: 'name' },
          { label: '方向', render: function (r) { return U.dirBadge(r.dir); } },
          { label: '流水笔数', num: true, render: function (r) { return M.fmt(r.cnt, 0); } },
          { label: '2026-03', num: true, render: function (r) { return U.money(r.m3); } },
          { label: '2026-04', num: true, render: function (r) { return U.money(r.m4); } }
        ], rows, { compact: true }), { tight: true }));
      }
    }
  });

  /* =========================================================================
   * 设计说明
   * ======================================================================= */
  UI.route('about', {
    title: '设计决策与说明',
    crumbs: ['横向支撑', '设计决策 · 说明'],
    render: function (root) {
      root.appendChild(U.pageHead('设计决策与原型说明',
        '本原型按《零售信贷资金方计费结算系统 PRD v0.3》实现，含真实计算内核（阶梯、日费率、价税分离、轧差、五级勾稽），可端到端模拟操作。'));

      root.appendChild(U.card('基础设计决策记录 Decision Log', UI.table([
        { label: '#', key: 'id', width: '56px' },
        { label: '决策点', key: 'name', width: '140px' },
        { label: '结论', key: 'concl' },
        { label: '影响章节', render: function (d) { return h('span', { class: 'tag-ref' }, d.ref); }, width: '150px' }
      ], Data.DECISIONS, { compact: true }), { tight: true, ref: '0.3' }));

      root.appendChild(U.card('四个不可妥协的设计约束', h('div', { class: 'grid g2' }, [
        U.card('① 版本路由按事件发生日', h('p', { class: 'muted mb0' }, '保证历史可重现。3/28 放款、4/2 补算，仍按 V01 计费；重算结果与原账单一致。')),
        U.card('② 费用流水 Append-Only', h('p', { class: 'muted mb0' }, '任何修正通过红冲实现，绝不 UPDATE / DELETE，保证账目不可篡改。')),
        U.card('③ 基数与规则快照随流水固化', h('p', { class: 'muted mb0' }, '算费时固化基数取值与来源，复算读快照而非实时数据，保证任意时刻可复算。')),
        U.card('④ 每一级之间存在可验证的平衡等式', h('p', { class: 'muted mb0' }, '把差错的发现从「靠人看」变成「靠等式算」，勾稽不平即阻断出账。'))
      ]), { ref: '3.3' }));

      root.appendChild(U.card('本原型的实现范围', h('div', null, [
        UI.table([
          { label: '能力', key: 'k', width: '190px' }, { label: '实现方式', key: 'v' }
        ], [
          { k: '计费引擎五要素', v: '触发事件 / 计费对象 / 计费基数 / 费率模型 / 冲正机制，全部由 JSON 规则驱动，无硬编码费种逻辑' },
          { k: '费率模型', v: 'FIXED_RATIO、FIXED_AMOUNT、DAILY_RATE（360 基准）、TIER_PROGRESSIVE、TIER_FLAT，附完整验算过程' },
          { k: '精度', v: '单条流水四舍五入至分 → 再汇总；价税分离倒轧保证三段恒等；全程避免浮点累加' },
          { k: '版本化', v: '左闭右开时间切片 + 按 occur_date 路由 + 区间不重叠不留空洞校验' },
          { k: '幂等', v: 'event_id + charge_item_no + rule_version 唯一键，重复投递被拦截为 IGNORED·DUPLICATE' },
          { k: '冲正', v: '红冲式反向流水 + 部分冲正比例计算 + 累计校验（超额硬拦截）+ 跨账期调整项' },
          { k: '试算 / 重算', v: '与正式计费共用同一计算内核，仅输出目标不同；重算走影子表 + 差异比对 + 审批 + 原子生效' },
          { k: '五级勾稽', v: '等式 A~N 全部按 PRD 9.1.2 实现并实时计算，含状态一致性 S-01~S-08' },
          { k: '模拟数据', v: '固定随机种子生成 ~2,900 条业务事件、~2,600 条费用流水，覆盖 PRD 18.4 五份样例协议与 18.5 计算样例集' }
        ], { compact: true }),
        h('div', { class: 'mt14' }, U.alertBox('info',
          '<b>数据一致性说明：</b>所有数据在浏览器内存中生成与运算，刷新页面即回到初始状态（3 月账期已结算 / 4 月账期待封账）。左下角「重置模拟数据」可随时恢复。'))
      ]), { ref: '—' }));

      root.appendChild(U.card('推荐体验路径', h('div', null, [
        h('ol', { style: 'padding-left:18px;line-height:2' }, [
          h('li', { html: '<b>接入 SOP（5 天）</b>：用「晟元租赁（待准入）」发起一个接入任务，走 D1 条款拆解会签 → D2 主数据与规则配置 → D3 人工算例逐笔比对 → D4 分级审批 → D5 发布上线，每天一个卡点，未通过按钮直接禁用。' }),
          h('li', { html: '<b>资金方主数据 → ＋ 新建资金方</b>：填一个与现有机构重复的统一社会信用代码，看 V-P01 实时拦截；新增银行账户后用另一个角色复核，体验双人复核与 T+1 冷静期。' }),
          h('li', { html: '<b>规则中心 → 协议版本时间轴</b>：看华信银行 V01/V02 的左闭右开切片与「3/15 费率下调」如何被按日拆段。' }),
          h('li', { html: '<b>规则中心 → 配置向导</b>：走 6 步配一条规则，右侧「自然语言预览」实时翻译 JSON；第 4 步对比「累进 vs 超额」两种阶梯（同一基数差 80 万）。' }),
          h('li', { html: '<b>规则中心 → 试算</b>：用 4 月真实事件对比 V02 与 V03 草稿，出差额报告；未试算不得发布（V-R09）。' }),
          h('li', { html: '<b>计费引擎 → 日度核算调度</b>：看一天中 7 个时段的调度编排（可点「模拟执行」逐段推进）、当日核算结果、5 条日度异常识别规则实时求值，以及近 30 日费用趋势中的环比突变标记。' }),
          h('li', { html: '<b>计费引擎 → 费用流水</b>：点任意一条流水看三向引用（事件 / 规则版本 / 基数快照）与完整验算过程。' }),
          h('li', { html: '<b>账单中心 → 出账工作台</b>：对 2026-04 执行封账 → 前置校验 V-B01~B10 → 出账；试着在未封账时直接出账，看阻断。' }),
          h('li', { html: '<b>审批中心 · 待办</b>：所有分级审批的统一入口。初始有 2 张在途审批单（协商减免、账户变更）；切换右上角角色可看到不同待办，敏感操作需二次验证，驳回会把业务单据状态原路回退。' }),
          h('li', { html: '<b>结算中心 → 付款审批</b>：看轧差计算过程与 10 项资金安全控制；提交结算审批后按金额自动分级；把角色切到「审计」，所有操作按钮会禁用。' }),
          h('li', { html: '<b>对账中心 → 勾稽看板</b>：五级等式 A~N 实时求值；差异工作台看「自动定位分析」。' }),
          h('li', { html: '<b>全链路追溯</b>：输入任一回单号 / 账单号 / 借据号，展开追溯树。' })
        ])
      ])));
    }
  });
})();
