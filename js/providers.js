/* ==========================================================
 * providers.js —— DeepSeek 官方接口对接（纯浏览器直连）
 * ----------------------------------------------------------
 * 余额：官方文档接口 GET {base}/user/balance（Bearer 鉴权）
 *   文档: https://api-docs.deepseek.com/zh-cn/api/get-user-balance/
 * 消耗：官方无消费查询接口，应用按本地记录 × 单价估算
 * ========================================================== */
(function (global) {
  'use strict';

  var DEEPSEEK = {
    name: 'DeepSeek',
    keyApplyUrl: 'https://platform.deepseek.com/api_keys',
    consoleUrl: 'https://platform.deepseek.com/usage',
    defaultBase: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner']
  };

  /* ---------------- 工具 ---------------- */

  function baseOf(acc) {
    return ((acc && acc.base) || DEEPSEEK.defaultBase).replace(/\/+$/, '');
  }

  function withProxy(url, settings) {
    var p = (settings && settings.proxyPrefix) || '';
    if (!p) return url;
    return p.replace(/\/+$/, '') + '/' + url.replace(/^https?:\/\//, '');
  }

  /** 统一请求：出错时抛出带友好 message 的 Error */
  function request(url, options) {
    var opts = Object.assign({ headers: { 'Accept': 'application/json' } }, options);
    return fetch(url, opts).then(function (resp) {
      return resp.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* 非 JSON */ }
        if (!resp.ok) {
          var msg = (data && (data.error && data.error.message || data.message || data.msg)) ||
            ('HTTP ' + resp.status);
          if (resp.status === 401 || resp.status === 403) {
            msg = 'API Key 无效或无权限（' + msg + '）';
          }
          var err = new Error(msg);
          err.status = resp.status;
          throw err;
        }
        return data;
      });
    }).catch(function (e) {
      if (e instanceof TypeError) {
        throw new Error('网络请求失败：可能是网络不通或浏览器跨域(CORS)限制，可在设置中修改 API 地址或填写跨域代理前缀');
      }
      throw e;
    });
  }

  /* ---------------- 额度查询 ---------------- */

  /**
   * 查询账号余额，返回归一化快照：
   * { remaining, total, granted, toppedUp, currency, isAvailable, raw }
   * remaining/total 单位为元
   */
  function fetchQuota(acc, settings) {
    var key = (acc && acc.key) || '';
    if (!key) return Promise.reject(new Error('该账号尚未填写 API Key'));

    return request(withProxy(baseOf(acc) + '/user/balance', settings), {
      headers: { 'Authorization': 'Bearer ' + key }
    }).then(function (data) {
      var info = data && data.balance_infos && data.balance_infos[0];
      if (!info) throw new Error('余额接口返回格式异常');
      var total = parseFloat(info.total_balance) || 0;
      return {
        remaining: total,
        total: total,
        granted: parseFloat(info.granted_balance) || 0,
        toppedUp: parseFloat(info.topped_up_balance) || 0,
        currency: info.currency || 'CNY',
        isAvailable: !!(data && data.is_available),
        raw: data
      };
    });
  }

  /* ---------------- 测试调用（顺便记录 token 用量） ---------------- */

  /**
   * 发送一次极小的对话请求，返回：
   * { model, prompt, completion, total, raw }
   */
  function testCall(acc, settings) {
    var key = (acc && acc.key) || '';
    if (!key) return Promise.reject(new Error('该账号尚未填写 API Key'));
    var model = (acc && acc.model) || DEEPSEEK.defaultModel;

    return request(withProxy(baseOf(acc) + '/chat/completions', settings), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 16,
        stream: false
      })
    }).then(function (data) {
      var usage = (data && data.usage) || {};
      // DeepSeek 返回缓存命中/未命中的输入 token 明细
      var hit = usage.prompt_cache_hit_tokens;
      if (hit === undefined && usage.prompt_tokens_details) {
        hit = usage.prompt_tokens_details.cached_tokens;
      }
      var hitN = hit || 0;
      var promptN = usage.prompt_tokens || 0;
      return {
        model: (data && data.model) || model,
        prompt: promptN,
        completion: usage.completion_tokens || 0,
        total: usage.total_tokens || (promptN + (usage.completion_tokens || 0)),
        cacheHit: Math.min(hitN, promptN),
        raw: data
      };
    });
  }

  global.Providers = {
    DEEPSEEK: DEEPSEEK,
    baseOf: baseOf,
    fetchQuota: fetchQuota,
    testCall: testCall
  };
})(window);
