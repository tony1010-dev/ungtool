const SPREADSHEET_ID = "1RLA7Qs9hYDiBaSL9CScATVPRjwnwIjznDdRNJGGbg1k";
const NOTICE_SHEET = "NOTICE";
const ADMIN_PASSWORD = "1004";
const DEFAULT_NOTICE = `2026.06.19 ver 1

• Label 출력: 업체명, 인보이스 번호, 박스 수량을 수정해 15×10cm PDF로 출력
• PDF Merge: ZIP 파일 안의 PDF를 파일명 순서대로 자동 병합
• UPS 출력: A4 UPS 라벨을 10×15cm 라벨 용지로 변환
• 피킹리스트 출력: SKU와 로케이션을 연결해 작업자용 Excel·PDF 생성
• 로케이션 동기화: 재고파일과 DB를 비교해 누락·미등록·재고 없음 확인
• Admin: 팀원에게 공유되는 홈 공지 관리`;

function doGet(e) {
  const callback = safeCallback_(e.parameter.callback);
  const action = String(e.parameter.action || "get").toLowerCase();

  try {
    if (action === "set") {
      if (String(e.parameter.password || "") !== ADMIN_PASSWORD) {
        return jsonp_(callback, { success: false, error: "비밀번호가 올바르지 않습니다." });
      }

      const notice = String(e.parameter.notice || "").trim();
      if (!notice) {
        return jsonp_(callback, { success: false, error: "공지 문구가 비어 있습니다." });
      }

      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        noticeSheet_().getRange("A1").setValue(notice);
      } finally {
        lock.releaseLock();
      }
      return jsonp_(callback, { success: true, notice: notice });
    }

    const value = String(noticeSheet_().getRange("A1").getDisplayValue() || "").trim();
    return jsonp_(callback, { success: true, notice: value || DEFAULT_NOTICE });
  } catch (error) {
    return jsonp_(callback, { success: false, error: error.message });
  }
}

function noticeSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(NOTICE_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(NOTICE_SHEET);
    sheet.getRange("A1").setValue(DEFAULT_NOTICE);
  }
  return sheet;
}

function safeCallback_(value) {
  const callback = String(value || "callback");
  return /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback) ? callback : "callback";
}

function jsonp_(callback, data) {
  return ContentService
    .createTextOutput(callback + "(" + JSON.stringify(data) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
