/* =============================================================================
 * views-dispute.js —— 模块④ 账单中心 · 争议工作台（PRD 7.7）
 * 资金方提出 → 系统自动定位（核查包）→ 运营核查 → 三分支结论 → 资金方确认 → 闭环
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money;
  var U = UI;

  function st(code) {
    var m = Dispute.STATUS_META[code] || { name: code, cls: '' };
    return h('span', { class: 'badge dot ' + m.cls }, m.name);
  }
  function slaBadge(sla) {
    if (sla.closed) return h('span', { class: 'badge ok' }, '已闭环 · 用时 ' + sla.elapsed + ' 工作日');
    var cls = sla.level === 'BIZ' ? 'danger' : (sla.level === 'FIN' ? 'danger' : (sla.level === 'CHECK' ? 'warn' : 'ok'));
    var txt = sla.remain >= 0 ? '剩余 ' + sla.remain + ' 工作日' : '超期 ' + (-sla.remain) + ' 工作日';
    return h('span', { class: 'badge ' + cls }, txt);
  }

  UI.route('disputes', {
    title: '争议工作台', crumbs: ['模块④', '账单中心', '争议工作台'],
    render: function (root, params) {
      var S = Store.get();

      root.appendChild(U.pageHead('争议工作台',
        '每种争议类型都有一条<b>确定的定位路径</b> —— 系统按类型自动拉数生成<b>核查包</b>，' +
        '运营拿着核查包给结论，而不是从零开始翻 Excel。' +
        '全流程 SLA <b>T+5 工作日</b>；T+2 完成核查，T+3 未闭环升级财务负责人，T+5 未闭环升级业务负责人并进入月度质量复盘。'));
      root.appendChild(ViewsBill.subnav('disputes'));

      /* ---------- 概览 ---------- */
      var open = S.disputes.filter(function (d) { return d.status !== 'CLOSED'; });
      var slas = S.disputes.map(function (d) { return { d: d, sla: Dispute.slaOf(S, d) }; });
      var overdue = slas.filter(function (x) { return !x.sla.closed && (x.sla.level === 'FIN' || x.sla.level === 'BIZ'); });
      var closed = S.disputes.filter(function (d) { return d.status === 'CLOSED'; });
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('在途争议', String(open.length),
          M.fmt(M.sum(open, function (d) { return d.disputed_amount; })) + ' 元涉议', open.length ? 'warn' : 'ok'),
        U.stat('超期升级', String(overdue.length), 'T+3 升财务负责人 / T+5 升业务负责人',
          overdue.length ? 'danger' : 'ok'),
        U.stat('已闭环', String(closed.length),
          closed.length ? '平均用时 ' + (M.r2(M.sum(closed.map(function (d) { return Dispute.slaOf(S, d).elapsed; }),
            function (n) { return n; }) / closed.length)) + ' 工作日' : '—'),
        U.stat('争议类型', String(Dispute.TYPES.length), '每种都有确定的定位路径')
      ]));

      if (overdue.length) {
        root.appendChild(U.alertBox('danger', '有 <b>' + overdue.length + '</b> 单争议已超 SLA：' +
          overdue.map(function (x) {
            return x.d.dispute_no + '（' + x.sla.levelName + '）';
          }).join('；') + '。争议不是「等资金方回话」就能拖过去的 —— 超期本身就是运营质量问题。'));
      }

      /* ---------- 争议单（按 SLA 剩余时间排序） ---------- */
      var rows = slas.slice().sort(function (a, b) {
        if (a.sla.closed !== b.sla.closed) return a.sla.closed ? 1 : -1;
        return a.sla.remain - b.sla.remain;
      });
      root.appendChild(U.card('争议单 · 按 SLA 剩余时间排序', h('div', null, [
        U.table([
          { label: '争议单号', render: function (x) { return h('span', { class: 'mono', style: 'font-size:11px' }, x.d.dispute_no); } },
          { label: '账单', render: function (x) { return U.link(x.d.bill_no, '/bill/' + x.d.bill_no, 'mono'); } },
          { label: '资金方', render: function (x) { return (S.partnerMap[x.d.partner_no] || {}).partner_short_name; } },
          { label: '争议类型', render: function (x) {
            var t = Dispute.TYPE_BY_CODE[x.d.dispute_type];
            return h('div', null, [h('div', null, t ? t.name : x.d.dispute_type),
              h('div', { class: 'faint', style: 'font-size:11px' }, t ? t.path : '')]);
          } },
          { label: '涉议金额', num: true, render: function (x) { return M.fmt(x.d.disputed_amount); } },
          { label: '核查包', render: function (x) {
            return x.d.locate ? U.badge('已生成', 'ok') : U.badge('未生成', 'warn');
          }, width: '80px' },
          { label: '结论', render: function (x) {
            var m = Dispute.RESOLUTION_BY_CODE[x.d.resolution];
            return m ? U.badge(m.name, m.cls) : h('span', { class: 'faint' }, '—');
          }, width: '150px' },
          { label: '已耗 / SLA', render: function (x) {
            return h('div', null, [slaBadge(x.sla),
              h('div', { class: 'faint', style: 'font-size:11px' },
                '已耗 ' + x.sla.elapsed + ' / ' + Dispute.SLA.TOTAL_DAYS + ' 工作日')]);
          }, width: '150px' },
          { label: '升级', render: function (x) {
            return x.d.escalated_to
              ? U.badge(x.d.escalated_to === 'BIZ_MGR' ? '业务负责人' : '财务负责人', 'danger')
              : h('span', { class: 'faint' }, '—');
          }, width: '90px' },
          { label: '状态', render: function (x) { return st(x.d.status); }, width: '130px' },
          { label: '', width: '70px', render: function (x) {
            return h('button', { class: 'btn btn-sm btn-primary', onclick: function (e) { e.stopPropagation(); detail(x.d); } }, '处理');
          } }
        ], rows, { compact: true, empty: '暂无争议单', onRow: function (x) { detail(x.d); } }),
        h('div', { class: 'btn-row mt8' }, [
          h('button', {
            class: 'btn', disabled: !Store.can('dispute.handle'),
            onclick: function () {
              var made = Store.Actions.escalateDisputes();
              UI.toast(made.length ? '已按 SLA 升级 ' + made.length + ' 单' : '当前无需升级的争议单',
                made.length ? 'warn' : '');
              App.rerender();
            }
          }, '执行 SLA 超时升级检查'),
          h('button', {
            class: 'btn', disabled: !Store.can('dispute.handle'),
            onclick: function () { newModal(); }
          }, '模拟：资金方提出争议')
        ])
      ]), { ref: '7.7.1' }));

      /* ---------- 处理流程与 SLA ---------- */
      root.appendChild(U.card('处理流程与 SLA', h('div', null, [
        h('div', { class: 'steps' }, [
          ['资金方提出', 'T'], ['系统自动定位', 'T+0'], ['运营核查', 'T+2 内'],
          ['出具结论', '三分支'], ['资金方确认', ''], ['闭环', 'T+5 内']
        ].map(function (x, i) {
          return h('div', { class: 'step' }, [h('span', { class: 'n' }, i + 1),
            h('div', null, [h('div', null, x[0]), x[1] ? h('div', { class: 'faint', style: 'font-size:11px' }, x[1]) : null])]);
        })),
        h('div', { class: 'mt14' }, U.table([
          { label: '结论分支', render: function (r) { return U.badge(r.name, r.cls); }, width: '170px' },
          { label: '后续动作', render: function (r) { return r.next; } },
          { label: '说明', render: function (r) { return h('span', { class: 'faint' }, r.desc); } }
        ], Dispute.RESOLUTIONS, { compact: true })),
        U.alertBox('warn', '<b>超时升级不是摆设</b>：T+3 未闭环自动升级至财务负责人，T+5 未闭环升级至业务负责人' +
          '并进入月度质量复盘。争议单的 SLA 计时从资金方提出那天开始，<b>按工作日计</b>，不因为「在等对方回复」而暂停。')
      ]), { ref: '7.7.3' }));

      /* ---------- 争议类型与定位路径 ---------- */
      root.appendChild(U.card('争议类型与定位路径', U.table([
        { label: '类型', render: function (t) { return t.name; }, width: '120px' },
        { label: '典型表现', render: function (t) { return t.symptom; } },
        { label: '定位路径', render: function (t) { return h('span', { class: 'faint' }, t.path); } }
      ], Dispute.TYPES, { compact: true }), { tight: true, ref: '7.7.2' }));

      if (params.id) {
        var t = Store.Actions.findDispute(params.id);
        if (t) setTimeout(function () { detail(t); }, 60);
      }

      /* =============== 争议详情与处理 =============== */
      function detail(d) {
        var sla = Dispute.slaOf(S, d);
        var type = Dispute.TYPE_BY_CODE[d.dispute_type] || {};
        var bill = S.billMap[d.bill_no] || {};
        var body = h('div');

        body.appendChild(U.kv([
          ['争议单号', h('span', { class: 'mono' }, d.dispute_no)],
          ['账单 / 账期', U.link(d.bill_no, '/bill/' + d.bill_no, 'mono')],
          ['资金方', (S.partnerMap[d.partner_no] || {}).partner_short_name],
          ['争议类型', type.name + '　' + (type.symptom || '')],
          ['涉议金额', M.fmt(d.disputed_amount)],
          ['提出日期', d.create_time],
          ['SLA 截止', d.sla_deadline + '（T+' + Dispute.SLA.TOTAL_DAYS + ' 工作日）'],
          ['当前状态', st(d.status)]
        ], 'kv-2col'));

        body.appendChild(U.alertBox(sla.level === 'NORMAL' || sla.closed ? 'info' : 'danger',
          '<b>SLA：</b>已耗 ' + sla.elapsed + ' 个工作日 / 共 ' + Dispute.SLA.TOTAL_DAYS + ' 个；' +
          '核查时限 ' + sla.checkDeadline + '，闭环时限 ' + sla.deadline + '。' + sla.levelName +
          (d.escalated_to ? '　<b>已升级至' + (d.escalated_to === 'BIZ_MGR' ? '业务负责人' : '财务负责人') + '</b>' : '')));

        body.appendChild(h('h3', { class: 'sec' }, ['资金方主张']));
        body.appendChild(U.alertBox('warn', Core.esc(d.partner_claim)));
        if (d.evidence_urls.length) {
          body.appendChild(h('div', { class: 'faint mt8' }, '对方举证材料：' + d.evidence_urls.join('、')));
        }

        /* ---------- 自动定位核查包 ---------- */
        body.appendChild(h('h3', { class: 'sec' }, ['自动定位核查包', h('span', { class: 'tag-ref' }, '7.7.2 / 7.7.3')]));
        if (!d.locate) {
          body.appendChild(U.alertBox('warn',
            '尚未生成核查包。<b>系统定位应在 T+0 完成</b> —— 按争议类型「' + type.name + '」' + type.path + '。'));
          body.appendChild(h('button', {
            class: 'btn btn-primary mt8', disabled: !Store.can('dispute.handle'),
            onclick: function () {
              var r = Store.Actions.locateDispute(d.dispute_no);
              if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
              U.closeModal(); UI.toast('核查包已生成：' + r.locate.steps.length + ' 条判定', 'ok');
              App.rerender();
              setTimeout(function () { detail(Store.Actions.findDispute(d.dispute_no)); }, 120);
            }
          }, '执行自动定位'));
        } else {
          var lc = d.locate;
          var steps = h('div', { class: 'checklist' });
          lc.steps.forEach(function (s2) {
            steps.appendChild(h('div', { class: 'ck ' + (s2.ok ? 'ok' : 'no') }, [
              h('span', { class: 'ck-i' }, s2.ok ? '✓' : '✕'),
              h('div', null, [h('div', { html: s2.text }),
                s2.detail ? h('div', { class: 'faint', html: s2.detail }) : null])
            ]));
          });
          body.appendChild(steps);
          body.appendChild(h('div', { class: 'mt8' }, U.alertBox('info',
            '<b>核查结论：</b>' + lc.conclusion)));
          body.appendChild(h('div', { class: 'mt8' }, U.alertBox('ok',
            '<b>系统建议：</b>' + Dispute.RESOLUTION_BY_CODE[lc.suggest].name +
            ' —— ' + Dispute.RESOLUTION_BY_CODE[lc.suggest].next +
            '。<b>建议只是建议</b>，结论由运营给出并留痕。')));
          body.appendChild(h('div', { class: 'btn-row mt8' }, lc.refs.map(function (r) {
            return h('button', { class: 'btn btn-sm', onclick: function () { U.closeModal(); U.goto(r.link); } }, r.label);
          })));
        }

        /* ---------- 我方举证材料 ---------- */
        if (d.our_evidence && d.our_evidence.length) {
          body.appendChild(h('h3', { class: 'sec' }, ['我方举证材料']));
          body.appendChild(U.table([
            { label: '材料', render: function (e) { return e.label; } },
            { label: '链接', render: function (e) { return h('span', { class: 'mono faint', style: 'font-size:11px' }, e.url); } },
            { label: '上传时间', render: function (e) { return e.time; }, width: '135px' }
          ], d.our_evidence, { compact: true }));
        }

        /* ---------- 操作区 ---------- */
        var opBox = h('div', { class: 'mt14' });
        body.appendChild(opBox);
        drawOps();

        function drawOps() {
          opBox.innerHTML = '';
          var canDo = Store.can('dispute.handle');

          if (d.status === 'CLOSED') {
            var rm = Dispute.RESOLUTION_BY_CODE[d.resolution];
            opBox.appendChild(U.alertBox('ok', '<b>已闭环</b>（' + (rm ? rm.name : '') + '）：' + Core.esc(d.conclusion) +
              '　确认人 ' + d.confirm_by + '　' + (d.close_time || '').slice(0, 16) +
              (d.adjustment_no ? '　调整项 ' + d.adjustment_no : '') +
              (d.recalc_task_no ? '　重算任务 ' + d.recalc_task_no : '')));
            return;
          }

          /* 待资金方确认 */
          if (d.status === 'CONCLUDED') {
            var rm2 = Dispute.RESOLUTION_BY_CODE[d.resolution];
            opBox.appendChild(h('h3', { class: 'sec' }, ['资金方确认', h('span', { class: 'tag-ref' }, '7.7.3')]));
            opBox.appendChild(U.alertBox('purple', '<b>已出结论：' + rm2.name + '</b><br>' + Core.esc(d.conclusion) +
              (d.statement_url ? '<br>说明材料：' + d.statement_url : '') +
              (d.adjustment_no ? '<br>已生成调整项 <b>' + d.adjustment_no + '</b>，需走审批后计入下期账单' : '') +
              (d.recalc_task_no ? '<br>已发起范围重算 <b>' + d.recalc_task_no + '</b>，差额将计入下期调整项' : '')));
            var note = h('input', { type: 'text', placeholder: '资金方反馈', style: 'min-width:300px' });
            opBox.appendChild(h('div', { class: 'inline-form' }, [
              U.field('资金方反馈', note),
              h('button', {
                class: 'btn btn-ok', onclick: function () {
                  var r = Store.Actions.confirmDispute(d.dispute_no, true, note.value.trim());
                  if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
                  U.closeModal(); UI.toast('争议已闭环', 'ok', d.dispute_no); App.rerender();
                }
              }, '模拟：资金方认可 → 闭环'),
              h('button', {
                class: 'btn btn-danger', onclick: function () {
                  var r = Store.Actions.confirmDispute(d.dispute_no, false, note.value.trim());
                  if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
                  U.closeModal(); UI.toast('资金方不认可，已退回重新核查', 'danger'); App.rerender();
                }
              }, '模拟：资金方不认可 → 退回核查')
            ]));
            return;
          }

          /* 出结论 */
          opBox.appendChild(h('h3', { class: 'sec' }, ['出具结论', h('span', { class: 'tag-ref' }, '7.7.3')]));
          if (!d.locate) {
            opBox.appendChild(U.alertBox('warn', '<b>未生成核查包不得出结论</b> —— 结论必须建立在可出示的判定过程之上，而不是印象。'));
          }
          var res = d.locate ? d.locate.suggest : 'MAINTAIN';
          var opinion = h('textarea', { rows: '3', style: 'width:100%',
            placeholder: '核查结论（默认取核查包结论，可修改）' });
          if (d.locate) opinion.value = d.locate.conclusion.replace(/<[^>]+>/g, '');
          var amtInput = h('input', { type: 'number', step: '0.01', style: 'max-width:180px',
            value: String(-Math.abs(d.disputed_amount)) });
          var amtRow = h('div', { class: 'inline-form mt8' }, [
            U.field('调整金额（负数为冲减）', amtInput),
            h('span', { class: 'faint' }, '将生成调整项计入下期账单（D-06）')
          ]);
          amtRow.hidden = res !== 'OUR_ERROR';

          opBox.appendChild(h('div', { class: 'inline-form' }, [
            U.field('结论分支', U.selectEl(Dispute.RESOLUTIONS.map(function (r) {
              return { value: r.code, label: r.name + '　→　' + r.next };
            }), res, function (v) { res = v; amtRow.hidden = v !== 'OUR_ERROR'; }))
          ]));
          opBox.appendChild(h('div', { class: 'mt8' }, U.field('核查结论', opinion)));
          opBox.appendChild(amtRow);
          opBox.appendChild(h('div', { class: 'btn-row mt8' }, [
            h('button', {
              class: 'btn btn-primary', disabled: !canDo || !d.locate,
              onclick: function () {
                var r = Store.Actions.concludeDispute(d.dispute_no, res, opinion.value.trim(),
                  res === 'OUR_ERROR' ? amtInput.value : null);
                if (!r.ok) { UI.toast(r.msg.replace(/<[^>]+>/g, ''), 'danger'); return; }
                U.closeModal();
                UI.toast('结论已出具：' + r.meta.name + '　' + r.meta.next, 'ok');
                App.rerender();
              }
            }, '出具结论'),
            (function () {
              var ev = h('input', { type: 'text', placeholder: '材料名称', style: 'min-width:200px' });
              return h('span', { class: 'inline-form' }, [
                ev,
                h('button', {
                  class: 'btn', disabled: !canDo, onclick: function () {
                    var r = Store.Actions.addDisputeEvidence(d.dispute_no, ev.value.trim(), 'OURS');
                    if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
                    U.closeModal(); UI.toast('已补充举证材料', 'ok'); App.rerender();
                  }
                }, '补充我方举证材料')
              ]);
            })()
          ]));
        }

        /* ---------- 处理留痕 ---------- */
        if (d.logs && d.logs.length) {
          body.appendChild(h('h3', { class: 'sec' }, ['处理留痕', h('span', { class: 'tag-ref' }, '14.5')]));
          body.appendChild(U.table([
            { label: '时间', render: function (l) { return l.time.replace('T', ' ').slice(0, 16); }, width: '135px' },
            { label: '操作方', render: function (l) { return l.actor; }, width: '110px' },
            { label: '动作', render: function (l) { return l.action; }, width: '120px' },
            { label: '说明', render: function (l) { return h('span', { class: 'faint' }, l.detail); } }
          ], d.logs, { compact: true }));
        }

        U.modal('争议单 ' + d.dispute_no, body,
          [h('button', { class: 'btn', onclick: function () { U.closeModal(); U.goto('/bill/' + d.bill_no); } }, '查看账单'),
           h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'wide' });
      }

      /* =============== 模拟资金方提出争议 =============== */
      function newModal() {
        var bills = S.bills.filter(function (b) { return b.status !== 'VOIDED'; });
        var billNo = bills[0] ? bills[0].bill_no : '';
        var type = 'CALIBER';
        var amt = h('input', { type: 'number', step: '0.01', value: '5000', style: 'max-width:180px' });
        var claim = h('textarea', { rows: '3', style: 'width:100%', placeholder: '资金方主张' });
        claim.value = '对本期账单金额存在异议，请说明计算口径。';
        var body = h('div', null, [
          U.alertBox('info', '争议提出后<b>账单转入争议中</b>，SLA 从今日起按工作日计时。'),
          h('div', { class: 'inline-form' }, [
            U.field('账单', U.selectEl(bills.map(function (b) {
              return { value: b.bill_no, label: b.bill_no + '　' + (S.partnerMap[b.partner_no] || {}).partner_short_name +
                '　' + M.fmt(b.total_amount) };
            }), billNo, function (v) { billNo = v; })),
            U.field('争议类型', U.selectEl(Dispute.TYPES.map(function (t) {
              return { value: t.code, label: t.name + '　（' + t.path + '）' };
            }), type, function (v) { type = v; })),
            U.field('涉议金额', amt)
          ]),
          h('div', { class: 'mt8' }, U.field('资金方主张', claim))
        ]);
        U.modal('模拟：资金方提出争议', body, [
          h('button', {
            class: 'btn btn-primary', onclick: function () {
              var d = Store.Actions.disputeBill(billNo, claim.value.trim(), Number(amt.value), type);
              U.closeModal();
              UI.toast('已登记争议 ' + d.dispute_no + '，SLA 截止 ' + d.sla_deadline, 'warn');
              App.rerender();
              setTimeout(function () { detail(d); }, 150);
            }
          }, '提交争议'),
          h('button', { class: 'btn', onclick: U.closeModal }, '取消')
        ], { size: 'wide' });
      }
    }
  });
})();
