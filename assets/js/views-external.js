/* =============================================================================
 * views-external.js —— 模块⑥ 对账中心 · 外部对账（文件交换 + 逐笔匹配）
 * 对应 PRD 9.3：对账方式与周期 / 文件格式 / 差异类型与定责 / 容差与自动核销 /
 *               差异的自动定位；文件规范见 12.4
 * ========================================================================== */
(function () {
  'use strict';
  var h = Core.h, M = Core.Money, D = Core.D;
  var U = UI;

  var STATUS_MAP = {
    PENDING_SEND: ['待发出', ''], SENT: ['已发出待回传', 'info'],
    RECEIVED: ['已回传待匹配', 'warn'], MATCHED: ['已匹配', 'purple'], CLOSED: ['已核对', 'ok']
  };
  function tstatus(s) { var m = STATUS_MAP[s] || [s, '']; return h('span', { class: 'badge dot ' + m[1] }, m[0]); }

  UI.route('external', {
    title: '外部对账', crumbs: ['模块⑥', '对账中心', '外部对账'],
    render: function (root, params) {
      var S = Store.get();
      var taskNo = params.task || '';
      var task = taskNo ? Store.Actions.findReconTask(taskNo) : null;

      root.appendChild(U.pageHead('外部对账（与资金方）',
        '周期：月度（随账单）；方式：<b>SFTP 文件交换</b>（一期，D-10）；粒度：<b>逐笔为主</b>，汇总为辅；' +
        '时点：账单推送后 T+2 内收到资金方对账文件。本页可真实<b>导出我方明细 CSV</b>、<b>上传资金方回传文件</b>并执行<b>逐笔匹配</b>。'));
      root.appendChild(ViewsRecon.subnav('external'));

      /* ---------- 任务列表 ---------- */
      root.appendChild(U.card('对账任务', U.table([
        { label: '任务号', render: function (t) { return h('span', { class: 'mono' }, t.recon_task_no); } },
        { label: '资金方', render: function (t) { return (S.partnerMap[t.partner_no] || {}).partner_short_name; } },
        { label: '账期', render: function (t) { return t.period; }, width: '80px' },
        { label: '我方明细笔数', num: true, render: function (t) { return M.fmt(t.our_count, 0); } },
        { label: '发出文件', render: function (t) { return t.file_out ? h('span', { class: 'mono faint', style: 'font-size:11px' }, t.file_out) : '—'; } },
        { label: '回传文件', render: function (t) { return t.file_in ? h('span', { class: 'mono faint', style: 'font-size:11px' }, t.file_in) : '—'; } },
        { label: '匹配率', num: true, render: function (t) { return t.match ? M.pct(t.match.summary.matchRate, 2) : '—'; } },
        { label: '差异率', num: true, render: function (t) { return t.match ? h('span', { class: t.match.summary.diffRate > 0.001 ? 'neg' : '' }, M.pct(t.match.summary.diffRate, 4)) : '—'; } },
        { label: '差异单', num: true, render: function (t) { return t.diff_created || 0; } },
        { label: '状态', render: function (t) { return tstatus(t.status); }, width: '110px' },
        { label: '', width: '80px', render: function (t) {
          return h('button', { class: 'btn btn-sm' + (t.recon_task_no === taskNo ? ' btn-primary' : ''),
            onclick: function (e) { e.stopPropagation(); U.goto('/external?task=' + t.recon_task_no); } }, '打开');
        } }
      ], S.reconTasks, { compact: true, onRow: function (t) { U.goto('/external?task=' + t.recon_task_no); } }), { tight: true, ref: '9.3.1' }));

      if (!task) {
        root.appendChild(U.alertBox('info', '选择一个对账任务进入工作区：① 导出我方明细文件 → ② 接收资金方回传 → ③ 逐笔匹配 → ④ 生成差异单。'));
        root.appendChild(specCards());
        return;
      }

      /* ---------- 工作区 ---------- */
      var partner = S.partnerMap[task.partner_no];
      var ourRows = Recon.buildOurRows(S, task.partner_no, task.period);
      var steps = ['导出我方明细', '接收资金方回传', '逐笔匹配', '生成差异单'];
      var stepNo = task.status === 'PENDING_SEND' ? 0 : (task.status === 'SENT' ? 1 : (task.status === 'RECEIVED' ? 2 : 3));

      root.appendChild(h('h3', { class: 'sec' }, ['对账工作区 · ' + partner.partner_short_name + ' · ' + task.period,
        h('span', { class: 'tag-ref' }, task.recon_task_no)]));
      root.appendChild(h('div', { class: 'steps' }, steps.map(function (s, i) {
        return h('div', { class: 'step' + (i === stepNo ? ' active' : (i < stepNo ? ' done' : '')) },
          [h('span', { class: 'n' }, i < stepNo ? '✓' : (i + 1)), s]);
      })));

      /* ① 导出我方明细 */
      var outName = Recon.fileName('DETAIL', task.partner_no, task.period, 1);
      root.appendChild(U.card('① 导出我方费用明细文件', h('div', null, [
        U.kv([
          ['文件名', h('span', { class: 'mono' }, outName)],
          ['目录', h('span', { class: 'mono' }, '/' + task.partner_no + '/' + task.period.replace('-', '') + '/')],
          ['明细笔数', M.fmt(ourRows.length, 0) + ' 笔'],
          ['金额合计（含税）', M.fmt(M.sum(ourRows, function (r) { return r.amount; }))],
          ['编码 / 完整性', 'UTF-8 含 BOM；尾行 #TOTAL 校验行；同目录 .md5 校验文件'],
          ['发出状态', task.file_out ? task.file_out + '（' + task.sent_time + '）' : '未发出']
        ], 'kv-2col'),
        h('div', { class: 'btn-row mt8' }, [
          h('button', {
            class: 'btn btn-primary', onclick: function () {
              var csv = Recon.ourCsv(ourRows);
              U.download(outName, csv);
              Store.Actions.markReconSent(task.recon_task_no, outName);
              UI.toast('已导出 ' + ourRows.length + ' 行明细并标记为「已发出」', 'ok', outName);
              App.rerender();
            }
          }, '导出 CSV 并标记已发出'),
          h('button', { class: 'btn', onclick: function () { previewCsv('我方明细文件 · ' + outName, Recon.ourCsv(ourRows)); } }, '预览文件内容')
        ]),
        h('div', { class: 'mt8' }, U.table(
          Recon.OUT_COLS.map(function (c, i) {
            return { label: c, num: i === 5 || i === 7, render: function (r) {
              return [r.biz_key, r.event_code, r.fee_date, r.item_code, r.item_name,
                M.fmt(r.basis), r.rate, M.fmt(r.amount), r.flow_type, r.period, r.flow_no][i];
            } };
          }), ourRows.slice(0, 6), { compact: true })),
        h('div', { class: 'faint mt8' }, '（上表为前 6 行预览，导出文件含全部 ' + M.fmt(ourRows.length, 0) + ' 行）')
      ]), { ref: '9.3.2 / 12.4' }));

      /* ② 接收资金方回传 */
      var fileInput = h('input', { type: 'file', accept: '.csv,text/csv', style: 'max-width:280px' });
      fileInput.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          var parsed = Recon.parseCsv(reader.result);
          var rows = normalizeIn(parsed.rows);
          if (!rows.length) { UI.toast('未解析到有效数据行，请检查文件表头是否为：' + Recon.IN_COLS.join(' / '), 'danger', '解析失败'); return; }
          Store.Actions.attachReconFile(task.recon_task_no, f.name, rows);
          UI.toast('已解析 ' + rows.length + ' 行' + (parsed.total ? '；#TOTAL 校验行：' + parsed.total.count + ' 笔 / ' + M.fmt(parsed.total.amount) : ''), 'ok', f.name);
          App.rerender();
        };
        reader.readAsText(f, 'UTF-8');
      });

      root.appendChild(U.card('② 接收资金方回传的对账结果文件', h('div', null, [
        U.alertBox('info', '回传文件列定义（9.3.2）：<b>' + Recon.IN_COLS.join(' / ') + '</b>。' +
          '匹配优先用<b>费用流水号</b>精确匹配，未命中时以<b>借据号 + 计费项</b>兜底。'),
        h('div', { class: 'inline-form' }, [
          U.field('上传资金方回传 CSV', fileInput),
          h('button', {
            class: 'btn', onclick: function () {
              var sim = Recon.simulateTheirRows(ourRows, ourRows.length * 7 + task.period.length);
              var name = Recon.fileName('RECON_RESULT', task.partner_no, task.period, 1);
              U.download(name, Recon.theirCsv(sim.rows));
              UI.toast('已生成模拟回传文件，可再用上方「上传」载入，或直接点右侧一键载入', '', name);
            }
          }, '生成模拟回传文件（下载）'),
          h('button', {
            class: 'btn btn-primary', onclick: function () {
              var sim = Recon.simulateTheirRows(ourRows, ourRows.length * 7 + task.period.length);
              var name = Recon.fileName('RECON_RESULT', task.partner_no, task.period, 1);
              Store.Actions.attachReconFile(task.recon_task_no, name + '（模拟）', sim.rows);
              UI.toast('已载入模拟回传文件 ' + sim.rows.length + ' 行（注入：金额不符 ' + sim.injected.amount +
                ' 笔 / 容差 ' + sim.injected.tol + ' 笔 / 对方漏记 ' + sim.injected.missing +
                ' 笔 / 对方多记 ' + sim.injected.extra + ' 笔）', 'ok', '一键载入');
              App.rerender();
            }
          }, '一键载入模拟回传'),
          task.file_in ? h('button', { class: 'btn btn-ghost', onclick: function () { Store.Actions.resetReconTask(task.recon_task_no); App.rerender(); } }, '清除已载入文件') : null
        ]),
        task.file_in ? h('div', { class: 'mt8' }, U.alertBox('ok',
          '已载入 <b>' + task.file_in + '</b>，共 <b>' + task.in_rows.length + '</b> 行，上传时间 ' + (task.upload_time || '—') + '。')) : null,
        task.in_rows ? h('div', { class: 'mt8' }, U.table([
          { label: '费用流水号', render: function (r) { return h('span', { class: 'mono', style: 'font-size:11px' }, r.flow_no); } },
          { label: '借据号', render: function (r) { return h('span', { class: 'mono' }, r.biz_key); } },
          { label: '对方金额', num: true, render: function (r) { return M.fmt(r.their_amount); } },
          { label: '核对结果', render: function (r) { return r.check_result; } },
          { label: '差异说明', render: function (r) { return r.note || '—'; } }
        ], task.in_rows.slice(0, 6), { compact: true })) : null
      ]), { ref: '9.3.2' }));

      /* ③ 逐笔匹配 */
      var matchBox = h('div');
      root.appendChild(U.card('③ 逐笔匹配', matchBox, {
        ref: '9.3.3 / 9.3.4',
        actions: [h('button', {
          class: 'btn btn-sm btn-primary', disabled: !task.in_rows,
          onclick: function () {
            var r = Store.Actions.runReconMatch(task.recon_task_no);
            if (!r.ok) { UI.toast(r.msg, 'warn'); return; }
            UI.toast('匹配完成：一致 ' + r.task.match.summary.byResult.MATCH + ' / 容差 ' +
              r.task.match.summary.byResult.TOLERANCE + ' / 差异 ' +
              (r.task.match.summary.total - r.task.match.summary.byResult.MATCH - r.task.match.summary.byResult.TOLERANCE), 'ok');
            App.rerender();
          }
        }, '▶ 执行逐笔匹配')]
      }));
      drawMatch();

      function drawMatch() {
        matchBox.innerHTML = '';
        if (!task.match) {
          matchBox.appendChild(h('div', { class: 'empty' }, task.in_rows ? '已载入回传文件，点击右上角「执行逐笔匹配」' : '请先在第 ② 步载入资金方回传文件'));
          return;
        }
        var sm = task.match.summary;
        matchBox.appendChild(h('div', { class: 'grid g4 mb8' }, [
          U.stat('我方 / 对方笔数', M.fmt(sm.ourCount, 0) + ' / ' + M.fmt(sm.theirCount, 0)),
          U.stat('我方 / 对方金额', M.fmtShort(sm.ourAmount) + ' / ' + M.fmtShort(sm.theirAmount)),
          U.stat('匹配率', M.pct(sm.matchRate, 2), '一致 + 容差内核销', sm.matchRate > 0.99 ? 'ok' : 'warn'),
          U.stat('差异率', M.pct(sm.diffRate, 4), '目标 < 0.01% · 告警 > 0.1%', sm.diffRate > 0.001 ? 'danger' : 'ok')
        ]));
        matchBox.appendChild(U.table([
          { label: '匹配结果', render: function (r) { return U.badge(Recon.RESULT_META[r.k].name, Recon.RESULT_META[r.k].cls); } },
          { label: '笔数', num: true, render: function (r) { return r.n; } },
          { label: '占比', num: true, render: function (r) { return M.pct(sm.total ? r.n / sm.total : 0, 2); } },
          { label: '说明', render: function (r) { return ({
            MATCH: '双方金额完全一致', TOLERANCE: '差额 ≤ ' + Recon.TOLERANCE + ' 元，自动核销并计入容差累计',
            AMOUNT_DIFF: '差额 > ' + Recon.TOLERANCE + ' 元，生成差异单进入人工处理',
            OURS_EXTRA: '我方有、对方无 —— 对方漏记或业务未同步',
            THEIRS_EXTRA: '对方有、我方无 —— 我方漏算或规则过滤排除'
          })[r.k]; } }
        ], Object.keys(Recon.RESULT_META).map(function (k) { return { k: k, n: sm.byResult[k] }; }), { compact: true }));

        matchBox.appendChild(h('div', { class: 'mt8' }, U.alertBox(sm.toleranceExceeded ? 'warn' : 'info',
          '<b>容差累计：' + M.fmt(sm.toleranceTotal) + ' 元</b>（' + sm.byResult.TOLERANCE + ' 笔自动核销）。' +
          (sm.toleranceExceeded
            ? '已超过月度 ' + Recon.TOLERANCE_MONTH_CAP + ' 元阈值，<b>触发口径复核</b> —— 若持续单向偏移，说明存在系统性口径差异（如流水粒度 PER_DAY vs PER_PERIOD），而非随机舍入。'
            : '未超过月度 ' + Recon.TOLERANCE_MONTH_CAP + ' 元阈值。容差不是宽容错误，而是承认舍入的客观性；阈值须在协议附件中与资金方明确约定。'))));

        // 明细（默认只看差异）
        var filter = 'DIFF';
        var listBox = h('div', { class: 'mt14' });
        matchBox.appendChild(h('div', { class: 'inline-form mt14' }, [
          U.field('查看', U.selectEl([
            { value: 'DIFF', label: '仅差异（不含一致 / 容差）' }, { value: 'ALL', label: '全部' },
            { value: 'MATCH', label: '一致' }, { value: 'TOLERANCE', label: '容差内核销' },
            { value: 'AMOUNT_DIFF', label: '金额不符' }, { value: 'OURS_EXTRA', label: '己方多' }, { value: 'THEIRS_EXTRA', label: '对方多' }
          ], filter, function (v) { filter = v; drawList(); })),
          h('button', {
            class: 'btn', onclick: function () {
              var rows = task.match.rows.filter(function (r) { return r.result !== 'MATCH'; });
              var lines = ['费用流水号,借据号,计费项,我方金额,对方金额,差额,匹配结果,匹配方式'];
              rows.forEach(function (r) {
                lines.push([(r.our || r.their).flow_no, (r.our || r.their).biz_key, r.our ? r.our.item_name : '',
                  r.our_amount === null ? '' : M.r2(r.our_amount), r.their_amount === null ? '' : M.r2(r.their_amount),
                  M.r2(r.diff), Recon.RESULT_META[r.result].name, r.match_by].join(','));
              });
              U.download('RECON_DIFF_' + task.partner_no + '_' + task.period.replace('-', '') + '.csv', '﻿' + lines.join('\r\n'));
              UI.toast('已导出差异明细 ' + rows.length + ' 行', 'ok');
            }
          }, '导出差异明细 CSV')
        ]));
        matchBox.appendChild(listBox);
        drawList();

        function drawList() {
          listBox.innerHTML = '';
          var rows = task.match.rows.filter(function (r) {
            if (filter === 'ALL') return true;
            if (filter === 'DIFF') return r.result !== 'MATCH' && r.result !== 'TOLERANCE';
            return r.result === filter;
          });
          listBox.appendChild(U.pagedTable([
            { label: '费用流水号', render: function (r) { return h('span', { class: 'mono', style: 'font-size:11px' }, (r.our || r.their).flow_no); } },
            { label: '借据号', render: function (r) { return h('span', { class: 'mono' }, (r.our || r.their).biz_key); } },
            { label: '计费项', render: function (r) { return r.our ? r.our.item_name : h('span', { class: 'faint' }, '（我方无）'); } },
            { label: '我方金额', num: true, render: function (r) { return r.our_amount === null ? '—' : M.fmt(r.our_amount); } },
            { label: '对方金额', num: true, render: function (r) { return r.their_amount === null ? '—' : M.fmt(r.their_amount); } },
            { label: '差额', num: true, render: function (r) { return U.money(r.diff, { signed: true }); } },
            { label: '匹配方式', render: function (r) { return h('span', { class: 'faint', style: 'font-size:11px' }, r.match_by); } },
            { label: '结果', render: function (r) { return U.badge(Recon.RESULT_META[r.result].name, Recon.RESULT_META[r.result].cls); } },
            { label: '差异单', render: function (r) { return r.diff_no ? h('span', { class: 'mono' }, r.diff_no) : '—'; } },
            { label: '', width: '80px', render: function (r) {
              return (r.result === 'MATCH') ? null : h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); showAnalyze(r); } }, '定位');
            } }
          ], rows, { compact: true, pageSize: 12, empty: '无该类结果' }));
        }
      }

      /* ④ 生成差异单 */
      var pending = task.match ? task.match.rows.filter(function (r) {
        return r.result !== 'MATCH' && r.result !== 'TOLERANCE' && !r.diff_no;
      }).length : 0;
      root.appendChild(U.card('④ 生成差异单并转入差异工作台', h('div', null, [
        U.alertBox('info', '差额 ≤ ' + Recon.TOLERANCE + ' 元的记录<b>自动核销</b>，不生成差异单；' +
          '> ' + Recon.TOLERANCE + ' 元的逐条生成差异单，携带<b>自动定位分析核查包</b>进入统一的差异处理闭环（外部争议与内部勾稽差异共用同一套模型与流程）。'),
        h('div', { class: 'btn-row' }, [
          h('button', {
            class: 'btn btn-primary', disabled: !task.match || pending === 0 || !Store.can('diff.handle'),
            onclick: function () {
              var r = Store.Actions.createReconDiffs(task.recon_task_no);
              UI.toast('已生成 ' + r.diffs.length + ' 张差异单', 'ok');
              App.rerender();
            }
          }, pending ? '生成 ' + pending + ' 张差异单' : '无待生成差异'),
          h('button', { class: 'btn', onclick: function () { U.goto('/diffs'); } }, '前往差异工作台'),
          task.diff_created ? h('span', { class: 'faint' }, '本任务已生成差异单 ' + task.diff_created + ' 张') : null
        ])
      ]), { ref: '9.4' }));

      root.appendChild(specCards());

      /* ---------- 辅助 ---------- */
      function normalizeIn(rows) { return Recon.normalizeIn(rows); }

      function previewCsv(title, text) {
        var lines = text.replace(/^﻿/, '').split(/\r?\n/);
        var head = lines.slice(0, 12).join('\n');
        var tail = lines.length > 14 ? '\n…（共 ' + (lines.length - 2) + ' 行）\n' + lines[lines.length - 2] : '';
        U.modal(title, h('div', null, [
          U.alertBox('info', '编码 UTF-8（含 BOM，兼容 Excel 打开中文）；换行 CRLF；尾行 <b>#TOTAL,笔数,金额合计</b> 用于缺行校验（12.4）。'),
          h('pre', { class: 'code' }, head + tail)
        ]), [h('button', { class: 'btn', onclick: U.closeModal }, '关闭')], { size: 'wide' });
      }

      function showAnalyze(r) {
        var a = r.diff_no
          ? (S.diffs.filter(function (d) { return d.diff_no === r.diff_no; })[0] || {}).auto_analysis
          : Recon.autoAnalyze(S, r);
        var body = h('div', null, [
          U.kv([
            ['费用流水号', h('span', { class: 'mono' }, (r.our || r.their).flow_no)],
            ['借据号', h('span', { class: 'mono' }, (r.our || r.their).biz_key)],
            ['计费项', r.our ? r.our.item_name : '（我方无）'],
            ['我方 / 对方 / 差额', (r.our_amount === null ? '—' : M.fmt(r.our_amount)) + ' / ' +
              (r.their_amount === null ? '—' : M.fmt(r.their_amount)) + ' / ' + M.fmtSigned(r.diff)],
            ['匹配方式', r.match_by], ['结果', U.badge(Recon.RESULT_META[r.result].name, Recon.RESULT_META[r.result].cls)],
            ['对方说明', (r.their && r.their.note) || '—']
          ], 'kv-2col'),
          h('h3', { class: 'sec' }, ['自动定位分析（核查包）', h('span', { class: 'tag-ref' }, '9.3.5')]),
          h('div', { class: 'checklist' }, (a.steps || []).map(function (s) {
            return h('div', { class: 'check-row ' + (s.ok ? 'pass' : 'fail') }, [
              h('div', { class: 'st' }, s.ok ? '✓' : '✕'), h('div', { class: 'msg' }, s.text)
            ]);
          })),
          h('div', { class: 'mt8' }, U.kv([
            ['疑似原因', h('b', null, a.suspect || '—')],
            ['关联证据', a.evidence || '—'],
            ['处理建议', a.advice || '—']
          ]))
        ]);
        var foot = [];
        if (r.our) foot.push(h('button', { class: 'btn', onclick: function () { U.closeModal(); U.goto('/trace?q=' + r.our.flow_no); } }, '全链路追溯'));
        if (r.diff_no) foot.push(h('button', { class: 'btn', onclick: function () { U.closeModal(); U.goto('/diffs'); } }, '前往差异工作台'));
        foot.push(h('button', { class: 'btn btn-ghost', onclick: U.closeModal }, '关闭'));
        U.modal('差异自动定位 · ' + (r.our || r.their).flow_no, body, foot, { size: 'wide' });
      }
    }
  });

  function specCards() {
    return h('div', null, [
      h('div', { class: 'grid g2' }, [
        UI.card('我方发出（明细文件）列定义', UI.table([
          { label: '列', key: 'k' }, { label: '说明', key: 'v' }
        ], [
          { k: '借据号', v: '业务主键' }, { k: '事件类型 / 事件日期', v: '计费依据' },
          { k: '计费项编码 / 名称', v: '费种' }, { k: '计费基数', v: '基数金额' },
          { k: '费率', v: '适用费率（比例 / 日费率 / 阶梯档数）' }, { k: '费用金额（含税）', v: '结果' },
          { k: '流水类型', v: '正常 / 红冲 / 找平 / 保底' }, { k: '账期', v: '归属' },
          { k: '费用流水号', v: '唯一标识（对方回传时的主匹配键）' }
        ], { compact: true }), { tight: true, ref: '9.3.2' }),
        UI.card('差异类型与定责', UI.table([
          { label: '类型', key: 'k' }, { label: '典型原因', key: 'v' }, { label: '初判责任方', key: 'r', width: '90px' }
        ], [
          { k: '己方多 OURS_EXTRA', v: '重复计费、口径过宽、对方漏记', r: '待核查' },
          { k: '对方多 THEIRS_EXTRA', v: '我方漏算、事件缺失、规则过滤排除', r: '待核查' },
          { k: '金额不符 AMOUNT_DIFF', v: '费率、基数、舍入、版本路由分歧', r: '待核查' },
          { k: '时间差 TIMING_DIFF', v: '跨期归属分歧', r: '多为口径问题' },
          { k: '状态差 STATUS_DIFF', v: '冲正一方已记一方未记', r: '待核查' }
        ], { compact: true }), { tight: true, ref: '9.3.3' })
      ]),
      UI.card('文件接口通用规范', UI.table([
        { label: '项', key: 'k', width: '110px' }, { label: '规范', key: 'v' }
      ], [
        { k: '传输', v: 'SFTP，目录按 /{partner_no}/{yyyyMM}/ 组织' },
        { k: '命名', v: '{类型}_{partner_no}_{yyyyMMdd}_{seq}.{ext}，如 DETAIL_P000012_20260331_001.csv' },
        { k: '编码', v: 'UTF-8（含 BOM，兼容 Excel 打开中文）' },
        { k: '完整性', v: '同目录下同名 .md5 文件；文件尾行 #TOTAL 校验行（防止传输缺行）' },
        { k: '加密', v: '敏感文件使用约定的 PGP 公钥加密' },
        { k: '时点', v: '账单推送后 T+2 内收到资金方对账文件' }
      ], { compact: true }), { tight: true, ref: '12.4' })
    ]);
  }
})();
