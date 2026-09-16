/* =============================================================================
 * views-calendar.js —— 模块④ 账单中心 · 出账日历（PRD 7.2.2 / 7.4.2 / 7.9）
 * 月视图排期 + 超期未确认策略执行
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  UI.route('calendar', {
    title: '出账日历', crumbs: ['模块④', '账单中心', '出账日历'],
    render: function (root, params) {
      var S = Store.get();
      var ym = params.m || S.simToday.slice(0, 7);

      root.appendChild(U.pageHead('出账日历',
        '五家资金方的封账日、出账日、确认截止日、结算日<b>各不相同</b>，靠人记必然漏。' +
        '系统按协议版本的 <code>settle_day_rule</code> 自动生成未来 12 个月排期，' +
        '并按 <b>NEXT_WORKDAY</b> 规则跳过周末与法定节假日 —— 顺延是<b>逐级</b>的：' +
        '出账被假期推后，确认截止与结算日一并后移，不挤占资金方的核对时间。'));
      root.appendChild(ViewsBill.subnav('calendar'));

      /* ---------- 概览 ---------- */
      var overdue = Cal.overdueBills(S);
      var dueSoon = Cal.dueSoonBills(S);
      var confirming = S.bills.filter(function (b) { return b.status === 'CONFIRMING'; });
      var held = S.bills.filter(function (b) { return b.hold_flag; });
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('待资金方确认', String(confirming.length),
          M.fmt(M.sum(confirming, function (b) { return b.total_amount; })) + ' 元', confirming.length ? 'warn' : ''),
        U.stat('已超确认截止', String(overdue.length), '需按协议策略处理', overdue.length ? 'danger' : 'ok'),
        U.stat('即将到期', String(dueSoon.length), '剩余 ≤ 1 个工作日', dueSoon.length ? 'warn' : ''),
        U.stat('挂起未结算', String(held.length), '协议无默认确认条款', held.length ? 'danger' : '')
      ]));

      /* ---------- 月视图 ---------- */
      var byDate = Cal.monthMap(S, ym, 4);
      var cells = Cal.monthGrid(ym);
      var cal = h('div', { class: 'mcal' });
      ['一', '二', '三', '四', '五', '六', '日'].forEach(function (w) {
        cal.appendChild(h('div', { class: 'mcal-h' }, w));
      });
      cells.forEach(function (dt) {
        if (!dt) { cal.appendChild(h('div', { class: 'mcal-d empty' })); return; }
        var dow = D.parse(dt).getDay();
        var hol = Data.HOLIDAYS[dt];
        var isOff = dow === 0 || dow === 6 || hol;
        var items = byDate[dt] || [];
        var cell = h('div', { class: 'mcal-d' + (isOff ? ' off' : '') + (dt === S.simToday ? ' today' : '') }, [
          h('div', { class: 'mcal-n' }, [
            h('span', null, String(+dt.slice(8))),
            hol ? h('span', { class: 'mcal-hol' }, hol) : null,
            dt === S.simToday ? h('span', { class: 'mcal-hol' }, '今日') : null
          ])
        ]);
        items.forEach(function (it) {
          cell.appendChild(h('div', {
            class: 'mcal-e ' + it.m.cls, title: it.name + ' · ' + it.period + ' ' + it.m.name,
            onclick: function () { dayModal(dt, byDate[dt]); }
          }, [h('b', null, it.m.short), ' ' + it.name]));
        });
        cal.appendChild(cell);
      });

      function shiftMonth(n) {
        var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + n;
        while (m < 1) { m += 12; y--; }
        while (m > 12) { m -= 12; y++; }
        return y + '-' + Core.pad(m, 2);
      }
      root.appendChild(U.card(Core.D.cnPeriod(ym) + ' 出账排期', h('div', null, [
        h('div', { class: 'btn-row mb8' }, [
          h('button', { class: 'btn btn-sm', onclick: function () { U.goto('/calendar?m=' + shiftMonth(-1)); } }, '← 上月'),
          h('button', { class: 'btn btn-sm', onclick: function () { U.goto('/calendar?m=' + S.simToday.slice(0, 7)); } }, '回到本月'),
          h('button', { class: 'btn btn-sm', onclick: function () { U.goto('/calendar?m=' + shiftMonth(1)); } }, '下月 →'),
          h('span', { class: 'faint', style: 'margin-left:12px' },
            Object.keys(Cal.MILESTONES).map(function (k) {
              var m = Cal.MILESTONES[k];
              return m.short + '=' + m.name;
            }).join('　'))
        ]),
        cal
      ]), { ref: '7.2.2' }));

      /* ---------- 超期未确认 ---------- */
      root.appendChild(U.card('超期未确认处理', h('div', null, [
        U.table([
          { label: '策略', render: function (p) { return U.badge(p.name, p.cls); }, width: '130px' },
          { label: '编码', render: function (p) { return h('span', { class: 'mono' }, p.code); }, width: '130px' },
          { label: '说明', render: function (p) { return h('span', { html: p.desc }); } },
          { label: '适用前提', render: function (p) { return h('span', { class: 'faint', html: p.caution }); } }
        ], Data.CONFIRM_POLICIES, { compact: true }),
        U.alertBox('warn', '<b>默认确认不是系统的便利，是合同的授权。</b>' +
          '「超期视同确认」把商务风险转移给了资金方，没有条款支持就用，一旦发生争议我方毫无立场 —— ' +
          '所以策略配在<b>协议级</b>，并要求登记条款依据；未约定时缺省为挂起。'),
        h('div', { class: 'mt14' }, U.table([
          { label: '资金方', render: function (r) { return (S.partnerMap[r.partner_no] || {}).partner_short_name; } },
          { label: '协议', render: function (r) { return h('span', { class: 'mono' }, r.agreement_no); } },
          { label: '确认策略', render: function (r) {
            var p = Cal.confirmPolicy(S, r.agreement_no);
            return U.badge(p.meta.name, p.meta.cls);
          }, width: '130px' },
          { label: '条款依据', render: function (r) {
            return h('span', { class: 'faint' }, Cal.confirmPolicy(S, r.agreement_no).clause);
          } }
        ], S.agreements.filter(function (a) { return a.status === 'EFFECTIVE'; }), { compact: true })),
        overdue.length ? h('div', { class: 'mt14' }, [
          U.alertBox('danger', '有 <b>' + overdue.length + '</b> 张账单已超确认截止日：' +
            overdue.map(function (x) {
              return x.bill.bill_no + '（超 ' + x.overdueDays + ' 工作日，策略 ' + x.policy.meta.name + '）';
            }).join('；')),
          U.table([
            { label: '账单', render: function (x) { return U.link(x.bill.bill_no, '/bill/' + x.bill.bill_no, 'mono'); } },
            { label: '资金方', render: function (x) { return (S.partnerMap[x.bill.partner_no] || {}).partner_short_name; } },
            { label: '推送时间', render: function (x) { return (x.bill.push_time || '').slice(0, 10) || '—'; }, width: '110px' },
            { label: '确认截止', render: function (x) { return x.bill.calendar.confirm_deadline; }, width: '110px' },
            { label: '超期', num: true, render: function (x) { return h('span', { class: 'neg' }, x.overdueDays + ' 工作日'); }, width: '90px' },
            { label: '金额', num: true, render: function (x) { return M.fmt(x.bill.total_amount); } },
            { label: '将执行', render: function (x) { return U.badge(x.policy.meta.name, x.policy.meta.cls); }, width: '130px' }
          ], overdue, { compact: true })
        ]) : U.alertBox('ok', '当前没有超过确认截止日仍未回执的账单。'),
        h('div', { class: 'btn-row mt8' }, [
          h('button', {
            class: 'btn btn-primary', disabled: !overdue.length || !Store.can('bill.generate'),
            onclick: function () {
              var r = Store.Actions.runConfirmDeadline();
              var auto = r.filter(function (x) { return x.action === 'AUTO_CONFIRM'; }).length;
              var hold = r.length - auto;
              UI.toast('已处理 ' + r.length + ' 张：默认确认 ' + auto + ' 张，挂起升级 ' + hold + ' 张',
                hold ? 'warn' : 'ok');
              App.rerender();
            }
          }, '执行超期未确认策略'),
          h('button', { class: 'btn', onclick: function () { U.goto('/bills?status=CONFIRMING'); } }, '查看待确认账单')
        ])
      ]), { ref: '7.4.2' }));

      if (held.length) {
        root.appendChild(U.card('挂起中的账单（不得进入结算）', U.table([
          { label: '账单', render: function (b) { return U.link(b.bill_no, '/bill/' + b.bill_no, 'mono'); } },
          { label: '资金方', render: function (b) { return (S.partnerMap[b.partner_no] || {}).partner_short_name; } },
          { label: '挂起自', render: function (b) { return b.hold_since; }, width: '110px' },
          { label: '升级至', render: function (b) {
            return U.badge(b.escalate_level === 'BIZ_MGR' ? '业务负责人' : '财务负责人', 'danger');
          }, width: '110px' },
          { label: '金额', num: true, render: function (b) { return M.fmt(b.total_amount); } },
          { label: '状态', render: function (b) { return U.statusBadge(b.status); }, width: '100px' }
        ], held, { compact: true }), { tight: true, ref: '7.4.2' }));
      }

      /* ---------- 未来 12 个月排期表 ---------- */
      var sched = Cal.schedule(S, S.simToday.slice(0, 7), 12);
      root.appendChild(U.card('未来 12 个月账期排期（按协议）', U.pagedTable([
        { label: '账期', render: function (r) { return r.period; }, width: '80px' },
        { label: '资金方', render: function (r) { return (S.partnerMap[r.partner_no] || {}).partner_short_name; } },
        { label: '协议', render: function (r) { return h('span', { class: 'mono', style: 'font-size:11px' }, r.agreement_no); } },
        { label: '账期起止', render: function (r) { return r.cal.period_start + ' ~ ' + r.cal.period_end; } },
        { label: '封账日', render: function (r) { return r.cal.cutoff_date; }, width: '100px' },
        { label: '出账日', render: function (r) { return mark(r.cal.bill_gen_date); }, width: '110px' },
        { label: '确认截止', render: function (r) { return mark(r.cal.confirm_deadline); }, width: '110px' },
        { label: '结算日', render: function (r) { return mark(r.cal.settle_date); }, width: '110px' },
        { label: '确认策略', render: function (r) { return U.badge(r.policy.meta.name, r.policy.meta.cls); }, width: '120px' }
      ], sched, { compact: true, pageSize: 15 }), { ref: '7.2.2' }));

      root.appendChild(U.alertBox('info',
        '<b>PRD 7.2.2 的示例可在上表直接验证</b>：2026-04 账期封账 04-30，出账日本应为 05-01，' +
        '但 5/1–5/5 是劳动节，按 NEXT_WORKDAY 顺延至 <b>05-06</b>；确认截止随之为 <b>05-11</b>，结算日 <b>05-14</b>。'));

      function mark(dt) {
        var hol = Data.HOLIDAYS[dt];
        var dow = D.parse(dt).getDay();
        return h('span', null, [dt,
          hol ? h('span', { class: 'faint', style: 'font-size:11px' }, '（' + hol + '后）') :
            (dow === 1 ? h('span', { class: 'faint', style: 'font-size:11px' }, '') : null)]);
      }

      function dayModal(dt, items) {
        var body = h('div');
        var hol = Data.HOLIDAYS[dt];
        body.appendChild(U.kv([
          ['日期', dt + '　' + ['日', '一', '二', '三', '四', '五', '六'][D.parse(dt).getDay()]],
          ['性质', hol ? '法定节假日（' + hol + '）' : (D.isWeekend(dt) ? '周末' : '工作日')],
          ['当日事项', items.length + ' 项']
        ], 'kv-2col'));
        body.appendChild(h('div', { class: 'mt8' }, U.table([
          { label: '里程碑', render: function (i) { return U.badge(i.m.name, i.m.cls); }, width: '110px' },
          { label: '资金方', render: function (i) { return i.name; } },
          { label: '账期', render: function (i) { return i.period; }, width: '90px' },
          { label: '协议', render: function (i) { return h('span', { class: 'mono', style: 'font-size:11px' }, i.row.agreement_no); } },
          { label: '确认策略', render: function (i) { return U.badge(i.row.policy.meta.name, i.row.policy.meta.cls); }, width: '120px' }
        ], items, { compact: true })));
        U.modal('出账排期 · ' + dt, body,
          [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'wide' });
      }
    }
  });
})();
