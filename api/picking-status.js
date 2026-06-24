const fs = require("fs");
const path = require("path");

const ADMIN_TOKEN_HASH = "877db6ca4d30e8807e913118ffc6fc505b33573224266eb83ef6084785845d58";
const STATUS_FILE = "ungtool-picking-status.json";
const DEFAULT_REPOSITORY = "tony1010-dev/ungtool";
const DEFAULT_BRANCH = "main";

function seoulDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function statusPayload(enabled) {
  return {
    enabled,
    message: enabled ? "사용 가능" : "현재 사용할 수 없습니다.",
    updatedAt: seoulDateString(),
  };
}

function readLocalStatus() {
  const filePath = path.join(process.cwd(), STATUS_FILE);
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text);
}

async function githubRequest(url, options = {}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error("Vercel 환경변수 GITHUB_TOKEN 설정이 필요합니다.");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "GitHub 파일 수정에 실패했습니다.");
  }
  return data;
}

async function updateGithubStatus(status) {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const fileUrl = `https://api.github.com/repos/${repository}/contents/${STATUS_FILE}`;
  const current = await githubRequest(`${fileUrl}?ref=${encodeURIComponent(branch)}`);
  const content = `${JSON.stringify(status, null, 2)}\n`;

  await githubRequest(fileUrl, {
    method: "PUT",
    body: JSON.stringify({
      branch,
      message: `Update picking status: ${status.enabled ? "enabled" : "disabled"}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha: current.sha,
    }),
  });
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "GET") {
    try {
      return response.status(200).json(readLocalStatus());
    } catch {
      return response.status(200).json(statusPayload(true));
    }
  }

  if (request.method !== "POST") {
    return response.status(405).json({ error: "허용되지 않은 요청입니다." });
  }

  const token = String(request.headers["x-admin-token"] || "");
  if (token !== ADMIN_TOKEN_HASH) {
    return response.status(401).json({ error: "관리자 인증이 필요합니다." });
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    if (typeof body.enabled !== "boolean") {
      return response.status(400).json({ error: "상태 값이 올바르지 않습니다." });
    }

    const status = statusPayload(body.enabled);
    await updateGithubStatus(status);
    return response.status(200).json({
      ok: true,
      status,
      message: "저장했습니다. Vercel 배포가 완료되면 JSON URL에 반영됩니다.",
    });
  } catch (error) {
    return response.status(500).json({
      error: error.message || "상태 저장 중 문제가 발생했습니다.",
    });
  }
};
