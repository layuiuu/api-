/* ==========================================================
 * app.js —— 主界面逻辑（v1.1 多账号）
 * 顶部总览（合计余额 + 消费估算）/ 账号切换 / 时间范围图表
 * 定时刷新 / 告警弹窗 / 测试调用 / 演示模式
 * ========================================================== */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var settings = Store.loadSettings();
  var sessionKeys = {};       // rememberKey 关闭时的会话内存密钥
  var chartRange = 14;        // 图表时间范围：1/7/14/30
  var recFilterAcc = 'all';   // 记录页账号筛选
  var recordsShown = 100;
  var timer = null;
  var refreshing = false;
  var alertFired = false;

  /* ================= 通用 ================= */

  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { t.classList.add('hidden'); }, ms || 2200);
  }

  function fmtMoney(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    var s = Number(v).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return '¥' + s;
  }
  function fmtTokens(n) {
    n = n || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万';
    return String(n);
  }
  function timeAgo(ts) {
    if (!ts) return '';
    var d = Date.now() - ts;
    if (d < 60000) return '刚刚更新';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前更新';
    return '今天 ' + new Date(ts).toTimeString().slice(0, 5) + ' 更新';
  }

  /* ---------- 账号 ---------- */

  function curAccount() {
    return settings.accounts.find(function (a) { return a.id === settings.activeAccountId; }) ||
      settings.accounts[0] || null;
  }

  function accName(id) {
    var a = settings.accounts.find(function (x) { return x.id === id; });
    return a ? a.name : '未知账号';
  }

  function accKey(acc) {
    return (sessionKeys[acc.id] !== undefined ? sessionKeys[acc.id] : acc.key) || '';
  }

  function setAccKey(accId, val) {
    var acc = settings.accounts.find(function (a) { return a.id === accId; });
    if (settings.rememberKey) {
      if (acc) acc.key = val;
      Store.saveSettings(settings);
    } else {
      sessionKeys[accId] = val;
    }
  }

  /* ================= 页面切换 ================= */

  function switchPage(name) {
    $$('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + name); });
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.page === name); });
    window.scrollTo(0, 0);
    if (name === 'home') drawChart();
    if (name === 'records') renderRecords();
    if (name === 'settings') openSettings();
  }

  /* ================= 首页渲染 ================= */

  function renderHome() {
    $('#demoBanner').classList.toggle('hidden', !settings.demo);

    var accs = settings.accounts;
    var acc = curAccount();
    var hasAccount = !!acc;

    $('#keyCard').classList.toggle('hidden', hasAccount || settings.demo);
    $('#overviewWrap').classList.toggle('hidden', !(hasAccount || settings.demo));
    $('#accountRow').classList.toggle('hidden', !(hasAccount || settings.demo));
    $('#statsWrap').classList.toggle('hidden', !(hasAccount || settings.demo));

    /* --- 账号下拉 --- */
    var sel = $('#accountSelect');
    sel.innerHTML = '';
    accs.forEach(function (a) {
      var o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.name + (accKey(a) ? '' : '（未填密钥）');
      sel.appendChild(o);
    });
    if (acc) sel.value = acc.id;

    if (!hasAccount && !settings.demo) {
      // 首次使用引导
      $('#keyCard').classList.remove('hidden');
    }

    /* --- 顶部总览（全部账号） --- */
    var remainSum = 0, hasAny = false;
    accs.forEach(function (a) {
      var s = Store.getSnapshot(a.id);
      if (s && s.remaining !== null && s.remaining !== undefined) {
        remainSum += s.remaining;
        hasAny = true;
      }
    });
    if (settings.demo && acc) {
      var ds = Store.getSnapshot(acc.id);
      if (ds) { remainSum = ds.remaining; hasAny = true; }
    }
    var ovR = $('#ovRemaining');
    ovR.textContent = hasAny ? fmtMoney(remainSum) : '--';
    ovR.classList.toggle('remain-low',
      settings.alertEnabled && settings.alertThreshold > 0 && hasAny && remainSum < settings.alertThreshold);
    $('#ovRemainingSub').textContent =
      accs.length > 1 ? accs.length + ' 个账号合计' : (hasAny ? '元' : '待查询');

    var cost = Store.estimateCost(null, settings.priceTable);
    $('#ovCost').textContent = fmtMoney(cost);
    $('#ovCostSub').textContent = '按模型单价估算（含缓存命中价，默认高峰口径，可在设置修改）';

    if (!hasAccount) { updateLastUpdated(); return; }

    /* --- 当前账号三卡 --- */
    var snap = Store.getSnapshot(acc.id);
    var used = Store.sumTokens(acc.id);

    $('#curAccountName').textContent = acc.name;
    $('#curModel').textContent = acc.model || Providers.DEEPSEEK.defaultModel;

    var remainEl = $('#statRemaining');
    var remain = snap ? snap.remaining : null;
    if (remain !== null && remain !== undefined) {
      remainEl.textContent = fmtMoney(remain);
      $('#statRemainingSub').textContent = (snap.source === 'demo') ? '演示数据' : '元';
      var low = settings.alertEnabled && settings.alertThreshold > 0 && remain < settings.alertThreshold;
      remainEl.classList.toggle('remain-low', low);
      remainEl.classList.toggle('remain-ok', !low);
    } else {
      remainEl.textContent = '--';
      remainEl.classList.remove('remain-ok', 'remain-low');
      $('#statRemainingSub').textContent = '未查询';
    }

    $('#statUsed').textContent = fmtTokens(used.total);
    $('#statUsedSub').textContent = used.count + ' 次调用记录';

    var totalEl = $('#statTotal'), totalSub = $('#statTotalSub');
    if (snap && snap.total !== null && snap.total !== undefined) {
      totalEl.textContent = fmtMoney(snap.total);
      totalSub.textContent = '充值+赠送';
    } else {
      totalEl.textContent = '按量';
      totalSub.textContent = '计费模式';
    }

    var parts = [];
    if (snap) {
      if (snap.granted !== null && snap.granted !== undefined) parts.push('赠送余额 ' + fmtMoney(snap.granted));
      if (snap.toppedUp !== null && snap.toppedUp !== undefined) parts.push('充值余额 ' + fmtMoney(snap.toppedUp));
      if (snap.isAvailable === false) parts.push('⚠️ 账号不可用');
      if (snap.ts) parts.push(timeAgo(snap.ts));
    }
    $('#balanceMeta').textContent = parts.join(' · ');
    updateLastUpdated();

    drawChart();
  }

  function drawChart() {
    var canvas = $('#trendChart');
    if (!canvas || canvas.clientWidth < 20) return; // 页面隐藏时暂不绘制
    var acc = curAccount();
    var accId = acc ? acc.id : null;
    var series = Store.usageSeries(chartRange, accId);
    Chart.drawLineChart(canvas, {
      labels: series.map(function (d) { return d.label; }),
      values: series.map(function (d) { return d.tokens; }),
      color: '#3b82f6'
    });
    $('#chartFootNote').textContent = chartRange === 1
      ? '今天按小时统计（0 时 - 23 时），数据来自本应用的调用记录。'
      : '近 ' + chartRange + ' 天每日消耗，数据来自本应用的调用记录，关闭页面不丢失。';
  }

  function updateLastUpdated() {
    var acc = curAccount();
    var snap = acc ? Store.getSnapshot(acc.id) : null;
    $('#lastUpdated').textContent = snap && snap.ts ? timeAgo(snap.ts) : '';
  }

  /* ================= 额度刷新 ================= */

  function setRefreshing(on) {
    refreshing = on;
    $('#btnRefresh').classList.toggle('spinning', on);
    $('#btnRefresh').disabled = on;
  }

  function refreshQuota(manual) {
    if (refreshing) return;
    var acc = curAccount();

    if (settings.demo) {
      if (!acc) { toast('演示模式下暂无账号，请先在设置开启演示生成'); return; }
      var r = +(8 + Math.random() * 22).toFixed(2);
      Store.saveSnapshot(acc.id, {
        remaining: r, total: 120, granted: 20, toppedUp: 100,
        currency: 'CNY', isAvailable: true, source: 'demo',
        message: '演示模式：数据为本地模拟'
      });
      renderHome();
      checkAlert();
      if (manual) toast('演示数据已刷新');
      return;
    }

    if (!acc) { if (manual) toast('请先添加 DeepSeek API Key'); renderHome(); return; }
    if (!accKey(acc)) { if (manual) toast('账号「' + acc.name + '」尚未填写 API Key'); renderHome(); return; }

    setRefreshing(true);
    Providers.fetchQuota(acc, settings).then(function (snap) {
      snap.source = 'official';
      Store.saveSnapshot(acc.id, snap);
      alertFired = false;
      renderHome();
      checkAlert();
      if (manual) toast(acc.name + ' 剩余 ' + fmtMoney(snap.remaining));
    }).catch(function (e) {
      toast('刷新失败：' + e.message, 4000);
      renderHome();
    }).finally(function () {
      setRefreshing(false);
    });
  }

  /* 自动刷新：每分钟 tick 一次，页面隐藏时暂停 */
  function setupTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (settings.refreshMin <= 0 || document.hidden || refreshing) return;
      var acc = curAccount();
      var snap = acc ? Store.getSnapshot(acc.id) : null;
      var intervalMs = settings.refreshMin * 60000;
      if (!snap || !snap.ts || Date.now() - snap.ts >= intervalMs) {
        refreshQuota(false);
      }
    }, 60000);
  }

  /* ================= 告警 ================= */

  function checkAlert() {
    if (!settings.alertEnabled || settings.alertThreshold <= 0) return;
    var acc = curAccount();
    if (!acc) return;
    var snap = Store.getSnapshot(acc.id);
    var remain = snap ? snap.remaining : null;
    if (remain === null || remain === undefined) return;

    if (remain >= settings.alertThreshold) { alertFired = false; return; }
    if (alertFired) return;
    alertFired = true;

    $('#alertText').textContent =
      '账号「' + acc.name + '」剩余余额 ' + fmtMoney(remain) +
      '，已低于设定阈值 ' + settings.alertThreshold + ' 元，请及时充值或调整用量。';
    $('#alertModal').classList.remove('hidden');

    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('API 余额告警', {
          body: $('#alertText').textContent,
          icon: './icons/icon-192.png'
        });
      } catch (e) { /* 忽略 */ }
    }
  }

  /* ================= 测试调用 ================= */

  function testCall() {
    var acc = curAccount();
    if (settings.demo) { toast('演示模式下无需真实调用'); return; }
    if (!acc) { toast('请先添加 DeepSeek API Key'); renderHome(); return; }
    if (!accKey(acc)) { toast('账号「' + acc.name + '」尚未填写 API Key'); return; }

    var btn = $('#btnTestCall');
    btn.disabled = true;
    btn.textContent = '调用中…';
    Providers.testCall(acc, settings).then(function (r) {
      Store.addLog({
        accountId: acc.id, model: r.model,
        prompt: r.prompt, completion: r.completion, total: r.total,
        cacheHit: r.cacheHit || 0,
        note: '测试调用'
      });
      toast('✓ ' + r.model + ' 连接正常：输入 ' + r.prompt + (r.cacheHit ? '（缓存命中 ' + r.cacheHit + '）' : '') + ' + 输出 ' + r.completion + ' = ' + r.total + ' tokens', 3800);
      renderHome();
    }).catch(function (e) {
      toast('调用失败：' + e.message, 4200);
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = '测试调用';
    });
  }

  /* ================= 记录页 ================= */

  function renderRecords() {
    // 账号筛选下拉
    var sel = $('#recFilter');
    sel.innerHTML = '';
    var optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = '全部账号';
    sel.appendChild(optAll);
    settings.accounts.forEach(function (a) {
      var o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.name;
      sel.appendChild(o);
    });
    sel.value = recFilterAcc;
    if (sel.value !== recFilterAcc) { recFilterAcc = 'all'; sel.value = 'all'; }

    var accId = recFilterAcc === 'all' ? null : recFilterAcc;
    var sum = Store.sumTokens(accId);
    $('#recToday').textContent = fmtTokens(Store.todayTokens(accId));
    $('#recTotal').textContent = fmtTokens(sum.total);
    $('#recCount').textContent = sum.count;

    var logs = Store.getLogs().filter(function (l) {
      return recFilterAcc === 'all' || l.accountId === recFilterAcc;
    }).reverse();

    var list = $('#logList');
    list.innerHTML = '';

    if (!logs.length) {
      $('#logEmpty').classList.remove('hidden');
      return;
    }
    $('#logEmpty').classList.add('hidden');

    logs.slice(0, recordsShown).forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'log-row';
      var d = new Date(l.t);
      var time = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.toTimeString().slice(0, 5);
      row.innerHTML =
        '<div class="log-main">' +
          '<span class="log-model">' + accName(l.accountId) + ' · ' + (l.model || '-') + '</span>' +
          '<span class="log-note' + (l.note === '演示' ? ' tag' : '') + '">' + (l.note || '调用') + '</span>' +
        '</div>' +
        '<div class="log-right">' +
          '<div class="log-tokens"><span class="up">↑' + (l.prompt || 0) + '</span> <span class="down">↓' + (l.completion || 0) + '</span></div>' +
          '<div class="log-time">' + time + ' · 共 ' + l.total +
            (l.cacheHit ? ' · 缓存' + l.cacheHit : '') + '</div>' +
        '</div>';
      list.appendChild(row);
    });

    if (logs.length > recordsShown) {
      var more = document.createElement('button');
      more.className = 'btn ghost';
      more.style.width = '100%';
      more.textContent = '显示更多（还有 ' + (logs.length - recordsShown) + ' 条）';
      more.addEventListener('click', function () { recordsShown += 100; renderRecords(); });
      list.appendChild(more);
    }
  }

  /* ================= 设置页 ================= */

  function renderAccountEditor() {
    var list = $('#accountList');
    list.innerHTML = '';

    if (!settings.accounts.length) {
      list.innerHTML = '<p class="muted small" style="padding:8px 0">还没有账号，点击右上角「＋ 添加账号」。</p>';
      return;
    }

    settings.accounts.forEach(function (acc) {
      var item = document.createElement('div');
      item.className = 'acct-item';
      item.dataset.id = acc.id;
      item.innerHTML =
        '<div class="acct-head">' +
          '<span class="acct-title">' + acc.name + '</span>' +
          '<button class="btn-link danger acct-del">删除</button>' +
        '</div>' +
        '<label class="field"><span>账号名称</span><input class="acct-name" value=""></label>' +
        '<label class="field"><span>API 密钥</span>' +
          '<div class="input-row"><input class="acct-key" type="password" autocomplete="off" spellcheck="false">' +
          '<button class="icon-btn ghost acct-eye" title="显示/隐藏" aria-label="显示或隐藏密钥">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>' +
        '</label>' +
        '<div class="field-pair">' +
          '<label class="field half"><span>API 地址（可选）</span><input class="acct-base" placeholder="https://api.deepseek.com" spellcheck="false"></label>' +
          '<label class="field half"><span>测试模型（可选）</span><input class="acct-model" placeholder="deepseek-chat" spellcheck="false"></label>' +
        '</div>';

      item.querySelector('.acct-name').value = acc.name;
      item.querySelector('.acct-key').value = accKey(acc);
      item.querySelector('.acct-base').value = acc.base || '';
      item.querySelector('.acct-base').placeholder = Providers.DEEPSEEK.defaultBase;
      item.querySelector('.acct-model').value = acc.model || '';
      item.querySelector('.acct-model').placeholder = Providers.DEEPSEEK.defaultModel;

      item.querySelector('.acct-eye').addEventListener('click', function () {
        var inp = item.querySelector('.acct-key');
        inp.type = inp.type === 'password' ? 'text' : 'password';
      });
      item.querySelector('.acct-del').addEventListener('click', function () {
        if (!confirm('删除账号「' + acc.name + '」？其密钥将从本机移除（消耗记录保留）。')) return;
        settings.accounts = settings.accounts.filter(function (a) { return a.id !== acc.id; });
        if (settings.activeAccountId === acc.id) {
          settings.activeAccountId = settings.accounts.length ? settings.accounts[0].id : '';
        }
        delete sessionKeys[acc.id];
        Store.saveSettings(settings);
        renderAccountEditor();
        renderHome();
        toast('账号已删除');
      });

      list.appendChild(item);
    });
  }

  /** 从账号编辑器读取输入到 settings（不写盘） */
  function collectAccountEditor() {
    $$('#accountList .acct-item').forEach(function (item) {
      var acc = settings.accounts.find(function (a) { return a.id === item.dataset.id; });
      if (!acc) return;
      var name = item.querySelector('.acct-name').value.trim();
      var key = item.querySelector('.acct-key').value.trim();
      acc.name = name || acc.name || ('账号 ' + item.dataset.id.slice(-4));
      if (settings.rememberKey) acc.key = key;
      else sessionKeys[acc.id] = key;
      acc.base = item.querySelector('.acct-base').value.trim();
      acc.model = item.querySelector('.acct-model').value.trim();
    });
  }

  /* ---------- 价格表编辑器 ---------- */

  function renderPriceEditor() {
    var list = $('#priceList');
    list.innerHTML = '';
    settings.priceTable.forEach(function (p, idx) {
      var row = document.createElement('div');
      row.className = 'price-item';
      row.dataset.idx = idx;
      row.innerHTML =
        '<div class="price-head">' +
          '<input class="price-model" placeholder="模型名（如 deepseek-flash）" spellcheck="false">' +
          (idx === 0 ? '<span class="price-tag">默认</span>' : '') +
        '</div>' +
        '<div class="field-pair price-grid">' +
          '<label class="field half"><span>输入 · 缓存命中</span><input class="price-hit" type="number" min="0" step="0.01"></label>' +
          '<label class="field half"><span>输入 · 缓存未命中</span><input class="price-miss" type="number" min="0" step="0.01"></label>' +
          '<label class="field half"><span>输出</span><input class="price-out" type="number" min="0" step="0.01"></label>' +
        '</div>';
      row.querySelector('.price-model').value = p.model;
      row.querySelector('.price-hit').value = p.hit;
      row.querySelector('.price-miss').value = p.miss;
      row.querySelector('.price-out').value = p.out;
      list.appendChild(row);
    });
  }

  /** 从价格编辑器读取到 settings（不写盘） */
  function collectPriceEditor() {
    var rows = $$('#priceList .price-item');
    if (!rows.length) return;
    var table = [];
    rows.forEach(function (row) {
      table.push({
        model: row.querySelector('.price-model').value.trim() || ('model-' + row.dataset.idx),
        hit: parseFloat(row.querySelector('.price-hit').value) || 0,
        miss: parseFloat(row.querySelector('.price-miss').value) || 0,
        out: parseFloat(row.querySelector('.price-out').value) || 0
      });
    });
    settings.priceTable = table;
  }

  function openSettings() {
    renderAccountEditor();
    renderPriceEditor();
    $('#setRefresh').value = String(settings.refreshMin);
    $('#setAlert').checked = settings.alertEnabled;
    $('#setThreshold').value = settings.alertThreshold;
    $('#setRemember').checked = settings.rememberKey;
    $('#setDemo').checked = settings.demo;
    $('#setProxy').value = settings.proxyPrefix || '';
  }

  function saveSettingsFromForm(silent) {
    collectAccountEditor();
    collectPriceEditor();
    settings.refreshMin = parseInt($('#setRefresh').value, 10) || 0;
    settings.alertEnabled = $('#setAlert').checked;
    settings.alertThreshold = parseFloat($('#setThreshold').value) || 0;
    settings.rememberKey = $('#setRemember').checked;
    settings.proxyPrefix = $('#setProxy').value.trim();

    // 保证有选中账号
    if (!curAccount() && settings.accounts.length) {
      settings.activeAccountId = settings.accounts[0].id;
    }
    Store.saveSettings(settings);
    setupTimer();
    if (!silent) toast('设置已保存');
  }

  /* ================= 演示模式 ================= */

  function seedDemoData() {
    // 无账号时自动建一个演示账号，保证界面完整可看
    var acc = curAccount();
    if (!acc) {
      acc = { id: 'acc_demo_' + Date.now(), name: '演示账号', key: 'demo', base: '', model: '' };
      settings.accounts.push(acc);
      settings.activeAccountId = acc.id;
      Store.saveSettings(settings);
    }
    Store.removeDemoLogs();
    var now = Date.now();
    for (var day = 29; day >= 0; day--) {
      var calls = 1 + Math.floor(Math.random() * 6);
      for (var c = 0; c < calls; c++) {
        var t = now - day * 86400000 - Math.floor(Math.random() * 10 * 3600000);
        if (t > now) t = now - Math.floor(Math.random() * 3600000);
        var pt = 300 + Math.floor(Math.random() * 4200);
        var ct = 80 + Math.floor(Math.random() * 1200);
        var hit = Math.floor(pt * (0.3 + Math.random() * 0.5));  // 30%~80% 输入命中缓存
        Store.addLog({
          t: t, accountId: acc.id, model: Providers.DEEPSEEK.defaultModel,
          prompt: pt, completion: ct, total: pt + ct, cacheHit: hit, note: '演示'
        });
      }
    }
    Store.saveSnapshot(acc.id, {
      remaining: 23.68, total: 120, granted: 20, toppedUp: 100,
      currency: 'CNY', isAvailable: true, source: 'demo',
      message: '演示模式：数据为本地模拟'
    });
  }

  /* ================= 事件绑定 ================= */

  function bindEvents() {
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchPage(t.dataset.page); });
    });

    $('#btnRefresh').addEventListener('click', function () { refreshQuota(true); });
    $('#btnTestCall').addEventListener('click', testCall);

    /* 账号切换 */
    $('#accountSelect').addEventListener('change', function (e) {
      settings.activeAccountId = e.target.value;
      Store.saveSettings(settings);
      alertFired = false;
      renderHome();
    });
    $('#btnGotoAccounts').addEventListener('click', function () { switchPage('settings'); });
    $('#btnGotoAccounts2').addEventListener('click', function () { switchPage('settings'); });
    $('#btnChangeKey').addEventListener('click', function () { switchPage('settings'); });

    /* 首页快捷录入（首个账号） */
    $('#btnShowKey').addEventListener('click', function () {
      var inp = $('#keyInput');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    $('#btnSaveKey').addEventListener('click', function () {
      var val = $('#keyInput').value.trim();
      if (!val) { toast('请输入 API Key'); return; }
      var n = settings.accounts.length + 1;
      var acc = { id: 'acc_' + Date.now(), name: '账号 ' + n, key: val, base: '', model: '' };
      settings.accounts.push(acc);
      settings.activeAccountId = acc.id;
      Store.saveSettings(settings);
      $('#keyInput').value = '';
      toast('账号已添加，正在查询…');
      refreshQuota(true);
    });

    /* 图表时间范围 */
    $$('#rangeChips .range-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        chartRange = parseInt(chip.dataset.range, 10) || 14;
        $$('#rangeChips .range-chip').forEach(function (c) {
          c.classList.toggle('active', c === chip);
        });
        drawChart();
      });
    });

    /* 记录页 */
    $('#recFilter').addEventListener('change', function (e) {
      recFilterAcc = e.target.value;
      recordsShown = 100;
      renderRecords();
    });
    $('#btnExport').addEventListener('click', exportAndToast);
    $('#btnClearLogs').addEventListener('click', clearLogsConfirm);
    $('#btnExport2').addEventListener('click', exportAndToast);
    $('#btnClearLogs2').addEventListener('click', clearLogsConfirm);

    /* 设置页 */
    $('#btnAddAccount').addEventListener('click', function () {
      collectAccountEditor();
      var acc = {
        id: 'acc_' + Date.now(),
        name: '账号 ' + (settings.accounts.length + 1),
        key: '', base: '', model: ''
      };
      settings.accounts.push(acc);
      Store.saveSettings(settings);
      renderAccountEditor();
      var items = $$('#accountList .acct-item');
      if (items.length) items[items.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('#btnSaveSettings').addEventListener('click', function () {
      saveSettingsFromForm(false);
      renderHome();
    });
    $('#btnTestConn').addEventListener('click', function () {
      saveSettingsFromForm(true);
      var acc = curAccount();
      if (!acc) { toast('请先添加账号'); return; }
      var btn = $('#btnTestConn');
      btn.disabled = true;
      btn.textContent = '测试中…';
      Providers.testCall(acc, settings).then(function (r) {
        Store.addLog({
          accountId: acc.id, model: r.model,
          prompt: r.prompt, completion: r.completion, total: r.total,
          cacheHit: r.cacheHit || 0,
          note: '连接测试'
        });
        toast('✓ 「' + acc.name + '」连接成功：' + r.model + ' · 用量 ' + r.total + ' tokens', 3600);
        renderHome();
      }).catch(function (e) {
        toast('连接失败：' + e.message, 4200);
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = '测试当前账号连接';
      });
    });
    $('#btnResetAll').addEventListener('click', function () {
      if (confirm('将清除全部数据（账号、密钥、记录、设置），确定继续？')) {
        Store.resetAll();
        location.reload();
      }
    });

    /* 演示模式 */
    $('#setDemo').addEventListener('change', function (e) {
      saveSettingsFromForm(true);
      settings.demo = e.target.checked;
      Store.saveSettings(settings);
      if (settings.demo) {
        seedDemoData();
        toast('已开启演示模式');
      } else {
        Store.removeDemoLogs();
        Store.clearSnapshots();
        alertFired = false;
        toast('已关闭演示模式，演示数据已清除');
      }
      renderHome();
    });

    /* 告警弹窗 */
    $('#btnAlertClose').addEventListener('click', function () {
      $('#alertModal').classList.add('hidden');
    });
    $('#btnAlertGoto').addEventListener('click', function () {
      $('#alertModal').classList.add('hidden');
      switchPage('settings');
    });

    /* 回到前台时若数据过期立即刷新 */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && settings.refreshMin > 0) {
        var acc = curAccount();
        var snap = acc ? Store.getSnapshot(acc.id) : null;
        if (!snap || !snap.ts || Date.now() - snap.ts >= settings.refreshMin * 60000) {
          refreshQuota(false);
        } else {
          updateLastUpdated();
        }
      }
    });

    /* 窗口尺寸变化时重绘图表 */
    var resizeH = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeH);
      resizeH = setTimeout(drawChart, 200);
    });
  }

  function exportAndToast() {
    var names = {};
    settings.accounts.forEach(function (a) { names[a.id] = a.name; });
    Store.exportCSV(names);
    toast('已导出 CSV');
  }

  function clearLogsConfirm() {
    if (confirm('确定清空全部消耗记录？此操作不可恢复。')) {
      Store.clearLogs();
      renderRecords();
      renderHome();
      toast('记录已清空');
    }
  }

  /* ================= PWA ================= */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function (e) {
        console.warn('Service Worker 注册失败（不影响使用）:', e);
      });
    });
  }

  /* ================= 启动 ================= */

  function init() {
    // rememberKey 关闭：把持久化的密钥移入会话内存
    if (!settings.rememberKey) {
      settings.accounts.forEach(function (a) {
        sessionKeys[a.id] = a.key;
        a.key = '';
      });
      Store.saveSettings(settings);
    }

    bindEvents();
    Chart.bindTooltip($('#trendChart'));

    renderHome();
    switchPage('home');
    setupTimer();
    registerSW();

    // 启动时自动刷新一次（有账号密钥或演示模式），并立即做一次告警检查
    var acc = curAccount();
    if ((acc && accKey(acc)) || settings.demo) {
      var snap = acc ? Store.getSnapshot(acc.id) : null;
      if (!snap || !snap.ts || Date.now() - snap.ts > 60000) refreshQuota(false);
    }
    checkAlert();
  }

  init();
})();
