/* =============================================================================
 * data.js —— 字典与主数据种子
 * 对应 PRD：0.3 决策记录 / 2.1.2 事件字典 / 4 章主数据 / 5 章规则中心 / 14 章权限
 * ========================================================================== */
(function (global) {
  'use strict';
  var D = Core.D;

  /* ============================ 决策记录 D-01~D-10 ============================ */
  var DECISIONS = [
    { id: 'D-01', name: '计费方向', concl: '双向：收付方向作为一等属性贯穿规则、流水、账单、结算', ref: '5.2 / 6.10 / 7.2 / 8.2' },
    { id: 'D-02', name: '计费项范围', concl: '统一建模为「计费项」，不为特定费种写专用逻辑', ref: '5.3 / 6.2' },
    { id: 'D-03', name: '在贷余额口径', concl: '日终时点余额；日均余额为派生基数', ref: '2.4.2' },
    { id: 'D-04', name: '余额数据来源', concl: '贷款核心 T 日日终快照为唯一事实源，本系统落不可变副本', ref: '2.4.2 / 6.3' },
    { id: 'D-05', name: '日费率基准', concl: '360 天；算头不算尾（协议级可覆盖）', ref: '2.4.2 / 6.4.3' },
    { id: 'D-06', name: '账单确认后冲正', concl: '不重开账单，红冲计入下期调整项', ref: '6.7.4 / 7.6' },
    { id: 'D-07', name: '应收应付处理', concl: '支持轧差，按协议开关控制', ref: '8.3' },
    { id: 'D-08', name: '税与发票', concl: '系统内价税分离并发起开票申请，开票由发票系统执行', ref: '7.8' },
    { id: 'D-09', name: '币种', concl: '一期仅 CNY，保留 currency 字段', ref: '11.3' },
    { id: 'D-10', name: '资金方交互', concl: '一期文件/接口完成账单推送与对账', ref: '7.5 / 12.4' }
  ];

  /* ============================ 事件字典（PRD 6.2.2）============================ */
  var EVENT_DICT = [
    { code: 'EV_DISBURSE_SUCCESS', name: '放款成功', src: '放款系统', kind: 'POINT', idem: 'event_id',
      fields: ['loan_no', 'disburse_amount', 'funding_ratio', 'success_time'] },
    { code: 'EV_DISBURSE_REVERSE', name: '放款撤销', src: '放款系统', kind: 'REVERSE', idem: 'event_id',
      fields: ['loan_no', 'origin_event_id', 'reverse_amount'] },
    { code: 'EV_DAILY_BALANCE', name: '日终余额快照', src: '贷款核心', kind: 'PERIODIC', idem: 'loan_no + snapshot_date',
      fields: ['loan_no', 'principal_balance', 'overdue_days', 'asset_status', 'snapshot_date', 'snapshot_version'] },
    { code: 'EV_REPAY_SUCCESS', name: '还款入账成功', src: '还款系统', kind: 'POINT', idem: 'event_id',
      fields: ['loan_no', 'repay_principal', 'repay_interest', 'repay_penalty', 'repay_source', 'clear_time'] },
    { code: 'EV_REPAY_REVERSE', name: '还款冲正', src: '还款系统', kind: 'REVERSE', idem: 'event_id',
      fields: ['origin_event_id', 'reverse_amount'] },
    { code: 'EV_PREPAY_SETTLE', name: '提前结清', src: '还款系统', kind: 'POINT', idem: 'event_id',
      fields: ['loan_no', 'settle_amount', 'remain_periods'] },
    { code: 'EV_OVERDUE_CHANGE', name: '逾期状态变更', src: '贷款核心', kind: 'POINT', idem: 'loan_no + change_date',
      fields: ['loan_no', 'overdue_days', 'overdue_stage'] },
    { code: 'EV_COMPENSATE', name: '代偿', src: '担保系统', kind: 'POINT', idem: 'event_id',
      fields: ['loan_no', 'compensate_amount', 'guarantor_no'] },
    { code: 'EV_WRITE_OFF', name: '核销', src: '贷款核心', kind: 'POINT', idem: 'event_id',
      fields: ['loan_no', 'write_off_amount', 'effective_date'] },
    { code: 'EV_ASSET_BUYBACK', name: '资产回购', src: '资产管理', kind: 'POINT', idem: 'event_id',
      fields: ['loan_no', 'buyback_amount', 'effective_date'] },
    { code: 'EV_REFUND', name: '退款', src: '还款系统', kind: 'REVERSE', idem: 'event_id',
      fields: ['origin_event_id', 'refund_amount'] },
    { code: 'EV_PERIOD_CLOSE', name: '账期结束', src: '本系统调度', kind: 'CYCLE', idem: 'agreement + item + period',
      fields: ['period_start', 'period_end'] }
  ];

  /* ============================ 费种字典（PRD 5.2.2）============================ */
  var CHARGE_ITEM_DICT = [
    { code: 'TECH_SERVICE_FEE', name: '技术服务费', dir: 'RECEIVABLE', note: '助贷主要收入' },
    { code: 'GUARANTEE_FEE', name: '担保服务费', dir: 'BOTH', note: '视担保方是否为平台关联方' },
    { code: 'FUNDING_COST', name: '资金成本', dir: 'PAYABLE', note: '联合贷模式下向资金方支付' },
    { code: 'OVERDUE_MGMT_FEE', name: '逾期管理费', dir: 'RECEIVABLE', note: '' },
    { code: 'PROFIT_SHARING', name: '分润', dir: 'BOTH', note: '按回款分成' },
    { code: 'CHANNEL_FEE', name: '渠道费', dir: 'PAYABLE', note: '' },
    { code: 'EARLY_SETTLE_PENALTY', name: '提前结清违约金', dir: 'RECEIVABLE', note: '' },
    { code: 'BUYBACK_FEE', name: '回购手续费', dir: 'BOTH', note: '' }
  ];

  /* ============================ 基数类型 / 费率模型（PRD 6.3.2 / 6.4）============================ */
  var BASIS_TYPES = [
    { code: 'EVENT_AMOUNT', name: '事件金额型', src: '事件 payload 指定字段', fit: '时点事件' },
    { code: 'OUTSTANDING_BALANCE', name: '余额快照型', src: '日终快照 principal_balance', fit: 'EV_DAILY_BALANCE' },
    { code: 'OUTSTANDING_PRIN_INT', name: '含息余额型', src: '本金 + 应收未收利息', fit: 'EV_DAILY_BALANCE' },
    { code: 'OVERDUE_BALANCE', name: '逾期资产型', src: '逾期天数 ≥ 阈值的余额', fit: 'EV_DAILY_BALANCE' },
    { code: 'PERIOD_AGGREGATE', name: '区间聚合型', src: '周期内某类事件金额之和', fit: 'EV_PERIOD_CLOSE' },
    { code: 'DAILY_AVERAGE', name: '日均型', src: 'Σ日终余额 ÷ 账期自然日天数', fit: 'EV_PERIOD_CLOSE' },
    { code: 'EVENT_COUNT', name: '计数型', src: '满足条件的事件笔数（按业务主键去重）', fit: '任意' }
  ];
  var RATE_MODELS = [
    { code: 'FIXED_RATIO', name: '固定比例', formula: '费用 = 基数 × 费率' },
    { code: 'FIXED_AMOUNT', name: '固定金额', formula: '费用 = 单价 × 数量' },
    { code: 'DAILY_RATE', name: '日费率', formula: '费用 = 日终余额 × 年化 ÷ 基准' },
    { code: 'TIER_PROGRESSIVE', name: '阶梯·累进式', formula: 'Σ (落入各档金额 × 各档费率)' },
    { code: 'TIER_FLAT', name: '阶梯·超额式', formula: '基数 × 所落最高档费率' }
  ];

  /* ============================ 规则模板库（PRD 5.6.1）============================ */
  var RULE_TEMPLATES = [
    { code: 'TPL_DISB_RATIO', name: '放款额比例费 · 月结',
      desc: '触发 EV_DISBURSE_SUCCESS + 基数 EVENT_AMOUNT + 费率 FIXED_RATIO',
      skeleton: { event: 'EV_DISBURSE_SUCCESS', basis: 'EVENT_AMOUNT', basisField: 'disburse_amount', rate: 'FIXED_RATIO', cycle: 'MONTHLY', granularity: 'PER_EVENT', reversal: 'PROPORTIONAL' } },
    { code: 'TPL_BAL_DAILY', name: '在贷余额日费率 · 月结',
      desc: '触发 EV_DAILY_BALANCE + 基数 OUTSTANDING_BALANCE + 费率 DAILY_RATE',
      skeleton: { event: 'EV_DAILY_BALANCE', basis: 'OUTSTANDING_BALANCE', basisField: 'principal_balance', rate: 'DAILY_RATE', cycle: 'MONTHLY', granularity: 'PER_DAY', reversal: 'NONE' } },
    { code: 'TPL_DISB_TIER', name: '放款额阶梯费 · 月结（含月末找平）',
      desc: '触发 EV_DISBURSE_SUCCESS + 费率 TIER_PROGRESSIVE + EV_PERIOD_CLOSE 找平',
      skeleton: { event: 'EV_DISBURSE_SUCCESS', basis: 'EVENT_AMOUNT', basisField: 'disburse_amount', rate: 'TIER_PROGRESSIVE', cycle: 'MONTHLY', granularity: 'PER_EVENT', reversal: 'PROPORTIONAL' } },
    { code: 'TPL_REPAY_SHARE', name: '回款分润 · 月结',
      desc: '触发 EV_REPAY_SUCCESS + 基数 本金+利息 + 费率 FIXED_RATIO',
      skeleton: { event: 'EV_REPAY_SUCCESS', basis: 'EVENT_AMOUNT', basisField: 'repay_principal+repay_interest', rate: 'FIXED_RATIO', cycle: 'MONTHLY', granularity: 'PER_EVENT', reversal: 'PROPORTIONAL' } },
    { code: 'TPL_BAL_GUARANTEE', name: '担保费 · 余额型 · 排除逾期',
      desc: '同 TPL_BAL_DAILY + 过滤 overdue_days < 90',
      skeleton: { event: 'EV_DAILY_BALANCE', basis: 'OUTSTANDING_BALANCE', basisField: 'principal_balance', rate: 'DAILY_RATE', cycle: 'MONTHLY', granularity: 'PER_DAY', reversal: 'NONE', filter: { overdue: [0, 89] } } }
  ];

  /* ============================ 角色与权限（PRD 14 章）============================ */
  var ROLES = [
    { code: 'BD', name: '资金合作 BD' },
    { code: 'FIN_OP', name: '财务核算' },
    { code: 'FIN_REVIEW', name: '财务复核' },
    { code: 'FIN_MGR', name: '财务负责人' },
    { code: 'OPS', name: '运营' },
    { code: 'RISK', name: '风控' },
    { code: 'BIZ_MGR', name: '业务负责人' },
    { code: 'AUDIT', name: '审计（只读）' },
    { code: 'ADMIN', name: '系统管理员' }
  ];
  /* 演示环境中的具名操作人。权限仍按角色判断，审计记录同时保留用户与角色。 */
  var ROLE_USERS = {
    BD: { user_id: 'u_bd_zhang', user_name: '张敏' },
    FIN_OP: { user_id: 'u_fin_op_chen', user_name: '陈晨' },
    FIN_REVIEW: { user_id: 'u_fin_review_li', user_name: '李妍' },
    FIN_MGR: { user_id: 'u_fin_mgr_wang', user_name: '王宁' },
    OPS: { user_id: 'u_ops_zhao', user_name: '赵航' },
    RISK: { user_id: 'u_risk_sun', user_name: '孙洁' },
    BIZ_MGR: { user_id: 'u_biz_mgr_luo', user_name: '罗宇' },
    AUDIT: { user_id: 'u_audit_he', user_name: '何静' },
    ADMIN: { user_id: 'u_admin', user_name: '系统管理员' }
  };
  // 权限矩阵：功能 → 允许角色
  var PERMS = {
    'partner.edit':      ['BD', 'ADMIN'],
    'partner.admit':     ['FIN_MGR', 'RISK', 'ADMIN'],
    'account.create':    ['BD', 'FIN_OP', 'ADMIN'],
    'account.review':    ['FIN_REVIEW', 'FIN_MGR'],
    'account.verify':    ['FIN_OP', 'FIN_REVIEW', 'ADMIN'],
    'invoice.edit':      ['BD', 'FIN_OP', 'ADMIN'],
    'agreement.edit':    ['BD', 'ADMIN'],
    'agreement.approve': ['FIN_MGR', 'ADMIN'],
    'onboard.run':       ['BD', 'FIN_OP', 'OPS', 'ADMIN'],
    'onboard.sign':      ['BD', 'FIN_OP', 'FIN_MGR', 'ADMIN'],
    'approval.submit':   ['BD', 'FIN_OP', 'OPS', 'ADMIN'],
    'approval.act':      ['FIN_OP', 'FIN_REVIEW', 'FIN_MGR', 'RISK', 'BIZ_MGR'],
    'rule.edit':         ['BD', 'FIN_OP', 'ADMIN'],
    'rule.trial':        ['BD', 'FIN_OP', 'OPS', 'ADMIN'],
    'rule.publish':      ['FIN_OP', 'FIN_MGR', 'ADMIN'],
    'rule.approve':      ['FIN_OP', 'FIN_MGR', 'RISK'],
    'recalc.create':     ['FIN_OP', 'ADMIN'],
    'recalc.approve':    ['FIN_MGR', 'RISK'],
    'bill.preview':      ['BD', 'FIN_OP', 'FIN_REVIEW', 'FIN_MGR', 'OPS', 'ADMIN'],
    'bill.generate':     ['FIN_OP', 'ADMIN'],
    'bill.void':         ['FIN_OP', 'FIN_REVIEW'],
    'adjustment.create': ['FIN_OP', 'OPS'],
    'adjustment.approve':['FIN_REVIEW', 'FIN_MGR'],
    'settle.create':     ['FIN_OP'],
    'settle.approve':    ['FIN_REVIEW', 'FIN_MGR', 'RISK'],
    'settle.claim':      ['FIN_OP', 'OPS', 'ADMIN'],
    'settle.claim.review': ['FIN_REVIEW', 'FIN_MGR'],
    'invoice.apply':     ['FIN_OP', 'OPS', 'ADMIN'],
    'invoice.issue':     ['FIN_OP', 'FIN_REVIEW', 'FIN_MGR', 'ADMIN'],
    'invoice.void':      ['FIN_REVIEW', 'FIN_MGR'],
    'diff.handle':       ['FIN_OP', 'OPS', 'ADMIN'],
    'dispute.handle':    ['FIN_OP', 'OPS', 'FIN_REVIEW', 'ADMIN'],
    'alert.close':       ['FIN_OP', 'OPS', 'FIN_REVIEW', 'FIN_MGR', 'RISK', 'ADMIN'],
    'event.replay':      ['OPS', 'FIN_OP', 'ADMIN'],
    'sim.run':           ['BD', 'FIN_OP', 'FIN_REVIEW', 'FIN_MGR', 'OPS', 'RISK', 'ADMIN']
  };

  /* ============================ 产品 / 渠道字典 ============================ */
  var PRODUCTS = [
    { code: 'P001', name: '优享贷' }, { code: 'P002', name: '随心分' },
    { code: 'P003', name: '安居贷' }, { code: 'P004', name: '经营通' }
  ];
  var CHANNELS = [
    { code: 'CH001', name: '自有 APP' }, { code: 'CH005', name: '合作导流' },
    { code: 'CH008', name: '线下门店' }
  ];

  /* ============================ 主数据：资金方 ============================ */
  var PARTNERS = [
    { partner_no: 'P000012', partner_name: '华信银行股份有限公司', partner_short_name: '华信银行',
      unified_social_credit_code: '91110000MA01HX1201', partner_type: 'BANK', partner_roles: ['FUNDER'],
      license_no: 'B0012H111000123', regulator: '国家金融监督管理总局', coop_start_date: '2026-01-01',
      status: 'ACTIVE', owner_user_id: 'u_bd_zhang', admission_approval_no: 'ADM2025110023',
      remark: '标杆资金方，一期首家上线；应收应付并存，开启轧差' },
    { partner_no: 'P000018', partner_name: '长安国际信托有限公司', partner_short_name: '长安信托',
      unified_social_credit_code: '91610000MA01CA1802', partner_type: 'TRUST', partner_roles: ['FUNDER'],
      license_no: 'T0018C610000456', regulator: '国家金融监督管理总局', coop_start_date: '2026-01-01',
      status: 'ACTIVE', owner_user_id: 'u_bd_zhang', admission_approval_no: 'ADM2025120041',
      remark: '纯资金成本支付方，日费率按日计费按月结算' },
    { partner_no: 'P000007', partner_name: '星辰消费金融有限公司', partner_short_name: '星辰消金',
      unified_social_credit_code: '91310000MA01XC0703', partner_type: 'CONSUMER_FINANCE', partner_roles: ['FUNDER'],
      license_no: 'C0007X310000789', regulator: '国家金融监督管理总局', coop_start_date: '2026-02-01',
      status: 'ACTIVE', owner_user_id: 'u_bd_li', admission_approval_no: 'ADM2026010012',
      remark: '阶梯累进计费，月末需找平' },
    { partner_no: 'P000023', partner_name: '安泰融资担保有限公司', partner_short_name: '安泰担保',
      unified_social_credit_code: '91440000MA01AT2304', partner_type: 'GUARANTEE', partner_roles: ['GUARANTOR', 'CHANNEL'],
      license_no: 'G0023A440000234', regulator: '地方金融管理局', coop_start_date: '2026-01-01',
      status: 'ACTIVE', owner_user_id: 'u_bd_li', admission_approval_no: 'ADM2025120055',
      remark: '同一主体兼任担保方与通道方（partner_roles 多选）' },
    { partner_no: 'P000031', partner_name: '瑞通银行股份有限公司', partner_short_name: '瑞通银行',
      unified_social_credit_code: '91120000MA01RT3105', partner_type: 'BANK', partner_roles: ['FUNDER'],
      license_no: 'B0031R120000567', regulator: '国家金融监督管理总局', coop_start_date: '2026-03-01',
      status: 'ACTIVE', owner_user_id: 'u_bd_wang', admission_approval_no: 'ADM2026020008',
      remark: '回款分润 + 月度保底 50 万' },
    { partner_no: 'P000045', partner_name: '晟元融资租赁有限公司', partner_short_name: '晟元租赁',
      unified_social_credit_code: '91330000MA01SY4506', partner_type: 'OTHER', partner_roles: ['FUNDER'],
      license_no: '', regulator: '', coop_start_date: '2026-09-01',
      status: 'PENDING', owner_user_id: 'u_bd_wang', admission_approval_no: '',
      remark: '待准入 —— 用于演示准入状态机与 5 天接入 SOP' },
    { partner_no: 'P000052', partner_name: '宏泰商业银行股份有限公司', partner_short_name: '宏泰银行',
      unified_social_credit_code: '91370000MA01HT5207', partner_type: 'BANK', partner_roles: ['FUNDER'],
      license_no: 'B0052H370000901', regulator: '国家金融监督管理总局', coop_start_date: '2025-06-01',
      status: 'SUSPENDED', owner_user_id: 'u_bd_zhang', admission_approval_no: 'ADM2025050003',
      remark: '暂停合作 —— 不可新增计费，存量账单仍可结算' }
  ];

  /* ============================ 主数据：银行账户 ============================ */
  var ACCOUNTS = [
    { account_no_id: 'PA000012001', partner_no: 'P000012', account_name: '华信银行股份有限公司',
      bank_account_no: '6222020200088812345', bank_name: '华信银行总行营业部', bank_code: '313100000012',
      account_usage: 'BOTH', is_whitelisted: 1, whitelist_effective_time: '2026-01-02 00:00',
      status: 'ACTIVE', verify_status: 'VERIFIED', first_maker_id: 'u_bd_zhang', second_checker_id: 'u_fin_review' },
    { account_no_id: 'PA000018001', partner_no: 'P000018', account_name: '长安国际信托有限公司',
      bank_account_no: '6100031200099918888', bank_name: '中国建设银行西安分行', bank_code: '105791000018',
      account_usage: 'RECEIVE', is_whitelisted: 1, whitelist_effective_time: '2026-01-02 00:00',
      status: 'ACTIVE', verify_status: 'VERIFIED', first_maker_id: 'u_bd_zhang', second_checker_id: 'u_fin_review' },
    { account_no_id: 'PA000007001', partner_no: 'P000007', account_name: '星辰消费金融有限公司',
      bank_account_no: '3100016000077701234', bank_name: '中国工商银行上海分行', bank_code: '102290000007',
      account_usage: 'PAY', is_whitelisted: 1, whitelist_effective_time: '2026-02-02 00:00',
      status: 'ACTIVE', verify_status: 'VERIFIED', first_maker_id: 'u_bd_li', second_checker_id: 'u_fin_review' },
    { account_no_id: 'PA000023001', partner_no: 'P000023', account_name: '安泰融资担保有限公司',
      bank_account_no: '4400082300066605678', bank_name: '招商银行深圳分行', bank_code: '308584000023',
      account_usage: 'RECEIVE', is_whitelisted: 1, whitelist_effective_time: '2026-01-05 00:00',
      status: 'ACTIVE', verify_status: 'VERIFIED', first_maker_id: 'u_bd_li', second_checker_id: 'u_fin_mgr' },
    { account_no_id: 'PA000031001', partner_no: 'P000031', account_name: '瑞通银行股份有限公司',
      bank_account_no: '1200093100055509876', bank_name: '瑞通银行天津分行', bank_code: '313110000031',
      account_usage: 'BOTH', is_whitelisted: 1, whitelist_effective_time: '2026-03-02 00:00',
      status: 'ACTIVE', verify_status: 'VERIFIED', first_maker_id: 'u_bd_wang', second_checker_id: 'u_fin_review' },
    // 待复核账户：演示 4.3.2 双人复核 + 冷静期
    { account_no_id: 'PA000012002', partner_no: 'P000012', account_name: '华信银行股份有限公司',
      bank_account_no: '6222020200088899999', bank_name: '华信银行北京分行', bank_code: '313100000013',
      account_usage: 'RECEIVE', is_whitelisted: 0, whitelist_effective_time: '',
      status: 'PENDING_REVIEW', verify_status: 'UNVERIFIED', first_maker_id: 'u_bd_zhang', second_checker_id: '' }
  ];

  /* ============================ 主数据：开票信息 ============================ */
  var INVOICE_INFOS = [
    { partner_no: 'P000012', invoice_title: '华信银行股份有限公司', taxpayer_no: '91110000MA01HX1201',
      reg_address: '北京市西城区金融大街 18 号', reg_phone: '010-88881201',
      bank_name: '华信银行总行营业部', bank_account: '6222020200088812345',
      default_tax_rate: 0.06, invoice_type: 'SPECIAL', receiver_info: '张明 / 138****1201 / finance@huaxin.example' },
    { partner_no: 'P000018', invoice_title: '长安国际信托有限公司', taxpayer_no: '91610000MA01CA1802',
      reg_address: '西安市高新区科技路 88 号', reg_phone: '029-88881802',
      bank_name: '中国建设银行西安分行', bank_account: '6100031200099918888',
      default_tax_rate: 0.06, invoice_type: 'SPECIAL', receiver_info: '李娟 / 139****1802 / tax@changan.example' },
    { partner_no: 'P000007', invoice_title: '星辰消费金融有限公司', taxpayer_no: '91310000MA01XC0703',
      reg_address: '上海市浦东新区世纪大道 200 号', reg_phone: '021-88880703',
      bank_name: '中国工商银行上海分行', bank_account: '3100016000077701234',
      default_tax_rate: 0.06, invoice_type: 'SPECIAL', receiver_info: '王强 / 137****0703 / ap@xingchen.example' },
    { partner_no: 'P000023', invoice_title: '安泰融资担保有限公司', taxpayer_no: '91440000MA01AT2304',
      reg_address: '深圳市福田区深南大道 5000 号', reg_phone: '0755-88882304',
      bank_name: '招商银行深圳分行', bank_account: '4400082300066605678',
      default_tax_rate: 0.06, invoice_type: 'SPECIAL', receiver_info: '陈晨 / 135****2304 / fin@antai.example' },
    { partner_no: 'P000031', invoice_title: '瑞通银行股份有限公司', taxpayer_no: '91120000MA01RT3105',
      reg_address: '天津市和平区南京路 100 号', reg_phone: '022-88883105',
      bank_name: '瑞通银行天津分行', bank_account: '1200093100055509876',
      default_tax_rate: 0.06, invoice_type: 'SPECIAL', receiver_info: '赵磊 / 136****3105 / bill@ruitong.example' }
  ];

  /* ==================== 平台开票主体（我方，7.8.2 销方/购方之一）==================== */
  var PLATFORM_INVOICE = {
    invoice_title: '海融数字科技（北京）有限公司', taxpayer_no: '91110108MA01HR0001',
    reg_address: '北京市海淀区中关村南大街 6 号 A 座 12 层', reg_phone: '010-58880001',
    bank_name: '中国工商银行北京中关村支行', bank_account: '0200004509088801234',
    default_tax_rate: 0.06, invoice_type: 'SPECIAL'
  };

  /* ==================== 税收分类编码（7.8.2 货物或服务名称）====================
   * 示例编码，实际须以税务系统《商品和服务税收分类编码表》为准，并在接入时与财务确认。 */
  var TAX_CATEGORY = {
    TECH_SERVICE_FEE:     { code: '3040203', name: '信息技术服务*技术服务费' },
    GUARANTEE_FEE:        { code: '3060302', name: '金融服务*担保服务费' },
    FUNDING_COST:         { code: '3060101', name: '金融服务*贷款服务' },
    OVERDUE_MGMT_FEE:     { code: '3040203', name: '信息技术服务*逾期管理服务费' },
    PROFIT_SHARING:       { code: '3060302', name: '金融服务*直接收费金融服务' },
    CHANNEL_FEE:          { code: '3040205', name: '信息技术服务*信息技术服务费' },
    EARLY_SETTLE_PENALTY: { code: '3060302', name: '金融服务*直接收费金融服务' },
    BUYBACK_FEE:          { code: '3060302', name: '金融服务*直接收费金融服务' }
  };

  /* ==================== 法定节假日（7.2.1 holiday_adjust）====================
   * 出账日 / 确认截止 / 结算日落在周末或法定假期时按 NEXT_WORKDAY 顺延。
   * 2026-05-01~05-05 为劳动节假期 —— PRD 7.2.2 的示例正是「5/1 出账顺延至 5/6」。 */
  var HOLIDAYS = {
    '2026-01-01': '元旦',
    '2026-02-16': '春节', '2026-02-17': '春节', '2026-02-18': '春节',
    '2026-02-19': '春节', '2026-02-20': '春节',
    '2026-05-01': '劳动节', '2026-05-02': '劳动节', '2026-05-03': '劳动节',
    '2026-05-04': '劳动节', '2026-05-05': '劳动节',
    '2026-06-19': '端午节',
    '2026-09-25': '中秋节',
    '2026-10-01': '国庆节', '2026-10-02': '国庆节', '2026-10-03': '国庆节',
    '2026-10-04': '国庆节', '2026-10-05': '国庆节', '2026-10-06': '国庆节', '2026-10-07': '国庆节'
  };

  /* ==================== 告警关闭方式（9.6.2）==================== */
  var ALERT_ACTIONS = [
    { code: 'FIXED', name: '已修复', cls: 'ok', desc: '问题已定位并修复，指标已回落' },
    { code: 'FALSE_POSITIVE', name: '误报', cls: 'warn', desc: '规则口径或阈值不适用于该场景，需同步调整阈值' },
    { code: 'ACCEPTED', name: '已知风险 · 接受', cls: 'purple', desc: '已评估影响并接受，附评估结论与责任人' },
    { code: 'IGNORE', name: '暂不处理', cls: '', desc: '仅限 P2 / P3；<b>P0 不允许</b>' }
  ];

  /* ==================== 超期未确认策略（7.4.2）==================== */
  var CONFIRM_POLICIES = [
    { code: 'AUTO_CONFIRM', name: '超期默认确认', cls: 'warn',
      desc: '超过确认截止日自动视为确认，记录「超期默认确认」标记',
      caution: '<b>必须在协议中有明确条款支持</b>，否则不得使用' },
    { code: 'HOLD', name: '挂起并升级', cls: 'danger',
      desc: '保持待确认状态，触发升级提醒，<b>不进入结算</b>',
      caution: '协议未约定默认确认时的<b>缺省策略</b>' }
  ];

  /* ============================ 主数据：协议 ============================ */
  var AGREEMENTS = [
    { agreement_no: 'AG202601000012', partner_no: 'P000012', agreement_name: '华信银行助贷合作协议',
      agreement_type: 'LOAN_FACILITATION', paper_contract_no: 'HT-2026-HX-001', contract_file_url: '#/archive/HT-2026-HX-001',
      coop_start_date: '2026-01-01', coop_end_date: '2027-12-31', credit_limit: 2000000000,
      product_scope: ['*'], channel_scope: ['*'], funding_ratio: null,
      settle_account_no_id: 'PA000012001', status: 'EFFECTIVE',
      confirm_policy: 'AUTO_CONFIRM', confirm_policy_clause: '主协议第 6.3 条：账单送达后 5 个工作日内未提出异议视为确认' },
    { agreement_no: 'AG202601000018', partner_no: 'P000018', agreement_name: '长安信托资金合作协议',
      agreement_type: 'JOINT_LOAN', paper_contract_no: 'HT-2026-CA-007', contract_file_url: '#/archive/HT-2026-CA-007',
      coop_start_date: '2026-01-01', coop_end_date: '2027-06-30', credit_limit: 1500000000,
      product_scope: ['P001', 'P002'], channel_scope: ['*'], funding_ratio: 0.8,
      settle_account_no_id: 'PA000018001', status: 'EFFECTIVE',
      confirm_policy: 'HOLD', confirm_policy_clause: '协议未约定默认确认条款，按缺省策略挂起并升级' },
    { agreement_no: 'AG202602000007', partner_no: 'P000007', agreement_name: '星辰消金助贷合作协议',
      agreement_type: 'LOAN_FACILITATION', paper_contract_no: 'HT-2026-XC-013', contract_file_url: '#/archive/HT-2026-XC-013',
      coop_start_date: '2026-02-01', coop_end_date: '2028-01-31', credit_limit: 5000000000,
      product_scope: ['*'], channel_scope: ['*'], funding_ratio: null,
      settle_account_no_id: 'PA000007001', status: 'EFFECTIVE',
      confirm_policy: 'AUTO_CONFIRM', confirm_policy_clause: '主协议第 8.2 条：对账单送达后 5 个工作日内未回执视为无异议' },
    { agreement_no: 'AG202601000023', partner_no: 'P000023', agreement_name: '安泰担保融担合作协议',
      agreement_type: 'GUARANTEE', paper_contract_no: 'HT-2026-AT-004', contract_file_url: '#/archive/HT-2026-AT-004',
      coop_start_date: '2026-01-01', coop_end_date: '2027-12-31', credit_limit: null,
      product_scope: ['*'], channel_scope: ['*'], funding_ratio: null,
      settle_account_no_id: 'PA000023001', status: 'EFFECTIVE',
      confirm_policy: 'HOLD', confirm_policy_clause: '担保协议未约定默认确认条款，按缺省策略挂起并升级' },
    { agreement_no: 'AG202603000031', partner_no: 'P000031', agreement_name: '瑞通银行分润合作协议',
      agreement_type: 'PROFIT_SHARING', paper_contract_no: 'HT-2026-RT-002', contract_file_url: '#/archive/HT-2026-RT-002',
      coop_start_date: '2026-03-01', coop_end_date: '2027-02-28', credit_limit: 800000000,
      product_scope: ['*'], channel_scope: ['*'], funding_ratio: null,
      settle_account_no_id: 'PA000031001', status: 'EFFECTIVE',
      confirm_policy: 'AUTO_CONFIRM', confirm_policy_clause: '分润协议第 5.4 条：结算单送达后 5 个工作日内未提出异议视为确认' }
  ];

  /* ============================ 规则中心：协议版本 + 计费项 + 规则 ============================
   * 说明：为体现「配置态 / 运行态分离」，version.rule_snapshot 即冻结的运行态全文。
   * 计费引擎只读 status = EFFECTIVE / EXPIRED 的版本。
   * ======================================================================== */
  function item(o) {
    return Object.assign({
      charge_item_no: 'CI001', charge_item_code: 'TECH_SERVICE_FEE', charge_item_name: '技术服务费',
      direction: 'RECEIVABLE', tax_rate: 0.06, tax_included: 1,
      settle_cycle: 'MONTHLY', join_netting: 0, accounting_code: '6001', status: 'ENABLED',
      settle_day_rule: { cycle: 'MONTHLY', period_start_day: 1, period_end_day: 'LAST_DAY',
        cutoff_offset_days: 0, bill_gen_offset_days: 1, confirm_deadline_days: 5,
        settle_offset_days: 3, holiday_adjust: 'NEXT_WORKDAY' },
      rule: null
    }, o);
  }
  function rule(o) {
    return Object.assign({
      rule_no: '', trigger: { event_code: 'EV_DISBURSE_SUCCESS', event_filter: {} },
      charge_object: { level: 'LOAN', id_field: 'loan_no' },
      basis: { type: 'EVENT_AMOUNT', source_field: 'disburse_amount', funding_ratio_apply: true },
      rate_model: { type: 'FIXED_RATIO', ratio: 0.015 },
      output: { fee_flow_granularity: 'PER_EVENT', rounding_mode: 'HALF_UP', rounding_scale: 2 },
      reversal_policy: 'PROPORTIONAL'
    }, o);
  }

  var VERSIONS = [
    /* ---- P000012 华信银行：跨版本切换（3/15 费率下调），应收 + 应付并存开启轧差 ---- */
    { agreement_version_id: 10001, agreement_no: 'AG202601000012', version_no: 'V01',
      effective_date: '2026-01-01', expiry_date: '2026-03-15', status: 'EFFECTIVE',
      change_reason: '首次签署', is_retroactive: 0, approval_no: 'APR20251215001', publish_time: '2025-12-20 10:00',
      items: [
        item({ charge_item_no: 'CI001', charge_item_code: 'TECH_SERVICE_FEE', charge_item_name: '技术服务费',
          direction: 'RECEIVABLE', join_netting: 1,
          rule: rule({ rule_no: 'R000000001001', rate_model: { type: 'FIXED_RATIO', ratio: 0.015 } }) }),
        item({ charge_item_no: 'CI002', charge_item_code: 'FUNDING_COST', charge_item_name: '资金成本',
          direction: 'PAYABLE', join_netting: 1, accounting_code: '6602',
          rule: rule({ rule_no: 'R000000001002',
            trigger: { event_code: 'EV_DAILY_BALANCE', event_filter: {} },
            basis: { type: 'OUTSTANDING_BALANCE', source_field: 'principal_balance', funding_ratio_apply: true },
            rate_model: { type: 'DAILY_RATE', annual_ratio: 0.0648, day_count_basis: 360 },
            output: { fee_flow_granularity: 'PER_DAY', rounding_mode: 'HALF_UP', rounding_scale: 2 },
            reversal_policy: 'NONE' }) })
      ] },
    { agreement_version_id: 10002, agreement_no: 'AG202601000012', version_no: 'V02',
      effective_date: '2026-03-15', expiry_date: '9999-12-31', status: 'EFFECTIVE',
      change_reason: '商务谈判：技术服务费率 1.5% → 1.3%，资金成本年化 6.48% → 5.94%',
      is_retroactive: 0, approval_no: 'APR20260310004', publish_time: '2026-03-10 16:20',
      items: [
        item({ charge_item_no: 'CI001', charge_item_code: 'TECH_SERVICE_FEE', charge_item_name: '技术服务费',
          direction: 'RECEIVABLE', join_netting: 1,
          rule: rule({ rule_no: 'R000000001003', rate_model: { type: 'FIXED_RATIO', ratio: 0.013 } }) }),
        item({ charge_item_no: 'CI002', charge_item_code: 'FUNDING_COST', charge_item_name: '资金成本',
          direction: 'PAYABLE', join_netting: 1, accounting_code: '6602',
          rule: rule({ rule_no: 'R000000001004',
            trigger: { event_code: 'EV_DAILY_BALANCE', event_filter: {} },
            basis: { type: 'OUTSTANDING_BALANCE', source_field: 'principal_balance', funding_ratio_apply: true },
            rate_model: { type: 'DAILY_RATE', annual_ratio: 0.0594, day_count_basis: 360 },
            output: { fee_flow_granularity: 'PER_DAY', rounding_mode: 'HALF_UP', rounding_scale: 2 },
            reversal_policy: 'NONE' }) })
      ] },

    /* ---- P000018 长安信托：日费率资金成本（PRD 样例 B / C-02） ---- */
    { agreement_version_id: 10011, agreement_no: 'AG202601000018', version_no: 'V01',
      effective_date: '2026-01-01', expiry_date: '9999-12-31', status: 'EFFECTIVE',
      change_reason: '首次签署', is_retroactive: 0, approval_no: 'APR20251222002', publish_time: '2025-12-25 09:30',
      items: [
        item({ charge_item_no: 'CI001', charge_item_code: 'FUNDING_COST', charge_item_name: '资金成本',
          direction: 'PAYABLE', join_netting: 0, accounting_code: '6602',
          rule: rule({ rule_no: 'R000000001011',
            trigger: { event_code: 'EV_DAILY_BALANCE', event_filter: { product_codes: ['P001', 'P002'] } },
            basis: { type: 'OUTSTANDING_BALANCE', source_field: 'principal_balance', funding_ratio_apply: true },
            rate_model: { type: 'DAILY_RATE', annual_ratio: 0.06, day_count_basis: 360 },
            output: { fee_flow_granularity: 'PER_DAY', rounding_mode: 'HALF_UP', rounding_scale: 2 },
            reversal_policy: 'NONE' }) })
      ] },

    /* ---- P000007 星辰消金：阶梯累进 + 月末找平（PRD 样例 C / C-03 / C-05） ---- */
    { agreement_version_id: 10021, agreement_no: 'AG202602000007', version_no: 'V01',
      effective_date: '2026-02-01', expiry_date: '9999-12-31', status: 'EFFECTIVE',
      change_reason: '首次签署', is_retroactive: 0, approval_no: 'APR20260125003', publish_time: '2026-01-28 14:10',
      items: [
        item({ charge_item_no: 'CI001', charge_item_code: 'TECH_SERVICE_FEE', charge_item_name: '技术服务费（阶梯）',
          direction: 'RECEIVABLE', join_netting: 0,
          rule: rule({ rule_no: 'R000000001021',
            rate_model: {
              type: 'TIER_PROGRESSIVE', tier_basis: 'MONTHLY_ACCUM_DISBURSE', tier_period: 'NATURAL_MONTH',
              tier_trueup_enabled: true, tier_accum_reverse_deduct: true,
              tiers: [
                { seq: 1, lower: 0, upper: 100000000, ratio: 0.015 },
                { seq: 2, lower: 100000000, upper: 300000000, ratio: 0.013 },
                { seq: 3, lower: 300000000, upper: null, ratio: 0.011 }
              ]
            } }) })
      ] },

    /* ---- P000023 安泰担保：余额型担保费 + 排除逾期 90+（PRD 样例 D） ---- */
    { agreement_version_id: 10031, agreement_no: 'AG202601000023', version_no: 'V01',
      effective_date: '2026-01-01', expiry_date: '9999-12-31', status: 'EFFECTIVE',
      change_reason: '首次签署', is_retroactive: 0, approval_no: 'APR20251228004', publish_time: '2025-12-30 11:00',
      items: [
        item({ charge_item_no: 'CI001', charge_item_code: 'GUARANTEE_FEE', charge_item_name: '担保服务费',
          direction: 'PAYABLE', join_netting: 0, accounting_code: '6603',
          rule: rule({ rule_no: 'R000000001031',
            trigger: { event_code: 'EV_DAILY_BALANCE',
              event_filter: { overdue_days_range: { min: 0, max: 89 }, asset_tags_exclude: ['WRITE_OFF', 'BUYBACK'] } },
            basis: { type: 'OUTSTANDING_BALANCE', source_field: 'principal_balance', funding_ratio_apply: false },
            rate_model: { type: 'DAILY_RATE', annual_ratio: 0.02, day_count_basis: 360 },
            output: { fee_flow_granularity: 'PER_DAY', rounding_mode: 'HALF_UP', rounding_scale: 2 },
            reversal_policy: 'NONE' }) })
      ] },

    /* ---- P000031 瑞通银行：回款分润 + 月度保底 50 万（PRD 样例 E / C-07） ---- */
    { agreement_version_id: 10041, agreement_no: 'AG202603000031', version_no: 'V01',
      effective_date: '2026-03-01', expiry_date: '9999-12-31', status: 'EFFECTIVE',
      change_reason: '首次签署', is_retroactive: 0, approval_no: 'APR20260226005', publish_time: '2026-02-27 15:45',
      items: [
        item({ charge_item_no: 'CI001', charge_item_code: 'PROFIT_SHARING', charge_item_name: '回款分润',
          direction: 'RECEIVABLE', join_netting: 0, accounting_code: '6001',
          rule: rule({ rule_no: 'R000000001041',
            trigger: { event_code: 'EV_REPAY_SUCCESS', event_filter: { repay_source: ['SELF', 'COMPENSATE'] } },
            basis: { type: 'EVENT_AMOUNT', source_field: ['repay_principal', 'repay_interest'],
              aggregate: 'SUM', funding_ratio_apply: false },
            rate_model: { type: 'FIXED_RATIO', ratio: 0.20,
              floor_amount: 500000, floor_scope: 'CHARGE_ITEM', floor_period: 'NATURAL_MONTH' },
            output: { fee_flow_granularity: 'PER_EVENT', rounding_mode: 'HALF_UP', rounding_scale: 2 },
            reversal_policy: 'PROPORTIONAL' }) })
      ] },

    /* ---- 草稿版本：供「规则配置向导 → 试算 → 发布」演示 ---- */
    { agreement_version_id: 10003, agreement_no: 'AG202601000012', version_no: 'V03',
      effective_date: '2026-05-01', expiry_date: '9999-12-31', status: 'DRAFT',
      change_reason: '拟自 5 月起技术服务费下调至 1.15%，并新增逾期管理费',
      is_retroactive: 0, approval_no: '', publish_time: '',
      items: [
        item({ charge_item_no: 'CI001', charge_item_code: 'TECH_SERVICE_FEE', charge_item_name: '技术服务费',
          direction: 'RECEIVABLE', join_netting: 1,
          rule: rule({ rule_no: 'R000000001005', rate_model: { type: 'FIXED_RATIO', ratio: 0.0115 } }) }),
        item({ charge_item_no: 'CI002', charge_item_code: 'FUNDING_COST', charge_item_name: '资金成本',
          direction: 'PAYABLE', join_netting: 1, accounting_code: '6602',
          rule: rule({ rule_no: 'R000000001006',
            trigger: { event_code: 'EV_DAILY_BALANCE', event_filter: {} },
            basis: { type: 'OUTSTANDING_BALANCE', source_field: 'principal_balance', funding_ratio_apply: true },
            rate_model: { type: 'DAILY_RATE', annual_ratio: 0.0594, day_count_basis: 360 },
            output: { fee_flow_granularity: 'PER_DAY', rounding_mode: 'HALF_UP', rounding_scale: 2 },
            reversal_policy: 'NONE' }) }),
        item({ charge_item_no: 'CI003', charge_item_code: 'OVERDUE_MGMT_FEE', charge_item_name: '逾期管理费',
          direction: 'RECEIVABLE', join_netting: 1, accounting_code: '6001',
          rule: rule({ rule_no: 'R000000001007',
            trigger: { event_code: 'EV_DAILY_BALANCE', event_filter: { overdue_days_range: { min: 30, max: null } } },
            basis: { type: 'OUTSTANDING_BALANCE', source_field: 'principal_balance', funding_ratio_apply: true },
            rate_model: { type: 'DAILY_RATE', annual_ratio: 0.012, day_count_basis: 360 },
            output: { fee_flow_granularity: 'PER_DAY', rounding_mode: 'HALF_UP', rounding_scale: 2 },
            reversal_policy: 'NONE' }) })
      ] }
  ];

  /* ============================ 出账前置校验清单（PRD 7.3.5）============================ */
  var BILL_CHECKS = [
    { code: 'V-B01', desc: '账期已封账', level: 'BLOCK' },
    { code: 'V-B02', desc: 'L2→L3 勾稽通过：Σ 账期内未跨期流水 = 本期费用', level: 'BLOCK' },
    { code: 'V-B03', desc: '该账期无未处理事件', level: 'BLOCK' },
    { code: 'V-B04', desc: '该账期无缺失的日终快照', level: 'BLOCK' },
    { code: 'V-B05', desc: '所有调整项已审批', level: 'BLOCK' },
    { code: 'V-B06', desc: '上期账单已完成结算或已确认结转', level: 'BLOCK' },
    { code: 'V-B07', desc: '资金方开票信息完整', level: 'BLOCK' },
    { code: 'V-B08', desc: '金额环比波动 ≤ 50%', level: 'WARN' },
    { code: 'V-B09', desc: '账单金额非负', level: 'WARN' },
    { code: 'V-B10', desc: '资金方状态非 SUSPENDED', level: 'WARN' }
  ];

  /* ============================ 规则校验清单（PRD 5.3.4）============================ */
  var RULE_CHECKS = [
    { code: 'V-R01', desc: 'trigger.event_code 必须在事件字典中存在且启用', level: 'BLOCK' },
    { code: 'V-R02', desc: 'basis.type 与 trigger.event_code 必须兼容', level: 'BLOCK' },
    { code: 'V-R03', desc: 'rate_model.type 与 basis.type 必须兼容', level: 'BLOCK' },
    { code: 'V-R04', desc: '同一版本内不得两条规则命中相同「事件 + 计费对象 + 过滤条件」', level: 'BLOCK' },
    { code: 'V-R05', desc: '阶梯档位必须连续、不重叠、覆盖到无穷大', level: 'BLOCK' },
    { code: 'V-R06', desc: '费率取值在合理区间（比例 0–100%，日费率 0–1%）', level: 'WARN' },
    { code: 'V-R07', desc: 'floor_amount ≤ cap_amount', level: 'BLOCK' },
    { code: 'V-R08', desc: '生效区间必须落在协议合作期内', level: 'BLOCK' },
    { code: 'V-R09', desc: '发布前必须至少完成一次试算', level: 'BLOCK' }
  ];

  /* ============================ 资金安全控制矩阵（PRD 8.8.1）============================ */
  var FUND_CONTROLS = [
    { code: 'FC-01', name: '账户白名单', desc: '收款账户须 is_whitelisted=1 且 ACTIVE 且已过冷静期', type: 'HARD' },
    { code: 'FC-02', name: '单笔限额', desc: '超过 100 万自动拆分为多笔付款指令', type: 'AUTO' },
    { code: 'FC-03', name: '日累计限额', desc: '单资金方日累计付款超 500 万需额外审批', type: 'HARD' },
    { code: 'FC-04', name: '分级审批', desc: '按金额分级：<10 万 / 10–100 万 / >100 万', type: 'HARD' },
    { code: 'FC-05', name: '双人复核', desc: '付款发起人 ≠ 审批人', type: 'HARD' },
    { code: 'FC-06', name: '金额突变检测', desc: '本次 / 近 3 期均值 > 200% 或 < 30%', type: 'WARN' },
    { code: 'FC-07', name: '新账户首付', desc: '白名单生效后首次付款强制升级一级审批', type: 'HARD' },
    { code: 'FC-08', name: '重复付款检测', desc: '同一账单 24 小时内已有成功结算流水', type: 'HARD' },
    { code: 'FC-09', name: '账单状态校验', desc: '仅 CONFIRMED / ADJUSTED 账单可结算', type: 'HARD' },
    { code: 'FC-10', name: 'L3→L4 勾稽', desc: '勾稽不通过不得发起结算', type: 'HARD' }
  ];

  global.Data = {
    DECISIONS: DECISIONS, EVENT_DICT: EVENT_DICT, CHARGE_ITEM_DICT: CHARGE_ITEM_DICT,
    BASIS_TYPES: BASIS_TYPES, RATE_MODELS: RATE_MODELS, RULE_TEMPLATES: RULE_TEMPLATES,
    ROLES: ROLES, ROLE_USERS: ROLE_USERS, PERMS: PERMS, PRODUCTS: PRODUCTS, CHANNELS: CHANNELS,
    PARTNERS: PARTNERS, ACCOUNTS: ACCOUNTS, INVOICE_INFOS: INVOICE_INFOS,
    PLATFORM_INVOICE: PLATFORM_INVOICE, TAX_CATEGORY: TAX_CATEGORY,
    HOLIDAYS: HOLIDAYS, CONFIRM_POLICIES: CONFIRM_POLICIES, ALERT_ACTIONS: ALERT_ACTIONS,
    AGREEMENTS: AGREEMENTS, VERSIONS: VERSIONS,
    BILL_CHECKS: BILL_CHECKS, RULE_CHECKS: RULE_CHECKS, FUND_CONTROLS: FUND_CONTROLS,
    /** 模拟运行的两个账期 */
    PERIODS: ['2026-03', '2026-04'],
    SIM_TODAY: '2026-05-06'
  };
})(window);
