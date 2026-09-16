/* =============================================================================
 * views-form.js —— 模块① 写入侧：资金方档案 / 银行账户 / 开票信息 / 协议主档
 * 表单 + V-P01~V-P08 实时校验 + 状态流转 + 变更留痕
 * ========================================================================== */
(function (global) {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  var BD_USERS = [
    { value: 'u_bd_zhang', label: 'u_bd_zhang（张明 · 资金合作）' },
    { value: 'u_bd_li', label: 'u_bd_li（李娟 · 资金合作）' },
    { value: 'u_bd_wang', label: 'u_bd_wang（王强 · 资金合作）' }
  ];
  var PARTNER_TYPES = [
    { value: 'BANK', label: '银行' }, { value: 'TRUST', label: '信托' },
    { value: 'CONSUMER_FINANCE', label: '消费金融' }, { value: 'ABS', label: 'ABS 计划' },
    { value: 'GUARANTEE', label: '融资担保' }, { value: 'CHANNEL', label: '通道' }, { value: 'OTHER', label: '其他' }
  ];
  var ROLE_TAGS = [['FUNDER', '资金方'], ['GUARANTOR', '担保方'], ['CHANNEL', '通道方']];

  function checkPanel(list, title) {
    return U.card(title || '实时校验', U.checklist(list), { tight: true, ref: '4.9' });
  }
  function multiCheck(options, values, onChange) {
    var box = h('div', { class: 'btn-row' });
    options.forEach(function (o) {
      box.appendChild(h('label', { class: 'checkline' }, [
        h('input', {
          type: 'checkbox', checked: values.indexOf(o[0]) >= 0,
          onchange: function (e) {
            var i = values.indexOf(o[0]);
            if (e.target.checked && i < 0) values.push(o[0]);
            if (!e.target.checked && i >= 0) values.splice(i, 1);
            onChange();
          }
        }), o[1]
      ]));
    });
    return box;
  }

  /* =========================================================================
   * 资金方档案 · 新建 / 编辑
   * ======================================================================= */
  UI.route('partner-edit', {
    title: '资金方档案', crumbs: ['模块①', '资金方主数据', '档案维护'],
    render: function (root, params) {
      var S = Store.get();
      var isNew = !params.id;
      var src = isNew ? {
        partner_no: '', partner_name: '', partner_short_name: '', unified_social_credit_code: '',
        partner_type: 'BANK', partner_roles: ['FUNDER'], license_no: '', regulator: '国家金融监督管理总局',
        coop_start_date: S.simToday, status: 'PENDING', owner_user_id: 'u_bd_zhang',
        admission_approval_no: '', due_diligence_url: '', remark: ''
      } : Core.deep(S.partnerMap[params.id]);
      if (!src) { root.appendChild(U.alertBox('danger', '未找到资金方 ' + params.id)); return; }
      var p = src;
      var checkBox = h('div'), actionBox = h('div', { class: 'btn-row mt14' });

      function refresh() {
        var checks = Validate.partner(S, p, isNew);
        checkBox.innerHTML = '';
        checkBox.appendChild(checkPanel(checks));
        checkBox.appendChild(U.card('校验规则说明', U.table([
          { label: '编号', render: function (r) { return h('span', { class: 'mono' }, r.c); }, width: '60px' },
          { label: '校验', render: function (r) { return Validate.DEFS[r.c].desc; } },
          { label: '时机', render: function (r) { return Validate.DEFS[r.c].when; }, width: '90px' },
          { label: '级别', render: function (r) { return U.badge(Validate.DEFS[r.c].level === 'BLOCK' ? '阻断' : '警告', Validate.DEFS[r.c].level === 'BLOCK' ? 'danger' : 'warn'); }, width: '60px' }
        ], ['V-P01', 'V-F01', 'V-F02'].map(function (c) { return { c: c }; }), { compact: true }), { tight: true }));

        var blocked = checks.some(function (c) { return !c.ok && c.level === 'BLOCK'; });
        actionBox.innerHTML = '';
        actionBox.appendChild(h('button', {
          class: 'btn btn-primary', disabled: blocked || !Store.can('partner.edit'),
          onclick: function () {
            var saved = Store.Actions.savePartner(Core.deep(p), isNew);
            UI.toast('已保存，变更前后快照已写入 config_change_log', 'ok', saved.partner_no);
            U.goto('/partner-edit/' + saved.partner_no);
          }
        }, isNew ? '保存并建档' : '保存修改'));
        if (!isNew && p.status === 'PENDING') {
          actionBox.appendChild(h('button', {
            class: 'btn', disabled: !Store.can('partner.edit'),
            onclick: function () {
              var r = Store.Actions.submitAdmission(p.partner_no);
              UI.toast('准入审批单 ' + r.approval_no + ' 已提交', 'ok'); App.rerender();
            }
          }, '提交准入审批'));
          actionBox.appendChild(h('button', {
            class: 'btn btn-ok', disabled: !Store.can('partner.admit') || !S.partnerMap[p.partner_no] || !S.partnerMap[p.partner_no].admission_approval_no,
            onclick: function () {
              var r = Store.Actions.approveAdmission(p.partner_no);
              if (!r.ok) { UI.toast(r.msg || '无法审批', 'warn'); return; }
              UI.toast('准入通过：PENDING → ADMITTED，现在可以创建协议与维护账户', 'ok'); App.rerender();
            }
          }, '准入审批通过（风控 / 财务负责人）'));
        }
        if (!isNew && p.status === 'ACTIVE') {
          actionBox.appendChild(h('button', {
            class: 'btn', disabled: !Store.can('partner.edit'),
            onclick: function () { Store.Actions.setPartnerStatus(p.partner_no, 'SUSPENDED'); UI.toast('已暂停合作：不可新增计费，存量账单仍可结算', 'warn'); App.rerender(); }
          }, '暂停合作'));
        }
        if (!isNew && p.status === 'SUSPENDED') {
          actionBox.appendChild(h('button', {
            class: 'btn btn-ok', disabled: !Store.can('partner.edit'),
            onclick: function () { Store.Actions.setPartnerStatus(p.partner_no, 'ACTIVE'); UI.toast('已恢复合作', 'ok'); App.rerender(); }
          }, '恢复合作'));
        }
        if (!isNew) actionBox.appendChild(h('button', { class: 'btn btn-ghost', onclick: function () { U.goto('/partner/' + p.partner_no); } }, '查看档案详情'));
        actionBox.appendChild(h('button', { class: 'btn btn-ghost', onclick: function () { U.goto('/partners'); } }, '返回列表'));
      }

      root.appendChild(U.pageHead(isNew ? '新建资金方档案' : '编辑资金方档案 · ' + p.partner_no,
        '主体信息、角色标签、准入信息。<b>一个主体可兼任多角色</b>（如集团旗下融资担保公司既是担保方也可能是通道方），用角色标签多选表达，<b>不允许为同一主体建多条记录</b> —— 否则对账时同一交易对手被拆成两个主体，无法轧差。',
        isNew ? [] : [U.statusBadge(p.status)]));

      var form = h('div', null, [
        U.card('主体信息', h('div', null, [
          h('div', { class: 'grid g2' }, [
            U.field('机构全称 *', h('input', { type: 'text', value: p.partner_name, placeholder: '须与营业执照一致', oninput: function (e) { p.partner_name = e.target.value; refresh(); } })),
            U.field('简称 *', h('input', { type: 'text', value: p.partner_short_name, placeholder: '用于界面与文件命名', oninput: function (e) { p.partner_short_name = e.target.value; refresh(); } }))
          ]),
          U.field('统一社会信用代码 *', h('input', {
            type: 'text', value: p.unified_social_credit_code, maxlength: 18, placeholder: '18 位大写字母 / 数字',
            oninput: function (e) { p.unified_social_credit_code = e.target.value.toUpperCase(); refresh(); }
          }), 'V-P01 系统内唯一 —— 这是防重复建档的唯一可靠手段'),
          h('div', { class: 'grid g2' }, [
            U.field('机构类型 *', U.selectEl(PARTNER_TYPES, p.partner_type, function (v) { p.partner_type = v; refresh(); })),
            U.field('归属 BD *', U.selectEl(BD_USERS, p.owner_user_id, function (v) { p.owner_user_id = v; refresh(); }), '数据权限：BD 仅可见归属自己的资金方')
          ]),
          U.field('角色标签 *（可多选）', multiCheck(ROLE_TAGS, p.partner_roles, refresh)),
          h('div', { class: 'grid g2' }, [
            U.field('金融许可证号', h('input', { type: 'text', value: p.license_no, oninput: function (e) { p.license_no = e.target.value; } })),
            U.field('监管机构', h('input', { type: 'text', value: p.regulator, oninput: function (e) { p.regulator = e.target.value; } }))
          ]),
          h('div', { class: 'grid g2' }, [
            U.field('合作起始日 *', h('input', { type: 'date', value: p.coop_start_date, onchange: function (e) { p.coop_start_date = e.target.value; refresh(); } })),
            U.field('尽调材料归档链接', h('input', { type: 'text', value: p.due_diligence_url, placeholder: '#/archive/...', oninput: function (e) { p.due_diligence_url = e.target.value; } }))
          ]),
          U.field('备注', h('textarea', { rows: 2, oninput: function (e) { p.remark = e.target.value; } }, p.remark))
        ]), { ref: '4.2' }),
        actionBox
      ]);
      root.appendChild(h('div', { class: 'split-lr' }, [form, checkBox]));
      refresh();
    }
  });

  /* =========================================================================
   * 银行账户表单（模态）
   * ======================================================================= */
  function openAccountForm(partnerNo, existing) {
    var S = Store.get();
    var isNew = !existing;
    var a = isNew ? {
      account_no_id: '', partner_no: partnerNo,
      account_name: (S.partnerMap[partnerNo] || {}).partner_name || '',
      bank_account_no: '', bank_name: '', bank_code: '', account_usage: 'RECEIVE',
      name_exception_note: '', verify_status: 'UNVERIFIED'
    } : Core.deep(existing);
    var checkBox = h('div', { class: 'mt14' });
    var footer = h('div');

    function refresh() {
      var checks = Validate.account(S, a, {});
      checkBox.innerHTML = '';
      checkBox.appendChild(U.checklist(checks));
      var blocked = checks.some(function (c) { return !c.ok && c.level === 'BLOCK'; });
      var warn = Validate.hasWarn(checks);
      checkBox.appendChild(h('div', { class: 'mt8' }, U.alertBox(blocked ? 'danger' : (warn ? 'warn' : 'ok'),
        blocked ? '存在阻断级校验未通过，无法保存。'
          : (warn ? '存在警告项（户名不一致），保存后审批层级 <b>+1 级</b>。'
            : '校验通过。保存后账户状态为 <b>PENDING_REVIEW</b>，须由<b>另一人</b>复核；复核通过后进入白名单，并等待 <b>T+1 冷静期</b>才可用于付款。'))));
      footer.innerHTML = '';
      footer.appendChild(h('button', { class: 'btn', onclick: U.closeModal }, '取消'));
      footer.appendChild(h('button', {
        class: 'btn btn-primary', disabled: blocked || !Store.can('account.create'),
        onclick: function () {
          var saved = Store.Actions.saveAccount(a, isNew);
          U.closeModal();
          UI.toast('账户 ' + saved.account_no_id + ' 已保存，状态 PENDING_REVIEW，等待第二人复核', 'ok', '双人复核机制');
          App.rerender();
        }
      }, isNew ? '保存并提交复核' : '保存修改（需重新复核）'));
    }

    var body = h('div', null, [
      U.alertBox('warn', '<b>资损防控第一道闸门。</b>计费算错会产生错误账单，但账户配错会把钱直接付给错误的对象，且极难追回。'),
      h('div', { class: 'grid g2' }, [
        U.field('户名 *', h('input', { type: 'text', value: a.account_name, oninput: function (e) { a.account_name = e.target.value; refresh(); } }), 'V-P02 须与合作方全称一致'),
        U.field('账户用途 *', U.selectEl([
          { value: 'RECEIVE', label: 'RECEIVE 我方收款用' }, { value: 'PAY', label: 'PAY 我方付款用' }, { value: 'BOTH', label: 'BOTH 收付两用' }
        ], a.account_usage, function (v) { a.account_usage = v; refresh(); }))
      ]),
      U.field('银行账号 *', h('input', { type: 'text', value: a.bank_account_no, placeholder: '8–32 位数字', oninput: function (e) { a.bank_account_no = e.target.value.replace(/\D/g, ''); refresh(); } }), '加密存储（密文 + 掩码 + 哈希三字段），界面默认脱敏'),
      h('div', { class: 'grid g2' }, [
        U.field('开户行全称 *', h('input', { type: 'text', value: a.bank_name, oninput: function (e) { a.bank_name = e.target.value; refresh(); } })),
        U.field('联行号 / 大额行号 *', h('input', { type: 'text', value: a.bank_code, oninput: function (e) { a.bank_code = e.target.value; refresh(); } }))
      ]),
      U.field('户名不一致的例外说明', h('input', { type: 'text', value: a.name_exception_note, placeholder: '仅当户名与合作方全称不一致时填写', oninput: function (e) { a.name_exception_note = e.target.value; refresh(); } })),
      checkBox
    ]);
    U.modal(isNew ? '新增银行账户' : '编辑银行账户 ' + a.account_no_id, body, footer, { size: 'wide' });
    refresh();
  }

  /* =========================================================================
   * 开票信息表单（模态）
   * ======================================================================= */
  function openInvoiceForm(partnerNo) {
    var S = Store.get();
    var p = S.partnerMap[partnerNo];
    var info = Core.deep(S.invoiceMap[partnerNo] || {
      partner_no: partnerNo, invoice_title: p.partner_name, taxpayer_no: p.unified_social_credit_code,
      reg_address: '', reg_phone: '', bank_name: '', bank_account: '',
      default_tax_rate: 0.06, invoice_type: 'SPECIAL', receiver_info: ''
    });
    var body = h('div', null, [
      U.alertBox('info', '税率在<b>计费项级别可覆盖</b>（不同费种适用税率可能不同），此处仅为默认值。开票信息不完整将被出账前置校验 <b>V-B07</b> 阻断。'),
      h('div', { class: 'grid g2' }, [
        U.field('开票抬头 *', h('input', { type: 'text', value: info.invoice_title, oninput: function (e) { info.invoice_title = e.target.value; } })),
        U.field('纳税人识别号 *', h('input', { type: 'text', value: info.taxpayer_no, oninput: function (e) { info.taxpayer_no = e.target.value; } }))
      ]),
      h('div', { class: 'grid g2' }, [
        U.field('注册地址', h('input', { type: 'text', value: info.reg_address, oninput: function (e) { info.reg_address = e.target.value; } })),
        U.field('注册电话', h('input', { type: 'text', value: info.reg_phone, oninput: function (e) { info.reg_phone = e.target.value; } }))
      ]),
      h('div', { class: 'grid g2' }, [
        U.field('开票开户行', h('input', { type: 'text', value: info.bank_name, oninput: function (e) { info.bank_name = e.target.value; } }), '可能与结算账户不同'),
        U.field('开票账号', h('input', { type: 'text', value: info.bank_account, oninput: function (e) { info.bank_account = e.target.value; } }))
      ]),
      h('div', { class: 'grid g2' }, [
        U.field('默认税率', h('input', { type: 'number', step: '0.01', value: info.default_tax_rate, oninput: function (e) { info.default_tax_rate = +e.target.value; } })),
        U.field('票种', U.selectEl([{ value: 'SPECIAL', label: '增值税专用发票' }, { value: 'GENERAL', label: '增值税普通发票' }], info.invoice_type, function (v) { info.invoice_type = v; }))
      ]),
      U.field('收票人（姓名 / 电话 / 邮箱）', h('input', { type: 'text', value: info.receiver_info, oninput: function (e) { info.receiver_info = e.target.value; } }))
    ]);
    U.modal('维护开票与税务信息', body, [
      h('button', { class: 'btn', onclick: U.closeModal }, '取消'),
      h('button', {
        class: 'btn btn-primary', disabled: !Store.can('invoice.edit'),
        onclick: function () {
          if (!info.invoice_title || !info.taxpayer_no) { UI.toast('开票抬头与纳税人识别号必填', 'warn'); return; }
          Store.Actions.saveInvoiceInfo(info); U.closeModal();
          UI.toast('开票信息已保存', 'ok'); App.rerender();
        }
      }, '保存')
    ], { size: 'wide' });
  }

  /* =========================================================================
   * 协议主档 · 新建 / 编辑
   * ======================================================================= */
  UI.route('agreement-edit', {
    title: '协议主档', crumbs: ['模块①', '资金方主数据', '协议主档'],
    render: function (root, params) {
      var S = Store.get();
      var isNew = !params.id;
      var partnerNo = params.partner || (isNew ? S.partners[0].partner_no : (S.agreementMap[params.id] || {}).partner_no);
      var ag = isNew ? {
        agreement_no: '', partner_no: partnerNo, agreement_name: '',
        agreement_type: 'LOAN_FACILITATION', paper_contract_no: '', contract_file_url: '',
        coop_start_date: S.simToday, coop_end_date: D.addDays(S.simToday, 730),
        credit_limit: null, product_scope: ['*'], channel_scope: ['*'], funding_ratio: null,
        settle_account_no_id: '', status: 'DRAFT'
      } : Core.deep(S.agreementMap[params.id]);
      if (!ag) { root.appendChild(U.alertBox('danger', '未找到协议 ' + params.id)); return; }

      var checkBox = h('div'), actionBox = h('div', { class: 'btn-row mt14' });
      function accounts() {
        return Store.get().accounts.filter(function (x) { return x.partner_no === ag.partner_no; })
          .map(function (x) { return { value: x.account_no_id, label: x.account_no_id + ' · ' + x.bank_name + '（' + x.status + '）' }; });
      }
      function refresh() {
        var checks = Validate.agreement(Store.get(), ag);
        checkBox.innerHTML = '';
        checkBox.appendChild(checkPanel(checks, '实时校验 V-P05 / V-P06'));
        checkBox.appendChild(U.card('协议主档不承载的内容', h('div', null, [
          h('p', { class: 'muted mb8' }, '以下要素一律下沉到规则中心，协议主档中不得出现：'),
          h('div', { class: 'btn-row' }, ['费率、费率类型、阶梯档位', '计费基数类型', '结算周期、账期规则', '税率（计费项级）', '保底、封顶、减免条款']
            .map(function (t) { return U.badge('❌ ' + t, 'danger'); })),
          h('p', { class: 'mt8 muted mb0' }, [h('b', null, '判定标准：'), '如果这个字段改了之后，可能需要重算历史费用，它就属于规则中心。'])
        ]), { ref: '4.5.2' }));

        var blocked = checks.some(function (c) { return !c.ok && c.level === 'BLOCK'; });
        actionBox.innerHTML = '';
        actionBox.appendChild(h('button', {
          class: 'btn btn-primary', disabled: blocked || !Store.can('agreement.edit'),
          onclick: function () {
            var saved = Store.Actions.saveAgreement(Core.deep(ag), isNew);
            UI.toast('协议 ' + saved.agreement_no + ' 已保存（状态 DRAFT）', 'ok');
            U.goto('/agreement-edit/' + saved.agreement_no);
          }
        }, isNew ? '保存协议主档' : '保存修改'));
        if (!isNew) {
          var cur = S.agreementMap[ag.agreement_no];
          if (cur && cur.status === 'DRAFT') actionBox.appendChild(h('button', {
            class: 'btn', disabled: !Store.can('agreement.edit'),
            onclick: function () { Store.Actions.setAgreementStatus(ag.agreement_no, 'PENDING_APPROVAL'); UI.toast('已提交审批', 'ok'); App.rerender(); }
          }, '提交审批'));
          if (cur && cur.status === 'PENDING_APPROVAL') {
            actionBox.appendChild(h('button', {
              class: 'btn btn-ok', disabled: !Store.can('agreement.approve'),
              onclick: function () { Store.Actions.setAgreementStatus(ag.agreement_no, 'EFFECTIVE'); UI.toast('协议已生效，资金方状态同步为 ACTIVE，可开始配置规则版本', 'ok'); App.rerender(); }
            }, '审批通过并生效'));
            actionBox.appendChild(h('button', {
              class: 'btn', disabled: !Store.can('agreement.approve'),
              onclick: function () { Store.Actions.setAgreementStatus(ag.agreement_no, 'DRAFT'); UI.toast('已驳回至草稿', 'warn'); App.rerender(); }
            }, '驳回'));
          }
          if (cur && cur.status === 'EFFECTIVE') {
            actionBox.appendChild(h('button', { class: 'btn', onclick: function () { U.goto('/versions/' + ag.agreement_no); } }, '配置规则版本 →'));
            actionBox.appendChild(h('button', {
              class: 'btn btn-danger', disabled: !Store.can('agreement.edit'),
              onclick: function () {
                var r = Store.Actions.setAgreementStatus(ag.agreement_no, 'TERMINATED');
                if (!r.ok) U.modal('终止被阻断（V-P07）', U.checklist(r.checks), [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'narrow' });
                else { UI.toast('协议已终止，历史费用流水与账单完整保留', 'warn'); App.rerender(); }
              }
            }, '终止协议'));
          }
        }
        actionBox.appendChild(h('button', { class: 'btn btn-ghost', onclick: function () { U.goto('/partner/' + ag.partner_no + '?tab=agreement'); } }, '返回资金方档案'));
      }

      var curAg = isNew ? null : S.agreementMap[ag.agreement_no];
      root.appendChild(U.pageHead(isNew ? '新建协议主档' : '编辑协议主档 · ' + ag.agreement_no,
        '协议主档只承载<b>整个合作期不变</b>的要素；所有可能变更的条款一律下沉到协议版本（规则中心）。',
        curAg ? [U.statusBadge(curAg.status)] : []));

      var form = U.card('协议要素', h('div', null, [
        h('div', { class: 'grid g2' }, [
          U.field('所属资金方 *', U.selectEl(S.partners.filter(function (x) { return ['ADMITTED', 'ACTIVE', 'SUSPENDED'].indexOf(x.status) >= 0; })
            .map(function (x) { return { value: x.partner_no, label: x.partner_no + ' ' + x.partner_short_name }; }),
            ag.partner_no, function (v) { ag.partner_no = v; ag.settle_account_no_id = ''; App.rerender(); }),
            '仅已准入 / 合作中的资金方可创建协议'),
          U.field('协议名称 *', h('input', { type: 'text', value: ag.agreement_name, oninput: function (e) { ag.agreement_name = e.target.value; refresh(); } }))
        ]),
        h('div', { class: 'grid g2' }, [
          U.field('协议类型 *', U.selectEl([
            { value: 'LOAN_FACILITATION', label: '助贷' }, { value: 'JOINT_LOAN', label: '联合贷' },
            { value: 'GUARANTEE', label: '融担' }, { value: 'PROFIT_SHARING', label: '分润' }
          ], ag.agreement_type, function (v) { ag.agreement_type = v; refresh(); })),
          U.field('纸质合同编号 *', h('input', { type: 'text', value: ag.paper_contract_no, oninput: function (e) { ag.paper_contract_no = e.target.value; refresh(); } }))
        ]),
        U.field('合同扫描件归档链接 *', h('input', { type: 'text', value: ag.contract_file_url, placeholder: '#/archive/HT-2026-XX-001', oninput: function (e) { ag.contract_file_url = e.target.value; refresh(); } })),
        h('div', { class: 'grid g2' }, [
          U.field('合作起始日 *', h('input', { type: 'date', value: ag.coop_start_date, onchange: function (e) { ag.coop_start_date = e.target.value; refresh(); } })),
          U.field('合作结束日 *', h('input', { type: 'date', value: ag.coop_end_date, onchange: function (e) { ag.coop_end_date = e.target.value; refresh(); } }))
        ]),
        h('div', { class: 'grid g2' }, [
          U.field('授信额度', h('input', { type: 'number', value: ag.credit_limit || '', placeholder: '不限则留空', oninput: function (e) { ag.credit_limit = e.target.value === '' ? null : +e.target.value; } })),
          U.field('联合贷出资比例', h('input', { type: 'number', step: '0.01', value: ag.funding_ratio || '', placeholder: '助贷模式留空', oninput: function (e) { ag.funding_ratio = e.target.value === '' ? null : +e.target.value; } }), '比例取放款时点固化值，后续调整不影响历史')
        ]),
        h('div', { class: 'grid g2' }, [
          U.field('适用产品范围 *', h('input', { type: 'text', value: (ag.product_scope || []).join(','), placeholder: '* 表示全部；多个用逗号分隔', oninput: function (e) { ag.product_scope = e.target.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); refresh(); } }),
            '可选：' + Data.PRODUCTS.map(function (x) { return x.code + ' ' + x.name; }).join('、')),
          U.field('适用渠道范围 *', h('input', { type: 'text', value: (ag.channel_scope || []).join(','), oninput: function (e) { ag.channel_scope = e.target.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); refresh(); } }),
            '可选：' + Data.CHANNELS.map(function (x) { return x.code + ' ' + x.name; }).join('、'))
        ]),
        U.field('默认结算账户 *', accounts().length
          ? U.selectEl([{ value: '', label: '请选择' }].concat(accounts()), ag.settle_account_no_id, function (v) { ag.settle_account_no_id = v; refresh(); })
          : h('div', { class: 'alert warn mb0' }, '该资金方尚无银行账户，请先到档案页「银行账户」Tab 新增并复核'))
      ]), { ref: '4.5' });

      root.appendChild(h('div', { class: 'split-lr' }, [h('div', null, [form, actionBox]), checkBox]));
      refresh();
    }
  });

  global.ViewsForm = { openAccountForm: openAccountForm, openInvoiceForm: openInvoiceForm };
})(window);
