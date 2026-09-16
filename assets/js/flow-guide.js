/* =============================================================================
 * flow-guide.js —— 可选择的具体业务流程蒙版引导
 * 30 个标准流程 + 2 个跨模块综合演练；每一步区分业务流程与应用操作流程。
 * ========================================================================== */
(function (global) {
  'use strict';
  var h = Core.h;
  var root, trigger, topHost, activeFlow = null, stepIndex = 0, focusEl = null, resizeTimer = null;
  var STORAGE_PROGRESS = 'rcs.flowGuide.progress';
  var STORAGE_COMPLETED = 'rcs.flowGuide.completed';

  function step(title, route, target, business, operation, checkpoint) {
    return { title: title, route: route, target: target || '.page-head', business: business,
      operation: operation, checkpoint: checkpoint };
  }

  function makeFlow(d) {
    d.steps = [
      step('认识流程范围与参与模块', d.route, '[data-guide="nav-' + d.nav + '"]',
        d.summary,
        '从左侧「' + d.primary + '」进入本流程。先确认当前操作人、账期和业务对象，再按引导进入具体页面；涉及协同模块时，系统会自动切换页面。',
        '参与模块：' + d.modules.join(' → ') + '。先确认每个模块的职责边界，再开始业务操作。'),
      step('执行核心业务步骤', d.route, '.page-head', d.business, d.operation, d.checkpoint),
      step('检查结果并完成下游交接', d.nextRoute || d.route, '.page-head', d.outcome, d.verify,
        '完成标志：' + d.result)
    ];
    return d;
  }

  var flows = [
    makeFlow({ id: '01', stage: '日常运营', title: '岗位登录与运营日启', primary: '运营监控大盘',
      modules: ['运营监控大盘', '审批中心 · 待办', '告警中心'], nav: 'dashboard', route: '/dashboard?period=2026-04',
      summary: '按岗位汇总账期进度、资金进度、风险和个人待办，形成当天的处理优先级。',
      business: '每天先处理 P0/P1 与阻断项，再处理临期任务和普通待办；同一指标必须明确账期与统计截至日。',
      operation: '选择账期，依次查看“我的工作台”“账期进度”“资金进度”和“异常与待办”，点击卡片或“去处理”进入业务明细。',
      checkpoint: '不要逐页巡检；应由大盘按角色把人导向需要处理的业务对象。', nextRoute: '/approvals',
      outcome: '个人审批任务进入「审批中心 · 待办」，风险任务进入「告警中心」，大盘只聚合和导流。',
      verify: '核对本人待办数量和告警级别，打开最高优先级事项并确认已进入正确业务页面。', result: '形成清晰的当日待办顺序并进入第一项任务。' }),

    makeFlow({ id: '02', stage: '接入配置', title: '新资金方五天接入 SOP', primary: '接入 SOP（5 天）',
      modules: ['接入 SOP（5 天）', '资金方主数据', '规则中心', '审批中心 · 待办'], nav: 'onboard', route: '/onboard',
      summary: '用五天标准日程串联主体准入、账户验证、协议签署、规则试算和上线检查。',
      business: 'D1 至 D5 每天都有负责人、交付物和强制卡点；任一阻断项未通过都不能推进到下一阶段。',
      operation: '新建或打开接入任务，按日完成清单并记录交付物；进入任务详情查看条款拆解、规则校验、审批和首日监控。',
      checkpoint: '准入通过不等于可以结算，账户白名单、协议有效期和规则生效状态必须同时就绪。', nextRoute: '/partners',
      outcome: 'SOP 只负责编排，最终主体、账户和协议落在「资金方主数据」，规则落在「规则中心」。',
      verify: '回到资金方列表确认档案可查，再检查规则版本和审批状态是否满足上线条件。', result: '接入任务完成且上线检查无阻断项。' }),

    makeFlow({ id: '03', stage: '接入配置', title: '资金方主体准入与建档', primary: '资金方主数据',
      modules: ['资金方主数据', '接入 SOP（5 天）', '运营与审计'], nav: 'partners', route: '/partners',
      summary: '建立全系统唯一的资金方主体根数据，为协议、账单和结算提供稳定归属。',
      business: '主体编号和统一社会信用代码必须唯一；一个主体可承担多个合作角色，但身份不可重复建立。',
      operation: '点击“新建资金方档案”，录入主体、机构类型、合作角色和币种，完成准入校验后保存并流转合作状态。',
      checkpoint: '暂停合作只限制新增业务，存量账务仍须继续结算和对账。', nextRoute: '/ops',
      outcome: '资金方档案被规则、计费、账单和结算共同引用，后续修改必须保留变更前后快照。',
      verify: '在资金方列表搜索新编号，再到运营与审计页确认建档日志和变更内容。', result: '生成唯一资金方编号且操作留痕完整。' }),

    makeFlow({ id: '04', stage: '接入配置', title: '银行账户新增、变更与双人复核', primary: '资金方主数据',
      modules: ['资金方主数据', '审批中心 · 待办', '结算中心'], nav: 'partners', route: '/partners',
      summary: '确保收付款只使用已验证、已复核的白名单账户。',
      business: '账户名、协议主体、币种和用途必须一致；新增或变更账户必须由非发起人复核。',
      operation: '进入资金方详情的账户页，新建或编辑账户，完成校验后提交审批；切换到复核角色，在审批待办中查看证据并处理。',
      checkpoint: '历史账户只停用不删除；账户内容变化会使原审批结论失效。', nextRoute: '/approvals',
      outcome: '审批通过后账户进入白名单，结算中心才允许使用；退票会反向冻结账户。',
      verify: '在审批详情核对发起人与复核人不同，并返回结算检查账户是否可选。', result: '账户处于已复核白名单状态。' }),

    makeFlow({ id: '05', stage: '接入配置', title: '开票信息维护', primary: '资金方主数据',
      modules: ['资金方主数据', '账单中心', '运营与审计'], nav: 'partners', route: '/partners',
      summary: '维护开票抬头、税号和银行信息，为应收开票、应付收票和红冲提供依据。',
      business: '发票使用生成时的税务快照；主数据后续变化不能覆盖历史票据依据。',
      operation: '进入资金方详情的开票信息页，填写抬头、税号、地址电话、开户行账号和税务身份，校验通过后保存。',
      checkpoint: '抬头与税号为硬校验，缺失时账单确认后也不能提交开票。', nextRoute: '/invoices',
      outcome: '账单中心生成发票申请时读取有效信息并固化快照，发票状态与原始主数据版本可追溯。',
      verify: '在发票页打开申请，核对购销方、税号、税率与主数据一致。', result: '开票信息完整且发票前置校验通过。' }),

    makeFlow({ id: '06', stage: '接入配置', title: '协议新签、条款拆解与版本变更', primary: '资金方主数据',
      modules: ['资金方主数据', '规则中心', '审批中心 · 待办'], nav: 'partners', route: '/partners',
      summary: '将商务合同拆解为有生效区间的协议版本、结算条款和计费边界。',
      business: '协议版本区间必须连续且不重叠；已生效版本不能覆盖，变更只能新增版本。',
      operation: '进入资金方详情维护协议主档和结算条款，创建新版本，设置生效与失效日期后提交审批。',
      checkpoint: '重点核对费用方向、账期、出账日、税务约定、争议和超期策略。', nextRoute: '/rules',
      outcome: '规则中心基于协议版本配置计费规则，计费引擎按业务发生日路由历史版本。',
      verify: '在规则列表按协议查找版本，确认生效区间和协议引用一致。', result: '协议版本有效且可创建对应规则。' }),

    makeFlow({ id: '07', stage: '规则计费', title: '计费规则配置', primary: '规则中心',
      modules: ['规则中心', '资金方主数据'], nav: 'rules', route: '/rules',
      summary: '把协议中的触发事件、计费对象、基数、费率和冲正机制转为结构化规则。',
      business: '规则五要素必须闭合，费率单位、应收应付方向、阶梯边界、税率和生效区间不可含糊。',
      operation: '点击新建规则或从模板创建，选择协议版本，逐步配置费用项、触发事件、基数、模型、方向和税率并保存草稿。',
      checkpoint: '规则配置只定义计算方法，不直接生成费用。', nextRoute: '/trial',
      outcome: '完整规则草稿进入试算，只有试算和审批通过后才能发布。',
      verify: '进入试算页，确认规则版本、协议引用和样例输入已正确加载。', result: '规则草稿完整且具备试算条件。' }),

    makeFlow({ id: '08', stage: '规则计费', title: '规则试算与版本影响比对', primary: '规则中心',
      modules: ['规则中心', '计费引擎'], nav: 'rules', route: '/trial',
      summary: '在发布前验证金额与边界，并量化新旧版本对历史样本的影响。',
      business: '试算与正式计费必须共用同一计算内核，才能避免上线后公式不一致。',
      operation: '选择规则和样例事件，执行试算，查看基数、费率、税额与逐步计算；再执行新旧版本比对并查看影响对象。',
      checkpoint: '必须覆盖阶梯临界值、日费率、保底封顶、跨版本和冲正样例。', nextRoute: '/rules',
      outcome: '试算报告和影响金额构成审批证据，决定是否允许提交发布。',
      verify: '返回规则版本页，检查试算状态、差异摘要和证据包是否齐全。', result: '标准样例全部通过且版本影响可解释。' }),

    makeFlow({ id: '09', stage: '规则计费', title: '规则审批、发布与生效', primary: '规则中心',
      modules: ['规则中心', '审批中心 · 待办', '运营与审计'], nav: 'rules', route: '/rules',
      summary: '让影响资金的规则经过分级审批，并按指定日期成为可路由的有效版本。',
      business: '审批绑定固化内容和指纹；规则内容变化后原审批失效，历史版本不可删除。',
      operation: '在规则版本页提交审批，切换到对应岗位逐级处理；全部通过后发布并核对计划生效日。',
      checkpoint: '发起人不得自批，高金额或追溯生效必须自动升级审批层级。', nextRoute: '/approvals',
      outcome: '发布后的规则在生效日进入计费路由，审批与发布日志同步进入审计。',
      verify: '打开审批单核对内容版本、指纹、前序意见和最终结论，再回规则页确认状态。', result: '规则为已发布／待生效或生效中。' }),

    makeFlow({ id: '10', stage: '规则计费', title: '业务事件接入与幂等处理', primary: '计费引擎',
      modules: ['计费引擎', '告警中心'], nav: 'charge', route: '/events',
      summary: '接收信贷核心的放款、还款、余额和逾期等业务事实，并阻止重复计费。',
      business: '相同事件、计费项和规则版本只能形成一组有效结果；重复事件要记录幂等命中而不能重复收费。',
      operation: '在事件中心筛选待处理、失败和重复事件，打开详情查看字段校验、幂等键、协议路由和处理日志。',
      checkpoint: '事件必须最终进入已计费、已忽略、已冲正或明确失败状态。', nextRoute: '/charge',
      outcome: '校验通过的事件进入计费，连续失败或积压超过阈值进入告警。',
      verify: '在计费引擎总览检查事件状态分布，并确认重复事件没有新增费用流水。', result: '事件状态明确且没有重复计费。' }),

    makeFlow({ id: '11', stage: '规则计费', title: '事件完整性核对与补数', primary: '计费引擎',
      modules: ['计费引擎', '告警中心', '账单中心'], nav: 'charge', route: '/replenish',
      summary: '按日期、资金方和事件类型发现漏推缺口，并以可重复执行的方式补齐。',
      business: '补数应拉取范围全量再由幂等过滤；跨已封账账期的新增费用只能进入下期调整项。',
      operation: '选择日期和资金方执行完整性核对，打开缺口明细，拉取上游范围数据并执行补齐，再次核对笔数。',
      checkpoint: '重复执行补数不能产生重复事件或重复费用。', nextRoute: '/alerts',
      outcome: '缺口归零后事件自动进入计费；未恢复或跨期影响分别进入告警和调整项。',
      verify: '检查补数批次、幂等拦截数、补齐数和跨期落点，并查看相关告警。', result: '上游与本系统事件笔数一致或差异有明确结论。' }),

    makeFlow({ id: '12', stage: '规则计费', title: 'T+1 日度核算调度', primary: '计费引擎',
      modules: ['计费引擎', '运营监控大盘', '告警中心'], nav: 'charge', route: '/daily',
      summary: '每天完成快照、事件和费用核算，把月末压力前移并及时发现异常。',
      business: '快照未到齐、事件积压、金额异常或冲正率越线时，应立即阻断或告警。',
      operation: '选择业务日执行七段调度，逐段查看快照、事件、规则路由、流水生成和异常检查结果。',
      checkpoint: '不要跳过失败步骤继续出账；每个资金方都必须有独立日度结果。', nextRoute: '/dashboard?period=2026-04',
      outcome: '日度费用和异常回写运营大盘，形成账期进度和次日处理清单。',
      verify: '回到大盘核对事件处理率、快照到齐数和异常待办是否与调度结果一致。', result: '当日核算完成且阻断项已清零或已升级。' }),

    makeFlow({ id: '13', stage: '规则计费', title: '费用计算与基数快照', primary: '计费引擎',
      modules: ['计费引擎', '资金方主数据', '规则中心'], nav: 'charge', route: '/charge',
      summary: '按事件发生日匹配协议和规则，把业务事实转换为可审计的原子费用流水。',
      business: '计算必须固化协议版本、规则版本、基数和价税过程；含税金额等于不含税金额加税额。',
      operation: '打开一笔事件，检查路由的协议与规则，查看基数快照和计算过程，然后进入生成的费用流水。',
      checkpoint: '金额按分处理，原始事件和规则快照必须可追溯。', nextRoute: '/flows',
      outcome: '费用流水成为账单归集的最小单元，任何修正都通过冲正或重算而非直接编辑。',
      verify: '在费用流水页核对事件号、规则版本、基数、方向、税额和所属账期。', result: '费用流水金额正确且依据完整。' }),

    makeFlow({ id: '14', stage: '规则计费', title: '费用流水查询与链路核验', primary: '计费引擎',
      modules: ['计费引擎', '全链路追溯'], nav: 'charge', route: '/flows',
      summary: '解释一笔费用从哪个事件产生、按哪版规则计算并流向哪张账单。',
      business: '任何金额只有同时具备原始事实、版本依据和计算过程，才满足可审计要求。',
      operation: '按流水号、事件号、借据号或资金方筛选，打开明细检查计算过程，并复制编号进入全链路查询。',
      checkpoint: '发现断链时应定位缺失关系，而不是用人工备注代替系统关联。', nextRoute: '/trace',
      outcome: '全链路追溯把流水向前连接事件和规则，向后连接账单、结算与回单。',
      verify: '输入流水号展开追溯树，确认前后节点和金额连续。', result: '费用流水可完整回溯且可向后追到业务终点。' }),

    makeFlow({ id: '15', stage: '规则计费', title: '费用冲正', primary: '计费引擎',
      modules: ['计费引擎', '审批中心 · 待办', '账单中心'], nav: 'charge', route: '/reversal',
      summary: '用反向流水撤销全部或部分原费用，同时保留原始账务事实。',
      business: '原流水不可修改，累计冲正不得超过原金额；跨封账账期必须进入后续账期调整。',
      operation: '选择原费用流水，填写冲正比例、原因和日期，预览反向金额后提交审批并执行。',
      checkpoint: '冲正流水必须关联原流水并保留方向、税额和账期落点。', nextRoute: '/adjustments',
      outcome: '同账期冲正参与当前账单，跨期冲正由账单中心形成独立调整项。',
      verify: '在调整项列表核对来源流水、目标账期、金额和审批状态。', result: '原流水保留且反向结果正确入账。' }),

    makeFlow({ id: '16', stage: '规则计费', title: '范围重算与差额原子生效', primary: '计费引擎',
      modules: ['计费引擎', '规则中心', '审批中心 · 待办', '账单中心'], nav: 'charge', route: '/recalc',
      summary: '先在影子区评估批量重算差异，再经审批一次性红冲旧结果并补记新结果。',
      business: '审批前不能污染正式流水；重算生效必须原子化，要么全部成功，要么全部回滚。',
      operation: '选择资金方、时间和目标规则版本，启动影子计算，逐笔查看差异，汇总影响后提交审批。',
      checkpoint: '试算、重算和正式计费必须使用同一计算内核。', nextRoute: '/approvals',
      outcome: '审批通过后系统生成冲正和补记流水；跨期差额进入账单调整项。',
      verify: '在审批单检查影响范围和金额，再返回流水或调整项确认原子生效结果。', result: '正式结果与批准后的影子结果一致。' }),

    makeFlow({ id: '17', stage: '账单发票', title: '预出账预测与快照比对', primary: '账单中心',
      modules: ['账单中心', '计费引擎', '运营监控大盘'], nav: 'bills', route: '/prebill',
      summary: '账期中预测账单落点，提前发现缺数、规则异常和金额偏离。',
      business: '预出账是只读预测，不占账单号、不绑定流水、不改变实体状态。',
      operation: '选择账期执行预出账，查看逐组合金额、线性外推与同期比对区间，保存快照并对比历史快照。',
      checkpoint: '调整项和上期结转作为已知量，不参与费用外推。', nextRoute: '/dashboard?period=2026-04',
      outcome: '预测结果和阻断项回到大盘，账期末快照应与正式账单分文一致。',
      verify: '核对落点区间、阻断项和快照差异解释，并确认没有产生正式账单号。', result: '获得可解释的账单预测且未改动正式状态。' }),

    makeFlow({ id: '18', stage: '账单发票', title: '月末封账与正式账单生成', primary: '账单中心',
      modules: ['账单中心', '计费引擎', '对账中心', '告警中心'], nav: 'bills', route: '/workbench',
      summary: '冻结账期事实，并按资金方、协议、方向和账期归集正式账单。',
      business: '未计费事件、快照缺失、勾稽不平或价税不恒等都会阻断封账。',
      operation: '在出账工作台执行前置检查，逐项处理阻断；全部通过后封账并生成账单。',
      checkpoint: '正式账单生成后不能直接改写，后续变化必须走争议、调整、冲正或重算。', nextRoute: '/bills',
      outcome: '费用流水、调整项和上期结转形成账单三项构成，并保留封账批次。',
      verify: '打开账单详情，核对含税恒等、构成项、流水绑定和封账时间。', result: '正式账单生成且全部前置检查通过。' }),

    makeFlow({ id: '19', stage: '账单发票', title: '账单推送、确认与超期处理', primary: '账单中心',
      modules: ['账单中心', '告警中心', '结算中心'], nav: 'bills', route: '/bills',
      summary: '取得资金方对账单的正式确认，并按协议处理超期未反馈。',
      business: '自动确认必须有协议依据；没有配置时缺省 HOLD，未确认金额不得进入结算。',
      operation: '打开账单推送资金方并登记反馈；进入出账日历检查确认截止日，对超期账单执行 AUTO_CONFIRM 或 HOLD 策略。',
      checkpoint: '部分争议只冻结争议金额，无争议部分仍可继续结算。', nextRoute: '/settle',
      outcome: '已确认的可结算金额进入结算中心，超期或争议事项进入告警与争议流程。',
      verify: '在结算列表确认只有已确认且未冻结金额被纳入。', result: '账单确认状态明确且可结算范围正确。' }),

    makeFlow({ id: '20', stage: '账单发票', title: '调整项申请与入账', primary: '账单中心',
      modules: ['账单中心', '审批中心 · 待办', '运营与审计'], nav: 'bills', route: '/adjustments',
      summary: '用独立可审批的调整项承接跨期冲正、重算差额和其他有依据的修正。',
      business: '调整项不能直接改写历史账单，必须关联来源、说明原因并指定目标账期。',
      operation: '新建调整项，关联来源单据，填写方向、金额、原因和目标账期，上传证据后提交审批。',
      checkpoint: '无来源、无原因或无审批的调整项不得进入账单。', nextRoute: '/approvals',
      outcome: '审批通过的调整项作为账单独立构成项进入预出账和正式出账。',
      verify: '在审批详情核对证据和内容指纹，再回调整项检查入账状态。', result: '调整项获批并落入正确账期。' }),

    makeFlow({ id: '21', stage: '账单发票', title: '账单争议核查与闭环', primary: '账单中心',
      modules: ['账单中心', '规则中心', '计费引擎', '审批中心 · 待办'], nav: 'bills', route: '/disputes',
      summary: '对费率、基数、金额、重复计费和冲正等争议生成有证据的核查结论。',
      business: '无核查包不得出结论；结论分为维持原账单、己方有误和需要重算。',
      operation: '打开争议单执行自动定位，查看事件、基数、规则和流水判定，填写结论并生成说明、调整项或重算任务。',
      checkpoint: 'T+3 升财务负责人、T+5 升业务负责人，等待对方回复也不暂停 SLA。', nextRoute: '/recalc',
      outcome: '维持原账单输出说明材料；己方有误形成调整项；需要重算进入范围重算。',
      verify: '检查核查包、资金方确认、下游产物和争议状态是否一致。', result: '争议有证据、有结论、有下游处理并正式关闭。' }),

    makeFlow({ id: '22', stage: '账单发票', title: '开票、收票与红冲', primary: '账单中心',
      modules: ['账单中心', '资金方主数据', '审批中心 · 待办'], nav: 'bills', route: '/invoices',
      summary: '完成应收开票、应付收票，以及账单变化后的红蓝票处理。',
      business: '购销方由收付方向决定；已开票账单不能直接作废，蓝票与红票合计必须等于应结金额。',
      operation: '打开发票任务，核对购销方、税号、税率和分类编码，提交发票平台；需要红冲时查看跨年与起开线判定后发起。',
      checkpoint: '发票申请固化税务快照，主数据变化不能覆盖历史票据。', nextRoute: '/bills',
      outcome: '票据状态回写账单，并与账单确认、调整和作废动作保持一致。',
      verify: '回到账单详情核对发票号码、蓝红票金额和票账恒等关系。', result: '票账状态一致且税务证据完整。' }),

    makeFlow({ id: '23', stage: '资金结算', title: '结算单生成与轧差', primary: '结算中心',
      modules: ['结算中心', '账单中心', '资金方主数据', '对账中心'], nav: 'settle', route: '/settle',
      summary: '将已确认账单按账户、结算日和币种边界归集为应收或应付结算单。',
      business: '禁止跨账户、跨结算日或跨币种合并；轧差必须有协议依据。',
      operation: '选择账期生成结算单，打开详情检查账单分摊、争议冻结、收付方向、账户和十项资金安全控制。',
      checkpoint: '金额、白名单账户或勾稽任一硬校验失败都不能提交。', nextRoute: '/settleorder/ST202604090000000003',
      outcome: '结算单固化可结算账单、账户、计划日期和轧差过程，等待审批。',
      verify: '在结算详情逐项核对分摊、轧差、账户和风险检查。', result: '结算单边界正确且具备提交审批条件。' }),

    makeFlow({ id: '24', stage: '资金结算', title: '结算单分级审批', primary: '审批中心 · 待办',
      modules: ['审批中心 · 待办', '结算中心', '运营与审计'], nav: 'approvals', route: '/approvals',
      summary: '按照结算金额和风险标记完成岗位接力，并固化审批身份与证据。',
      business: '发起人不得自批；审批的是固化版本，账户、金额或分摊变化后必须重新发起。',
      operation: '在“我的待办”打开结算审批，核对内容版本、指纹、账户、分摊、风险检查和前序意见后通过或驳回。',
      checkpoint: '敏感操作需要二次身份验证，审批日志必须记录姓名与当时角色。', nextRoute: '/settle',
      outcome: '审批结果回写结算单；应付进入付款，应收进入待收款。',
      verify: '返回结算列表确认状态和下一动作与收付方向一致。', result: '审批链完整且结算单进入正确执行状态。' }),

    makeFlow({ id: '25', stage: '资金结算', title: '应付付款指令、回调与回单', primary: '结算中心',
      modules: ['结算中心', '对账中心', '告警中心'], nav: 'settle', route: '/settleorder/ST202604090000000003',
      summary: '执行平台向资金方的付款，并取得可勾稽的结算流水和银行回单。',
      business: '支付受理不等于资金成功；指令、结算流水和回单必须分层保存且金额一致。',
      operation: '在应付结算详情下发付款指令，查看通道路由、受理和最终回调，成功后打开结算流水与回单。',
      checkpoint: '支付请求必须幂等，重复点击不能形成重复出款。', nextRoute: '/tieout?period=2026-03',
      outcome: '成功结果进入 L4 结算流水和 L5 银行回单，供对账中心独立核验。',
      verify: '在五级勾稽查看 L3→L4→L5 金额和状态是否一致。', result: '付款成功且回单已取得、勾稽通过。' }),

    makeFlow({ id: '26', stage: '资金结算', title: '付款异常处理', primary: '结算中心',
      modules: ['结算中心', '告警中心', '账单中心', '资金方主数据', '对账中心'], nav: 'settle', route: '/payexc',
      summary: '安全处理支付状态未知、部分成功和退票，防止重复付款和账实不符。',
      business: 'UNKNOWN 禁止盲重试；部分成功同时处理补发与结转；退票必须回退账单并冻结账户。',
      operation: '选择异常类型，查看主动查询时间表、成功失败明细或退票原因；按页面提供的合法出口执行人工确认、补发或账户整改。',
      checkpoint: '状态未知界面没有重试按钮是资金安全设计，不是功能缺失。', nextRoute: '/alerts',
      outcome: '未知超时产生 P0，未付金额进入下期，退票账户移出白名单并阻断重新结算。',
      verify: '检查告警、下期结转、账户状态和勾稽差异是否与异常分支一致。', result: '异常资金状态有唯一、可审计的处理结论。' }),

    makeFlow({ id: '27', stage: '资金结算', title: '应收入账匹配、挂账认领与复核', primary: '结算中心',
      modules: ['结算中心', '审批中心 · 待办', '对账中心', '告警中心'], nav: 'settle', route: '/claim',
      summary: '把银行入账准确核销到待收款结算单，并处理无法自动命中的来款。',
      business: '自动匹配按备注单号、账户金额精确、金额容差和多笔组合依次执行；不明来款不得强行清账。',
      operation: '打开入账流水查看四级匹配结果；对挂账选择认领、非本系统款项或原路退回，认领后切换另一角色复核。',
      checkpoint: '认领人不得自复核；部分到账只核销实收，剩余金额继续待收。', nextRoute: '/tieout?period=2026-03',
      outcome: '复核通过后生成结算流水和回单，完成应收方向 L4→L5；超三工作日挂账升级告警。',
      verify: '核对已收、剩余应收、流水、回单和复核人，再检查五级勾稽。', result: '入账有明确归属或独立终态，金额和回单一致。' }),

    makeFlow({ id: '28', stage: '对账风控', title: '五级勾稽与内部差异定位', primary: '对账中心',
      modules: ['对账中心', '计费引擎', '账单中心', '结算中心', '告警中心'], nav: 'recon', route: '/tieout?period=2026-03',
      summary: '独立核对业务事件、费用流水、账单、结算流水和银行回单五层数据。',
      business: '金额一致和状态一致必须同时满足；勾稽左右两侧要独立取数，才能发现中间丢数。',
      operation: '选择账期执行勾稽，逐级查看 A—N 等式、左右值、差额和阻断级别，点击失败项进入差异定位。',
      checkpoint: '勾稽不平是阻断条件，不能仅作为提示忽略。', nextRoute: '/diffs',
      outcome: '不平项生成内部差异单并标明可能断点，修复后必须重新执行勾稽。',
      verify: '在差异工作台核对来源层级、差额、证据和处理状态。', result: '五层等式通过或每个不平项都有差异单。' }),

    makeFlow({ id: '29', stage: '对账风控', title: '外部文件对账与差异闭环', primary: '对账中心',
      modules: ['对账中心', '账单中心', '计费引擎', '审批中心 · 待办'], nav: 'recon', route: '/external',
      summary: '与资金方逐笔核对费用明细，并把不一致转成有责任、有证据的处理闭环。',
      business: '先按费用流水号匹配，再以借据号加计费项兜底；容差核销仍需累计监控。',
      operation: '依次完成导出我方 CSV、载入资金方回传、逐笔匹配和生成差异单；打开差异执行事件、基数、费率逐层定位。',
      checkpoint: '差异关闭必须具备原因、责任、处理和复核四要素。', nextRoute: '/diffs',
      outcome: '金额修正回到调整项或重算，口径一致则输出说明材料；高风险变更走审批。',
      verify: '检查匹配率、差异率、容差累计、核查包和下游处理结果。', result: '外部差异全部闭环或处于明确 SLA 中。' }),

    makeFlow({ id: '30', stage: '对账风控', title: '风险告警、全链路追溯、运营审计与验收复盘', primary: '告警中心',
      modules: ['告警中心', '全链路追溯', '运营与审计', '验收场景', '运营监控大盘'], nav: 'alerts', route: '/alerts',
      summary: '把风险从发现推进到定位、修复、验证、关闭和复盘，并用场景证明问题不再发生。',
      business: 'P0 不得暂不处理，指标未回落不得标记已修复；P0/P1 必须逐条关闭并保留证据。',
      operation: '扫描指标并打开告警，从关联编号进入全链路追溯，修复后验证指标回落，填写处置方式和说明，再到运营与审计复盘。',
      checkpoint: '关闭告警不等于隐藏告警，必须有业务修复、验证结果和责任记录。', nextRoute: '/scenarios',
      outcome: '操作、审批、变更、追溯和告警记录共同构成闭环证据，高风险边界由验收场景复现。',
      verify: '在验收场景执行部分到账、部分争议或流水缺失，确认预期控制仍然生效。', result: '告警关闭、根因清楚、证据完整且回归验收通过。' })
  ];

  flows.push({
    id: 'X1', stage: '综合演练', title: '完整月结闭环综合演练', primary: '运营监控大盘',
    modules: ['运营监控大盘', '计费引擎', '账单中心', '审批中心 · 待办', '结算中心', '对账中心'],
    summary: '从账期检查开始，连续完成核算、出账、审批、结算和勾稽。',
    steps: [
      step('从账期大盘识别月结任务', '/dashboard?period=2026-04', '.page-head',
        '月结先确认事件、快照、费用和阻断项是否就绪，再进入正式出账。',
        '选择 2026-04 账期，查看账期进度并点击“前往出账工作台”。', '记录待处理阻断项，不要直接跳到生成账单。'),
      step('完成核算与封账前检查', '/workbench', '.page-head',
        '封账冻结账期事实，所有事件和费用必须达到可出账状态。',
        '逐项执行前置检查，处理失败项后再封账并生成正式账单。', '未计费、缺快照或勾稽不平时必须保持阻断。'),
      step('确认账单并形成结算单', '/bills', '.page-head',
        '只有已确认的无争议金额可以进入结算。',
        '打开账单核对三项构成和价税恒等，登记确认后前往结算中心生成结算单。', '部分争议只冻结争议额。'),
      step('完成审批与收付执行', '/settle', '.page-head',
        '应付进入付款指令，应收进入待收款认领，两条路径都必须取得资金凭据。',
        '核对账户与轧差，提交审批；审批通过后按方向执行付款或到账认领。', '账户、金额和审批证据必须一致。'),
      step('用五级勾稽确认闭环', '/tieout?period=2026-04', '.page-head',
        '月结完成以业务、费用、账单、结算和回单五层一致为准。',
        '重新执行五级勾稽，查看每一级左右值和状态；失败项进入差异工作台。', '完成标志：五级勾稽通过，或所有差异都已生成处理单。')
    ]
  });

  flows.push({
    id: 'X2', stage: '综合演练', title: '资损异常处理闭环综合演练', primary: '告警中心',
    modules: ['告警中心', '全链路追溯', '计费引擎', '账单中心', '结算中心', '运营与审计', '验收场景'],
    summary: '从 P0/P1 告警出发，定位根因、修复业务、验证指标并完成审计复盘。',
    steps: [
      step('识别最高优先级风险', '/alerts', '.page-head',
        'P0 表示已发生或极可能发生资损，P1 表示关键数据不一致，应优先于普通待办。',
        '筛选 P0/P1，打开告警查看指标、阈值、关联对象和已升级层级。', '不要先关闭告警，先确认真实业务影响。'),
      step('沿全链路定位断点', '/trace', '.page-head',
        '根因应沿事件、规则、流水、账单、结算和回单逐层查找。',
        '输入告警关联编号展开追溯树，定位第一个金额或状态不连续的节点。', '记录根因节点和支持证据。'),
      step('回到业务模块修复', '/diffs', '.page-head',
        '修复方式可能是补数、冲正、重算、调整、重新认领或支付异常处置。',
        '根据差异核查包进入对应业务模块，完成审批和修复后重新执行勾稽。', '不得用人工备注代替正式业务动作。'),
      step('验证回落并关闭告警', '/alerts', '.page-head',
        '只有指标回到阈值内且业务状态一致，才能以“已修复”关闭。',
        '重新扫描指标，填写处理方式和不少于四个字的说明，附上处理证据后关闭。', 'P0 不允许选择“暂不处理”。'),
      step('审计复盘与回归验收', '/scenarios', '.page-head',
        '同类问题是否真正修复，需要操作留痕、根因复盘和边界场景回归共同证明。',
        '先在运营与审计查看变更记录，再在验收场景执行对应高风险案例。', '完成标志：告警关闭、证据完整、指标回落且场景验收通过。')
    ]
  });

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { } }
  function routeNow() { return location.hash.replace(/^#/, '') || '/dashboard'; }
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
  function flowById(id) { return flows.find(function (flow) { return flow.id === id; }); }

  function init() {
    if (root) return;
    root = document.getElementById('flow-guide-root');
    trigger = document.getElementById('btn-flow-guide');
    topHost = document.getElementById('guide-top-controls');
    if (!root || !trigger || !topHost) return;
    trigger.addEventListener('click', openCatalog);
    window.addEventListener('resize', function () {
      if (!activeFlow) return;
      clearTimeout(resizeTimer); resizeTimer = setTimeout(refresh, 80);
    });
    window.addEventListener('scroll', function () { if (activeFlow) position(); }, true);
    window.addEventListener('hashchange', function () { if (activeFlow) setTimeout(refresh, 60); });
    document.addEventListener('keydown', function (e) {
      if (!activeFlow) return;
      if (e.key === 'Escape') { e.preventDefault(); stop(false); }
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); previous(); }
    });
  }

  function openCatalog() {
    if (activeFlow) stop(false, true);
    if (global.Guide && Guide.isActive()) Guide.stop(false, true);
    var progress = readJSON(STORAGE_PROGRESS, {});
    var completed = readJSON(STORAGE_COMPLETED, {});
    var selectedStage = '全部';
    var body = h('div', { class: 'flow-catalog' });
    var intro = h('div', { class: 'flow-catalog-intro' },
      '选择一个流程后，系统会自动切换到对应页面并启动蒙版引导。每一步分别说明“业务流程”和“应用操作流程”。标准流程 30 个，另含 2 个跨模块综合演练。');
    var search = h('input', { class: 'flow-catalog-search', type: 'search', placeholder: '搜索流程、模块或关键词', 'aria-label': '搜索流程' });
    var count = h('span', { class: 'flow-catalog-count' });
    var toolbar = h('div', { class: 'flow-catalog-toolbar' }, [search, count]);
    var stageTabs = h('div', { class: 'flow-stage-tabs', role: 'tablist', 'aria-label': '流程阶段筛选' });
    var grid = h('div', { class: 'flow-catalog-grid' });
    body.appendChild(intro); body.appendChild(toolbar); body.appendChild(stageTabs); body.appendChild(grid);

    var stages = ['全部'].concat(flows.map(function (f) { return f.stage; }).filter(function (x, i, a) { return a.indexOf(x) === i; }));
    function draw() {
      stageTabs.innerHTML = '';
      stages.forEach(function (stage) {
        stageTabs.appendChild(h('button', { class: 'flow-stage-tab' + (stage === selectedStage ? ' active' : ''), type: 'button',
          role: 'tab', 'aria-selected': stage === selectedStage ? 'true' : 'false', onclick: function () { selectedStage = stage; draw(); } }, stage));
      });
      var q = String(search.value || '').trim().toLowerCase();
      var shown = flows.filter(function (flow) {
        if (selectedStage !== '全部' && flow.stage !== selectedStage) return false;
        return !q || (flow.id + ' ' + flow.title + ' ' + flow.summary + ' ' + flow.modules.join(' ')).toLowerCase().indexOf(q) >= 0;
      });
      count.textContent = '显示 ' + shown.length + ' / ' + flows.length + ' 个流程';
      grid.innerHTML = '';
      if (!shown.length) {
        grid.appendChild(h('div', { class: 'flow-catalog-empty' }, '没有匹配的流程，请更换关键词。'));
        return;
      }
      shown.forEach(function (flow) {
        var done = !!completed[flow.id], at = Number(progress[flow.id] || 0);
        var action = done ? '重新学习' : (at > 0 ? '继续第 ' + (at + 1) + ' 步' : '开始引导');
        grid.appendChild(h('button', { class: 'flow-catalog-card' + (done ? ' completed' : ''), type: 'button',
          onclick: function () { start(flow.id, done ? 0 : at); } }, [
          h('span', { class: 'flow-catalog-no' }, flow.id),
          h('span', { class: 'flow-catalog-main' }, [
            h('strong', null, flow.title), h('p', null, flow.summary),
            h('span', { class: 'flow-catalog-modules' }, flow.modules.map(function (m) { return h('span', null, m); }))
          ]),
          h('span', { class: 'flow-catalog-action' }, (done ? '✓ ' : '') + action + ' →')
        ]));
      });
    }
    search.addEventListener('input', draw);
    draw();
    UI.modal('流程引导 · 请选择要学习的具体流程', body,
      [h('button', { class: 'btn', type: 'button', onclick: UI.closeModal }, '关闭')], { size: 'wide' });
    setTimeout(function () { search.focus(); }, 0);
  }

  function start(flowId, at) {
    var flow = flowById(flowId);
    if (!flow) return;
    if (global.Guide && Guide.isActive()) Guide.stop(false, true);
    UI.closeModal();
    activeFlow = flow;
    stepIndex = Math.max(0, Math.min(flow.steps.length - 1, Number(at || 0)));
    trigger.setAttribute('aria-pressed', 'true');
    trigger.classList.add('active');
    trigger.title = '正在引导“' + flow.title + '”，点击可切换流程';
    document.body.classList.add('guide-running');
    show();
  }

  function stop(completed, silent) {
    if (!activeFlow) return;
    var flow = activeFlow;
    var progress = readJSON(STORAGE_PROGRESS, {});
    var completedMap = readJSON(STORAGE_COMPLETED, {});
    if (completed) { completedMap[flow.id] = true; progress[flow.id] = 0; }
    else progress[flow.id] = stepIndex;
    writeJSON(STORAGE_PROGRESS, progress);
    writeJSON(STORAGE_COMPLETED, completedMap);
    activeFlow = null;
    removeLayer();
    trigger.setAttribute('aria-pressed', 'false');
    trigger.classList.remove('active');
    trigger.title = '选择一个具体业务流程开始引导';
    if (!silent) UI.toast(completed ? '“' + flow.title + '”流程学习已完成' : '流程引导已暂停，下次可从本步继续',
      completed ? 'ok' : 'info', completed ? '流程完成' : '已退出引导');
  }

  function next() {
    if (!activeFlow) return;
    if (stepIndex >= activeFlow.steps.length - 1) {
      var title = activeFlow.title;
      stop(true, true); openCatalog(); UI.toast('“' + title + '”流程学习已完成，可继续选择其他流程', 'ok', '流程完成');
      return;
    }
    stepIndex++;
    var progress = readJSON(STORAGE_PROGRESS, {}); progress[activeFlow.id] = stepIndex; writeJSON(STORAGE_PROGRESS, progress);
    show();
  }
  function previous() { if (activeFlow && stepIndex > 0) { stepIndex--; show(); } }
  function backToCatalog() { stop(false, true); openCatalog(); }
  function jump(i) { if (activeFlow) { stepIndex = i; show(); } }

  function show() {
    if (!activeFlow) return;
    var s = activeFlow.steps[stepIndex];
    if (s.route && routeNow() !== s.route) {
      UI.goto(s.route); setTimeout(refresh, 90);
    } else refresh();
  }

  function refresh() {
    if (!activeFlow || !root) return;
    clearFocus();
    root.hidden = false; root.innerHTML = '';
    var s = activeFlow.steps[stepIndex];
    focusEl = s.target ? document.querySelector(s.target) : null;
    if (focusEl) focusEl.classList.add('guide-target-active');
    var shield = h('div', { class: 'guide-shield', 'aria-hidden': 'true' });
    var spotlight = h('div', { class: 'guide-spotlight', 'aria-hidden': 'true' });
    var panel = buildPanel(s);
    var topNav = buildTopNav();
    root.appendChild(shield); root.appendChild(spotlight); root.appendChild(panel);
    topHost.innerHTML = ''; topHost.hidden = false; topHost.appendChild(topNav);
    root._spotlight = spotlight; root._panel = panel;
    position();
  }

  function buildTopNav() {
    var flow = activeFlow;
    return h('nav', { class: 'guide-top-nav flow-guide-top-nav', 'aria-label': '流程引导快捷翻页' }, [
      h('button', { class: 'btn btn-sm', type: 'button', disabled: stepIndex === 0, onclick: previous }, '← 上一步'),
      h('span', { class: 'guide-top-count' }, flow.id + ' · ' + (stepIndex + 1) + ' / ' + flow.steps.length),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: next },
        stepIndex === flow.steps.length - 1 ? '完成并返回目录 ✓' : '下一步 →')
    ]);
  }

  function buildPanel(s) {
    var flow = activeFlow;
    var pct = Math.round(((stepIndex + 1) / flow.steps.length) * 100);
    var panel = h('section', { class: 'guide-panel flow-guide-panel', role: 'dialog', 'aria-modal': 'true',
      'aria-label': '流程引导：' + flow.title + '，' + s.title }, [
      h('div', { class: 'guide-panel-head' }, [
        h('div', null, [h('span', { class: 'guide-phase' }, flow.stage),
          h('span', { class: 'guide-count' }, '第 ' + (stepIndex + 1) + ' / ' + flow.steps.length + ' 步')]),
        h('button', { class: 'guide-close', type: 'button', title: '退出流程引导', onclick: function () { stop(false); } }, '×')
      ]),
      h('div', { class: 'guide-progress' }, h('i', { style: 'width:' + pct + '%' })),
      h('div', { class: 'guide-panel-body' }, [
        h('div', { class: 'flow-guide-title-row' }, [h('span', { class: 'flow-guide-id' }, flow.id), h('h2', null, flow.title)]),
        h('div', { class: 'flow-guide-modules' }, flow.modules.map(function (m) { return h('span', null, m); })),
        h('h3', { class: 'sec', style: 'margin:5px 0 3px' }, s.title),
        h('div', { class: 'guide-logic guide-business' }, [
          h('div', { class: 'guide-logic-title' }, [h('span', null, '业务'), ' 业务流程']), h('p', null, s.business)
        ]),
        h('div', { class: 'guide-logic guide-operation' }, [
          h('div', { class: 'guide-logic-title' }, [h('span', null, '操作'), ' 应用操作流程']), h('p', null, s.operation)
        ]),
        h('div', { class: 'guide-checkpoint' }, [h('b', null, '本步检查'), h('span', null, s.checkpoint)]),
        stepIndex === flow.steps.length - 1 ? h('div', { class: 'flow-guide-outcome' }, [h('b', null, '流程完成'), '完成检查后点击“完成并返回目录”。']) : null,
        h('button', { class: 'guide-outline-toggle', type: 'button', onclick: function () {
          var menu = panel.querySelector('.guide-outline'); menu.hidden = !menu.hidden;
          this.textContent = menu.hidden ? '查看本流程步骤' : '收起本流程步骤';
        } }, '查看本流程步骤'), buildOutline()
      ]),
      h('div', { class: 'guide-panel-foot' }, [
        h('button', { class: 'btn', type: 'button', disabled: stepIndex === 0, onclick: previous }, '上一步'),
        h('span', { class: 'guide-key-hint' }, '← → 切换 · Esc 退出'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: next }, stepIndex === flow.steps.length - 1 ? '完成并返回目录 ✓' : '下一步 →')
      ])
    ]);
    return panel;
  }

  function buildOutline() {
    var box = h('div', { class: 'guide-outline', hidden: true });
    activeFlow.steps.forEach(function (s, i) {
      box.appendChild(h('button', { class: 'guide-outline-step' + (i === stepIndex ? ' current' : ''), type: 'button',
        onclick: function () { jump(i); } }, [h('span', null, String(i + 1)), s.title]));
    });
    return box;
  }

  function position() {
    if (!activeFlow || !root || !root._panel || !root._spotlight) return;
    var panel = root._panel, spot = root._spotlight;
    var vw = window.innerWidth, vh = window.innerHeight, gap = 16, margin = 16;
    var panelW = Math.min(470, vw - margin * 2);
    panel.style.width = panelW + 'px';
    if (!focusEl || !document.documentElement.contains(focusEl)) {
      spot.style.display = 'none'; panel.classList.add('guide-panel-center');
      panel.style.left = Math.max(margin, (vw - panelW) / 2) + 'px';
      panel.style.top = Math.max(margin, (vh - Math.min(panel.offsetHeight || 650, vh - 32)) / 2) + 'px';
      return;
    }
    panel.classList.remove('guide-panel-center');
    var r = focusEl.getBoundingClientRect(), pad = 7;
    spot.style.display = 'block';
    spot.style.left = Math.max(4, r.left - pad) + 'px'; spot.style.top = Math.max(4, r.top - pad) + 'px';
    spot.style.width = Math.min(vw - 8, r.width + pad * 2) + 'px'; spot.style.height = Math.min(vh - 8, r.height + pad * 2) + 'px';
    var ph = Math.min(panel.offsetHeight || 650, vh - margin * 2), left, top;
    if (r.right + gap + panelW <= vw - margin) left = r.right + gap;
    else if (r.left - gap - panelW >= margin) left = r.left - gap - panelW;
    else left = Math.max(margin, Math.min(vw - panelW - margin, r.left));
    if (r.bottom + gap + ph <= vh - margin && r.width > vw * .45) top = r.bottom + gap;
    else top = Math.max(margin, Math.min(vh - ph - margin, r.top));
    panel.style.left = left + 'px'; panel.style.top = top + 'px';
  }

  global.FlowGuide = {
    init: init, openCatalog: openCatalog, start: start, stop: stop,
    refresh: function () { setTimeout(refresh, 0); }, isActive: function () { return !!activeFlow; },
    currentFlow: function () { return activeFlow; }, currentStep: function () { return stepIndex; }, flows: flows
  };
})(window);
