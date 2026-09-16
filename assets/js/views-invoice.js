/* =============================================================================
 * views-invoice.js —— 模块④ 账单中心 · 发票管理（PRD 7.8 / 决策 D-08）
 * 开票申请 → 提交发票系统 → 回传结果 → 回写账单；红蓝票与调整项的对应；轧差与开票
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money;
  var U = UI;

  function st(code) {
    var m = Invoice.STATUS_META[code] || { name: code, cls: '' };
    return h('span', { class: 'badge dot ' + m.cls }, m.name);
  }
  function kindBadge(k) {
    var m = Invoice.KIND_META[k];
    return h('span', { class: 'badge ' + m.cls }, k === 'RED' ? '红字' : '蓝字');
  }

  UI.route('invoices', {
    title: '发票管理', crumbs: ['模块④', '账单中心', '发票管理'],
    render: function (root, params) {
      var S = Store.get();

      root.appendChild(U.pageHead('发票管理（价税分离与开票申请）',
        '系统内金额全部<b>价税分离三段式</b>存储，税额由<b>倒轧</b>得到以保证恒等；' +
        '账单经资金方确认后<b>自动生成开票申请</b>推送发票系统，开票结果回传后回写账单。' +
        '<b>开票由发票系统执行，本系统只负责算准与发起</b>（D-08）。'));
      root.appendChild(ViewsBill.subnav('invoices'));

      /* ---------- 概览 ---------- */
      var all = S.invoiceApplies;
      var issued = all.filter(function (a) { return a.status === 'ISSUED'; });
      var pending = all.filter(function (a) { return a.status === 'PENDING' || a.status === 'SUBMITTED'; });
      var reds = all.filter(function (a) { return a.kind === 'RED'; });
      root.appendChild(h('div', { class: 'grid g4' }, [
        U.stat('已开票', String(issued.length),
          M.fmt(M.sum(issued, function (a) { return a.amount; })) + ' 元（税额 ' +
          M.fmt(M.sum(issued, function (a) { return a.tax_amount; })) + '）'),
        U.stat('在途申请', String(pending.length), '待提交 / 已提交发票系统', pending.length ? 'warn' : ''),
        U.stat('红字发票', String(reds.length),
          M.fmt(Math.abs(M.sum(reds, function (a) { return a.amount; }))) + ' 元冲回', reds.length ? 'purple' : ''),
        U.stat('待开票账单', String(waitingBills().length), '已确认但尚未生成开票申请')
      ]));

      /* ---------- 待开票账单 ---------- */
      var wb = waitingBills();
      if (wb.length) {
        root.appendChild(U.card('待开票账单', h('div', null, [
          U.alertBox('info', '账单确认时会<b>自动</b>生成开票申请。此处列出因作废重开、校验未过等原因仍未开票的账单，可手工发起。'),
          U.table([
            { label: '账单号', render: function (b) { return U.link(b.bill_no, '/bill/' + b.bill_no, 'mono'); } },
            { label: '资金方', render: function (b) { return (S.partnerMap[b.partner_no] || {}).partner_short_name; } },
            { label: '账期', render: function (b) { return b.billing_period; }, width: '80px' },
            { label: '方向', render: function (b) { return b.direction === 'RECEIVABLE' ? U.badge('应收', 'ok') : U.badge('应付', 'warn'); }, width: '70px' },
            { label: '应结金额', num: true, render: function (b) { return M.fmt(b.total_amount); } },
            { label: '状态', render: function (b) { return U.statusBadge(b.status); }, width: '90px' },
            { label: '', width: '130px', render: function (b) {
              return h('button', { class: 'btn btn-sm btn-primary', disabled: !Store.can('invoice.apply'),
                onclick: function (e) { e.stopPropagation(); applyModal(b); } }, '生成开票申请');
            } }
          ], wb, { compact: true })
        ]), { tight: true, ref: '7.8.2' }));
      }

      /* ---------- 开票申请列表 ---------- */
      var filter = params.k || 'ALL';
      var rows = all.filter(function (a) {
        if (filter === 'ALL') return true;
        if (filter === 'OPEN') return a.status === 'PENDING' || a.status === 'SUBMITTED' || a.status === 'FAILED';
        return a.status === filter || a.kind === filter;
      });
      root.appendChild(U.card('开票申请', h('div', null, [
        h('div', { class: 'inline-form' }, [
          U.field('查看', U.selectEl([
            { value: 'ALL', label: '全部' }, { value: 'OPEN', label: '在途（待提交 / 已提交 / 失败）' },
            { value: 'ISSUED', label: '已开票' }, { value: 'RED', label: '仅红字发票' },
            { value: 'BLUE', label: '仅蓝字发票' }, { value: 'VOIDED', label: '已作废' }
          ], filter, function (v) { U.goto('/invoices?k=' + v); }))
        ]),
        h('div', { class: 'mt8' }, U.pagedTable([
          { label: '申请单号', render: function (a) { return h('span', { class: 'mono', style: 'font-size:11px' }, a.apply_no); } },
          { label: '票种', render: function (a) { return kindBadge(a.kind); }, width: '60px' },
          { label: '账单 / 账期', render: function (a) {
            return h('div', null, [U.link(a.bill_no, '/bill/' + a.bill_no, 'mono'),
              h('div', { class: 'faint', style: 'font-size:11px' }, a.billing_period)]);
          } },
          { label: '销方 → 购方', render: function (a) {
            return h('div', null, [
              h('div', null, short(a.seller.title)),
              h('div', { class: 'faint', style: 'font-size:11px' }, '→ ' + short(a.buyer.title))]);
          } },
          { label: '价税合计', num: true, render: function (a) {
            return h('span', { class: a.amount < 0 ? 'neg' : '' }, M.fmt(a.amount));
          } },
          { label: '不含税', num: true, render: function (a) { return M.fmt(a.amount_ex_tax); } },
          { label: '税额', num: true, render: function (a) { return M.fmt(a.tax_amount); } },
          { label: '发票号码', render: function (a) {
            return a.invoice_no ? h('span', { class: 'mono' }, a.invoice_no)
              : h('span', { class: 'faint' }, '—');
          }, width: '95px' },
          { label: '开票日期', render: function (a) { return a.issue_date || '—'; }, width: '95px' },
          { label: '状态', render: function (a) { return st(a.status); }, width: '120px' },
          { label: '', width: '70px', render: function (a) {
            return h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); detail(a); } }, '详情');
          } }
        ], rows, { compact: true, pageSize: 12, empty: '暂无开票申请', onRow: detail }))
      ]), { ref: '7.8.2' }));

      /* ---------- 红蓝票与调整项（7.8.3） ---------- */
      root.appendChild(U.card('红蓝票与调整项的对应', h('div', null, [
        U.table([
          { label: '场景', key: 'k', width: '210px' },
          { label: '票据处理', render: function (r) { return h('span', { html: r.v }); } }
        ], [
          { k: '调整项为负 · 原票已开且未跨年', v: '开<b>红字发票</b>冲回（金额 ≥ ' + M.fmt(Invoice.RED_MIN_AMOUNT) + ' 元起开）' },
          { k: '调整项为负 · 跨年', v: '<b>不开红字</b>，在下期蓝票中体现净额 —— 跨年调整的税务处理须提前与税务顾问确认' },
          { k: '调整项为负 · 金额较小', v: '低于 ' + M.fmt(Invoice.RED_MIN_AMOUNT) + ' 元不单独开红票，直接在下期蓝票中冲减' },
          { k: '调整项为正（补收）', v: '计入下期蓝票' },
          { k: '账单作废（未确认未开票）', v: '未开票，开票申请随账单一并作废，无需票据处理' },
          { k: '账单作废但发票已开出', v: '<b>不能仅作废申请</b>，必须开红字发票冲回并告警' }
        ], { compact: true }),
        U.alertBox('warn', '<b>为什么负调整项不能一律走红票</b>：红字发票需要开具《红字信息表》并与购方确认，' +
          '成本远高于账面冲减。所以系统按「是否跨年 + 金额是否达起开线」自动判定，并把判定理由写进申请单，' +
          '而不是留给运营每次自己拍。')
      ]), { ref: '7.8.3' }));

      /* ---------- 轧差与开票（7.8.4） ---------- */
      var netOrder = S.settleOrders.filter(function (o) { return o.is_netting; })[0];
      var nv = netOrder ? Invoice.nettingView(S, netOrder) : null;
      if (nv) {
        var led = h('div', { class: 'ledger' });
        led.appendChild(h('div', { class: 'lrow' }, [
          h('span', null, nv.platformIssues.seller + '　开票（应收全额）'),
          h('span', null, M.fmt(nv.platformIssues.amount))]));
        led.appendChild(h('div', { class: 'lrow' }, [
          h('span', { class: 'faint' }, '　其中税额'),
          h('span', { class: 'faint' }, M.fmt(nv.platformIssues.tax))]));
        led.appendChild(h('div', { class: 'lrow' }, [
          h('span', null, nv.partnerIssues.seller + '　开票（应付全额）'),
          h('span', null, M.fmt(nv.partnerIssues.amount))]));
        led.appendChild(h('div', { class: 'lrow' }, [
          h('span', { class: 'faint' }, '　其中税额'),
          h('span', { class: 'faint' }, M.fmt(nv.partnerIssues.tax))]));
        led.appendChild(h('div', { class: 'ldbl' }));
        led.appendChild(h('div', { class: 'lrow ltotal' }, [
          h('span', null, '银行实际划转（轧差净额，' + (nv.direction === 'RECEIVE' ? '我方收' : '我方付') + '）'),
          h('span', null, M.fmt(nv.transfer))]));
        root.appendChild(U.card('轧差与开票的关系 · ' + netOrder.settle_no, h('div', null, [
          U.alertBox('info', '<b>轧差只影响资金划付，不影响开票金额。</b>' +
            '两张发票各按全额开具，银行只走一笔净额 —— 把「税务口径」与「资金口径」分开，是这条规则存在的全部意义。'),
          led,
          h('div', { class: 'faint mt8', html: '开票合计 ' +
            M.fmt(M.r2(nv.platformIssues.amount + nv.partnerIssues.amount)) + ' 元，实际划转 ' +
            M.fmt(nv.transfer) + ' 元，二者<b>本就不应相等</b>。' })
        ]), { ref: '7.8.4' }));
      }

      /* ---------- 平台开票主体 ---------- */
      var pf = Data.PLATFORM_INVOICE;
      root.appendChild(U.card('平台开票主体（我方）', U.kv([
        ['名称', pf.invoice_title], ['纳税人识别号', h('span', { class: 'mono' }, pf.taxpayer_no)],
        ['注册地址', pf.reg_address], ['注册电话', pf.reg_phone],
        ['开户行', pf.bank_name], ['银行账号', h('span', { class: 'mono' }, pf.bank_account)],
        ['默认税率', M.pct(pf.default_tax_rate, 0)], ['票种', pf.invoice_type === 'SPECIAL' ? '增值税专用发票' : '增值税普通发票']
      ], 'kv-2col'), { tight: true, ref: '7.8.2' }));

      if (params.apply) {
        var target = Store.Actions.findInvoiceApply(params.apply);
        if (target) setTimeout(function () { detail(target); }, 60);
      }

      /* =============== 辅助 =============== */
      function waitingBills() {
        return S.bills.filter(function (b) {
          if (['CONFIRMED', 'ADJUSTED', 'SETTLED'].indexOf(b.status) < 0) return false;
          return !S.invoiceApplies.some(function (a) {
            return a.bill_no === b.bill_no && a.status !== 'VOIDED';
          });
        });
      }
      function short(t) { return t && t.length > 12 ? t.slice(0, 12) + '…' : (t || '—'); }

      /* ---------- 生成开票申请（含前置校验与红蓝票预览） ---------- */
      function applyModal(b) {
        var pre = Store.Actions.invoicePreCheck(b.bill_no);
        var plan = Store.Actions.invoicePlan(b.bill_no);
        var body = h('div');
        body.appendChild(U.kv([
          ['账单', h('span', { class: 'mono' }, b.bill_no)],
          ['资金方', (S.partnerMap[b.partner_no] || {}).partner_short_name],
          ['账期 / 方向', b.billing_period + '　' + (b.direction === 'RECEIVABLE' ? '应收（平台开票给资金方）' : '应付（资金方开票给平台）')],
          ['应结金额', M.fmt(b.total_amount)]
        ], 'kv-2col'));

        body.appendChild(h('h3', { class: 'sec' }, ['开票前置校验', h('span', { class: 'tag-ref' }, '7.8.2')]));
        body.appendChild(U.checklist(pre.checks.map(function (c) {
          return { code: c.code, desc: c.name, ok: c.ok,
            msg: String(c.msg).replace(/<[^>]+>/g, ''),
            level: c.type === 'HARD' ? 'BLOCK' : 'WARN' };
        })));

        body.appendChild(h('h3', { class: 'sec' }, ['红蓝票拆分预览', h('span', { class: 'tag-ref' }, '7.8.3')]));
        if (!plan.reds.length && !plan.netAdjs.length) {
          body.appendChild(U.alertBox('info', '本期无调整项，直接开一张蓝票，金额 ' + M.fmt(plan.blueAmount) + ' 元。'));
        } else {
          var ll = h('div', { class: 'ledger' });
          ll.appendChild(h('div', { class: 'lrow' }, [h('span', null, '蓝票（本期费用 + 并入净额的调整项）'), h('span', null, M.fmt(plan.blueAmount))]));
          plan.reds.forEach(function (r) {
            ll.appendChild(h('div', { class: 'lrow' }, [
              h('span', null, '红字发票 · ' + r.adj.adjustment_no),
              h('span', { class: 'neg' }, M.fmt(r.adj.amount))]));
          });
          ll.appendChild(h('div', { class: 'ldbl' }));
          ll.appendChild(h('div', { class: 'lrow ltotal' }, [
            h('span', null, '合计 = 账单应结金额'), h('span', null, M.fmt(M.r2(plan.blueAmount + plan.redSum)))]));
          body.appendChild(ll);
          body.appendChild(U.alertBox(plan.identity ? 'ok' : 'danger',
            plan.identity ? '恒等校验通过：蓝票 + 红票 = 账单应结金额 ' + M.fmt(b.total_amount)
              : '恒等校验失败，请核查调整项归属'));
          body.appendChild(h('div', { class: 'mt8' }, U.table([
            { label: '调整项', render: function (x) { return h('span', { class: 'mono' }, x.adj.adjustment_no); } },
            { label: '金额', num: true, render: function (x) { return h('span', { class: x.adj.amount < 0 ? 'neg' : '' }, M.fmt(x.adj.amount)); } },
            { label: '票据处理', render: function (x) {
              var m = Invoice.RED_POLICY[x.decision.policy];
              return U.badge(m.name, m.cls);
            }, width: '160px' },
            { label: '判定理由', render: function (x) { return h('span', { class: 'faint', html: x.decision.why }); } }
          ], plan.reds.concat(plan.netAdjs), { compact: true })));
        }

        U.modal('生成开票申请 · ' + b.bill_no, body, [
          h('button', {
            class: 'btn btn-primary', disabled: !pre.pass || !Store.can('invoice.apply'),
            onclick: function () {
              var r = Store.Actions.createInvoiceApply(b.bill_no);
              if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
              U.closeModal();
              UI.toast('已生成 ' + r.applies.length + ' 张开票申请（蓝票 1 张，红字 ' + (r.applies.length - 1) + ' 张）', 'ok');
              App.rerender();
            }
          }, pre.pass ? '生成开票申请' : '存在硬拦截项，不可开票'),
          h('button', { class: 'btn', onclick: U.closeModal }, '取消')
        ], { size: 'wide' });
      }

      /* ---------- 申请详情 ---------- */
      function detail(a) {
        var body = h('div');
        body.appendChild(h('div', { class: 'grid g2' }, [
          U.card('销方', U.kv([
            ['名称', a.seller.title], ['纳税人识别号', h('span', { class: 'mono' }, a.seller.taxpayer_no)],
            ['地址 / 电话', a.seller.reg_address + '　' + a.seller.reg_phone],
            ['开户行 / 账号', a.seller.bank_name + '　' + a.seller.bank_account]
          ]), { tight: true }),
          U.card('购方', U.kv([
            ['名称', a.buyer.title], ['纳税人识别号', h('span', { class: 'mono' }, a.buyer.taxpayer_no)],
            ['地址 / 电话', a.buyer.reg_address + '　' + a.buyer.reg_phone],
            ['开户行 / 账号', a.buyer.bank_name + '　' + a.buyer.bank_account]
          ]), { tight: true })
        ]));
        body.appendChild(U.alertBox('info', '<b>购销方由账单方向决定</b>：' +
          (a.direction === 'RECEIVABLE'
            ? '应收 —— 平台是销方，资金方是购方。'
            : '应付 —— 资金方是销方，平台是购方。') +
          '同一资金方在轧差场景下会<b>同时是购方与销方</b>，各开各的票（7.8.4）。'));

        body.appendChild(h('h3', { class: 'sec' }, ['发票明细行', h('span', { class: 'tag-ref' }, '7.8.2')]));
        body.appendChild(U.table([
          { label: '货物或应税劳务、服务名称', render: function (l) { return l.goods_name; } },
          { label: '税收分类编码', render: function (l) {
            return h('div', null, [h('span', { class: 'mono' }, l.tax_category_code),
              h('div', { class: 'faint', style: 'font-size:11px' }, l.tax_category_name)]);
          }, width: '180px' },
          { label: '金额（不含税）', num: true, render: function (l) { return M.fmt(l.amount_ex_tax); } },
          { label: '税率', num: true, render: function (l) { return M.pct(l.tax_rate, 0); }, width: '60px' },
          { label: '税额', num: true, render: function (l) { return M.fmt(l.tax_amount); } },
          { label: '价税合计', num: true, render: function (l) {
            return h('span', { class: l.amount < 0 ? 'neg' : '' }, M.fmt(l.amount));
          } }
        ], a.lines, { compact: true }));

        var led = h('div', { class: 'ledger mt8' });
        led.appendChild(h('div', { class: 'lrow' }, [h('span', null, '合计金额（不含税）'), h('span', null, M.fmt(a.amount_ex_tax))]));
        led.appendChild(h('div', { class: 'lrow' }, [h('span', null, '合计税额'), h('span', null, M.fmt(a.tax_amount))]));
        led.appendChild(h('div', { class: 'ldbl' }));
        led.appendChild(h('div', { class: 'lrow ltotal' }, [h('span', null, '价税合计'), h('span', null, M.fmt(a.amount))]));
        body.appendChild(led);
        body.appendChild(U.alertBox(M.r2(a.amount_ex_tax + a.tax_amount) === M.r2(a.amount) ? 'ok' : 'danger',
          '价税三段恒等：' + M.fmt(a.amount_ex_tax) + ' + ' + M.fmt(a.tax_amount) + ' = ' +
          M.fmt(M.r2(a.amount_ex_tax + a.tax_amount)) +
          (M.r2(a.amount_ex_tax + a.tax_amount) === M.r2(a.amount) ? ' ✓　税额由倒轧得到，不独立计算' : ' ✗')));

        body.appendChild(h('div', { class: 'mt8' }, U.kv([
          ['申请单号', h('span', { class: 'mono' }, a.apply_no)],
          ['票种', a.kind === 'RED' ? '红字' + (a.invoice_type === 'SPECIAL' ? '增值税专用发票' : '增值税普通发票')
            : (a.invoice_type === 'SPECIAL' ? '增值税专用发票' : '增值税普通发票')],
          ['备注', a.remark],
          ['收票人', a.receiver_info || '—'],
          ['申请日期', a.apply_date],
          ['状态', st(a.status)],
          ['发票代码 / 号码', a.invoice_no ? h('span', { class: 'mono' }, a.invoice_code + ' / ' + a.invoice_no) : '—'],
          ['开票日期', a.issue_date || '—'],
          ['发票 PDF', a.pdf_url ? h('a', { href: '#', class: 'link', onclick: function (e) { e.preventDefault(); UI.toast('发票 PDF 由发票系统提供，本原型不落盘', '', a.pdf_url); } }, a.pdf_url) : '—']
        ], 'kv-2col')));

        if (a.kind === 'RED') {
          body.appendChild(U.alertBox('warn', '<b>红字发票</b>：冲回原发票 <b>' + a.red_of_invoice_no + '</b>（申请单 ' + a.red_of + '），' +
            '依据调整项 ' + a.adjustment_no + '。<br>判定理由：' + (a.policy_why || '')));
        }
        if (a.status === 'FAILED') body.appendChild(U.alertBox('danger', '开票失败：' + Core.esc(a.fail_reason)));
        if (a.status === 'VOIDED') body.appendChild(U.alertBox('info', '已作废：' + Core.esc(a.void_reason)));

        if (a.logs && a.logs.length) {
          body.appendChild(h('h3', { class: 'sec' }, ['流转留痕', h('span', { class: 'tag-ref' }, '14.5')]));
          body.appendChild(U.table([
            { label: '时间', render: function (l) { return l.time.replace('T', ' ').slice(0, 16); }, width: '135px' },
            { label: '操作方', render: function (l) { return l.actor; }, width: '110px' },
            { label: '动作', render: function (l) { return l.action; }, width: '110px' },
            { label: '说明', render: function (l) { return h('span', { class: 'faint' }, l.detail); } }
          ], a.logs, { compact: true }));
        }

        var foot = [];
        if (a.status === 'PENDING' || a.status === 'FAILED') {
          foot.push(h('button', {
            class: 'btn btn-primary', disabled: !Store.can('invoice.issue'),
            onclick: function () {
              var r = Store.Actions.submitInvoiceApply(a.apply_no);
              if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
              U.closeModal(); UI.toast('已推送至发票系统，等待开票结果回传', 'ok', a.apply_no); App.rerender();
            }
          }, a.status === 'FAILED' ? '修正后重新提交' : '提交发票系统'));
        }
        if (a.status === 'SUBMITTED') {
          foot.push(h('button', {
            class: 'btn btn-ok', disabled: !Store.can('invoice.issue'),
            onclick: function () {
              var r = Store.Actions.issueInvoice(a.apply_no, true);
              if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
              U.closeModal(); UI.toast('开票成功，发票号 ' + r.apply.invoice_no + '，已回写账单', 'ok'); App.rerender();
            }
          }, '模拟：发票系统回传开票成功'));
          foot.push(h('button', {
            class: 'btn btn-danger', disabled: !Store.can('invoice.issue'),
            onclick: function () {
              var r = Store.Actions.issueInvoice(a.apply_no, false, '购方名称与税号不匹配，发票系统拒绝受理');
              if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
              U.closeModal(); UI.toast('开票失败，已告警，可修正开票信息后重提', 'danger'); App.rerender();
            }
          }, '模拟：开票失败'));
        }
        if (a.status !== 'ISSUED' && a.status !== 'VOIDED') {
          foot.push(h('button', {
            class: 'btn', disabled: !Store.can('invoice.void'),
            onclick: function () {
              var r = Store.Actions.voidInvoiceApply(a.apply_no, '开票信息有误，作废后重开');
              if (!r.ok) { UI.toast(r.msg, 'danger'); return; }
              U.closeModal(); UI.toast('申请已作废', ''); App.rerender();
            }
          }, '作废申请'));
        }
        if (a.status === 'ISSUED') {
          foot.push(h('button', { class: 'btn', onclick: function () { U.goto('/bill/' + a.bill_no); } }, '查看账单'));
        }
        foot.push(h('button', { class: 'btn', onclick: U.closeModal }, '关闭'));

        U.modal((a.kind === 'RED' ? '红字' : '') + '开票申请 ' + a.apply_no, body, foot, { size: 'wide' });
      }
    }
  });
})();
