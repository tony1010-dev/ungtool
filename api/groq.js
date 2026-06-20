const MODEL = "qwen/qwen3-32b";
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 3000;

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "허용되지 않은 요청입니다." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: "AI 서버가 아직 설정되지 않았습니다." });
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    const history = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
    const messages = [
      {
        role: "system",
        content: String(body.system || "").slice(0, 2000),
      },
      ...history
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: String(message.content || "")
            .trim()
            .slice(0, MAX_MESSAGE_LENGTH),
        }))
        .filter((message) => message.content),
    ];

    if (messages.length < 2) {
      return response.status(400).json({ error: "질문 내용을 입력해 주세요." });
    }

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.35,
        max_completion_tokens: 800,
      }),
    });

    const result = await groqResponse.json();
    if (!groqResponse.ok) {
      const status = groqResponse.status === 429 ? 429 : 502;
      const error =
        groqResponse.status === 429
          ? "무료 사용량이 잠시 초과되었습니다. 잠시 후 다시 시도해 주세요."
          : result.error?.message || "AI 요청에 실패했습니다.";
      return response.status(status).json({ error });
    }

    const text = String(result.choices?.[0]?.message?.content || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();
    if (!text) {
      return response.status(502).json({ error: "AI 응답이 비어 있습니다." });
    }

    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({ text, model: MODEL });
  } catch {
    return response.status(500).json({ error: "AI 연결 중 문제가 발생했습니다." });
  }
};
