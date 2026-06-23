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

function firstFilled(values, rowIndexes, colIndex = 0) {
  for (const rowIndex of rowIndexes) {
    const value = String(valueAt(values, rowIndex, colIndex) ?? "").trim();
    if (value) return value;
  }
  return "";
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
    const [album] = await fetchSheetValues(token, albumSheetId, ["음반!D3:D6"]);
    const values = album?.values || [];
    return {
      shippingPlt: firstFilled(values, [0, 1]),
      shippingBox: firstFilled(values, [2, 3]),
    };
  } catch {
    return null;
  }
}

async function readPersonnelValues(token) {
  try {
    const albumSheetId = process.env.DASH_ALBUM_SHEET_ID || DASH_SHEET_ID;
    const [personnel] = await fetchSheetValues(token, albumSheetId, ["인원!AC15:AJ97"]);
    return (personnel?.values || [])
      .map((row) => Array.from({ length: 8 }, (_, index) => String(row?.[index] ?? "").trim()))
      .filter((row) => row.some(Boolean));
  } catch {
    return [];
  }
}

function normalizeQueueRow(row = [], range = "") {
  const cells = Array.from({ length: 7 }, (_, index) => String(row?.[index] ?? "").trim());
  const [invoiceNo, customer, carrier, item, qty, worker, progress] = cells;
  if (!invoiceNo || !/^((IN|PI)\d+)/i.test(invoiceNo)) return null;
  if (!customer && !carrier) return null;
  return {
    invoiceNo,
    customer,
    carrier,
    item,
    qty,
    worker,
    progress,
    range,
  };
}

async function readShippingQueueValues(token) {
  try {
    const albumSheetId = process.env.DASH_ALBUM_SHEET_ID || DASH_SHEET_ID;
    const ranges = [
      "음반!C8:I46",
      "음반!M4:S46",
      "음반!W4:AC46",
      "음반!AG4:AM46",
      "음반!C50:I92",
      "음반!M50:S92",
      "음반!W50:AC92",
      "음반!AG50:AM92",
    ];
    const blocks = await fetchSheetValues(token, albumSheetId, ranges);
    return blocks.flatMap((block, blockIndex) =>
      (block?.values || [])
        .map((row) => normalizeQueueRow(row, ranges[blockIndex]))
        .filter(Boolean),
    );
  } catch {
    return [];
  }
}

function normalizeAlbumOutgoingRow(row = [], range = "") {
  const cells = Array.from({ length: 7 }, (_, index) => String(row?.[index] ?? "").trim());
  const [invoiceNo, customer, carrier, item, qty, worker, progress] = cells;
  if (!invoiceNo || !/^((IN|PI)\d+)/i.test(invoiceNo)) return null;
  if (!customer && !carrier && !item && !qty) return null;
  return {
    invoiceNo,
    customer,
    carrier,
    item,
    qty,
    worker,
    progress,
    range,
  };
}

async function readAlbumOutgoingValues(token) {
  try {
    const albumSheetId = process.env.DASH_ALBUM_SHEET_ID || DASH_SHEET_ID;
    const ranges = [
      "음반!C98:I140",
      "음반!M98:S140",
      "음반!W98:AC117",
      "음반!AG98:AM117",
      "음반!W123:AC140",
      "음반!AG123:AM140",
    ];
    const blocks = await fetchSheetValues(token, albumSheetId, ranges);
    return blocks.flatMap((block, blockIndex) =>
      (block?.values || [])
        .map((row) => normalizeAlbumOutgoingRow(row, ranges[blockIndex]))
        .filter(Boolean),
    );
  } catch {
    return [];
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
    shippingQueue: await readShippingQueueValues(token),
    albumOutgoing: await readAlbumOutgoingValues(token),
    personnel: await readPersonnelValues(token),
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
