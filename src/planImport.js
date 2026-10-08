/* ------------------------------------------------------------------ */
/* 売上計画（上期・下期）CSV と アタックリストCSV の読み込み              */
/* ------------------------------------------------------------------ */
// どちらのCSVかは中身から自動で判定する：
//   売上計画   …「制作基礎数字」と「8月」などの月見出しがある
//   アタックリスト …「ステージ」列がある

// ダブルクォート・セル内改行に対応したCSVパーサー（空行も残す）
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const clean = (v) => String(v ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
const compact = (v) => String(v ?? "").replace(/\s+/g, "");
export function yenOf(v) {
  const s = String(v ?? "").replace(/[¥￥,\s円]/g, "");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : Math.round(n);
}

// 項目名からクリエイティブ内容（カテゴリー）を推定
export function guessCategory(text) {
  const t = String(text || "");
  if (/AI|ＡＩ/.test(t)) return "AI";
  if (/SNS|ＳＮＳ|インスタ|instagram|LINE|ＬＩＮＥ|X広告/i.test(t)) return "SNS";
  if (/動画|PV|ＰＶ|CM|ＣＭ|シネアド|ムービー|映像/.test(t)) return "動画";
  if (/WEB|ＷＥＢ|Web|サイト|LP|ＬＰ|EC|ＥＣ|HP|ＨＰ|ホームページ|Google|システム|フォーム/i.test(t)) return "WEB";
  if (/パンフ|ポスター|チラシ|ステッカー|ロゴ|名刺|看板|ノベルティ|冊子|印刷|横断幕|垂れ幕|ハガキ|はがき|ブース|カード|ラベル|ボード|誌|名札|シャツ|POLO|スウィング|装飾|ビジュアル|ニュースレター|包装|スタンプ/i.test(t))
    return "グラフィック";
  return "未設定";
}

const STOCK_ASSIGNEES = ["運用", "管理"]; // ストック売上として別管理するため読み込まない

// 読み込む担当者（これ以外の担当・空欄の行は読み込まない）
export const ALLOWED_ASSIGNEES = ["岩瀧", "荻田", "岡田", "荻田・岡田", "小野", "上地", "千葉"];
// 表記ゆれ（"荻田岡田" "岡田/荻田" など）をそろえる。対象外なら null
export function normalizeAssignee(raw) {
  const c = String(raw || "").replace(/[・･\/\\,、\s]/g, "");
  if (c === "荻田岡田" || c === "岡田荻田") return "荻田・岡田";
  return ALLOWED_ASSIGNEES.includes(c) ? c : null;
}

/* ---------------------------- 売上計画 ---------------------------- */

// fiscalStartYear: 期の開始年（8月の年）。8〜12月はその年、1〜7月は翌年として扱う。
export function parsePlanCsv(text, fiscalStartYear) {
  const rows = parseCsvRows(text);
  const monthRowIdx = rows.findIndex((r) => r.filter((c) => /^\s*\d{1,2}月\s*$/.test(c)).length >= 3);
  if (monthRowIdx === -1) return null;
  const blocks = [];
  rows[monthRowIdx].forEach((c, col) => {
    const m = String(c).trim().match(/^(\d{1,2})月$/);
    if (!m) return;
    const mo = Number(m[1]);
    const year = mo >= 8 ? fiscalStartYear : fiscalStartYear + 1;
    blocks.push({ col, month: `${year}-${String(mo).padStart(2, "0")}` });
  });

  const targets = {};
  const base = {};
  const confirmed = [];
  const hot = [];
  let skippedStock = 0;
  let skippedAssignee = 0;
  const warnings = [];

  // 目標金額・制作基礎数字
  for (const r of rows) {
    for (const b of blocks) {
      const head = clean(r[b.col]);
      const next = clean(r[b.col + 1]);
      if (head === "目標金額") {
        const v = [2, 3, 1].map((k) => yenOf(r[b.col + k])).find((x) => x);
        if (v) targets[b.month] = v;
      }
      if (next === "制作基礎数字") {
        const v = yenOf(r[b.col + 3]);
        if (v !== null) base[b.month] = v;
      }
    }
  }

  // セクションの範囲を探す
  const isHeaderRow = (r, last) => blocks.some((b) => clean(r[b.col]) === "担当" && clean(r[b.col + 1]) === "取引先" && clean(r[b.col + 4]) === last);
  const confHeader = rows.findIndex((r) => isHeaderRow(r, "備考"));
  const confEnd = rows.findIndex((r, i) => i > confHeader && blocks.some((b) => clean(r[b.col]) === "合計"));
  const hotHeader = rows.findIndex((r) => isHeaderRow(r, "確率"));
  let hotEnd = rows.findIndex((r, i) => i > hotHeader && r.some((c) => clean(c) === "個別見込売上"));
  if (hotEnd === -1) hotEnd = rows.length;

  function readSection(from, to, kind, out) {
    if (from === -1) return;
    const seen = {};
    for (let i = from + 1; i < (to === -1 ? rows.length : to); i++) {
      const r = rows[i];
      for (const b of blocks) {
        const assignee = clean(r[b.col]);
        const clientName = clean(r[b.col + 1]);
        const name = clean(r[b.col + 2]);
        const amountRaw = r[b.col + 3];
        const note = clean(r[b.col + 4]);
        if (!clientName && !name) continue;
        if (clientName === "制作基礎数字" || clientName === "基礎数字実売上") continue;
        if (STOCK_ASSIGNEES.includes(assignee)) {
          skippedStock++;
          continue;
        }
        if (!clientName) continue;
        const who = normalizeAssignee(assignee);
        if (!who) {
          skippedAssignee++;
          continue;
        }
        const amount = yenOf(amountRaw);
        const baseKey = `plan|${kind}|${b.month}|${compact(clientName)}|${compact(name)}`;
        seen[baseKey] = (seen[baseKey] || 0) + 1;
        out.push({
          key: seen[baseKey] > 1 ? `${baseKey}#${seen[baseKey]}` : baseKey,
          kind,
          month: b.month,
          assignee: who,
          clientName,
          name: name || "（項目未記入）",
          amount,
          note: kind === "confirmed" ? note : "",
          category: guessCategory(name),
        });
      }
    }
  }
  readSection(confHeader, confEnd, "confirmed", confirmed);
  readSection(hotHeader, hotEnd, "hot", hot);
  if (confHeader === -1) warnings.push("確定売上の見出し行（担当・取引先・項目・金額・備考）が見つかりませんでした");
  if (hotHeader === -1) warnings.push("見積提出の見出し行（担当・取引先・項目・金額・確率）が見つかりませんでした");

  return { type: "plan", months: blocks.map((b) => b.month), targets, base, confirmed, hot, skippedStock, skippedAssignee, warnings };
}

/* -------------------------- アタックリスト -------------------------- */

export function parseAttackCsv(text, { minUpdated = "2026-08-01" } = {}) {
  const rows = parseCsvRows(text);
  const hIdx = rows.findIndex((r) => r.some((c) => compact(c) === "ステージ"));
  if (hIdx === -1) return null;
  const header = rows[hIdx].map(compact);
  const col = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const C = {
    stage: col("ステージ"),
    assignee: col("担当者", "担当", "営業担当"),
    scheduled: col("受注予定日", "受注予定"),
    client: col("クライアント名", "会社名", "客先"),
    name: col("案件名"),
    progress: col("進捗"),
    updated: col("更新日"),
    entry: col("記入"),
    amount: col("売上見込額", "見込金額", "金額"),
  };
  const get = (r, k) => (C[k] >= 0 ? r[C[k]] : "");
  const STAGE = { 案件提案中: "active", 受注: "won", ロスト: "lost", 参考見積: "reference", 参考見積り: "reference" };

  const items = [];
  const skipped = { stage: 0, moved: 0, old: 0, empty: 0, noClient: 0, assignee: 0 };
  const seen = {};
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => String(c).trim())) continue;
    const stageRaw = compact(get(r, "stage"));
    const stage = STAGE[stageRaw];
    if (!stage) {
      skipped.stage++;
      continue;
    }
    if (/移動済/.test(compact(get(r, "entry")))) {
      skipped.moved++;
      continue;
    }
    const scheduled = parseYm(get(r, "scheduled"));
    const updated = parseYmd(get(r, "updated"));
    const amount = yenOf(get(r, "amount"));
    if (!scheduled && !updated && !amount) {
      skipped.empty++;
      continue;
    }
    if (updated && updated < minUpdated) {
      skipped.old++;
      continue;
    }
    const clientName = clean(get(r, "client"));
    if (!clientName) {
      skipped.noClient++;
      continue;
    }
    const who = normalizeAssignee(get(r, "assignee"));
    if (!who) {
      skipped.assignee++;
      continue;
    }
    const name = clean(get(r, "name")) || "（案件名未記入）";
    const baseKey = `attack|${compact(clientName)}|${compact(name)}`;
    seen[baseKey] = (seen[baseKey] || 0) + 1;
    items.push({
      key: seen[baseKey] > 1 ? `${baseKey}#${seen[baseKey]}` : baseKey,
      stage,
      assignee: who,
      month: scheduled,
      clientName,
      name,
      amount,
      progress: String(get(r, "progress") || "").trim(),
      updated,
      category: guessCategory(name),
    });
  }
  return { type: "attack", items, skipped };
}

function parseYm(v) {
  const s = String(v || "").trim();
  let m = s.match(/(\d{4})\s*[年\/\-.]\s*(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, "0")}`;
}
function parseYmd(v) {
  const s = String(v || "").trim();
  const m = s.match(/(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]?\s*(\d{1,2})?/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3] || 1).padStart(2, "0")}`;
}

// 中身から種類を判定して読み込む
export function parseSalesFile(text, fiscalStartYear) {
  if (/制作基礎数字/.test(text)) {
    const p = parsePlanCsv(text, fiscalStartYear);
    if (p) return p;
  }
  if (/ステージ/.test(text)) {
    const a = parseAttackCsv(text, { minUpdated: `${fiscalStartYear}-08-01` });
    if (a) return a;
  }
  return null;
}
