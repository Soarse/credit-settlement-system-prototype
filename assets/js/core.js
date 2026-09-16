/* =============================================================================
 * core.js —— 基础工具层
 * 金额精度、日期与账期、单据号生成、种子随机、轻量 DOM 助手
 * 对应 PRD：2.4.6 金额精度规则 / 2.5 编码与单据号规则 / 6.4.9 精度与舍入
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------
   * 1. 金额与精度
   *    PRD 2.4.6：全程高精度十进制，禁止浮点；单条流水四舍五入至分；
   *    先舍入单条流水再求和；税额倒轧保证三段恒等。
   *    实现：以「分」为整数单位做加减，除法/乘法后立即按 HALF_UP 归整。
   * ------------------------------------------------------------- */
  function pow10(n) { return BigInt('1' + new Array(n + 1).join('0')); }

  /* 将十进制值按指定精度转成整数。计算中不依赖二进制浮点的乘除结果。 */
  function decimalParts(value) {
    var s = String(value === undefined || value === null || value === '' ? 0 : value).trim();
    if (/e/i.test(s)) s = Number(s).toFixed(18).replace(/0+$/, '').replace(/\.$/, '');
    var sign = s.charAt(0) === '-' ? -1n : 1n;
    if (s.charAt(0) === '-' || s.charAt(0) === '+') s = s.slice(1);
    var p = s.split('.');
    return { sign: sign, whole: (p[0] || '0').replace(/\D/g, '') || '0', frac: (p[1] || '').replace(/\D/g, '') };
  }
  function toScaledInt(value, scale) {
    var p = decimalParts(value), frac = p.frac + new Array(scale + 2).join('0');
    var kept = frac.slice(0, scale), next = +(frac.charAt(scale) || '0');
    var n = BigInt(p.whole) * pow10(scale) + BigInt(kept || '0');
    if (next >= 5) n += 1n;
    return p.sign * n;
  }
  function roundedQuotient(num, den) {
    if (den === 0n) return 0n;
    var sign = (num < 0n) !== (den < 0n) ? -1n : 1n;
    var a = num < 0n ? -num : num, b = den < 0n ? -den : den;
    var q = a / b, rem = a % b;
    if (rem * 2n >= b) q += 1n;
    return sign * q;
  }
  function fromScaledInt(n, scale) { return Number(n) / Math.pow(10, scale); }

  var Money = {
    /** HALF_UP 舍入到 scale 位（对负数按绝对值舍入后还原符号） */
    round: function (x, scale) {
      if (scale === undefined) scale = 2;
      if (!isFinite(Number(x))) return 0;
      return fromScaledInt(toScaledInt(x, scale), scale);
    },
    /** 舍入至分 */
    r2: function (x) { return Money.round(x, 2); },
    /** 舍入至 6 位（DECIMAL(20,6) 存储精度） */
    r6: function (x) { return Money.round(x, 6); },
    /** 按分求和，避免逐次累加的浮点漂移 */
    sum: function (arr, pick) {
      var cents = 0n;
      for (var i = 0; i < arr.length; i++) {
        var v = pick ? pick(arr[i], i) : arr[i];
        cents += toScaledInt(v || 0, 2);
      }
      return fromScaledInt(cents, 2);
    },
    /** 十进制乘法/除法，结果按指定精度 HALF_UP。 */
    mul: function (a, b, scale) {
      if (scale === undefined) scale = 2;
      var work = 9, product = toScaledInt(a, work) * toScaledInt(b, work);
      return fromScaledInt(roundedQuotient(product, pow10(work * 2 - scale)), scale);
    },
    div: function (a, b, scale) {
      if (scale === undefined) scale = 2;
      var work = 9, den = toScaledInt(b, work);
      if (den === 0n) return 0;
      var num = toScaledInt(a, work) * pow10(scale);
      return fromScaledInt(roundedQuotient(num, den), scale);
    },
    /** 价税分离（D-08）：不含税 = 含税 ÷ (1+税率) 舍入至分；税额 = 含税 − 不含税（倒轧） */
    splitTax: function (amountIncl, taxRate) {
      var ex = Money.div(amountIncl, Money.r6(1 + Number(taxRate || 0)), 2);
      var tax = Money.r2(amountIncl - ex);
      return { incl: Money.r2(amountIncl), exTax: ex, tax: tax, rate: taxRate };
    },
    /** 千分位格式化 */
    fmt: function (x, scale) {
      if (x === null || x === undefined || isNaN(x)) return '—';
      if (scale === undefined) scale = 2;
      var s = Money.round(x, scale).toFixed(scale);
      var parts = s.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return parts.join('.');
    },
    /** 带符号格式化（用于差额） */
    fmtSigned: function (x, scale) {
      if (x === null || x === undefined || isNaN(x)) return '—';
      var v = Money.round(x, scale === undefined ? 2 : scale);
      return (v > 0 ? '+' : '') + Money.fmt(v, scale);
    },
    /** 人性化大额：亿 / 万 */
    fmtShort: function (x) {
      var a = Math.abs(x);
      if (a >= 1e8) return (x / 1e8).toFixed(2) + ' 亿';
      if (a >= 1e4) return (x / 1e4).toFixed(1) + ' 万';
      return Money.fmt(x, 2);
    },
    pct: function (x, scale) {
      if (x === null || x === undefined || !isFinite(x)) return '—';
      return (x * 100).toFixed(scale === undefined ? 2 : scale) + '%';
    }
  };

  /* ---------------------------------------------------------------
   * 2. 日期与账期
   * ------------------------------------------------------------- */
  var D = {
    parse: function (s) { // 'YYYY-MM-DD' -> Date(UTC 零点)
      var p = String(s).slice(0, 10).split('-');
      return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    },
    fmt: function (d) {
      if (typeof d === 'string') return d.slice(0, 10);
      var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
      return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
    },
    addDays: function (s, n) {
      var d = D.parse(s); d.setUTCDate(d.getUTCDate() + n); return D.fmt(d);
    },
    diffDays: function (a, b) { return Math.round((D.parse(b) - D.parse(a)) / 86400000); },
    /** 左闭右开区间判定 [from, to) */
    inRange: function (d, from, to) { return d >= from && d < to; },
    period: function (s) { return String(s).slice(0, 7); },       // 'YYYY-MM'
    periodStart: function (p) { return p + '-01'; },
    periodEnd: function (p) {
      var y = +p.slice(0, 4), m = +p.slice(5, 7);
      var d = new Date(Date.UTC(y, m, 0));   // 该月最后一天
      return D.fmt(d);
    },
    daysInPeriod: function (p) { return +D.periodEnd(p).slice(8, 10); },
    nextPeriod: function (p) {
      var y = +p.slice(0, 4), m = +p.slice(5, 7) + 1;
      if (m > 12) { m = 1; y++; }
      return y + '-' + (m < 10 ? '0' : '') + m;
    },
    prevPeriod: function (p) {
      var y = +p.slice(0, 4), m = +p.slice(5, 7) - 1;
      if (m < 1) { m = 12; y--; }
      return y + '-' + (m < 10 ? '0' : '') + m;
    },
    /** 遍历自然日 */
    eachDay: function (from, to, fn) {
      var d = from, guard = 0;
      while (d <= to && guard++ < 4000) { fn(d); d = D.addDays(d, 1); }
    },
    isWeekend: function (s) { var w = D.parse(s).getUTCDay(); return w === 0 || w === 6; },
    isHoliday: function (s) {
      return !!(typeof Data !== 'undefined' && Data.HOLIDAYS && Data.HOLIDAYS[s]);
    },
    /** 顺延至下一工作日：跳过周末与法定节假日（7.2.1 holiday_adjust） */
    nextWorkday: function (s) {
      var d = s, g = 0;
      while ((D.isWeekend(d) || D.isHoliday(d)) && g++ < 20) d = D.addDays(d, 1);
      return d;
    },
    cnPeriod: function (p) { return p.slice(0, 4) + ' 年 ' + (+p.slice(5, 7)) + ' 月'; }
  };

  /* ---------------------------------------------------------------
   * 3. 单据号（PRD 2.5）—— 含义位仅供人工识别，逻辑不依赖解析
   * ------------------------------------------------------------- */
  var seqTable = {};
  function nextSeq(key) { seqTable[key] = (seqTable[key] || 0) + 1; return seqTable[key]; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  var No = {
    reset: function () { seqTable = {}; },
    /** EV + YYYYMMDD + 12 位（本系统内部登记号） */
    event: function (date) { return 'EV' + date.replace(/-/g, '') + pad(nextSeq('EV'), 12); },
    /** BS + YYYYMMDD + 12 位 */
    snapshot: function (date) { return 'BS' + date.replace(/-/g, '') + pad(nextSeq('BS'), 12); },
    /** FF + YYYYMMDD + 14 位 */
    feeFlow: function (date) { return 'FF' + date.replace(/-/g, '') + pad(nextSeq('FF'), 14); },
    /** BL + 合作方序列 + YYYYMM + 3 位 */
    bill: function (partnerNo, period) {
      return 'BL' + partnerNo.slice(1) + period.replace('-', '') + pad(nextSeq('BL' + partnerNo + period), 3);
    },
    /** ST + YYYYMMDD + 10 位 */
    settle: function (date) { return 'ST' + date.replace(/-/g, '') + pad(nextSeq('ST'), 10); },
    payInstruction: function (date) { return 'PI' + date.replace(/-/g, '') + pad(nextSeq('PI'), 10); },
    settleFlow: function (date) { return 'SF' + date.replace(/-/g, '') + pad(nextSeq('SF'), 10); },
    receipt: function (date) { return 'RCP' + date.replace(/-/g, '') + pad(nextSeq('RCP'), 8); },
    /** DF + YYYYMMDD + 8 位 */
    diff: function (date) { return 'DF' + date.replace(/-/g, '') + pad(nextSeq('DF'), 8); },
    adjustment: function (date) { return 'ADJ' + date.replace(/-/g, '') + pad(nextSeq('ADJ'), 6); },
    dispute: function (date) { return 'DP' + date.replace(/-/g, '') + pad(nextSeq('DP'), 6); },
    recalc: function (date) { return 'RC' + date.replace(/-/g, '') + pad(nextSeq('RC'), 6); },
    approval: function (date) { return 'APR' + date.replace(/-/g, '') + pad(nextSeq('APR'), 4); },
    trial: function (date) { return 'TB' + date.replace(/-/g, '') + pad(nextSeq('TB'), 6); },
    rule: function () { return 'R' + pad(nextSeq('R'), 12); },
    generic: function (prefix, w) { return prefix + pad(nextSeq(prefix), w || 6); }
  };

  /* ---------------------------------------------------------------
   * 4. 种子随机（保证每次打开数据完全一致，试算/重算结果可复现）
   * ------------------------------------------------------------- */
  function Rng(seed) {
    var s = seed >>> 0 || 88675123;
    this.next = function () { // xorshift32
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  Rng.prototype.int = function (min, max) { return min + Math.floor(this.next() * (max - min + 1)); };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
  Rng.prototype.chance = function (p) { return this.next() < p; };
  Rng.prototype.money = function (min, max, step) {
    step = step || 100;
    var v = min + this.next() * (max - min);
    return Math.round(v / step) * step;
  };

  /* ---------------------------------------------------------------
   * 5. DOM 助手
   * ------------------------------------------------------------- */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'dataset') { for (var d in v) el.dataset[d] = v[d]; }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    (Array.isArray(children) ? children : (children === undefined || children === null ? [] : [children]))
      .forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        el.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
      });
    return el;
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function groupBy(arr, keyFn) {
    var m = {};
    for (var i = 0; i < arr.length; i++) {
      var k = keyFn(arr[i]);
      (m[k] || (m[k] = [])).push(arr[i]);
    }
    return m;
  }
  function uniq(arr) { var s = {}, o = []; arr.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function byId(arr, key) { var m = {}; arr.forEach(function (x) { m[x[key]] = x; }); return m; }
  function deep(o) { return JSON.parse(JSON.stringify(o)); }

  global.Core = {
    Money: Money, M: Money, D: D, No: No, Rng: Rng,
    h: h, esc: esc, groupBy: groupBy, uniq: uniq, byId: byId, deep: deep, pad: pad
  };
})(window);
