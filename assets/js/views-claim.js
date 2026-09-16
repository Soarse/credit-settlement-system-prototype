/* =============================================================================
 * views-claim.js —— 模块⑤ 结算中心 · 收款认领工作台（PRD 8.5）
 * 入账流水 → 四级自动匹配 → 挂账 → 人工认领 → 二级复核 → 核销（L4→L5 收款侧落点）
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money;
  var U = UI;

  function st(code) {
    var m = Claim.STATUS_META[code] || { name: code, cls: '' };
    return h('span', { class: 'badge dot ' + m.cls }, m.name);
  }
  function levelBadge(lv) {
    if (!lv) return h('span', { class: 'faint' }, '未命中');
    var r = Claim.RULE_BY_LEVEL[lv];
    var cls = r.reliability === 'HIGH' ? 'ok' : (r.reliability === 'MEDIUM' ? 'warn' : 'danger');
    return h('span', { class: 'badge ' + cls }, '规则 ' + lv + ' · ' + (r.reliability === 'HIGH' ? '高' : r.reliability === 'MEDIUM' ? '中' : '低'));
  }

  UI.route('claim', {
    title: '收款认领', crumbs: ['模块⑤', '结算中心', '收款认领工作台'],
    render: function (root, params) {
      var S = Store.get();

      root.appendChild(U.pageHead('收款认领工作台',
        '应收方向的钱由<b>资金方主动划入</b>，我方不发付款指令。银行入账流水到达后按<b>四级优先级自动匹配</b>待收款结算单；' +
        '匹配不上的<b>挂账（suspense）</b>进入本工作台人工处理。<b>认领必须二级复核</b>，核销后才生成结算流水与回单 —— ' +
        '这是五级勾稽 L4→L5 在收款方向唯一的落点。'));
      root.appendChild(ViewsSettle.subnav('claim'));

      /* ---------- 概览 ---------- */
      var pend = S.inbounds.filter(function (i) { return i.status === 'SUSPENSE' || i.status === 'PENDING_REVIEW' || i.status === 'AUTO_MATCHED'; });
      var suspense = S.inbounds.filter(function (i) { return i.status === 'SUSPENSE'; });
      var overdue = suspense.filter(function (i) { return Claim.isOverdue(S, i); });
      var waiting = Claim.openReceiveOrders(S);
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('待收款结算单', String(waiting.length), M.fmt(M.sum(waiting, function (o) { return o.settle_amount; })) + ' 元'),
        U.stat('待处理入账', String(pend.length), M.fmt(M.sum(pend, function (i) { return i.amount; })) + ' 元'),
        U.stat('挂账笔数', String(suspense.length), '自动匹配未命中'),
        U.stat('挂账超期', String(overdue.length), '> ' + Claim.SUSPENSE_ALERT_DAYS + ' 个工作日即告警升级',
          overdue.length ? 'danger' : 'ok')
      ]));

      if (overdue.length) {
        root.appendChild(U.alertBox('danger', '有 <b>' + overdue.length + '</b> 笔款项挂账已超 ' +
          Claim.SUSPENSE_ALERT_DAYS + ' 个工作日：' + overdue.map(function (i) {
            return i.inbound_no + '（' + M.fmt(i.amount) + ' 元，已挂 ' + Claim.agingDays(S, i) + ' 个工作日）';
          }).join('；') + '。挂账不是中性状态 —— 钱在账上却没有归属，既影响勾稽也影响资金方对账。'));
      }

      /* ---------- 待收款结算单 ---------- */
      root.appendChild(U.card('待收款结算单', h('div', null, [
        U.table([
          { label: '结算单号', render: function (o) { return U.link(o.settle_no, '/settleorder/' + o.settle_no, 'mono'); } },
          { label: '资金方', render: function (o) { return (S.partnerMap[o.partner_no] || {}).partner_short_name; } },
          { label: '账期', render: function (o) { return o.billing_period; }, width: '80px' },
          { label: '待收金额', num: true, render: function (o) { return M.fmt(o.settle_amount); } },
          { label: '轧差', render: function (o) { return o.is_netting ? U.badge('轧差净额', 'purple') : '—'; }, width: '90px' },
          { label: '计划结算日', render: function (o) { return o.plan_settle_date; }, width: '100px' },
          { label: '', width: '150px', render: function (o) {
            return h('button', {
              class: 'btn btn-sm', disabled: !Store.can('settle.claim'),
              onclick: function (e) { e.stopPropagation(); simModal(o); }
            }, '模拟资金方划款到账');
          } }
        ], waiting, { compact: true, empty: '当前没有待收款结算单。应收方向的结算单在审批通过后进入「待收款」，需驱动 4 月账期出账与结算后才会出现。' }),
        waiting.length ? null : U.alertBox('info',
          '想完整体验四级匹配：先在<b>账单中心 → 出账工作台</b>对 2026-04 封账出账，推送并确认账单，' +
          '再到<b>结算中心</b>生成结算单并走完审批 —— 应收方向的结算单就会停在「待收款」，' +
          '回到本页用「模拟资金方划款到账」即可分别演示规则 1~4 与挂账。')
      ]), { ref: '8.5', tight: true }));

      /* ---------- 自动匹配规则 ---------- */
      root.appendChild(U.card('自动匹配规则 · 按优先级依次尝试', U.table([
        { label: '优先级', render: function (r) { return h('span', { class: 'mono' }, String(r.level)); }, width: '60px' },
        { label: '匹配依据', render: function (r) { return r.name; } },
        { label: '可靠性', render: function (r) {
          return U.badge(r.reliability === 'HIGH' ? '高' : r.reliability === 'MEDIUM' ? '中' : '低',
            r.reliability === 'HIGH' ? 'ok' : r.reliability === 'MEDIUM' ? 'warn' : 'danger');
        }, width: '70px' },
        { label: '处理', render: function (r) { return r.auto ? '自动核销（仍留双人复核痕迹）' : '自动匹配后必须人工确认'; } },
        { label: '说明', render: function (r) { return h('span', { class: 'faint' }, r.desc); } }
      ], Claim.RULES, { compact: true }), { tight: true, ref: '8.5.1' }));

      /* ---------- 入账流水 ---------- */
      var filter = params.f || 'ALL';
      var listBox = h('div');
      root.appendChild(U.card('银行入账流水', h('div', null, [
        h('div', { class: 'inline-form' }, [
          U.field('查看', U.selectEl([
            { value: 'ALL', label: '全部' },
            { value: 'PENDING', label: '仅待处理（挂账 / 待复核 / 待核销）' },
            { value: 'SUSPENSE', label: '仅挂账' },
            { value: 'CONFIRMED', label: '已核销' },
            { value: 'CLOSED', label: '非本系统 / 已退回' }
          ], filter, function (v) { U.goto('/claim?f=' + v); })),
          h('button', {
            class: 'btn', disabled: !Store.can('settle.claim'),
            onclick: function () { simModal(null); }
          }, '模拟：接收当日银行入账文件')
        ]),
        listBox
      ]), { ref: '8.5.2' }));
      drawList();

      function drawList() {
        listBox.innerHTML = '';
        var rows = S.inbounds.filter(function (i) {
          if (filter === 'ALL') return true;
          if (filter === 'PENDING') return ['SUSPENSE', 'PENDING_REVIEW', 'AUTO_MATCHED'].indexOf(i.status) >= 0;
          if (filter === 'CLOSED') return i.status === 'EXCLUDED' || i.status === 'RETURNED';
          return i.status === filter;
        });
        listBox.appendChild(h('div', { class: 'mt8' }, U.table([
          { label: '入账流水号', render: function (i) { return h('span', { class: 'mono', style: 'font-size:11px' }, i.inbound_no); } },
          { label: '入账日期', render: function (i) { return i.value_date; }, width: '95px' },
          { label: '付款方', render: function (i) {
            var pn = Claim.partnerOfAccount(S, i.payer_account);
            return h('div', null, [h('div', null, i.payer_name),
              h('div', { class: 'faint', style: 'font-size:11px' },
                pn ? '白名单账户 · ' + pn : '⚠ 不在任何资金方白名单')]);
          } },
          { label: '金额', num: true, render: function (i) { return M.fmt(i.amount); } },
          { label: '付款备注', render: function (i) { return h('span', { class: 'faint' }, i.remark || '—'); } },
          { label: '匹配', render: function (i) { return levelBadge(i.match_level); }, width: '110px' },
          { label: '关联结算单', render: function (i) {
            return i.settle_nos.length
              ? h('div', null, i.settle_nos.map(function (n) { return h('div', null, U.link(n, '/settleorder/' + n, 'mono')); }))
              : '—';
          } },
          { label: '挂账天数', num: true, render: function (i) {
            var d = Claim.agingDays(S, i);
            if (i.status === 'CONFIRMED' || i.status === 'EXCLUDED' || i.status === 'RETURNED') return '—';
            return h('span', { class: d > Claim.SUSPENSE_ALERT_DAYS ? 'neg' : '' }, d + ' 天');
          }, width: '85px' },
          { label: '状态', render: function (i) { return st(i.status); }, width: '120px' },
          { label: '', width: '70px', render: function (i) {
            return h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); detail(i); } }, '处理');
          } }
        ], rows, { compact: true, empty: '无记录', onRow: detail })));
      }

      /* ---------- 明细与处理 ---------- */
      function detail(inb) {
        var body = h('div');
        var pn = Claim.partnerOfAccount(S, inb.payer_account);
        body.appendChild(U.kv([
          ['入账流水号', h('span', { class: 'mono' }, inb.inbound_no)],
          ['银行流水号', h('span', { class: 'mono' }, inb.channel_serial_no)],
          ['入账日期', inb.value_date],
          ['到账金额', h('b', null, M.fmt(inb.amount) + ' ' + inb.currency)],
          ['付款方名称', inb.payer_name],
          ['付款方账户', h('span', { class: 'mono' }, inb.payer_account)],
          ['付款方开户行', inb.payer_bank],
          ['付款备注', inb.remark || '—'],
          ['账户归属', pn ? (S.partnerMap[pn] || {}).partner_short_name + '（白名单账户）' : '⚠ 不在任何资金方白名单账户中'],
          ['当前状态', st(inb.status)]
        ], 'kv-2col'));

        /* 匹配过程 */
        var r = Claim.autoMatch(S, inb);
        body.appendChild(h('h3', { class: 'sec' }, ['自动匹配过程（实时求值）', h('span', { class: 'tag-ref' }, '8.5.1')]));
        var steps = h('div', { class: 'checklist' });
        Claim.RULES.forEach(function (rule) {
          var hitHere = r.level === rule.level;
          var t = (r.tried || []).filter(function (x) { return x.level === rule.level; })[0];
          var passed = r.level && r.level < rule.level;
          steps.appendChild(h('div', { class: 'ck ' + (hitHere ? 'ok' : (passed ? '' : 'no')) }, [
            h('span', { class: 'ck-i' }, hitHere ? '✓' : (passed ? '·' : '✕')),
            h('div', null, [
              h('div', null, [h('b', null, '规则 ' + rule.level + '　' + rule.name)]),
              h('div', { class: 'faint' }, hitHere ? r.reason : (passed ? '前序规则已命中，不再尝试' : (t ? t.why : '未尝试')))
            ])
          ]));
        });
        body.appendChild(steps);
        if (!r.level) body.appendChild(U.alertBox('warn', r.reason +
          '。<b>挂账不等于丢失</b>：款项仍在我方账上，但没有归属，需人工在下方三选一处理。'));

        /* 金额差额 */
        if (inb.settle_nos.length) {
          var gap = Claim.amountGap(S, inb);
          body.appendChild(h('div', { class: 'mt8' }, U.kv([
            ['关联结算单应收合计', M.fmt(gap.expect)],
            ['实际到账', M.fmt(gap.actual)],
            ['差额', h('span', { class: gap.gap ? 'neg' : '' }, M.fmtSigned(gap.gap) +
              (gap.gap === 0 ? '' : (Math.abs(gap.gap) <= Claim.MATCH_TOLERANCE ? '（容差内，多为跨行手续费）' : '（超容差，需查明原因）')))]
          ], 'kv-2col')));
        }

        /* 操作区 */
        var opBox = h('div', { class: 'mt14' });
        body.appendChild(opBox);
        drawOps();

        function drawOps() {
          opBox.innerHTML = '';
          var canClaim = Store.can('settle.claim'), canReview = Store.can('settle.claim.review');

          if (inb.status === 'CONFIRMED' || inb.status === 'PARTIAL_SETTLED' || inb.status === 'EXCLUDED' || inb.status === 'RETURNED') {
            opBox.appendChild(U.alertBox(inb.status === 'CONFIRMED' ? 'ok' : (inb.status === 'PARTIAL_SETTLED' ? 'warn' : 'info'),
              inb.status === 'CONFIRMED'
                ? '款项已全额核销：结算流水与银行回单按实际到账生成。'
                : (inb.status === 'PARTIAL_SETTLED'
                  ? '款项已部分核销 ' + M.fmt(inb.applied_amount || 0) + ' 元。结算单保留剩余应收；未分配到账 ' +
                    M.fmt(inb.unallocated_amount || 0) + ' 元继续挂账。'
                : '款项已终态处理：' + Core.esc(inb.exclude_reason))));
            return;
          }

          /* ① 待复核 */
          if (inb.status === 'PENDING_REVIEW' || inb.status === 'AUTO_MATCHED') {
            var isSelf = inb.claim_by && inb.claim_by === S.role;
            var opinion = h('input', { type: 'text', placeholder: '复核意见', style: 'min-width:280px' });
            opBox.appendChild(h('h3', { class: 'sec' }, ['二级复核', h('span', { class: 'tag-ref' }, '8.5.2')]));
            opBox.appendChild(U.alertBox(isSelf ? 'warn' : 'info',
              isSelf ? '<b>认领人不得复核自己认领的款项</b>（双人复核强制）—— 请切换右上角角色为「财务复核」或「财务负责人」。'
                : '复核通过后即刻核销：生成结算流水 + 银行回单 → 结算单已完成 → 账单已结算。'));
            opBox.appendChild(h('div', { class: 'inline-form' }, [
              U.field('复核意见', opinion),
              h('button', {
                class: 'btn btn-ok', disabled: !canReview || isSelf,
                onclick: function () {
                  var res = Store.Actions.reviewClaim(inb.inbound_no, true, opinion.value.trim());
                  if (!res.ok) { UI.toast(res.msg, 'danger'); return; }
                  U.closeModal();
                  UI.toast('已按实际到账核销 ' + M.fmt(res.inbound.applied_amount) + ' 元；生成结算流水 ' +
                    res.made.length + ' 条、回单 ' + res.made.length + ' 张', 'ok', inb.inbound_no);
                  App.rerender();
                }
              }, '复核通过并核销'),
              h('button', {
                class: 'btn btn-danger', disabled: !canReview || isSelf,
                onclick: function () {
                  var res = Store.Actions.reviewClaim(inb.inbound_no, false, opinion.value.trim() || '关联关系存疑，退回重新认领');
                  if (!res.ok) { UI.toast(res.msg, 'danger'); return; }
                  UI.toast('已驳回，款项退回挂账', 'warn'); drawOps(); drawList();
                }
              }, '驳回')
            ]));
            return;
          }

          /* ② 挂账 → 人工三选一 */
          opBox.appendChild(h('h3', { class: 'sec' }, ['人工处理', h('span', { class: 'tag-ref' }, '8.5.2')]));
          var pool = Claim.openReceiveOrders(S, pn || undefined);
          if (!pool.length) pool = Claim.openReceiveOrders(S);
          var picked = {};
          (r.settle_nos || []).forEach(function (n) { picked[n] = 1; });

          var sumBox = h('div', { class: 'faint mt8' });
          function refreshSum() {
            var nos = Object.keys(picked).filter(function (k) { return picked[k]; });
            var tot = M.sum(nos.map(function (n) { return S.settleOrderMap[n]; }).filter(Boolean),
              function (o) { return Claim.remainingOf(o); });
            var diff = M.r2(inb.amount - tot);
            sumBox.innerHTML = '';
            sumBox.appendChild(h('span', null, '已选 ' + nos.length + ' 张，应收合计 ' + M.fmt(tot) +
              ' 元；到账 ' + M.fmt(inb.amount) + ' 元，差额 '));
            sumBox.appendChild(h('b', { class: diff === 0 ? '' : 'neg' }, M.fmtSigned(diff)));
          }

          if (pool.length) {
            var picker = h('div', { class: 'checklist' });
            pool.forEach(function (o) {
              var cb = h('input', { type: 'checkbox' });
              cb.checked = !!picked[o.settle_no];
              cb.addEventListener('change', function () { picked[o.settle_no] = cb.checked; refreshSum(); });
              picker.appendChild(h('label', { class: 'ck', style: 'cursor:pointer' }, [
                h('span', { class: 'ck-i' }, cb),
                h('div', null, [
                  h('div', null, [h('span', { class: 'mono' }, o.settle_no), '　',
                    (S.partnerMap[o.partner_no] || {}).partner_short_name, '　', o.billing_period]),
                  h('div', { class: 'faint' }, '应收 ' + M.fmt(o.settle_amount) + ' 元 · 已收 ' +
                    M.fmt(o.settled_amount || 0) + ' 元 · 剩余 ' + M.fmt(Claim.remainingOf(o)) + ' 元' +
                    (o.is_netting ? ' · 轧差净额' : ''))
                ])
              ]));
            });
            opBox.appendChild(picker);
            opBox.appendChild(sumBox);
            refreshSum();
            var note = h('input', { type: 'text', placeholder: '认领说明（如：资金方分两笔划付 / 扣减跨行手续费）', style: 'min-width:340px' });
            opBox.appendChild(h('div', { class: 'inline-form mt8' }, [
              U.field('认领说明', note),
              h('button', {
                class: 'btn btn-primary', disabled: !canClaim,
                onclick: function () {
                  var nos = Object.keys(picked).filter(function (k) { return picked[k]; });
                  var res = Store.Actions.claimInbound(inb.inbound_no, nos, note.value.trim());
                  if (!res.ok) { UI.toast(res.msg, 'danger'); return; }
                  UI.toast('已认领，等待二级复核（认领人 ' + S.role + ' 不可自复核）', 'ok');
                  drawOps(); drawList();
                }
              }, '认领并提交复核')
            ]));
          } else {
            opBox.appendChild(U.alertBox('info', '当前没有待收款结算单可供关联。若该笔款项确实与本系统无关，用下方两个终态动作处理。'));
          }

          var reason = h('input', { type: 'text', placeholder: '原因说明', style: 'min-width:300px' });
          opBox.appendChild(h('div', { class: 'inline-form mt14' }, [
            U.field('原因', reason),
            h('button', {
              class: 'btn', disabled: !canClaim,
              onclick: function () {
                var res = Store.Actions.excludeInbound(inb.inbound_no, reason.value.trim() || '付款方与本系统无业务关系，转财务其他往来处理');
                if (!res.ok) { UI.toast(res.msg, 'danger'); return; }
                U.closeModal(); UI.toast('已标记为非本系统款项', '', inb.inbound_no); App.rerender();
              }
            }, '标记为非本系统款项'),
            h('button', {
              class: 'btn btn-danger', disabled: !canClaim,
              onclick: function () {
                var res = Store.Actions.returnInbound(inb.inbound_no, reason.value.trim() || '款项性质无法确认，原路退回付款方');
                if (!res.ok) { UI.toast(res.msg, 'danger'); return; }
                U.closeModal(); UI.toast('已退回付款方', 'warn', inb.inbound_no); App.rerender();
              }
            }, '原路退回付款方')
          ]));
        }

        /* 处理留痕 */
        if (inb.logs.length) {
          body.appendChild(h('h3', { class: 'sec' }, ['处理留痕', h('span', { class: 'tag-ref' }, '14.5')]));
          body.appendChild(U.table([
            { label: '时间', render: function (l) { return l.time.replace('T', ' ').slice(0, 16); }, width: '135px' },
            { label: '操作人', render: function (l) { return l.actor; }, width: '110px' },
            { label: '动作', render: function (l) { return l.action; }, width: '110px' },
            { label: '说明', render: function (l) { return h('span', { class: 'faint' }, l.detail); } }
          ], inb.logs, { compact: true }));
        }

        U.modal('入账流水 ' + inb.inbound_no, body,
          [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'wide' });
      }

      /* ---------- 模拟到账 ---------- */
      function simModal(order) {
        var pool = Claim.openReceiveOrders(S);
        var sel = order ? order.settle_no : (pool[0] ? pool[0].settle_no : '');
        var scenario = order ? 'L1' : 'FOREIGN';
        var body = h('div');
        body.appendChild(U.alertBox('info',
          '模拟资金方划款到账，用于演示自动匹配的四个级别与挂账分支。生成的入账流水会立即跑一遍匹配规则。'));
        var opts = [
          { value: 'L1', label: '规则 1 · 备注含结算单号（高，自动核销）' },
          { value: 'L2', label: '规则 2 · 账户 + 金额精确匹配（高，自动核销）' },
          { value: 'L3', label: '规则 3 · 少到 0.01 元，容差内（中，需人工确认）' },
          { value: 'MISMATCH', label: '金额对不上任何待收单 → 挂账' },
          { value: 'FOREIGN', label: '付款方不在白名单 → 挂账（典型非本系统款项）' }
        ];
        body.appendChild(h('div', { class: 'inline-form' }, [
          U.field('目标结算单', U.selectEl(
            pool.map(function (o) {
              return { value: o.settle_no, label: o.settle_no + '　' + (S.partnerMap[o.partner_no] || {}).partner_short_name + '　' + M.fmt(o.settle_amount) };
            }).concat(pool.length ? [] : [{ value: '', label: '（暂无待收款结算单）' }]),
            sel, function (v) { sel = v; })),
          U.field('到账场景', U.selectEl(opts, scenario, function (v) { scenario = v; }))
        ]));
        U.modal('模拟资金方划款到账', body, [
          h('button', {
            class: 'btn btn-primary', onclick: function () {
              if (!sel && scenario !== 'FOREIGN') { UI.toast('当前没有待收款结算单，只能模拟「非白名单付款方」场景', 'warn'); return; }
              var inb = Store.Actions.simulateInbound(sel, scenario);
              U.closeModal();
              UI.toast(inb.match_level
                ? '已到账并命中规则 ' + inb.match_level + '：' + inb.match_reason
                : '已到账，自动匹配未命中，已挂账待认领', inb.match_level ? 'ok' : 'warn', inb.inbound_no);
              App.rerender();
            }
          }, '生成入账流水'),
          h('button', { class: 'btn', onclick: U.closeModal }, '取消')
        ]);
      }
    }
  });
})();
