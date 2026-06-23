const crypto = require("crypto");

const DASH_SHEET_ID = "1og02r9A53W9PUo866w310lCIKuul1KiY0zuefo0YKzA";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cachedToken = null;

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function readCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Google 인증 정보가 설정되지 않았습니다.");

  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    } catch {
      throw new Error("Google 인증 정보를 읽을 수 없습니다.");
    }
  }
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const credentials = readCredentials();
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google 인증 정보 형식이 올바르지 않습니다.");
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(credentials.private_key.replace(/\\n/g, "\n"), "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(tokenBody.error_description || "Google 인증에 실패했습니다.");
  }

  cachedToken = {
    value: tokenBody.access_token,
    expiresAt: now + Number(tokenBody.expires_in || 3600),
  };
  return cachedToken.value;
}

function coerceCell(value) {
  const text = String(value ?? "").trim();
  if (/^-?\d+(?:\.\d+)?$/.test(text.replace(/,/g, ""))) {
    return Number(text.replace(/,/g, ""));
  }
  return value ?? "";
}

function valuesToTable(values = []) {
  return {
    rows: values.map((row = []) => ({
      c: row.map((value) => ({ v: coerceCell(value), f: String(value ?? "") })),
    })),
  };
}

function valueAt(values, rowIndex, colIndex) {
  return values?.[rowIndex]?.[colIndex] ?? "";
}

async function fetchSheetValues(token, spreadsheetId, ranges) {
  const params = new URLSearchParams();
  ranges.forEach((range) => params.append("ranges", range));
  params.set("majorDimension", "ROWS");

  const sheetResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await sheetResponse.json();
  if (!sheetResponse.ok) {
    throw new Error(body.error?.message || "스프레드시트를 읽지 못했습니다.");
  }
  return body.valueRanges || [];
}

async function readAlbumValues(token) {
  try {
    const albumSheetId = process.env.DASH_ALBUM_SHEET_ID || DASH_SHEET_ID;
    const [album] = await fetchSheetValues(token, albumSheetId, ["음반!D3:F5"]);
    const values = album?.values || [];
    return {
      shippingPlt: valueAt(values, 0, 0),
      completedPlt: valueAt(values, 0, 2),
      shippingBox: valueAt(values, 2, 0),
      completedBox: valueAt(values, 2, 2),
    };
  } catch {
    return null;
  }
}

async function readDashboardValues() {
  const token = await getAccessToken();
  const ranges = [
    "입고",
    "출고",
    "민호",
    "입고!M3:M4",
    "출고!L3:N4",
  ];

  const [incoming, outgoing, minho, incomingTotals, outgoingTotals] = await fetchSheetValues(
    token,
    DASH_SHEET_ID,
    ranges,
  );

  return {
    incoming: valuesToTable(incoming?.values || []),
    outgoing: valuesToTable(outgoing?.values || []),
    minho: valuesToTable(minho?.values || []),
    incomingTotals: valuesToTable(incomingTotals?.values || []),
    outgoingTotals: valuesToTable(outgoingTotals?.values || []),
    album: await readAlbumValues(token),
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "허용되지 않은 요청입니다." });
  }

  try {
    const data = await readDashboardValues();
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json(data);
  } catch (error) {
    return response.status(500).json({ error: error.message || "대시보드 데이터를 불러오지 못했습니다." });
  }
};
