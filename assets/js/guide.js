/* =============================================================================
 * guide.js —— 全流程蒙版新手引导
 * 每一步严格分为「业务逻辑」与「系统操作」，并自动导航至对应模块。
 * ========================================================================== */
(function (global) {
  'use strict';
  var h = Core.h;
  var root, trigger, topHost, active = false, index = 0, focusEl = null, resizeTimer = null;
  var STORAGE_PROGRESS = 'rcs.guide.progress';
  var STORAGE_DONE = 'rcs.guide.completed';

  var steps = [
    {
      phase: '开始', title: '欢迎使用资金方计费结算系统', route: '/dashboard?period=2026-04', target: '#btn-guide',
      business: '这套系统管理资金方从准入、协议计费、账单确认、资金结算到对账审计的完整链路。目标是让每一分钱都能追溯到协议规则和原始业务事件。',
      operation: '引导会自动切换页面。使用“下一步 / 上一步”学习，按 Esc 或再次点击右上角“新手引导”可随时退出；下次开启会从退出位置继续。',
      checkpoint: '先建立全局认知：配置决定计费，计费形成账单，账单确认后才能结算，结算后必须以回单和勾稽闭环。'
    },
    {
      phase: '开始', title: '先记住完整业务主线', route: '/dashboard?period=2026-04', target: '.page-head',
      business: '主线分为六段：①资金方主数据 → ②协议与规则 → ③事件计费 → ④出账与确认 → ⑤收付款结算 → ⑥内外部对账。任何异常都沿这条链向前定位。',
      operation: '左侧“六大模块”按业务发生顺序排列。日常工作先看大盘和个人待办，再进入对应模块处理，不需要逐页巡检。',
      checkpoint: '不要从金额结果倒推原因；应沿“事件—规则—流水—账单—结算—回单”逐层核对。'
    },
    {
      phase: '开始', title: '操作人、角色与权限', route: '/dashboard?period=2026-04', target: '.role-picker',
      business: '资金合作、财务核算、财务复核、财务负责人、运营、风控、业务负责人和审计承担不同职责。发起、审批与复核分离，避免单人完成高风险闭环。',
      operation: '右上角显示“姓名 / 角色”。切换角色后，按钮权限、审批待办和大盘工作台会同步变化。审批记录同时保存用户身份与当时角色。',
      checkpoint: '按钮不可用时先确认当前角色；不要为了完成操作而切到管理员，真实流程应由对应岗位接力。'
    },
    {
      phase: '日常入口', title: '从运营大盘开始一天', route: '/dashboard?period=2026-04', target: '.page-head',
      business: '大盘回答三件事：本账期处理到哪一步、资金是否有风险、当前岗位今天要做什么。所有指标必须有明确账期和统计截至日。',
      operation: '先选择账期，再看“我的工作台”、账期进度、资金进度和异常待办。点击卡片或“去处理”直接进入明细；系统业务日位于左下角。',
      checkpoint: '先处理 P0/P1 和阻断项，再处理临期任务，最后处理普通待办。'
    },
    {
      phase: '接入准备', title: '新资金方接入与准入', route: '/onboard', target: '.page-head',
      business: '合作开始前要完成主体准入、账户验证、协议签署、规则试算和上线检查。五天 SOP 把跨部门交付物和负责人固定下来。',
      operation: '进入接入工作台，新建或打开接入任务；按日完成清单并上传/记录交付物。阻断项未完成时不能推进到下一阶段。',
      checkpoint: '准入通过不等于可以结算；账户白名单、协议有效期和规则生效状态也必须就绪。'
    },
    {
      phase: '接入准备', title: '维护资金方主数据', route: '/partners', target: '.page-head',
      business: '资金方主体是所有协议、账户、账单和结算的归属根。一个主体可同时承担资金方、担保方或通道方角色，但主体编号必须唯一。',
      operation: '搜索资金方后进入详情，维护基础信息、合作状态、银行账户、开票信息和协议。账户新增或变更要走双人复核。',
      checkpoint: '主体、账户名、开户行和币种必须与协议一致；暂停合作只限制新增业务，存量账务仍需闭环。'
    },
    {
      phase: '规则配置', title: '把合同条款配置成计费规则', route: '/rules', target: '.page-head',
      business: '规则由触发事件、计费基数、费率模型、方向、税率、账期和生效区间组成。版本化保证历史账务按当时生效规则计算。',
      operation: '从模板或向导创建规则版本，配置费用项后执行试算；对比新旧版本影响，提交分级审批，通过后按生效日发布。',
      checkpoint: '重点检查费率单位、应收/应付方向、阶梯边界、最低/封顶金额、税率及是否追溯生效。'
    },
    {
      phase: '日常核算', title: '业务事件进入计费引擎', route: '/charge', target: '.page-head',
      business: '放款、还款、余额、逾期等事实事件触发规则，生成费用流水和基数快照。相同事件幂等处理，冲正必须产生反向流水，不能直接改原流水。',
      operation: '查看待处理与失败事件，进入明细核对路由到的协议版本、基数快照和计算过程。漏推事件从回补入口补齐，失败事件修复后重放。',
      checkpoint: '事件终态必须是已计费、已忽略或已冲正；任何积压和缺少快照都会阻断封账。'
    },
    {
      phase: '月结出账', title: '封账、生成账单并确认', route: '/bills', target: '.page-head',
      business: '账单按资金方、协议、方向和账期归集费用流水，并叠加调整项与上期结转。含税金额必须等于不含税金额加税额。',
      operation: '先在出账工作台执行前置检查和封账，再生成账单、预览、推送资金方并登记确认。金额争议可按部分金额或整单登记。',
      checkpoint: '未确认账单不能结算；部分争议只冻结争议额，无争议部分仍应继续进入结算。'
    },
    {
      phase: '月结出账', title: '发票与调整项跟随账单闭环', route: '/invoices', target: '.page-head',
      business: '应收账单通常由平台开票，应付账单通常收取资金方发票。跨期修正通过调整项进入指定账期，保留来源和审批链。',
      operation: '从账单进入开票申请，核对抬头、税号、税率和金额；调整项需填写来源、原因和结算账期，审批通过后才能入账。',
      checkpoint: '已开票账单不能直接作废；需要先按发票规则红冲，再处理账单和调整项。'
    },
    {
      phase: '资金结算', title: '从确认账单生成结算单', route: '/settle', target: '.page-head',
      business: '结算按资金方、协议结算账户、计划结算日和币种分组。应收代表资金方付款给平台，应付代表平台付款给资金方；允许轧差时按协议规则计算净额。',
      operation: '选择账期生成结算单，进入详情核对账单分摊、争议冻结额、收付方向、账户和风险检查，再提交审批。',
      checkpoint: '严禁跨账户、跨结算日或跨币种合并；金额、账户白名单或勾稽任一硬校验失败都不得发起。'
    },
    {
      phase: '资金结算', title: '审批中心完成岗位接力', route: '/approvals', target: '.page-head',
      business: '审批链由业务类型、影响金额和风险标记自动生成。发起人不能审批自己的单据，敏感操作需要二次身份验证。',
      operation: '在“我的待办”处理当前岗位环节，查看内容版本、指纹、证据包和前序意见后通过或驳回。业务内容变化时原结论失效，需重新发起。',
      checkpoint: '审批的是固化版本，不是一个可继续编辑的空壳；操作日志要同时能回答谁、以什么角色、何时、依据什么。'
    },
    {
      phase: '资金结算', title: '应付执行与应收认领', route: '/claim', target: '.page-head',
      business: '应付结算通过支付指令执行并取得回单；应收到账通过结算单号、付款账户、金额等规则自动匹配，无法命中时进入挂账人工认领。',
      operation: '到账认领后由另一岗位复核。部分到账只按实收生成流水和回单，结算单保留已收与剩余应收，可继续认领后续款项。',
      checkpoint: '银行流水、结算流水和回单金额必须一致；不明来款不能为了清账强行匹配。'
    },
    {
      phase: '核对闭环', title: '五级勾稽检查完整资金链', route: '/tieout?period=2026-03', target: '.page-head',
      business: '五级勾稽依次核对业务事件、费用流水、账单、结算流水和银行回单。左右两侧独立取数，才能发现中间环节丢数据。',
      operation: '选择账期重新执行勾稽，逐级查看 A–N 等式、左右值、差额和阻断级别。失败后进入差异工作台定位并闭环。',
      checkpoint: '勾稽不平不是提示信息：对应环节必须被阻断，直至差异有明确处理结论。'
    },
    {
      phase: '核对闭环', title: '全链路追溯一笔金额', route: '/trace', target: '.page-head',
      business: '审计和客诉处理需要回答一笔钱从哪里来、按哪版协议怎么算、进了哪张账单、如何结算、回单在哪里。',
      operation: '输入业务事件、费用流水、账单、结算单、结算流水或回单编号，系统会向前和向后展开关联链路。',
      checkpoint: '任何账务节点都应能回到原始业务事实和规则快照；只有金额结果而无计算依据视为不可审计。'
    },
    {
      phase: '异常运营', title: '告警、差异与审计运营', route: '/alerts', target: '.page-head',
      business: 'P0 表示已发生或极可能发生资损，P1 表示关键数据不一致，P2/P3 侧重时效与质量。争议和差异按 SLA 升级。',
      operation: '从告警进入关联单据，填写处理结果并关闭；P0/P1 必须逐条处理。运营与审计页可查看操作日志、变更记录和关键指标。',
      checkpoint: '关闭告警需要处理证据，不等于隐藏告警；同类问题重复出现时应回到规则、数据源或流程做根因修复。'
    },
    {
      phase: '练习验收', title: '用可复现场景巩固高风险边界', route: '/scenarios', target: '.page-head',
      business: '部分到账、部分争议和计费流水缺失是最容易引发错账或资损的边界场景。掌握它们，才能理解状态与阻断规则。',
      operation: '在“验收场景”逐个点击“重置并执行”，核对系统给出的金额、状态和勾稽结论，再进入业务详情继续检查。',
      checkpoint: '能够独立解释三个结果：为何部分到账不能结清、为何部分争议不冻结整单、为何事件和流水必须独立计数。'
    },
    {
      phase: '完成', title: '你已经走完整个结算闭环', route: '/scenarios', target: null,
      business: '日常遵循“先看风险与待办，再按链路处理，最后以回单和勾稽闭环”。所有配置、金额、状态变化都要有版本、审批和操作留痕。',
      operation: '现在可退出引导并从“验收场景”练习。需要复习时再次点击右上角“新手引导”；在引导中可从目录跳到任意章节。',
      checkpoint: '新人通过标准：能独立完成资金方接入、规则发布、月结出账、结算审批、到账认领、差异定位和全链路追溯。'
    }
  ];

  function readNumber(key, fallback) {
    try { var n = Number(localStorage.getItem(key)); return isFinite(n) ? n : fallback; } catch (e) { return fallback; }
  }
  function store(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) { } }
  function routeNow() { return location.hash.replace(/^#/, '') || '/dashboard'; }
  function routeName(route) { return String(route || '').split('?')[0].replace(/^\//, '').split('/')[0]; }
  function clearFocus() {
    if (focusEl) focusEl.classList.remove('guide-target-active');
    focusEl = null;
  }
  function removeLayer() {
    clearFocus();
    if (root) { root.innerHTML = ''; root.hidden = true; }
    if (topHost) { topHost.innerHTML = ''; topHost.hidden = true; }
    document.body.classList.remove('guide-running');
  }

  function init() {
    if (root) return;
    root = document.getElementById('guide-root');
    trigger = document.getElementById('btn-guide');
    topHost = document.getElementById('guide-top-controls');
    if (!root || !trigger || !topHost) return;
    trigger.addEventListener('click', toggle);
    window.addEventListener('resize', function () {
      if (!active) return;
      clearTimeout(resizeTimer); resizeTimer = setTimeout(refresh, 80);
    });
    window.addEventListener('scroll', function () { if (active) position(); }, true);
    window.addEventListener('hashchange', function () { if (active) setTimeout(refresh, 60); });
    document.addEventListener('keydown', function (e) {
      if (!active) return;
      if (e.key === 'Escape') { e.preventDefault(); stop(false); }
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); previous(); }
    });
  }

  function toggle() {
    if (active) { stop(false); return; }
    var done = readNumber(STORAGE_DONE, 0) === 1;
    index = done ? 0 : Math.max(0, Math.min(steps.length - 1, readNumber(STORAGE_PROGRESS, 0)));
    start(index);
  }
  function start(at) {
    if (global.FlowGuide && FlowGuide.isActive()) FlowGuide.stop(false, true);
    UI.closeModal();
    active = true; index = Math.max(0, Math.min(steps.length - 1, at || 0));
    trigger.setAttribute('aria-pressed', 'true');
    trigger.classList.add('active'); trigger.textContent = '× 退出引导';
    document.body.classList.add('guide-running');
    show();
  }
  function stop(completed, silent) {
    active = false;
    if (completed) { store(STORAGE_DONE, 1); store(STORAGE_PROGRESS, 0); }
    else store(STORAGE_PROGRESS, index);
    removeLayer();
    trigger.setAttribute('aria-pressed', 'false');
    trigger.classList.remove('active'); trigger.textContent = '? 新手引导';
    if (!silent) UI.toast(completed ? '全流程引导已完成，可随时重新学习' : '引导已暂停，下次从本步继续', completed ? 'ok' : 'info', completed ? '学习完成' : '已退出引导');
  }
  function next() {
    if (index >= steps.length - 1) { stop(true); return; }
    index++; store(STORAGE_PROGRESS, index); show();
  }
  function previous() { if (index > 0) { index--; store(STORAGE_PROGRESS, index); show(); } }
  function jump(i) { index = i; store(STORAGE_PROGRESS, index); show(); }

  function show() {
    if (!active) return;
    var step = steps[index];
    if (step.route && routeNow() !== step.route) {
      UI.goto(step.route);
      setTimeout(refresh, 90);
    } else {
      refresh();
    }
  }

  function refresh() {
    if (!active || !root) return;
    clearFocus();
    root.hidden = false; root.innerHTML = '';
    var step = steps[index];
    focusEl = step.target ? document.querySelector(step.target) : null;
    if (focusEl) focusEl.classList.add('guide-target-active');

    var shield = h('div', { class: 'guide-shield', 'aria-hidden': 'true' });
    var spotlight = h('div', { class: 'guide-spotlight', 'aria-hidden': 'true' });
    var panel = buildPanel(step);
    var topNav = buildTopNav();
    root.appendChild(shield); root.appendChild(spotlight); root.appendChild(panel);
    topHost.innerHTML = ''; topHost.hidden = false; topHost.appendChild(topNav);
    root._spotlight = spotlight; root._panel = panel;
    position();
  }

  function buildTopNav() {
    return h('nav', { class: 'guide-top-nav', 'aria-label': '新手引导快捷翻页' }, [
      h('button', { class: 'btn btn-sm', type: 'button', disabled: index === 0, onclick: previous }, '← 上一步'),
      h('span', { class: 'guide-top-count' }, (index + 1) + ' / ' + steps.length),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: next },
        index === steps.length - 1 ? '完成学习 ✓' : '下一步 →')
    ]);
  }

  function buildPanel(step) {
    var pct = Math.round(((index + 1) / steps.length) * 100);
    var panel = h('section', { class: 'guide-panel', role: 'dialog', 'aria-modal': 'true',
      'aria-label': '新手引导：' + step.title }, [
      h('div', { class: 'guide-panel-head' }, [
        h('div', null, [h('span', { class: 'guide-phase' }, step.phase),
          h('span', { class: 'guide-count' }, '第 ' + (index + 1) + ' / ' + steps.length + ' 步')]),
        h('button', { class: 'guide-close', type: 'button', title: '退出引导', onclick: function () { stop(false); } }, '×')
      ]),
      h('div', { class: 'guide-progress' }, h('i', { style: 'width:' + pct + '%' })),
      h('div', { class: 'guide-panel-body' }, [
        h('h2', null, step.title),
        h('div', { class: 'guide-logic guide-business' }, [
          h('div', { class: 'guide-logic-title' }, [h('span', null, '业务'), ' 业务逻辑']),
          h('p', null, step.business)
        ]),
        h('div', { class: 'guide-logic guide-operation' }, [
          h('div', { class: 'guide-logic-title' }, [h('span', null, '操作'), ' 应用系统操作']),
          h('p', null, step.operation)
        ]),
        h('div', { class: 'guide-checkpoint' }, [h('b', null, '本步要记住'), h('span', null, step.checkpoint)]),
        h('button', { class: 'guide-outline-toggle', type: 'button', onclick: function () {
          var menu = panel.querySelector('.guide-outline'); menu.hidden = !menu.hidden;
          this.textContent = menu.hidden ? '查看全流程目录' : '收起全流程目录';
        } }, '查看全流程目录'),
        buildOutline()
      ]),
      h('div', { class: 'guide-panel-foot' }, [
        h('button', { class: 'btn', type: 'button', disabled: index === 0, onclick: previous }, '← 上一步'),
        h('span', { class: 'guide-key-hint' }, '← → 切换 · Esc 退出'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: next }, index === steps.length - 1 ? '完成学习 ✓' : '下一步 →')
      ])
    ]);
    return panel;
  }

  function buildOutline() {
    var box = h('div', { class: 'guide-outline', hidden: true });
    var lastPhase = '';
    steps.forEach(function (s, i) {
      if (s.phase !== lastPhase) { box.appendChild(h('div', { class: 'guide-outline-phase' }, s.phase)); lastPhase = s.phase; }
      box.appendChild(h('button', { class: 'guide-outline-step' + (i === index ? ' current' : ''), type: 'button',
        onclick: function () { jump(i); } }, [h('span', null, String(i + 1)), s.title]));
    });
    return box;
  }

  function position() {
    if (!active || !root || !root._panel || !root._spotlight) return;
    var panel = root._panel, spot = root._spotlight;
    var vw = window.innerWidth, vh = window.innerHeight, gap = 16, margin = 16;
    var panelW = Math.min(440, vw - margin * 2);
    panel.style.width = panelW + 'px';
    if (!focusEl || !document.documentElement.contains(focusEl)) {
      spot.style.display = 'none';
      panel.classList.add('guide-panel-center');
      panel.style.left = Math.max(margin, (vw - panelW) / 2) + 'px';
      panel.style.top = Math.max(margin, (vh - Math.min(panel.offsetHeight || 620, vh - 32)) / 2) + 'px';
      return;
    }
    panel.classList.remove('guide-panel-center');
    var r = focusEl.getBoundingClientRect(), pad = 7;
    spot.style.display = 'block';
    spot.style.left = Math.max(4, r.left - pad) + 'px';
    spot.style.top = Math.max(4, r.top - pad) + 'px';
    spot.style.width = Math.min(vw - 8, r.width + pad * 2) + 'px';
    spot.style.height = Math.min(vh - 8, r.height + pad * 2) + 'px';

    var ph = Math.min(panel.offsetHeight || 640, vh - margin * 2), left, top;
    if (r.right + gap + panelW <= vw - margin) left = r.right + gap;
    else if (r.left - gap - panelW >= margin) left = r.left - gap - panelW;
    else left = Math.max(margin, Math.min(vw - panelW - margin, r.left));
    if (r.bottom + gap + ph <= vh - margin && r.width > vw * .45) top = r.bottom + gap;
    else top = Math.max(margin, Math.min(vh - ph - margin, r.top));
    panel.style.left = left + 'px'; panel.style.top = top + 'px';
  }

  global.Guide = {
    init: init, toggle: toggle, start: start, stop: stop, refresh: function () { setTimeout(refresh, 0); },
    isActive: function () { return active; }, currentStep: function () { return index; }, steps: steps
  };
})(window);
