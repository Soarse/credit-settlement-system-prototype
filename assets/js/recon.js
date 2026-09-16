/* =============================================================================
 * recon.js —— 外部对账：文件生成 / 上传解析 / 逐笔匹配 / 自动定位 / 差异单生成
 * 对应 PRD 9.3（外部对账）、9.3.2（文件格式）、9.3.3（差异类型与定责）、
 *          9.3.4（容差与自动核销）、9.3.5（差异的自动定位）、12.4（文件接口规范）
 * ========================================================================== */
(function (global) {
  'use strict';
  var M = Core.Money, D = Core.D;

  var TOLERANCE = 0.05;          // 9.3.4 舍入误差容差
  var TOLERANCE_MONTH_CAP = 100; // 月度容差核销累计超过此值触发口径复核

  /* ---------------- 我方明细文件（9.3.2）---------------- */
  var OUT_COLS = ['借据号', '事件类型', '事件日期', '计费项编码', '计费项名称',
    '计费基数', '费率', '费用金额(含税)', '流水类型', '账期', '费用流水号'];

  function buildOurRows(S, partnerNo, period) {
    return S.eng.feeFlows.filter(function (f) {
      return f.partner_no === partnerNo && f.billing_period === period;
    }).map(function (f) {
      var ev = S.eventMap[f.event_id];
      var rate = '';
      var rm = f.rate_snapshot;
      if (rm) {
        if (rm.type === 'FIXED_RATIO') rate = M.pct(rm.ratio, 3);
        else if (rm.type === 'DAILY_RATE') rate = (rm.annual_ratio / rm.day_count_basis * 100).toFixed(6) + '%';
        else if (rm.tiers) rate = '阶梯' + rm.tiers.length + '档';
        else if (rm.unit_price) rate = M.fmt(rm.unit_price) + '元/笔';
      }
      return {
        biz_key: f.charge_object_id,
        event_code: ev ? ev.event_code : (f.event_id.indexOf('PERIOD_CLOSE') === 0 ? 'EV_PERIOD_CLOSE' : ''),
        fee_date: f.fee_date,
        item_code: f.charge_item_code, item_name: f.charge_item_name,
        basis: f.basis_amount, rate: rate, amount: f.fee_amount,
        flow_type: f.flow_type, period: f.billing_period, flow_no: f.fee_flow_no
      };
    });
  }

  function csvEscape(v) {
    var s = String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** 我方发出的明细文件（UTF-8 with BOM，尾行 #TOTAL 校验行，PRD 12.4） */
  function ourCsv(rows) {
    var lines = [OUT_COLS.join(',')];
    rows.forEach(function (r) {
      lines.push([r.biz_key, r.event_code, r.fee_date, r.item_code, r.item_name,
        M.r2(r.basis), r.rate, M.r2(r.amount), r.flow_type, r.period, r.flow_no].map(csvEscape).join(','));
    });
    lines.push('#TOTAL,' + rows.length + ',' + M.r2(M.sum(rows, function (r) { return r.amount; })));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /** 资金方回传的对账结果文件列（9.3.2） */
  var IN_COLS = ['费用流水号', '借据号', '对方金额', '核对结果', '差异说明'];

  function theirCsv(rows) {
    var lines = [IN_COLS.join(',')];
    rows.forEach(function (r) {
      lines.push([r.flow_no, r.biz_key, r.their_amount === null ? '' : M.r2(r.their_amount),
        r.check_result, r.note].map(csvEscape).join(','));
    });
    lines.push('#TOTAL,' + rows.length + ',' + M.r2(M.sum(rows.filter(function (r) { return r.their_amount !== null; }), function (r) { return r.their_amount; })));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /** 文件命名：{类型}_{partner_no}_{yyyyMMdd}_{seq}.csv */
  function fileName(type, partnerNo, period, seq) {
    return type + '_' + partnerNo + '_' + D.periodEnd(period).replace(/-/g, '') + '_' + Core.pad(seq || 1, 3) + '.csv';
  }

  /* ---------------- CSV 解析（容忍 BOM / CRLF / 引号 / #TOTAL 尾行）---------------- */
  function parseCsv(text) {
    text = String(text).replace(/^﻿/, '');
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return { header: [], rows: [], total: null, error: '文件为空' };
    var total = null;
    if (lines[lines.length - 1].indexOf('#TOTAL') === 0) {
      var t = lines.pop().split(',');
      total = { count: +t[1], amount: +t[2] };
    }
    var header = splitLine(lines.shift());
    var rows = lines.map(function (l) {
      var cells = splitLine(l), o = {};
      header.forEach(function (hname, i) { o[hname.trim()] = (cells[i] === undefined ? '' : cells[i]).trim(); });
      return o;
    });
    return { header: header, rows: rows, total: total };
  }
  function splitLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  /** 把解析出的原始行（中文表头或英文键）归一为匹配所需结构 */
  function normalizeIn(rows) {
    return rows.map(function (r) {
      var flow = r['费用流水号'] || r['flow_no'] || '';
      var key = r['借据号'] || r['biz_key'] || '';
      var amt = r['对方金额'] !== undefined ? r['对方金额'] : (r['their_amount'] !== undefined ? r['their_amount'] : '');
      return {
        flow_no: String(flow).trim(), biz_key: String(key).trim(),
        their_amount: amt === '' || amt === null || amt === undefined ? null : +String(amt).replace(/,/g, ''),
        check_result: r['核对结果'] || r['check_result'] || '', note: r['差异说明'] || r['note'] || ''
      };
    }).filter(function (r) { return r.flow_no || r.biz_key; });
  }

  /* ---------------- 模拟资金方回传（用于演示，可替代真实上传）---------------- */
  function simulateTheirRows(ourRows, seed) {
    var rng = new Core.Rng(seed || 20260506);
    var rows = [], injected = { amount: 0, tol: 0, missing: 0, extra: 0 };
    var pickAmount = [], pickTol = [], pickMissing = [];
    var idx = ourRows.map(function (_, i) { return i; });
    // 随机挑选注入位置（确定性）
    function pick(n, pool) {
      var out = [];
      for (var k = 0; k < n && pool.length; k++) out.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
      return out;
    }
    var pool = idx.slice();
    pickAmount = pick(Math.min(2, ourRows.length), pool);
    pickTol = pick(Math.min(3, ourRows.length), pool);
    pickMissing = pick(Math.min(1, ourRows.length), pool);

    ourRows.forEach(function (r, i) {
      if (pickMissing.indexOf(i) >= 0) return;                    // 对方无此笔 → 我方多
      var amt = r.amount, note = '', res = '一致';
      if (pickAmount.indexOf(i) >= 0) {                            // 费率口径差异
        amt = M.r2(r.basis * 0.013);
        if (M.r2(amt) === M.r2(r.amount)) amt = M.r2(r.amount * 0.87);
        res = '不一致'; note = '按我行口径费率 1.30% 计算';
      } else if (pickTol.indexOf(i) >= 0) {                        // 舍入差
        amt = M.r2(r.amount + (rng.chance(0.5) ? 0.01 : -0.01));
        res = '不一致'; note = '舍入粒度差异（我行按期末一次性计算）';
      }
      rows.push({ flow_no: r.flow_no, biz_key: r.biz_key, their_amount: amt, check_result: res, note: note });
    });
    // 对方多出一笔（我方无此笔）
    if (ourRows.length) {
      var base = ourRows[Math.floor(rng.next() * ourRows.length)];
      rows.push({
        flow_no: 'FF' + D.periodEnd(base.period).replace(/-/g, '') + '99999999999999',
        biz_key: base.biz_key, their_amount: M.r2(base.amount * 1.05),
        check_result: '我方无此笔', note: '我行系统存在该笔计费，贵方明细中未见'
      });
    }
    injected = { amount: pickAmount.length, tol: pickTol.length, missing: pickMissing.length, extra: 1 };
    return { rows: rows, injected: injected };
  }

  /* ---------------- 逐笔匹配（9.3.3）---------------- */
  var RESULT_META = {
    MATCH: { name: '一致', cls: 'ok' },
    TOLERANCE: { name: '容差内自动核销', cls: 'warn' },
    AMOUNT_DIFF: { name: '金额不符', cls: 'danger' },
    OURS_EXTRA: { name: '己方多（对方无此笔）', cls: 'danger' },
    THEIRS_EXTRA: { name: '对方多（我方无此笔）', cls: 'danger' }
  };

  function match(S, ourRows, theirRows) {
    var theirByFlow = {}, theirByKey = {};
    theirRows.forEach(function (t) {
      if (t.flow_no) theirByFlow[t.flow_no] = t;
      var k = t.biz_key + '|' + (t.item_code || '');
      (theirByKey[k] || (theirByKey[k] = [])).push(t);
    });
    var used = {}, rows = [];

    ourRows.forEach(function (o) {
      var t = theirByFlow[o.flow_no];
      var matchBy = '费用流水号';
      if (!t) {                                   // 兜底：借据号 + 计费项
        var cand = (theirByKey[o.biz_key + '|' + o.item_code] || []).filter(function (x) { return !used[x.flow_no]; });
        if (cand.length === 1) { t = cand[0]; matchBy = '借据号 + 计费项（兜底）'; }
      }
      if (!t) {
        rows.push({ our: o, their: null, our_amount: o.amount, their_amount: null,
          diff: o.amount, result: 'OURS_EXTRA', match_by: '—' });
        return;
      }
      used[t.flow_no] = 1;
      var ta = t.their_amount === null || t.their_amount === undefined || t.their_amount === '' ? null : +t.their_amount;
      var d = M.r2(o.amount - (ta === null ? 0 : ta));
      var res = d === 0 ? 'MATCH' : (Math.abs(d) <= TOLERANCE ? 'TOLERANCE' : 'AMOUNT_DIFF');
      rows.push({ our: o, their: t, our_amount: o.amount, their_amount: ta, diff: d, result: res, match_by: matchBy });
    });

    theirRows.forEach(function (t) {
      if (used[t.flow_no]) return;
      if (ourRows.some(function (o) { return o.flow_no === t.flow_no; })) return;
      rows.push({ our: null, their: t, our_amount: null,
        their_amount: t.their_amount === null ? null : +t.their_amount,
        diff: -(+t.their_amount || 0), result: 'THEIRS_EXTRA', match_by: '—' });
    });

    var summary = {
      total: rows.length,
      ourCount: ourRows.length, theirCount: theirRows.length,
      ourAmount: M.sum(ourRows, function (r) { return r.amount; }),
      theirAmount: M.sum(theirRows.filter(function (r) { return r.their_amount !== null; }), function (r) { return +r.their_amount; }),
      byResult: {}, toleranceTotal: 0, diffAmount: 0
    };
    Object.keys(RESULT_META).forEach(function (k) { summary.byResult[k] = 0; });
    rows.forEach(function (r) {
      summary.byResult[r.result]++;
      if (r.result === 'TOLERANCE') summary.toleranceTotal = M.r2(summary.toleranceTotal + Math.abs(r.diff));
      if (r.result !== 'MATCH' && r.result !== 'TOLERANCE') summary.diffAmount = M.r2(summary.diffAmount + Math.abs(r.diff));
    });
    summary.matchRate = summary.ourCount ? (summary.byResult.MATCH + summary.byResult.TOLERANCE) / rows.length : 0;
    summary.diffRate = summary.ourAmount ? summary.diffAmount / Math.abs(summary.ourAmount) : 0;
    summary.toleranceExceeded = summary.toleranceTotal > TOLERANCE_MONTH_CAP;
    return { rows: rows, summary: summary };
  }

  /* ---------------- 自动定位分析（9.3.5）---------------- */
  function autoAnalyze(S, row) {
    var steps = [], suspect = '', evidence = '', advice = '';
    var o = row.our, t = row.their;
    if (row.result === 'OURS_EXTRA') {
      steps.push({ ok: true, text: '我方存在该笔费用流水 ' + o.flow_no + '（' + o.item_name + '，' + M.fmt(o.amount) + '）' });
      steps.push({ ok: false, text: '资金方回传文件中未见该流水号，也未匹配到「借据号 + 计费项」' });
      var ev = S.eventMap[(S.eng.flowsByNo[o.flow_no] || {}).event_id];
      steps.push({ ok: !!ev, text: ev ? '原始业务事件存在：' + ev.event_code + ' / ' + ev.occur_date + ' / ' + ev.biz_key
        : '未找到原始业务事件（需核查事件接入链路）' });
      suspect = '对方漏记，或该笔业务未同步至资金方系统';
      evidence = '费用流水 ' + o.flow_no + ' 三向引用完整（事件 / 规则版本 / 基数快照），可出示追溯报告';
      advice = '向资金方出示逐笔追溯报告；若确为对方漏记，由对方补记，我方口径维持';
    } else if (row.result === 'THEIRS_EXTRA') {
      steps.push({ ok: true, text: '资金方存在该笔计费：' + t.flow_no + '（' + M.fmt(t.their_amount) + '）' });
      steps.push({ ok: false, text: '我方费用流水中不存在该流水号' });
      var evs = S.events.filter(function (e) { return e.biz_key === t.biz_key; });
      steps.push({ ok: evs.length > 0, text: evs.length
        ? '我方存在该借据的业务事件 ' + evs.length + ' 条，需核查是否被 IGNORED'
        : '我方无该借据的任何业务事件（疑似上游事件缺失）' });
      suspect = evs.length ? '我方规则过滤导致未计费（NO_RULE_MATCH），或口径不含该费项' : '上游事件缺失，我方漏算';
      evidence = '可在「事件中心」按业务主键 ' + t.biz_key + ' 查询事件与忽略原因';
      advice = evs.length ? '核对该借据事件的 IGNORED 原因与协议过滤条件' : '发起事件回补（12.1.5），补齐后触发范围重算';
    } else if (row.result === 'AMOUNT_DIFF') {
      var flow = S.eng.flowsByNo[o.flow_no] || {};
      steps.push({ ok: true, text: '事件存在性：双方均有该笔（借据 ' + o.biz_key + '）' });
      var impliedRate = o.basis ? (row.their_amount / o.basis) : 0;
      var ourRate = o.basis ? (o.amount / o.basis) : 0;
      var basisSame = true;
      steps.push({ ok: basisSame, text: '基数一致性：我方基数 ' + M.fmt(o.basis) + '（对方文件未提供基数，按流水号匹配）' });
      steps.push({ ok: false, text: '费率差异：我方隐含费率 ' + (ourRate * 100).toFixed(4) + '%，对方隐含费率 ' + (impliedRate * 100).toFixed(4) + '%' });
      var ver = flow.rule_version ? S.versions.filter(function (v) {
        return v.agreement_no === flow.agreement_no && v.version_no === flow.rule_version;
      })[0] : null;
      suspect = '协议版本路由分歧 / 费率口径差异';
      evidence = ver ? (flow.agreement_no + '-' + ver.version_no + ' 生效区间 [' + ver.effective_date + ', ' + ver.expiry_date +
        ')；事件发生日 ' + o.fee_date + ' 落于该版本' + (t.note ? '；对方说明：' + t.note : ''))
        : (t.note || '对方未说明差异原因');
      advice = '向资金方出示版本条款与 PRD 5.4.3「按事件发生日路由」规则；若确为我方口径有误，发起范围重算并将差额计入下期调整项';
    } else if (row.result === 'TOLERANCE') {
      steps.push({ ok: true, text: '事件与基数一致' });
      steps.push({ ok: false, text: '金额相差 ' + M.fmt(Math.abs(row.diff)) + ' 元，落在 ' + TOLERANCE + ' 元容差内' });
      suspect = '舍入粒度口径差异（PER_DAY 逐日舍入 vs PER_PERIOD 期末一次性）';
      evidence = t.note || '对方未说明';
      advice = '自动核销并计入容差累计；若月度容差累计持续单向偏移，说明存在系统性口径差异，需复核 fee_flow_granularity 约定';
    }
    return { steps: steps, suspect: suspect, evidence: evidence, advice: advice };
  }

  /* ---------------- 生成差异单（9.4.1）---------------- */
  function createDiffs(S, task) {
    var made = [];
    task.match.rows.forEach(function (r) {
      if (r.result === 'MATCH' || r.result === 'TOLERANCE') return;
      if (r.diff_no) return;
      var flowNo = r.our ? r.our.flow_no : r.their.flow_no;
      var bizKey = r.our ? r.our.biz_key : r.their.biz_key;
      var d = {
        diff_no: Core.No.diff(S.simToday), recon_task_no: task.recon_task_no,
        diff_source: 'EXTERNAL', diff_level: 'EXTERNAL', diff_type: r.result,
        partner_no: task.partner_no, biz_key: bizKey, fee_flow_no: flowNo,
        bill_no: r.our ? ((S.eng.flowsByNo[flowNo] || {}).bill_no || '') : '', settle_no: '',
        our_amount: r.our_amount === null ? 0 : r.our_amount,
        their_amount: r.their_amount === null ? 0 : r.their_amount,
        diff_amount: M.r2(r.diff),
        auto_analysis: autoAnalyze(S, r),
        status: 'PENDING', responsibility: 'UNDETERMINED', resolution: '',
        create_time: S.simToday, close_time: '', aging_days: 0
      };
      S.diffs.unshift(d);
      r.diff_no = d.diff_no;
      made.push(d);
    });
    return made;
  }

  global.Recon = {
    TOLERANCE: TOLERANCE, TOLERANCE_MONTH_CAP: TOLERANCE_MONTH_CAP,
    OUT_COLS: OUT_COLS, IN_COLS: IN_COLS, RESULT_META: RESULT_META,
    buildOurRows: buildOurRows, ourCsv: ourCsv, theirCsv: theirCsv, fileName: fileName,
    parseCsv: parseCsv, normalizeIn: normalizeIn, simulateTheirRows: simulateTheirRows,
    match: match, autoAnalyze: autoAnalyze, createDiffs: createDiffs
  };
})(window);
