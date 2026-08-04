// ==UserScript==
// @name         药大拾间·学习通助手
// @namespace    askAuto
// @version      2.2.14
// @author       shushoujiu
// @description  药大拾间桌面端的学习通助手：自动完成任务点，章节测验与考试由独立答题 AI 作答。
// @icon         https://vitejs.dev/logo.svg
// @match        https://*.chaoxing.com/*
// @match        https://*.nbdlib.cn/*
// @match        https://*.hnsyu.net/*
// @match        https://*.gdhkmooc.com/*
// @require      https://cdn.staticfile.org/vue/3.3.4/vue.global.prod.js
// @require      https://cdn.staticfile.org/vue-demi/0.14.0/index.iife.min.js
// @require      https://cdn.staticfile.org/element-plus-icons-vue/2.1.0/global.iife.min.js
// @require      data:application/javascript,window.Vue%3DVue%3B
// @require      https://cdn.staticfile.org/pinia/2.1.6/pinia.iife.prod.js
// @require      https://cdn.staticfile.org/element-plus/2.3.12/index.full.min.js
// @require      https://cdn.staticfile.org/blueimp-md5/2.19.0/js/md5.min.js
// @require      https://cdn.staticfile.org/jquery/3.7.1/jquery.min.js
// @require      https://cdn.jsdelivr.net/npm/jquery.nicescroll@3.7.6/jquery.nicescroll.min.js
// @resource     element-plus  https://cdn.staticfile.org/element-plus/2.3.12/index.css
// @resource     ttf           https://www.forestpolice.org/ttf/2.0/table.json
// 四个第三方题库的 @connect 已移除：对应代码是上游留下的死分支（getAnswers 只走
// 自定义题库与独立答题 AI），但宿主正是按这里的 @connect 决定脚本能访问哪些域名，
// 留着等于"死代码配活权限"，一旦有路径被走到就会把题面发给第三方。
// @connect      chaoxing.com
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_cpuAIRequest
// @grant        GM_cpuCaptureArea
// @grant        GM_cpuReport
// @run-at       document-end
// 上游的两条 @antifeature（第三方接口广告、第三方题库付费）随对应代码一并移除：
// 本分支只经宿主调用药大拾间的独立答题 AI，没有任何第三方题库与付费入口。
// 上游的 @downloadURL / @updateURL 指向 GreasyFork 原脚本，已移除：本分支由药大拾间
// 随客户端分发并长期维护，留着会让脚本管理器把我们的改动更新回上游版本。
// 原脚本仍可在 https://greasyfork.org/scripts/436994 获取（见 THIRD_PARTY_NOTICES.md）。
// ==/UserScript==

(async function (vue, pinia$1, ElementPlus, md5, $$1) {
  'use strict';

  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => {
    __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
    return value;
  };
  ((e) => {
    const t = GM_getResourceText(e);
    GM_addStyle(t);
  })("element-plus");
  var _GM_getResourceText = (() => "undefined" != typeof GM_getResourceText ? GM_getResourceText : void 0)(), _GM_getValue = (() => "undefined" != typeof GM_getValue ? GM_getValue : void 0)(), _GM_info = (() => "undefined" != typeof GM_info ? GM_info : void 0)(), _GM_setValue = (() => "undefined" != typeof GM_setValue ? GM_setValue : void 0)(), _GM_xmlhttpRequest = (() => "undefined" != typeof GM_xmlhttpRequest ? GM_xmlhttpRequest : void 0)(), _GM_cpuAIRequest = (() => "undefined" != typeof GM_cpuAIRequest ? GM_cpuAIRequest : void 0)(), _GM_cpuCaptureArea = (() => "undefined" != typeof GM_cpuCaptureArea ? GM_cpuCaptureArea : void 0)(), _unsafeWindow = (() => "undefined" != typeof unsafeWindow ? unsafeWindow : void 0)();
  if (!_GM_cpuAIRequest) throw new Error("AI 桥接未注入：请通过药大拾间桌面端运行本脚本");
  // 状态上报是可选能力，宿主没提供就静默跳过，不影响刷课
  var _GM_cpuReport = (() => "undefined" != typeof GM_cpuReport ? GM_cpuReport : void 0)();
  const reportToHost = (kind, text) => { try { _GM_cpuReport && _GM_cpuReport(kind, text); } catch { } };
  let cpuAiRequestBlockedMessage = "";
  let cpuAiRequestPausedUntil = 0;
  let cpuAiLastNotice = { message: "", time: 0 };
  const cpuAiResponseErrorMessage = (response) => {
    try {
      const payload = JSON.parse(response.responseText || "");
      return String(payload?.message || payload?.error?.message || payload?.error || "").trim();
    } catch {
      return "";
    }
  };
  const cpuNotifyAiRequestIssue = (title, message) => {
    const now = Date.now();
    reportToHost("status", message);
    reportToHost("log", message);
    if (cpuAiLastNotice.message === message && now - cpuAiLastNotice.time < 15e3) return;
    cpuAiLastNotice = { message, time: now };
    ElementPlus.ElNotification({
      title,
      message,
      type: "warning",
      duration: 8e3,
      position: "top-right"
    });
  };
  const cpuHandleAiHttpFailure = (response) => {
    if (response.status >= 200 && response.status < 300) return false;
    const serverMessage = cpuAiResponseErrorMessage(response);
    if (response.status === 403 && /额度|点数|用完|不足/.test(serverMessage)) {
      cpuAiRequestBlockedMessage = serverMessage || "今天的 AI 答题额度和点数都已用完";
      cpuNotifyAiRequestIssue(
        "AI 答题额度已用完",
        `${cpuAiRequestBlockedMessage}。助手已停止继续请求；额度恢复或补充点数后，请刷新学习通页面再继续。`
      );
      return true;
    }
    if (response.status === 401 || response.status === 403) {
      cpuAiRequestBlockedMessage = serverMessage || "当前登录或授权状态不可用";
      cpuNotifyAiRequestIssue(
        "AI 答题需要重新登录",
        `${cpuAiRequestBlockedMessage}。请回到药大拾间客户端完成登录，再刷新学习通页面。`
      );
      return true;
    }
    if (response.status === 429) {
      cpuAiRequestPausedUntil = Date.now() + 60e3;
      cpuNotifyAiRequestIssue(
        "AI 请求过于频繁",
        serverMessage || "请求速度过快，助手已暂停 1 分钟后再试。"
      );
      return true;
    }
    if (response.status >= 500) cpuAiRequestPausedUntil = Date.now() + 30e3;
    cpuNotifyAiRequestIssue(
      "AI 答题暂时不可用",
      serverMessage || `服务请求失败（HTTP ${response.status}），请稍后再试。`
    );
    return true;
  };
  const getConfig = () => {
    let config = _GM_getValue("config");
    if (!config) return defaultConfig$1;
    if (typeof config.aiEnabled !== "boolean") {
      config.aiEnabled = true;
      config.aiApiUrl = "";
      config.aiModel = config.aiModel || "deepseek-reasoner";
      _GM_setValue("config", config);
    }
    if (config.deepseekEnabled && !config.aiEnabled) {
      config.aiEnabled = true;
      config.aiApiKey = config.deepseekKey || "";
      config.aiApiUrl = "";
      config.aiModel = config.deepseekModel || "deepseek-reasoner";
      _GM_setValue("config", config);
    }
    return config;
  }, defaultConfig$1 = { debugger: false, autoAnswer: true, autoVideo: true, autoJump: true, autoSubmit: false, thtoken: "", yztoken: "", gptKey: "", gptModel: "gpt-3.5-turbo", gpt: false, gptType: ["0", "1", "2", "3", "4", "5", "6", "7"], interval: 3, answerIntervalMin: 8, answerIntervalMax: 20, submitDelayMin: 20, submitDelayMax: 40, minAccuracy: 1, autoExam: true, hideExam: false, notice: "答案来自独立答题 AI，只发送当前题目内容。访问与额度策略由服务器实时判定；新生限时开放期间免登录、不限次数。请遵守学校的学术规范。", deepseekKey: "", deepseekEnabled: false, deepseekModel: "deepseek-reasoner", customApiUrl: "", customApiKey: "", customApiEnabled: false, aiEnabled: true, aiApiKey: "", aiApiUrl: "", aiModel: "deepseek-reasoner", answerDepth: "low" }, useformStore = pinia$1.defineStore({ id: "formstore", state: () => ({ forminput: getConfig() }) });
  let defaultConfig = getConfig();
  class ServerApi {
    constructor(window2 = _unsafeWindow) {
      // api1~api4（题库海 / 一之 / 言溪 / muketool）已移除：getAnswers 从来不调用它们，
      // 答案只来自自定义题库与独立答题 AI。对应的 @connect 也一并撤了。
      __publicField(this, "windowz", _unsafeWindow);
      this.windowz = window2;
    }
    async defaultRequest(url, method, data = {}, headers = {}, type = false) {
      return type && (headers = { "Content-Type": "POST" == method ? "application/json" : "text/plain", Referer: this.windowz.location.href, v: _GM_info.script.version, key: defaultConfig.thtoken || "", ...headers }), new Promise((resolve, reject) => {
        _GM_xmlhttpRequest({ method, url, data: JSON.stringify(data), headers, timeout: 1e4, onload: (res) => {
          resolve(res);
        }, ontimeout: () => {
          reject("timeout");
        }, onerror: (err) => {
          reject(err);
        } });
      });
    }
    async getAnswerFromCustomApi(questionData) {
      return new Promise((resolve) => {
        const config = getConfig();
        if (!config.customApiEnabled || !config.customApiUrl) {
          resolve({ form: "自定义题库", answer: "" });
          return;
        }

        const requestData = {
          question: questionData.question,
          type: questionData.type,
          options: questionData.options || [],
          key: config.customApiKey || ""
        };

        console.log("自定义题库请求:", config.customApiUrl);

        _GM_xmlhttpRequest({
          method: "POST",
          url: config.customApiUrl,
          data: JSON.stringify(requestData),
          headers: {
            "Content-Type": "application/json",
            "Authorization": config.customApiKey ? "Bearer " + config.customApiKey : ""
          },
          timeout: 1e4,
          onload: (res) => {
            try {
              console.log("自定义题库返回:", res.responseText);
              const data = JSON.parse(res.responseText);
              if (data.code === 1 || data.code === 0 || data.success === true) {
                resolve({ form: "自定义题库", answer: data.answer || data.data?.answer || "" });
              } else {
                resolve({ form: "自定义题库", answer: "" });
              }
            } catch (e) {
              console.error("自定义题库解析错误:", e);
              resolve({ form: "自定义题库", answer: "" });
            }
          },
          ontimeout: () => {
            console.log("自定义题库请求超时");
            resolve({ form: "自定义题库", answer: "" });
          },
          onerror: (err) => {
            console.error("自定义题库请求错误:", err);
            resolve({ form: "自定义题库", answer: "" });
          }
        });
      });
    }
    async getAnswerFromAI(questionData) {
      return new Promise(async (resolve) => {
        const config = getConfig();
        if (!config.aiEnabled) {
          resolve({ form: "AI", answer: "" });
          return;
        }
        if (cpuAiRequestBlockedMessage) {
          console.log("AI答题已暂停:", cpuAiRequestBlockedMessage);
          resolve({ form: "AI", answer: "" });
          return;
        }
        if (Date.now() < cpuAiRequestPausedUntil) {
          console.log("AI答题暂时冷却中，请稍后再试");
          resolve({ form: "AI", answer: "" });
          return;
        }
        const questionTypeId = questionData.type;
        let prompt = "";
        const basePrompt = `你是一位专业的学习辅导老师，具备广泛的知识面，能够解答各类学科和学习问题。只返回 JSON：{"answer":"可直接提交的答案","explanation":"可公开、可验证的简短依据"}。explanation 绝不能混入 answer。`;
        const allOptionsText = (questionData.options || []).map((opt, idx) => `${String.fromCharCode(65 + idx)}.${opt}`).join(" ");
        const optionsPrompt = allOptionsText ? `\n候选项：${allOptionsText}` : "";
        if (questionTypeId === "3") {
          prompt = `${basePrompt}

这是一道判断题。答案字段只填写“正确”或“错误”，解题思路字段用一两句话说明判断依据。

题目：${questionData.question}${optionsPrompt}`;
        } else if (questionTypeId === "1") {
          prompt = `${basePrompt}

这是一道多选题。答案字段只填写所有正确选项字母（如 AB、ACD、BC），解题思路字段简要说明选择依据。

题目：${questionData.question}
选项：${allOptionsText}`;
        } else if (questionTypeId === "2") {
          prompt = `${basePrompt}

这是一道填空题。答案字段直接填写答案内容；如果有多个空，用“|”分隔。解题思路字段简要说明依据。

题目：${questionData.question}${optionsPrompt}`;
        } else if (questionTypeId === "4") {
          prompt = `${basePrompt}

这是一道简答题。答案字段给出简洁准确的作答内容，解题思路字段概括答题要点。

题目：${questionData.question}${optionsPrompt}`;
        } else if (questionTypeId === "5") {
          prompt = `${basePrompt}

这是一道名词解释题。答案字段给出准确解释，解题思路字段概括定义中的关键点。

题目：${questionData.question}${optionsPrompt}`;
        } else if (questionTypeId === "6") {
          prompt = `${basePrompt}

这是一道论述题。答案字段给出完整、有条理的论述，解题思路字段概括组织答案的主线。

题目：${questionData.question}${optionsPrompt}`;
        } else if (questionTypeId === "7") {
          prompt = `${basePrompt}

这是一道计算题。答案字段给出最终答案，解题思路字段给出必要公式和可核验的简要计算过程。

题目：${questionData.question}${optionsPrompt}`;
        } else {
          prompt = `${basePrompt}

这是一道单选题。答案字段只填写正确选项字母，解题思路字段简要说明选择依据。

题目：${questionData.question}
选项：${allOptionsText}`;
        }
        const imageUrls = [];
        const imageTagPattern = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
        const imageSource = `${questionData.question || ""} ${(questionData.options || []).join(" ")}`;
        imageSource.replace(imageTagPattern, (_, src) => {
          try {
            const imageUrl = new URL(src, window.location.href).href;
            if (/^https?:$/i.test(new URL(imageUrl).protocol) && !imageUrls.includes(imageUrl)) imageUrls.push(imageUrl);
          } catch (e) {
            console.log("AI图片地址解析失败:", e);
          }
          return _;
        });
        const imageDataUrls = new Map();
        await Promise.all(imageUrls.map((imageUrl) => new Promise((resolveImage) => {
          _GM_xmlhttpRequest({
            method: "GET",
            url: imageUrl,
            responseType: "arraybuffer",
            timeout: 1e4,
            onload: (response) => {
              try {
                if (response.status < 200 || response.status >= 300 || !response.response) throw new Error(`图片请求失败: ${response.status}`);
                const rawContentType = (response.responseHeaders || "image/jpeg").split(";")[0].trim().toLowerCase();
                const contentType = rawContentType === "image/jpg" ? "image/jpeg" : rawContentType;
                if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)) throw new Error(`不支持的图片类型: ${rawContentType}`);
                imageDataUrls.set(imageUrl, `data:${contentType};base64,${response.response}`);
              } catch (e) {
                console.log("AI图片转换Base64失败:", imageUrl, e);
              }
              resolveImage();
            },
            ontimeout: () => {
              console.log("AI图片下载超时:", imageUrl);
              resolveImage();
            },
            onerror: (error) => {
              console.log("AI图片下载失败:", imageUrl, error);
              resolveImage();
            }
          });
        })));
        const inputContent = [];
        const promptImagePattern = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
        let promptTextStart = 0;
        let promptImageMatch;
        let promptImageIndex = 0;
        while ((promptImageMatch = promptImagePattern.exec(prompt)) !== null) {
          const text = prompt.slice(promptTextStart, promptImageMatch.index).replace(/\s+/g, " ").trim();
          if (text) inputContent.push({ type: "input_text", text });
          try {
            const imageUrl = new URL(promptImageMatch[1], window.location.href).href;
            const imageIndex = imageUrls.indexOf(imageUrl);
            const imageDataUrl = imageDataUrls.get(imageUrl);
            if (imageIndex >= 0 && imageDataUrl) {
              promptImageIndex += 1;
              inputContent.push({ type: "input_text", text: `图片${promptImageIndex}` });
              inputContent.push({ type: "input_image", image_url: imageDataUrl });
            }
          } catch (e) {
            console.log("AI图片地址解析失败:", e);
          }
          promptTextStart = promptImagePattern.lastIndex;
        }
        const remainingText = prompt.slice(promptTextStart).replace(/\s+/g, " ").trim();
        if (remainingText) inputContent.push({ type: "input_text", text: remainingText });
        if (inputContent.length === 0) inputContent.push({ type: "input_text", text: prompt.trim() });
        const requestData = {
          model: config.aiModel || "deepseek-reasoner",
          reasoningEffort: ["low", "high", "max"].includes(config.answerDepth) ? config.answerDepth : "low",
          input: [{ role: "user", content: inputContent }]
        };
        console.log("AI请求内容:", JSON.stringify(requestData, null, 2));
        console.log("AI请求发送中...", "模型:", config.aiModel, "题目类型:", questionTypeId === "3" ? "判断题" : questionTypeId === "1" ? "多选题" : "单选题");
        _GM_cpuAIRequest(requestData).then((response) => {
          const res = { responseText: response.text, status: response.status, statusText: response.statusText };
          try {
              if (cpuHandleAiHttpFailure(res)) {
                resolve({ form: "AI", answer: "" });
                return;
              }
              console.log("AI返回结果:", res.responseText);
              const data = JSON.parse(res.responseText);
              const content = (data.output_text || data.output?.flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text).join("") || data.choices?.[0]?.message?.content || "").trim();
              if (content) {
                const typeNames = { "0": "单选题", "1": "多选题", "2": "填空题", "3": "判断题", "4": "简答题", "5": "名词解释", "6": "论述题", "7": "计算题" };
                const typeName = typeNames[questionTypeId] || "单选题";
                const structuredReply = data.learning_answer;
                const hasStructuredReply = structuredReply && typeof structuredReply === "object";
                const parsedReply = hasStructuredReply
                  ? {
                      answer: String(structuredReply.answer || "").trim(),
                      explanation: String(structuredReply.explanation || "").trim()
                    }
                  : parseLearningAiReply(content);
                const answerContent = parsedReply.answer;
                const explanation = parsedReply.explanation;
                if (isLearningNonAnswerFeedback(answerContent)) {
                  console.log("AI 返回的是题面缺失状态说明，已拦截且不会写入答案框:", answerContent);
                  resolve({ form: "AI", answer: "", explanation: explanation || answerContent });
                  return;
                }
                if (questionTypeId === "3") {
                  const isTrue = /正确|对|是|√|true/i.test(answerContent);
                  const isFalse = /错误|错|否|×|false/i.test(answerContent);
                  if (isTrue || isFalse) {
                    const answerText = isTrue ? "正确" : "错误";
                    console.log(`AI解析成功(${typeName})，答案:`, answerText);
                    resolve({ form: "AI", answer: [answerText], displayAnswer: answerText, explanation });
                  } else {
                    console.log("AI返回内容未匹配到判断结果:", content);
                    resolve({ form: "AI", answer: "" });
                  }
                } else if (questionTypeId === "1") {
                  const maxLetter = String.fromCharCode(64 + Math.min(26, questionData.options.length));
                  const answerMatch = answerContent.toUpperCase().match(new RegExp(`[A-${maxLetter}]+`));
                  if (answerMatch) {
                    const answerLetters = answerMatch[0];
                    const answerOptions = [];
                    for (let letter of answerLetters) {
                      const answerIndex = letter.charCodeAt(0) - 65;
                      if (answerIndex >= 0 && answerIndex < questionData.options.length) {
                        answerOptions.push(questionData.options[answerIndex]);
                      }
                    }
                    if (answerOptions.length > 0) {
                      console.log(`AI解析成功(${typeName})，答案:`, answerLetters);
                      resolve({ form: "AI", answer: answerOptions, displayAnswer: `${answerLetters.split("").join("、")} · ${answerOptions.join("；")}`, optionLetters: answerLetters, explanation });
                    } else {
                      console.log("AI返回的选项超出范围");
                      resolve({ form: "AI", answer: "" });
                    }
                  } else {
                    console.log("AI返回内容未匹配到选项字母:", content);
                    resolve({ form: "AI", answer: "" });
                  }
                } else if (questionTypeId === "0") {
                  const maxLetter = String.fromCharCode(64 + Math.min(26, questionData.options.length));
                  const answerMatch = answerContent.toUpperCase().match(new RegExp(`[A-${maxLetter}]`));
                  const normalizedAnswer = formatLearningDisplayText(answerContent).replace(/\s+/g, "").toLowerCase();
                  let answerIndex = answerMatch ? answerMatch[0].charCodeAt(0) - 65 : questionData.options.findIndex((option) => {
                    const normalizedOption = formatLearningDisplayText(option).replace(/\s+/g, "").toLowerCase();
                    return normalizedOption && (normalizedAnswer === normalizedOption || normalizedAnswer.includes(normalizedOption) || normalizedOption.includes(normalizedAnswer));
                  });
                  if (answerIndex >= 0 && answerIndex < questionData.options.length) {
                    const answerLetter = String.fromCharCode(65 + answerIndex), optionText = questionData.options[answerIndex];
                    console.log(`AI解析成功(${typeName})，答案:`, answerLetter);
                    resolve({ form: "AI", answer: [optionText], displayAnswer: `${answerLetter}. ${optionText}`, optionLetters: answerLetter, explanation });
                  } else {
                    console.log("AI返回内容未匹配到选项字母或选项内容:", content);
                    resolve({ form: "AI", answer: "" });
                  }
                } else {
                  const textAnswers = answerContent.split("|").map(s => s.trim()).filter(s => s.length > 0);
                  if (textAnswers.length > 0) {
                    console.log(`AI解析成功(${typeName})，答案:`, textAnswers);
                    resolve({ form: "AI", answer: textAnswers, displayAnswer: textAnswers.join("\n"), explanation });
                  } else if (answerContent.length > 0) {
                    console.log(`AI解析成功(${typeName})，答案:`, answerContent);
                    resolve({ form: "AI", answer: [answerContent], displayAnswer: answerContent, explanation });
                  } else {
                    console.log("AI返回内容为空");
                    resolve({ form: "AI", answer: "" });
                  }
                }
              } else {
                console.log("AI返回格式异常:", data);
                resolve({ form: "AI", answer: "" });
              }
            } catch (e) {
              console.log("AI解析错误:", e);
              resolve({ form: "AI", answer: "" });
            }
        }).catch((error) => {
          const message = String(error?.message || error || "AI 请求失败");
          cpuAiRequestPausedUntil = Date.now() + 30e3;
          cpuNotifyAiRequestIssue("AI 答题请求失败", `${message}。助手已暂停 30 秒，请稍后再试。`);
          console.log("AI请求错误:", error);
          resolve({ form: "AI", answer: "" });
        });
      });
    }
    async s(questionList, url) {
      return new Promise(async (resolve) => {
        const ques = { questionList, url };
        await this.defaultRequest(`${this.api1}/save1`, "POST", ques, { "Content-Type": "application/json" }).then((response) => {
          resolve();
        }).catch((e) => {
          resolve();
        });
      });
    }
    async s2(data) {
      data.url && this.defaultRequest(data.url, "GET", null, {}).then(async (response) => {
        const html = response.responseText;
        let document1, questionList, questionListHtml;
        document1 = new DOMParser().parseFromString(html, "text/html"), questionList = document1.getElementsByClassName("Py-mian1"), questionListHtml = [];
        for (let i = 0; i < questionList.length; i++)
          try {
            if (0 === i)
              continue;
            let questionTitle = removeHtml(questionList[i].getElementsByClassName("Py-m1-title")[0].innerHTML), questionType$1 = questionTitle.match(/\[(.*?)\]/)[1];
            if ("单选题" === questionType$1 || "多选题" === questionType$1) {
              questionTitle = questionTitle.replace(/[0-9]{1,3}.\s/gi, "").replace(/(^\s*)|(\s*$)/g, "").replace(/^【.*?】\s*/, "").replace(/\[(.*?)\]\s*/, "").replace(/\s*（\d+\.\d+分）$/, "");
              let optionHtml = $(questionList[i]).find("ul.answerList li.clearfix"), optionText = [];
              optionHtml.each(function(index, item) {
                let abcd = String.fromCharCode(65 + index) + ".", optionTemp = removeHtml(item.innerHTML);
                0 == optionTemp.indexOf(abcd) && (optionTemp = optionTemp.replace(abcd, "").trim()), optionText.push(optionTemp);
              }), questionListHtml.push({ question: questionTitle, type: questionType[questionType$1], options: optionText, questionData: questionList[i].innerHTML });
            }
          } catch (e) {
            continue;
          }
        let postData = { questionList: questionListHtml, url: data.url };
        await this.defaultRequest(data.url1, "POST", postData, {}, true).then().catch();
      }).catch();
    }
  }
  function getDefaultExportFromCjs(x) {
    return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x.default : x;
  }
  var Typr = { parse: function(buff) {
    var bin = Typr._bin, data = new Uint8Array(buff), offset = 0;
    bin.readFixed(data, offset), offset += 4;
    var numTables = bin.readUshort(data, offset);
    offset += 2, bin.readUshort(data, offset), offset += 2, bin.readUshort(data, offset), offset += 2, bin.readUshort(data, offset), offset += 2;
    for (var tags = ["cmap", "head", "hhea", "maxp", "hmtx", "name", "OS/2", "post", "loca", "glyf", "kern", "CFF ", "GPOS", "GSUB", "SVG "], obj = { _data: data }, tabs = {}, i = 0; i < numTables; i++) {
      var tag = bin.readASCII(data, offset, 4);
      offset += 4, bin.readUint(data, offset), offset += 4;
      var toffset = bin.readUint(data, offset);
      offset += 4;
      var length = bin.readUint(data, offset);
      offset += 4, tabs[tag] = { offset: toffset, length };
    }
    for (i = 0; i < tags.length; i++) {
      var t = tags[i];
      tabs[t] && (obj[t.trim()] = Typr[t.trim()].parse(data, tabs[t].offset, tabs[t].length, obj));
    }
    return obj;
  }, _tabOffset: function(data, tab) {
    for (var bin = Typr._bin, numTables = bin.readUshort(data, 4), offset = 12, i = 0; i < numTables; i++) {
      var tag = bin.readASCII(data, offset, 4);
      offset += 4, bin.readUint(data, offset), offset += 4;
      var toffset = bin.readUint(data, offset);
      if (offset += 4, bin.readUint(data, offset), offset += 4, tag == tab)
        return toffset;
    }
    return 0;
  } };
  Typr._bin = { readFixed: function(data, o) {
    return (data[o] << 8 | data[o + 1]) + (data[o + 2] << 8 | data[o + 3]) / 65540;
  }, readF2dot14: function(data, o) {
    return Typr._bin.readShort(data, o) / 16384;
  }, readInt: function(buff, p) {
    var a = Typr._bin.t.uint8;
    return a[0] = buff[p + 3], a[1] = buff[p + 2], a[2] = buff[p + 1], a[3] = buff[p], Typr._bin.t.int32[0];
  }, readInt8: function(buff, p) {
    return Typr._bin.t.uint8[0] = buff[p], Typr._bin.t.int8[0];
  }, readShort: function(buff, p) {
    var a = Typr._bin.t.uint8;
    return a[1] = buff[p], a[0] = buff[p + 1], Typr._bin.t.int16[0];
  }, readUshort: function(buff, p) {
    return buff[p] << 8 | buff[p + 1];
  }, readUshorts: function(buff, p, len) {
    for (var arr = [], i = 0; i < len; i++)
      arr.push(Typr._bin.readUshort(buff, p + 2 * i));
    return arr;
  }, readUint: function(buff, p) {
    var a = Typr._bin.t.uint8;
    return a[3] = buff[p], a[2] = buff[p + 1], a[1] = buff[p + 2], a[0] = buff[p + 3], Typr._bin.t.uint32[0];
  }, readUint64: function(buff, p) {
    return 4294967296 * Typr._bin.readUint(buff, p) + Typr._bin.readUint(buff, p + 4);
  }, readASCII: function(buff, p, l) {
    for (var s = "", i = 0; i < l; i++)
      s += String.fromCharCode(buff[p + i]);
    return s;
  }, readUnicode: function(buff, p, l) {
    for (var s = "", i = 0; i < l; i++) {
      var c = buff[p++] << 8 | buff[p++];
      s += String.fromCharCode(c);
    }
    return s;
  }, _tdec: window.TextDecoder ? new window.TextDecoder() : null, readUTF8: function(buff, p, l) {
    var tdec = Typr._bin._tdec;
    return tdec && 0 == p && l == buff.length ? tdec.decode(buff) : Typr._bin.readASCII(buff, p, l);
  }, readBytes: function(buff, p, l) {
    for (var arr = [], i = 0; i < l; i++)
      arr.push(buff[p + i]);
    return arr;
  }, readASCIIArray: function(buff, p, l) {
    for (var s = [], i = 0; i < l; i++)
      s.push(String.fromCharCode(buff[p + i]));
    return s;
  } }, Typr._bin.t = { buff: new ArrayBuffer(8) }, Typr._bin.t.int8 = new Int8Array(Typr._bin.t.buff), Typr._bin.t.uint8 = new Uint8Array(Typr._bin.t.buff), Typr._bin.t.int16 = new Int16Array(Typr._bin.t.buff), Typr._bin.t.uint16 = new Uint16Array(Typr._bin.t.buff), Typr._bin.t.int32 = new Int32Array(Typr._bin.t.buff), Typr._bin.t.uint32 = new Uint32Array(Typr._bin.t.buff), Typr._lctf = {}, Typr._lctf.parse = function(data, offset, length, font, subt) {
    var bin = Typr._bin, obj = {}, offset0 = offset;
    bin.readFixed(data, offset), offset += 4;
    var offScriptList = bin.readUshort(data, offset);
    offset += 2;
    var offFeatureList = bin.readUshort(data, offset);
    offset += 2;
    var offLookupList = bin.readUshort(data, offset);
    return offset += 2, obj.scriptList = Typr._lctf.readScriptList(data, offset0 + offScriptList), obj.featureList = Typr._lctf.readFeatureList(data, offset0 + offFeatureList), obj.lookupList = Typr._lctf.readLookupList(data, offset0 + offLookupList, subt), obj;
  }, Typr._lctf.readLookupList = function(data, offset, subt) {
    var bin = Typr._bin, offset0 = offset, obj = [], count = bin.readUshort(data, offset);
    offset += 2;
    for (var i = 0; i < count; i++) {
      var noff = bin.readUshort(data, offset);
      offset += 2;
      var lut = Typr._lctf.readLookupTable(data, offset0 + noff, subt);
      obj.push(lut);
    }
    return obj;
  }, Typr._lctf.readLookupTable = function(data, offset, subt) {
    var bin = Typr._bin, offset0 = offset, obj = { tabs: [] };
    obj.ltype = bin.readUshort(data, offset), offset += 2, obj.flag = bin.readUshort(data, offset), offset += 2;
    var cnt = bin.readUshort(data, offset);
    offset += 2;
    for (var i = 0; i < cnt; i++) {
      var noff = bin.readUshort(data, offset);
      offset += 2;
      var tab = subt(data, obj.ltype, offset0 + noff);
      obj.tabs.push(tab);
    }
    return obj;
  }, Typr._lctf.numOfOnes = function(n) {
    for (var num = 0, i = 0; i < 32; i++)
      0 != (n >>> i & 1) && num++;
    return num;
  }, Typr._lctf.readClassDef = function(data, offset) {
    var bin = Typr._bin, obj = [], format = bin.readUshort(data, offset);
    if (offset += 2, 1 == format) {
      var startGlyph = bin.readUshort(data, offset);
      offset += 2;
      var glyphCount = bin.readUshort(data, offset);
      offset += 2;
      for (var i = 0; i < glyphCount; i++)
        obj.push(startGlyph + i), obj.push(startGlyph + i), obj.push(bin.readUshort(data, offset)), offset += 2;
    }
    if (2 == format) {
      var count = bin.readUshort(data, offset);
      offset += 2;
      for (i = 0; i < count; i++)
        obj.push(bin.readUshort(data, offset)), offset += 2, obj.push(bin.readUshort(data, offset)), offset += 2, obj.push(bin.readUshort(data, offset)), offset += 2;
    }
    return obj;
  }, Typr._lctf.getInterval = function(tab, val) {
    for (var i = 0; i < tab.length; i += 3) {
      var start = tab[i], end = tab[i + 1];
      if (tab[i + 2], start <= val && val <= end)
        return i;
    }
    return -1;
  }, Typr._lctf.readValueRecord = function(data, offset, valFmt) {
    var bin = Typr._bin, arr = [];
    return arr.push(1 & valFmt ? bin.readShort(data, offset) : 0), offset += 1 & valFmt ? 2 : 0, arr.push(2 & valFmt ? bin.readShort(data, offset) : 0), offset += 2 & valFmt ? 2 : 0, arr.push(4 & valFmt ? bin.readShort(data, offset) : 0), offset += 4 & valFmt ? 2 : 0, arr.push(8 & valFmt ? bin.readShort(data, offset) : 0), offset += 8 & valFmt ? 2 : 0, arr;
  }, Typr._lctf.readCoverage = function(data, offset) {
    var bin = Typr._bin, cvg = {};
    cvg.fmt = bin.readUshort(data, offset), offset += 2;
    var count = bin.readUshort(data, offset);
    return offset += 2, 1 == cvg.fmt && (cvg.tab = bin.readUshorts(data, offset, count)), 2 == cvg.fmt && (cvg.tab = bin.readUshorts(data, offset, 3 * count)), cvg;
  }, Typr._lctf.coverageIndex = function(cvg, val) {
    var tab = cvg.tab;
    if (1 == cvg.fmt)
      return tab.indexOf(val);
    if (2 == cvg.fmt) {
      var ind = Typr._lctf.getInterval(tab, val);
      if (-1 != ind)
        return tab[ind + 2] + (val - tab[ind]);
    }
    return -1;
  }, Typr._lctf.readFeatureList = function(data, offset) {
    var bin = Typr._bin, offset0 = offset, obj = [], count = bin.readUshort(data, offset);
    offset += 2;
    for (var i = 0; i < count; i++) {
      var tag = bin.readASCII(data, offset, 4);
      offset += 4;
      var noff = bin.readUshort(data, offset);
      offset += 2, obj.push({ tag: tag.trim(), tab: Typr._lctf.readFeatureTable(data, offset0 + noff) });
    }
    return obj;
  }, Typr._lctf.readFeatureTable = function(data, offset) {
    var bin = Typr._bin;
    bin.readUshort(data, offset), offset += 2;
    var lookupCount = bin.readUshort(data, offset);
    offset += 2;
    for (var indices = [], i = 0; i < lookupCount; i++)
      indices.push(bin.readUshort(data, offset + 2 * i));
    return indices;
  }, Typr._lctf.readScriptList = function(data, offset) {
    var bin = Typr._bin, offset0 = offset, obj = {}, count = bin.readUshort(data, offset);
    offset += 2;
    for (var i = 0; i < count; i++) {
      var tag = bin.readASCII(data, offset, 4);
      offset += 4;
      var noff = bin.readUshort(data, offset);
      offset += 2, obj[tag.trim()] = Typr._lctf.readScriptTable(data, offset0 + noff);
    }
    return obj;
  }, Typr._lctf.readScriptTable = function(data, offset) {
    var bin = Typr._bin, offset0 = offset, obj = {}, defLangSysOff = bin.readUshort(data, offset);
    offset += 2, obj.default = Typr._lctf.readLangSysTable(data, offset0 + defLangSysOff);
    var langSysCount = bin.readUshort(data, offset);
    offset += 2;
    for (var i = 0; i < langSysCount; i++) {
      var tag = bin.readASCII(data, offset, 4);
      offset += 4;
      var langSysOff = bin.readUshort(data, offset);
      offset += 2, obj[tag.trim()] = Typr._lctf.readLangSysTable(data, offset0 + langSysOff);
    }
    return obj;
  }, Typr._lctf.readLangSysTable = function(data, offset) {
    var bin = Typr._bin, obj = {};
    bin.readUshort(data, offset), offset += 2, obj.reqFeature = bin.readUshort(data, offset), offset += 2;
    var featureCount = bin.readUshort(data, offset);
    return offset += 2, obj.features = bin.readUshorts(data, offset, featureCount), obj;
  }, Typr.CFF = {}, Typr.CFF.parse = function(data, offset, length) {
    var bin = Typr._bin;
    (data = new Uint8Array(data.buffer, offset, length))[offset = 0], data[++offset], data[++offset], data[++offset], offset++;
    var ninds = [];
    offset = Typr.CFF.readIndex(data, offset, ninds);
    for (var names = [], i = 0; i < ninds.length - 1; i++)
      names.push(bin.readASCII(data, offset + ninds[i], ninds[i + 1] - ninds[i]));
    offset += ninds[ninds.length - 1];
    var tdinds = [];
    offset = Typr.CFF.readIndex(data, offset, tdinds);
    var topDicts = [];
    for (i = 0; i < tdinds.length - 1; i++)
      topDicts.push(Typr.CFF.readDict(data, offset + tdinds[i], offset + tdinds[i + 1]));
    offset += tdinds[tdinds.length - 1];
    var topdict = topDicts[0], sinds = [];
    offset = Typr.CFF.readIndex(data, offset, sinds);
    var strings = [];
    for (i = 0; i < sinds.length - 1; i++)
      strings.push(bin.readASCII(data, offset + sinds[i], sinds[i + 1] - sinds[i]));
    if (offset += sinds[sinds.length - 1], Typr.CFF.readSubrs(data, offset, topdict), topdict.CharStrings) {
      offset = topdict.CharStrings;
      sinds = [];
      offset = Typr.CFF.readIndex(data, offset, sinds);
      var cstr = [];
      for (i = 0; i < sinds.length - 1; i++)
        cstr.push(bin.readBytes(data, offset + sinds[i], sinds[i + 1] - sinds[i]));
      topdict.CharStrings = cstr;
    }
    topdict.Encoding && (topdict.Encoding = Typr.CFF.readEncoding(data, topdict.Encoding, topdict.CharStrings.length)), topdict.charset && (topdict.charset = Typr.CFF.readCharset(data, topdict.charset, topdict.CharStrings.length)), topdict.Private && (offset = topdict.Private[1], topdict.Private = Typr.CFF.readDict(data, offset, offset + topdict.Private[0]), topdict.Private.Subrs && Typr.CFF.readSubrs(data, offset + topdict.Private.Subrs, topdict.Private));
    var obj = {};
    for (var p in topdict)
      -1 != ["FamilyName", "FullName", "Notice", "version", "Copyright"].indexOf(p) ? obj[p] = strings[topdict[p] - 426 + 35] : obj[p] = topdict[p];
    return obj;
  }, Typr.CFF.readSubrs = function(data, offset, obj) {
    var bin = Typr._bin, gsubinds = [];
    offset = Typr.CFF.readIndex(data, offset, gsubinds);
    var bias, nSubrs = gsubinds.length;
    bias = nSubrs < 1240 ? 107 : nSubrs < 33900 ? 1131 : 32768, obj.Bias = bias, obj.Subrs = [];
    for (var i = 0; i < gsubinds.length - 1; i++)
      obj.Subrs.push(bin.readBytes(data, offset + gsubinds[i], gsubinds[i + 1] - gsubinds[i]));
  }, Typr.CFF.tableSE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 0, 111, 112, 113, 114, 0, 115, 116, 117, 118, 119, 120, 121, 122, 0, 123, 0, 124, 125, 126, 127, 128, 129, 130, 131, 0, 132, 133, 0, 134, 135, 136, 137, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 138, 0, 139, 0, 0, 0, 0, 140, 141, 142, 143, 0, 0, 0, 0, 0, 144, 0, 0, 0, 145, 0, 0, 146, 147, 148, 149, 0, 0, 0, 0], Typr.CFF.glyphByUnicode = function(cff, code) {
    for (var i = 0; i < cff.charset.length; i++)
      if (cff.charset[i] == code)
        return i;
    return -1;
  }, Typr.CFF.glyphBySE = function(cff, charcode) {
    return charcode < 0 || charcode > 255 ? -1 : Typr.CFF.glyphByUnicode(cff, Typr.CFF.tableSE[charcode]);
  }, Typr.CFF.readEncoding = function(data, offset, num) {
    Typr._bin;
    var array = [".notdef"], format = data[offset];
    if (offset++, 0 != format)
      throw "error: unknown encoding format: " + format;
    var nCodes = data[offset];
    offset++;
    for (var i = 0; i < nCodes; i++)
      array.push(data[offset + i]);
    return array;
  }, Typr.CFF.readCharset = function(data, offset, num) {
    var bin = Typr._bin, charset = [".notdef"], format = data[offset];
    if (offset++, 0 == format)
      for (var i = 0; i < num; i++) {
        var first = bin.readUshort(data, offset);
        offset += 2, charset.push(first);
      }
    else {
      if (1 != format && 2 != format)
        throw "error: format: " + format;
      for (; charset.length < num; ) {
        first = bin.readUshort(data, offset);
        offset += 2;
        var nLeft = 0;
        1 == format ? (nLeft = data[offset], offset++) : (nLeft = bin.readUshort(data, offset), offset += 2);
        for (i = 0; i <= nLeft; i++)
          charset.push(first), first++;
      }
    }
    return charset;
  }, Typr.CFF.readIndex = function(data, offset, inds) {
    var bin = Typr._bin, count = bin.readUshort(data, offset), offsize = data[offset += 2];
    if (offset++, 1 == offsize)
      for (var i = 0; i < count + 1; i++)
        inds.push(data[offset + i]);
    else if (2 == offsize)
      for (i = 0; i < count + 1; i++)
        inds.push(bin.readUshort(data, offset + 2 * i));
    else if (3 == offsize)
      for (i = 0; i < count + 1; i++)
        inds.push(16777215 & bin.readUint(data, offset + 3 * i - 1));
    else if (0 != count)
      throw "unsupported offset size: " + offsize + ", count: " + count;
    return (offset += (count + 1) * offsize) - 1;
  }, Typr.CFF.getCharString = function(data, offset, o) {
    var bin = Typr._bin, b0 = data[offset], b1 = data[offset + 1];
    data[offset + 2], data[offset + 3], data[offset + 4];
    var vs = 1, op = null, val = null;
    b0 <= 20 && (op = b0, vs = 1), 12 == b0 && (op = 100 * b0 + b1, vs = 2), 21 <= b0 && b0 <= 27 && (op = b0, vs = 1), 28 == b0 && (val = bin.readShort(data, offset + 1), vs = 3), 29 <= b0 && b0 <= 31 && (op = b0, vs = 1), 32 <= b0 && b0 <= 246 && (val = b0 - 139, vs = 1), 247 <= b0 && b0 <= 250 && (val = 256 * (b0 - 247) + b1 + 108, vs = 2), 251 <= b0 && b0 <= 254 && (val = 256 * -(b0 - 251) - b1 - 108, vs = 2), 255 == b0 && (val = bin.readInt(data, offset + 1) / 65535, vs = 5), o.val = null != val ? val : "o" + op, o.size = vs;
  }, Typr.CFF.readCharString = function(data, offset, length) {
    for (var end = offset + length, bin = Typr._bin, arr = []; offset < end; ) {
      var b0 = data[offset], b1 = data[offset + 1];
      data[offset + 2], data[offset + 3], data[offset + 4];
      var vs = 1, op = null, val = null;
      b0 <= 20 && (op = b0, vs = 1), 12 == b0 && (op = 100 * b0 + b1, vs = 2), 19 != b0 && 20 != b0 || (op = b0, vs = 2), 21 <= b0 && b0 <= 27 && (op = b0, vs = 1), 28 == b0 && (val = bin.readShort(data, offset + 1), vs = 3), 29 <= b0 && b0 <= 31 && (op = b0, vs = 1), 32 <= b0 && b0 <= 246 && (val = b0 - 139, vs = 1), 247 <= b0 && b0 <= 250 && (val = 256 * (b0 - 247) + b1 + 108, vs = 2), 251 <= b0 && b0 <= 254 && (val = 256 * -(b0 - 251) - b1 - 108, vs = 2), 255 == b0 && (val = bin.readInt(data, offset + 1) / 65535, vs = 5), arr.push(null != val ? val : "o" + op), offset += vs;
    }
    return arr;
  }, Typr.CFF.readDict = function(data, offset, end) {
    for (var bin = Typr._bin, dict = {}, carr = []; offset < end; ) {
      var b0 = data[offset], b1 = data[offset + 1];
      data[offset + 2], data[offset + 3], data[offset + 4];
      var vs = 1, key = null, val = null;
      if (28 == b0 && (val = bin.readShort(data, offset + 1), vs = 3), 29 == b0 && (val = bin.readInt(data, offset + 1), vs = 5), 32 <= b0 && b0 <= 246 && (val = b0 - 139, vs = 1), 247 <= b0 && b0 <= 250 && (val = 256 * (b0 - 247) + b1 + 108, vs = 2), 251 <= b0 && b0 <= 254 && (val = 256 * -(b0 - 251) - b1 - 108, vs = 2), 255 == b0)
        throw val = bin.readInt(data, offset + 1) / 65535, vs = 5, "unknown number";
      if (30 == b0) {
        var nibs = [];
        for (vs = 1; ; ) {
          var b = data[offset + vs];
          vs++;
          var nib0 = b >> 4, nib1 = 15 & b;
          if (15 != nib0 && nibs.push(nib0), 15 != nib1 && nibs.push(nib1), 15 == nib1)
            break;
        }
        for (var s = "", chars = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, ".", "e", "e-", "reserved", "-", "endOfNumber"], i = 0; i < nibs.length; i++)
          s += chars[nibs[i]];
        val = parseFloat(s);
      }
      if (b0 <= 21) {
        if (key = ["version", "Notice", "FullName", "FamilyName", "Weight", "FontBBox", "BlueValues", "OtherBlues", "FamilyBlues", "FamilyOtherBlues", "StdHW", "StdVW", "escape", "UniqueID", "XUID", "charset", "Encoding", "CharStrings", "Private", "Subrs", "defaultWidthX", "nominalWidthX"][b0], vs = 1, 12 == b0)
          key = ["Copyright", "isFixedPitch", "ItalicAngle", "UnderlinePosition", "UnderlineThickness", "PaintType", "CharstringType", "FontMatrix", "StrokeWidth", "BlueScale", "BlueShift", "BlueFuzz", "StemSnapH", "StemSnapV", "ForceBold", 0, 0, "LanguageGroup", "ExpansionFactor", "initialRandomSeed", "SyntheticBase", "PostScript", "BaseFontName", "BaseFontBlend", 0, 0, 0, 0, 0, 0, "ROS", "CIDFontVersion", "CIDFontRevision", "CIDFontType", "CIDCount", "UIDBase", "FDArray", "FDSelect", "FontName"][b1], vs = 2;
      }
      null != key ? (dict[key] = 1 == carr.length ? carr[0] : carr, carr = []) : carr.push(val), offset += vs;
    }
    return dict;
  }, Typr.cmap = {}, Typr.cmap.parse = function(data, offset, length) {
    data = new Uint8Array(data.buffer, offset, length), offset = 0;
    var bin = Typr._bin, obj = {};
    bin.readUshort(data, offset), offset += 2;
    var numTables = bin.readUshort(data, offset);
    offset += 2;
    var offs = [];
    obj.tables = [];
    for (var i = 0; i < numTables; i++) {
      var platformID = bin.readUshort(data, offset);
      offset += 2;
      var encodingID = bin.readUshort(data, offset);
      offset += 2;
      var noffset = bin.readUint(data, offset);
      offset += 4;
      var id = "p" + platformID + "e" + encodingID, tind = offs.indexOf(noffset);
      if (-1 == tind) {
        var subt;
        tind = obj.tables.length, offs.push(noffset);
        var format = bin.readUshort(data, noffset);
        0 == format ? subt = Typr.cmap.parse0(data, noffset) : 4 == format ? subt = Typr.cmap.parse4(data, noffset) : 6 == format ? subt = Typr.cmap.parse6(data, noffset) : 12 == format ? subt = Typr.cmap.parse12(data, noffset) : console.log("unknown format: " + format, platformID, encodingID, noffset), obj.tables.push(subt);
      }
      if (null != obj[id])
        throw "multiple tables for one platform+encoding";
      obj[id] = tind;
    }
    return obj;
  }, Typr.cmap.parse0 = function(data, offset) {
    var bin = Typr._bin, obj = {};
    obj.format = bin.readUshort(data, offset), offset += 2;
    var len = bin.readUshort(data, offset);
    offset += 2, bin.readUshort(data, offset), offset += 2, obj.map = [];
    for (var i = 0; i < len - 6; i++)
      obj.map.push(data[offset + i]);
    return obj;
  }, Typr.cmap.parse4 = function(data, offset) {
    var bin = Typr._bin, offset0 = offset, obj = {};
    obj.format = bin.readUshort(data, offset), offset += 2;
    var length = bin.readUshort(data, offset);
    offset += 2, bin.readUshort(data, offset), offset += 2;
    var segCountX2 = bin.readUshort(data, offset);
    offset += 2;
    var segCount = segCountX2 / 2;
    obj.searchRange = bin.readUshort(data, offset), offset += 2, obj.entrySelector = bin.readUshort(data, offset), offset += 2, obj.rangeShift = bin.readUshort(data, offset), offset += 2, obj.endCount = bin.readUshorts(data, offset, segCount), offset += 2 * segCount, offset += 2, obj.startCount = bin.readUshorts(data, offset, segCount), offset += 2 * segCount, obj.idDelta = [];
    for (var i = 0; i < segCount; i++)
      obj.idDelta.push(bin.readShort(data, offset)), offset += 2;
    for (obj.idRangeOffset = bin.readUshorts(data, offset, segCount), offset += 2 * segCount, obj.glyphIdArray = []; offset < offset0 + length; )
      obj.glyphIdArray.push(bin.readUshort(data, offset)), offset += 2;
    return obj;
  }, Typr.cmap.parse6 = function(data, offset) {
    var bin = Typr._bin, obj = {};
    obj.format = bin.readUshort(data, offset), offset += 2, bin.readUshort(data, offset), offset += 2, bin.readUshort(data, offset), offset += 2, obj.firstCode = bin.readUshort(data, offset), offset += 2;
    var entryCount = bin.readUshort(data, offset);
    offset += 2, obj.glyphIdArray = [];
    for (var i = 0; i < entryCount; i++)
      obj.glyphIdArray.push(bin.readUshort(data, offset)), offset += 2;
    return obj;
  }, Typr.cmap.parse12 = function(data, offset) {
    var bin = Typr._bin, obj = {};
    obj.format = bin.readUshort(data, offset), offset += 2, offset += 2, bin.readUint(data, offset), offset += 4, bin.readUint(data, offset), offset += 4;
    var nGroups = bin.readUint(data, offset);
    offset += 4, obj.groups = [];
    for (var i = 0; i < nGroups; i++) {
      var off = offset + 12 * i, startCharCode = bin.readUint(data, off + 0), endCharCode = bin.readUint(data, off + 4), startGlyphID = bin.readUint(data, off + 8);
      obj.groups.push([startCharCode, endCharCode, startGlyphID]);
    }
    return obj;
  }, Typr.glyf = {}, Typr.glyf.parse = function(data, offset, length, font) {
    for (var obj = [], g = 0; g < font.maxp.numGlyphs; g++)
      obj.push(null);
    return obj;
  }, Typr.glyf._parseGlyf = function(font, g) {
    var bin = Typr._bin, data = font._data, offset = Typr._tabOffset(data, "glyf") + font.loca[g];
    if (font.loca[g] == font.loca[g + 1])
      return null;
    var gl = {};
    if (gl.noc = bin.readShort(data, offset), offset += 2, gl.xMin = bin.readShort(data, offset), offset += 2, gl.yMin = bin.readShort(data, offset), offset += 2, gl.xMax = bin.readShort(data, offset), offset += 2, gl.yMax = bin.readShort(data, offset), offset += 2, gl.xMin >= gl.xMax || gl.yMin >= gl.yMax)
      return null;
    if (gl.noc > 0) {
      gl.endPts = [];
      for (var i = 0; i < gl.noc; i++)
        gl.endPts.push(bin.readUshort(data, offset)), offset += 2;
      var instructionLength = bin.readUshort(data, offset);
      if (offset += 2, data.length - offset < instructionLength)
        return null;
      gl.instructions = bin.readBytes(data, offset, instructionLength), offset += instructionLength;
      var crdnum = gl.endPts[gl.noc - 1] + 1;
      gl.flags = [];
      for (i = 0; i < crdnum; i++) {
        var flag = data[offset];
        if (offset++, gl.flags.push(flag), 0 != (8 & flag)) {
          var rep = data[offset];
          offset++;
          for (var j = 0; j < rep; j++)
            gl.flags.push(flag), i++;
        }
      }
      gl.xs = [];
      for (i = 0; i < crdnum; i++) {
        var i8 = 0 != (2 & gl.flags[i]), same = 0 != (16 & gl.flags[i]);
        i8 ? (gl.xs.push(same ? data[offset] : -data[offset]), offset++) : same ? gl.xs.push(0) : (gl.xs.push(bin.readShort(data, offset)), offset += 2);
      }
      gl.ys = [];
      for (i = 0; i < crdnum; i++) {
        i8 = 0 != (4 & gl.flags[i]), same = 0 != (32 & gl.flags[i]);
        i8 ? (gl.ys.push(same ? data[offset] : -data[offset]), offset++) : same ? gl.ys.push(0) : (gl.ys.push(bin.readShort(data, offset)), offset += 2);
      }
      var x = 0, y = 0;
      for (i = 0; i < crdnum; i++)
        x += gl.xs[i], y += gl.ys[i], gl.xs[i] = x, gl.ys[i] = y;
    } else {
      var flags;
      gl.parts = [];
      do {
        flags = bin.readUshort(data, offset), offset += 2;
        var part = { m: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, p1: -1, p2: -1 };
        if (gl.parts.push(part), part.glyphIndex = bin.readUshort(data, offset), offset += 2, 1 & flags) {
          var arg1 = bin.readShort(data, offset);
          offset += 2;
          var arg2 = bin.readShort(data, offset);
          offset += 2;
        } else {
          arg1 = bin.readInt8(data, offset);
          offset++;
          arg2 = bin.readInt8(data, offset);
          offset++;
        }
        2 & flags ? (part.m.tx = arg1, part.m.ty = arg2) : (part.p1 = arg1, part.p2 = arg2), 8 & flags ? (part.m.a = part.m.d = bin.readF2dot14(data, offset), offset += 2) : 64 & flags ? (part.m.a = bin.readF2dot14(data, offset), offset += 2, part.m.d = bin.readF2dot14(data, offset), offset += 2) : 128 & flags && (part.m.a = bin.readF2dot14(data, offset), offset += 2, part.m.b = bin.readF2dot14(data, offset), offset += 2, part.m.c = bin.readF2dot14(data, offset), offset += 2, part.m.d = bin.readF2dot14(data, offset), offset += 2);
      } while (32 & flags);
      if (256 & flags) {
        var numInstr = bin.readUshort(data, offset);
        offset += 2, gl.instr = [];
        for (i = 0; i < numInstr; i++)
          gl.instr.push(data[offset]), offset++;
      }
    }
    return gl;
  }, Typr.GPOS = {}, Typr.GPOS.parse = function(data, offset, length, font) {
    return Typr._lctf.parse(data, offset, length, font, Typr.GPOS.subt);
  }, Typr.GPOS.subt = function(data, ltype, offset) {
    if (2 != ltype)
      return null;
    var bin = Typr._bin, offset0 = offset, tab = {};
    tab.format = bin.readUshort(data, offset), offset += 2;
    var covOff = bin.readUshort(data, offset);
    offset += 2, tab.coverage = Typr._lctf.readCoverage(data, covOff + offset0), tab.valFmt1 = bin.readUshort(data, offset), offset += 2, tab.valFmt2 = bin.readUshort(data, offset), offset += 2;
    var ones1 = Typr._lctf.numOfOnes(tab.valFmt1), ones2 = Typr._lctf.numOfOnes(tab.valFmt2);
    if (1 == tab.format) {
      tab.pairsets = [];
      var count = bin.readUshort(data, offset);
      offset += 2;
      for (var i = 0; i < count; i++) {
        var psoff = bin.readUshort(data, offset);
        offset += 2, psoff += offset0;
        var pvcount = bin.readUshort(data, psoff);
        psoff += 2;
        for (var arr = [], j = 0; j < pvcount; j++) {
          var gid2 = bin.readUshort(data, psoff);
          psoff += 2, 0 != tab.valFmt1 && (value1 = Typr._lctf.readValueRecord(data, psoff, tab.valFmt1), psoff += 2 * ones1), 0 != tab.valFmt2 && (value2 = Typr._lctf.readValueRecord(data, psoff, tab.valFmt2), psoff += 2 * ones2), arr.push({ gid2, val1: value1, val2: value2 });
        }
        tab.pairsets.push(arr);
      }
    }
    if (2 == tab.format) {
      var classDef1 = bin.readUshort(data, offset);
      offset += 2;
      var classDef2 = bin.readUshort(data, offset);
      offset += 2;
      var class1Count = bin.readUshort(data, offset);
      offset += 2;
      var class2Count = bin.readUshort(data, offset);
      offset += 2, tab.classDef1 = Typr._lctf.readClassDef(data, offset0 + classDef1), tab.classDef2 = Typr._lctf.readClassDef(data, offset0 + classDef2), tab.matrix = [];
      for (i = 0; i < class1Count; i++) {
        var row = [];
        for (j = 0; j < class2Count; j++) {
          var value1 = null, value2 = null;
          0 != tab.valFmt1 && (value1 = Typr._lctf.readValueRecord(data, offset, tab.valFmt1), offset += 2 * ones1), 0 != tab.valFmt2 && (value2 = Typr._lctf.readValueRecord(data, offset, tab.valFmt2), offset += 2 * ones2), row.push({ val1: value1, val2: value2 });
        }
        tab.matrix.push(row);
      }
    }
    return tab;
  }, Typr.GSUB = {}, Typr.GSUB.parse = function(data, offset, length, font) {
    return Typr._lctf.parse(data, offset, length, font, Typr.GSUB.subt);
  }, Typr.GSUB.subt = function(data, ltype, offset) {
    var bin = Typr._bin, offset0 = offset, tab = {};
    if (1 != ltype && 4 != ltype && 5 != ltype)
      return null;
    tab.fmt = bin.readUshort(data, offset), offset += 2;
    var covOff = bin.readUshort(data, offset);
    if (offset += 2, tab.coverage = Typr._lctf.readCoverage(data, covOff + offset0), 1 == ltype) {
      if (1 == tab.fmt)
        tab.delta = bin.readShort(data, offset), offset += 2;
      else if (2 == tab.fmt) {
        var cnt = bin.readUshort(data, offset);
        offset += 2, tab.newg = bin.readUshorts(data, offset, cnt), offset += 2 * tab.newg.length;
      }
    } else if (4 == ltype) {
      tab.vals = [];
      cnt = bin.readUshort(data, offset);
      offset += 2;
      for (var i = 0; i < cnt; i++) {
        var loff = bin.readUshort(data, offset);
        offset += 2, tab.vals.push(Typr.GSUB.readLigatureSet(data, offset0 + loff));
      }
    } else if (5 == ltype)
      if (2 == tab.fmt) {
        var cDefOffset = bin.readUshort(data, offset);
        offset += 2, tab.cDef = Typr._lctf.readClassDef(data, offset0 + cDefOffset), tab.scset = [];
        var subClassSetCount = bin.readUshort(data, offset);
        offset += 2;
        for (i = 0; i < subClassSetCount; i++) {
          var scsOff = bin.readUshort(data, offset);
          offset += 2, tab.scset.push(0 == scsOff ? null : Typr.GSUB.readSubClassSet(data, offset0 + scsOff));
        }
      } else
        console.log("unknown table format", tab.fmt);
    return tab;
  }, Typr.GSUB.readSubClassSet = function(data, offset) {
    var rUs = Typr._bin.readUshort, offset0 = offset, lset = [], cnt = rUs(data, offset);
    offset += 2;
    for (var i = 0; i < cnt; i++) {
      var loff = rUs(data, offset);
      offset += 2, lset.push(Typr.GSUB.readSubClassRule(data, offset0 + loff));
    }
    return lset;
  }, Typr.GSUB.readSubClassRule = function(data, offset) {
    var rUs = Typr._bin.readUshort, rule = {}, gcount = rUs(data, offset), scount = rUs(data, offset += 2);
    offset += 2, rule.input = [];
    for (var i = 0; i < gcount - 1; i++)
      rule.input.push(rUs(data, offset)), offset += 2;
    return rule.substLookupRecords = Typr.GSUB.readSubstLookupRecords(data, offset, scount), rule;
  }, Typr.GSUB.readSubstLookupRecords = function(data, offset, cnt) {
    for (var rUs = Typr._bin.readUshort, out = [], i = 0; i < cnt; i++)
      out.push(rUs(data, offset), rUs(data, offset + 2)), offset += 4;
    return out;
  }, Typr.GSUB.readChainSubClassSet = function(data, offset) {
    var bin = Typr._bin, offset0 = offset, lset = [], cnt = bin.readUshort(data, offset);
    offset += 2;
    for (var i = 0; i < cnt; i++) {
      var loff = bin.readUshort(data, offset);
      offset += 2, lset.push(Typr.GSUB.readChainSubClassRule(data, offset0 + loff));
    }
    return lset;
  }, Typr.GSUB.readChainSubClassRule = function(data, offset) {
    for (var bin = Typr._bin, rule = {}, pps = ["backtrack", "input", "lookahead"], pi = 0; pi < pps.length; pi++) {
      var cnt = bin.readUshort(data, offset);
      offset += 2, 1 == pi && cnt--, rule[pps[pi]] = bin.readUshorts(data, offset, cnt), offset += 2 * rule[pps[pi]].length;
    }
    cnt = bin.readUshort(data, offset);
    return offset += 2, rule.subst = bin.readUshorts(data, offset, 2 * cnt), offset += 2 * rule.subst.length, rule;
  }, Typr.GSUB.readLigatureSet = function(data, offset) {
    var bin = Typr._bin, offset0 = offset, lset = [], lcnt = bin.readUshort(data, offset);
    offset += 2;
    for (var j = 0; j < lcnt; j++) {
      var loff = bin.readUshort(data, offset);
      offset += 2, lset.push(Typr.GSUB.readLigature(data, offset0 + loff));
    }
    return lset;
  }, Typr.GSUB.readLigature = function(data, offset) {
    var bin = Typr._bin, lig = { chain: [] };
    lig.nglyph = bin.readUshort(data, offset), offset += 2;
    var ccnt = bin.readUshort(data, offset);
    offset += 2;
    for (var k = 0; k < ccnt - 1; k++)
      lig.chain.push(bin.readUshort(data, offset)), offset += 2;
    return lig;
  }, Typr.head = {}, Typr.head.parse = function(data, offset, length) {
    var bin = Typr._bin, obj = {};
    return bin.readFixed(data, offset), offset += 4, obj.fontRevision = bin.readFixed(data, offset), offset += 4, bin.readUint(data, offset), offset += 4, bin.readUint(data, offset), offset += 4, obj.flags = bin.readUshort(data, offset), offset += 2, obj.unitsPerEm = bin.readUshort(data, offset), offset += 2, obj.created = bin.readUint64(data, offset), offset += 8, obj.modified = bin.readUint64(data, offset), offset += 8, obj.xMin = bin.readShort(data, offset), offset += 2, obj.yMin = bin.readShort(data, offset), offset += 2, obj.xMax = bin.readShort(data, offset), offset += 2, obj.yMax = bin.readShort(data, offset), offset += 2, obj.macStyle = bin.readUshort(data, offset), offset += 2, obj.lowestRecPPEM = bin.readUshort(data, offset), offset += 2, obj.fontDirectionHint = bin.readShort(data, offset), offset += 2, obj.indexToLocFormat = bin.readShort(data, offset), offset += 2, obj.glyphDataFormat = bin.readShort(data, offset), offset += 2, obj;
  }, Typr.hhea = {}, Typr.hhea.parse = function(data, offset, length) {
    var bin = Typr._bin, obj = {};
    return bin.readFixed(data, offset), offset += 4, obj.ascender = bin.readShort(data, offset), offset += 2, obj.descender = bin.readShort(data, offset), offset += 2, obj.lineGap = bin.readShort(data, offset), offset += 2, obj.advanceWidthMax = bin.readUshort(data, offset), offset += 2, obj.minLeftSideBearing = bin.readShort(data, offset), offset += 2, obj.minRightSideBearing = bin.readShort(data, offset), offset += 2, obj.xMaxExtent = bin.readShort(data, offset), offset += 2, obj.caretSlopeRise = bin.readShort(data, offset), offset += 2, obj.caretSlopeRun = bin.readShort(data, offset), offset += 2, obj.caretOffset = bin.readShort(data, offset), offset += 2, offset += 8, obj.metricDataFormat = bin.readShort(data, offset), offset += 2, obj.numberOfHMetrics = bin.readUshort(data, offset), offset += 2, obj;
  }, Typr.hmtx = {}, Typr.hmtx.parse = function(data, offset, length, font) {
    for (var bin = Typr._bin, obj = { aWidth: [], lsBearing: [] }, aw = 0, lsb = 0, i = 0; i < font.maxp.numGlyphs; i++)
      i < font.hhea.numberOfHMetrics && (aw = bin.readUshort(data, offset), offset += 2, lsb = bin.readShort(data, offset), offset += 2), obj.aWidth.push(aw), obj.lsBearing.push(lsb);
    return obj;
  }, Typr.kern = {}, Typr.kern.parse = function(data, offset, length, font) {
    var bin = Typr._bin, version = bin.readUshort(data, offset);
    if (offset += 2, 1 == version)
      return Typr.kern.parseV1(data, offset - 2, length, font);
    var nTables = bin.readUshort(data, offset);
    offset += 2;
    for (var map = { glyph1: [], rval: [] }, i = 0; i < nTables; i++) {
      offset += 2;
      length = bin.readUshort(data, offset);
      offset += 2;
      var coverage = bin.readUshort(data, offset);
      offset += 2;
      var format = coverage >>> 8;
      if (0 != (format &= 15))
        throw "unknown kern table format: " + format;
      offset = Typr.kern.readFormat0(data, offset, map);
    }
    return map;
  }, Typr.kern.parseV1 = function(data, offset, length, font) {
    var bin = Typr._bin;
    bin.readFixed(data, offset), offset += 4;
    var nTables = bin.readUint(data, offset);
    offset += 4;
    for (var map = { glyph1: [], rval: [] }, i = 0; i < nTables; i++) {
      bin.readUint(data, offset), offset += 4;
      var coverage = bin.readUshort(data, offset);
      offset += 2, bin.readUshort(data, offset), offset += 2;
      var format = coverage >>> 8;
      if (0 != (format &= 15))
        throw "unknown kern table format: " + format;
      offset = Typr.kern.readFormat0(data, offset, map);
    }
    return map;
  }, Typr.kern.readFormat0 = function(data, offset, map) {
    var bin = Typr._bin, pleft = -1, nPairs = bin.readUshort(data, offset);
    offset += 2, bin.readUshort(data, offset), offset += 2, bin.readUshort(data, offset), offset += 2, bin.readUshort(data, offset), offset += 2;
    for (var j = 0; j < nPairs; j++) {
      var left = bin.readUshort(data, offset);
      offset += 2;
      var right = bin.readUshort(data, offset);
      offset += 2;
      var value = bin.readShort(data, offset);
      offset += 2, left != pleft && (map.glyph1.push(left), map.rval.push({ glyph2: [], vals: [] }));
      var rval = map.rval[map.rval.length - 1];
      rval.glyph2.push(right), rval.vals.push(value), pleft = left;
    }
    return offset;
  }, Typr.loca = {}, Typr.loca.parse = function(data, offset, length, font) {
    var bin = Typr._bin, obj = [], ver = font.head.indexToLocFormat, len = font.maxp.numGlyphs + 1;
    if (0 == ver)
      for (var i = 0; i < len; i++)
        obj.push(bin.readUshort(data, offset + (i << 1)) << 1);
    if (1 == ver)
      for (i = 0; i < len; i++)
        obj.push(bin.readUint(data, offset + (i << 2)));
    return obj;
  }, Typr.maxp = {}, Typr.maxp.parse = function(data, offset, length) {
    var bin = Typr._bin, obj = {}, ver = bin.readUint(data, offset);
    return offset += 4, obj.numGlyphs = bin.readUshort(data, offset), offset += 2, 65536 == ver && (obj.maxPoints = bin.readUshort(data, offset), offset += 2, obj.maxContours = bin.readUshort(data, offset), offset += 2, obj.maxCompositePoints = bin.readUshort(data, offset), offset += 2, obj.maxCompositeContours = bin.readUshort(data, offset), offset += 2, obj.maxZones = bin.readUshort(data, offset), offset += 2, obj.maxTwilightPoints = bin.readUshort(data, offset), offset += 2, obj.maxStorage = bin.readUshort(data, offset), offset += 2, obj.maxFunctionDefs = bin.readUshort(data, offset), offset += 2, obj.maxInstructionDefs = bin.readUshort(data, offset), offset += 2, obj.maxStackElements = bin.readUshort(data, offset), offset += 2, obj.maxSizeOfInstructions = bin.readUshort(data, offset), offset += 2, obj.maxComponentElements = bin.readUshort(data, offset), offset += 2, obj.maxComponentDepth = bin.readUshort(data, offset), offset += 2), obj;
  }, Typr.name = {}, Typr.name.parse = function(data, offset, length) {
    var bin = Typr._bin, obj = {};
    bin.readUshort(data, offset), offset += 2;
    var count = bin.readUshort(data, offset);
    offset += 2, bin.readUshort(data, offset);
    for (var tname, offset0 = offset += 2, i = 0; i < count; i++) {
      var platformID = bin.readUshort(data, offset);
      offset += 2;
      var encodingID = bin.readUshort(data, offset);
      offset += 2;
      var languageID = bin.readUshort(data, offset);
      offset += 2;
      var nameID = bin.readUshort(data, offset);
      offset += 2;
      length = bin.readUshort(data, offset);
      offset += 2;
      var noffset = bin.readUshort(data, offset);
      offset += 2;
      var plat = "p" + platformID;
      null == obj[plat] && (obj[plat] = {});
      var str, cname = ["copyright", "fontFamily", "fontSubfamily", "ID", "fullName", "version", "postScriptName", "trademark", "manufacturer", "designer", "description", "urlVendor", "urlDesigner", "licence", "licenceURL", "---", "typoFamilyName", "typoSubfamilyName", "compatibleFull", "sampleText", "postScriptCID", "wwsFamilyName", "wwsSubfamilyName", "lightPalette", "darkPalette"][nameID], soff = offset0 + 12 * count + noffset;
      if (0 == platformID)
        str = bin.readUnicode(data, soff, length / 2);
      else if (3 == platformID && 0 == encodingID)
        str = bin.readUnicode(data, soff, length / 2);
      else if (0 == encodingID)
        str = bin.readASCII(data, soff, length);
      else if (1 == encodingID)
        str = bin.readUnicode(data, soff, length / 2);
      else if (3 == encodingID)
        str = bin.readUnicode(data, soff, length / 2);
      else {
        if (1 != platformID)
          throw "unknown encoding " + encodingID + ", platformID: " + platformID;
        str = bin.readASCII(data, soff, length), console.log("reading unknown MAC encoding " + encodingID + " as ASCII");
      }
      obj[plat][cname] = str, obj[plat]._lang = languageID;
    }
    for (var p in obj)
      if (null != obj[p].postScriptName && 1033 == obj[p]._lang)
        return obj[p];
    for (var p in obj)
      if (null != obj[p].postScriptName && 3084 == obj[p]._lang)
        return obj[p];
    for (var p in obj)
      if (null != obj[p].postScriptName)
        return obj[p];
    for (var p in obj) {
      tname = p;
      break;
    }
    return console.log("returning name table with languageID " + obj[tname]._lang), obj[tname];
  }, Typr["OS/2"] = {}, Typr["OS/2"].parse = function(data, offset, length) {
    var ver = Typr._bin.readUshort(data, offset);
    offset += 2;
    var obj = {};
    if (0 == ver)
      Typr["OS/2"].version0(data, offset, obj);
    else if (1 == ver)
      Typr["OS/2"].version1(data, offset, obj);
    else if (2 == ver || 3 == ver || 4 == ver)
      Typr["OS/2"].version2(data, offset, obj);
    else {
      if (5 != ver)
        throw "unknown OS/2 table version: " + ver;
      Typr["OS/2"].version5(data, offset, obj);
    }
    return obj;
  }, Typr["OS/2"].version0 = function(data, offset, obj) {
    var bin = Typr._bin;
    return obj.xAvgCharWidth = bin.readShort(data, offset), offset += 2, obj.usWeightClass = bin.readUshort(data, offset), offset += 2, obj.usWidthClass = bin.readUshort(data, offset), offset += 2, obj.fsType = bin.readUshort(data, offset), offset += 2, obj.ySubscriptXSize = bin.readShort(data, offset), offset += 2, obj.ySubscriptYSize = bin.readShort(data, offset), offset += 2, obj.ySubscriptXOffset = bin.readShort(data, offset), offset += 2, obj.ySubscriptYOffset = bin.readShort(data, offset), offset += 2, obj.ySuperscriptXSize = bin.readShort(data, offset), offset += 2, obj.ySuperscriptYSize = bin.readShort(data, offset), offset += 2, obj.ySuperscriptXOffset = bin.readShort(data, offset), offset += 2, obj.ySuperscriptYOffset = bin.readShort(data, offset), offset += 2, obj.yStrikeoutSize = bin.readShort(data, offset), offset += 2, obj.yStrikeoutPosition = bin.readShort(data, offset), offset += 2, obj.sFamilyClass = bin.readShort(data, offset), offset += 2, obj.panose = bin.readBytes(data, offset, 10), offset += 10, obj.ulUnicodeRange1 = bin.readUint(data, offset), offset += 4, obj.ulUnicodeRange2 = bin.readUint(data, offset), offset += 4, obj.ulUnicodeRange3 = bin.readUint(data, offset), offset += 4, obj.ulUnicodeRange4 = bin.readUint(data, offset), offset += 4, obj.achVendID = [bin.readInt8(data, offset), bin.readInt8(data, offset + 1), bin.readInt8(data, offset + 2), bin.readInt8(data, offset + 3)], offset += 4, obj.fsSelection = bin.readUshort(data, offset), offset += 2, obj.usFirstCharIndex = bin.readUshort(data, offset), offset += 2, obj.usLastCharIndex = bin.readUshort(data, offset), offset += 2, obj.sTypoAscender = bin.readShort(data, offset), offset += 2, obj.sTypoDescender = bin.readShort(data, offset), offset += 2, obj.sTypoLineGap = bin.readShort(data, offset), offset += 2, obj.usWinAscent = bin.readUshort(data, offset), offset += 2, obj.usWinDescent = bin.readUshort(data, offset), offset += 2;
  }, Typr["OS/2"].version1 = function(data, offset, obj) {
    var bin = Typr._bin;
    return offset = Typr["OS/2"].version0(data, offset, obj), obj.ulCodePageRange1 = bin.readUint(data, offset), offset += 4, obj.ulCodePageRange2 = bin.readUint(data, offset), offset += 4;
  }, Typr["OS/2"].version2 = function(data, offset, obj) {
    var bin = Typr._bin;
    return offset = Typr["OS/2"].version1(data, offset, obj), obj.sxHeight = bin.readShort(data, offset), offset += 2, obj.sCapHeight = bin.readShort(data, offset), offset += 2, obj.usDefault = bin.readUshort(data, offset), offset += 2, obj.usBreak = bin.readUshort(data, offset), offset += 2, obj.usMaxContext = bin.readUshort(data, offset), offset += 2;
  }, Typr["OS/2"].version5 = function(data, offset, obj) {
    var bin = Typr._bin;
    return offset = Typr["OS/2"].version2(data, offset, obj), obj.usLowerOpticalPointSize = bin.readUshort(data, offset), offset += 2, obj.usUpperOpticalPointSize = bin.readUshort(data, offset), offset += 2;
  }, Typr.post = {}, Typr.post.parse = function(data, offset, length) {
    var bin = Typr._bin, obj = {};
    return obj.version = bin.readFixed(data, offset), offset += 4, obj.italicAngle = bin.readFixed(data, offset), offset += 4, obj.underlinePosition = bin.readShort(data, offset), offset += 2, obj.underlineThickness = bin.readShort(data, offset), offset += 2, obj;
  }, Typr.SVG = {}, Typr.SVG.parse = function(data, offset, length) {
    var bin = Typr._bin, obj = { entries: [] }, offset0 = offset;
    bin.readUshort(data, offset), offset += 2;
    var svgDocIndexOffset = bin.readUint(data, offset);
    offset += 4, bin.readUint(data, offset), offset += 4, offset = svgDocIndexOffset + offset0;
    var numEntries = bin.readUshort(data, offset);
    offset += 2;
    for (var i = 0; i < numEntries; i++) {
      var startGlyphID = bin.readUshort(data, offset);
      offset += 2;
      var endGlyphID = bin.readUshort(data, offset);
      offset += 2;
      var svgDocOffset = bin.readUint(data, offset);
      offset += 4;
      var svgDocLength = bin.readUint(data, offset);
      offset += 4;
      for (var sbuf = new Uint8Array(data.buffer, offset0 + svgDocOffset + svgDocIndexOffset, svgDocLength), svg = bin.readUTF8(sbuf, 0, sbuf.length), f = startGlyphID; f <= endGlyphID; f++)
        obj.entries[f] = svg;
    }
    return obj;
  }, Typr.SVG.toPath = function(str) {
    var pth = { cmds: [], crds: [] };
    if (null == str)
      return pth;
    for (var svg = new DOMParser().parseFromString(str, "image/svg+xml").firstChild; "svg" != svg.tagName; )
      svg = svg.nextSibling;
    var vb = svg.getAttribute("viewBox");
    vb = vb ? vb.trim().split(" ").map(parseFloat) : [0, 0, 1e3, 1e3], Typr.SVG._toPath(svg.children, pth);
    for (var i = 0; i < pth.crds.length; i += 2) {
      var x = pth.crds[i], y = pth.crds[i + 1];
      x -= vb[0], y = -(y -= vb[1]), pth.crds[i] = x, pth.crds[i + 1] = y;
    }
    return pth;
  }, Typr.SVG._toPath = function(nds, pth, fill) {
    for (var ni = 0; ni < nds.length; ni++) {
      var nd = nds[ni], tn = nd.tagName, cfl = nd.getAttribute("fill");
      if (null == cfl && (cfl = fill), "g" == tn)
        Typr.SVG._toPath(nd.children, pth, cfl);
      else if ("path" == tn) {
        pth.cmds.push(cfl || "#000000");
        var d = nd.getAttribute("d"), toks = Typr.SVG._tokens(d);
        Typr.SVG._toksToPath(toks, pth), pth.cmds.push("X");
      } else
        "defs" == tn || console.log(tn, nd);
    }
  }, Typr.SVG._tokens = function(d) {
    for (var ts = [], off = 0, rn = false, cn = ""; off < d.length; ) {
      var cc = d.charCodeAt(off), ch = d.charAt(off);
      off++;
      var isNum = 48 <= cc && cc <= 57 || "." == ch || "-" == ch;
      rn ? "-" == ch ? (ts.push(parseFloat(cn)), cn = ch) : isNum ? cn += ch : (ts.push(parseFloat(cn)), "," != ch && " " != ch && ts.push(ch), rn = false) : isNum ? (cn = ch, rn = true) : "," != ch && " " != ch && ts.push(ch);
    }
    return rn && ts.push(parseFloat(cn)), ts;
  }, Typr.SVG._toksToPath = function(ts, pth) {
    for (var i = 0, x = 0, y = 0, ox = 0, oy = 0, pc = { M: 2, L: 2, H: 1, V: 1, S: 4, C: 6 }, cmds = pth.cmds, crds = pth.crds; i < ts.length; ) {
      var cmd = ts[i];
      if (i++, "z" == cmd)
        cmds.push("Z"), x = ox, y = oy;
      else
        for (var cmu = cmd.toUpperCase(), ps = pc[cmu], reps = Typr.SVG._reps(ts, i, ps), j = 0; j < reps; j++) {
          var xi = 0, yi = 0;
          if (cmd != cmu && (xi = x, yi = y), "M" == cmu)
            x = xi + ts[i++], y = yi + ts[i++], cmds.push("M"), crds.push(x, y), ox = x, oy = y;
          else if ("L" == cmu)
            x = xi + ts[i++], y = yi + ts[i++], cmds.push("L"), crds.push(x, y);
          else if ("H" == cmu)
            x = xi + ts[i++], cmds.push("L"), crds.push(x, y);
          else if ("V" == cmu)
            y = yi + ts[i++], cmds.push("L"), crds.push(x, y);
          else if ("C" == cmu) {
            var x1 = xi + ts[i++], y1 = yi + ts[i++], x2 = xi + ts[i++], y2 = yi + ts[i++], x3 = xi + ts[i++], y3 = yi + ts[i++];
            cmds.push("C"), crds.push(x1, y1, x2, y2, x3, y3), x = x3, y = y3;
          } else if ("S" == cmu) {
            var co = Math.max(crds.length - 4, 0);
            x1 = x + x - crds[co], y1 = y + y - crds[co + 1], x2 = xi + ts[i++], y2 = yi + ts[i++], x3 = xi + ts[i++], y3 = yi + ts[i++];
            cmds.push("C"), crds.push(x1, y1, x2, y2, x3, y3), x = x3, y = y3;
          } else
            console.log("Unknown SVG command " + cmd);
        }
    }
  }, Typr.SVG._reps = function(ts, off, ps) {
    for (var i = off; i < ts.length && "string" != typeof ts[i]; )
      i += ps;
    return (i - off) / ps;
  }, null == Typr && (Typr = {}), null == Typr.U && (Typr.U = {}), Typr.U.codeToGlyph = function(font, code) {
    var cmap = font.cmap, tind = -1;
    if (null != cmap.p0e4 ? tind = cmap.p0e4 : null != cmap.p3e1 ? tind = cmap.p3e1 : null != cmap.p1e0 && (tind = cmap.p1e0), -1 == tind)
      throw "no familiar platform and encoding!";
    var tab = cmap.tables[tind];
    if (0 == tab.format)
      return code >= tab.map.length ? 0 : tab.map[code];
    if (4 == tab.format) {
      for (var sind = -1, i = 0; i < tab.endCount.length; i++)
        if (code <= tab.endCount[i]) {
          sind = i;
          break;
        }
      if (-1 == sind)
        return 0;
      if (tab.startCount[sind] > code)
        return 0;
      return 65535 & (0 != tab.idRangeOffset[sind] ? tab.glyphIdArray[code - tab.startCount[sind] + (tab.idRangeOffset[sind] >> 1) - (tab.idRangeOffset.length - sind)] : code + tab.idDelta[sind]);
    }
    if (12 == tab.format) {
      if (code > tab.groups[tab.groups.length - 1][1])
        return 0;
      for (i = 0; i < tab.groups.length; i++) {
        var grp = tab.groups[i];
        if (grp[0] <= code && code <= grp[1])
          return grp[2] + (code - grp[0]);
      }
      return 0;
    }
    throw "unknown cmap table format " + tab.format;
  }, Typr.U.glyphToPath = function(font, gid) {
    var path = { cmds: [], crds: [] };
    if (font.SVG && font.SVG.entries[gid]) {
      var p = font.SVG.entries[gid];
      return null == p ? path : ("string" == typeof p && (p = Typr.SVG.toPath(p), font.SVG.entries[gid] = p), p);
    }
    if (font.CFF) {
      var state = { x: 0, y: 0, stack: [], nStems: 0, haveWidth: false, width: font.CFF.Private ? font.CFF.Private.defaultWidthX : 0, open: false };
      Typr.U._drawCFF(font.CFF.CharStrings[gid], state, font.CFF, path);
    } else
      font.glyf && Typr.U._drawGlyf(gid, font, path);
    return path;
  }, Typr.U._drawGlyf = function(gid, font, path) {
    var gl = font.glyf[gid];
    null == gl && (gl = font.glyf[gid] = Typr.glyf._parseGlyf(font, gid)), null != gl && (gl.noc > -1 ? Typr.U._simpleGlyph(gl, path) : Typr.U._compoGlyph(gl, font, path));
  }, Typr.U._simpleGlyph = function(gl, p) {
    for (var c = 0; c < gl.noc; c++) {
      for (var i0 = 0 == c ? 0 : gl.endPts[c - 1] + 1, il = gl.endPts[c], i = i0; i <= il; i++) {
        var pr = i == i0 ? il : i - 1, nx = i == il ? i0 : i + 1, onCurve = 1 & gl.flags[i], prOnCurve = 1 & gl.flags[pr], nxOnCurve = 1 & gl.flags[nx], x = gl.xs[i], y = gl.ys[i];
        if (i == i0)
          if (onCurve) {
            if (!prOnCurve) {
              Typr.U.P.moveTo(p, x, y);
              continue;
            }
            Typr.U.P.moveTo(p, gl.xs[pr], gl.ys[pr]);
          } else
            prOnCurve ? Typr.U.P.moveTo(p, gl.xs[pr], gl.ys[pr]) : Typr.U.P.moveTo(p, (gl.xs[pr] + x) / 2, (gl.ys[pr] + y) / 2);
        onCurve ? prOnCurve && Typr.U.P.lineTo(p, x, y) : nxOnCurve ? Typr.U.P.qcurveTo(p, x, y, gl.xs[nx], gl.ys[nx]) : Typr.U.P.qcurveTo(p, x, y, (x + gl.xs[nx]) / 2, (y + gl.ys[nx]) / 2);
      }
      Typr.U.P.closePath(p);
    }
  }, Typr.U._compoGlyph = function(gl, font, p) {
    for (var j = 0; j < gl.parts.length; j++) {
      var path = { cmds: [], crds: [] }, prt = gl.parts[j];
      Typr.U._drawGlyf(prt.glyphIndex, font, path);
      for (var m = prt.m, i = 0; i < path.crds.length; i += 2) {
        var x = path.crds[i], y = path.crds[i + 1];
        p.crds.push(x * m.a + y * m.b + m.tx), p.crds.push(x * m.c + y * m.d + m.ty);
      }
      for (i = 0; i < path.cmds.length; i++)
        p.cmds.push(path.cmds[i]);
    }
  }, Typr.U._getGlyphClass = function(g, cd) {
    var intr = Typr._lctf.getInterval(cd, g);
    return -1 == intr ? 0 : cd[intr + 2];
  }, Typr.U.getPairAdjustment = function(font, g1, g2) {
    if (font.GPOS) {
      for (var ltab = null, i = 0; i < font.GPOS.featureList.length; i++) {
        var fl = font.GPOS.featureList[i];
        if ("kern" == fl.tag)
          for (var j = 0; j < fl.tab.length; j++)
            2 == font.GPOS.lookupList[fl.tab[j]].ltype && (ltab = font.GPOS.lookupList[fl.tab[j]]);
      }
      if (ltab)
        for (i = 0; i < ltab.tabs.length; i++) {
          var tab = ltab.tabs[i], ind = Typr._lctf.coverageIndex(tab.coverage, g1);
          if (-1 != ind) {
            if (1 == tab.format) {
              var right = tab.pairsets[ind];
              for (j = 0; j < right.length; j++)
                right[j].gid2 == g2 && (adj = right[j]);
              if (null == adj)
                continue;
            } else if (2 == tab.format)
              var c1 = Typr.U._getGlyphClass(g1, tab.classDef1), c2 = Typr.U._getGlyphClass(g2, tab.classDef2), adj = tab.matrix[c1][c2];
            return adj.val1[2];
          }
        }
    }
    if (font.kern) {
      var ind1 = font.kern.glyph1.indexOf(g1);
      if (-1 != ind1) {
        var ind2 = font.kern.rval[ind1].glyph2.indexOf(g2);
        if (-1 != ind2)
          return font.kern.rval[ind1].vals[ind2];
      }
    }
    return 0;
  }, Typr.U.stringToGlyphs = function(font, str) {
    for (var gls = [], i = 0; i < str.length; i++) {
      var cc = str.codePointAt(i);
      cc > 65535 && i++, gls.push(Typr.U.codeToGlyph(font, cc));
    }
    var gsub = font.GSUB;
    if (null == gsub)
      return gls;
    for (var llist = gsub.lookupList, flist = gsub.featureList, wsep = '\n	" ,.:;!?()  ،', R = "آأؤإاةدذرزوٱٲٳٵٶٷڈډڊڋڌڍڎڏڐڑڒړڔڕږڗژڙۀۃۄۅۆۇۈۉۊۋۍۏےۓەۮۯܐܕܖܗܘܙܞܨܪܬܯݍݙݚݛݫݬݱݳݴݸݹࡀࡆࡇࡉࡔࡧࡩࡪࢪࢫࢬࢮࢱࢲࢹૅેૉ૊૎૏ૐ૑૒૝ૡ૤૯஁ஃ஄அஉ஌எஏ஑னப஫஬", ci = 0; ci < gls.length; ci++) {
      var gl = gls[ci], slft = 0 == ci || -1 != wsep.indexOf(str[ci - 1]), srgt = ci == gls.length - 1 || -1 != wsep.indexOf(str[ci + 1]);
      slft || -1 == R.indexOf(str[ci - 1]) || (slft = true), srgt || -1 == R.indexOf(str[ci]) || (srgt = true), srgt || -1 == "ꡲ્૗".indexOf(str[ci + 1]) || (srgt = true), slft || -1 == "ꡲ્૗".indexOf(str[ci]) || (slft = true);
      var feat = null;
      feat = slft ? srgt ? "isol" : "init" : srgt ? "fina" : "medi";
      for (var fi = 0; fi < flist.length; fi++)
        if (flist[fi].tag == feat)
          for (var ti = 0; ti < flist[fi].tab.length; ti++) {
            1 == (tab = llist[flist[fi].tab[ti]]).ltype && Typr.U._applyType1(gls, ci, tab);
          }
    }
    var cligs = ["rlig", "liga", "mset"];
    for (ci = 0; ci < gls.length; ci++) {
      gl = gls[ci];
      var rlim = Math.min(3, gls.length - ci - 1);
      for (fi = 0; fi < flist.length; fi++) {
        var fl = flist[fi];
        if (-1 != cligs.indexOf(fl.tag)) {
          for (ti = 0; ti < fl.tab.length; ti++)
            for (var tab = llist[fl.tab[ti]], j = 0; j < tab.tabs.length; j++)
              if (null != tab.tabs[j]) {
                var ind = Typr._lctf.coverageIndex(tab.tabs[j].coverage, gl);
                if (-1 != ind) {
                  if (4 == tab.ltype)
                    for (var vals = tab.tabs[j].vals[ind], k = 0; k < vals.length; k++) {
                      var lig = vals[k], rl = lig.chain.length;
                      if (!(rl > rlim)) {
                        for (var good = true, l = 0; l < rl; l++)
                          lig.chain[l] != gls[ci + (1 + l)] && (good = false);
                        if (good) {
                          gls[ci] = lig.nglyph;
                          for (l = 0; l < rl; l++)
                            gls[ci + l + 1] = -1;
                        }
                      }
                    }
                  else if (5 == tab.ltype) {
                    var ltab = tab.tabs[j];
                    if (2 != ltab.fmt)
                      continue;
                    var cind = Typr._lctf.getInterval(ltab.cDef, gl), cls = ltab.cDef[cind + 2], scs = ltab.scset[cls];
                    for (i = 0; i < scs.length; i++) {
                      var sc = scs[i], inp = sc.input;
                      if (!(inp.length > rlim)) {
                        for (good = true, l = 0; l < inp.length; l++) {
                          var cind2 = Typr._lctf.getInterval(ltab.cDef, gls[ci + 1 + l]);
                          if (-1 == cind && ltab.cDef[cind2 + 2] != inp[l]) {
                            good = false;
                            break;
                          }
                        }
                        if (good) {
                          var lrs = sc.substLookupRecords;
                          for (k = 0; k < lrs.length; k += 2)
                            lrs[k], lrs[k + 1];
                        }
                      }
                    }
                  }
                }
              }
        }
      }
    }
    return gls;
  }, Typr.U._applyType1 = function(gls, ci, tab) {
    for (var gl = gls[ci], j = 0; j < tab.tabs.length; j++) {
      var ttab = tab.tabs[j], ind = Typr._lctf.coverageIndex(ttab.coverage, gl);
      -1 != ind && (1 == ttab.fmt ? gls[ci] = gls[ci] + ttab.delta : gls[ci] = ttab.newg[ind]);
    }
  }, Typr.U.glyphsToPath = function(font, gls, clr) {
    for (var tpath = { cmds: [], crds: [] }, x = 0, i = 0; i < gls.length; i++) {
      var gid = gls[i];
      if (-1 != gid) {
        for (var gid2 = i < gls.length - 1 && -1 != gls[i + 1] ? gls[i + 1] : 0, path = Typr.U.glyphToPath(font, gid), j = 0; j < path.crds.length; j += 2)
          tpath.crds.push(path.crds[j] + x), tpath.crds.push(path.crds[j + 1]);
        clr && tpath.cmds.push(clr);
        for (j = 0; j < path.cmds.length; j++)
          tpath.cmds.push(path.cmds[j]);
        clr && tpath.cmds.push("X"), x += font.hmtx.aWidth[gid], i < gls.length - 1 && (x += Typr.U.getPairAdjustment(font, gid, gid2));
      }
    }
    return tpath;
  }, Typr.U.pathToSVG = function(path, prec) {
    null == prec && (prec = 5);
    for (var out = [], co = 0, lmap = { M: 2, L: 2, Q: 4, C: 6 }, i = 0; i < path.cmds.length; i++) {
      var cmd = path.cmds[i], cn = co + (lmap[cmd] ? lmap[cmd] : 0);
      for (out.push(cmd); co < cn; ) {
        var c = path.crds[co++];
        out.push(parseFloat(c.toFixed(prec)) + (co == cn ? "" : " "));
      }
    }
    return out.join("");
  }, Typr.U.pathToContext = function(path, ctx) {
    for (var c = 0, crds = path.crds, j = 0; j < path.cmds.length; j++) {
      var cmd = path.cmds[j];
      "M" == cmd ? (ctx.moveTo(crds[c], crds[c + 1]), c += 2) : "L" == cmd ? (ctx.lineTo(crds[c], crds[c + 1]), c += 2) : "C" == cmd ? (ctx.bezierCurveTo(crds[c], crds[c + 1], crds[c + 2], crds[c + 3], crds[c + 4], crds[c + 5]), c += 6) : "Q" == cmd ? (ctx.quadraticCurveTo(crds[c], crds[c + 1], crds[c + 2], crds[c + 3]), c += 4) : "#" == cmd.charAt(0) ? (ctx.beginPath(), ctx.fillStyle = cmd) : "Z" == cmd ? ctx.closePath() : "X" == cmd && ctx.fill();
    }
  }, Typr.U.P = {}, Typr.U.P.moveTo = function(p, x, y) {
    p.cmds.push("M"), p.crds.push(x, y);
  }, Typr.U.P.lineTo = function(p, x, y) {
    p.cmds.push("L"), p.crds.push(x, y);
  }, Typr.U.P.curveTo = function(p, a, b, c, d, e, f) {
    p.cmds.push("C"), p.crds.push(a, b, c, d, e, f);
  }, Typr.U.P.qcurveTo = function(p, a, b, c, d) {
    p.cmds.push("Q"), p.crds.push(a, b, c, d);
  }, Typr.U.P.closePath = function(p) {
    p.cmds.push("Z");
  }, Typr.U._drawCFF = function(cmds, state, font, p) {
    for (var stack = state.stack, nStems = state.nStems, haveWidth = state.haveWidth, width = state.width, open = state.open, i = 0, x = state.x, y = state.y, c1x = 0, c1y = 0, c2x = 0, c2y = 0, c3x = 0, c3y = 0, c4x = 0, c4y = 0, jpx = 0, jpy = 0, o = { val: 0, size: 0 }; i < cmds.length; ) {
      Typr.CFF.getCharString(cmds, i, o);
      var v = o.val;
      if (i += o.size, "o1" == v || "o18" == v)
        stack.length % 2 != 0 && !haveWidth && (width = stack.shift() + font.Private.nominalWidthX), nStems += stack.length >> 1, stack.length = 0, haveWidth = true;
      else if ("o3" == v || "o23" == v) {
        stack.length % 2 != 0 && !haveWidth && (width = stack.shift() + font.Private.nominalWidthX), nStems += stack.length >> 1, stack.length = 0, haveWidth = true;
      } else if ("o4" == v)
        stack.length > 1 && !haveWidth && (width = stack.shift() + font.Private.nominalWidthX, haveWidth = true), open && Typr.U.P.closePath(p), y += stack.pop(), Typr.U.P.moveTo(p, x, y), open = true;
      else if ("o5" == v)
        for (; stack.length > 0; )
          x += stack.shift(), y += stack.shift(), Typr.U.P.lineTo(p, x, y);
      else if ("o6" == v || "o7" == v)
        for (var count = stack.length, isX = "o6" == v, j = 0; j < count; j++) {
          var sval = stack.shift();
          isX ? x += sval : y += sval, isX = !isX, Typr.U.P.lineTo(p, x, y);
        }
      else if ("o8" == v || "o24" == v) {
        count = stack.length;
        for (var index = 0; index + 6 <= count; )
          c1x = x + stack.shift(), c1y = y + stack.shift(), c2x = c1x + stack.shift(), c2y = c1y + stack.shift(), x = c2x + stack.shift(), y = c2y + stack.shift(), Typr.U.P.curveTo(p, c1x, c1y, c2x, c2y, x, y), index += 6;
        "o24" == v && (x += stack.shift(), y += stack.shift(), Typr.U.P.lineTo(p, x, y));
      } else {
        if ("o11" == v)
          break;
        if ("o1234" == v || "o1235" == v || "o1236" == v || "o1237" == v)
          "o1234" == v && (c1y = y, c2x = (c1x = x + stack.shift()) + stack.shift(), jpy = c2y = c1y + stack.shift(), c3y = c2y, c4y = y, x = (c4x = (c3x = (jpx = c2x + stack.shift()) + stack.shift()) + stack.shift()) + stack.shift(), Typr.U.P.curveTo(p, c1x, c1y, c2x, c2y, jpx, jpy), Typr.U.P.curveTo(p, c3x, c3y, c4x, c4y, x, y)), "o1235" == v && (c1x = x + stack.shift(), c1y = y + stack.shift(), c2x = c1x + stack.shift(), c2y = c1y + stack.shift(), jpx = c2x + stack.shift(), jpy = c2y + stack.shift(), c3x = jpx + stack.shift(), c3y = jpy + stack.shift(), c4x = c3x + stack.shift(), c4y = c3y + stack.shift(), x = c4x + stack.shift(), y = c4y + stack.shift(), stack.shift(), Typr.U.P.curveTo(p, c1x, c1y, c2x, c2y, jpx, jpy), Typr.U.P.curveTo(p, c3x, c3y, c4x, c4y, x, y)), "o1236" == v && (c1x = x + stack.shift(), c1y = y + stack.shift(), c2x = c1x + stack.shift(), jpy = c2y = c1y + stack.shift(), c3y = c2y, c4x = (c3x = (jpx = c2x + stack.shift()) + stack.shift()) + stack.shift(), c4y = c3y + stack.shift(), x = c4x + stack.shift(), Typr.U.P.curveTo(p, c1x, c1y, c2x, c2y, jpx, jpy), Typr.U.P.curveTo(p, c3x, c3y, c4x, c4y, x, y)), "o1237" == v && (c1x = x + stack.shift(), c1y = y + stack.shift(), c2x = c1x + stack.shift(), c2y = c1y + stack.shift(), jpx = c2x + stack.shift(), jpy = c2y + stack.shift(), c3x = jpx + stack.shift(), c3y = jpy + stack.shift(), c4x = c3x + stack.shift(), c4y = c3y + stack.shift(), Math.abs(c4x - x) > Math.abs(c4y - y) ? x = c4x + stack.shift() : y = c4y + stack.shift(), Typr.U.P.curveTo(p, c1x, c1y, c2x, c2y, jpx, jpy), Typr.U.P.curveTo(p, c3x, c3y, c4x, c4y, x, y));
        else if ("o14" == v) {
          if (stack.length > 0 && !haveWidth && (width = stack.shift() + font.nominalWidthX, haveWidth = true), 4 == stack.length) {
            var adx = stack.shift(), ady = stack.shift(), bchar = stack.shift(), achar = stack.shift(), bind = Typr.CFF.glyphBySE(font, bchar), aind = Typr.CFF.glyphBySE(font, achar);
            Typr.U._drawCFF(font.CharStrings[bind], state, font, p), state.x = adx, state.y = ady, Typr.U._drawCFF(font.CharStrings[aind], state, font, p);
          }
          open && (Typr.U.P.closePath(p), open = false);
        } else if ("o19" == v || "o20" == v) {
          stack.length % 2 != 0 && !haveWidth && (width = stack.shift() + font.Private.nominalWidthX), nStems += stack.length >> 1, stack.length = 0, haveWidth = true, i += nStems + 7 >> 3;
        } else if ("o21" == v)
          stack.length > 2 && !haveWidth && (width = stack.shift() + font.Private.nominalWidthX, haveWidth = true), y += stack.pop(), x += stack.pop(), open && Typr.U.P.closePath(p), Typr.U.P.moveTo(p, x, y), open = true;
        else if ("o22" == v)
          stack.length > 1 && !haveWidth && (width = stack.shift() + font.Private.nominalWidthX, haveWidth = true), x += stack.pop(), open && Typr.U.P.closePath(p), Typr.U.P.moveTo(p, x, y), open = true;
        else if ("o25" == v) {
          for (; stack.length > 6; )
            x += stack.shift(), y += stack.shift(), Typr.U.P.lineTo(p, x, y);
          c1x = x + stack.shift(), c1y = y + stack.shift(), c2x = c1x + stack.shift(), c2y = c1y + stack.shift(), x = c2x + stack.shift(), y = c2y + stack.shift(), Typr.U.P.curveTo(p, c1x, c1y, c2x, c2y, x, y);
        } else if ("o26" == v)
          for (stack.length % 2 && (x += stack.shift()); stack.length > 0; )
            c1x = x, c1y = y + stack.shift(), x = c2x = c1x + stack.shift(), y = (c2y = c1y + stack.shift()) + stack.shift(), Typr.U.P.curveTo(p, c1x, c1y, c2x, c2y, x, y);
        else if ("o27" == v)
          for (stack.length % 2 && (y += stack.shift()); stack.length > 0; )
            c1y = y, c2x = (c1x = x + stack.shift()) + stack.shift(), c2y = c1y + stack.shift(), x = c2x + stack.shift(), y = c2y, Typr.U.P.curveTo(p, c1x, c1y, c2x, c2y, x, y);
        else if ("o10" == v || "o29" == v) {
          var obj = "o10" == v ? font.Private : font;
          if (0 == stack.length)
            console.log("error: empty stack");
          else {
            var ind = stack.pop(), subr = obj.Subrs[ind + obj.Bias];
            state.x = x, state.y = y, state.nStems = nStems, state.haveWidth = haveWidth, state.width = width, state.open = open, Typr.U._drawCFF(subr, state, font, p), x = state.x, y = state.y, nStems = state.nStems, haveWidth = state.haveWidth, width = state.width, open = state.open;
          }
        } else if ("o30" == v || "o31" == v) {
          var count1 = stack.length, alternate = (index = 0, "o31" == v);
          for (index += count1 - (count = -3 & count1); index < count; )
            alternate ? (c1y = y, c2x = (c1x = x + stack.shift()) + stack.shift(), y = (c2y = c1y + stack.shift()) + stack.shift(), count - index == 5 ? (x = c2x + stack.shift(), index++) : x = c2x, alternate = false) : (c1x = x, c1y = y + stack.shift(), c2x = c1x + stack.shift(), c2y = c1y + stack.shift(), x = c2x + stack.shift(), count - index == 5 ? (y = c2y + stack.shift(), index++) : y = c2y, alternate = true), Typr.U.P.curveTo(p, c1x, c1y, c2x, c2y, x, y), index += 4;
        } else {
          if ("o" == (v + "").charAt(0))
            throw console.log("Unknown operation: " + v, cmds), v;
          stack.push(v);
        }
      }
    }
    state.x = x, state.y = y, state.nStems = nStems, state.haveWidth = haveWidth, state.width = width, state.open = open;
  };
  const Typr$1 = getDefaultExportFromCjs(Typr), questionType = { "单选题": "0", "多选题": "1", "填空题": "2", "判断题": "3", "简答题": "4", "名词解释": "5", "论述题": "6", "计算题": "7" }, log = (data, type = "info") => {
    var _a;
    const style = `color: ${{ info: "orange", success: "green", error: "red" }[type]}; font-weight: bold;`;
    if (Array.isArray(data) || "object" == typeof data ? console.log(`%c${JSON.stringify(data, null, 2)}`, style) : console.log(`%c${data}`, style), defaultConfig$1.debugger) {
      const caller = (((_a = new Error().stack) == null ? void 0 : _a.split("\n")) || [])[2].trim();
      console.log(`${caller}`);
    }
  }, sleep = (time) => new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, 1e3 * time);
  }), randomSleep = (min, max) => new Promise((resolve) => {
    const randomTime = Math.floor(Math.random() * (max - min + 1)) + min;
    setTimeout(() => {
      resolve();
    }, 1e3 * randomTime);
  }), waitIframeLoaded = (iframe, timeout = 3e4) => new Promise((resolve) => {
    if (!iframe) {
      resolve(false);
      return;
    }
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(timeoutTimer);
      iframe.removeEventListener("load", onLoad);
      iframe.removeEventListener("error", onError);
      resolve(result);
    };
    const onLoad = () => finish(true), onError = () => finish(false);
    const timer = setInterval(() => {
      var _a;
      if (iframe.contentDocument && "complete" === ((_a = iframe.contentDocument) == null ? void 0 : _a.readyState)) finish(true);
    }, 100);
    const timeoutTimer = setTimeout(() => finish(false), timeout);
    iframe.addEventListener("load", onLoad, { once: true });
    iframe.addEventListener("error", onError, { once: true });
    if (iframe.contentDocument && "complete" === iframe.contentDocument.readyState) finish(true);
  }), waitElementLoaded = (iframeWindow, selector, timeout = 3e4) => new Promise((resolve) => {
    if (!iframeWindow || !iframeWindow.document) {
      resolve(false);
      return;
    }
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(timeoutTimer);
      resolve(result);
    };
    const timer = setInterval(() => {
      try {
        if (iframeWindow.document.querySelector(selector)) finish(true);
      } catch {
        finish(false);
      }
    }, 100);
    const timeoutTimer = setTimeout(() => finish(false), timeout);
    try {
      if (iframeWindow.document.querySelector(selector)) finish(true);
    } catch {
      finish(false);
    }
  }), removeHtml = (html, baseUrl = document.baseURI) => null == html ? "" : html.replace(/<((?!img|sub|sup|br)[^>]+)>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").replace(/<br\s*\/?>/g, "\n").replace(/<img\b([^>]*)>/gi, (_match, attributes) => {
    try {
      const sourceMatch = /\b(?:src|data-src|data-original|data-original-src)\s*=\s*["']([^"']+)["']/i.exec(attributes);
      const src = String(sourceMatch && sourceMatch[1] || "").trim();
      if (/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(src)) return `<img src="${src}"/>`;
      const resolved = new URL(src, baseUrl);
      return resolved.protocol === "https:" || resolved.protocol === "http:" ? `<img src="${resolved.href}"/>` : "[图片]";
    } catch {
      return "[图片]";
    }
  }).trim(), learningSubscriptMap = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎" }, learningSuperscriptMap = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾" }, mapLearningScriptText = (value, table) => String(value || "").replace(/<[^>]*>/g, "").split("").map((character) => table[character] || character).join(""), formatLearningDisplayText = (value) => {
    const raw = Array.isArray(value) ? value.join("\n") : String(value == null ? "" : value);
    const normalized = raw.replace(/\\(["'])/g, "$1").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<img\b[^>]*>/gi, "[图片]").replace(/<br\s*\/?>/gi, "\n").replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, (_match, content) => mapLearningScriptText(content, learningSubscriptMap)).replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, (_match, content) => mapLearningScriptText(content, learningSuperscriptMap)).replace(/<sub\b[^>]*>([0-9+\-=()]+)/gi, (_match, content) => mapLearningScriptText(content, learningSubscriptMap)).replace(/<sup\b[^>]*>([0-9+\-=()]+)/gi, (_match, content) => mapLearningScriptText(content, learningSuperscriptMap));
    try {
      const parsed = new DOMParser().parseFromString(`<body>${normalized}</body>`, "text/html");
      return (parsed.body.textContent || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
    } catch {
      return normalized.replace(/<[^>]*>/g, "").trim();
    }
  }, formatLearningDisplayHtml = (value) => formatLearningDisplayText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\n/g, "<br>"), parseLearningAiReply = (value) => {
    const content = formatLearningDisplayText(value).replace(/```(?:json|text)?/gi, "").trim();
    try {
      const parsed = JSON.parse(content);
      if (parsed && "object" == typeof parsed && !Array.isArray(parsed)) return {
        answer: "string" == typeof parsed.answer ? parsed.answer.trim() : "",
        explanation: "string" == typeof parsed.explanation ? parsed.explanation.trim() : ""
      };
    } catch (e) {
    }
    const tagged = content.match(/(?:^|\n)\s*答案\s*[:：]\s*([\s\S]*?)(?=\n\s*解题思路\s*[:：]|$)/i);
    const explanation = content.match(/(?:^|\n)\s*解题思路\s*[:：]\s*([\s\S]*)$/i);
    return {
      answer: tagged ? tagged[1].trim() : "",
      explanation: (explanation == null ? void 0 : explanation[1].trim()) || (tagged ? "" : content)
    };
  }, isLearningNonAnswerFeedback = (value) => {
    const normalized = formatLearningDisplayText(value).replace(/\s+/g, " ").trim();
    if (!normalized) return false;
    const imageUnavailable = /(?:缺失|未提供|未上传|无法(?:查看|读取|识别)|看不到|未能(?:查看|读取|识别)).{0,12}(?:图片|图像)|(?:图片|图像).{0,12}(?:缺失|未提供|未上传|不可用|无法(?:查看|读取|识别)|看不到)/i.test(normalized);
    const cannotAnswer = /(?:无法|不能|没法|难以).{0,10}(?:完成|作答|回答|判断|确定|解答)|(?:完成|作答|回答|判断|确定|解答).{0,10}(?:不了|无法|不能)/i.test(normalized);
    const incompleteQuestion = /(?:信息|条件|题干).{0,8}(?:不足|不完整|缺失).{0,16}(?:无法|不能|没法).{0,10}(?:确定|作答|回答|完成|判断|解答)/i.test(normalized);
    const englishFeedback = /(?:missing|unavailable|not provided|cannot (?:see|read)|unable to (?:see|read)).{0,24}(?:image|picture).{0,40}(?:cannot|can't|unable to).{0,16}(?:answer|complete|determine)|(?:cannot|can't|unable to).{0,16}(?:answer|complete|determine).{0,40}(?:missing|unavailable|image|picture)/i.test(normalized);
    return imageUnavailable && cannotAnswer || incompleteQuestion || englishFeedback;
  }, learningAnswerDisplay = (source, fallback = "") => formatLearningDisplayText(source && (source.displayAnswer || source.answer) || fallback || ""), cl = (str) => str.replace(/^【.*?】\s*/, "").replace(/\s*（\d+\.\d+分）$/, ""), getQuestion = (type, html) => {
    let questionHtml, questionText, questionTypeId, optionHtml, tokenHtml, workType, optionText, index;
    switch (type) {
      case "1":
        return workType = "zj", questionHtml = Array.from(html.querySelectorAll(".clearfix .fontLabel")), questionText = cl(removeHtml(questionHtml[0].innerHTML, questionHtml[0].ownerDocument.baseURI)), questionTypeId = html.querySelectorAll("input[name^=answertype]")[0].value, optionHtml = Array.from(html.querySelectorAll("ul")[0].querySelectorAll("li .after")), tokenHtml = html.innerHTML, optionText = [], optionHtml.forEach(function(item) {
          optionText.push(removeHtml(item.innerHTML, item.ownerDocument.baseURI));
        }), { question: questionText, options: optionText, type: questionTypeId, questionData: tokenHtml, workType };
      case "2":
        workType = "zy", questionHtml = Array.from(html.querySelectorAll(".mark_name")), index = questionHtml[0].innerHTML.indexOf("</span>"), questionText = cl(removeHtml(questionHtml[0].innerHTML.substring(index + 7), questionHtml[0].ownerDocument.baseURI)), questionHtml[0].getElementsByTagName("span")[0].innerHTML.replace("(", "").replace(")", "").split(",")[0], questionTypeId = html.querySelectorAll("input[name^=answertype]")[0].value, optionHtml = Array.from(html.querySelectorAll(".answer_p")), tokenHtml = html.innerHTML, optionText = [];
        for (let i = 0; i < optionHtml.length; i++)
          optionText.push(removeHtml(optionHtml[i].innerHTML, optionHtml[i].ownerDocument.baseURI));
        return { question: questionText, options: optionText, type: questionTypeId, questionData: tokenHtml, workType };
      case "3":
        workType = "ks", questionHtml = Array.from(document.getElementsByClassName("mark_name colorDeep")), index = questionHtml[0].innerHTML.indexOf("</span>"), questionText = cl(removeHtml(questionHtml[0].innerHTML.substring(index + 7), questionHtml[0].ownerDocument.baseURI)), questionHtml[0].getElementsByTagName("span")[0].innerHTML.replace("(", "").replace(")", "").split(",")[0], questionTypeId = document.querySelectorAll("input[name^=type]")[1].value, optionHtml = Array.from(document.getElementsByClassName("answer_p")), tokenHtml = document.getElementsByClassName("mark_table")[0].innerHTML, optionText = [];
        for (let i = 0; i < optionHtml.length; i++)
          optionText.push(removeHtml(optionHtml[i].innerHTML, optionHtml[i].ownerDocument.baseURI));
        return { question: questionText, options: optionText, type: questionTypeId, questionData: tokenHtml, workType };
    }
  }, decode = (iframeWindow) => {
    var _a;
    const styleElements = iframeWindow.document.querySelectorAll("style");
    let tipElement = null;
    if (styleElements.forEach((styleElement) => {
      var _a2;
      -1 !== ((_a2 = styleElement.textContent) == null ? void 0 : _a2.indexOf("font-cxsecret")) && (tipElement = styleElement);
    }), !tipElement)
      return;
    const fontMatch = (_a = tipElement.textContent) == null ? void 0 : _a.match(/base64,([\w\W]+?)'/);
    if (!fontMatch)
      return;
    const fontData = ((base64) => {
      const decodedData = atob(base64), array = new Uint8Array(decodedData.length);
      for (let i = 0; i < decodedData.length; i++)
        array[i] = decodedData.charCodeAt(i);
      return array;
    })(fontMatch[1]), font = Typr$1.parse(fontData), table = JSON.parse(_GM_getResourceText("ttf"));
    let text = {};
    for (let i = 19968; i < 40870; i++) {
      let t = Typr$1.U.codeToGlyph(font, i);
      t && (t = Typr$1.U.glyphToPath(font, t), t = md5(JSON.stringify(t)).slice(24), text[i] = table[t]);
    }
    iframeWindow.document.querySelectorAll(".font-cxsecret").forEach((fontElement) => {
      let html = fontElement.innerHTML;
      Object.keys(text).forEach((key) => {
        const regex = new RegExp(String.fromCharCode(key), "g");
        html = html.replace(regex, String.fromCharCode(text[key]));
      }), fontElement.innerHTML = html, fontElement.classList.remove("font-cxsecret");
    });
  }, getAnswers = async (questionData, windowz = _unsafeWindow) => {
    let server = new ServerApi(windowz);
    const config = getConfig();
    const typeNames = { "0": "单选题", "1": "多选题", "2": "填空题", "3": "判断题", "4": "简答题", "5": "名词解释", "6": "论述题", "7": "计算题" };
    const typeName = typeNames[questionData.type] || "单选题";

    // 优先使用自定义题库
    if (config.customApiEnabled && config.customApiUrl) {
      console.log(`使用自定义题库获取答案... 题型: ${typeName}`);
      const customResult = await server.getAnswerFromCustomApi(questionData);
      if (customResult.answer && customResult.answer.length > 0) {
        return [customResult];
      }
      console.log("自定义题库未找到答案，尝试其他方式...");
    }

    // 使用AI自动答题
    if (config.aiEnabled) {
      console.log(`使用AI获取答案... 模型: ${config.aiModel}, 题型: ${typeName}`);
      const aiResult = await server.getAnswerFromAI(questionData);
      if (aiResult.answer && aiResult.answer.length > 0) {
        return [aiResult];
      }
    }

    return [{ form: "AI", answer: "" }];
  }, fillAnswer = (answer, questionData, html, iframeWindow) => {
    answer = answer.filter((item) => {
      const values = Array.isArray(item.answer) ? item.answer : [item.answer];
      return values.length > 0 && values.every((value) => {
        const text = formatLearningDisplayText(value).trim();
        return text && !isLearningNonAnswerFeedback(text) && !/^\s*(?:解题思路|说明|原因)\s*[:：]/i.test(text);
      });
    }), console.log(answer);
    for (let i = 0; i < answer.length; i++) {
      if ("string" == typeof answer[i].answer) {
        if (-1 !== answer[i].answer.indexOf("付费题库") || -1 !== answer[i].answer.indexOf("暂无答案") || "略" == answer[i].answer)
          continue;
        answer[i].answer = [answer[i].answer];
      }
      let tmp = setAnswer(answer[i].answer, questionData, html, iframeWindow);
      if (tmp)
        return tmp;
    }
    return false;
  }, setAnswer = (answer, questionData, html, iframeWindow) => {
    switch (questionData.type) {
      case "0":
      case "1":
        const matchArr = matchAnswer(answer, questionData.options);
        matchArr.length > 0 && clearCurrent(html, iframeWindow);
        for (var i = 0; i < matchArr.length; i++)
          console.log($$1(html).find("li").eq(matchArr[i]), matchArr[i]), $$1(html).find("ul:eq(0) li :radio,:checkbox,textarea").eq(matchArr[i]).click(), $$1(html).find(".answerBg").eq(matchArr[i]).click(), $$1(html).find("li").eq(matchArr[i]).click();
        return matchArr.length > 0 && answer;
      case "3":
        return clearCurrent(html, iframeWindow), answer instanceof Array && (answer = answer[0]), $$1(html).find("ul:eq(0) li :radio,:checkbox,textarea").each(function() {
          "true" == $$1(this).val() ? answer.match(/(^|,)(True|true|正确|是|对|√|T|ri)(,|$)/) && $$1(this).click() : answer.match(/(^|,)(False|false|错误|否|错|×|F|wr)(,|$)/) && $$1(this).click();
        }), $$1(html).find(".answerBg").each(function() {
          "true" == $$1(this).find(".num_option").attr("data") ? answer.match(/(^|,)(True|true|正确|是|对|√|T|ri)(,|$)/) && $$1(this).click() : answer.match(/(^|,)(False|false|错误|否|错|×|F|wr)(,|$)/) && $$1(this).click();
        }), !!($$1(html).find("ul:eq(0) li :radio,:checkbox,textarea").is(":checked") || $$1(html).find(".check_answer").length > 0 || $$1(html).find(".check_answer_dx").length > 0) && answer;
      case "2":
      case "9":
      case "4":
      case "5":
      case "6":
      case "7":
        return clearCurrent(html, iframeWindow), $$1(html).find("textarea").each(function(index) {
          if (index < answer.length) {
            iframeWindow.UE.getEditor($$1(this).attr("name")).ready(function() {
              this.setContent(answer[index].replace(/第.空:/g, ""));
            });
          }
        }), answer;
      default:
        return false;
    }
  }, matchAnswer = (answer, options) => {
    answer = ((answer2) => {
      if (answer2 instanceof Array) {
        answer2 = answer2.filter(function(item) {
          return null !== item;
        });
        for (let i2 = 0; i2 < answer2.length; i2++)
          answer2[i2] = removeHtml(answer2[i2]);
      } else
        "string" == typeof answer2 && (answer2 = cl(answer2));
      return answer2;
    })(answer);
    for (var matchArr = [], i = 0; i < answer.length; i++)
      for (var j = 0; j < options.length; j++)
        answer[i] == options[j] && matchArr.push(j);
    return matchArr;
  }, clearCurrent = (item, iframeWindow) => {
    $$1(item).find(".answerBg, .textDIV, .eidtDiv").each(function() {
      ($$1(this).find(".check_answer").length || $$1(this).find(".check_answer_dx").length) && $$1(this).click();
    }), $$1(item).find("textarea").each(function() {
      iframeWindow.UE.getEditor($$1(this).attr("name")).ready(function() {
        this.setContent("");
      });
    }), $$1(item).find(":radio, :checkbox").prop("checked", false), $$1(item).find("textarea").each(function() {
      iframeWindow.UE.getEditor($$1(this).attr("name")).ready(function() {
        this.setContent("");
      });
    });
  }, useAskStore = pinia$1.defineStore({ id: "ask", state: () => ({ task: { name: "暂未加载", work: { questionList: [], inx: 0 }, activity: { active: false, label: "", detail: "", progress: null }, log: [], status: "" } }), actions: { reset() {
    this.task.name = "暂未加载", this.task.work = { questionList: [], inx: 0 }, this.task.activity = { active: false, label: "", detail: "", progress: null }, this.task.status = "";
  }, select(index) {
    this.task.work.questionList[index].selected = true, this.task.work.inx = index;
    try {
      this.task.work.questionList[index].dom.scrollIntoView({ block: "center" });
    } catch (e) {
      log(e, "error");
    }
  }, get(index) {
    return this.task.work.questionList[index];
  }, insert(question) {
    this.task.work.questionList.push({ ...question, question: String(question == null ? "" : question.question || "") });
  }, update(index, question) {
    this.task.work.questionList[index] = { ...question, question: String(question == null ? "" : question.question || "") };
  }, log(msg, level = "info") {
    this.task.log.length > 20 && this.task.log.shift(), this.task.log.push({ time: (/* @__PURE__ */ new Date()).toLocaleTimeString(), msg, type: level }), reportToHost("log", msg);
  }, msg(msg) {
    this.task.status = msg, reportToHost("status", msg);
  }, setActivity(label, detail, progress = null, active = true) {
    this.task.name = label || "当前任务", this.task.status = detail || "", this.task.activity = { active: Boolean(active), label: label || "当前任务", detail: detail || "", progress: Number.isFinite(Number(progress)) ? Math.max(0, Math.min(100, Number(progress))) : null };
  } } });
  const formatMediaTime = (seconds) => {
    const value = Math.max(0, Number(seconds) || 0), minutes = Math.floor(value / 60), rest = Math.floor(value % 60);
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  };
  class Cx {
    constructor() {
      __publicField(this, "askStore");
      __publicField(this, "ServerApi");
      __publicField(this, "defaultConfig");
      this.askStore = useAskStore(pinia), this.ServerApi = new ServerApi(), this.defaultConfig = getConfig(), mountAssistantWorkspace(this.askStore);
    }
    innerbook() {
    }
    async audio(iframeWindow, taskCurrent = () => true) {
      await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续"));
      if (!taskCurrent()) return;
      this.askStore.reset(), this.askStore.setActivity("音频任务", "正在加载音频", 0);
      const audio = iframeWindow.document.getElementById("audio_html5_api");
      return audio.muted = true, audio.autoplay = true, audio.volume = 0, audio.play().then(function() {
        console.log("播放成功");
      }).catch(function(error) {
        "NotAllowedError" === error.name ? ElementPlus.ElMessageBox.alert("由于自动播放需要用户点击过浏览器，请确认即可", "温馨提示", { confirmButtonText: "确认", callback: () => {
          audio.play();
        } }) : console.error("视频播放失败，原因：", error);
      }), new Promise((resolve) => {
        const intervalId = setInterval(() => {
          if (!taskCurrent()) {
            audio.pause(), clearInterval(intervalId), resolve();
            return;
          }
          const duration = Number(audio.duration) || 0, current = Number(audio.currentTime) || 0, progress = duration > 0 ? current / duration * 100 : null;
          this.askStore.setActivity("音频任务", `${assistantRuntime.isPaused() ? "已暂停" : "正在自动播放"}${duration > 0 ? ` · ${formatMediaTime(current)} / ${formatMediaTime(duration)}` : ""}`, progress);
          audio.ended ? (this.askStore.setActivity("音频任务", "音频播放完成", 100, false), clearInterval(intervalId), log("监听到音频已完成", "success"), resolve()) : assistantRuntime.isPaused() ? audio.pause() : audio.paused && audio.play();
        }, 1e3);
        audio.addEventListener("ended", () => {
          taskCurrent() && (this.askStore.setActivity("音频任务", "音频播放完成", 100, false), log("监听到音频已完成1", "success")), audio.pause(), clearInterval(intervalId), resolve();
        });
      });
    }
    async video(iframeWindow, taskCurrent = () => true) {
      await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续"));
      if (!taskCurrent()) return;
      this.askStore.reset(), this.askStore.setActivity("视频任务", "正在加载视频", 0), await waitElementLoaded(iframeWindow, "#video_html5_api"), console.log("视频加载完成");
      if (!taskCurrent()) return;
      const player = iframeWindow.videojs("video_html5_api"), playerButton = iframeWindow.document.querySelector(".vjs-big-play-button"), nativePlayerPause = player.pause.bind(player);
      player.muted(true), player.playbackRate(16), player.play();

      // 生成随机暂停时间（30-93秒）
      const randomPauseTime = Math.floor(Math.random() * (93 - 30 + 1)) + 30;
      let pauseTimer = null;
      let mouseMoveTimer = null;

      // 随机暂停功能
      const scheduleRandomPause = () => {
        const delay = Math.floor(Math.random() * (93 - 30 + 1) + 30) * 1000;
        pauseTimer = setTimeout(() => {
          if (taskCurrent() && !player.paused() && !assistantRuntime.isPaused()) {
            nativePlayerPause();
            console.log(`[视频] 已随机暂停，暂停时间: ${delay / 1000}秒`);
            // 暂停2-5秒后恢复播放
            setTimeout(() => {
              if (taskCurrent() && !assistantRuntime.isPaused() && player.paused() && "isUnFinishJob" in iframeWindow && iframeWindow.isUnFinishJob()) {
                player.play();
                console.log("[视频] 已恢复播放");
                scheduleRandomPause();
              }
            }, Math.floor(Math.random() * (5 - 2 + 1) + 2) * 1000);
          }
        }, delay);
      };
      scheduleRandomPause();

      // 模拟鼠标滑动功能
      const simulateMouseMovement = () => {
        const doc = iframeWindow.document;
        const videoElement = doc.querySelector("#video_html5_api") || doc.body;

        // 生成随机位置
        const rect = videoElement.getBoundingClientRect();
        const x = Math.floor(Math.random() * rect.width) + rect.left;
        const y = Math.floor(Math.random() * rect.height) + rect.top;

        // 创建并分发鼠标事件
        const events = ["mousemove", "mouseover", "mouseenter"];
        events.forEach(eventType => {
          const event = new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: iframeWindow,
            clientX: x,
            clientY: y,
            screenX: x + (iframeWindow.screenX || 0),
            screenY: y + (iframeWindow.screenY || 0),
            movementX: Math.floor(Math.random() * 10) - 5,
            movementY: Math.floor(Math.random() * 10) - 5
          });
          videoElement.dispatchEvent(event);
        });

        // 随机滚动页面
        if (Math.random() > 0.7) {
          const scrollAmount = Math.floor(Math.random() * 100) - 50;
          iframeWindow.scrollBy(0, scrollAmount);
        }
      };

      // 每3-8秒模拟一次鼠标活动
      const scheduleMouseMovement = () => {
        const delay = Math.floor(Math.random() * (8 - 3 + 1) + 3) * 1000;
        mouseMoveTimer = setTimeout(() => {
          taskCurrent() && (assistantRuntime.isPaused() || simulateMouseMovement());
          if (taskCurrent() && "isUnFinishJob" in iframeWindow && iframeWindow.isUnFinishJob()) {
            scheduleMouseMovement();
          }
        }, delay);
      };
      scheduleMouseMovement();

      await new Promise((resolve) => {
        const intervalId = setInterval(() => {
          if (!taskCurrent()) {
            nativePlayerPause(), clearInterval(intervalId), clearTimeout(pauseTimer), clearTimeout(mouseMoveTimer), resolve();
            return;
          }
          const duration = Number(player.duration()) || 0, current = Number(player.currentTime()) || 0, progress = duration > 0 ? current / duration * 100 : null;
          this.askStore.setActivity("视频任务", `${assistantRuntime.isPaused() ? "已暂停" : "正在自动播放"}${duration > 0 ? ` · ${formatMediaTime(current)} / ${formatMediaTime(duration)}` : ""}`, progress);
          if (assistantRuntime.isPaused()) {
            nativePlayerPause();
            return;
          }
          "isUnFinishJob" in iframeWindow && iframeWindow.isUnFinishJob() ? player.paused() && (playerButton == null ? void 0 : playerButton.click()) : (clearInterval(intervalId), clearTimeout(pauseTimer), clearTimeout(mouseMoveTimer), resolve());
        }, 1e3), pauseBase = player.pause;
        player.pause = function() {
          taskCurrent() && player.currentTime() >= player.duration() && (console.log("视频播放完成"), player.pause = pauseBase, clearTimeout(pauseTimer), clearTimeout(mouseMoveTimer), resolve());
        }, player.on("ended", () => {
          taskCurrent() && (this.askStore.setActivity("视频任务", "视频播放完成", 100, false), console.log("视频播放完成1")), player.pause = pauseBase, player.pause(), clearInterval(intervalId), clearTimeout(pauseTimer), clearTimeout(mouseMoveTimer), resolve();
        });
      }), taskCurrent() && (this.askStore.setActivity("视频任务", "视频播放完成", 100, false), console.log("任务点完成"));
    }
    work(iframeWindow, taskCurrent = () => true) {
      return new Promise(async (resolve) => {
        await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续"));
        if (!taskCurrent()) return void resolve();
        decode(iframeWindow);
        const Timu = iframeWindow.document.querySelectorAll(".TiMu");
        if (!Timu.length)
          return void resolve();
        let ques = [], succ = 0;
        for (let i = 0; i < Timu.length; i++) {
          let data = getQuestion("1", Timu[i]);
          console.log(data), ques.push(data);
        }
        this.askStore.reset(), this.askStore.setActivity("章节测验", `已识别 ${ques.length} 道题，准备获取答案`, 0);
        for (let i = 0; i < ques.length; i++) {
          if (!taskCurrent()) return void resolve();
          this.askStore.setActivity("章节测验", `正在处理第 ${i + 1}/${ques.length} 题`, Math.round(i / Math.max(1, ques.length) * 100));
          await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续")), await randomSleep(this.defaultConfig.answerIntervalMin, this.defaultConfig.answerIntervalMax), await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续")), this.askStore.insert(ques[i]), this.askStore.task.work.inx = i;
          if (!taskCurrent()) return void resolve();
          let data = await getAnswers(ques[i], iframeWindow);
          if (!taskCurrent()) return void resolve();
          this.askStore.get(i).allAnswer = data.map((item) => ({ ...item, answer: learningAnswerDisplay(item, "暂无答案"), explanation: String(item.explanation || "") }));
          await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续"));
          if (!taskCurrent()) return void resolve();
          let tmp = fillAnswer(data, ques[i], Timu[i], iframeWindow);
          tmp ? (this.askStore.get(i).status = "primary", this.askStore.get(i).answer = learningAnswerDisplay(data[0], tmp), succ++) : (this.askStore.get(i).status = "danger", this.askStore.get(i).answer = "暂无答案"), this.askStore.get(i).dom = Timu[i];
        }
        if (!taskCurrent()) return void resolve();
        const submitConfig = getConfig();
        if (!submitConfig.autoSubmit) {
          iframeWindow.alert = function(e) { console.log("alert 方法被阻止", e); };
          iframeWindow.noSubmit();
          this.askStore.log("章节测验答案已暂时保存；自动提交已关闭，请检查后手动提交", "success");
          this.askStore.task.status = `已暂时保存 ${succ}/${ques.length} 题，等待手动提交`;
          return void resolve();
        }
        if (succ < ques.length) {
          this.askStore.log(`仍有 ${ques.length - succ} 道题未获得答案，已暂存且不会自动提交`, "error");
          iframeWindow.alert = function(e) { console.log("alert 方法被阻止", e); };
          iframeWindow.noSubmit();
        } else {
          await randomSleep(submitConfig.submitDelayMin, submitConfig.submitDelayMax);
          if (!taskCurrent()) return void resolve();
          await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，不会提交章节测验"));
          if (!taskCurrent()) return void resolve();
          iframeWindow.btnBlueSubmit();
          await sleep(3);
          if (!taskCurrent()) return void resolve();
          iframeWindow.submitCheckTimes();
          this.askStore.log("章节测验已完成", "success");
          await randomSleep(5, 10);
          if (!taskCurrent()) return void resolve();
          await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，不会切换页面"));
          if (!taskCurrent()) return void resolve();
          this.askStore.log("正在刷新页面...", "info");
          iframeWindow.location.reload();
        }
        if (taskCurrent()) this.askStore.task.status = `章节测验已完成，已填写 ${succ}/${ques.length} 题，等待切换`;
        resolve();
      });
    }
    homework() {
      return new Promise(async (resolve) => {
        await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续"));
        const Timu = _unsafeWindow.document.querySelectorAll(".questionLi");
        if (!Timu.length)
          return void resolve();
        let ques = [];
        for (let i = 0; i < Timu.length; i++) {
          let data = getQuestion("2", Timu[i]);
          ques.push(data);
        }
        this.askStore.reset(), this.askStore.setActivity("作业", `已识别 ${ques.length} 道题，准备获取答案`, 0);
        for (let i = 0; i < ques.length; i++) {
          this.askStore.setActivity("作业", `正在处理第 ${i + 1}/${ques.length} 题`, Math.round(i / Math.max(1, ques.length) * 100));
          await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续")), await randomSleep(this.defaultConfig.answerIntervalMin, this.defaultConfig.answerIntervalMax), await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续")), this.askStore.insert(ques[i]), this.askStore.task.work.inx = i;
          let data = await getAnswers(ques[i]);
          this.askStore.get(i).allAnswer = data.map((item) => ({ ...item, answer: learningAnswerDisplay(item, "暂无答案"), explanation: String(item.explanation || "") }));
          await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续"));
          let tmp = fillAnswer(data, ques[i], Timu[i], _unsafeWindow);
          tmp ? (this.askStore.get(i).status = "primary", this.askStore.get(i).answer = learningAnswerDisplay(data[0], tmp)) : (this.askStore.get(i).status = "danger", this.askStore.get(i).answer = "暂无答案"), this.askStore.get(i).dom = Timu[i];
        }
        this.askStore.msg("作业答案已填写，请检查后手动提交");
        resolve();
      });
    }
    exam() {
      return new Promise(async (resolve) => {
        await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续"));
        this.askStore.reset(), this.askStore.setActivity("考试", "已识别当前题目，准备获取答案", 0);
        let data = getQuestion("3", _unsafeWindow.document.body);
        this.askStore.insert(data), this.askStore.task.work.inx = 0;
        let data1 = await getAnswers(data);
        this.askStore.get(0).allAnswer = data1.map((item) => ({ ...item, answer: learningAnswerDisplay(item, "暂无答案"), explanation: String(item.explanation || "") }));
        await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，点击“开始助手”后继续"));
        let tmp = fillAnswer(data1, data, document.getElementsByClassName("mark_table")[0], _unsafeWindow);
        if (tmp ? (this.askStore.get(0).status = "primary", this.askStore.get(0).answer = learningAnswerDisplay(data1[0], tmp)) : (this.askStore.get(0).status = "danger", this.askStore.get(0).answer = "暂无答案"), getConfig().autoExam) {
          await randomSleep(this.defaultConfig.answerIntervalMin, this.defaultConfig.answerIntervalMax);
          await assistantRuntime.waitUntilRunning(() => this.askStore.msg("助手已暂停，不会切换考试题目"));
          const nextButton = $('.nextDiv .jb_btn:contains("下一题")');
          nextButton.length > 0 ? nextButton.click() : (this.askStore.log("已完成答题，请自行检查答案填写后自行提交", "success"), this.askStore.task.status = "已完成答题，请自行检查答案填写后自行提交");
        } else
          this.askStore.task.status = "未开启自动切换，等待手动切换";
        resolve();
      });
    }
    pdf(iframeWindow) {
      return new Promise(async (resolve) => {
        const contentWindow = iframeWindow.document.querySelector("#panView").contentWindow;
        contentWindow.scrollTo(0, contentWindow.document.body.scrollHeight), resolve();
      });
    }
    async s(iframeWindow) {
      const questionList = $(iframeWindow.document).find(".TiMu").map(function(index, element) {
        try {
          let questionHtml, questionText, questionType$1, questionAnswer, questionOption = [], questionAnalysis = "";
          switch (questionHtml = $(element).find(".Zy_TItle .clearfix"), questionText = removeHtml(questionHtml[0].innerHTML), questionType$1 = questionText.match(/^\【(.+?)\】/)[1], questionText = questionText.replace(questionText.match(/^\【(.+?)\】/)[0], ""), questionType$1) {
            case "单选题":
            case "多选题":
              return questionOption = $(element).find("ul>li").map(function(inx, item) {
                return removeHtml($(item).find("a").html());
              }).get(), null;
            case "判断题":
              if (questionAnalysis = removeHtml($(element).find(".Py_addpy:eq(0)").html() || ""), element.innerHTML.includes("正确答案"))
                questionAnswer = removeHtml($(element).find(".Py_answer.clearfix>span").html());
              else {
                const match = $(element).find(".Py_answer.clearfix").html().match(/^(.*?)(?=<i class="fr (dui|cuo)"><\/i>)/s), result = match ? match[1] : "";
                questionAnswer = removeHtml(result);
              }
              if (questionAnswer.includes("正确答案"))
                questionAnswer = questionAnswer.replace("正确答案：", "").trim();
              else if ($(element).find(".fr.dui").length > 0)
                questionAnswer = questionAnswer.replace("我的答案：", "").trim();
              else {
                if (!questionAnswer.replace("我的答案：", "").trim().includes("√") && !questionAnswer.replace("我的答案：", "").trim().includes("×"))
                  return null;
                questionAnswer = "√" == questionAnswer.replace("我的答案：", "").trim() ? "×" : "√";
              }
              break;
            case "填空题":
              if (questionAnswer = $("span.font14", $(element)).map(function(inx, item) {
                return removeHtml($(item).html()).replace(/^第.空：/, "").trim();
              }).get(), 0 == questionAnswer.length) {
                if (questionAnswer = $(element).find(".Py_answer.clearfix>div>div[class='font14']"), !(questionAnswer.length = $(element).find(".Py_answer.clearfix>div>div[class='font14']>>.fr.dui").length))
                  return null;
                questionAnswer = questionAnswer.map(function(inx, item) {
                  return removeHtml($(item).html()).replace(/^第.空：/, "").trim();
                }).get();
              }
              break;
            default:
              return null;
          }
          return { question: questionText, options: questionOption, type: questionType[questionType$1], answer: questionAnswer };
        } catch {
          return null;
        }
      }).get();
      await this.ServerApi.s(questionList, iframeWindow.location.href);
    }
  }
  const pinia = pinia$1.createPinia(), _self = _unsafeWindow, top = _self.top, formStore = useformStore(pinia);
  const assistantName = "药大拾间·学习通助手";
  const assistantRuntime = (() => {
    let host = _self;
    try {
      host = top && top.document ? top : _self;
    } catch {
      host = _self;
    }
    const runtimeKey = "__cpuLearningAssistantRuntimeV1__";
    if (host[runtimeKey]) return host[runtimeKey];
    const pausedStorageKey = "cpu-learning-assistant-paused";
    let paused = false;
    try {
      paused = host.sessionStorage.getItem(pausedStorageKey) === "1";
    } catch {
      // 会话存储不可用时仅不记忆暂停状态。
    }
    const waiters = /* @__PURE__ */ new Set(), listeners = /* @__PURE__ */ new Set();
    const runtime = {
      isPaused: () => paused,
      setPaused(nextPaused) {
        paused = Boolean(nextPaused);
        try {
          host.sessionStorage.setItem(pausedStorageKey, paused ? "1" : "0");
        } catch {
          // 会话存储不可用时仍允许本次暂停。
        }
        listeners.forEach((listener) => listener(paused));
        if (!paused) {
          waiters.forEach((resolve) => resolve());
          waiters.clear();
        }
        reportToHost("status", paused ? "学习通助手已暂停" : "学习通助手已开始");
      },
      toggle() {
        runtime.setPaused(!paused);
      },
      subscribe(listener) {
        listeners.add(listener);
        listener(paused);
        return () => listeners.delete(listener);
      },
      waitUntilRunning(onPause) {
        if (!paused) return Promise.resolve();
        onPause == null ? void 0 : onPause();
        return new Promise((resolve) => waiters.add(resolve));
      }
    };
    host[runtimeKey] = runtime;
    return runtime;
  })();
  const mountAssistantWorkspace = (initialStore) => {
    let host = _self;
    try {
      host = top && top.document ? top : _self;
    } catch {
      host = _self;
    }
    const workspaceKey = "__cpuLearningAssistantWorkspaceV2__";
    if (host[workspaceKey]) {
      host[workspaceKey].setStore(initialStore);
      return host[workspaceKey];
    }
    const doc = host.document, panelId = "cpu-learning-assistant-panel", launcherId = "cpu-learning-assistant-launcher";
    doc.getElementById("cpu-learning-runtime-controls") == null ? void 0 : doc.getElementById("cpu-learning-runtime-controls").remove();
    const style = doc.createElement("style");
    style.id = "cpu-learning-assistant-workspace-style";
    style.textContent = `
      #${panelId}, #${panelId} *, #${launcherId}, #${launcherId} * { box-sizing: border-box; }
      #${panelId}[hidden], #${launcherId}[hidden] { display: none !important; }
      #${panelId} {
        --cpu-la-primary: #4d907e; --cpu-la-primary-strong: #2f6f60; --cpu-la-primary-soft: #e7f3ef;
        --cpu-la-surface: rgba(250, 253, 252, .98); --cpu-la-card: #fff; --cpu-la-subtle: #f1f6f4; --cpu-la-answer: #f2f8f6;
        --cpu-la-text: #172033; --cpu-la-muted: #728095; --cpu-la-muted-strong: #516174;
        --cpu-la-border: #dbe8e4; --cpu-la-border-soft: #e1e9ec; --cpu-la-danger: #b42318;
        --cpu-la-warning-bg: #fff0dc; --cpu-la-warning-text: #a85808; --cpu-la-on-primary: #fff;
        --cpu-la-tab-shadow: 0 1px 6px rgba(15, 23, 42, .09); --cpu-la-shadow: 0 24px 70px rgba(15, 23, 42, .2);
        position: fixed; right: 22px; top: 78px; z-index: 2147482998;
        width: min(430px, calc(100vw - 32px)); max-height: calc(100vh - 116px);
        display: flex; flex-direction: column; overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--cpu-la-primary) 30%, transparent); border-radius: 20px;
        background: var(--cpu-la-surface); color: var(--cpu-la-text); color-scheme: light;
        box-shadow: var(--cpu-la-shadow);
        font: 14px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${panelId} button, #${panelId} input { font: inherit; }
      #${panelId} button { cursor: pointer; }
      #${panelId} .cpu-la-header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--cpu-la-border); cursor: move; touch-action: none; user-select: none; }
      #${panelId} .cpu-la-header button { cursor: pointer; }
      #${panelId} .cpu-la-mark { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border-radius: 13px; background: var(--cpu-la-primary); color: var(--cpu-la-on-primary); font-size: 18px; font-weight: 800; }
      #${panelId} .cpu-la-heading { min-width: 0; flex: 1; }
      #${panelId} .cpu-la-heading strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; }
      #${panelId} .cpu-la-heading span { display: block; color: var(--cpu-la-muted); font-size: 12px; }
      #${panelId} .cpu-la-run, #${panelId} .cpu-la-shot, #${panelId} .cpu-la-icon { display: grid; width: 38px; height: 38px; min-width: 38px; min-height: 38px; place-items: center; padding: 0; border: 1px solid var(--cpu-la-border); border-radius: 11px; background: var(--cpu-la-card); color: var(--cpu-la-muted-strong); transition: background .16s ease, border-color .16s ease, color .16s ease; }
      #${panelId} .cpu-la-run, #${panelId} .cpu-la-shot { color: var(--cpu-la-primary-strong); }
      #${panelId} .cpu-la-run:hover, #${panelId} .cpu-la-shot:hover, #${panelId} .cpu-la-icon:hover { border-color: color-mix(in srgb, var(--cpu-la-primary) 55%, var(--cpu-la-border)); background: var(--cpu-la-subtle); }
      #${panelId} .cpu-la-run svg, #${panelId} .cpu-la-shot svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
      #${panelId}[data-paused="true"] .cpu-la-run { color: var(--cpu-la-warning-text); }
      #${panelId} .cpu-la-icon { font-size: 19px; line-height: 1; }
      #${panelId} .cpu-la-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; padding: 8px 12px; background: var(--cpu-la-subtle); }
      #${panelId} .cpu-la-tabs button { min-height: 34px; border: 0; border-radius: 9px; background: transparent; color: var(--cpu-la-muted); font-weight: 650; }
      #${panelId} .cpu-la-tabs button[aria-selected="true"] { background: var(--cpu-la-card); color: var(--cpu-la-primary-strong); box-shadow: var(--cpu-la-tab-shadow); }
      #${panelId} .cpu-la-body { min-height: 0; overflow: auto; padding: 14px 16px; }
      #${panelId} .cpu-la-card { padding: 14px; border: 1px solid var(--cpu-la-border-soft); border-radius: 14px; background: var(--cpu-la-card); }
      #${panelId} .cpu-la-card + .cpu-la-card { margin-top: 10px; }
      #${panelId} .cpu-la-kicker { color: var(--cpu-la-primary); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
      #${panelId} .cpu-la-title { margin: 4px 0 2px; font-size: 18px; line-height: 1.35; }
      #${panelId} .cpu-la-muted { color: var(--cpu-la-muted); }
      #${panelId} .cpu-la-progress { height: 6px; margin-top: 12px; overflow: hidden; border-radius: 999px; background: var(--cpu-la-border); }
      #${panelId} .cpu-la-progress i { display: block; height: 100%; border-radius: inherit; background: var(--cpu-la-primary); transition: width .2s ease; }
      #${panelId} .cpu-la-question { margin: 10px 0 0; word-break: break-word; font-size: 15px; font-weight: 650; }
      #${panelId} .cpu-la-answer { margin: 10px 0 0; padding: 10px 12px; border-left: 3px solid var(--cpu-la-primary); border-radius: 0 9px 9px 0; background: var(--cpu-la-answer); word-break: break-word; }
      #${panelId} .cpu-la-markdown { min-width: 0; line-height: 1.7; }
      #${panelId} .cpu-la-markdown > :first-child { margin-top: 0; }
      #${panelId} .cpu-la-markdown > :last-child { margin-bottom: 0; }
      #${panelId} .cpu-la-markdown p { margin: 7px 0; }
      #${panelId} .cpu-la-markdown ul, #${panelId} .cpu-la-markdown ol { margin: 7px 0; padding-left: 22px; }
      #${panelId} .cpu-la-markdown li + li { margin-top: 4px; }
      #${panelId} .cpu-la-markdown h1, #${panelId} .cpu-la-markdown h2, #${panelId} .cpu-la-markdown h3, #${panelId} .cpu-la-markdown h4 { margin: 10px 0 6px; line-height: 1.4; }
      #${panelId} .cpu-la-markdown blockquote { margin: 8px 0; padding: 7px 10px; border-left: 3px solid var(--cpu-la-primary); background: var(--cpu-la-subtle); color: var(--cpu-la-muted-strong); }
      #${panelId} .cpu-la-markdown code { padding: 1px 5px; border-radius: 5px; background: var(--cpu-la-subtle); font: .92em/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
      #${panelId} .cpu-la-markdown pre { max-width: 100%; margin: 8px 0; padding: 10px; overflow: auto; border-radius: 8px; background: var(--cpu-la-subtle); }
      #${panelId} .cpu-la-markdown pre code { padding: 0; background: transparent; }
      #${panelId} .cpu-la-markdown a { color: var(--cpu-la-primary-strong); }
      #${panelId} .cpu-la-math { display: inline-block; max-width: 100%; padding: 0 .12em; overflow-x: auto; vertical-align: -.06em; white-space: nowrap; font-family: Cambria Math, STIX Two Math, "Times New Roman", serif; }
      #${panelId} .cpu-la-math.is-display { display: block; margin: 9px auto; padding: 8px; text-align: center; background: var(--cpu-la-subtle); border-radius: 8px; }
      #${panelId} .cpu-la-frac { display: inline-grid; grid-template-rows: auto auto; margin: 0 .18em; vertical-align: middle; text-align: center; line-height: 1.15; }
      #${panelId} .cpu-la-frac > span:first-child { padding: 0 .15em .08em; border-bottom: 1px solid currentColor; }
      #${panelId} .cpu-la-frac > span:last-child { padding: .08em .15em 0; }
      #${panelId} .cpu-la-root { display: inline-flex; align-items: flex-start; }
      #${panelId} .cpu-la-root > span { border-top: 1px solid currentColor; }
      #${panelId} .cpu-la-options { display: grid; gap: 6px; margin-top: 10px; }
      #${panelId} .cpu-la-options > div { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; align-items: start; padding: 7px 9px; border: 1px solid var(--cpu-la-border-soft); border-radius: 9px; background: var(--cpu-la-subtle); }
      #${panelId} .cpu-la-options > div > b { display: grid; width: 24px; height: 24px; place-items: center; border-radius: 50%; background: var(--cpu-la-card); color: var(--cpu-la-primary-strong); }
      #${panelId} .cpu-la-inline-image { display: grid; width: 100%; max-width: 100%; gap: 5px; margin: 8px 0; padding: 7px; border: 1px solid var(--cpu-la-border); border-radius: 10px; background: var(--cpu-la-card); color: var(--cpu-la-muted); text-align: center; }
      #${panelId} .cpu-la-inline-image img { display: block; width: 100%; max-height: 220px; object-fit: contain; border-radius: 7px; background: var(--cpu-la-subtle); }
      #${panelId} .cpu-la-inline-image span { font-size: 11px; }
      #${panelId} .cpu-la-empty { display: grid; min-height: 138px; place-content: center; text-align: center; color: var(--cpu-la-muted); }
      #${panelId} .cpu-la-empty b { display: block; margin-bottom: 7px; color: var(--cpu-la-text); font-size: 17px; }
      #${panelId} .cpu-la-activity { display: grid; grid-template-columns: 42px 1fr; gap: 12px; align-items: center; }
      #${panelId} .cpu-la-activity-icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 13px; background: var(--cpu-la-primary-soft); color: var(--cpu-la-primary-strong); font-size: 17px; font-weight: 800; }
      #${panelId} .cpu-la-activity h3 { margin: 0; font-size: 17px; }
      #${panelId} .cpu-la-activity p { margin: 3px 0 0; color: var(--cpu-la-muted); }
      #${panelId} .cpu-la-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      #${panelId} .cpu-la-actions button { min-width: 88px; min-height: 35px; flex: 1; border: 1px solid var(--cpu-la-border); border-radius: 9px; background: var(--cpu-la-card); color: var(--cpu-la-primary-strong); }
      #${panelId} .cpu-la-actions button:disabled { cursor: not-allowed; opacity: .42; }
      #${panelId} .cpu-la-sources { margin-top: 11px; border-top: 1px solid var(--cpu-la-border-soft); }
      #${panelId} .cpu-la-sources-title { padding-top: 10px; color: var(--cpu-la-primary-strong); font-weight: 700; }
      #${panelId} .cpu-la-source { margin-top: 8px; padding: 9px 10px; border-radius: 9px; background: var(--cpu-la-subtle); word-break: break-word; }
      #${panelId} .cpu-la-source b { display: block; margin-bottom: 3px; color: var(--cpu-la-muted-strong); font-size: 12px; }
      #${panelId} .cpu-la-reasoning { margin-top: 8px; border-top: 1px solid var(--cpu-la-border); color: var(--cpu-la-muted-strong); }
      #${panelId} .cpu-la-reasoning strong { display: block; padding-top: 7px; color: var(--cpu-la-primary-strong); font-size: 12px; }
      #${panelId} .cpu-la-reasoning p { margin: 6px 0 0; }
      #${panelId} .cpu-la-screenshot { width: 100%; max-height: 190px; margin-top: 10px; object-fit: contain; border: 1px solid var(--cpu-la-border); border-radius: 10px; background: var(--cpu-la-subtle); }
      #${panelId} .cpu-la-error { margin: 10px 0 0; color: var(--cpu-la-danger); white-space: pre-wrap; }
      #${panelId} .cpu-la-log { display: grid; grid-template-columns: 72px 1fr; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--cpu-la-border-soft); }
      #${panelId} .cpu-la-log time { color: var(--cpu-la-muted); font-variant-numeric: tabular-nums; }
      #${panelId} .cpu-la-log[data-type="error"] span { color: var(--cpu-la-danger); }
      #${panelId} .cpu-la-settings { display: grid; gap: 10px; }
      #${panelId} .cpu-la-setting { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid var(--cpu-la-border-soft); border-radius: 12px; background: var(--cpu-la-card); cursor: pointer; }
      #${panelId} .cpu-la-setting input { margin-top: 4px; accent-color: var(--cpu-la-primary); }
      #${panelId} .cpu-la-setting strong, #${panelId} .cpu-la-setting small { display: block; }
      #${panelId} .cpu-la-setting small { margin-top: 2px; color: var(--cpu-la-muted); }
      #${panelId} .cpu-la-number-row { display: grid; grid-template-columns: 1fr 88px; gap: 12px; align-items: center; padding: 12px; border: 1px solid var(--cpu-la-border-soft); border-radius: 12px; background: var(--cpu-la-card); }
      #${panelId} .cpu-la-number-row input { width: 100%; padding: 7px 8px; border: 1px solid var(--cpu-la-border); border-radius: 8px; background: var(--cpu-la-surface); color: var(--cpu-la-text); }
      #${panelId} .cpu-la-depth { padding: 12px; border: 1px solid var(--cpu-la-border-soft); border-radius: 12px; background: var(--cpu-la-card); }
      #${panelId} .cpu-la-depth > strong, #${panelId} .cpu-la-depth > small { display: block; }
      #${panelId} .cpu-la-depth > small { margin: 2px 0 9px; color: var(--cpu-la-muted); }
      #${panelId} .cpu-la-depth-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      #${panelId} .cpu-la-depth-options label { display: grid; min-height: 58px; place-content: center; padding: 7px 5px; border: 1px solid var(--cpu-la-border); border-radius: 9px; text-align: center; cursor: pointer; }
      #${panelId} .cpu-la-depth-options label:has(input:checked) { border-color: var(--cpu-la-primary); background: var(--cpu-la-primary-soft); color: var(--cpu-la-primary-strong); }
      #${panelId} .cpu-la-depth-options label:has(input:disabled) { opacity: .56; cursor: not-allowed; }
      #${panelId} .cpu-la-depth-options input { position: absolute; opacity: 0; pointer-events: none; }
      #${panelId} .cpu-la-depth-options b, #${panelId} .cpu-la-depth-options em { display: block; font-style: normal; }
      #${panelId} .cpu-la-depth-options em { color: var(--cpu-la-muted); font-size: 11px; }
      #cpu-learning-screenshot-overlay { position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; background: rgba(8, 18, 16, .3); user-select: none; touch-action: none; }
      #cpu-learning-screenshot-overlay .cpu-la-capture-hint { position: fixed; left: 50%; top: 22px; transform: translateX(-50%); padding: 9px 14px; border-radius: 999px; background: rgba(14, 31, 27, .9); color: #fff; font: 650 13px system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.22); }
      #cpu-learning-screenshot-overlay .cpu-la-capture-box { position: fixed; display: none; border: 2px solid #83dbc3; background: rgba(131, 219, 195, .12); box-shadow: 0 0 0 9999px rgba(8, 18, 16, .38); }
      #cpu-learning-image-preview { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 32px; background: rgba(4, 12, 10, .82); backdrop-filter: blur(4px); }
      #cpu-learning-image-preview img { max-width: min(1180px, 94vw); max-height: 90vh; object-fit: contain; border-radius: 12px; background: #fff; box-shadow: 0 22px 70px rgba(0,0,0,.45); }
      #cpu-learning-image-preview button { position: fixed; right: 24px; top: 20px; width: 42px; height: 42px; border: 1px solid rgba(255,255,255,.35); border-radius: 50%; background: rgba(20,32,29,.78); color: #fff; font: 26px/1 system-ui, sans-serif; cursor: pointer; }
      #${launcherId} { --cpu-la-launcher-bg: #4d907e; --cpu-la-launcher-text: #fff; --cpu-la-launcher-shadow: 0 12px 32px rgba(47, 111, 96, .3); position: fixed; right: 22px; bottom: 28px; z-index: 2147482998; min-height: 44px; padding: 0 17px; border: 0; border-radius: 999px; background: var(--cpu-la-launcher-bg); color: var(--cpu-la-launcher-text); box-shadow: var(--cpu-la-launcher-shadow); font: 700 14px system-ui, sans-serif; cursor: pointer; }
      @media (prefers-color-scheme: dark) {
        #${panelId} {
          --cpu-la-primary: #79b8a7; --cpu-la-primary-strong: #9bd0c1; --cpu-la-primary-soft: #203c35;
          --cpu-la-surface: rgba(17, 27, 25, .98); --cpu-la-card: #182724; --cpu-la-subtle: #13211e; --cpu-la-answer: #16332c;
          --cpu-la-text: #edf7f4; --cpu-la-muted: #a4b7b1; --cpu-la-muted-strong: #c1d0cc;
          --cpu-la-border: #324a43; --cpu-la-border-soft: #2a3e39; --cpu-la-danger: #ff8d85;
          --cpu-la-warning-bg: #49361f; --cpu-la-warning-text: #ffc37d; --cpu-la-on-primary: #10231e;
          --cpu-la-tab-shadow: 0 1px 7px rgba(0, 0, 0, .28); --cpu-la-shadow: 0 24px 70px rgba(0, 0, 0, .48);
          color-scheme: dark;
        }
        #${launcherId} { --cpu-la-launcher-bg: #356f61; --cpu-la-launcher-text: #f3fffb; --cpu-la-launcher-shadow: 0 12px 34px rgba(0, 0, 0, .45); }
      }
      @media (max-width: 700px) {
        #${panelId} { top: 64px; right: 10px; left: 10px; width: auto; max-height: calc(100vh - 78px); border-radius: 16px; }
        #${panelId} .cpu-la-header { gap: 8px; padding: 12px; }
        #${panelId} .cpu-la-mark { width: 34px; height: 34px; border-radius: 11px; font-size: 16px; }
        #${panelId} .cpu-la-heading strong { font-size: 15px; }
        #${panelId} .cpu-la-heading span { display: none; }
        #${panelId} .cpu-la-run, #${panelId} .cpu-la-shot, #${panelId} .cpu-la-icon { width: 34px; height: 34px; min-width: 34px; min-height: 34px; padding: 0; }
        #${panelId} .cpu-la-body { padding: 13px; }
        #${panelId} .cpu-la-header { cursor: default; touch-action: auto; }
        #${launcherId} { right: 14px; bottom: 76px; }
      }
    `;
    doc.head.appendChild(style);
    const panel = doc.createElement("aside"), launcher = doc.createElement("button");
    panel.id = panelId;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", assistantName);
    panel.innerHTML = `
      <header class="cpu-la-header" title="拖动调整窗口位置">
        <div class="cpu-la-mark">拾</div>
        <div class="cpu-la-heading"><strong>${assistantName}</strong><span>任务、答案与运行控制</span></div>
        <button class="cpu-la-shot" type="button" data-action="screenshot-search" title="截图搜题" aria-label="截图搜题"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"></path><circle cx="12" cy="12" r="3.2"></circle></svg></button>
        <button class="cpu-la-run" type="button" data-action="toggle-runtime" title="暂停助手" aria-label="暂停助手"></button>
        <button class="cpu-la-icon" type="button" data-action="close" aria-label="收起">×</button>
      </header>
      <nav class="cpu-la-tabs" aria-label="助手页面">
        <button type="button" data-tab="task">当前任务</button>
        <button type="button" data-tab="logs">运行日志</button>
        <button type="button" data-tab="settings">设置</button>
      </nav>
      <main class="cpu-la-body"></main>
    `;
    launcher.id = launcherId;
    launcher.type = "button";
    launcher.textContent = "打开学习助手";
    launcher.hidden = true;
    doc.body.append(panel, launcher);
    const state = { store: initialStore, tab: "task", signature: "", manual: null, manualVersion: 0 };
    const positionKey = "cpu-learning-assistant-position-v1";
    let dragState = null;
    const clampPanelPosition = (left, topValue) => {
      const width = panel.offsetWidth || 400, height = panel.offsetHeight || 320;
      return {
        left: Math.max(8, Math.min(left, Math.max(8, host.innerWidth - width - 8))),
        top: Math.max(8, Math.min(topValue, Math.max(8, host.innerHeight - height - 8)))
      };
    };
    const setPanelPosition = (left, topValue, persist = false) => {
      if (host.innerWidth <= 700) {
        panel.style.removeProperty("left"), panel.style.removeProperty("right"), panel.style.removeProperty("top");
        return;
      }
      const next = clampPanelPosition(Number(left) || 0, Number(topValue) || 0);
      panel.style.left = `${next.left}px`, panel.style.top = `${next.top}px`, panel.style.right = "auto";
      if (persist) {
        try {
          host.sessionStorage.setItem(positionKey, JSON.stringify(next));
        } catch {}
      }
    };
    const restorePanelPosition = () => {
      if (host.innerWidth <= 700) return setPanelPosition(0, 0);
      try {
        const saved = JSON.parse(host.sessionStorage.getItem(positionKey) || "null");
        if (saved && Number.isFinite(Number(saved.left)) && Number.isFinite(Number(saved.top))) return setPanelPosition(saved.left, saved.top);
      } catch {}
      panel.style.removeProperty("left"), panel.style.removeProperty("right"), panel.style.removeProperty("top");
    };
    const onPointerMove = (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      setPanelPosition(dragState.left + event.clientX - dragState.clientX, dragState.top + event.clientY - dragState.clientY);
    };
    const onPointerUp = (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const rect = panel.getBoundingClientRect();
      dragState = null, setPanelPosition(rect.left, rect.top, true);
    };
    const onHeaderPointerDown = (event) => {
      if (host.innerWidth <= 700 || event.button !== 0 || event.target.closest("button, input, a")) return;
      const rect = panel.getBoundingClientRect();
      dragState = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, left: rect.left, top: rect.top };
      event.preventDefault();
    };
    const onWindowResize = () => restorePanelPosition();
    panel.querySelector(".cpu-la-header").addEventListener("pointerdown", onHeaderPointerDown);
    doc.addEventListener("pointermove", onPointerMove);
    doc.addEventListener("pointerup", onPointerUp);
    host.addEventListener("resize", onWindowResize);
    restorePanelPosition();
    const escapeHtml = (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    // 与拾间 AI 一致：先把 Markdown 转成受控 HTML，再交给界面。这里不能直接把模型
    // 返回值塞进 innerHTML；学习通题面还会带图片与上下标，必须逐项白名单化。
    const learningMathCommands = {
      times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥",
      ne: "≠", neq: "≠", approx: "≈", to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔",
      infty: "∞", degree: "°", circ: "°", Delta: "Δ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ",
      alpha: "α", beta: "β", gamma: "γ", pi: "π", rho: "ρ", sigma: "σ", omega: "ω"
    };
    const renderLearningMath = (value, display = false) => {
      let expression = String(value || "").trim();
      const fragments = [];
      const stash = (html) => `@@CPU_MATH_${fragments.push(html) - 1}@@`;
      expression = expression.replace(/\\(?:dfrac|tfrac|frac)\{([^{}]*)\}\{([^{}]*)\}/g, (_match, numerator, denominator) => stash(`<span class="cpu-la-frac"><span>${renderLearningMath(numerator)}</span><span>${renderLearningMath(denominator)}</span></span>`));
      expression = expression.replace(/\\sqrt\{([^{}]*)\}/g, (_match, content) => stash(`<span class="cpu-la-root">√<span>${renderLearningMath(content)}</span></span>`));
      expression = expression.replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1");
      expression = expression.replace(/\\(times|cdot|div|pm|mp|leq?|geq?|neq?|approx|to|rightarrow|leftarrow|leftrightarrow|infty|degree|circ|Delta|delta|theta|lambda|mu|alpha|beta|gamma|pi|rho|sigma|omega)\b/g, (_match, command) => learningMathCommands[command] || command);
      expression = expression.replace(/\\(?:left|right|displaystyle|textstyle)\b/g, "").replace(/\\[,;!:\s]/g, " ").replace(/\\([A-Za-z]+)/g, "$1");
      let html = escapeHtml(expression).replace(/\^\{?([A-Za-z0-9+\-=().]+)\}?/g, "<sup>$1</sup>").replace(/_\{?([A-Za-z0-9+\-=().]+)\}?/g, "<sub>$1</sub>").replace(/[{}]/g, "");
      fragments.forEach((fragment, index) => { html = html.replace(`@@CPU_MATH_${index}@@`, fragment); });
      return `<span class="cpu-la-math${display ? " is-display" : ""}">${html}</span>`;
    };
    const normalizeLearningRichSource = (value) => {
      let source = Array.isArray(value) ? value.join("\n") : String(value == null ? "" : value);
      const rich = [];
      const stash = (html) => `@@CPU_RICH_${rich.push(html) - 1}@@`;
      source = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
      source = source.replace(/<img\b[^>]*>/gi, (tag) => {
        try {
          const parsed = new DOMParser().parseFromString(`<body>${tag}</body>`, "text/html");
          const image = parsed.body.querySelector("img");
          const candidate = String(image == null ? "" : image.getAttribute("src") || "").trim();
          const url = new URL(candidate, doc.baseURI);
          if (url.protocol !== "https:" && url.protocol !== "http:" && !candidate.startsWith("data:image/")) return "[图片]";
          const src = candidate.startsWith("data:image/") ? candidate : url.href;
          const alt = String(image == null ? "" : image.getAttribute("alt") || "题目图片").slice(0, 120);
          return `\n${stash(`<button class="cpu-la-inline-image" type="button" data-action="preview-image" data-image-src="${escapeHtml(src)}" title="点击查看原图"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer"><span>点击查看原图</span></button>`)}\n`;
        } catch {
          return "[图片]";
        }
      });
      source = source.replace(/<br\s*\/?>/gi, "\n").replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, (_match, content) => mapLearningScriptText(content, learningSubscriptMap)).replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, (_match, content) => mapLearningScriptText(content, learningSuperscriptMap));
      source = source.replace(/<[^>]+>/g, "");
      const decoder = doc.createElement("textarea");
      decoder.innerHTML = source;
      source = decoder.value.replace(/\u00a0/g, " ").replace(/\\n(?=\s|[-*#\d]|$)/g, "\n");
      source = source.replace(/\\\[([\s\S]+?)\\\]/g, (_match, math) => `\n${stash(renderLearningMath(math, true))}\n`).replace(/\$\$([\s\S]+?)\$\$/g, (_match, math) => `\n${stash(renderLearningMath(math, true))}\n`).replace(/\\\(([\s\S]+?)\\\)/g, (_match, math) => stash(renderLearningMath(math))).replace(/\$(?!\$)([^$\n]+?)\$/g, (_match, math) => stash(renderLearningMath(math)));
      return { source, rich };
    };
    const renderLearningInline = (value, rich) => {
      const fragments = [...rich];
      const stash = (html) => `@@CPU_RICH_${fragments.push(html) - 1}@@`;
      let source = String(value || "");
      source = source.replace(/`([^`\n]+)`/g, (_match, code) => stash(`<code>${escapeHtml(code)}</code>`));
      source = source.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, href) => stash(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`));
      let html = escapeHtml(source).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_\n]+)__/g, "<strong>$1</strong>").replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
      fragments.forEach((fragment, index) => { html = html.replaceAll(`@@CPU_RICH_${index}@@`, fragment); });
      return html;
    };
    const renderLearningMarkdown = (value) => {
      const normalized = normalizeLearningRichSource(value);
      const lines = normalized.source.replace(/\r\n?/g, "\n").split("\n");
      const output = [];
      let index = 0;
      while (index < lines.length) {
        const line = lines[index], trimmed = line.trim();
        if (!trimmed) { index += 1; continue; }
        const fence = /^```\s*([\w-]*)\s*$/.exec(trimmed);
        if (fence) {
          const code = [];
          for (index += 1; index < lines.length && !/^```\s*$/.test(lines[index].trim()); index += 1) code.push(lines[index]);
          index += 1;
          output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
          continue;
        }
        const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
        if (heading) { output.push(`<h${heading[1].length}>${renderLearningInline(heading[2], normalized.rich)}</h${heading[1].length}>`); index += 1; continue; }
        if (/^[-*+]\s+/.test(trimmed)) {
          const items = [];
          while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) { items.push(lines[index].trim().replace(/^[-*+]\s+/, "")); index += 1; }
          output.push(`<ul>${items.map((item) => `<li>${renderLearningInline(item, normalized.rich)}</li>`).join("")}</ul>`);
          continue;
        }
        if (/^\d+[.)]\s+/.test(trimmed)) {
          const items = [];
          while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) { items.push(lines[index].trim().replace(/^\d+[.)]\s+/, "")); index += 1; }
          output.push(`<ol>${items.map((item) => `<li>${renderLearningInline(item, normalized.rich)}</li>`).join("")}</ol>`);
          continue;
        }
        if (/^>\s?/.test(trimmed)) { output.push(`<blockquote>${renderLearningInline(trimmed.replace(/^>\s?/, ""), normalized.rich)}</blockquote>`); index += 1; continue; }
        const paragraph = [trimmed];
        for (index += 1; index < lines.length && lines[index].trim() && !/^(?:```|#{1,4}\s|[-*+]\s|\d+[.)]\s|>\s?)/.test(lines[index].trim()); index += 1) paragraph.push(lines[index].trim());
        output.push(`<p>${paragraph.map((part) => renderLearningInline(part, normalized.rich)).join("<br>")}</p>`);
      }
      return output.join("") || '<p class="cpu-la-muted">暂无内容</p>';
    };
    const renderLearningOptions = (options) => Array.isArray(options) && options.length ? `<div class="cpu-la-options">${options.map((option, index) => `<div><b>${String.fromCharCode(65 + index)}</b><div class="cpu-la-markdown">${renderLearningMarkdown(option)}</div></div>`).join("")}</div>` : "";
    const showLearningImagePreview = (src) => {
      const existing = doc.getElementById("cpu-learning-image-preview");
      existing == null ? void 0 : existing.remove();
      const overlay = doc.createElement("div");
      overlay.id = "cpu-learning-image-preview";
      overlay.innerHTML = `<button type="button" aria-label="关闭图片预览">×</button><img src="${escapeHtml(src)}" alt="题目原图">`;
      overlay.addEventListener("click", (event) => { if (event.target === overlay || event.target.closest("button")) overlay.remove(); });
      doc.body.appendChild(overlay);
    };
    const saveConfig = (name, value) => {
      const previous = { ...defaultConfig$1, ...getConfig() };
      if (name === "answerIntervalMax" && Number(value) < Number(previous.answerIntervalMin)) value = Number(previous.answerIntervalMin);
      const config = { ...previous, [name]: value };
      if (name === "answerIntervalMin" && Number(config.answerIntervalMax) < Number(value)) config.answerIntervalMax = Number(value);
      _GM_setValue("config", config);
      Object.assign(formStore.forminput, config);
      state.signature = "";
      reportToHost("status", "学习通助手设置已保存");
    };
    let captureOverlay = null;
    const chooseScreenshotArea = () => new Promise((resolve) => {
      captureOverlay == null ? void 0 : captureOverlay.remove();
      const overlay = doc.createElement("div");
      overlay.id = "cpu-learning-screenshot-overlay";
      overlay.innerHTML = '<div class="cpu-la-capture-hint">拖动框选题目区域 · Esc 取消</div><div class="cpu-la-capture-box"></div>';
      doc.body.appendChild(overlay);
      captureOverlay = overlay;
      const box = overlay.querySelector(".cpu-la-capture-box");
      let start = null;
      const cleanup = (result) => {
        doc.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        captureOverlay = null;
        resolve(result);
      };
      const draw = (event) => {
        if (!start) return;
        const left = Math.min(start.x, event.clientX), topValue = Math.min(start.y, event.clientY);
        const width = Math.abs(event.clientX - start.x), height = Math.abs(event.clientY - start.y);
        box.style.display = "block", box.style.left = `${left}px`, box.style.top = `${topValue}px`, box.style.width = `${width}px`, box.style.height = `${height}px`;
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") cleanup(null);
      };
      overlay.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        start = { x: event.clientX, y: event.clientY };
        overlay.setPointerCapture(event.pointerId);
        draw(event);
      });
      overlay.addEventListener("pointermove", draw);
      overlay.addEventListener("pointerup", (event) => {
        if (!start) return;
        const rect = {
          x: Math.min(start.x, event.clientX),
          y: Math.min(start.y, event.clientY),
          width: Math.abs(event.clientX - start.x),
          height: Math.abs(event.clientY - start.y)
        };
        cleanup(rect.width >= 24 && rect.height >= 24 ? rect : null);
      });
      doc.addEventListener("keydown", onKeyDown, true);
    });
    const startScreenshotSearch = async () => {
      state.tab = "task";
      if (!_GM_cpuCaptureArea) {
        state.manual = { status: "error", error: "当前客户端版本不支持截图搜题，请先更新桌面客户端。" };
        state.manualVersion += 1, state.signature = "", render();
        return;
      }
      panel.hidden = true, launcher.hidden = true;
      const rect = await chooseScreenshotArea();
      if (!rect) {
        panel.hidden = false, state.signature = "", render();
        return;
      }
      try {
        await new Promise((resolve) => host.setTimeout(resolve, 60));
        const imageUrl = await _GM_cpuCaptureArea(rect);
        panel.hidden = false;
        state.manual = { status: "loading", imageUrl, answer: "", explanation: "", error: "" };
        state.manualVersion += 1, state.signature = "", render();
        const config = { ...defaultConfig$1, ...getConfig() };
        const response = await _GM_cpuAIRequest({
          model: config.aiModel || "deepseek-reasoner",
          reasoningEffort: ["low", "high", "max"].includes(config.answerDepth) ? config.answerDepth : "low",
          input: [{ role: "user", content: [
            { type: "input_text", text: "请识别截图中的题目并作答。若有选项，请结合选项判断；若截图信息不足，将 answer 留空并在 explanation 说明。只返回 JSON：{\"answer\":\"可直接提交的答案\",\"explanation\":\"简短解题依据\"}，不要输出 JSON 之外的文字。" },
            { type: "input_image", image_url: imageUrl, detail: "high" }
          ] }]
        });
        if (!response || response.status < 200 || response.status >= 300) {
          let message = `截图搜题失败（${response == null ? "无响应" : response.status}）`;
          try {
            const payload = JSON.parse(response && response.text || "{}");
            message = payload.message || (payload.error && (payload.error.message || payload.error)) || message;
          } catch {}
          throw new Error(message);
        }
        const data = JSON.parse(response.text || "{}");
        const content = String(data.output_text || (data.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("") || "").trim();
        const structured = data.learning_answer;
        const parsed = structured && typeof structured === "object" ? { answer: String(structured.answer || "").trim(), explanation: String(structured.explanation || "").trim() } : parseLearningAiReply(content);
        state.manual = { status: "done", imageUrl, answer: parsed.answer, explanation: parsed.explanation || (!parsed.answer ? content : ""), error: "" };
        reportToHost("status", "截图搜题已完成");
      } catch (error) {
        panel.hidden = false;
        state.manual = { status: "error", imageUrl: state.manual && state.manual.imageUrl || "", answer: "", explanation: "", error: error instanceof Error ? error.message : String(error) };
        reportToHost("status", state.manual.error);
      }
      state.manualVersion += 1, state.signature = "", render();
    };
    const refreshAnswerModes = async () => {
      if (typeof GM_cpuGetLearningPolicy !== "function") return;
      try {
        const policy = await GM_cpuGetLearningPolicy();
        const modes = Array.isArray(policy == null ? void 0 : policy.answerModes) ? policy.answerModes : [];
        if (modes.length !== 3) return;
        const current = getConfig();
        const activeMode = modes.find((item) => item && item.key === current.answerDepth);
        const fallbackMode = modes.find((item) => item && item.available !== false) || modes[0];
        const nextDepth = activeMode && activeMode.available !== false ? current.answerDepth : fallbackMode.key;
        if (JSON.stringify(current.answerModes || []) === JSON.stringify(modes) && current.answerDepth === nextDepth) return;
        _GM_setValue("config", { ...current, answerModes: modes, answerDepth: nextDepth });
        state.signature = "";
        render();
      } catch (error) {
        reportToHost("log", `档位配置刷新失败：${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const render = () => {
      const store = state.store, task = (store == null ? void 0 : store.task) || { name: "暂未加载", work: { questionList: [], inx: 0 }, log: [], status: "" }, questions = task.work && Array.isArray(task.work.questionList) ? task.work.questionList : [], index = Math.max(0, Math.min(Number(task.work && task.work.inx || 0), Math.max(0, questions.length - 1))), current = questions[index] || null, config = { ...defaultConfig$1, ...getConfig() }, logs = Array.isArray(task.log) ? task.log.slice(-30) : [], paused = assistantRuntime.isPaused();
      const answerModes = Array.isArray(config.answerModes) ? config.answerModes : [], modeMeta = (key, label, fallbackCost) => {
        const remote = answerModes.find((item) => item && item.key === key) || {};
        return { label: String(remote.label || label), cost: Number.isFinite(Number(remote.pointMultiplier)) ? Number(remote.pointMultiplier) : fallbackCost, available: remote.available !== false };
      }, lowMode = modeMeta("low", "快速判断", 1), highMode = modeMeta("high", "深入分析", 1.5), maxMode = modeMeta("max", "挑战难题", 2);
      const snapshot = { tab: state.tab, paused, name: task.name, status: task.status, activity: task.activity || null, count: questions.length, index, question: current == null ? "" : current.question, answer: current == null ? "" : current.answer, allAnswer: current == null ? [] : current.allAnswer, logs, autoSubmit: Boolean(config.autoSubmit), autoVideo: Boolean(config.autoVideo), autoJump: Boolean(config.autoJump), autoExam: Boolean(config.autoExam), answerIntervalMin: Number(config.answerIntervalMin), answerIntervalMax: Number(config.answerIntervalMax), answerDepth: config.answerDepth, answerModes, manualVersion: state.manualVersion };
      const signature = JSON.stringify(snapshot);
      if (signature === state.signature) return;
      state.signature = signature;
      panel.dataset.paused = String(paused);
      const runButton = panel.querySelector(".cpu-la-run");
      const runLabel = paused ? "继续助手" : "暂停助手";
      runButton.title = runLabel;
      runButton.setAttribute("aria-label", runLabel);
      runButton.innerHTML = paused
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"></path></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"></path></svg>';
      panel.querySelectorAll("[data-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === state.tab)));
      const body = panel.querySelector(".cpu-la-body");
      if (state.tab === "task") {
        if (state.manual) {
          const manual = state.manual;
          const modeLabel = config.answerDepth === "max" ? maxMode.label : config.answerDepth === "high" ? highMode.label : lowMode.label;
          body.innerHTML = `<section class="cpu-la-card"><span class="cpu-la-kicker">截图搜题 · ${escapeHtml(modeLabel)}</span><h3 class="cpu-la-title">${manual.status === "loading" ? "正在识别并解答" : manual.status === "done" ? "识别完成" : "截图搜题未完成"}</h3>${manual.imageUrl ? `<button class="cpu-la-inline-image" type="button" data-action="preview-image" data-image-src="${escapeHtml(manual.imageUrl)}" title="点击查看原图"><img class="cpu-la-screenshot" src="${escapeHtml(manual.imageUrl)}" alt="框选的题目截图"><span>点击查看原图</span></button>` : ""}${manual.status === "loading" ? '<div class="cpu-la-progress"><i style="width:72%"></i></div><p class="cpu-la-muted">正在读取题面、选项并核对答案…</p>' : ""}${manual.answer ? `<div class="cpu-la-answer cpu-la-markdown">${renderLearningMarkdown(manual.answer)}</div>` : ""}${manual.explanation ? `<div class="cpu-la-reasoning"><strong>解题思路</strong><div class="cpu-la-markdown">${renderLearningMarkdown(manual.explanation)}</div></div>` : ""}${manual.error ? `<p class="cpu-la-error">${escapeHtml(manual.error)}</p>` : ""}<div class="cpu-la-actions"><button type="button" data-action="screenshot-search">重新截图</button>${manual.answer ? '<button type="button" data-action="copy-screenshot-answer">复制答案</button>' : ""}<button type="button" data-action="dismiss-screenshot">返回任务</button></div></section>`;
        } else if (!current) {
          const activity = task.activity && (task.activity.label || task.activity.detail) ? task.activity : null;
          if (activity) {
            const activityProgress = Number.isFinite(Number(activity.progress)) ? Math.max(0, Math.min(100, Number(activity.progress))) : null;
            body.innerHTML = `<section class="cpu-la-card"><div class="cpu-la-activity"><span class="cpu-la-activity-icon">${paused ? "Ⅱ" : activity.active === false ? "✓" : "↻"}</span><div><h3>${escapeHtml(paused ? "助手已暂停" : activity.label || "正在处理任务")}</h3><p>${escapeHtml(paused ? "点击上方“开始助手”继续处理" : activity.detail || "任务正在运行")}</p></div></div>${activityProgress == null ? "" : `<div class="cpu-la-progress"><i style="width:${activityProgress}%"></i></div>`}</section>`;
          } else {
            body.innerHTML = `<div class="cpu-la-empty"><div><b>${paused ? "助手已暂停" : "等待任务加载"}</b><span>${paused ? "点击上方“开始助手”继续处理" : "进入章节、作业或考试后会自动识别"}</span></div></div>`;
          }
        } else {
          const progress = Math.round((index + 1) / Math.max(1, questions.length) * 100), answer = String(current.answer || ""), sources = Array.isArray(current.allAnswer) ? current.allAnswer : [], sourceDetails = sources.length ? `<section class="cpu-la-sources"><div class="cpu-la-sources-title">${sources.length} 个答案来源</div>${sources.map((item) => `<div class="cpu-la-source"><b>${escapeHtml(item.form || "答案来源")}</b><div class="cpu-la-markdown">${renderLearningMarkdown(item.displayAnswer || item.answer || "暂无答案")}</div>${item.explanation ? `<div class="cpu-la-reasoning"><strong>解题思路</strong><div class="cpu-la-markdown">${renderLearningMarkdown(item.explanation)}</div></div>` : ""}</div>`).join("")}</section>` : '<p class="cpu-la-muted">尚未收到答案</p>';
          body.innerHTML = `<section class="cpu-la-card"><span class="cpu-la-kicker">${escapeHtml(task.name || "当前任务")} · ${index + 1}/${questions.length}</span><h3 class="cpu-la-title">${escapeHtml(task.status || (paused ? "已暂停" : "处理中"))}</h3><div class="cpu-la-progress"><i style="width:${progress}%"></i></div></section><section class="cpu-la-card"><span class="cpu-la-kicker">题目</span><div class="cpu-la-question cpu-la-markdown">${renderLearningMarkdown(current.question || "")}</div>${renderLearningOptions(current.options)}${answer ? `<div class="cpu-la-answer cpu-la-markdown">${renderLearningMarkdown(answer)}</div>` : '<p class="cpu-la-muted">正在获取并填写答案…</p>'}${sourceDetails}<div class="cpu-la-actions"><button type="button" data-action="previous" ${index <= 0 ? "disabled" : ""}>上一题</button><button type="button" data-action="locate">定位原题</button>${answer ? '<button type="button" data-action="copy-answer">复制答案</button>' : ""}<button type="button" data-action="next" ${index >= questions.length - 1 ? "disabled" : ""}>下一题</button></div></section>`;
        }
      } else if (state.tab === "logs") {
        body.innerHTML = logs.length ? `<section class="cpu-la-card">${logs.map((item) => `<div class="cpu-la-log" data-type="${escapeHtml(item.type || "info")}"><time>${escapeHtml(item.time || "")}</time><span>${escapeHtml(item.msg || "")}</span></div>`).join("")}<div class="cpu-la-actions"><button type="button" data-action="clear-logs">清空日志</button></div></section>` : '<div class="cpu-la-empty"><div><b>暂无运行日志</b><span>开始处理任务后，关键步骤会记录在这里</span></div></div>';
      } else {
        body.innerHTML = `<div class="cpu-la-settings"><section class="cpu-la-depth"><strong>答题模式</strong><small>越深入越适合复杂题，模型、点数倍率与限免状态由站点后台实时配置</small><div class="cpu-la-depth-options"><label><input type="radio" name="cpu-la-depth" data-config-depth value="low" ${config.answerDepth !== "high" && config.answerDepth !== "max" ? "checked" : ""} ${lowMode.available ? "" : "disabled"}><b>${escapeHtml(lowMode.label)}</b><em>${lowMode.available ? `${lowMode.cost} 点` : "限免未开放"}</em></label><label><input type="radio" name="cpu-la-depth" data-config-depth value="high" ${config.answerDepth === "high" ? "checked" : ""} ${highMode.available ? "" : "disabled"}><b>${escapeHtml(highMode.label)}</b><em>${highMode.available ? `${highMode.cost} 点` : "限免未开放"}</em></label><label><input type="radio" name="cpu-la-depth" data-config-depth value="max" ${config.answerDepth === "max" ? "checked" : ""} ${maxMode.available ? "" : "disabled"}><b>${escapeHtml(maxMode.label)}</b><em>${maxMode.available ? `${maxMode.cost} 点` : "限免未开放"}</em></label></div></section><label class="cpu-la-setting"><input type="checkbox" data-config="autoSubmit" ${config.autoSubmit ? "checked" : ""}><span><strong>章节测验答完自动提交</strong><small>只作用于章节测验；作业和考试始终由你手动交卷</small></span></label><label class="cpu-la-setting"><input type="checkbox" data-config="autoVideo" ${config.autoVideo ? "checked" : ""}><span><strong>自动播放视频与音频</strong><small>关闭后会跳过媒体任务点</small></span></label><label class="cpu-la-setting"><input type="checkbox" data-config="autoJump" ${config.autoJump ? "checked" : ""}><span><strong>完成后切换下一章</strong><small>暂停助手时不会发生章节切换</small></span></label><label class="cpu-la-setting"><input type="checkbox" data-config="autoExam" ${config.autoExam ? "checked" : ""}><span><strong>考试自动切换下一题</strong><small>只切题，不会替你最终交卷</small></span></label><div class="cpu-la-number-row"><span><strong>答题最短等待</strong><small class="cpu-la-muted">每题之间的秒数</small></span><input type="number" min="1" max="120" data-config-number="answerIntervalMin" value="${Number(config.answerIntervalMin) || 8}"></div><div class="cpu-la-number-row"><span><strong>答题最长等待</strong><small class="cpu-la-muted">不能小于最短等待</small></span><input type="number" min="1" max="180" data-config-number="answerIntervalMax" value="${Number(config.answerIntervalMax) || 20}"></div></div>`;
      }
    };
    panel.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.dataset.tab) {
        state.tab = target.dataset.tab;
        state.signature = "";
        render();
        if (state.tab === "settings") void refreshAnswerModes();
        return;
      }
      const store = state.store, questions = (store == null ? void 0 : store.task.work.questionList) || [], index = Number(store == null ? void 0 : store.task.work.inx) || 0;
      switch (target.dataset.action) {
        case "preview-image":
          if (target.dataset.imageSrc) showLearningImagePreview(target.dataset.imageSrc);
          return;
        case "screenshot-search":
          void startScreenshotSearch();
          return;
        case "dismiss-screenshot":
          state.manual = null, state.manualVersion += 1;
          break;
        case "copy-screenshot-answer": {
          const answer = String(state.manual && state.manual.answer || "");
          if (answer && host.navigator.clipboard && host.navigator.clipboard.writeText) {
            host.navigator.clipboard.writeText(answer).then(() => reportToHost("status", "答案已复制")).catch(() => reportToHost("status", "复制失败，请手动选择答案"));
          }
          break;
        }
        case "toggle-runtime":
          assistantRuntime.toggle();
          break;
        case "close":
          panel.hidden = true, launcher.hidden = false;
          break;
        case "previous":
          index > 0 && store.select(index - 1);
          break;
        case "next":
          index < questions.length - 1 && store.select(index + 1);
          break;
        case "locate":
          questions[index] && store.select(index);
          break;
        case "copy-answer": {
          const answer = formatLearningDisplayText(questions[index] == null ? "" : questions[index].answer || "");
          if (answer && host.navigator.clipboard && host.navigator.clipboard.writeText) {
            host.navigator.clipboard.writeText(answer).then(() => reportToHost("status", "答案已复制")).catch(() => reportToHost("status", "复制失败，请手动选择答案"));
          } else if (answer) {
            const textarea = doc.createElement("textarea");
            textarea.value = answer, textarea.style.position = "fixed", textarea.style.opacity = "0", doc.body.appendChild(textarea), textarea.select();
            try {
              doc.execCommand("copy"), reportToHost("status", "答案已复制");
            } catch {
              reportToHost("status", "复制失败，请手动选择答案");
            }
            textarea.remove();
          }
          break;
        }
        case "clear-logs":
          store && (store.task.log = []);
          break;
      }
      state.signature = "";
      render();
    });
    panel.addEventListener("change", (event) => {
      const target = event.target;
      if (target.matches("input[type=checkbox][data-config]")) saveConfig(target.dataset.config, target.checked);
      if (target.matches("input[type=radio][data-config-depth]")) saveConfig("answerDepth", target.value);
      if (target.matches("input[type=number][data-config-number]")) {
        const value = Math.max(Number(target.min) || 1, Math.min(Number(target.max) || 180, Number(target.value) || Number(target.min) || 1));
        saveConfig(target.dataset.configNumber, value);
      }
      render();
    });
    launcher.addEventListener("click", () => {
      launcher.hidden = true, panel.hidden = false, state.signature = "", render();
    });
    assistantRuntime.subscribe(() => {
      state.signature = "";
      render();
    });
    void refreshAnswerModes();
    const renderTimer = host.setInterval(render, 400);
    const policyTimer = host.setInterval(() => { void refreshAnswerModes(); }, 15e3);
    const api = { setStore(store) {
      state.store = store;
      state.signature = "";
      panel.hidden = false;
      launcher.hidden = true;
      render();
    }, render, destroy() {
      host.clearInterval(renderTimer);
      host.clearInterval(policyTimer);
      panel.querySelector(".cpu-la-header").removeEventListener("pointerdown", onHeaderPointerDown);
      doc.removeEventListener("pointermove", onPointerMove);
      doc.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("resize", onWindowResize);
      captureOverlay == null ? void 0 : captureOverlay.remove();
      panel.remove();
      launcher.remove();
      style.remove();
      delete host[workspaceKey];
    } };
    host[workspaceKey] = api;
    render();
    return api;
  };
  const ensureGuideStyle = () => {
    const id = "cpu-learning-guide-style";
    if (_self.document.getElementById(id)) return;
    const style = _self.document.createElement("style");
    style.id = id;
    style.textContent = `
      .el-notification.cpu-learning-guide {
        z-index: 2147483000 !important;
        width: min(420px, calc(100vw - 32px)) !important;
        max-width: calc(100vw - 32px) !important;
      }
      .el-notification.cpu-learning-guide .el-notification__content {
        text-align: left !important;
        line-height: 1.65 !important;
      }
    `;
    _self.document.head.appendChild(style);
  };
  const notifyGuide = (key, message, type = "info") => {
    if (_self !== top) return;
    try {
      if (_self.sessionStorage.getItem(key)) return;
      _self.sessionStorage.setItem(key, "1");
    } catch {
      // 禁用会话存储时仍显示引导，不影响助手运行。
    }
    ensureGuideStyle();
    ElementPlus.ElNotification({
      title: assistantName,
      message,
      type,
      duration: 12e3,
      position: "top-right",
      offset: 96,
      customClass: "cpu-learning-guide"
    });
  };
  var iframeCom = null;
  switch ((() => {
    document.body.oncopy = null, document.body.oncut = null, document.body.onpaste = null, document.body.onselectstart = null, document.body.ondragstart = null;
    const style = document.createElement("style");
    style.innerHTML = "\n       * {\n           -webkit-user-select: auto !important;\n           -moz-user-select: auto !important;\n           -o-user-select: auto !important;\n           user-select: auto !important;\n       }\n   ", document.head.appendChild(style);
  })(), _self.location.pathname) {
    case "/work/doHomeWorkNew":
    case "/mooc-ans/work/doHomeWorkNew":
    case "/mooc2-ans/work/doHomeWorkNew":
      location.href.includes("mooc2=1") && (location.href = location.href.replace(/&mooc2=1/g, ""));
      break;
    case "/mycourse/studentstudy":
    case "/mooc-ans/mycourse/studentstudy":
    case "/mooc2-ans/mycourse/studentstudy":
      if (!_self.location.href.match(/mooc2=1/)) {
        ElementPlus.ElNotification({ title: assistantName, message: "正在切换到助手支持的新版章节页面", type: "info" }), _self.location.href = _self.location.href + "&mooc2=1";
        break;
      }
      const cxModel = new Cx();
      cxModel.askStore.log("脚本初始化成功！", "success");
      let navigationGeneration = 0;
      const runningGenerations = /* @__PURE__ */ new Set();
      const startWork = async (generation) => {
        if (runningGenerations.has(generation)) return;
        runningGenerations.add(generation);
        const taskCurrent = () => generation === navigationGeneration;
        const ensureCurrent = () => {
          if (!taskCurrent()) {
            const error = new Error("章节已切换，旧任务已取消");
            error.name = "AssistantTaskCancelledError";
            throw error;
          }
        };
        var _a, _b, _c, _d, _e;
        try {
          await assistantRuntime.waitUntilRunning(() => cxModel.askStore.msg("助手已暂停，点击“开始助手”后继续"));
          ensureCurrent();
          cxModel.askStore.setActivity("任务扫描", "正在读取本章节的任务点");
          if (!await waitElementLoaded(_self, "#iframe")) return;
          ensureCurrent();
          const cardsIframe = _self.document.querySelector("#iframe");
          if (!await waitIframeLoaded(cardsIframe)) return;
          ensureCurrent();
          const _self1 = cardsIframe.contentWindow;
          top.scroll2Job();
          let jobList = _self1.document.querySelectorAll(".ans-job-icon") || [];
          for (let i = 0; i < jobList.length; i++) {
          ensureCurrent();
          await assistantRuntime.waitUntilRunning(() => cxModel.askStore.msg("助手已暂停，点击“开始助手”后继续"));
          ensureCurrent();
          const item = jobList[i];
          if ((_a = item.parentElement) == null ? void 0 : _a.classList.contains("ans-job-finished")) {
            const iframe = (_b = item.parentElement) == null ? void 0 : _b.querySelector("iframe");
            if (!iframe || !await waitIframeLoaded(iframe)) continue;
            if (iframe == null ? void 0 : iframe.src.match(/\/ananas\/modules\/work\/index.html/)) {
              JSON.parse(iframe.getAttribute("data") || "{}");
              const workIframe = (_c = iframe.contentWindow) == null ? void 0 : _c.document.querySelector("iframe");
              workIframe && (await waitIframeLoaded(workIframe), cxModel.s(workIframe.contentWindow));
            }
            console.log(iframe.src, "已完成"), cxModel.askStore.log("已完成的任务点,跳过");
          } else {
            const iframe = (_d = item.parentElement) == null ? void 0 : _d.querySelector("iframe");
            if (!iframe || !await waitIframeLoaded(iframe)) continue;
            const otherInfo = JSON.parse(iframe.getAttribute("data") || "{}");
            if (cxModel.askStore.setActivity(otherInfo.name || otherInfo.title || "课程任务", "正在识别并处理任务点"), cxModel.askStore.log(`正在完成任务:${otherInfo.name || otherInfo.title}`), iframe == null ? void 0 : iframe.src.match(/\/ananas\/modules\/video\/index\.html/)) {
              if (!formStore.forminput.autoVideo) {
                cxModel.askStore.log("视频任务已跳过", "success");
                continue;
              }
              await cxModel.video(iframe.contentWindow, taskCurrent), ensureCurrent(), cxModel.askStore.log("视频任务已完成", "success");
            } else if (iframe == null ? void 0 : iframe.src.match(/\/ananas\/modules\/work\/index.html/)) {
              cxModel.askStore.log("即将开始做作业", "info");
              const workIframe = (_e = iframe.contentWindow) == null ? void 0 : _e.document.querySelector("iframe");
              workIframe && (await waitIframeLoaded(workIframe), ensureCurrent(), await cxModel.work(workIframe.contentWindow, taskCurrent), ensureCurrent(), cxModel.askStore.log("作业任务已完成", "success"));
            } else if (iframe == null ? void 0 : iframe.src.match(/\/ananas\/modules\/audio\/index.html/)) {
              if (log("音频", "error"), !formStore.forminput.autoVideo) {
                cxModel.askStore.log("音频任务已跳过", "success");
                continue;
              }
              iframe && (await waitIframeLoaded(iframe), ensureCurrent(), await cxModel.audio(iframe.contentWindow, taskCurrent), ensureCurrent(), cxModel.askStore.log("音频任务已完成", "success"));
            } else
              (iframe == null ? void 0 : iframe.src.match(/\/ananas\/modules\/pdf\/index.html/)) ? (cxModel.askStore.setActivity("文档任务", "正在阅读文档任务点"), log("文档", "error"), iframe && (await waitIframeLoaded(iframe), await cxModel.pdf(iframe.contentWindow), cxModel.askStore.setActivity("文档任务", "文档任务已完成", 100, false), cxModel.askStore.log("pdf任务已完成", "success"))) : (cxModel.askStore.setActivity("未知任务", "当前任务类型暂不支持，已跳过", null, false), console.log(iframe == null ? void 0 : iframe.src, "未知"), cxModel.askStore.log("未知任务跳过", "success"));
          }
          }
          await sleep(formStore.forminput.interval), ensureCurrent(), await assistantRuntime.waitUntilRunning(() => cxModel.askStore.msg("助手已暂停，不会切换章节")), ensureCurrent();
          const currentConfig = getConfig();
          !currentConfig.autoJump && (cxModel.askStore.setActivity("本节任务完成", "等待你手动切换章节", 100, false), cxModel.askStore.msg("由于未开启自动切换,请手动切换")), currentConfig.autoJump && (cxModel.askStore.setActivity("本节任务完成", "正在切换下一章节", 100, false), top == null ? void 0 : top.document.querySelector(".nextChapter").click());
        } catch (error) {
          if ((error == null ? void 0 : error.name) === "AssistantTaskCancelledError" || !taskCurrent()) return;
          cxModel.askStore.setActivity("任务处理失败", "请在运行日志中查看详情", null, false), console.error("任务处理失败", error);
        } finally {
          runningGenerations.delete(generation);
        }
      };
      setInterval(async () => {
        if (!await waitElementLoaded(_self, "#iframe")) return;
        const cardsIframe = _self.document.querySelector("#iframe");
        if (!await waitIframeLoaded(cardsIframe)) return;
        const _self1 = cardsIframe.contentWindow;
        if (iframeCom != _self1.location.href) {
          iframeCom = _self1.location.href;
          const generation = ++navigationGeneration;
          cxModel.askStore.reset();
          cxModel.askStore.setActivity("章节已切换", "正在读取新章节并重新扫描任务", 0);
          void startWork(generation);
        }
      }, 2e3);
      break;
    case "/mooc2-ans/mycourse/stu":
    case "/mooc-ans/mycourse/stu":
    case "/mycourse/stu":
      notifyGuide(
        "cpu-learning-course-guide-v3",
        "课程已经打开。你可以从课程目录进入具体章节、作业或考试；打开对应内容页后，助手会自动识别并开始工作。"
      );
      break;
    case "/work/selectWorkQuestionYiPiYue":
    case "/knowledge/cards":
      break;
    case "/mooc2/work/dowork":
    case "/mooc-ans/mooc2/work/dowork":
    case "/mooc2-ans/mooc2/work/dowork":
      const cxModel1 = new Cx();
      cxModel1.askStore.log("脚本初始化成功！", "success"), await( cxModel1.homework());
      break;
    case "/exam-ans/exam/test/reVersionTestStartNew":
      const cxModel2 = new Cx();
      await( cxModel2.exam()), cxModel2.askStore.log("脚本初始化成功！", "success");
      break;
    default:
      if (_self.location.hostname === "i.chaoxing.com") {
        notifyGuide(
          "cpu-learning-personal-center-guide-v3",
          "请先从“课程”或“我学的课”进入一门具体课程。进入课程后，可打开要学习的章节、作业或考试页面；助手会在对应内容页自动开始。"
        );
      }
  }

})(Vue, Pinia, ElementPlus, md5, $);

// ==================== 微信扫码验证弹窗检测功能 ====================
(function() {
    'use strict';

    // 配置
    const CONFIG = {
        // 检测的关键词
        keywords: ['微信扫码验证', '请使用微信"扫一扫"扫码', '跳转小程序进行学习验证'],
        // 检测间隔（毫秒）
        checkInterval: 1000,
        // 延迟执行时间范围（秒）
        minDelay: 5,
        maxDelay: 10
    };

    let isProcessing = false;
    let checkTimer = null;
    let refreshTimer = null;

    // 生成随机延迟时间（5-10秒）
    function getRandomDelay() {
        return Math.floor(Math.random() * (CONFIG.maxDelay - CONFIG.minDelay + 1) + CONFIG.minDelay) * 1000;
    }

    // 检查元素是否包含关键词
    function containsKeywords(element) {
        if (!element) return false;
        const text = element.textContent || element.innerText || '';
        return CONFIG.keywords.some(keyword => text.includes(keyword));
    }

    // 检查页面中是否存在微信扫码验证弹窗
    function checkWechatVerifyPopup() {
        if (isProcessing) return false;

        // 常见的弹窗选择器
        const popupSelectors = [
            '.el-dialog',
            '.el-message-box',
            '.van-dialog',
            '.weui-dialog',
            '.layui-layer',
            '.modal',
            '.dialog',
            '.popup',
            '[class*="dialog"]',
            '[class*="popup"]',
            '[class*="modal"]',
            // 学习通特定的弹窗类名
            '.verify-dialog',
            '.qrcode-dialog',
            '.scan-dialog'
        ];

        // 检查所有可能的弹窗元素
        for (const selector of popupSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                if (containsKeywords(element)) {
                    return true;
                }
            }
        }

        // 检查整个页面文本（作为备用方案）
        const bodyText = document.body.innerText || '';
        if (CONFIG.keywords.every(keyword => bodyText.includes(keyword))) {
            return true;
        }

        return false;
    }

    // 执行刷新操作
    function executeRefresh() {
        if (isProcessing || refreshTimer) return;
        isProcessing = true;

        console.log('[微信扫码检测] 检测到微信扫码验证弹窗，准备刷新页面...');

        // 获取当前网址
        const currentUrl = window.location.href;

        // 复制网址到剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(currentUrl).then(() => {
                console.log('[微信扫码检测] 网址已复制到剪贴板:', currentUrl);
            }).catch(err => {
                console.error('[微信扫码检测] 复制网址失败:', err);
                // 备用方案：使用传统方法
                const textarea = document.createElement('textarea');
                textarea.value = currentUrl;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                console.log('[微信扫码检测] 网址已复制到剪贴板(备用方法)');
            });
        }

        // 在新标签页打开当前页面
        window.open(currentUrl, '_blank');
        location.replace(currentUrl);
    }

    // 主检测函数
    function startDetection() {
        console.log('[微信扫码检测] 检测功能已启动，将在检测到微信扫码验证弹窗后自动处理');

        checkTimer = setInterval(() => {
            if (checkWechatVerifyPopup()) {
                console.log('[微信扫码检测] 检测到微信扫码验证弹窗！');
                clearInterval(checkTimer);

                // 生成随机延迟（5-10秒）
                const delay = getRandomDelay();
                console.log(`[微信扫码检测] 将在 ${delay / 1000} 秒后执行刷新操作`);

        refreshTimer = setTimeout(() => {
                    executeRefresh();
                }, delay);
            }
        }, CONFIG.checkInterval);
    }

    // 页面加载完成后启动检测
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startDetection);
    } else {
        startDetection();
    }

    // 监听页面变化（用于检测动态加载的弹窗）
    const observer = new MutationObserver((mutations) => {
        if (!isProcessing && checkWechatVerifyPopup()) {
            console.log('[微信扫码检测] 通过MutationObserver检测到微信扫码验证弹窗！');
            clearInterval(checkTimer);

            const delay = getRandomDelay();
            console.log(`[微信扫码检测] 将在 ${delay / 1000} 秒后执行刷新操作`);

            if (refreshTimer) return;
            refreshTimer = setTimeout(() => {
                executeRefresh();
            }, delay);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
    });

})();
// ==================== 微信扫码验证弹窗检测功能结束 ====================
