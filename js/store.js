/* ==========================================================
 * store.js —— 本地数据层（localStorage）
 * v1.1：多账号（DeepSeek 多个 API Key）+ 时间范围聚合 + 消费估算
 * 所有数据只存本机：设置 / 账号密钥 / 消耗记录 / 额度快照
 * ========================================================== */
(function (global) {
  'use strict';

  var K_SETTINGS = 'apimon.settings.v1';
  var K_LOGS     = 'apimon.logs.v1';
  var K_SNAP     = 'apimon.snapshot.v1';

  /** 内置官方价格表（元/百万 Token，高峰时段口径，空闲时段约为其一半）
   *  来源: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ (2026-09) */
  function defaultPriceTable() {
    return [
      { model: 'deepseek-flash', hit: 0.04, miss: 2, out: 8 },
      { model: 'deepseek-v4-pro', hit: 0.30, miss: 9, out: 27 }
    ];
  }

  function defaults() {
    return {
      accounts: [],            // [{id, name, key, base, model}]
      activeAccountId: '',
      refreshMin: 5,           // 自动刷新间隔（分钟），0=手动
      alertEnabled: true,      // 余额告警开关
      alertThreshold: 10,      // 告警阈值（元）
      demo: false,             // 演示模式
      rememberKey: true,       // 记住密钥
      priceTable: defaultPriceTable(),  // [{model, hit, miss, out}]
      proxyPrefix: ''          // 跨域代理前缀（可选）
    };
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { console.warn('[store] 写入失败', e); }
  }

  /** 旧版（单供应商）设置迁移到多账号结构 */
  function migrate(saved) {
    if (saved && saved.keys && saved.keys.deepseek &&
        (!saved.accounts || !saved.accounts.length)) {
      var acc = {
        id: 'acc_' + Date.now(),
        name: '账号 1',
        key: saved.keys.deepseek,
        base: (saved.bases && saved.bases.deepseek) || '',
        model: (saved.models && saved.models.deepseek) || ''
      };
      saved.accounts = [acc];
      saved.activeAccountId = acc.id;
    }
    // 旧版单一输入/输出单价 → 按模型价格表（放弃旧价，采用官方现价）
    if (saved && saved.priceIn !== undefined && !saved.priceTable) {
      delete saved.priceIn;
      delete saved.priceOut;
    }
    return saved;
  }

  function loadSettings() {
    var saved = migrate(readJSON(K_SETTINGS, {}));
    var d = defaults();
    var s = Object.assign(d, saved);
    if (!Array.isArray(s.accounts)) s.accounts = [];
    if (!Array.isArray(s.priceTable) || !s.priceTable.length) s.priceTable = defaultPriceTable();
    return s;
  }
  function saveSettings(s) { writeJSON(K_SETTINGS, s); }

  /* ---------- 消耗记录 ---------- */
  function getLogs() { return readJSON(K_LOGS, []); }

  function addLog(entry) {
    var logs = getLogs();
    logs.push(Object.assign({
      t: Date.now(), accountId: '', model: '',
      prompt: 0, completion: 0, total: 0, cacheHit: 0, note: ''
    }, entry));
    if (logs.length > 2000) logs = logs.slice(logs.length - 2000);
    writeJSON(K_LOGS, logs);
  }

  function clearLogs() { writeJSON(K_LOGS, []); }

  /** 删除演示数据（note === '演示'） */
  function removeDemoLogs() {
    writeJSON(K_LOGS, getLogs().filter(function (l) { return l.note !== '演示'; }));
  }

  function matchAcc(l, accId) {
    if (!accId || accId === 'all') return true;
    return l.accountId === accId;
  }

  /** 汇总：{prompt, completion, total, count}，可按账号过滤 */
  function sumTokens(accId) {
    var logs = getLogs(), r = { prompt: 0, completion: 0, total: 0, count: 0 };
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      if (!matchAcc(l, accId)) continue;
      r.prompt += l.prompt || 0;
      r.completion += l.completion || 0;
      r.total += l.total || 0;
      r.count++;
    }
    return r;
  }

  function todayStart() {
    var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  }

  function todayTokens(accId) {
    var logs = getLogs(), t = todayStart(), total = 0;
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      if (l.t < t || !matchAcc(l, accId)) continue;
      total += l.total || 0;
    }
    return total;
  }

  /**
   * 消耗序列，用于折线图。
   * days = 1  → 今天按小时聚合（24 点）
   * days = 7/14/30 → 最近 N 天按日聚合
   * 返回 [{label, tokens}]
   */
  function usageSeries(days, accId) {
    var out = [], map = {}, i, d, key, l;
    if (days === 1) {
      var start = todayStart();
      for (i = 0; i < 24; i++) {
        key = 'h' + i;
        map[key] = { label: i + '时', tokens: 0 };
        out.push(map[key]);
      }
      var logs = getLogs();
      for (i = 0; i < logs.length; i++) {
        l = logs[i];
        if (l.t < start || !matchAcc(l, accId)) continue;
        map['h' + new Date(l.t).getHours()].tokens += l.total || 0;
      }
      return out;
    }
    var dayStart = todayStart();
    for (i = days - 1; i >= 0; i--) {
      var ts = dayStart - i * 86400000;
      d = new Date(ts);
      key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      map[key] = { label: (d.getMonth() + 1) + '/' + d.getDate(), tokens: 0 };
      out.push(map[key]);
    }
    var all = getLogs();
    var from = dayStart - (days - 1) * 86400000;
    for (i = 0; i < all.length; i++) {
      l = all[i];
      if (l.t < from || !matchAcc(l, accId)) continue;
      d = new Date(l.t);
      var k = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      if (map[k]) map[k].tokens += l.total || 0;
    }
    return out;
  }

  /**
   * 消费金额估算（元），按模型单价表：
   * cost = Σ [ 缓存命中输入×hit价 + 缓存未命中输入×miss价 + 输出×out价 ]
   * - log.cacheHit 缺失的旧记录：输入全按缓存未命中计（保守）
   * - log.model 在价格表中无匹配时，使用价格表第一行
   * accId 为空 = 全部账号
   */
  function estimateCost(accId, priceTable) {
    var table = priceTable && priceTable.length ? priceTable : defaultPriceTable();
    var logs = getLogs(), cost = 0;
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      if (!matchAcc(l, accId)) continue;
      var p = table[0];
      for (var j = 0; j < table.length; j++) {
        if (table[j].model === l.model) { p = table[j]; break; }
      }
      var hit = l.cacheHit || 0;
      var miss = Math.max(0, (l.prompt || 0) - hit);
      cost += hit / 1e6 * (p.hit || 0) +
              miss / 1e6 * (p.miss || 0) +
              (l.completion || 0) / 1e6 * (p.out || 0);
    }
    return cost;
  }

  /* ---------- 额度快照（每次成功查询后缓存，按账号） ---------- */
  function getSnapshot(accId) {
    var all = readJSON(K_SNAP, {});
    return all[accId] || null;
  }
  function saveSnapshot(accId, snap) {
    var all = readJSON(K_SNAP, {});
    snap.ts = Date.now();
    all[accId] = snap;
    writeJSON(K_SNAP, all);
  }
  function clearSnapshots() { writeJSON(K_SNAP, {}); }

  /* ---------- CSV 导出 ---------- */
  function exportCSV(accountNames) {
    var logs = getLogs().slice().reverse(); // 新的在前
    var rows = [['时间', '账号', '模型', '输入tokens', '输出tokens', '合计tokens', '备注']];
    var names = accountNames || {};
    logs.forEach(function (l) {
      rows.push([
        new Date(l.t).toLocaleString('zh-CN'),
        names[l.accountId] || '未知账号',
        l.model || '',
        l.prompt, l.completion, l.total,
        l.note || ''
      ]);
    });
    var csv = '\uFEFF' + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'api-monitor-logs-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- 清空全部 ---------- */
  function resetAll() {
    [K_SETTINGS, K_LOGS, K_SNAP].forEach(function (k) { localStorage.removeItem(k); });
  }

  global.Store = {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    getLogs: getLogs,
    addLog: addLog,
    clearLogs: clearLogs,
    removeDemoLogs: removeDemoLogs,
    sumTokens: sumTokens,
    todayTokens: todayTokens,
    usageSeries: usageSeries,
    estimateCost: estimateCost,
    getSnapshot: getSnapshot,
    saveSnapshot: saveSnapshot,
    clearSnapshots: clearSnapshots,
    exportCSV: exportCSV,
    resetAll: resetAll
  };
})(window);
