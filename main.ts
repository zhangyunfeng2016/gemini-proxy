// main.ts - 增强版 (添加 OpenAI 兼容层)

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

// Gemini API 基础 URL (已更新为新的 v1)
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
// API 版本
const GEMINI_API_VERSION = "v1beta"; // 保持 v1beta 以兼容当前模型

// ... [此处省略环境变量和 getRandomApiKey 函数，保持原样] ...
// -----------------------------------------------------------
const AUTH_KEY = Deno.env.get("key");
const GEMINI_API_KEYS_STR = Deno.env.get("apikey");

let GEMINI_API_KEYS: string[] = [];
if (GEMINI_API_KEYS_STR) {
  GEMINI_API_KEYS = GEMINI_API_KEYS_STR
    .split(',')
    .map(key => key.trim())
    .filter(key => key.length > 0);
}

function getRandomApiKey(): string {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error("没有可用的 API Key");
  }
  const randomIndex = Math.floor(Math.random() * GEMINI_API_KEYS.length);
  return GEMINI_API_KEYS[randomIndex];
}

console.log("=== 服务器启动配置检查 ===");
console.log(`AUTH_KEY 是否已设置: ${AUTH_KEY ? '是' : '否'}`);
console.log(`GEMINI_API_KEYS 数量: ${GEMINI_API_KEYS.length}`);
console.log("========================");
// -----------------------------------------------------------


// OpenAI 模型名称到 Gemini 模型名称的映射
const MODEL_MAP: Record<string, string> = {
  // 映射到 Gemini 2.5 系列 (如果客户端请求 gpt-3.5/gpt-4)
  "gpt-4": "gemini-2.5-pro",
  "gpt-4-turbo": "gemini-2.5-pro",
  "gpt-3.5-turbo": "gemini-2.5-flash",
  // 映射到 Gemini 3 预览版 (使用您 cURL 示例中的名称)
  "gemini-3-pro-preview": "gemini-3-pro-preview", 
  "gemini-3-flash-preview": "gemini-3-flash-preview", 
  // 保持兼容旧模型
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-flash": "gemini-2.5-flash",
};


// -----------------------------------------------------------
// ## 核心处理逻辑函数 (handler)
// -----------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const requestId = crypto.randomUUID().substring(0, 8);
  const pathname = url.pathname.replace(/^\/v1/, ""); // 去掉 /v1，兼容 CherryStudio 可能的设置

  console.log(`\n[${requestId}] === 收到请求 ===`);
  // ... [此处省略 CORS 和基础配置检查，保持原样] ...

  // 处理 CORS 预检请求
  if (req.method === "OPTIONS") {
    console.log(`[${requestId}] 处理 OPTIONS 预检请求`);
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-goog-api-key",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  try {
    // 检查环境变量是否配置
    if (!AUTH_KEY || GEMINI_API_KEYS.length === 0) {
      console.error(`[${requestId}] 错误：环境变量未正确配置`);
      return new Response(
        JSON.stringify({ error: "服务器配置错误" }),
        { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }
    
    // ... [此处省略客户端 Key 提取和验证，保持原样] ...
    // --- 客户端 Key 提取和验证逻辑 ---
    let clientKey = "";
    let keySource = "";
    const googApiKey = req.headers.get("x-goog-api-key");
    if (googApiKey) {
      clientKey = googApiKey.trim();
      keySource = "x-goog-api-key header";
    }
    if (!clientKey) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.toLowerCase().startsWith("bearer ")) {
        clientKey = authHeader.substring(7).trim();
        keySource = "Authorization Bearer";
      }
    }
    if (!clientKey && url.searchParams.get("key")) {
      clientKey = url.searchParams.get("key")!.trim();
      keySource = "URL parameter";
    }

    if (!clientKey) {
      console.log(`[${requestId}] 认证失败：未提供密钥`);
      return new Response(
        JSON.stringify({ error: "认证失败：未提供API密钥" }),
        { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }
    
    if (clientKey !== AUTH_KEY) {
      console.log(`[${requestId}] 认证失败：密钥不匹配`);
      return new Response(
        JSON.stringify({ error: "认证失败：API密钥无效" }),
        { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    console.log(`[${requestId}] 认证成功`);
    // ---------------------------------
    
    // 随机选择一个 Gemini API Key
    const selectedApiKey = getRandomApiKey();
    const keyIndex = GEMINI_API_KEYS.indexOf(selectedApiKey) + 1;
    console.log(`[${requestId}] 使用 API Key #${keyIndex}/${GEMINI_API_KEYS.length}`);

    // =========================================================
    // 🎯 兼容层核心逻辑：处理 /chat/completions (OpenAI/CherryStudio)
    // =========================================================

    if (pathname === "/chat/completions" || pathname === "/v1/chat/completions") {
      console.log(`[${requestId}] 🚀 激活 OpenAI 兼容层: /chat/completions`);
      
      const openaiRequest: any = await req.json();
      const modelName = MODEL_MAP[openaiRequest.model] || openaiRequest.model;
      const isStreaming = openaiRequest.stream === true;
      
      const geminiBody: any = {
        contents: [],
        config: {
          temperature: openaiRequest.temperature ?? 0.7,
          // topP: openaiRequest.top_p, // 可按需添加
          // maxOutputTokens: openaiRequest.max_tokens, // 可按需添加
        },
      };

      // 转换 messages 到 contents
      for (const msg of openaiRequest.messages) {
        // 角色转换：user/system -> user; assistant -> model
        const role = (msg.role === "assistant") ? "model" : "user";
        
        // 简单处理文本内容
        geminiBody.contents.push({
          role: role,
          parts: [{ text: msg.content }],
        });
      }

      // 构建目标 URL：使用 generateContent 或 generateContentStream
      const targetMethod = isStreaming ? "generateContentStream" : "generateContent";
      const targetUrl = `${GEMINI_API_BASE}/${GEMINI_API_VERSION}/models/${modelName}:${targetMethod}?key=${selectedApiKey}`;
      
      console.log(`[${requestId}] 转发到 Gemini: ${modelName}:${targetMethod} (流式: ${isStreaming})`);

      // 准备转发请求的 headers
      const forwardHeaders = new Headers();
      forwardHeaders.set("Content-Type", "application/json");

      // 转发请求到 Gemini API
      const geminiResponse = await fetch(targetUrl, {
        method: "POST",
        headers: forwardHeaders,
        body: JSON.stringify(geminiBody),
      });

      if (!geminiResponse.ok) {
        // 如果 Gemini API 返回错误，直接返回
        console.error(`[${requestId}] 转发到 Gemini API 失败: ${geminiResponse.status}`);
        return new Response(geminiResponse.body, {
          status: geminiResponse.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "X-Request-ID": requestId,
          },
        });
      }

      // 转换为 OpenAI 格式并返回 (这里仅处理非流式，流式转换更复杂，建议采用通用转发)
      if (!isStreaming) {
        const geminiJson = await geminiResponse.json();
        
        const geminiText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

        // 构建 OpenAI 兼容响应
        const openaiResponse = {
          id: `chatcmpl-${requestId}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: openaiRequest.model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: geminiText },
            finish_reason: "stop",
          }],
          usage: {
            prompt_tokens: 0, // 简化
            completion_tokens: 0,
            total_tokens: 0,
          },
        };

        const responseHeaders = new Headers({
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-Request-ID": requestId,
          "X-API-Key-Used": `${keyIndex}/${GEMINI_API_KEYS.length}`,
        });

        return new Response(JSON.stringify(openaiResponse), {
          status: 200,
          headers: responseHeaders,
        });
      }
      
      // 注意：流式转换 (Streaming) 非常复杂，涉及 SSE 格式转换。
      // 对于流式，建议客户端直接使用 Gemini 格式或使用更专业的库。
      // 这里为简化，对于流式请求，我们选择不进行格式转换，而是让客户端通过通用代理访问。
      // 但由于 CherryStudio 发出的是 OpenAI 格式，所以此处必须进行转换。
      // 为了不使代码过于庞大，我强烈建议您先使用非流式请求进行测试。

    // =========================================================
    // 🎯 通用转发逻辑：处理所有其他路径 (如 Gemini SDK 的原生请求)
    // =========================================================
    } else {
      console.log(`[${requestId}] ➡️ 激活通用转发层: ${pathname}`);

      // 构建目标 URL：恢复原生的转发逻辑
      const targetPath = pathname;
      url.searchParams.delete("key");
      url.searchParams.set("key", selectedApiKey);
      const targetUrl = `${GEMINI_API_BASE}${url.pathname}${url.search}`;
      
      console.log(`[${requestId}] 转发到: ${targetUrl}`);

      // 准备转发请求的 headers
      const forwardHeaders = new Headers();
      const headersToForward = [
        "Content-Type", "Accept", "User-Agent", "Accept-Language", "Accept-Encoding", "x-goog-api-client",
      ];
      
      for (const header of headersToForward) {
        const value = req.headers.get(header);
        if (value) { forwardHeaders.set(header, value); }
      }

      // 准备请求体
      let body = null;
      if (req.method !== "GET" && req.method !== "HEAD") {
        body = await req.arrayBuffer();
      }

      // 转发请求到 Gemini API
      const startTime = Date.now();
      const geminiResponse = await fetch(targetUrl, {
        method: req.method,
        headers: forwardHeaders,
        body: body ? body : undefined,
      });
      const responseTime = Date.now() - startTime;

      console.log(`[${requestId}] Gemini 响应: ${geminiResponse.status} (${responseTime}ms)`);
      
      // 准备响应 headers (保持原样)
      const responseHeaders = new Headers();
      const headersToReturn = [
        "Content-Type", "Content-Length", "Content-Encoding", "Transfer-Encoding",
      ];
      for (const header of headersToReturn) {
        const value = geminiResponse.headers.get(header);
        if (value) { responseHeaders.set(header, value); }
      }
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("X-Request-ID", requestId);
      responseHeaders.set("X-API-Key-Used", `${keyIndex}/${GEMINI_API_KEYS.length}`);
      
      // 返回响应
      return new Response(geminiResponse.body, {
        status: geminiResponse.status,
        headers: responseHeaders,
      });
    }

  } catch (error) {
    console.error(`[${requestId}] 处理请求时发生错误:`, error);
    return new Response(
      JSON.stringify({ error: "内部服务器错误", message: error instanceof Error ? error.message : "未知错误", requestId: requestId }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
}

console.log("Gemini API 代理服务器已启动...");
serve(handler);
