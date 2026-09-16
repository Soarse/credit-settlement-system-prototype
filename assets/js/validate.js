/* =============================================================================
 * validate.js —— 主数据校验规则清单（PRD 4.9 V-P01 ~ V-P08）
 * 每条校验返回 { code, ok, level: BLOCK|WARN, desc, msg }
 * ========================================================================== */
(function (global) {
  'use strict';
  var D = Core.D;

  var DEFS = {
    'V-P01': { desc: '统一社会信用代码全系统唯一', level: 'BLOCK', when: '保存' },
    'V-P02': { desc: '账户户名与合作方名称一致（不一致需填写例外说明并升级审批）', level: 'WARN', when: '保存' },
    'V-P03': { desc: '录入人 ≠ 复核人', level: 'BLOCK', when: '复核' },
    'V-P04': { desc: '付款账户必须已通过小额打款验证', level: 'BLOCK', when: '白名单生效' },
    'V-P05': { desc: '协议合作期不得超出资金方合作期', level: 'BLOCK', when: '保存' },
    'V-P06': { desc: 'product_scope / channel_scope 中的编码必须存在', level: 'BLOCK', when: '保存' },
    'V-P07': { desc: '协议终止前必须无未结清账单', level: 'BLOCK', when: '终止' },
    'V-P08': { desc: '账户停用前必须无在途结算单引用', level: 'BLOCK', when: '停用' },
    'V-F01': { desc: '必填项完整', level: 'BLOCK', when: '保存' },
    'V-F02': { desc: '统一社会信用代码格式为 18 位大写字母 / 数字', level: 'BLOCK', when: '保存' },
    'V-F03': { desc: '银行账号为 8–32 位数字', level: 'BLOCK', when: '保存' },
    'V-F04': { desc: '合作起止日先后顺序正确', level: 'BLOCK', when: '保存' }
  };
  function mk(code, ok, msg) {
    var d = DEFS[code] || { desc: code, level: 'BLOCK' };
    return { code: code, ok: !!ok, level: d.level, desc: d.desc, msg: msg || '' };
  }

  /* ---------------- 资金方档案 ---------------- */
  function partner(S, p, isNew) {
    var r = [];
    var required = [['partner_name', '机构全称'], ['partner_short_name', '简称'],
      ['unified_social_credit_code', '统一社会信用代码'], ['partner_type', '机构类型'],
      ['coop_start_date', '合作起始日'], ['owner_user_id', '归属 BD']];
    var miss = required.filter(function (f) { return !p[f[0]]; }).map(function (f) { return f[1]; });
    r.push(mk('V-F01', miss.length === 0 && (p.partner_roles || []).length > 0,
      miss.length ? '缺少：' + miss.join('、') : ((p.partner_roles || []).length ? '必填项完整' : '缺少：角色标签')));
    r.push(mk('V-F02', /^[0-9A-Z]{18}$/.test(p.unified_social_credit_code || ''),
      p.unified_social_credit_code ? '当前值 ' + p.unified_social_credit_code + '（' + (p.unified_social_credit_code || '').length + ' 位）' : '未填写'));
    var dup = S.partners.filter(function (x) {
      return x.unified_social_credit_code === p.unified_social_credit_code && x.partner_no !== p.partner_no;
    });
    r.push(mk('V-P01', dup.length === 0,
      dup.length ? '与 ' + dup[0].partner_no + ' ' + dup[0].partner_short_name + ' 重复 —— 名称可能因简称/全称/曾用名不一致，代码唯一约束是防重复建档的唯一可靠手段'
        : '未与已有 ' + S.partners.length + ' 家机构重复'));
    return r;
  }

  /* ---------------- 银行账户 ---------------- */
  function account(S, a, ctx) {
    ctx = ctx || {};
    var r = [];
    var p = S.partnerMap[a.partner_no];
    var miss = [['account_name', '户名'], ['bank_account_no', '账号'], ['bank_name', '开户行'],
      ['bank_code', '联行号'], ['account_usage', '账户用途']].filter(function (f) { return !a[f[0]]; })
      .map(function (f) { return f[1]; });
    r.push(mk('V-F01', miss.length === 0, miss.length ? '缺少：' + miss.join('、') : '必填项完整'));
    r.push(mk('V-F03', /^\d{8,32}$/.test(String(a.bank_account_no || '')),
      a.bank_account_no ? '当前 ' + String(a.bank_account_no).length + ' 位' : '未填写'));
    var same = p && a.account_name === p.partner_name;
    r.push(mk('V-P02', same || !!a.name_exception_note,
      same ? '与合作方全称一致' : (a.name_exception_note ? '已填写例外说明，审批层级 +1 级' : '户名与合作方全称不一致，需填写例外说明')));
    if (ctx.reviewing) {
      r.push(mk('V-P03', a.first_maker_id !== ctx.checker,
        a.first_maker_id === ctx.checker ? '录入人与复核人同为 ' + ctx.checker : '录入人 ' + a.first_maker_id + ' ≠ 复核人 ' + ctx.checker));
    }
    if (a.account_usage === 'PAY' || a.account_usage === 'BOTH') {
      r.push(mk('V-P04', a.verify_status === 'VERIFIED' || !ctx.whitelisting,
        a.verify_status === 'VERIFIED' ? '已通过小额打款验证' : '尚未打款验证，白名单不可生效'));
    }
    return r;
  }

  function accountDisable(S, a) {
    var inflight = S.settleOrders.filter(function (o) {
      return (o.payee_account === a.account_no_id || o.payer_account === a.account_no_id) &&
        ['PENDING', 'APPROVING', 'PROCESSING', 'UNKNOWN'].indexOf(o.status) >= 0;
    });
    var pendBills = S.bills.filter(function (b) {
      return b.partner_no === a.partner_no && b.status === 'CONFIRMED' && !b.settle_no;
    });
    return [
      mk('V-P08', inflight.length === 0,
        inflight.length ? '存在 ' + inflight.length + ' 张在途结算单：' + inflight.map(function (o) { return o.settle_no; }).join(', ')
          : '无在途结算单引用'),
      mk('V-P08', pendBills.length === 0,
        pendBills.length ? '存在 ' + pendBills.length + ' 张已确认待结算账单可能引用该账户' : '无已确认待结算账单')
    ];
  }

  /* ---------------- 协议主档 ---------------- */
  function agreement(S, ag) {
    var r = [];
    var p = S.partnerMap[ag.partner_no];
    var miss = [['agreement_name', '协议名称'], ['agreement_type', '协议类型'],
      ['paper_contract_no', '纸质合同号'], ['contract_file_url', '合同归档链接'],
      ['coop_start_date', '合作起始日'], ['coop_end_date', '合作结束日'],
      ['settle_account_no_id', '默认结算账户']].filter(function (f) { return !ag[f[0]]; })
      .map(function (f) { return f[1]; });
    r.push(mk('V-F01', miss.length === 0, miss.length ? '缺少：' + miss.join('、') : '必填项完整'));
    r.push(mk('V-F04', ag.coop_start_date && ag.coop_end_date && ag.coop_start_date < ag.coop_end_date,
      ag.coop_start_date + ' ~ ' + ag.coop_end_date));
    var inPartner = p && ag.coop_start_date >= p.coop_start_date;
    r.push(mk('V-P05', !!inPartner,
      p ? '资金方合作起始日 ' + p.coop_start_date + '，协议起始日 ' + ag.coop_start_date + (inPartner ? '（符合）' : '（早于资金方合作起始日）') : '资金方不存在'));
    var pc = ag.product_scope || [], cc = ag.channel_scope || [];
    var badP = pc.filter(function (c) { return c !== '*' && !Data.PRODUCTS.some(function (x) { return x.code === c; }); });
    var badC = cc.filter(function (c) { return c !== '*' && !Data.CHANNELS.some(function (x) { return x.code === c; }); });
    r.push(mk('V-P06', badP.length === 0 && badC.length === 0,
      (badP.length || badC.length) ? '不存在的编码：' + badP.concat(badC).join(', ') : '产品 ' + pc.join('/') + '；渠道 ' + cc.join('/')));
    return r;
  }

  function agreementTerminate(S, ag) {
    var open = S.bills.filter(function (b) {
      return b.agreement_no === ag.agreement_no && ['SETTLED', 'VOIDED'].indexOf(b.status) < 0;
    });
    return [mk('V-P07', open.length === 0,
      open.length ? '存在 ' + open.length + ' 张未结清账单：' + open.map(function (b) { return b.bill_no; }).join(', ') : '无未结清账单')];
  }

  function pass(list) { return list.every(function (c) { return c.ok || c.level === 'WARN'; }); }
  function hasWarn(list) { return list.some(function (c) { return !c.ok && c.level === 'WARN'; }); }

  global.Validate = {
    DEFS: DEFS, partner: partner, account: account, accountDisable: accountDisable,
    agreement: agreement, agreementTerminate: agreementTerminate, pass: pass, hasWarn: hasWarn
  };
})(window);
