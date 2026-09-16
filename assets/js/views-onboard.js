/* =============================================================================
 * views-onboard.js —— 新资金方接入 SOP（5 天）与条款拆解表
 * 对应 PRD 10.1：D1 条款解析 → D2 配置 → D3 试算验证 → D4 评审审批 → D5 发布上线
 * 每日一个卡点（gate），未通过不得进入下一天。
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  var STAGES = [
    { d: 'D1', name: '条款解析', owner: 'BD + 财务', out: '条款拆解表（会签）', gate: '口径未会签不得进入 D2' },
    { d: 'D2', name: '配置', owner: 'BD', out: '草稿版本', gate: '规则校验 V-R01~R08 全通过' },
    { d: 'D3', name: '试算验证', owner: 'BD + 财务', out: '试算报告', gate: '差异必须为 0 或有合理解释' },
    { d: 'D4', name: '评审审批', owner: '财务 + 风控', out: '审批记录', gate: '分级审批全部通过' },
    { d: 'D5', name: '发布上线', owner: '运营', out: '生效版本', gate: '首日事件计费正常' }
  ];

  function emptyClause(seq) {
    return {
      seq: seq, text: '', charge_item: '', event_code: 'EV_DISBURSE_SUCCESS',
      object_level: 'LOAN', basis: '放款本金', rate_model: '固定比例',
      rate_desc: '', cycle: 'MONTHLY', tax_rate: 0.06, reversal: 'PROPORTIONAL', confirmed: false
    };
  }
  function sampleClause() {
    var c = emptyClause(1);
    c.text = '「甲方按乙方当期实际放款本金的 1.5% 收取技术服务费，于放款成功时点计费，按月结算。」';
    c.charge_item = '技术服务费';
    c.rate_desc = '固定比例 1.5%';
    return c;
  }

  function gateRow(ok, text) {
    return h('div', { class: 'alert ' + (ok ? 'ok' : 'warn') }, [
      h('span', { class: 'ico' }, ok ? '✓' : '!'),
      h('div', { html: (ok ? '<b>卡点已通过：</b>' : '<b>卡点未通过：</b>') + text })
    ]);
  }

  /* =========================================================================
   * SOP 首页：任务列表
   * ======================================================================= */
  UI.route('onboard', {
    title: '接入 SOP', crumbs: ['总览', '新资金方接入 SOP'],
    render: function (root) {
      var S = Store.get();
      root.appendChild(U.pageHead('新资金方接入 SOP · 5 天',
        '「接入周期 20 天 → 5 天」的可执行分解。前提是抽象模型已覆盖该协议形态（6.1.2）。<b>每天一个卡点，未通过不得进入下一天。</b>',
        [h('button', {
          class: 'btn btn-primary', disabled: !Store.can('onboard.run'),
          onclick: newTask
        }, '＋ 发起接入任务')]));

      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('进行中任务', S.onboardings.filter(function (t) { return t.status === 'RUNNING'; }).length),
        U.stat('已完成', S.onboardings.filter(function (t) { return t.status === 'DONE'; }).length),
        U.stat('目标周期', '5 天', '现状 20 天（研发交付）', 'ok'),
        U.stat('在线资金方', S.partners.filter(function (p) { return p.status === 'ACTIVE'; }).length + ' / 20+', '目标承载 20+ 家')
      ]));

      if (S.onboardings.length) {
        root.appendChild(U.card('接入任务', U.table([
          { label: '任务号', render: function (t) { return h('span', { class: 'mono' }, t.task_no); } },
          { label: '资金方', render: function (t) { return t.partner_name + '（' + t.partner_no + '）'; } },
          { label: '进度', render: function (t) {
            return h('div', { style: 'min-width:170px' }, [
              U.progress(Math.min(1, (t.stage - 1) / 5)),
              h('div', { class: 'faint', style: 'font-size:11px;margin-top:2px' },
                t.status === 'DONE' ? '已完成 5 / 5' : ('D' + Math.min(t.stage, 5) + ' ' + STAGES[Math.min(t.stage, 5) - 1].name + '（' + (t.stage - 1) + ' / 5 已完成）'))
            ]);
          } },
          { label: '负责人', render: function (t) { return Store.roleName(t.owner); } },
          { label: '起止', render: function (t) { return t.start_date + ' ~ ' + t.deadline; } },
          { label: '状态', render: function (t) { return t.status === 'DONE' ? U.badge('已上线', 'ok') : U.badge('进行中', 'info'); } },
          { label: '', width: '90px', render: function (t) { return h('button', { class: 'btn btn-sm btn-primary', onclick: function (e) { e.stopPropagation(); U.goto('/onboard-task/' + t.task_no); } }, '进入'); } }
        ], S.onboardings, { onRow: function (t) { U.goto('/onboard-task/' + t.task_no); } }), { tight: true }));
      } else {
        root.appendChild(U.alertBox('info', '当前没有接入任务。点击右上角「发起接入任务」，用<b>晟元租赁（P000045，待准入）</b>走一遍完整的 5 天流程。'));
      }

      root.appendChild(U.card('五日排期', U.table([
        { label: '日', render: function (s) { return h('b', null, s.d); }, width: '50px' },
        { label: '阶段', key: 'name', width: '90px' },
        { label: '责任人', key: 'owner', width: '110px' },
        { label: '产出', key: 'out', width: '150px' },
        { label: '卡点', key: 'gate' }
      ], STAGES, { compact: true }), { tight: true, ref: '10.1.1' }));

      root.appendChild(h('div', { class: 'grid g2' }, [
        U.card('为什么能从 20 天压到 5 天', h('div', null, [
          U.table([{ label: '环节', key: 'k' }, { label: '旧流程（20 天）', key: 'a' }, { label: '新流程（5 天）', key: 'b' }], [
            { k: '条款翻译', a: '写需求文档给研发', b: '填《条款拆解表》，四方会签' },
            { k: '实现', a: '定制开发 + 单元测试（10 天）', b: '选模板 + 改参数（0.5 天）' },
            { k: '验证', a: '测试环境造数 + 联调（4 天）', b: '历史事件回放试算（1 天）' },
            { k: '上线', a: '走发版窗口（3 天）', b: '配置发布，原子生效（0.5 天）' },
            { k: '风险控制', a: '靠 Code Review', b: '强制试算 + 影响面评审 + 分级审批' }
          ], { compact: true }),
          U.alertBox('warn', '<b>D1 是全流程的质量源头。</b>条款拆解表若含糊，后面四天做的都是错的。「实际放款本金」是合同金额还是到账金额、撤销是否扣减、跨月如何归属，都必须在这一天定死并双方会签。')
        ]), { ref: '10.1' }),
        U.card('D3 试算验收标准', h('div', null, [
          h('pre', { class: 'code' },
            '选取该资金方近 3 个完整月的历史事件（新资金方用人工算例）\n' +
            '系统试算结果  vs  资金方（或我方人工 SQL）核算结果\n\n' +
            '验收：\n' +
            '  ✅ 逐笔金额完全一致                → 通过\n' +
            '  ⚠️ 存在差异但可归因于舍入（≤0.05）  → 记录容差，通过\n' +
            '  ❌ 存在无法解释的差异              → 阻断，回到 D1 重新确认口径'),
          U.alertBox('info', '这一步是「配置正确性的唯一有效验证手段」，也是发布的强制前置（V-R09）。')
        ]), { ref: '10.1.3' })
      ]));

      function newTask() {
        var S2 = Store.get();
        var cands = S2.partners.filter(function (p) { return ['PENDING', 'ADMITTED', 'ACTIVE'].indexOf(p.status) >= 0; });
        if (!cands.length) cands = S2.partners;
        cands.sort(function (a, b) {
          var order = { PENDING: 0, ADMITTED: 1, ACTIVE: 2 };
          return (order[a.status] - order[b.status]) || (a.partner_no < b.partner_no ? -1 : 1);
        });
        var sel = cands[0].partner_no;
        var body = h('div', null, [
          U.alertBox('info', '接入任务会把「主数据录入 → 规则配置 → 试算 → 审批 → 发布」串成一条带卡点的流水线。建议选择<b>待准入</b>状态的资金方，以完整体验准入与协议生效流程。'),
          U.field('目标资金方', U.selectEl(cands.map(function (p) {
            return { value: p.partner_no, label: p.partner_no + ' ' + p.partner_short_name + '（' + U.statusText(p.status) + '）' };
          }), sel, function (v) { sel = v; })),
          U.field('说明', h('div', { class: 'faint' }, '若目标资金方尚未建档，可先到「资金方主数据 → ＋ 新建资金方」创建后再发起。'))
        ]);
        U.modal('发起接入任务', body, [
          h('button', { class: 'btn', onclick: U.closeModal }, '取消'),
          h('button', {
            class: 'btn btn-primary', onclick: function () {
              var p = Store.get().partnerMap[sel];
              var t = Store.Actions.createOnboarding({ partner_no: p.partner_no, partner_name: p.partner_short_name });
              t.d1.rows = [sampleClause()];
              U.closeModal();
              U.goto('/onboard-task/' + t.task_no);
            }
          }, '创建并进入 D1')
        ], { size: 'narrow' });
      }
    }
  });

  /* =========================================================================
   * 任务工作台
   * ======================================================================= */
  UI.route('onboard-task', {
    title: '接入任务', crumbs: ['总览', '接入 SOP', '任务工作台'],
    render: function (root, params) {
      var S = Store.get();
      var t = S.onboardings.filter(function (x) { return x.task_no === params.id; })[0];
      if (!t) { root.appendChild(U.alertBox('danger', '未找到接入任务 ' + params.id)); return; }
      var partner = S.partnerMap[t.partner_no];

      root.appendChild(U.pageHead('接入任务 ' + t.task_no + ' · ' + t.partner_name,
        '目标资金方 ' + t.partner_no + '（当前状态 ' + U.statusText(partner.status) + '）｜ 起止 ' + t.start_date + ' ~ ' + t.deadline,
        [
          t.status === 'DONE' ? U.badge('已上线', 'ok') : U.badge('D' + Math.min(t.stage, 5) + ' 进行中', 'info'),
          h('button', { class: 'btn', onclick: function () { U.goto('/onboard'); } }, '返回任务列表')
        ]));

      // 步骤条
      var steps = h('div', { class: 'steps' });
      STAGES.forEach(function (s, i) {
        steps.appendChild(h('div', {
          class: 'step' + (t.stage === i + 1 ? ' active' : (t.stage > i + 1 ? ' done' : '')),
          onclick: function () { if (t.stage > i) { t.stage = i + 1; App.rerender(); } }
        }, [h('span', { class: 'n' }, t.stage > i + 1 ? '✓' : s.d.slice(1)), s.d + ' ' + s.name]));
      });
      root.appendChild(steps);

      var panel = h('div');
      root.appendChild(panel);

      if (t.stage === 1) renderD1(panel, t);
      else if (t.stage === 2) renderD2(panel, t);
      else if (t.stage === 3) renderD3(panel, t);
      else if (t.stage === 4) renderD4(panel, t);
      else renderD5(panel, t);
    }
  });

  /* ---------------- D1 条款解析 ---------------- */
  function renderD1(root, t) {
    var d1 = t.d1;
    var box = h('div');
    root.appendChild(U.card('D1 · 条款解析 —— 《条款拆解表》', h('div', null, [
      U.alertBox('warn', '逐条把合同条款拆解为<b>计费五要素</b>并确认取数口径。这一天的产出必须由<b>业务 + 财务 + 资金方</b>三方会签，未会签不得进入 D2。'),
      box
    ]), { ref: '10.1.2' }));

    function draw() {
      box.innerHTML = '';
      var tbl = U.table([
        { label: '序', render: function (r) { return r.seq; }, width: '36px' },
        { label: '口径确认', render: function (r) {
          return h('label', { class: 'checkline' }, [
            h('input', { type: 'checkbox', checked: r.confirmed, onchange: function (e) { r.confirmed = e.target.checked; draw(); } }), '双方会签'
          ]);
        }, width: '92px' },
        { label: '协议条款原文', render: function (r) {
          return h('textarea', { rows: 3, style: 'min-width:210px', oninput: function (e) { r.text = e.target.value; } }, r.text);
        } },
        { label: '计费项', render: function (r) {
          return h('input', { type: 'text', style: 'min-width:100px', value: r.charge_item, oninput: function (e) { r.charge_item = e.target.value; } });
        } },
        { label: '触发事件', render: function (r) {
          return U.selectEl(Data.EVENT_DICT.filter(function (e) { return e.kind !== 'REVERSE'; }).map(function (e) { return { value: e.code, label: e.name }; }),
            r.event_code, function (v) { r.event_code = v; }, { style: 'min-width:110px' });
        } },
        { label: '计费对象', render: function (r) {
          return U.selectEl([{ value: 'LOAN', label: '借据' }, { value: 'CONTRACT', label: '合同' }, { value: 'CUSTOMER', label: '客户' }, { value: 'PARTNER', label: '资金方' }],
            r.object_level, function (v) { r.object_level = v; }, { style: 'min-width:80px' });
        } },
        { label: '计费基数', render: function (r) {
          return h('input', { type: 'text', style: 'min-width:100px', value: r.basis, oninput: function (e) { r.basis = e.target.value; } });
        } },
        { label: '费率模型', render: function (r) {
          return U.selectEl(['固定比例', '固定金额', '日费率', '阶梯·累进', '阶梯·超额'].map(function (x) { return { value: x, label: x }; }),
            r.rate_model, function (v) { r.rate_model = v; }, { style: 'min-width:100px' });
        } },
        { label: '费率取值', render: function (r) {
          return h('input', { type: 'text', style: 'min-width:110px', placeholder: '如 1.5%', value: r.rate_desc, oninput: function (e) { r.rate_desc = e.target.value; } });
        } },
        { label: '周期', render: function (r) {
          return U.selectEl([{ value: 'DAILY', label: '日' }, { value: 'WEEKLY', label: '周' }, { value: 'MONTHLY', label: '月' }, { value: 'QUARTERLY', label: '季' }],
            r.cycle, function (v) { r.cycle = v; }, { style: 'min-width:60px' });
        } },
        { label: '税率', render: function (r) {
          return h('input', { type: 'number', step: '0.01', style: 'width:64px', value: r.tax_rate, oninput: function (e) { r.tax_rate = +e.target.value; } });
        } },
        { label: '冲正', render: function (r) {
          return U.selectEl([{ value: 'PROPORTIONAL', label: '按比例' }, { value: 'FULL', label: '全额' }, { value: 'NONE', label: '不冲正' }],
            r.reversal, function (v) { r.reversal = v; }, { style: 'min-width:80px' });
        } },
        { label: '', width: '46px', render: function (r) {
          return h('button', { class: 'btn btn-sm', onclick: function () { d1.rows = d1.rows.filter(function (x) { return x !== r; }); d1.rows.forEach(function (x, i) { x.seq = i + 1; }); draw(); } }, '删');
        } }
      ], d1.rows, { compact: true, empty: '尚未拆解任何条款' });
      box.appendChild(tbl);
      box.appendChild(h('div', { class: 'btn-row mt8' }, [
        h('button', { class: 'btn', onclick: function () { d1.rows.push(emptyClause(d1.rows.length + 1)); draw(); } }, '＋ 添加条款行'),
        h('button', { class: 'btn btn-ghost', onclick: function () { d1.rows.push(sampleClause()); d1.rows.forEach(function (x, i) { x.seq = i + 1; }); draw(); } }, '插入示例条款')
      ]));

      // 取数口径确认（2.4）
      box.appendChild(h('h3', { class: 'sec' }, ['统一取数口径确认（必须与资金方在协议附件中书面确认）', h('span', { class: 'tag-ref' }, '2.4')]));
      box.appendChild(U.table([
        { label: '口径', key: 'k', width: '130px' }, { label: '默认定义', key: 'v' }, { label: '易争议点', key: 'r' }
      ], [
        { k: '放款额', v: '资金方在借据上实际出资的本金；以放款成功时间归属账期', r: '合同金额 vs 实付到账金额；跨日放款归属；撤销是否扣减' },
        { k: '在贷余额', v: '日终时点本金余额，贷款核心快照为唯一事实源（D-03/D-04）', r: '是否含应收未收利息；逾期资产是否计入；算头算尾' },
        { k: '回款额', v: '清算入账成功金额，强制拆分本金/利息/罚息/违约金/服务费', r: '代偿款是否计入；跨期还款归属' },
        { k: '日费率基准', v: '360 天，算头不算尾（D-05）', r: '360 vs 365；协议级是否覆盖' },
        { k: '流水粒度', v: 'PER_EVENT / PER_DAY / PER_PERIOD', r: '逐日舍入与期末一次性舍入相差 1 分/笔，数十万笔即数千元' },
        { k: '舍入规则', v: '单条流水舍入至分 → 再汇总；税额倒轧', r: '必须与资金方书面确认，否则对账长期不平' }
      ], { compact: true }));

      // 会签
      box.appendChild(h('h3', { class: 'sec' }, '四方会签'));
      var signBox = h('div', { class: 'btn-row' }, [
        signBtn('业务（BD）', 'signedBiz'), signBtn('财务核算', 'signedFin'), signBtn('资金方对接人', 'signedPartner')
      ]);
      box.appendChild(signBox);
      function signBtn(label, key) {
        return h('button', {
          class: 'btn ' + (d1[key] ? 'btn-ok' : ''), disabled: !Store.can('onboard.sign'),
          onclick: function () { d1[key] = !d1[key]; draw(); }
        }, (d1[key] ? '✓ ' : '○ ') + label + ' 会签');
      }

      var rowsOk = d1.rows.length > 0 && d1.rows.every(function (r) { return r.text && r.charge_item && r.rate_desc && r.confirmed; });
      var signOk = d1.signedBiz && d1.signedFin && d1.signedPartner;
      var ok = rowsOk && signOk;
      box.appendChild(h('div', { class: 'mt14' }, gateRow(ok, ok ? '条款拆解表已完成并三方会签，可进入 D2 配置。'
        : (!rowsOk ? '每一行需填写条款原文、计费项、费率取值，并勾选「双方会签」口径确认。' : '需业务、财务、资金方三方会签。'))));
      box.appendChild(h('div', { class: 'btn-row mt8' }, [
        h('button', {
          class: 'btn btn-primary', disabled: !ok || !Store.can('onboard.run'),
          onclick: function () { Store.Actions.advanceOnboarding(t.task_no, 2, '条款拆解表会签完成'); App.rerender(); }
        }, '通过 D1 卡点 → 进入 D2 配置')
      ]));
    }
    draw();
  }

  /* ---------------- D2 配置 ---------------- */
  function renderD2(root, t) {
    var S = Store.get();
    var p = S.partnerMap[t.partner_no];
    var accts = S.accounts.filter(function (a) { return a.partner_no === t.partner_no && a.status === 'ACTIVE'; });
    var inv = S.invoiceMap[t.partner_no];
    var agrs = S.agreements.filter(function (a) { return a.partner_no === t.partner_no; });
    var effAgr = agrs.filter(function (a) { return a.status === 'EFFECTIVE'; })[0];
    var vers = effAgr ? S.versions.filter(function (v) { return v.agreement_no === effAgr.agreement_no; }) : [];
    var draftVer = vers.filter(function (v) { return v.status === 'DRAFT'; })[0] || vers[0];

    var items = [
      { code: 'M1', ok: ['ADMITTED', 'ACTIVE'].indexOf(p.status) >= 0,
        desc: '资金方档案已建档并通过准入审批', msg: '当前状态 ' + UI.statusText(p.status),
        act: ['维护档案 / 准入审批', '/partner-edit/' + t.partner_no] },
      { code: 'M2', ok: accts.length > 0,
        desc: '银行账户已录入并通过双人复核（进入白名单）', msg: accts.length ? accts.map(function (a) { return a.account_no_id; }).join(', ') : '尚无 ACTIVE 账户',
        act: ['维护银行账户', '/partner/' + t.partner_no + '?tab=account'] },
      { code: 'M3', ok: !!(inv && inv.taxpayer_no),
        desc: '开票与税务信息完整（V-B07 出账前置）', msg: inv ? inv.invoice_title : '未维护',
        act: ['维护开票信息', '/partner/' + t.partner_no + '?tab=invoice'] },
      { code: 'M4', ok: !!effAgr,
        desc: '协议主档已创建并生效', msg: effAgr ? effAgr.agreement_no + ' ' + effAgr.agreement_name : (agrs.length ? agrs[0].agreement_no + ' 当前状态 ' + UI.statusText(agrs[0].status) : '尚无协议'),
        act: [agrs.length ? '维护协议主档' : '新建协议主档', agrs.length ? '/agreement-edit/' + agrs[0].agreement_no : '/agreement-edit?partner=' + t.partner_no] },
      { code: 'M5', ok: !!draftVer,
        desc: '规则版本已配置（选模板 + 改参数）', msg: draftVer ? draftVer.agreement_no + '-' + draftVer.version_no + '（' + UI.statusText(draftVer.status) + '）' : '尚无规则版本',
        act: ['规则配置向导', effAgr ? '/rulewizard?agr=' + effAgr.agreement_no : '/rules?tab=templates'] }
    ];

    root.appendChild(U.card('D2 · 配置 —— 主数据录入 + 选模板配规则', h('div', null, [
      U.alertBox('info', '新接入 = <b>选模板 + 改参数 + 试算</b>。把 D1 拆解出的每一条条款，按模板落成计费项与计费规则。'),
      h('div', { class: 'checklist' }, items.map(function (it) {
        return h('div', { class: 'check-row ' + (it.ok ? 'pass' : 'fail') }, [
          h('div', { class: 'st' }, it.ok ? '✓' : '✕'),
          h('div', { class: 'code' }, it.code),
          h('div', { class: 'msg' }, [h('div', null, it.desc), h('div', { class: 'faint', style: 'font-size:11.5px' }, it.msg)]),
          h('div', { class: 'lvl' }, h('button', { class: 'btn btn-sm', onclick: function () { U.goto(it.act[1]); } }, it.act[0]))
        ]);
      }))
    ]), { ref: '10.1.1' }));

    // 条款 → 配置 对照
    if (t.d1.rows.length) {
      root.appendChild(U.card('条款拆解表 → 规则配置 对照', U.table([
        { label: '序', render: function (r) { return r.seq; }, width: '40px' },
        { label: '计费项（D1）', render: function (r) { return r.charge_item; } },
        { label: '触发事件', render: function (r) { return (Data.EVENT_DICT.filter(function (e) { return e.code === r.event_code; })[0] || {}).name; } },
        { label: '基数', render: function (r) { return r.basis; } },
        { label: '费率', render: function (r) { return r.rate_model + ' ' + r.rate_desc; } },
        { label: '已落配置', render: function (r) {
          var hit = draftVer && draftVer.items.filter(function (i) { return i.charge_item_name.indexOf(r.charge_item.slice(0, 3)) >= 0 || r.charge_item.indexOf(i.charge_item_name.slice(0, 3)) >= 0; })[0];
          return hit ? U.badge(hit.charge_item_no + ' ' + hit.charge_item_name, 'ok') : U.badge('未配置', 'warn');
        } }
      ], t.d1.rows, { compact: true }), { tight: true }));
    }

    // 规则校验
    var ruleChecks = [];
    if (draftVer && effAgr) ruleChecks = Engine.validateRules(draftVer, effAgr, { trialDone: false });
    if (ruleChecks.length) {
      root.appendChild(U.card('规则校验 V-R01 ~ V-R09（V-R09 试算在 D3 完成）', U.checklist(ruleChecks), { tight: true, ref: '5.3.4' }));
    }

    var cfgOk = items.every(function (i) { return i.ok; });
    var ruleOk = ruleChecks.length > 0 && !ruleChecks.some(function (c) { return !c.ok && c.level === 'BLOCK' && c.code !== 'V-R09'; });
    var ok = cfgOk && ruleOk;
    root.appendChild(h('div', { class: 'mt14' }, gateRow(ok, ok ? '主数据与规则配置齐备，V-R01~R08 全部通过，可进入 D3 试算验证。'
      : (!cfgOk ? '请先完成上方未通过的配置项。' : '规则校验存在阻断项，请回到规则配置向导修正。'))));
    root.appendChild(h('div', { class: 'btn-row mt8' }, [
      h('button', { class: 'btn', onclick: function () { Store.Actions.advanceOnboarding(t.task_no, 1, '退回 D1'); App.rerender(); } }, '← 返回 D1'),
      h('button', {
        class: 'btn btn-primary', disabled: !ok || !Store.can('onboard.run'),
        onclick: function () {
          t.d2.versionId = draftVer.agreement_version_id;
          Store.Actions.advanceOnboarding(t.task_no, 3, '配置完成，规则校验通过');
          App.rerender();
        }
      }, '通过 D2 卡点 → 进入 D3 试算验证')
    ]));
  }

  /* ---------------- D3 试算验证 ---------------- */
  function renderD3(root, t) {
    var S = Store.get();
    var ver = S.versions.filter(function (v) { return v.agreement_version_id === t.d2.versionId; })[0];
    if (!ver) {
      root.appendChild(U.alertBox('warn', '未找到 D2 配置的规则版本，请返回 D2。'));
      root.appendChild(h('button', { class: 'btn', onclick: function () { Store.Actions.advanceOnboarding(t.task_no, 2); App.rerender(); } }, '← 返回 D2'));
      return;
    }
    var d3 = t.d3;
    if (!d3.cases.length) {
      d3.cases = [
        { desc: '常规单笔', item: ver.items[0].charge_item_no, basis: 50000, manual: null },
        { desc: '大额单笔', item: ver.items[0].charge_item_no, basis: 680000, manual: null },
        { desc: '小额单笔（验舍入）', item: ver.items[0].charge_item_no, basis: 3333, manual: null }
      ];
    }

    function calcCase(ver, c) {
      var it = ver.items.filter(function (x) { return x.charge_item_no === c.item; })[0] || ver.items[0];
      var st = { tierAccum: {} };
      var res = Engine.applyRate(it.rule.rate_model, c.basis, st, 'TRIAL|' + c.item);
      var tax = M.splitTax(res.amount, it.tax_rate);
      return { amount: res.amount, exTax: tax.exTax, tax: tax.tax, expr: res.detail.expr, item: it };
    }

    var box = h('div');
    root.appendChild(U.card('D3 · 试算验证 —— 系统计算 vs 人工核算 逐笔比对', h('div', null, [
      U.alertBox('info', '新资金方无历史事件，采用<b>单笔试算</b>：由财务给出人工核算金额，系统用 D2 配置的规则实时计算并逐笔比对。' +
        '存量资金方接入时改用<b>历史回放试算</b>（近 3 个完整月真实事件）。试算与正式计费<b>共用同一计算内核</b>，保证「试算通过 = 上线后结果一致」。'),
      box
    ]), { ref: '5.7 / 10.1.3' }));

    function draw() {
      box.innerHTML = '';
      var rows = d3.cases.map(function (c) {
        var r = calcCase(ver, c);
        var diff = M.r2((c.manual === null ? r.amount : c.manual) - r.amount);
        return { c: c, r: r, diff: -diff, sys: r.amount, man: c.manual };
      });
      box.appendChild(U.table([
        { label: '算例', render: function (x) { return h('input', { type: 'text', style: 'min-width:110px', value: x.c.desc, oninput: function (e) { x.c.desc = e.target.value; } }); } },
        { label: '计费项', render: function (x) {
          return U.selectEl(ver.items.map(function (i) { return { value: i.charge_item_no, label: i.charge_item_name }; }), x.c.item, function (v) { x.c.item = v; draw(); }, { style: 'min-width:110px' });
        } },
        { label: '计费基数', num: true, render: function (x) {
          return h('input', { type: 'number', style: 'width:120px;text-align:right', value: x.c.basis, oninput: function (e) { x.c.basis = +e.target.value; draw(); } });
        } },
        { label: '系统计算（含税）', num: true, render: function (x) { return h('b', null, M.fmt(x.sys)); } },
        { label: '不含税 / 税额', num: true, render: function (x) { return M.fmt(x.r.exTax) + ' / ' + M.fmt(x.r.tax); } },
        { label: '人工核算', num: true, render: function (x) {
          return h('input', { type: 'number', step: '0.01', style: 'width:120px;text-align:right', value: x.c.manual === null ? '' : x.c.manual, oninput: function (e) { x.c.manual = e.target.value === '' ? null : +e.target.value; draw(); } });
        } },
        { label: '差异', num: true, render: function (x) { return UI.money(x.man === null ? 0 : M.r2(x.man - x.sys), { signed: true }); } },
        { label: '判定', render: function (x) {
          if (x.man === null) return U.badge('待填写', 'warn');
          var d = Math.abs(M.r2(x.man - x.sys));
          if (d === 0) return U.badge('✓ 完全一致', 'ok');
          if (d <= 0.05) return U.badge('⚠ 容差内（记录）', 'warn');
          return U.badge('✕ 无法解释', 'danger');
        } },
        { label: '验算过程', render: function (x) { return h('span', { class: 'faint mono', style: 'font-size:11px' }, x.r.expr); } },
        { label: '', width: '45px', render: function (x) { return h('button', { class: 'btn btn-sm', onclick: function () { d3.cases = d3.cases.filter(function (y) { return y !== x.c; }); draw(); } }, '删'); } }
      ], rows, { compact: true }));

      box.appendChild(h('div', { class: 'btn-row mt8' }, [
        h('button', { class: 'btn', onclick: function () { d3.cases.push({ desc: '新算例', item: ver.items[0].charge_item_no, basis: 100000, manual: null }); draw(); } }, '＋ 添加算例'),
        h('button', {
          class: 'btn', onclick: function () { d3.cases.forEach(function (c) { c.manual = calcCase(ver, c).amount; }); draw(); UI.toast('已用系统结果回填人工列（仅用于演示）', '', '快速填充'); }
        }, '按系统结果回填（演示用）')
      ]));

      var filled = rows.every(function (x) { return x.man !== null; });
      var bad = rows.filter(function (x) { return x.man !== null && Math.abs(M.r2(x.man - x.sys)) > 0.05; });
      var tol = rows.filter(function (x) { return x.man !== null && Math.abs(M.r2(x.man - x.sys)) > 0 && Math.abs(M.r2(x.man - x.sys)) <= 0.05; });
      var ok = filled && bad.length === 0 && d3.cases.length > 0;
      d3.ran = ok;
      box.appendChild(h('div', { class: 'mt14' }, gateRow(ok, ok
        ? '逐笔比对通过' + (tol.length ? '（' + tol.length + ' 笔落在 0.05 元容差内，已记录容差）' : '（全部完全一致）') + '，可进入 D4 评审审批。'
        : (!filled ? '请补齐每一条算例的「人工核算」金额。' : '存在 ' + bad.length + ' 笔无法解释的差异，<b>阻断，回到 D1 重新确认口径</b>。'))));
      box.appendChild(h('div', { class: 'btn-row mt8' }, [
        h('button', { class: 'btn', onclick: function () { Store.Actions.advanceOnboarding(t.task_no, 2, '退回 D2'); App.rerender(); } }, '← 返回 D2'),
        bad.length ? h('button', { class: 'btn btn-danger', onclick: function () { Store.Actions.advanceOnboarding(t.task_no, 1, '试算差异无法解释，退回 D1 重新确认口径'); App.rerender(); } }, '退回 D1 重新确认口径') : null,
        h('button', {
          class: 'btn btn-primary', disabled: !ok || !Store.can('onboard.run'),
          onclick: function () {
            var est = M.sum(rows, function (x) { return x.sys; }) * 20;
            t.d4.estMonthly = M.r2(est);
            t.d4.approvals = approvalChain(est).map(function (a) { return { role: a, done: false }; });
            Store.Actions.advanceOnboarding(t.task_no, 4, '试算逐笔比对通过');
            App.rerender();
          }
        }, '通过 D3 卡点 → 进入 D4 评审审批')
      ]));
    }
    draw();
  }

  function approvalChain(amount) {
    if (Math.abs(amount) < 10000) return ['FIN_OP'];
    if (Math.abs(amount) <= 100000) return ['FIN_OP', 'FIN_MGR'];
    return ['FIN_MGR', 'RISK', 'FIN_OP'];
  }

  /* ---------------- D4 评审审批 ---------------- */
  function renderD4(root, t) {
    var d4 = t.d4;
    var S = Store.get();
    var ver = S.versions.filter(function (v) { return v.agreement_version_id === t.d2.versionId; })[0];
    var box = h('div');
    root.appendChild(U.card('D4 · 评审审批 —— 影响面报告与分级审批', h('div', null, [box]), { ref: '5.8.1' }));

    function draw() {
      box.innerHTML = '';
      box.appendChild(U.kv([
        ['接入资金方', t.partner_name + '（' + t.partner_no + '）'],
        ['规则版本', ver ? ver.agreement_no + '-' + ver.version_no : '—'],
        ['计费项数', ver ? ver.items.length : 0],
        ['预估月度费用规模', h('b', null, M.fmt(d4.estMonthly))],
        ['生效方式', ver && ver.effective_date < S.simToday ? U.badge('追溯生效（需范围重算）', 'danger') : U.badge('未来 / 当日生效', 'ok')],
        ['触及已确认账单', U.badge('无（新接入）', 'ok')],
        ['审批链路', h('span', null, d4.approvals.map(function (a) { return U.badge(Store.roleName(a.role) + (a.done ? ' ✓' : ''), a.done ? 'ok' : 'brand'); }))]
      ], 'kv-2col'));

      box.appendChild(h('h3', { class: 'sec' }, '分级审批规则'));
      box.appendChild(U.table([{ label: '影响金额（月度差额绝对值）', key: 'a' }, { label: '审批层级', key: 'b' }], [
        { a: '< 1 万元', b: '财务核算' },
        { a: '1 万 ~ 10 万元', b: '财务核算 + 财务负责人' },
        { a: '> 10 万元 或 追溯生效', b: '财务负责人 + 风控 + 业务负责人' }
      ], { compact: true }));

      box.appendChild(h('h3', { class: 'sec' }, '审批操作'));
      box.appendChild(h('div', { class: 'btn-row' }, d4.approvals.map(function (a) {
        var mine = S.role === a.role;
        return h('button', {
          class: 'btn ' + (a.done ? 'btn-ok' : (mine ? 'btn-primary' : '')),
          disabled: a.done || !mine,
          title: mine ? '' : '请切换到「' + Store.roleName(a.role) + '」角色审批',
          onclick: function () {
            a.done = true;
            if (d4.approvals.every(function (x) { return x.done; })) d4.approval_no = Core.No.approval(S.simToday);
            Store.log('接入 SOP', '接入审批', t.task_no, Store.roleName(a.role) + ' 审批通过');
            draw();
          }
        }, (a.done ? '✓ 已审批 · ' : '待审批 · ') + Store.roleName(a.role));
      })));
      box.appendChild(h('div', { class: 'faint mt8' }, '提示：切换右上角角色可分别以不同身份完成审批链路（对应 PRD 第 14 章权限矩阵）。'));

      var ok = d4.approvals.length > 0 && d4.approvals.every(function (a) { return a.done; });
      box.appendChild(h('div', { class: 'mt14' }, gateRow(ok, ok ? '审批链路全部通过，审批单号 ' + d4.approval_no + '，可进入 D5 发布上线。' : '需按分级审批规则完成全部审批。')));
      box.appendChild(h('div', { class: 'btn-row mt8' }, [
        h('button', { class: 'btn', onclick: function () { Store.Actions.advanceOnboarding(t.task_no, 3, '退回 D3'); App.rerender(); } }, '← 返回 D3'),
        h('button', {
          class: 'btn btn-primary', disabled: !ok || !Store.can('onboard.run'),
          onclick: function () { Store.Actions.advanceOnboarding(t.task_no, 5, '审批通过'); App.rerender(); }
        }, '通过 D4 卡点 → 进入 D5 发布上线')
      ]));
    }
    draw();
  }

  /* ---------------- D5 发布上线 ---------------- */
  function renderD5(root, t) {
    var S = Store.get();
    var d5 = t.d5;
    var ver = S.versions.filter(function (v) { return v.agreement_version_id === t.d2.versionId; })[0];
    var box = h('div');
    root.appendChild(U.card('D5 · 发布上线 —— 发布版本 + 账期日历 + 首日监控', h('div', null, [box]), { ref: '5.8.2 / 7.2' }));

    function draw() {
      box.innerHTML = '';
      var published = ver && ['EFFECTIVE', 'PENDING_EFFECTIVE'].indexOf(ver.status) >= 0;
      d5.published = published;

      box.appendChild(h('div', { class: 'checklist' }, [
        row('P1', published, '规则版本已发布（原子生效）', ver ? ver.agreement_no + '-' + ver.version_no + ' · ' + UI.statusText(ver.status) : '—',
          published ? null : h('button', {
            class: 'btn btn-sm btn-primary', disabled: !Store.can('rule.publish'),
            onclick: function () {
              ver.__trialNo = ver.__trialNo || ('SOP-' + t.task_no);   // D3 已完成试算，满足 V-R09
              var r = Store.Actions.publishVersion(ver.agreement_version_id);
              if (!r.ok) { U.modal('发布被阻断', U.checklist(r.checks || []), [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'narrow' }); return; }
              UI.toast('版本已发布，状态 ' + UI.statusText(r.version.status), 'ok');
              App.rerender();
            }
          }, '发布版本')),
        row('P2', d5.calendarDone, '账期日历已配置并确认', ver ? calText(ver) : '—',
          d5.calendarDone ? null : h('button', { class: 'btn btn-sm', onclick: function () { d5.calendarDone = true; draw(); } }, '确认账期日历')),
        row('P3', d5.monitorDone, '首日监控已布置（事件接入、计费成功率、勾稽）', '首日需确认：事件到达、计费流水生成、日度勾稽通过',
          d5.monitorDone ? null : h('button', { class: 'btn btn-sm', onclick: function () { d5.monitorDone = true; draw(); } }, '确认首日监控'))
      ]));

      if (ver) {
        var cal = Billing.calendar((ver.items[0] && ver.items[0].settle_day_rule) || {}, D.period(S.simToday));
        box.appendChild(h('h3', { class: 'sec' }, '账期日历（首个账期）'));
        box.appendChild(U.table([
          { label: '账期', render: function () { return cal.period; } },
          { label: '账期起止', render: function () { return cal.period_start + ' ~ ' + cal.period_end; } },
          { label: '封账日', render: function () { return cal.cutoff_date; } },
          { label: '出账日', render: function () { return cal.bill_gen_date; } },
          { label: '确认截止', render: function () { return cal.confirm_deadline; } },
          { label: '结算日', render: function () { return cal.settle_date; } }
        ], [{}], { compact: true }));
      }

      var ok = published && d5.calendarDone && d5.monitorDone;
      box.appendChild(h('div', { class: 'mt14' }, gateRow(ok, ok ? '发布完成，可标记接入任务完成。' : '请完成上方 3 项上线动作。')));
      box.appendChild(h('div', { class: 'btn-row mt8' }, [
        h('button', { class: 'btn', onclick: function () { Store.Actions.advanceOnboarding(t.task_no, 4, '退回 D4'); App.rerender(); } }, '← 返回 D4'),
        t.status !== 'DONE' ? h('button', {
          class: 'btn btn-primary', disabled: !ok || !Store.can('onboard.run'),
          onclick: function () {
            Store.Actions.advanceOnboarding(t.task_no, 6, '接入完成');
            Store.alert('P3', '新资金方接入完成', t.partner_name + ' 已上线，接入周期 ' + (D.diffDays(t.start_date, S.simToday) + 1) + ' 天', '#/onboard-task/' + t.task_no);
            UI.toast('接入任务完成！', 'ok', t.partner_name + ' 已上线');
            App.rerender();
          }
        }, '标记接入完成') : null
      ]));

      if (t.status === 'DONE') {
        box.appendChild(h('div', { class: 'mt14' }, U.card('接入成果', h('div', { class: 'grid g4' }, [
          U.stat('接入周期', (D.diffDays(t.start_date, t.finish_date || S.simToday) + 1) + ' 天',
            '模拟环境同日跑完 D1–D5；目标 5 天 · 现状 20 天', 'ok'),
          U.stat('配置化率', '100%', '本次接入未发生代码发版', 'ok'),
          U.stat('试算差异', '0', 'D3 逐笔比对', 'ok'),
          U.stat('审批链路', t.d4.approvals.length + ' 级', t.d4.approval_no || '', 'ok')
        ]))));
      }

      function row(code, ok2, desc, msg, act) {
        return h('div', { class: 'check-row ' + (ok2 ? 'pass' : 'fail') }, [
          h('div', { class: 'st' }, ok2 ? '✓' : '✕'),
          h('div', { class: 'code' }, code),
          h('div', { class: 'msg' }, [h('div', null, desc), h('div', { class: 'faint', style: 'font-size:11.5px' }, msg)]),
          h('div', { class: 'lvl' }, act)
        ]);
      }
      function calText(v) {
        var c = Billing.calendar((v.items[0] && v.items[0].settle_day_rule) || {}, D.period(S.simToday));
        return '出账日 ' + c.bill_gen_date + ' · 确认截止 ' + c.confirm_deadline + ' · 结算日 ' + c.settle_date;
      }
    }
    draw();
  }
})();
