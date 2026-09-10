/* ==========================================================
 * widget.js —— 桌面小组件页逻辑（v1.1 多账号）
 * 简洁展示：账号与模型名称 / 剩余余额 / 已消耗 Token
 * 与主应用共用 localStorage，数据互通
 * ========================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var settings = Store.loadSettings();
  var refreshing = false;

  function curAccount() {
    return settings.accounts.find(function (a) { return a.id === settings.activeAccountId; }) ||
      settings.accounts[0] || null;
  }

  function accKey(acc) {
    return (acc && acc.key) || '';
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

  /** 用本地缓存立即渲染（不联网） */
  function renderLocal() {
    var acc = curAccount();
    var snap = acc ? Store.getSnapshot(acc.id) : null;
    var used = acc ? Store.sumTokens(acc.id) : { total: 0, count: 0 };

    $('wProvider').textContent = acc ? acc.name : '未添加账号';
    $('wModel').textContent = acc ? (acc.model || Providers.DEEPSEEK.defaultModel) : '去应用里添加 Key';
    $('wUsed').textContent = fmtTokens(used.total);
    $('wCount').textContent = used.count + ' 次';
    $('wDemo').style.display = settings.demo ? '' : 'none';

    var remainEl = $('wRemaining');
    var labelEl = $('wRemainingLabel');
    var remain = snap ? snap.remaining : null;

    if (remain !== null && remain !== undefined) {
      remainEl.textContent = fmtMoney(remain);
      labelEl.textContent = '剩余额度（元）';
      remainEl.classList.toggle('low',
        settings.alertEnabled && settings.alertThreshold > 0 && remain < settings.alertThreshold);
    } else {
      remainEl.textContent = '--';
      labelEl.textContent = acc ? '剩余额度未查询' : '添加账号后展示';
    }

    if (snap && snap.ts) {
      var d = new Date(snap.ts);
      $('wTime').textContent =
        (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
        (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ' 更新';
    } else {
      $('wTime').textContent = '未更新';
    }
  }

  /** 联网刷新额度（演示模式则本地模拟） */
  function refresh(manual) {
    if (refreshing) return;
    var acc = curAccount();

    if (settings.demo && acc) {
      Store.saveSnapshot(acc.id, {
        remaining: +(8 + Math.random() * 22).toFixed(2),
        total: 120, granted: 20, toppedUp: 100,
        currency: 'CNY', isAvailable: true, source: 'demo', message: '演示模式'
      });
      renderLocal();
      return;
    }

    if (!acc || !accKey(acc)) {
      if (manual) showError(acc ? '账号「' + acc.name + '」尚未填写 API Key' : '尚未添加账号，请先打开应用配置');
      renderLocal();
      return;
    }

    refreshing = true;
    $('wRefresh').disabled = true;
    Providers.fetchQuota(acc, settings).then(function (snap) {
      snap.source = 'official';
      Store.saveSnapshot(acc.id, snap);
      $('wError').style.display = 'none';
    }).catch(function (e) {
      if (manual) showError('刷新失败：' + e.message);
    }).finally(function () {
      refreshing = false;
      $('wRefresh').disabled = false;
      renderLocal();
    });
  }

  function showError(msg) {
    var el = $('wError');
    el.textContent = msg;
    el.style.display = '';
  }

  function bind() {
    $('wRefresh').addEventListener('click', function () { refresh(true); });
    $('wOpen').addEventListener('click', function () {
      location.href = './index.html?from=widget';
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refresh(false);
    });
  }

  function start() {
    bind();
    renderLocal();
    refresh(false);                  // 打开即刷新一次
    setInterval(function () {        // 可见时每 60 秒刷新
      if (!document.hidden) refresh(false);
    }, 60000);
  }

  start();
})();
