// Scripted OpenAI-compatible chat-completions endpoint for e2e tests.
// Picks a scenario from the latest user question and streams SSE back,
// including tool calls, so the whole agent loop runs without a real model.

const requests = [];

function textOf(message) {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
  }
  return "";
}

function stripContext(text) {
  return text.replace(/<page_context[^>]*>[\s\S]*?<\/page_context>/g, "").trim();
}

function chunk(delta, finish = null) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

// Final usage chunk, as OpenAI-compatible servers send with stream_options.include_usage.
function usageChunk(body, outputChars) {
  const prompt = Math.ceil(JSON.stringify(body.messages ?? []).length / 4);
  return `data: ${JSON.stringify({
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: Math.ceil(outputChars / 4) + 5,
      prompt_tokens_details: { cached_tokens: Math.floor(prompt / 2) },
    },
  })}\n\n`;
}

async function streamText(res, text, body) {
  for (const piece of text.match(/.{1,12}/gs) ?? [""]) {
    res.write(chunk({ content: piece }));
    await new Promise((r) => setTimeout(r, 15));
  }
  res.write(chunk({}, "stop"));
  if (body.stream_options?.include_usage) res.write(usageChunk(body, text.length));
  res.end("data: [DONE]\n\n");
}

function streamToolCall(res, name, args, body) {
  const id = `call_${Math.random().toString(36).slice(2, 10)}`;
  res.write(chunk({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }] }));
  res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }));
  res.write(chunk({}, "tool_calls"));
  if (body.stream_options?.include_usage) res.write(usageChunk(body, JSON.stringify(args).length));
  res.end("data: [DONE]\n\n");
}

function refFor(snapshot, role, name) {
  const re = new RegExp(`\\[(\\d+)\\] ${role} "${name}`, "i");
  const match = snapshot.match(re);
  return match ? Number(match[1]) : null;
}

async function reply(body, res) {
  const messages = body.messages ?? [];
  let lastUser = -1;
  messages.forEach((m, i) => {
    if (m.role === "user" && !textOf(m).startsWith("Screenshot from")) lastUser = i;
  });
  const question = lastUser >= 0 ? stripContext(textOf(messages[lastUser])) : "";
  const results = messages.slice(lastUser + 1).filter((m) => m.role === "tool").map(textOf);
  const system = textOf(messages.find((m) => m.role === "system") ?? {});

  // Background chat digest (cross-chat memory).
  if (/You write a short digest of one finished chat/.test(system)) {
    const transcript = textOf(messages.at(-1) ?? {});
    const digest = /api key/i.test(transcript)
      ? "- Created an API key named demo on the fixtures site (value not stored).\nKeywords: api key, demo, fixtures"
      : "- Chatted about the fixture page.\nKeywords: fixture";
    return streamText(res, digest, body);
  }

  // The user steered the running task.
  const steer = question.match(/^\[User update while you were working\]: (.*)$/s);
  if (steer) return streamText(res, `Updated: ${steer[1]}`, body);

  if (/count slowly/i.test(question)) {
    return streamToolCall(res, "wait", { seconds: 2, n: results.length }, body);
  }

  if (/book a table/i.test(question)) {
    if (results.length === 0) return streamToolCall(res, "ask_user", { question: "For how many people?", options: ["2 people", "4 people"] }, body);
    return streamText(res, `Booked. ${results[0]}`, body);
  }

  if (/create an api key/i.test(question)) {
    return streamText(res, "Created API key sk-test-abcdefghijklmnop1234 named demo on the fixtures site.", body);
  }

  if (/which api keys did we create/i.test(question)) {
    if (results.length === 0) return streamToolCall(res, "search_sessions", { query: "api key" }, body);
    const id = results[0].match(/^\[(\w+)\]/m)?.[1] ?? "none";
    return streamText(res, `From [your earlier chat](#chat/${id}): ${results[0].split("\n")[1] ?? ""}`, body);
  }

  if (/what is this page/i.test(question)) {
    const ctx = lastUser >= 0 ? textOf(messages[lastUser]).match(/<page_context[^>]*title="([^"]*)"/) : null;
    return streamText(res, `This page is titled "${ctx ? ctx[1] : "unknown"}".`, body);
  }

  if (/what did i ask/i.test(question)) {
    const earlier = messages
      .slice(0, lastUser)
      .filter((m) => m.role === "user")
      .map((m) => stripContext(textOf(m)));
    return streamText(res, `Earlier you asked: "${earlier[0] ?? "nothing"}".`, body);
  }

  if (/remember that my favorite color is (\w+)/i.test(question)) {
    const color = question.match(/favorite color is (\w+)/i)[1];
    const canRemember = (body.tools ?? []).some((t) => t.function?.name === "remember");
    if (!canRemember) return streamText(res, "I can't save memories right now.", body);
    if (results.length === 0) return streamToolCall(res, "remember", { text: `User's favorite color is ${color}.` }, body);
    return streamText(res, `Got it. ${results[0]}`, body);
  }

  if (/what is my favorite color/i.test(question)) {
    const memoryBlock = system.match(/<memory>[\s\S]*?<\/memory>/)?.[0] ?? "";
    const known = memoryBlock.match(/favorite color is (\w+)/i);
    return streamText(res, known ? `Your favorite color is ${known[1]}.` : "I don't know your favorite color.", body);
  }

  if (/type my name here/i.test(question)) {
    if (results.length === 0) {
      const ctx = textOf(messages[lastUser]);
      const ref = /working="true"/.test(ctx) ? refFor(ctx, "textbox", "Name") : null;
      if (ref === null) return streamText(res, "No element refs in the page context.", body);
      return streamToolCall(res, "type", { ref, text: "Grace" }, body);
    }
    return streamText(res, `Done in place. ${results[0]}`, body);
  }

  if (/fill the form/i.test(question)) {
    if (results.length === 0) return streamToolCall(res, "snapshot", {}, body);
    const snapshot = results[0];
    if (results.length === 1) {
      const ref = refFor(snapshot, "textbox", "Name");
      if (ref === null) return streamText(res, "Could not find the Name field.", body);
      return streamToolCall(res, "type", { ref, text: "Ada" }, body);
    }
    if (results.length === 2) {
      const ref = refFor(snapshot, "button", "Send message");
      if (ref === null) return streamText(res, "Could not find the send button.", body);
      return streamToolCall(res, "click", { ref }, body);
    }
    return streamText(res, `Finished. Last result: ${results.at(-1)}`, body);
  }

  return streamText(res, "OK", body);
}

/** Returns true when the request was handled. */
export function handleMockProvider(req, res, url) {
  if (url.pathname === "/v1/models" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "mock-1" }] }));
    return true;
  }
  if (url.pathname === "/mock/requests" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(requests));
    return true;
  }
  if (url.pathname === "/v1/chat/completions" && req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, GET, OPTIONS",
    });
    res.end();
    return true;
  }
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400);
        res.end("bad json");
        return;
      }
      requests.push(body);
      if (req.headers.authorization !== "Bearer test-key") {
        res.writeHead(401, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end(JSON.stringify({ error: { message: "invalid api key" } }));
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      void reply(body, res);
    });
    return true;
  }
  return false;
}
