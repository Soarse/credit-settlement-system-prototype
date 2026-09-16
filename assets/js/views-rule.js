/* =============================================================================
 * views-rule.js —— 模块② 规则中心：协议版本、规则详情、配置向导、试算、发布
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  function ruleDetailBody(item, ver) {
    var r = item.rule;
    var box = h('div');
    box.appendChild(h('div', { class: 'nl-preview' }, [
      h('div', { style: 'font-size:11.5px;color:var(--fg-muted);margin-bottom:4px' }, '规则自然语言预览（降低配置错误率的关键设计 · 5.10）'),
      h('div', { html: Engine.ruleToText(item).replace(/【([^】]+)】/g, '<b>$1</b>') })
    ]));
    box.appendChild(h('div', { class: 'mt14' }, U.kv([
      ['计费项编号', h('span', { class: 'mono' }, item.charge_item_no)],
      ['费种编码', h('span', { class: 'mono' }, item.charge_item_code)],
      ['收付方向', U.dirBadge(item.direction)],
      ['税率 / 含税', M.pct(item.tax_rate, 0) + ' / ' + (item.tax_included ? '含税价' : '不含税价')],
      ['结算周期', ({ DAILY: '日', WEEKLY: '周', MONTHLY: '月', QUARTERLY: '季' })[item.settle_cycle]],
      ['参与轧差', item.join_netting ? U.badge('是', 'ok') : U.badge('否', '')],
      ['会计科目', item.accounting_code],
      ['规则编号', h('span', { class: 'mono' }, r.rule_no)],
      ['触发事件', h('span', { class: 'mono' }, r.trigger.event_code)],
      ['计费对象', r.charge_object.level + ' / ' + r.charge_object.id_field],
      ['计费基数', r.basis.type + (r.basis.source_field ? ' · ' + (Array.isArray(r.basis.source_field) ? r.basis.source_field.join(' + ') : r.basis.source_field) : '')],
      ['费率模型', r.rate_model.type],
      ['流水粒度', r.output.fee_flow_granularity],
      ['冲正策略', ({ FULL: '全额冲正', PROPORTIONAL: '按比例冲正', NONE: '不冲正' })[r.reversal_policy]]
    ], 'kv-2col')));
    if (r.rate_model.tiers) {
      box.appendChild(h('h3', { class: 'sec' }, '阶梯档位'));
      box.appendChild(U.table([
        { label: '档位', render: function (t) { return '第 ' + t.seq + ' 档'; } },
        { label: '下界（含）', num: true, render: function (t) { return M.fmt(t.lower); } },
        { label: '上界（不含）', num: true, render: function (t) { return t.upper === null ? '∞' : M.fmt(t.upper); } },
        { label: '费率', num: true, render: function (t) { return M.pct(t.ratio, 2); } }
      ], r.rate_model.tiers, { compact: true }));
      box.appendChild(h('div', { class: 'mt8' }, U.alertBox('warn',
        '<b>阶梯类型：' + (r.rate_model.type === 'TIER_PROGRESSIVE' ? '累进式（分档分别计算后求和）' : '超额式（达标档位整体适用）') +
        '</b>。以基数 4.2 亿计：累进 <b>' + M.fmt(Engine.tierCalc(r.rate_model.tiers, 420000000, false)) +
        '</b>，超额 <b>' + M.fmt(Engine.tierCalc(r.rate_model.tiers, 420000000, true)) +
        '</b>，相差 <b>' + M.fmt(Math.abs(Engine.tierCalc(r.rate_model.tiers, 420000000, false) - Engine.tierCalc(r.rate_model.tiers, 420000000, true))) +
        '</b>。配置时选错模型即构成重大资损（风险 R8）。')));
    }
    box.appendChild(h('h3', { class: 'sec' }, ['规则 JSON（运行态冻结快照）', h('span', { class: 'tag-ref' }, '5.3.2')]));
    box.appendChild(h('pre', { class: 'code' }, JSON.stringify(r, null, 2)));
    return box;
  }

  /* =========================================================================
   * 规则中心首页
   * ======================================================================= */
  UI.route('rules', {
    title: '规则中心',
    crumbs: ['模块②', '规则中心'],
    render: function (root, params) {
      var S = Store.get();
      var active = params.tab || 'agreements';
      root.appendChild(U.pageHead('规则中心',
        '把一纸合同条款变成机器可执行、可版本化、可试算、可回滚的规则。这是「新增资金方 5 天接入」与「存量协议免发版当日生效」两个核心目标的承载模块。',
        [
          h('button', { class: 'btn', onclick: function () { U.goto('/trial'); } }, '试算工作台'),
          h('button', { class: 'btn btn-primary', disabled: !Store.can('rule.edit'), onclick: function () { U.goto('/rulewizard'); } }, '＋ 规则配置向导')
        ]));
      var body = h('div');
      root.appendChild(U.tabs([
        { key: 'agreements', label: '协议与版本' }, { key: 'templates', label: '规则模板库' },
        { key: 'dict', label: '费种字典' }, { key: 'boundary', label: '配置态 / 运行态' }
      ], active, function (k) { U.goto('/rules?tab=' + k); }));
      root.appendChild(body);

      if (active === 'agreements') {
        var rows = S.agreements.map(function (a) {
          var vs = S.versions.filter(function (v) { return v.agreement_no === a.agreement_no; });
          var iv = Engine.validateVersionIntervals(S.versions, a);
          return { a: a, vs: vs, iv: iv };
        });
        body.appendChild(U.card(null, U.table([
          { label: '协议号', render: function (r) { return U.link(r.a.agreement_no, '/versions/' + r.a.agreement_no, 'mono'); } },
          { label: '资金方', render: function (r) { return (S.partnerMap[r.a.partner_no] || {}).partner_short_name; } },
          { label: '协议名称', render: function (r) { return r.a.agreement_name; } },
          { label: '合作期', render: function (r) { return r.a.coop_start_date + ' ~ ' + r.a.coop_end_date; } },
          { label: '版本数', num: true, render: function (r) { return r.vs.length; } },
          { label: '生效版本', render: function (r) { var e = r.vs.filter(function (v) { return v.status === 'EFFECTIVE'; }); return e.map(function (v) { return v.version_no; }).join(', ') || '—'; } },
          { label: '计费项', num: true, render: function (r) { var e = r.vs.filter(function (v) { return v.status === 'EFFECTIVE'; }); return e.length ? e[e.length - 1].items.length : 0; } },
          { label: '区间不变式', render: function (r) { return r.iv.ok ? U.badge('无重叠无空洞', 'ok') : U.badge(r.iv.issues[0].type, 'danger'); } }
        ], rows, { onRow: function (r) { U.goto('/versions/' + r.a.agreement_no); } }), { tight: true }));
      }

      if (active === 'templates') {
        body.appendChild(U.alertBox('info',
          '模板是「5 天接入」的关键提效手段：<b>新接入 = 选模板 + 改参数 + 试算</b>。模板更新不影响已基于旧模板创建的规则（规则一经生成即与模板脱钩，只保留 source_template_code 供追溯）。'));
        body.appendChild(h('div', { class: 'grid g2' }, Data.RULE_TEMPLATES.map(function (t) {
          return U.card(t.name, h('div', null, [
            h('div', { class: 'mono faint', style: 'font-size:11px' }, t.code),
            h('p', { class: 'muted', style: 'margin:6px 0' }, t.desc),
            h('pre', { class: 'code' }, JSON.stringify(t.skeleton, null, 2)),
            h('button', {
              class: 'btn btn-sm btn-primary mt8', disabled: !Store.can('rule.edit'),
              onclick: function () { U.goto('/rulewizard?tpl=' + t.code); }
            }, '用此模板新建规则 →')
          ]));
        })));
      }

      if (active === 'dict') {
        body.appendChild(U.card('费种字典 charge_item_code', U.table([
          { label: '编码', render: function (d) { return h('span', { class: 'mono' }, d.code); } },
          { label: '名称', key: 'name' },
          { label: '典型方向', render: function (d) { return d.dir === 'BOTH' ? U.badge('收 / 付', 'purple') : U.dirBadge(d.dir); } },
          { label: '说明', key: 'note' },
          { label: '在用规则数', num: true, render: function (d) {
            var n = 0; S.versions.forEach(function (v) { v.items.forEach(function (i) { if (i.charge_item_code === d.code) n++; }); }); return n; } }
        ], Data.CHARGE_ITEM_DICT, { compact: true }), { tight: true, ref: '5.2.2' }));
        body.appendChild(U.alertBox('warn',
          '费种字典可扩展但需走字典审批，<b>不允许业务方随意新建费种</b> —— 费种直接影响会计科目映射与税率，字典失控会导致总账无法对应。'));
        body.appendChild(h('div', { class: 'grid g2' }, [
          U.card('计费基数类型', U.table([
            { label: '编码', render: function (b) { return h('span', { class: 'mono' }, b.code); } },
            { label: '名称', key: 'name' }, { label: '取值来源', key: 'src' }, { label: '适配事件', key: 'fit' }
          ], Data.BASIS_TYPES, { compact: true }), { tight: true, ref: '6.3.2' }),
          U.card('费率模型', U.table([
            { label: '编码', render: function (b) { return h('span', { class: 'mono' }, b.code); } },
            { label: '名称', key: 'name' }, { label: '公式', key: 'formula' }
          ], Data.RATE_MODELS, { compact: true }), { tight: true, ref: '6.4' })
        ]));
      }

      if (active === 'boundary') {
        body.appendChild(U.card('配置态与运行态分离', h('div', null, [
          h('pre', { class: 'code' },
            '配置态（可编辑）                  运行态（不可变）\n' +
            '┌──────────────┐   发布    ┌──────────────────┐\n' +
            '│ 草稿版本      │ ────────▶ │ 已生效版本快照     │ ◀── 计费引擎只读\n' +
            '│ 可反复修改    │           │ 冻结，禁止修改     │\n' +
            '│ 可试算        │  ◀────    │ 只能被新版本替代   │\n' +
            '└──────────────┘   回滚    └──────────────────┘'),
          h('p', { class: 'muted mt8' }, '计费引擎只读运行态快照，绝不读配置态数据。这保证了：编辑草稿不会意外影响正在跑的计费。')
        ]), { ref: '5.1.2' }));
        body.appendChild(U.card('规则中心 vs 计费引擎（ADR-8）', U.table([
          { label: '', key: 'k', width: '130px' }, { label: '规则中心', key: 'a' }, { label: '计费引擎', key: 'b' }
        ], [
          { k: '回答的问题', a: '规则长什么样', b: '怎么按规则算' },
          { k: '变更频率', a: '高（业务驱动，天级）', b: '低（技术驱动，季度级）' },
          { k: '变更方式', a: '配置，免发版', b: '发版' },
          { k: '输出', a: '生效规则集、版本路由表', b: '费用流水' },
          { k: '失败影响', a: '配置错误 → 试算可拦截', b: '代码缺陷 → 影响所有资金方' }
        ], { compact: true }), { tight: true }));
        body.appendChild(U.card('发布流程与分级审批', h('div', null, [
          h('div', { class: 'flowchain' }, ['配置', '校验', '试算', '评审', '审批', '发布'].map(function (x, i) {
            return h('span', null, [h('span', { class: 'fnode' }, x), i < 5 ? h('span', { class: 'farrow' }, ' → ') : null]);
          })),
          U.table([{ label: '影响金额（月度差额绝对值）', key: 'a' }, { label: '审批层级', key: 'b' }], [
            { a: '< 1 万元', b: '财务核算' },
            { a: '1 万 ~ 10 万元', b: '财务核算 + 财务负责人' },
            { a: '> 10 万元 或 追溯生效', b: '财务负责人 + 风控 + 业务负责人' }
          ], { compact: true }),
          h('div', { class: 'mt8' }, U.alertBox('danger',
            '<b>追溯生效（生效日 &lt; 今天）</b>必须显式发起范围重算，绝不允许发布后自动静默重算并改写历史账单。'))
        ]), { ref: '5.8' }));
      }
    }
  });

  /* =========================================================================
   * 协议版本时间轴 + 版本详情
   * ======================================================================= */
  UI.route('versions', {
    title: '协议版本',
    crumbs: ['模块②', '规则中心', '协议版本'],
    render: function (root, params) {
      var S = Store.get();
      var agr = S.agreementMap[params.id];
      if (!agr) { root.appendChild(U.alertBox('danger', '未找到协议 ' + params.id)); return; }
      var partner = S.partnerMap[agr.partner_no];
      var vs = S.versions.filter(function (v) { return v.agreement_no === agr.agreement_no; })
        .sort(function (a, b) { return a.effective_date < b.effective_date ? -1 : 1; });
      var iv = Engine.validateVersionIntervals(S.versions, agr);

      root.appendChild(U.pageHead(agr.agreement_name,
        agr.agreement_no + ' ｜ ' + partner.partner_short_name + ' ｜ 合作期 ' + agr.coop_start_date + ' ~ ' + agr.coop_end_date,
        [
          h('button', { class: 'btn', onclick: function () { U.goto('/partner/' + agr.partner_no + '?tab=agreement'); } }, '资金方档案'),
          h('button', { class: 'btn btn-primary', disabled: !Store.can('rule.edit'), onclick: function () { U.goto('/rulewizard?agr=' + agr.agreement_no); } }, '＋ 新建版本')
        ]));

      /* ---- 时间轴 ---- */
      var t0 = D.parse(agr.coop_start_date).getTime();
      var t1 = D.parse(agr.coop_end_date).getTime();
      var span = t1 - t0;
      var track = h('div', { class: 'vtrack' });
      vs.forEach(function (v) {
        if (v.status === 'DRAFT' && v.effective_date > agr.coop_end_date) return;
        var s = Math.max(t0, D.parse(v.effective_date).getTime());
        var e = Math.min(t1, D.parse(v.expiry_date === '9999-12-31' ? agr.coop_end_date : v.expiry_date).getTime());
        if (e <= s) return;
        var cls = v.status === 'EFFECTIVE' ? 'v-eff' : (v.status === 'EXPIRED' ? 'v-exp' :
          (v.status === 'PENDING_EFFECTIVE' ? 'v-pend' : 'v-draft'));
        // 配置态（草稿 / 待生效）画在下半层，避免遮挡运行态版本
        var lane = (v.status === 'DRAFT' || v.status === 'PENDING_EFFECTIVE') ? 'top:26px;font-size:10px;' : 'bottom:18px;';
        track.appendChild(h('div', {
          class: 'vseg ' + cls,
          style: lane + 'left:' + ((s - t0) / span * 100) + '%;width:' + ((e - s) / span * 100) + '%',
          title: v.version_no + '  [' + v.effective_date + ', ' + v.expiry_date + ')  ' + U.statusText(v.status),
          onclick: function () { showVersion(v); }
        }, v.version_no));
      });
      iv.issues.filter(function (i) { return i.type === 'GAP'; }).forEach(function (g) {
        var s = D.parse(g.from).getTime(), e = D.parse(g.to).getTime();
        track.appendChild(h('div', { class: 'vseg gap', style: 'left:' + ((s - t0) / span * 100) + '%;width:' + ((e - s) / span * 100) + '%', title: '空洞' }, ''));
      });
      root.appendChild(U.card('协议版本时间轴', h('div', { class: 'vtimeline' }, [
        track,
        h('div', { class: 'vaxis' }, [h('span', null, agr.coop_start_date),
          h('span', null, '上层＝运行态（引擎可见）　下层＝配置态（草稿 / 待生效）'),
          h('span', null, agr.coop_end_date)]),
        h('div', { class: 'vlegend' }, [
          h('span', null, [h('i', { style: 'background:#2f7bff' }), '生效中']),
          h('span', null, [h('i', { style: 'background:#8592ab' }), '已失效（历史事件仍路由到它）']),
          h('span', null, [h('i', { style: 'background:#6f4ce0' }), '待生效']),
          h('span', null, [h('i', { style: 'background:#b6bfd1' }), '草稿']),
          h('span', null, [h('i', { style: 'background:repeating-linear-gradient(45deg,#d03a3a,#d03a3a 3px,#fff 3px,#fff 6px)' }), '区间空洞'])
        ]),
        iv.ok ? U.alertBox('ok', '<b>不变式校验通过</b>：同一协议下所有已生效版本区间互不重叠、无空洞，且覆盖协议整个合作期（5.4.2）。')
          : U.alertBox('danger', '<b>不变式校验失败</b>：' + iv.issues.map(function (i) { return i.msg; }).join('；'))
      ]), { ref: '5.4' }));

      /* ---- 版本清单 ---- */
      root.appendChild(U.card('版本清单', U.table([
        { label: '版本', render: function (v) { return h('b', null, v.version_no); }, width: '70px' },
        { label: '生效区间（左闭右开）', render: function (v) { return h('span', { class: 'mono' }, '[' + v.effective_date + ', ' + v.expiry_date + ')'); } },
        { label: '状态', render: function (v) { return U.statusBadge(v.status); }, width: '100px' },
        { label: '计费项', render: function (v) { return h('span', null, v.items.map(function (i) { return U.badge(i.charge_item_name, i.direction === 'RECEIVABLE' ? 'ok' : 'danger'); })); } },
        { label: '变更原因', render: function (v) { return v.change_reason; } },
        { label: '引擎可见', render: function (v) { return ['EFFECTIVE', 'EXPIRED'].indexOf(v.status) >= 0 ? U.badge('✓', 'ok') : U.badge('✗', ''); }, width: '80px' },
        { label: '', width: '150px', render: function (v) {
          return h('div', { class: 'btn-row' }, [
            h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); showVersion(v); } }, '详情'),
            (v.status === 'DRAFT' ? h('button', {
              class: 'btn btn-sm btn-primary', disabled: !Store.can('rule.trial'),
              onclick: function (e) { e.stopPropagation(); U.goto('/trial?v=' + v.agreement_version_id); }
            }, '试算 / 发布') : null)
          ]);
        } }
      ], vs, { onRow: function (v) { showVersion(v); } }), { tight: true }));

      /* ---- 版本状态机 & 路由规则 ---- */
      root.appendChild(h('div', { class: 'grid g2' }, [
        U.card('版本状态机', h('pre', { class: 'code' },
          '草稿 DRAFT ──提交试算──▶ 试算中 TRIALING ──完成──▶ 待审 PENDING_APPROVAL\n' +
          '   ▲                                                     │ 审批通过\n' +
          '   └──────────── 驳回 ──────────────────────────────┐    ▼\n' +
          '                        待生效 PENDING_EFFECTIVE ──生效日到达──▶ 生效 EFFECTIVE\n' +
          '                                 │ 撤销                          │ 被新版本截断\n' +
          '                                 ▼                               ▼\n' +
          '                            作废 VOIDED                    失效 EXPIRED'), { ref: '5.4.5' }),
        U.card('路由规则：按事件发生日 occur_date', h('div', null, [
          h('pre', { class: 'code' },
            'SELECT * FROM agreement_version\n' +
            'WHERE agreement_no = ?\n' +
            '  AND status = \'EFFECTIVE\'\n' +
            '  AND effective_date <= occur_date\n' +
            '  AND expiry_date  >  occur_date'),
          h('div', { class: 'mt8' }, U.table([
            { label: '场景', key: 'k' }, { label: '按事件发生日（正确）', key: 'a' }, { label: '按计费执行日（错误）', key: 'b' }
          ], [
            { k: '3/28 放款，4/2 才补算', a: '用 V01', b: '用 V02，少收费' },
            { k: '4/10 发现 3 月漏算，重算 3 月', a: '仍用 V01，结果与当初一致', b: '用 V02，重算结果与原账单不符' },
            { k: '审计要求复现 2 月账单', a: '完全可复现', b: '无法复现' }
          ], { compact: true }))
        ]), { ref: '5.4.3' })
      ]));

      /* ---- 路由试验器 ---- */
      var dateIn = h('input', { type: 'date', value: '2026-03-20', style: 'max-width:170px' });
      var out = h('div', { class: 'mt8' });
      function routeTest() {
        var v = Engine.routeVersion(S.versions, agr.agreement_no, dateIn.value);
        out.innerHTML = '';
        out.appendChild(v
          ? U.alertBox('ok', '事件发生日 <b>' + dateIn.value + '</b> 命中版本 <b>' + v.version_no +
            '</b>（区间 [' + v.effective_date + ', ' + v.expiry_date + ')），计费项：' +
            v.items.map(function (i) { return i.charge_item_name + '（' + Engine.ruleToText(i).match(/适用【([^】]+)】/)[1] + '）'; }).join('；'))
          : U.alertBox('danger', '事件发生日 <b>' + dateIn.value + '</b> 无生效版本 → 事件将被标记 IGNORED·NO_VERSION 并告警'));
      }
      dateIn.addEventListener('change', routeTest);
      root.appendChild(U.card('版本路由试验器', h('div', null, [
        h('div', { class: 'inline-form' }, [
          U.field('业务事件发生日 occur_date', dateIn),
          h('button', { class: 'btn btn-primary', onclick: routeTest }, '路由')
        ]), out
      ]), { ref: '5.4.3' }));
      routeTest();

      function showVersion(v) {
        var body = h('div');
        body.appendChild(U.kv([
          ['版本号', v.agreement_no + '-' + v.version_no],
          ['生效区间', h('span', { class: 'mono' }, '[' + v.effective_date + ', ' + v.expiry_date + ')')],
          ['状态', U.statusBadge(v.status)],
          ['追溯生效', v.is_retroactive ? U.badge('是（需范围重算）', 'danger') : '否'],
          ['变更原因', v.change_reason],
          ['审批单号', v.approval_no || '—'], ['发布时间', v.publish_time || '—']
        ], 'kv-2col'));
        var tabKey = v.items[0].charge_item_no;
        var itemBox = h('div', { class: 'mt14' });
        function drawItem() {
          itemBox.innerHTML = '';
          itemBox.appendChild(U.tabs(v.items.map(function (i) { return { key: i.charge_item_no, label: i.charge_item_no + ' ' + i.charge_item_name }; }),
            tabKey, function (k) { tabKey = k; drawItem(); }));
          var it = v.items.filter(function (i) { return i.charge_item_no === tabKey; })[0];
          itemBox.appendChild(ruleDetailBody(it, v));
        }
        drawItem();
        body.appendChild(itemBox);
        U.modal(v.agreement_no + ' · ' + v.version_no, body, [
          v.status === 'DRAFT' ? h('button', { class: 'btn btn-primary', onclick: function () { U.closeModal(); U.goto('/trial?v=' + v.agreement_version_id); } }, '去试算与发布') : null,
          h('button', { class: 'btn', onclick: U.closeModal }, '关闭')
        ], { size: 'wide' });
      }
    }
  });

  /* =========================================================================
   * 规则配置向导（6 步）
   * ======================================================================= */
  UI.route('rulewizard', {
    title: '规则配置向导',
    crumbs: ['模块②', '规则中心', '配置向导'],
    render: function (root, params) {
      var S = Store.get();
      var tpl = Data.RULE_TEMPLATES.filter(function (t) { return t.code === params.tpl; })[0];
      var draft = S.wizardDraft;
      if (!draft || params.reset || (params.agr && draft.agreement_no !== params.agr) || (params.tpl && draft.template !== params.tpl)) {
        var sk = tpl ? tpl.skeleton : Data.RULE_TEMPLATES[0].skeleton;
        draft = S.wizardDraft = {
          template: tpl ? tpl.code : '',
          agreement_no: params.agr || 'AG202601000012',
          version_no: 'V' + Core.pad(S.versions.filter(function (v) { return v.agreement_no === (params.agr || 'AG202601000012'); }).length + 1, 2),
          effective_date: '2026-06-01', expiry_date: '9999-12-31',
          change_reason: '',
          item: {
            charge_item_no: 'CI001', charge_item_code: 'TECH_SERVICE_FEE', charge_item_name: '技术服务费',
            direction: 'RECEIVABLE', tax_rate: 0.06, tax_included: 1, settle_cycle: 'MONTHLY',
            join_netting: 0, accounting_code: '6001', status: 'ENABLED',
            settle_day_rule: { cycle: 'MONTHLY', period_start_day: 1, period_end_day: 'LAST_DAY', cutoff_offset_days: 0, bill_gen_offset_days: 1, confirm_deadline_days: 5, settle_offset_days: 3, holiday_adjust: 'NEXT_WORKDAY' },
            rule: {
              rule_no: Core.No.rule(),
              trigger: { event_code: sk.event, event_filter: { product_codes: ['*'], channel_codes: ['*'] } },
              charge_object: { level: 'LOAN', id_field: 'loan_no' },
              basis: { type: sk.basis, source_field: sk.basisField, funding_ratio_apply: true },
              rate_model: sk.rate === 'DAILY_RATE' ? { type: 'DAILY_RATE', annual_ratio: 0.06, day_count_basis: 360 }
                : (sk.rate === 'TIER_PROGRESSIVE' ? { type: 'TIER_PROGRESSIVE', tier_basis: 'MONTHLY_ACCUM_DISBURSE', tier_period: 'NATURAL_MONTH', tier_trueup_enabled: true, tier_accum_reverse_deduct: true, tiers: [{ seq: 1, lower: 0, upper: 100000000, ratio: 0.015 }, { seq: 2, lower: 100000000, upper: 300000000, ratio: 0.013 }, { seq: 3, lower: 300000000, upper: null, ratio: 0.011 }] }
                  : { type: 'FIXED_RATIO', ratio: 0.015 }),
              output: { fee_flow_granularity: sk.granularity, rounding_mode: 'HALF_UP', rounding_scale: 2 },
              reversal_policy: sk.reversal
            }
          },
          step: 0
        };
      }
      var item = draft.item, rule = item.rule;

      root.appendChild(U.pageHead('规则配置向导',
        '分步配置 → 每步实时校验 → 右侧「规则自然语言预览」帮助业务确认。业务人员看不懂 JSON，但能看出「按放款本金收 1.5%」是不是他们谈的条款。',
        [h('button', { class: 'btn', onclick: function () { U.goto('/rules'); } }, '返回规则中心')]));

      var STEPS = ['基本信息', '触发与过滤', '计费对象与基数', '费率模型', '输出与税', '校验与保存'];
      var stepsEl = h('div', { class: 'steps' });
      var panel = h('div');
      var preview = h('div');

      function drawSteps() {
        stepsEl.innerHTML = '';
        STEPS.forEach(function (s, i) {
          stepsEl.appendChild(h('div', {
            class: 'step' + (i === draft.step ? ' active' : (i < draft.step ? ' done' : '')),
            onclick: function () { draft.step = i; drawAll(); }
          }, [h('span', { class: 'n' }, i < draft.step ? '✓' : (i + 1)), s]));
        });
      }
      function drawPreview() {
        preview.innerHTML = '';
        preview.appendChild(U.card('规则自然语言预览', h('div', { class: 'nl-preview', html: Engine.ruleToText(item).replace(/【([^】]+)】/g, '<b>$1</b>') }), { ref: '5.10' }));
        var fakeVer = { agreement_no: draft.agreement_no, version_no: draft.version_no, effective_date: draft.effective_date, expiry_date: draft.expiry_date, items: [item] };
        var checks = Engine.validateRules(fakeVer, S.agreementMap[draft.agreement_no], { trialDone: false });
        preview.appendChild(U.card('实时校验 V-R01~R09', U.checklist(checks), { tight: true, ref: '5.3.4' }));
        preview.appendChild(U.card('规则 JSON', h('pre', { class: 'code' }, JSON.stringify(rule, null, 2)), { ref: '5.3.2' }));
      }
      function drawPanel() {
        panel.innerHTML = '';
        var s = draft.step;
        if (s === 0) {
          panel.appendChild(U.card('① 基本信息', h('div', null, [
            U.field('所属协议', U.selectEl(S.agreements.map(function (a) { return { value: a.agreement_no, label: a.agreement_no + ' ' + a.agreement_name }; }),
              draft.agreement_no, function (v) { draft.agreement_no = v; drawAll(); })),
            U.field('版本号', h('input', { type: 'text', value: draft.version_no, oninput: function (e) { draft.version_no = e.target.value; drawPreview(); } })),
            h('div', { class: 'grid g2' }, [
              U.field('生效日 effective_date（含）', h('input', { type: 'date', value: draft.effective_date, onchange: function (e) { draft.effective_date = e.target.value; drawAll(); } }),
                draft.effective_date < S.simToday ? '⚠ 追溯生效：发布后需显式发起范围重算，且需财务 + 风控双审批' : '未来生效，到期自动生效'),
              U.field('失效日 expiry_date（不含）', h('input', { type: 'date', value: draft.expiry_date === '9999-12-31' ? '' : draft.expiry_date, placeholder: '9999-12-31', onchange: function (e) { draft.expiry_date = e.target.value || '9999-12-31'; drawPreview(); } }))
            ]),
            U.field('变更原因', h('textarea', { rows: 2, oninput: function (e) { draft.change_reason = e.target.value; } }, draft.change_reason)),
            h('div', { class: 'hr' }),
            h('div', { class: 'grid g2' }, [
              U.field('计费项名称', h('input', { type: 'text', value: item.charge_item_name, oninput: function (e) { item.charge_item_name = e.target.value; drawPreview(); } })),
              U.field('费种编码', U.selectEl(Data.CHARGE_ITEM_DICT.map(function (d) { return { value: d.code, label: d.code + ' ' + d.name }; }),
                item.charge_item_code, function (v) {
                  item.charge_item_code = v;
                  var d = Data.CHARGE_ITEM_DICT.filter(function (x) { return x.code === v; })[0];
                  item.charge_item_name = d.name;
                  if (d.dir !== 'BOTH') item.direction = d.dir;
                  drawAll();
                }))
            ]),
            U.field('收付方向（决策 D-01）', U.selectEl([
              { value: 'RECEIVABLE', label: 'RECEIVABLE 我方向资金方收取' },
              { value: 'PAYABLE', label: 'PAYABLE 我方向资金方支付' }
            ], item.direction, function (v) { item.direction = v; drawPreview(); }))
          ])));
        }
        if (s === 1) {
          var f = rule.trigger.event_filter;
          panel.appendChild(U.card('② 触发事件与过滤条件', h('div', null, [
            U.field('触发事件 trigger.event_code', U.selectEl(Data.EVENT_DICT.map(function (e) { return { value: e.code, label: e.code + '  ' + e.name + '（' + e.src + '）' }; }),
              rule.trigger.event_code, function (v) { rule.trigger.event_code = v; drawAll(); }),
              '事件字典可扩展：新增事件类型只需登记 + 上游按契约投递，不修改引擎代码'),
            h('div', { class: 'grid g2' }, [
              U.field('产品范围 product_codes', h('input', { type: 'text', value: (f.product_codes || ['*']).join(','), oninput: function (e) { f.product_codes = e.target.value.split(',').map(function (x) { return x.trim(); }); drawPreview(); } }), '* 表示全部；多个用逗号分隔'),
              U.field('渠道范围 channel_codes', h('input', { type: 'text', value: (f.channel_codes || ['*']).join(','), oninput: function (e) { f.channel_codes = e.target.value.split(',').map(function (x) { return x.trim(); }); drawPreview(); } }))
            ]),
            h('div', { class: 'grid g2' }, [
              U.field('逾期天数下界', h('input', { type: 'number', value: f.overdue_days_range ? f.overdue_days_range.min : '', placeholder: '不限', oninput: function (e) {
                f.overdue_days_range = f.overdue_days_range || { min: null, max: null };
                f.overdue_days_range.min = e.target.value === '' ? null : +e.target.value;
                if (f.overdue_days_range.min === null && f.overdue_days_range.max === null) delete f.overdue_days_range;
                drawPreview();
              } })),
              U.field('逾期天数上界', h('input', { type: 'number', value: f.overdue_days_range ? f.overdue_days_range.max : '', placeholder: '不限', oninput: function (e) {
                f.overdue_days_range = f.overdue_days_range || { min: null, max: null };
                f.overdue_days_range.max = e.target.value === '' ? null : +e.target.value;
                drawPreview();
              } }), '例：0–89 表示排除逾期 90 天以上资产（PRD 样例 D）')
            ]),
            U.alertBox('info', '多条件之间为 <b>AND</b> 关系。需要 OR 逻辑时，配置为多条规则。过滤条件在<b>基数取值前</b>求值，不满足则记 IGNORED·NO_RULE_MATCH。')
          ])));
        }
        if (s === 2) {
          panel.appendChild(U.card('③ 计费对象与计费基数', h('div', null, [
            U.field('计费对象层级', U.selectEl([
              { value: 'LOAN', label: 'LOAN 借据（推荐，粒度最细，追溯与逐笔对账最强）' },
              { value: 'CONTRACT', label: 'CONTRACT 合同' }, { value: 'CUSTOMER', label: 'CUSTOMER 客户' },
              { value: 'ASSET_POOL', label: 'ASSET_POOL 资产包' }, { value: 'PARTNER', label: 'PARTNER 资金方' }
            ], rule.charge_object.level, function (v) {
              rule.charge_object.level = v;
              rule.charge_object.id_field = { LOAN: 'loan_no', CONTRACT: 'contract_no', CUSTOMER: 'cust_no', ASSET_POOL: 'pool_no', PARTNER: 'partner_no' }[v];
              drawPreview();
            })),
            U.field('计费基数类型', U.selectEl(Data.BASIS_TYPES.map(function (b) { return { value: b.code, label: b.code + '  ' + b.name }; }),
              rule.basis.type, function (v) { rule.basis.type = v; drawAll(); }),
              'V-R02：余额型基数只能配 EV_DAILY_BALANCE'),
            U.field('取值字段 source_field', h('input', { type: 'text', value: Array.isArray(rule.basis.source_field) ? rule.basis.source_field.join('+') : rule.basis.source_field, oninput: function (e) {
              var v = e.target.value; rule.basis.source_field = v.indexOf('+') >= 0 ? v.split('+').map(function (x) { return x.trim(); }) : v;
              if (Array.isArray(rule.basis.source_field)) rule.basis.aggregate = 'SUM';
              drawPreview();
            } }), '多字段相加用 + 连接，如 repay_principal+repay_interest'),
            h('label', { class: 'checkline' }, [
              h('input', { type: 'checkbox', checked: rule.basis.funding_ratio_apply, onchange: function (e) { rule.basis.funding_ratio_apply = e.target.checked; drawPreview(); } }),
              '按出资比例折算基数（联合贷模式，比例取放款时点固化值）'
            ]),
            h('div', { class: 'mt8' }, U.alertBox('info',
              '<b>基数快照机制（6.3.3）</b>：算费时把基数取值与来源固化为一条 basis_snapshot，费用流水引用该快照 ID。复算时读快照，<b>绝不重新查询实时数据</b> —— 这是「可复算」的技术前提。'))
          ])));
        }
        if (s === 3) {
          var rm = rule.rate_model;
          var body = h('div', null, [
            U.field('费率模型', U.selectEl(Data.RATE_MODELS.map(function (r) { return { value: r.code, label: r.code + '  ' + r.name + '  ｜ ' + r.formula }; }),
              rm.type, function (v) {
                if (v === 'FIXED_RATIO') rule.rate_model = { type: 'FIXED_RATIO', ratio: 0.015 };
                else if (v === 'FIXED_AMOUNT') rule.rate_model = { type: 'FIXED_AMOUNT', unit_price: 2 };
                else if (v === 'DAILY_RATE') rule.rate_model = { type: 'DAILY_RATE', annual_ratio: 0.06, day_count_basis: 360 };
                else rule.rate_model = { type: v, tier_basis: 'MONTHLY_ACCUM_DISBURSE', tier_period: 'NATURAL_MONTH', tier_trueup_enabled: true, tier_accum_reverse_deduct: true, tiers: [{ seq: 1, lower: 0, upper: 100000000, ratio: 0.015 }, { seq: 2, lower: 100000000, upper: 300000000, ratio: 0.013 }, { seq: 3, lower: 300000000, upper: null, ratio: 0.011 }] };
                drawAll();
              }))
          ]);
          rm = rule.rate_model;
          if (rm.type === 'FIXED_RATIO') {
            body.appendChild(U.field('费率 ratio', h('input', { type: 'number', step: '0.0001', value: rm.ratio, oninput: function (e) { rm.ratio = +e.target.value; drawPreview(); } }), '示例：0.015 表示 1.5%'));
            body.appendChild(h('div', { class: 'grid g2' }, [
              U.field('月度保底 floor_amount', h('input', { type: 'number', value: rm.floor_amount || '', placeholder: '不设置', oninput: function (e) { rm.floor_amount = e.target.value === '' ? undefined : +e.target.value; drawPreview(); } })),
              U.field('封顶 cap_amount', h('input', { type: 'number', value: rm.cap_amount || '', placeholder: '不设置', oninput: function (e) { rm.cap_amount = e.target.value === '' ? undefined : +e.target.value; drawPreview(); } }))
            ]));
          }
          if (rm.type === 'FIXED_AMOUNT') {
            body.appendChild(U.field('单价（元/笔）', h('input', { type: 'number', step: '0.01', value: rm.unit_price, oninput: function (e) { rm.unit_price = +e.target.value; drawPreview(); } })));
          }
          if (rm.type === 'DAILY_RATE') {
            body.appendChild(h('div', { class: 'grid g2' }, [
              U.field('年化费率 annual_ratio', h('input', { type: 'number', step: '0.0001', value: rm.annual_ratio, oninput: function (e) { rm.annual_ratio = +e.target.value; drawPreview(); } })),
              U.field('计息基准 day_count_basis（D-05）', U.selectEl([{ value: '360', label: '360 天（默认）' }, { value: '365', label: '365 天' }], String(rm.day_count_basis), function (v) { rm.day_count_basis = +v; drawPreview(); }))
            ]));
            body.appendChild(U.alertBox('info', '日费率 = ' + M.pct(rm.annual_ratio, 2) + ' ÷ ' + rm.day_count_basis + ' = <b>' + (rm.annual_ratio / rm.day_count_basis * 100).toFixed(6) + '%</b>；算头不算尾（放款日计费，结清日不计费）。'));
          }
          if (rm.tiers) {
            var tbl = h('div');
            function drawTiers() {
              tbl.innerHTML = '';
              tbl.appendChild(U.table([
                { label: '档', render: function (t) { return '第 ' + t.seq + ' 档'; }, width: '60px' },
                { label: '下界', num: true, render: function (t) { return h('input', { type: 'number', value: t.lower, oninput: function (e) { t.lower = +e.target.value; drawPreview(); } }); } },
                { label: '上界（末档留空=∞）', num: true, render: function (t) { return h('input', { type: 'number', value: t.upper === null ? '' : t.upper, oninput: function (e) { t.upper = e.target.value === '' ? null : +e.target.value; drawPreview(); } }); } },
                { label: '费率', num: true, render: function (t) { return h('input', { type: 'number', step: '0.0001', value: t.ratio, oninput: function (e) { t.ratio = +e.target.value; drawCompare(); drawPreview(); } }); } }
              ], rm.tiers, { compact: true }));
            }
            drawTiers();
            body.appendChild(h('h3', { class: 'sec' }, '阶梯档位（V-R05：必须连续、不重叠、覆盖到无穷大）'));
            body.appendChild(tbl);
            var cmp = h('div', { class: 'tier-compare mt14' });
            function drawCompare() {
              cmp.innerHTML = '';
              var base = 420000000;
              var prog = Engine.tierCalc(rm.tiers, base, false), flat = Engine.tierCalc(rm.tiers, base, true);
              [['TIER_PROGRESSIVE', '累进式', '各档分别计算后求和（类似个税）', prog],
               ['TIER_FLAT', '超额式', '达到的最高档位费率整体适用于全部基数', flat]].forEach(function (x) {
                cmp.appendChild(h('div', {
                  class: 'tier-card' + (rm.type === x[0] ? ' sel' : ''),
                  onclick: function () { rm.type = x[0]; drawAll(); }
                }, [
                  h('h5', null, x[1] + (rm.type === x[0] ? ' ✓ 已选' : '')),
                  h('div', { class: 'faint', style: 'font-size:11.5px' }, x[2]),
                  h('div', { class: 'amt mt8' }, M.fmt(x[3])),
                  h('div', { class: 'faint', style: 'font-size:11px' }, '基数 4.2 亿时的费用')
                ]));
              });
            }
            drawCompare();
            body.appendChild(h('h3', { class: 'sec' }, ['两种阶梯模型必须以对比方式展示（风险 R8）', h('span', { class: 'tag-ref' }, '6.4.5')]));
            body.appendChild(cmp);
            body.appendChild(h('div', { class: 'mt8' }, U.alertBox('danger',
              '两者对同一基数相差 <b>' + M.fmt(Math.abs(Engine.tierCalc(rm.tiers, 420000000, false) - Engine.tierCalc(rm.tiers, 420000000, true))) +
              '</b>。选错模型即构成重大资损，因此配置界面强制对比展示，不给单一下拉选项。')));
            body.appendChild(h('div', { class: 'mt8' }, U.alertBox('info',
              '<b>周期末找平（6.4.6）</b>：事件逐笔到达但档位取决于周期内累计值，采用「逐笔增量计费 + EV_PERIOD_CLOSE 找平」。撤销会改变累计基数进而改变适用档位，找平机制是阶梯计费正确性的必要条件。')));
          }
          panel.appendChild(U.card('④ 费率模型', body));
        }
        if (s === 4) {
          panel.appendChild(U.card('⑤ 输出、税与冲正', h('div', null, [
            U.field('流水粒度 fee_flow_granularity', U.selectEl([
              { value: 'PER_EVENT', label: 'PER_EVENT 每事件一条流水（便于逐笔对账）' },
              { value: 'PER_DAY', label: 'PER_DAY 每日一条流水（余额型推荐）' },
              { value: 'PER_PERIOD', label: 'PER_PERIOD 每账期一条流水' }
            ], rule.output.fee_flow_granularity, function (v) { rule.output.fee_flow_granularity = v; drawPreview(); }),
              '⚠ 直接影响舍入结果：日费率 10 万余额连续 3 日，PER_DAY = 50.01，PER_PERIOD = 50.00。必须与资金方书面约定。'),
            h('div', { class: 'grid g2' }, [
              U.field('舍入方式', U.selectEl([{ value: 'HALF_UP', label: 'HALF_UP 四舍五入（默认）' }, { value: 'DOWN', label: 'DOWN 舍去' }, { value: 'UP', label: 'UP 进位' }], rule.output.rounding_mode, function (v) { rule.output.rounding_mode = v; drawPreview(); })),
              U.field('舍入位数', h('input', { type: 'number', value: rule.output.rounding_scale, oninput: function (e) { rule.output.rounding_scale = +e.target.value; drawPreview(); } }))
            ]),
            h('div', { class: 'grid g2' }, [
              U.field('税率（D-08）', h('input', { type: 'number', step: '0.01', value: item.tax_rate, oninput: function (e) { item.tax_rate = +e.target.value; drawPreview(); } })),
              U.field('结算周期', U.selectEl([{ value: 'DAILY', label: '日' }, { value: 'WEEKLY', label: '周' }, { value: 'MONTHLY', label: '月' }, { value: 'QUARTERLY', label: '季' }], item.settle_cycle, function (v) { item.settle_cycle = v; drawPreview(); }))
            ]),
            h('label', { class: 'checkline mb8' }, [
              h('input', { type: 'checkbox', checked: !!item.join_netting, onchange: function (e) { item.join_netting = e.target.checked ? 1 : 0; drawPreview(); } }),
              '参与应收应付轧差（决策 D-07；须有合同条款支持，配置时需上传条款截图作为依据）'
            ]),
            U.field('冲正策略 reversal_policy', U.selectEl([
              { value: 'PROPORTIONAL', label: 'PROPORTIONAL 按比例冲正' },
              { value: 'FULL', label: 'FULL 全额冲正' },
              { value: 'NONE', label: 'NONE 不冲正（如已提供服务的一次性费用）' }
            ], rule.reversal_policy, function (v) { rule.reversal_policy = v; drawPreview(); })),
            U.alertBox('info', '价税分离：不含税 = 含税 ÷ (1 + 税率) 舍入至分；税额 = 含税 − 不含税（<b>倒轧</b>，保证三者恒等）。')
          ])));
        }
        if (s === 5) {
          var fakeVer = { agreement_no: draft.agreement_no, version_no: draft.version_no, effective_date: draft.effective_date, expiry_date: draft.expiry_date, items: [item] };
          var checks = Engine.validateRules(fakeVer, S.agreementMap[draft.agreement_no], { trialDone: false });
          var blocked = checks.some(function (c) { return !c.ok && c.level === 'BLOCK' && c.code !== 'V-R09'; });
          panel.appendChild(U.card('⑥ 校验与保存', h('div', null, [
            U.checklist(checks),
            h('div', { class: 'mt14' }, U.alertBox(blocked ? 'danger' : 'ok',
              blocked ? '存在阻断级校验未通过，无法保存草稿。' :
                '校验通过。保存为草稿后需<b>完成至少一次试算</b>（V-R09）方可发布 —— 试算是配置正确性的唯一有效验证手段。')),
            h('div', { class: 'btn-row mt14' }, [
              h('button', {
                class: 'btn btn-primary', disabled: blocked || !Store.can('rule.edit'),
                onclick: function () {
                  var v = Store.Actions.saveWizardVersion({
                    agreement_no: draft.agreement_no, version_no: draft.version_no,
                    effective_date: draft.effective_date, expiry_date: draft.expiry_date,
                    change_reason: draft.change_reason || '（配置向导创建）', items: [Core.deep(item)]
                  });
                  S.wizardDraft = null;
                  UI.toast('草稿版本 ' + v.version_no + ' 已保存，下一步：试算', 'ok', '保存成功');
                  U.goto('/trial?v=' + v.agreement_version_id);
                }
              }, '保存草稿版本'),
              h('button', { class: 'btn', onclick: function () { S.wizardDraft = null; U.goto('/rulewizard?reset=1'); } }, '重置向导')
            ])
          ])));
        }
        // 步骤按钮
        panel.appendChild(h('div', { class: 'btn-row mt14' }, [
          h('button', { class: 'btn', disabled: draft.step === 0, onclick: function () { draft.step--; drawAll(); } }, '← 上一步'),
          h('button', { class: 'btn btn-primary', disabled: draft.step === STEPS.length - 1, onclick: function () { draft.step++; drawAll(); } }, '下一步 →')
        ]));
      }
      function drawAll() { drawSteps(); drawPanel(); drawPreview(); }

      root.appendChild(stepsEl);
      root.appendChild(h('div', { class: 'split-lr' }, [panel, preview]));
      drawAll();
    }
  });

  /* =========================================================================
   * 试算工作台
   * ======================================================================= */
  UI.route('trial', {
    title: '规则试算',
    crumbs: ['模块②', '规则中心', '试算与发布'],
    render: function (root, params) {
      var S = Store.get();
      var drafts = S.versions.filter(function (v) { return v.status === 'DRAFT' || v.status === 'TRIALING' || v.status === 'PENDING_APPROVAL'; });
      var sel = params.v ? +params.v : (drafts[0] ? drafts[0].agreement_version_id : null);
      var cur = S.versions.filter(function (v) { return v.agreement_version_id === sel; })[0];

      root.appendChild(U.pageHead('规则试算与发布',
        '试算模式：单笔试算 / 历史回放试算 / <b>版本对比试算</b>。试算结果写入 trial_batch + 影子流水表，<b>绝不写入正式 fee_flow</b>，也不消耗事件幂等键；试算与正式计费共用同一套计算内核，保证「试算通过 = 上线后结果一致」。'));

      if (!cur) { root.appendChild(U.alertBox('warn', '当前没有草稿版本。请先到「规则配置向导」创建一个草稿版本。')); return; }

      var agr = S.agreementMap[cur.agreement_no];
      var baseVer = S.versions.filter(function (v) {
        return v.agreement_no === cur.agreement_no && v.status === 'EFFECTIVE';
      }).sort(function (a, b) { return a.effective_date < b.effective_date ? 1 : -1; })[0];
      var range = { from: '2026-04-01', to: '2026-04-30' };
      var resultBox = h('div', { class: 'mt14' });

      root.appendChild(U.card('试算参数', h('div', { class: 'inline-form' }, [
        U.field('草稿版本', U.selectEl(drafts.map(function (v) { return { value: String(v.agreement_version_id), label: v.agreement_no + ' · ' + v.version_no + '（' + v.change_reason.slice(0, 20) + '）' }; }),
          String(sel), function (v) { U.goto('/trial?v=' + v); })),
        U.field('对比基线版本', h('input', { type: 'text', value: baseVer ? baseVer.version_no + '（现行）' : '无', readonly: true, style: 'max-width:150px' })),
        U.field('数据范围起', h('input', { type: 'date', value: range.from, onchange: function (e) { range.from = e.target.value; } })),
        U.field('数据范围止', h('input', { type: 'date', value: range.to, onchange: function (e) { range.to = e.target.value; } })),
        h('button', {
          class: 'btn btn-primary', disabled: !Store.can('rule.trial'),
          onclick: function () {
            var t = Store.Actions.runTrial(cur.agreement_version_id, baseVer ? baseVer.agreement_version_id : null, range);
            drawResult(t);
            UI.toast('试算完成，共回放 ' + t.event_count + ' 条历史事件', 'ok', '试算 ' + t.trial_no);
          }
        }, '▶ 执行历史回放试算')
      ]), { ref: '5.7' }));
      root.appendChild(resultBox);

      var existing = S.trials.filter(function (t) { return t.draft_version_id === cur.agreement_version_id; })[0];
      if (existing) drawResult(existing);

      function drawResult(t) {
        resultBox.innerHTML = '';
        var lines = [];
        lines.push('═══ 试算对比报告 ═══');
        lines.push('协议：' + t.agreement_no + '  资金方：' + (S.partnerMap[t.partner_no] || {}).partner_short_name);
        lines.push('对比：' + t.base_version + '（现行） →  ' + t.draft_version + '（草稿）');
        lines.push('数据范围：' + t.range.from + ' ~ ' + t.range.to + '，共 ' + M.fmt(t.event_count, 0) + ' 笔事件');
        lines.push('');
        lines.push(pad('计费项', 22) + pad('原金额', 16, 1) + pad('新金额', 16, 1) + pad('差额', 16, 1) + pad('变化率', 10, 1));
        lines.push('─'.repeat(80));
        t.rows.forEach(function (r) {
          lines.push(pad(r.name, 22) + pad(r.isNew ? '—' : M.fmt(r.oldAmount), 16, 1) + pad(M.fmt(r.newAmount), 16, 1) +
            pad(M.fmtSigned(r.diff), 16, 1) + pad(r.isNew ? '新增' : (r.pct === null ? '—' : M.pct(r.pct, 2)), 10, 1));
        });
        lines.push('─'.repeat(80));
        lines.push(pad('合计', 22) + pad(M.fmt(t.oldTotal), 16, 1) + pad(M.fmt(t.newTotal), 16, 1) +
          pad(M.fmtSigned(t.diffTotal), 16, 1) + pad(t.oldTotal ? M.pct(t.diffTotal / t.oldTotal, 2) : '—', 10, 1));
        lines.push('');
        lines.push('⚠ 差异笔数：' + t.flowsNew.length + ' 笔');
        var newItems = t.rows.filter(function (r) { return r.isNew; });
        if (newItems.length) lines.push('⚠ 新增计费项 ' + newItems.length + ' 个');
        if (t.touchedBills.length) lines.push('⚠ 若追溯生效，将影响已确认账单 ' + t.touchedBills.join(', '));
        function pad(s, n, right) {
          s = String(s); var w = 0;
          for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? 2 : 1;
          var sp = ' '.repeat(Math.max(0, n - w));
          return right ? sp + s : s + sp;
        }
        resultBox.appendChild(U.card('试算对比报告 ' + t.trial_no, h('pre', { class: 'code' }, lines.join('\n')), { ref: '5.7.3' }));

        resultBox.appendChild(U.card('差额明细（按计费项）', U.table([
          { label: '费种', render: function (r) { return h('span', { class: 'mono' }, r.code); } },
          { label: '名称', key: 'name' },
          { label: '原金额', num: true, render: function (r) { return r.isNew ? '—' : U.money(r.oldAmount); } },
          { label: '新金额', num: true, render: function (r) { return U.money(r.newAmount); } },
          { label: '差额', num: true, render: function (r) { return U.money(r.diff, { signed: true }); } },
          { label: '变化率', num: true, render: function (r) { return r.isNew ? U.badge('新增', 'purple') : (r.pct === null ? '—' : M.pct(r.pct, 2)); } }
        ], t.rows, { compact: true }), { tight: true }));

        // 影响面 + 审批 + 发布
        var lvl = Billing.approvalLevel(Math.abs(t.diffTotal));
        var apprLevel = Math.abs(t.diffTotal) < 10000 ? ['财务核算'] :
          (Math.abs(t.diffTotal) <= 100000 ? ['财务核算', '财务负责人'] : ['财务负责人', '风控', '业务负责人']);
        var retro = cur.effective_date < S.simToday;
        resultBox.appendChild(U.card('影响面评审与发布', h('div', null, [
          U.kv([
            ['月度差额绝对值', U.money(Math.abs(t.diffTotal))],
            ['所需审批层级', h('span', null, apprLevel.map(function (x) { return U.badge(x, 'brand'); }))],
            ['生效方式', retro ? U.badge('追溯生效（需显式发起范围重算）', 'danger') : U.badge(cur.effective_date <= S.simToday ? '当日生效' : '未来生效', 'ok')],
            ['触及已确认账单', t.touchedBills.length ? U.badge(t.touchedBills.join(', '), 'danger') : U.badge('无', 'ok')],
            ['试算批次', h('span', { class: 'mono' }, t.trial_no)]
          ], 'kv-2col'),
          (function () {
            var pend = Approval.pendingFor(S, 'RULE_PUBLISH', cur.agreement_no + '-' + cur.version_no);
            return pend ? U.alertBox('warn', '本版本已提交发布审批（<b>' + pend.approval_no + '</b>），当前环节：<b>' +
              Approval.currentStep(pend).role_name + '</b>。请到「审批中心 · 待办」处理。') : null;
          })(),
          h('div', { class: 'btn-row mt14' }, [
            h('button', {
              class: 'btn btn-primary',
              disabled: !Store.can('approval.submit') || !!Approval.pendingFor(S, 'RULE_PUBLISH', cur.agreement_no + '-' + cur.version_no),
              onclick: function () {
                var r = Store.Actions.submitRulePublish(cur.agreement_version_id);
                if (!r.ok) {
                  if (r.checks) U.modal('提交被阻断', U.checklist(r.checks), [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')]);
                  else UI.toast(r.msg, 'warn');
                  return;
                }
                var ap = r.approval;
                U.modal('发布审批已提交', h('div', null, [
                  U.alertBox('ok', '审批单 <b>' + ap.approval_no + '</b> 已生成。审批链路按<b>' +
                    (ap.flags.retroactive ? '追溯生效' : '影响金额 ' + M.fmt(Math.abs(ap.amount))) + '</b>自动分级：' +
                    ap.chain.map(function (s) { return s.role_name; }).join(' → ')),
                  ViewsApproval.chainView(ap),
                  U.alertBox('info', '全部环节通过后，系统才会执行<b>原子发布</b>（截断当前版本 expiry_date → 插入新版本快照 → 广播配置变更）。任一级驳回，版本状态回退为草稿。')
                ]), [
                  h('button', { class: 'btn btn-primary', onclick: function () { U.closeModal(); U.goto('/approvals'); } }, '前往审批中心'),
                  h('button', { class: 'btn', onclick: function () { U.closeModal(); App.rerender(); } }, '知道了')
                ]);
              }
            }, '提交发布审批'),
            h('button', { class: 'btn', onclick: function () { U.goto('/approvals'); } }, '审批中心'),
            h('button', { class: 'btn', onclick: function () { U.goto('/versions/' + cur.agreement_no); } }, '查看版本时间轴')
          ])
        ]), { ref: '5.8' }));

        resultBox.appendChild(U.card('影子流水抽样（试算输出，不写入正式表）', U.pagedTable([
          { label: '流水号（影子）', render: function (f) { return h('span', { class: 'mono faint' }, f.fee_flow_no); } },
          { label: '事件', render: function (f) { return h('span', { class: 'mono' }, f.event_id); } },
          { label: '计费项', key: 'charge_item_name' },
          { label: '费用归属日', key: 'fee_date' },
          { label: '基数', num: true, render: function (f) { return M.fmt(f.basis_amount); } },
          { label: '费用（含税）', num: true, render: function (f) { return U.money(f.fee_amount); } },
          { label: '验算', render: function (f) { return h('span', { class: 'faint mono', style: 'font-size:11px' }, f.calc_detail ? f.calc_detail.expr : ''); } }
        ], t.flowsNew, { compact: true, pageSize: 12 }), { tight: true, ref: '5.7.2' }));
      }
    }
  });
})();
