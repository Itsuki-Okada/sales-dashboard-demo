import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell, LabelList,
} from "recharts";
import {
  Search, Plus, MoreHorizontal, ChevronDown, ChevronRight, ChevronLeft, X,
  LayoutDashboard, BarChart3, CalendarDays, Star, Bell, Settings,
  Trash2, Pencil, CheckCircle2, XCircle, Clock3, ArrowRight,
  TrendingUp, TrendingDown, Building2, Truck, Menu, MapPin, FileCheck,
  ArrowUpDown, Target, Link2, FileText, Upload, AlertTriangle, RefreshCw, Repeat,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* 定数・ユーティリティ                                                */
/* ------------------------------------------------------------------ */

const CATEGORIES = ["WEB", "グラフィック", "動画", "AI", "SNS", "未設定"];
const ASSIGNEES = ["松本", "木村", "林", "清水"];
const DEAL_TYPES = ["新規", "既存"];

const STATUS_LABEL = {
  active: "進行中",
  won: "受注",
  delivered: "納品済み",
  lost: "ロスト",
};

const STATUS_FILTERS = [
  { key: "all", label: "全て" },
  { key: "active", label: "進行中" },
  { key: "won", label: "受注" },
  { key: "delivered", label: "納品済み" },
  { key: "lost", label: "ロスト" },
];

const SORT_OPTIONS = [
  { key: "updated_desc", label: "更新日が新しい順" },
  { key: "confidence_desc", label: "肌感が高い順" },
  { key: "amount_desc", label: "金額が大きい順" },
  { key: "name_asc", label: "案件名順" },
];

function projectAmount(p) {
  return p.status === "won" || p.status === "delivered" ? Number(p.confirmedAmount) || 0 : Number(p.estimatedAmount) || 0;
}

function sortProjects(list, sortBy) {
  const arr = [...list];
  switch (sortBy) {
    case "confidence_desc":
      arr.sort((a, b) => b.confidence - a.confidence);
      break;
    case "amount_desc":
      arr.sort((a, b) => projectAmount(b) - projectAmount(a));
      break;
    case "name_asc":
      arr.sort((a, b) => a.name.localeCompare(b.name, "ja"));
      break;
    case "updated_desc":
    default:
      arr.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  return arr;
}

/* ------------------------------------------------------------------ */
/* CSV取り込み                                                          */
/* ------------------------------------------------------------------ */

const PRIORITY_TO_CONFIDENCE = { A: 3, B: 2, C: 1 };
const CSV_ACCEPTED_STAGES = ["案件提案中", "受注"];
const CSV_ALLOWED_ASSIGNEES = ["岡田", "荻田"];

// CSVの担当者欄の表記ゆれ（"荻田・岡田" "荻田岡田" "岡田/荻田" など）を吸収し、
// 岡田・荻田のみ、またはその組み合わせのみをツール内で統一表記に変換する。
// それ以外の担当者名は null を返し、取り込み対象外として扱う。
function normalizeCsvAssignee(raw) {
  const compact = String(raw || "").replace(/[・･\/\\,、\s]/g, "");
  if (compact === "岡田") return "岡田";
  if (compact === "荻田") return "荻田";
  if (compact === "荻田岡田" || compact === "岡田荻田") return "荻田・岡田";
  return null;
}

// 簡易CSVパーサー。ダブルクォート囲み・カンマ・改行(\r\n/\n)に対応。
function parseCSVText(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // 何もしない（\r\n の \r を無視）
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// "2026/9/10" "2026-09-10" "2026.9.10" やExcelのシリアル値に対応した日付パース。
function parseFlexibleDate(str) {
  if (!str) return null;
  const s = String(str).trim();

  // フル日付: 2026/9/10, 2026-09-10, 2026.9.10
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = String(m[2]).padStart(2, "0");
    const d = String(m[3]).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }

  // 日本語のフル日付: 2026年9月10日
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) {
    const y = m[1];
    const mo = String(m[2]).padStart(2, "0");
    const d = String(m[3]).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }

  // 年月のみ（日の記載なし）: 2026年9月 / 2026/9 / 2026-09
  m = s.match(/^(\d{4})年(\d{1,2})月/);
  if (!m) m = s.match(/^(\d{4})[\/\-.](\d{1,2})(?![\d\/\-.])/);
  if (m) {
    const y = m[1];
    const mo = String(m[2]).padStart(2, "0");
    return `${y}-${mo}-01`;
  }

  // Excelのシリアル値
  if (/^\d+$/.test(s)) {
    const serial = Number(s);
    const excelEpoch = Date.UTC(1899, 11, 30);
    const d = new Date(excelEpoch + serial * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

// "¥1,000,000" "1000000円" などから数値だけを取り出す。
function parseFlexibleNumber(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/[¥￥,\s円]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

// UTF-8 / Shift-JIS のどちらでも読み込めるようにするCSVファイル読み込み。
async function readCsvFile(file) {
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const garbledCount = (text.match(/\uFFFD/g) || []).length;
  if (garbledCount > 3) {
    try {
      text = new TextDecoder("shift-jis").decode(buffer);
    } catch (e) {
      // ブラウザがShift-JISに未対応の場合はUTF-8のまま扱う
    }
  }
  return text.replace(/^\uFEFF/, "");
}

// CSVのテキストから、案件データの配列（取り込み対象／スキップ行）を組み立てる。
// CSV取り込みの重複判定に使うキー。クライアント名＋案件名の組み合わせで一意とみなす。
function csvDedupeKey(clientName, name) {
  return `${clientName.trim()}__${name.trim()}`;
}

function buildProjectsFromCsv(text, existingKeys = new Set(), options = {}) {
  const rows = parseCSVText(text);
  if (rows.length === 0) {
    return { imported: [], skipped: [], summary: { total: 0, active: 0, won: 0, lost: 0, skipped: 0, duplicate: 0 } };
  }

  // 先頭に注記行が入っているCSVもあるため、「ステージ」列を含む行を
  // 実際のヘッダー行として自動検出する（先頭数行の中から探す）。
  // また、スプレッドシート上でセル内改行された列名（例: "受注\n予定日"）
  // にも対応できるよう、比較時は改行・空白をすべて取り除く。
  const normalize = (s) => String(s || "").replace(/\s+/g, "");
  let headerRowIndex = rows.findIndex((r) => r.some((c) => normalize(c) === "ステージ"));
  if (headerRowIndex === -1) headerRowIndex = 0;
  const header = rows[headerRowIndex].map((h) => normalize(h));

  // 列名の表記ゆれに対応できるよう、候補名を複数チェックする。
  function idx(...names) {
    for (const name of names) {
      const i = header.indexOf(normalize(name));
      if (i !== -1) return i;
    }
    return -1;
  }
  const col = {
    stage: idx("ステージ"),
    scheduledDate: idx("受注予定日"),
    clientName: idx("クライアント名", "客先", "会社名"),
    name: idx("案件名"),
    progress: idx("進捗"),
    amount: idx("売上見込額", "見込み金額", "見込金額"),
    assignee: idx("営業担当", "担当者", "自社担当者"),
  };

  const imported = [];
  const skipped = [];
  const seenKeys = new Set(existingKeys);
  let activeCount = 0;
  let wonCount = 0;
  let lostCount = 0;
  let referenceCount = 0;
  let duplicateCount = 0;

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const stageRaw = col.stage >= 0 ? (row[col.stage] || "").trim() : "";
    const isWon = stageRaw === "受注";
    const isActive = stageRaw === "案件提案中";
    const isReferenceRow = stageRaw === "参考見積";
    if (!isActive && !isWon && !isReferenceRow) {
      skipped.push({ row: r + 1, reason: `ステージ「${stageRaw || "(空欄)"}」は対象外（案件提案中・受注・参考見積のみ取り込み）` });
      continue;
    }

    const clientName = col.clientName >= 0 ? (row[col.clientName] || "").trim() : "";
    const name = col.name >= 0 ? (row[col.name] || "").trim() : "";
    if (!clientName || !name) {
      skipped.push({ row: r + 1, reason: "クライアント名または案件名が空欄" });
      continue;
    }

    const assigneeRaw = col.assignee >= 0 ? (row[col.assignee] || "").trim() : "";
    // スプレッドシート連携(anyAssignee)では、シートに書かれた担当者名をそのまま使う（未登録名は自動登録）。
    const assigneeNormalized = options.anyAssignee
      ? normalizeCsvAssignee(assigneeRaw) || assigneeRaw
      : normalizeCsvAssignee(assigneeRaw);
    if (!assigneeNormalized) {
      skipped.push({ row: r + 1, reason: `担当者「${assigneeRaw || "(空欄)"}」は対象外（岡田・荻田のみ取り込み）` });
      continue;
    }

    // 参考見積は確定前の情報のため、受注予定日が未記入でも取り込む。
    const scheduledDateParsed = col.scheduledDate >= 0 ? parseFlexibleDate(row[col.scheduledDate]) : null;
    if (!isReferenceRow && !scheduledDateParsed) {
      skipped.push({ row: r + 1, reason: "受注予定日が未記入、または日付として読み取れない" });
      continue;
    }

    const dedupeKey = csvDedupeKey(clientName, name);
    if (seenKeys.has(dedupeKey)) {
      skipped.push({ row: r + 1, reason: `「${clientName} / ${name}」は取り込み済みのためスキップ` });
      duplicateCount++;
      continue;
    }

    const registeredDate = todayDateStr();
    const scheduledMonth = scheduledDateParsed ? scheduledDateParsed.slice(0, 7) : currentMonthKey();
    const confidence = 2;
    const dealType = "新規";
    const progressText = col.progress >= 0 ? (row[col.progress] || "").trim() : "";
    const estimatedAmount = col.amount >= 0 ? parseFlexibleNumber(row[col.amount]) : 0;
    const assignee = assigneeNormalized;

    const status = isWon ? "won" : "active";
    const confirmedAmount = isWon ? estimatedAmount : null;
    const createdIso = new Date(`${registeredDate}T00:00:00`).toISOString();

    const history = [
      {
        id: uid(),
        date: createdIso,
        type: "created",
        label: isReferenceRow ? "参考見積りとして登録（CSV取込）" : "新規登録（CSV取込）",
        scheduledMonth,
      },
    ];
    if (isWon) {
      history.push({ id: uid(), date: createdIso, type: "won", label: "受注", previousStatus: "active" });
    }

    imported.push({
      id: uid(),
      name,
      clientName,
      category: "未設定",
      scheduledMonth,
      confidence,
      status,
      assignee,
      dealType,
      registeredDate,
      estimatedAmount,
      confirmedAmount,
      deliveryDueDate: null,
      deliveredAt: null,
      quoteSubmitted: false,
      quoteSubmittedAt: null,
      quotedAmount: null,
      contactName: "",
      contactEmail: "",
      memo: "",
      progressNotes: progressText ? [{ id: uid(), date: createdIso, text: progressText }] : [],
      archived: false,
      isReference: isReferenceRow,
      csvSourceKey: dedupeKey,
      csvSnapshot: {
        stage: isReferenceRow ? "reference" : isWon ? "won" : "active",
        scheduledMonth,
        amount: estimatedAmount,
        progress: progressText,
        assignee,
      },
      createdAt: createdIso,
      updatedAt: createdIso,
      history,
    });
    seenKeys.add(dedupeKey);

    if (isReferenceRow) referenceCount++;
    else if (status === "active") activeCount++;
    else if (status === "won") wonCount++;
    else lostCount++;
  }

  return {
    imported,
    skipped,
    summary: {
      total: imported.length,
      active: activeCount,
      won: wonCount,
      lost: lostCount,
      reference: referenceCount,
      skipped: skipped.length,
      duplicate: duplicateCount,
    },
  };
}

const CONF_LABEL = { 1: "COOL", 2: "WARM", 3: "HOT" };
const CONF_HINT = { 1: "可能性低め", 2: "五分五分", 3: "可能性が高い" };

function monthLabel(m) {
  const [y, mo] = m.split("-");
  return `${y}年${parseInt(mo, 10)}月`;
}

function yearOf(m) {
  return m.slice(0, 4);
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 直近numMonths分の "YYYY-MM" の配列を古い順で返す。
function recentMonthKeys(numMonths) {
  const keys = [];
  const d = new Date();
  d.setDate(1);
  for (let i = numMonths - 1; i >= 0; i--) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

// 現在月を基準に startOffset〜endOffset ヶ月分の "YYYY-MM" を返す（未来方向も可）。
function monthKeysRange(startOffset, endOffset) {
  const keys = [];
  const d = new Date();
  d.setDate(1);
  for (let i = startOffset; i <= endOffset; i++) {
    const dt = new Date(d.getFullYear(), d.getMonth() + i, 1);
    keys.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

// 会社名の50音絞り込み用ユーティリティ。
// 「株式会社」などの法人格を除いた先頭文字がどの行に属するかを判定する。
const KANA_ROWS = {
  あ: "あいうえおアイウエオ",
  か: "かきくけこがぎぐげごカキクケコガギグゲゴ",
  さ: "さしすせそざじずぜぞサシスセソザジズゼゾ",
  た: "たちつてとだぢづでどタチツテトダヂヅデド",
  な: "なにぬねのナニヌネノ",
  は: "はひふへほばびぶべぼぱぴぷぺぽハヒフヘホバビブベボパピプペポ",
  ま: "まみむめもマミムメモ",
  や: "やゆよゃゅょヤユヨャュョ",
  ら: "らりるれろラリルレロ",
  わ: "わをんゔヴわゐゑワヲンヴ",
};

function companyDisplayName(name) {
  return name.replace(/^(株式会社|有限会社|合同会社)/, "");
}

function companyKanaRow(name) {
  const first = companyDisplayName(name)[0] || "";
  for (const [row, chars] of Object.entries(KANA_ROWS)) {
    if (chars.includes(first)) return row;
  }
  return "他";
}

function addMonths(m, n) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayIso() {
  return new Date().toISOString();
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatYen(n) {
  if (n === null || n === undefined) return "—";
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function formatManYen(n) {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n / 10000).toLocaleString("ja-JP")}万円`;
}

// 受注率 = 受注 / (受注 + ロスト) × 100。引き伸ばし・進行中は分母から除外。
function winRate(won, lost) {
  const denom = won + lost;
  if (denom === 0) return null;
  return Math.round((won / denom) * 1000) / 10;
}

function computeCounts(list) {
  const wonOnly = list.filter((p) => p.status === "won").length;
  const delivered = list.filter((p) => p.status === "delivered").length;
  const won = wonOnly + delivered; // 受注扱いの合計（未納品＋納品済み）
  const lost = list.filter((p) => p.status === "lost").length;
  const active = list.filter((p) => p.status === "active").length;
  const estimatedTotal = list
    .filter((p) => p.status === "active")
    .reduce((sum, p) => sum + (Number(p.estimatedAmount) || 0), 0);
  const confirmedTotal = list
    .filter((p) => p.status === "won" || p.status === "delivered")
    .reduce((sum, p) => sum + (Number(p.confirmedAmount) || 0), 0);
  return {
    total: list.length,
    won,
    wonOnly,
    delivered,
    lost,
    active,
    rate: winRate(won, lost),
    estimatedTotal,
    confirmedTotal,
  };
}

/* ------------------------------------------------------------------ */
/* シードデータ（ダミー版のみで使用）                                     */
/* ------------------------------------------------------------------ */

const CLIENT_NAMES = [
  "株式会社アルファデザイン", "有限会社グリーンリーフ", "株式会社サンライズ商事",
  "株式会社ノーザンライツ", "合同会社ブルーム", "株式会社テラス建築",
  "株式会社フィールドワークス", "株式会社みなと運輸", "株式会社オレンジページ制作",
  "株式会社シーサイド不動産", "株式会社たけやま食品", "株式会社クラウドナイン",
  "株式会社さくら学院", "株式会社リバーサイド商店", "株式会社ハーモニー音楽",
  "株式会社みらい工房", "有限会社にしき屋", "株式会社スターゲイズ",
  "株式会社パインツリー", "株式会社あすなろ設計", "株式会社ことのは出版",
  "株式会社フォレストガーデン", "株式会社かがやき整体", "株式会社なでしこ農園",
];

const PROJECT_NAMES = {
  WEB: ["コーポレートサイト制作", "採用サイトリニューアル", "ECサイト構築", "LP制作", "会員サイト改修"],
  グラフィック: ["パンフレット制作", "会社案内デザイン", "ロゴ・VI制作", "商品カタログ制作", "名刺デザイン"],
  動画: ["採用動画制作", "商品紹介動画", "会社紹介ムービー", "SNS広告動画", "展示会用映像制作"],
  AI: ["社内AIチャットボット導入", "AI需要予測ツール開発", "AIコピー生成ツール導入", "業務自動化AI構築"],
  SNS: ["Instagram運用代行", "X運用・広告代行", "SNS広告クリエイティブ制作", "TikTok運用支援"],
};

const BASE_AMOUNT = { WEB: 800000, グラフィック: 300000, 動画: 600000, AI: 1500000, SNS: 200000 };

const CONTACT_FAMILY_NAMES = ["田中", "鈴木", "佐藤", "高橋", "伊藤", "渡辺", "山本", "中村", "小林", "加藤"];

function contactFor(idx) {
  return {
    contactName: `${CONTACT_FAMILY_NAMES[idx % CONTACT_FAMILY_NAMES.length]} 様`,
    contactEmail: `contact${idx}@example.co.jp`,
  };
}

function roundTo10k(n) {
  return Math.round(n / 10000) * 10000;
}

const STOCK_CATEGORIES = ["AI", "SNS", "保守管理", "サーバー・ドメイン", "その他"];

// ストック（月額）契約が指定月に有効か。
function stockActiveIn(stock, month) {
  return stock.startMonth <= month && (!stock.endMonth || month <= stock.endMonth);
}

function seedStocks() {
  const start = (offset) => monthKeysRange(offset, offset)[0];
  return [
    { clientName: "株式会社みらい工房", name: "AIチャットボット運用", category: "AI", monthlyAmount: 80000, startMonth: start(-8), assignee: "松本" },
    { clientName: "株式会社スターゲイズ", name: "SNS運用代行（Instagram）", category: "SNS", monthlyAmount: 120000, startMonth: start(-10), assignee: "木村" },
    { clientName: "株式会社ハーモニー音楽", name: "Webサイト保守管理", category: "保守管理", monthlyAmount: 30000, startMonth: start(-14), assignee: "林" },
    { clientName: "有限会社あおぞら食品", name: "SNS運用代行（X）", category: "SNS", monthlyAmount: 70000, startMonth: start(-5), assignee: "清水" },
    { clientName: "株式会社みらい工房", name: "サーバー・ドメイン管理", category: "サーバー・ドメイン", monthlyAmount: 12000, startMonth: start(-20), assignee: "松本" },
    { clientName: "合同会社ノースライト", name: "AI議事録ツール利用料", category: "AI", monthlyAmount: 50000, startMonth: start(-3), assignee: "木村" },
    { clientName: "有限会社あおぞら食品", name: "Webサイト保守管理", category: "保守管理", monthlyAmount: 25000, startMonth: start(-12), assignee: "清水" },
    { clientName: "株式会社スターゲイズ", name: "AI記事生成サポート", category: "AI", monthlyAmount: 60000, startMonth: start(-1), assignee: "林" },
    { clientName: "合同会社ノースライト", name: "SNS運用代行（TikTok）", category: "SNS", monthlyAmount: 90000, startMonth: start(-9), endMonth: start(-1), assignee: "木村" },
    { clientName: "株式会社ハーモニー音楽", name: "SNS運用代行（YouTube）", category: "SNS", monthlyAmount: 100000, startMonth: start(2), assignee: "松本" },
  ].map((x) => ({ id: uid(), endMonth: null, memo: "", ...x }));
}

function seedProjects() {
  const months = monthKeysRange(-2, 3);
  const statuses = ["active", "active", "active", "won", "delivered", "lost"];
  const dealTypes = ["新規", "既存"];
  let clientIdx = 0;
  const list = [];
  months.forEach((month, mi) => {
    CATEGORIES.filter((c) => c !== "未設定").forEach((cat, ci) => {
      const countForCell = mi === 0 || mi === 1 ? 1 : ci % 2 === 0 ? 1 : 0;
      for (let i = 0; i < countForCell + 1; i++) {
        const name =
          PROJECT_NAMES[cat][(clientIdx + i) % PROJECT_NAMES[cat].length];
        const client = CLIENT_NAMES[clientIdx % CLIENT_NAMES.length];
        clientIdx++;
        const confidence = ((clientIdx + ci) % 3) + 1;
        const status = statuses[(clientIdx + mi) % statuses.length];
        const wonFamily = status === "won" || status === "delivered";
        const assignee = ASSIGNEES[clientIdx % ASSIGNEES.length];
        const dealType = dealTypes[clientIdx % dealTypes.length];
        const estimatedAmount = roundTo10k(BASE_AMOUNT[cat] * (1 + (((clientIdx % 5) - 2) * 0.15)));
        const confirmedAmount = wonFamily ? roundTo10k(estimatedAmount * (0.9 + (clientIdx % 3) * 0.05)) : null;
        const contact = contactFor(clientIdx);
        const registeredDate = monthKeysRange(mi - 1 - (clientIdx % 2), mi - 1 - (clientIdx % 2))[0] + "-10";
        const created = new Date(registeredDate).toISOString();
        const quoteSubmitted = status !== "active" || clientIdx % 3 === 0;
        const quoteSubmittedAt = quoteSubmitted ? registeredDate : null;
        const deliveryDueDate = wonFamily ? `${month}-${String(20 + (clientIdx % 8)).padStart(2, "0")}` : null;
        const deliveredAt = status === "delivered" ? created : null;
        list.push({
          id: uid(),
          name,
          clientName: client,
          category: cat,
          scheduledMonth: month,
          confidence,
          status,
          assignee,
          dealType,
          registeredDate,
          estimatedAmount,
          confirmedAmount,
          deliveryDueDate,
          deliveredAt,
          quoteSubmitted,
          quoteSubmittedAt,
          quotedAmount: quoteSubmitted ? estimatedAmount : null,
          contactName: contact.contactName,
          contactEmail: contact.contactEmail,
          memo: "",
          progressNotes: [],
          archived: false,
          isReference: false,
          createdAt: created,
          updatedAt: created,
          history: [
            {
              id: uid(),
              date: created,
              type: "created",
              label: "新規登録",
              scheduledMonth: month,
            },
            ...(status === "lost" || wonFamily
              ? [
                  {
                    id: uid(),
                    date: created,
                    type: status === "lost" ? "lost" : "won",
                    label: status === "lost" ? "ロスト" : "受注",
                    previousStatus: "active",
                  },
                ]
              : []),
            ...(status === "delivered"
              ? [
                  {
                    id: uid(),
                    date: created,
                    type: "delivered",
                    label: "納品済み",
                    previousStatus: "won",
                  },
                ]
              : []),
          ],
        });
      }
    });
  });
  return list.slice(0, 28);
}

// 昨年相当（先頭の月からさらに12ヶ月前）との比較用に、各社の過去実績を
// アーカイブ案件として生成する。archived: true の案件はダッシュボード本体
// （案件ボード）には表示されず、「年別売上」「会社一覧」ページの
// 実績比較にのみ使われる。
function seedArchivedProjects() {
  const list = [];
  const baseMonths = monthKeysRange(-14, -9);
  CLIENT_NAMES.forEach((client, ci) => {
    const dealCount = 2 + (ci % 3);
    for (let d = 0; d < dealCount; d++) {
      const month = baseMonths[(ci * 3 + d * 4) % baseMonths.length];
      const cat = CATEGORIES.filter((c) => c !== "未設定")[(ci + d) % (CATEGORIES.length - 1)];
      const name = PROJECT_NAMES[cat][(ci + d) % PROJECT_NAMES[cat].length];
      const assignee = ASSIGNEES[(ci + d) % ASSIGNEES.length];
      const dealType = (ci + d) % 2 === 0 ? "新規" : "既存";
      const estimatedAmount = roundTo10k(BASE_AMOUNT[cat] * (1 + (((ci + d) % 5 - 2) * 0.15)));
      const status = (ci + d) % 4 === 3 ? "lost" : "won";
      const confirmedAmount = status === "won" ? roundTo10k(estimatedAmount * (0.9 + ((ci + d) % 3) * 0.05)) : null;
      const contact = contactFor(ci * 7 + d);
      const registeredDate = `${month}-05`;
      const created = new Date(registeredDate).toISOString();
      list.push({
        id: uid(),
        name,
        clientName: client,
        category: cat,
        scheduledMonth: month,
        confidence: ((ci + d) % 3) + 1,
        status,
        assignee,
        dealType,
        registeredDate,
        estimatedAmount,
        confirmedAmount,
        deliveryDueDate: null,
        deliveredAt: null,
        quoteSubmitted: true,
        quoteSubmittedAt: registeredDate,
        quotedAmount: estimatedAmount,
        contactName: contact.contactName,
        contactEmail: contact.contactEmail,
        memo: "",
        progressNotes: [],
        archived: true,
        isReference: false,
        createdAt: created,
        updatedAt: created,
        history: [
          { id: uid(), date: created, type: "created", label: "新規登録", scheduledMonth: month },
          {
            id: uid(),
            date: created,
            type: status,
            label: status === "won" ? "受注" : "ロスト",
            previousStatus: "active",
          },
        ],
      });
    }
  });
  return list;
}

// 社内検討用の参考見積り（isReference: true）のサンプルデータ。
// 「本見積もりにする」ボタンを押すまでは案件ボードなど他の画面には表示されない。
function seedReferenceEstimates() {
  const now = todayIso();
  const nowDate = todayDateStr();
  const futureMonth = monthKeysRange(4, 4)[0];
  const samples = [
    { name: "AI社内チャットボット構想", clientName: "株式会社みらい工房", category: "AI", confidence: 1, estimatedAmount: 1200000, assignee: "松本" },
    { name: "ブランドサイト全面刷新（構想段階）", clientName: "株式会社スターゲイズ", category: "WEB", confidence: 1, estimatedAmount: 900000, assignee: "木村" },
    { name: "周年記念ムービー企画", clientName: "株式会社ハーモニー音楽", category: "動画", confidence: 2, estimatedAmount: 500000, assignee: "林" },
  ];
  return samples.map((s, i) => {
    const contact = contactFor(i + 50);
    return {
      id: uid(),
      name: s.name,
      clientName: s.clientName,
      category: s.category,
      scheduledMonth: futureMonth,
      confidence: s.confidence,
      status: "active",
      assignee: s.assignee,
      dealType: "新規",
      registeredDate: nowDate,
      estimatedAmount: s.estimatedAmount,
      confirmedAmount: null,
      deliveryDueDate: null,
      deliveredAt: null,
      quoteSubmitted: false,
      quoteSubmittedAt: null,
      quotedAmount: null,
      contactName: contact.contactName,
      contactEmail: contact.contactEmail,
      memo: "",
      progressNotes: [],
      archived: false,
      isReference: true,
      createdAt: now,
      updatedAt: now,
      history: [{ id: uid(), date: now, type: "created", label: "参考見積りとして登録", scheduledMonth: futureMonth }],
    };
  });
}

function seedVisits(projects = []) {
  const samples = [
    { daysAgo: 2, clientName: CLIENT_NAMES[0], assignee: "松本", purpose: "提案・見積提示", memo: "先方役員も同席。年内の発注に前向きな反応。" },
    { daysAgo: 5, clientName: CLIENT_NAMES[3], assignee: "木村", purpose: "定例訪問", memo: "現行サイトの課題をヒアリング。次回提案書を持参予定。" },
    { daysAgo: 9, clientName: CLIENT_NAMES[8], assignee: "林", purpose: "新規開拓", memo: "初訪問。名刺交換のみ、次回改めてアポ予定。" },
    { daysAgo: 14, clientName: CLIENT_NAMES[12], assignee: "清水", purpose: "契約締結", memo: "契約書に捺印いただき受注確定。" },
    { daysAgo: 19, clientName: CLIENT_NAMES[1], assignee: "林", purpose: "定例訪問", memo: "運用状況の報告。追加でLP制作の相談あり。" },
    { daysAgo: 26, clientName: CLIENT_NAMES[5], assignee: "松本", purpose: "提案・見積提示", memo: "動画制作の見積りを提示。社内で検討後、来週回答予定。" },
    { daysAgo: 33, clientName: CLIENT_NAMES[0], assignee: "松本", purpose: "ヒアリング", memo: "サイトリニューアルの要望を整理。予算感は300万円前後。" },
    { daysAgo: 41, clientName: CLIENT_NAMES[7], assignee: "木村", purpose: "新規開拓", memo: "展示会で名刺交換した担当者を訪問。SNS運用に関心。" },
    { daysAgo: 48, clientName: CLIENT_NAMES[3], assignee: "木村", purpose: "納品・報告", memo: "名刺デザインを納品。次はパンフレットを検討中とのこと。" },
    { daysAgo: 57, clientName: CLIENT_NAMES[10], assignee: "清水", purpose: "ヒアリング", memo: "採用強化のため動画とSNSの両面で相談を受けた。" },
    { daysAgo: 66, clientName: CLIENT_NAMES[8], assignee: "林", purpose: "定例訪問", memo: "四半期の振り返り。来期のWeb予算を確保済み。" },
    { daysAgo: 74, clientName: CLIENT_NAMES[12], assignee: "清水", purpose: "提案・見積提示", memo: "ロゴ・VIの提案。3案のうちB案で進める方向。" },
  ];
  return samples.map((s) => {
    const d = new Date();
    d.setDate(d.getDate() - s.daysAgo);
    const date = d.toISOString().slice(0, 10);
    const related = projects.find((p) => p.clientName === s.clientName && !p.archived);
    return {
      id: uid(),
      date,
      clientName: s.clientName,
      assignee: s.assignee,
      purpose: s.purpose,
      memo: s.memo,
      relatedProjectId: related ? related.id : null,
      createdAt: d.toISOString(),
    };
  });
}

/* ------------------------------------------------------------------ */
/* 小さな UI パーツ                                                     */
/* ------------------------------------------------------------------ */

// 肌感を HOT / WARM / COOL のバッジで表示
const CONF_STYLE = {
  3: { cls: "bg-rose-50 text-rose-600", dot: "#e11d48" },
  2: { cls: "bg-amber-50 text-amber-600", dot: "#d97706" },
  1: { cls: "bg-sky-50 text-sky-600", dot: "#0284c7" },
};

function ConfidenceStars({ value }) {
  const st = CONF_STYLE[value] || CONF_STYLE[1];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${st.cls}`}
      title={CONF_HINT[value]}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} />
      {CONF_LABEL[value] || "COOL"}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    active: "bg-slate-100 text-slate-600",
    won: "bg-emerald-50 text-emerald-700",
    delivered: "bg-indigo-50 text-indigo-700",
    lost: "bg-rose-50 text-rose-700",
  };
  const icon = {
    active: <Clock3 size={12} />,
    won: <CheckCircle2 size={12} />,
    delivered: <Truck size={12} />,
    lost: <XCircle size={12} />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${map[status]}`}
    >
      {icon[status]}
      {STATUS_LABEL[status]}
    </span>
  );
}

function CategoryPill({ category }) {
  return (
    <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
      {category}
    </span>
  );
}

function QuoteTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
      <FileCheck size={12} />
      見積提出済み
    </span>
  );
}

function Toast({ toasts }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg animate-[fadeIn_150ms_ease-out]"
        >
          <CheckCircle2 size={16} className="text-emerald-400" />
          {t.message}
        </div>
      ))}
    </div>
  );
}

function Modal({ open, onClose, title, children, width = "max-w-lg" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-slate-900/40 px-4 py-10 overflow-y-auto">
      <div
        className={`w-full ${width} rounded-2xl bg-white shadow-xl transition-all duration-150`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({ open, onClose, onConfirm, title, message, tone = "default" }) {
  if (!open) return null;
  const btnTone =
    tone === "danger"
      ? "bg-rose-600 hover:bg-rose-700"
      : "bg-indigo-600 hover:bg-indigo-700";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${btnTone}`}
          >
            確定する
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionMenu({ project, onAction }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const items = [
    { key: "won", label: "受注にする", show: project.status === "active" },
    { key: "postpone", label: "時期変更する", show: project.status === "active" },
    { key: "lost", label: "ロストにする", show: project.status === "active" },
    { key: "quote", label: project.quoteSubmitted ? "再見積もり提出" : "見積提出", show: project.status === "active" },
    { key: "delivered", label: "納品済みにする", show: project.status === "won" },
    { key: "edit", label: "編集", show: true },
    { key: "delete", label: "削除", show: true, danger: true },
  ].filter((i) => i.show);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((i) => (
            <button
              key={i.key}
              onClick={() => {
                setOpen(false);
                onAction(i.key, project);
              }}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                i.danger ? "text-rose-600" : "text-slate-700"
              }`}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ヘッダーのモバイル用オーバーフローメニュー                             */
/* ------------------------------------------------------------------ */

function HeaderMoreMenu({ onAddReference, onImport, onSheetSync }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div className="relative sm:hidden" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
      >
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <button
            onClick={() => {
              setOpen(false);
              onAddReference();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            <FileText size={15} />
            参考見積り追加
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onImport();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            <Upload size={15} />
            CSV取り込み
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onSheetSync();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={15} />
            シート連携
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPI カード                                                          */
/* ------------------------------------------------------------------ */

function KpiCard({ label, value, suffix = "", accent = "text-slate-900" }) {
  return (
    <div className="flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`mt-1 whitespace-nowrap tabular-nums ${accent}`}
        style={{ fontFamily: "var(--font-num)", fontWeight: 500, fontSize: 26, lineHeight: 1.15 }}
      >
        {value}
        {suffix && <span className="ml-0.5 text-sm font-semibold">{suffix}</span>}
      </div>
    </div>
  );
}

// 割合バー（受注率などを横棒で見せる）
function RateBar({ won = 0, lost = 0, rate, width = "100%" }) {
  const decided = won + lost;
  return (
    <div className="flex items-center gap-2" style={{ width }}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: decided ? "var(--c-lost-track, #ffe4e6)" : "var(--c-track, #f1f5f9)" }}>
        <div className="h-full rounded-full" style={{ width: `${decided ? (won / decided) * 100 : 0}%`, background: "#059669" }} />
      </div>
      <span className="w-11 text-right text-xs font-semibold tabular-nums text-slate-700">{rate ?? "—"}{rate !== null && rate !== undefined ? "%" : ""}</span>
    </div>
  );
}

function SectionCard({ title, note, children, className = "" }) {
  return (
    <div className={`rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {(title || note) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {title && <div className="text-sm font-semibold text-slate-800">{title}</div>}
          {note && <div className="text-xs text-slate-400">{note}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function ChipGroup({ label, options, value, onChange, render }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {label && <span className="mr-1 text-xs text-slate-400">{label}</span>}
      {options.map((o) => {
        const key = typeof o === "object" ? o.value : o;
        const text = typeof o === "object" ? o.label : o;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              value === key ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {render ? render(o) : text}
          </button>
        );
      })}
    </div>
  );
}

function ProgressBar({ value, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const colorClass = pct >= 100 ? "bg-emerald-500" : pct >= 70 ? "bg-indigo-600" : "bg-amber-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-2 rounded-full transition-all duration-300 ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 案件テーブル（月別セクション）                                        */
/* ------------------------------------------------------------------ */

function MonthSection({ month, projects, defaultOpen, onAction, onOpenDetail }) {
  const [open, setOpen] = useState(defaultOpen);
  const counts = computeCounts(projects);
  const postponedOut = projects[0]?.__postponedOutCount ?? 0;

  if (projects.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-4"
      >
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
          <span className="text-sm font-semibold text-slate-900">{monthLabel(month)}</span>
          <span className="text-xs text-slate-400">{projects.length}件</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>受注 <b className="text-emerald-600">{counts.won}</b></span>
          <span>ロスト <b className="text-rose-600">{counts.lost}</b></span>
          <span>受注率 <b className="text-slate-800">{counts.rate ?? "—"}{counts.rate !== null ? "%" : ""}</b></span>
          <span>見込み <b className="text-amber-600">{formatManYen(counts.estimatedTotal)}</b></span>
          <span>確定 <b className="text-emerald-600">{formatManYen(counts.confirmedTotal)}</b></span>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-200">
          {/* デスクトップ・タブレット：テーブル表示 */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="px-5 py-2 font-medium">客先</th>
                  <th className="px-3 py-2 font-medium">案件</th>
                  <th className="px-3 py-2 font-medium">内容</th>
                  <th className="px-3 py-2 font-medium">担当</th>
                  <th className="px-3 py-2 font-medium">肌感</th>
                  <th className="px-3 py-2 font-medium">金額</th>
                  <th className="px-3 py-2 font-medium">状態</th>
                  <th className="px-3 py-2 font-medium">更新日</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                    onClick={() => onOpenDetail(p)}
                  >
                    <td className="max-w-[260px] truncate px-5 py-3 font-semibold text-slate-900">{p.clientName}</td>
                    <td className="max-w-[220px] truncate px-3 py-3 text-slate-500">{p.name}</td>
                    <td className="px-3 py-3"><CategoryPill category={p.category} /></td>
                    <td className="px-3 py-3 whitespace-nowrap text-slate-500">{p.assignee}</td>
                    <td className="px-3 py-3"><ConfidenceStars value={p.confidence} /></td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums text-slate-600">
                      {p.status === "won" || p.status === "delivered" ? formatManYen(p.confirmedAmount) : formatManYen(p.estimatedAmount)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={p.status} />
                        {p.status === "active" && p.quoteSubmitted && <QuoteTag />}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-slate-400">{fmtDate(p.updatedAt)}</td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <ActionMenu project={p} onAction={onAction} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* スマホ：カード表示 */}
          <div className="flex flex-col gap-2 p-3 sm:hidden">
            {projects.map((p) => (
              <div
                key={p.id}
                onClick={() => onOpenDetail(p)}
                className="cursor-pointer rounded-xl border border-slate-200 p-3 active:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{p.clientName}</div>
                    <div className="truncate text-xs text-slate-500">{p.name}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <ActionMenu project={p} onAction={onAction} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <CategoryPill category={p.category} />
                  <StatusBadge status={p.status} />
                  {p.status === "active" && p.quoteSubmitted && <QuoteTag />}
                  <ConfidenceStars value={p.confidence} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-slate-400">担当：{p.assignee}</span>
                  <span className="font-medium tabular-nums text-slate-700">
                    {p.status === "won" || p.status === "delivered" ? formatManYen(p.confirmedAmount) : formatManYen(p.estimatedAmount)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-400">更新日：{fmtDate(p.updatedAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 月間目標編集フォーム                                                  */
/* ------------------------------------------------------------------ */

function TargetForm({ initial, onSubmit, onCancel }) {
  const [amount, setAmount] = useState(initial);
  const valid = amount !== "" && Number(amount) >= 0;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-xs font-medium text-slate-500">月間目標金額</label>
        <div className="relative mt-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">¥</span>
          <input
            type="number"
            min="0"
            step="100000"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 pl-7 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            placeholder="例）3000000"
          />
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          キャンセル
        </button>
        <button
          disabled={!valid}
          onClick={() => onSubmit(Number(amount))}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          保存する
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 案件追加・編集モーダル                                                */
/* ------------------------------------------------------------------ */

function ProjectForm({ initial, companies = [], assignees = ASSIGNEES, onSubmit, onCancel }) {
  const [form, setForm] = useState(
    initial ?? {
      name: "",
      clientName: "",
      category: "WEB",
      scheduledMonth: currentMonthKey(),
      confidence: 2,
      assignee: ASSIGNEES[0],
      dealType: DEAL_TYPES[0],
      registeredDate: todayDateStr(),
      estimatedAmount: "",
      contactName: "",
      contactEmail: "",
      memo: "",
    }
  );
  const valid =
    form.name.trim() &&
    form.clientName.trim() &&
    form.scheduledMonth &&
    form.registeredDate &&
    form.estimatedAmount !== "" &&
    Number(form.estimatedAmount) >= 0;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-xs font-medium text-slate-500">案件名 *</label>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          placeholder="例）コーポレートサイト制作"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">客先（会社名） *</label>
        <input
          list="project-company-list"
          value={form.clientName}
          onChange={(e) => setForm({ ...form, clientName: e.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          placeholder="既存の会社名を検索、または新規に入力"
        />
        <datalist id="project-company-list">
          {companies.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-slate-500">先方ご担当者名</label>
          <input
            value={form.contactName}
            onChange={(e) => setForm({ ...form, contactName: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            placeholder="例）田中 様"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">先方メールアドレス</label>
          <input
            type="email"
            value={form.contactEmail}
            onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            placeholder="例）tanaka@example.co.jp"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-slate-500">受注予定月 *</label>
          <input
            type="month"
            value={form.scheduledMonth}
            onChange={(e) => setForm({ ...form, scheduledMonth: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">登録日 *</label>
          <input
            type="date"
            value={form.registeredDate}
            onChange={(e) => setForm({ ...form, registeredDate: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-slate-500">クリエイティブ内容 *</label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">新規・既存</label>
          <div className="mt-1 flex gap-2">
            {DEAL_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, dealType: t })}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                  form.dealType === t
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">見込み金額 *</label>
        <div className="relative mt-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">¥</span>
          <input
            type="number"
            min="0"
            step="10000"
            value={form.estimatedAmount}
            onChange={(e) => setForm({ ...form, estimatedAmount: e.target.value })}
            className="w-full rounded-lg border border-slate-200 py-2 pl-7 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            placeholder="例）800000"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">自社担当者</label>
        <select
          value={assignees.includes(form.assignee) ? form.assignee : "__custom__"}
          onChange={(e) => {
            if (e.target.value === "__custom__") {
              setForm({ ...form, assignee: "" });
            } else {
              setForm({ ...form, assignee: e.target.value });
            }
          }}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          {assignees.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
          <option value="__custom__">＋ 新しい担当者を入力</option>
        </select>
        {!assignees.includes(form.assignee) && (
          <input
            autoFocus
            value={form.assignee}
            onChange={(e) => setForm({ ...form, assignee: e.target.value })}
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            placeholder="新しい担当者名を入力"
          />
        )}
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">自分たちの肌感</label>
        <div className="mt-1 flex gap-2">
          {[3, 2, 1].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setForm({ ...form, confidence: n })}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                form.confidence === n
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              <ConfidenceStars value={n} />
              <div className="mt-1 text-[11px] text-slate-400">{CONF_HINT[n]}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">メモ（任意）</label>
        <textarea
          value={form.memo}
          onChange={(e) => setForm({ ...form, memo: e.target.value })}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          placeholder="営業状況などを自由に記入"
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          キャンセル
        </button>
        <button
          disabled={!valid}
          onClick={() => onSubmit(form)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          保存する
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 時期変更ダイアログ                                                    */
/* ------------------------------------------------------------------ */

function PostponeDialog({ project, onClose, onConfirm }) {
  if (!project) return null;
  return <PostponeDialogInner project={project} onClose={onClose} onConfirm={onConfirm} />;
}

function PostponeDialogInner({ project, onClose, onConfirm }) {
  const [target, setTarget] = useState(project.scheduledMonth);
  const changed = target && target !== project.scheduledMonth;
  return (
    <Modal open={!!project} onClose={onClose} title="受注予定月を変更する" width="max-w-sm">
      <p className="text-sm text-slate-500">
        「{project?.name}」の受注予定月を変更します。前の月・先の月どちらでも自由に選択できます。
      </p>
      <div className="mt-4 flex items-center justify-center gap-3 text-sm">
        <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-slate-600">
          {project && monthLabel(project.scheduledMonth)}
        </span>
        <ArrowRight size={16} className="text-slate-400" />
        <input
          type="month"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 focus:border-indigo-400 focus:outline-none"
        />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          キャンセル
        </button>
        <button
          disabled={!changed}
          onClick={() => onConfirm(target)}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {target && monthLabel(target)}へ変更する
        </button>
      </div>
    </Modal>
  );
}

function WonDialog({ project, onClose, onConfirm }) {
  if (!project) return null;
  return <WonDialogInner project={project} onClose={onClose} onConfirm={onConfirm} />;
}

function WonDialogInner({ project, onClose, onConfirm }) {
  const [amount, setAmount] = useState(project.estimatedAmount ?? "");
  const valid = amount !== "" && Number(amount) >= 0;
  return (
    <Modal open={!!project} onClose={onClose} title="受注金額を入力" width="max-w-sm">
      <p className="text-sm text-slate-500">
        「{project.name}」を受注にします。確定金額を入力してください。
      </p>
      <div className="mt-3 text-xs text-slate-400">見込み金額：{formatYen(project.estimatedAmount)}</div>
      <div className="relative mt-2">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">¥</span>
        <input
          type="number"
          min="0"
          step="10000"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-lg border border-slate-200 py-2 pl-7 pr-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          placeholder="例）800000"
        />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          キャンセル
        </button>
        <button
          disabled={!valid}
          onClick={() => onConfirm(Number(amount))}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          受注として確定する
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 見積提出ダイアログ                                                    */
/* ------------------------------------------------------------------ */

function QuoteDialog({ project, onClose, onConfirm }) {
  if (!project) return null;
  return <QuoteDialogInner project={project} onClose={onClose} onConfirm={onConfirm} />;
}

function QuoteDialogInner({ project, onClose, onConfirm }) {
  const isResubmit = !!project.quoteSubmitted;
  const [amount, setAmount] = useState(project.quotedAmount ?? project.estimatedAmount ?? "");
  const [date, setDate] = useState(todayDateStr());
  const valid = amount !== "" && Number(amount) >= 0 && date;
  return (
    <Modal open={!!project} onClose={onClose} title={isResubmit ? "再見積もり提出" : "見積提出"} width="max-w-sm">
      <p className="text-sm text-slate-500">
        「{project.name}」の{isResubmit ? "再見積もり" : "見積"}金額と提出日を入力してください。
      </p>
      {isResubmit && (
        <div className="mt-3 text-xs text-slate-400">
          前回の提出：{fmtDate(project.quoteSubmittedAt)} ・ {formatYen(project.quotedAmount)}
        </div>
      )}
      <div className="mt-3">
        <label className="text-xs font-medium text-slate-500">見積金額</label>
        <div className="relative mt-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">¥</span>
          <input
            type="number"
            min="0"
            step="10000"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 pl-7 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            placeholder="例）800000"
          />
        </div>
      </div>
      <div className="mt-3">
        <label className="text-xs font-medium text-slate-500">提出日</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <button
            onClick={() => setDate(todayDateStr())}
            className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            今日
          </button>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          キャンセル
        </button>
        <button
          disabled={!valid}
          onClick={() => onConfirm(Number(amount), date)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {isResubmit ? "再提出を記録" : "提出を記録"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 案件詳細ドロワー                                                     */
/* ------------------------------------------------------------------ */

function ProjectDetail({ project, onClose, onAction, onAddNote, onSetDeliveryDate, relatedVisits }) {
  if (!project) return null;
  return (
    <ProjectDetailInner
      project={project}
      onClose={onClose}
      onAction={onAction}
      onAddNote={onAddNote}
      onSetDeliveryDate={onSetDeliveryDate}
      relatedVisits={relatedVisits}
    />
  );
}

function ProjectDetailInner({ project, onClose, onAction, onAddNote, onSetDeliveryDate, relatedVisits }) {
  const [noteText, setNoteText] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40">
      <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-base font-semibold text-slate-900">案件詳細</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onAction("edit", project)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              <Pencil size={14} />
              編集
            </button>
            <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-900">{project.name}</div>
              <div className="mt-1 text-sm text-slate-500">{project.clientName}</div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StatusBadge status={project.status} />
              {project.status === "active" && project.quoteSubmitted && <QuoteTag />}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-400">カテゴリー</div>
              <div className="mt-1"><CategoryPill category={project.category} /></div>
            </div>
            <div>
              <div className="text-xs text-slate-400">肌感</div>
              <div className="mt-1"><ConfidenceStars value={project.confidence} /></div>
            </div>
            <div>
              <div className="text-xs text-slate-400">受注予定月</div>
              <div className="mt-1 font-medium text-slate-700">{monthLabel(project.scheduledMonth)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">新規・既存</div>
              <div className="mt-1 font-medium text-slate-700">{project.dealType || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">登録日</div>
              <div className="mt-1 font-medium text-slate-700">{project.registeredDate ? fmtDate(project.registeredDate) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">自社担当者</div>
              <div className="mt-1 font-medium text-slate-700">{project.assignee}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">先方ご担当者</div>
              <div className="mt-1 font-medium text-slate-700">{project.contactName || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">先方メールアドレス</div>
              <div className="mt-1 break-all font-medium text-slate-700">{project.contactEmail || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">見込み金額</div>
              <div className="mt-1 font-medium text-slate-700">{formatYen(project.estimatedAmount)}</div>
            </div>
            {(project.status === "won" || project.status === "delivered") && (
              <div>
                <div className="text-xs text-slate-400">確定金額</div>
                <div className="mt-1 font-medium text-emerald-700">{formatYen(project.confirmedAmount)}</div>
              </div>
            )}
            <div>
              <div className="text-xs text-slate-400">更新日</div>
              <div className="mt-1 font-medium text-slate-700">{fmtDate(project.updatedAt)}</div>
            </div>
          </div>
          {project.memo && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">{project.memo}</div>
          )}

          {project.status === "active" && (
            <div className="mt-5 flex flex-col gap-3">
              <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <button
                  onClick={() => onAction("quote", project)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-white py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
                >
                  <FileCheck size={15} />
                  {project.quoteSubmitted ? "再見積もり提出" : "見積提出"}
                </button>
                {project.quoteSubmitted && (
                  <div className="text-center text-xs text-slate-400">
                    直近の提出：{fmtDate(project.quoteSubmittedAt)} ・ {formatYen(project.quotedAmount)}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onAction("won", project)}
                  className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  受注
                </button>
                <button
                  onClick={() => onAction("postpone", project)}
                  className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600"
                >
                  時期変更
                </button>
                <button
                  onClick={() => onAction("lost", project)}
                  className="flex-1 rounded-lg bg-rose-600 py-2 text-sm font-medium text-white hover:bg-rose-700"
                >
                  ロスト
                </button>
              </div>
            </div>
          )}

          {project.status === "won" && (
            <div className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-500 whitespace-nowrap">納品予定日</label>
                <input
                  type="date"
                  value={project.deliveryDueDate || ""}
                  onChange={(e) => onSetDeliveryDate(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <button
                onClick={() => onAction("delivered", project)}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <Truck size={15} />
                納品済みにする
              </button>
            </div>
          )}

          {project.status === "delivered" && (
            <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-sm text-indigo-700">
              <div className="flex items-center gap-1.5 font-medium">
                <Truck size={15} />
                納品完了
              </div>
              <div className="mt-1 text-xs text-indigo-500">
                納品日：{project.deliveredAt ? fmtDate(project.deliveredAt) : "—"}
              </div>
            </div>
          )}

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold text-slate-400">進行状況メモ</div>
            <div className="flex gap-2">
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="進捗を記録する（例：先方に見積送付済み）"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && noteText.trim()) {
                    onAddNote(noteText.trim());
                    setNoteText("");
                  }
                }}
              />
              <button
                disabled={!noteText.trim()}
                onClick={() => {
                  onAddNote(noteText.trim());
                  setNoteText("");
                }}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                追加
              </button>
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {(!project.progressNotes || project.progressNotes.length === 0) && (
                <li className="text-sm text-slate-400">まだ進行状況メモはありません</li>
              )}
              {[...(project.progressNotes || [])].reverse().map((n) => (
                <li key={n.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  <div>{n.text}</div>
                  <div className="mt-1 text-xs text-slate-400">{fmtDate(n.date)}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold text-slate-400">関連する訪問記録</div>
            {(!relatedVisits || relatedVisits.length === 0) ? (
              <div className="text-sm text-slate-400">関連する訪問記録はありません</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {relatedVisits.map((v) => (
                  <li key={v.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <MapPin size={12} className="text-indigo-500" />
                      {fmtDate(v.date)} ・ 担当：{v.assignee}
                      {v.purpose ? ` ・ ${v.purpose}` : ""}
                    </div>
                    {v.memo && <div className="mt-1 text-slate-600">{v.memo}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold text-slate-400">案件履歴</div>
            <div className="flex flex-col">
              {project.history.map((h, i) => (
                <div key={h.id} className="flex gap-3">
                  <div className="flex w-2 shrink-0 flex-col items-center">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
                    {i < project.history.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-slate-200" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-4 text-sm">
                    <div className="text-slate-700">{h.label}</div>
                    {h.toMonth && (
                      <div className="text-xs text-slate-400">変更後：{monthLabel(h.toMonth)}</div>
                    )}
                    {h.quoteAmount != null && (
                      <div className="text-xs text-slate-400">金額：{formatYen(h.quoteAmount)}</div>
                    )}
                    {h.quoteDate && (
                      <div className="text-xs text-slate-400">提出日：{fmtDate(h.quoteDate)}</div>
                    )}
                    <div className="text-xs text-slate-400">{fmtDate(h.date)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 受注率分析ページ                                                     */
/* ------------------------------------------------------------------ */

function AnalysisPage({ projects }) {
  const [category, setCategory] = useState("全体");
  const [confidence, setConfidence] = useState("すべて");
  const [assignee, setAssignee] = useState("全員");
  const assigneeList = Array.from(new Set([...ASSIGNEES, ...projects.map((p) => p.assignee).filter(Boolean)]));

  const matchCat = (p) => category === "全体" || p.category === category;
  const matchConf = (p) => confidence === "すべて" || p.confidence === Number(confidence);
  const matchWho = (p) => assignee === "全員" || p.assignee === assignee;
  const filtered = projects.filter((p) => matchCat(p) && matchConf(p) && matchWho(p));
  const overall = computeCounts(filtered);

  const byConfidence = [3, 2, 1].map((n) => ({ conf: n, ...computeCounts(filtered.filter((p) => p.confidence === n)) }));
  const byAssignee = assigneeList.map((a) => ({
    assignee: a,
    ...computeCounts(projects.filter((p) => p.assignee === a && matchCat(p) && matchConf(p))),
  }));
  const byCategory = CATEGORIES.map((cat) => {
    const c = computeCounts(projects.filter((p) => p.category === cat && matchConf(p) && matchWho(p)));
    return { category: cat, ...c, 案件数: c.total, 受注率: c.rate ?? 0 };
  });
  const maxCatAmount = Math.max(1, ...byCategory.map((r) => r.estimatedTotal + r.confirmedTotal));
  const maxWhoAmount = Math.max(1, ...byAssignee.map((r) => r.confirmedTotal));

  const months = recentMonthKeys(6);
  const monthlyRate = months.map((m) => {
    const c = computeCounts(filtered.filter((p) => p.scheduledMonth === m));
    return { month: `${parseInt(m.slice(5), 10)}月`, 受注率: c.rate ?? 0, 受注: c.won, ロスト: c.lost };
  });
  const axis = { fontSize: 12, fill: "#94A3B8" };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <ChipGroup label="カテゴリ" options={["全体", ...CATEGORIES]} value={category} onChange={setCategory} />
        <ChipGroup
          label="肌感"
          options={[{ value: "すべて", label: "すべて" }, { value: "3", label: "HOT" }, { value: "2", label: "WARM" }, { value: "1", label: "COOL" }]}
          value={confidence}
          onChange={setConfidence}
        />
        <ChipGroup label="担当" options={["全員", ...assigneeList]} value={assignee} onChange={setAssignee} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="総案件数" value={overall.total} suffix="件" />
        <KpiCard label="受注" value={overall.won} suffix="件" accent="text-emerald-600" />
        <KpiCard label="ロスト" value={overall.lost} suffix="件" accent="text-rose-600" />
        <KpiCard label="受注率" value={overall.rate ?? "—"} suffix={overall.rate !== null ? "%" : ""} accent="text-indigo-600" />
        <KpiCard label="見込み金額" value={Math.round(overall.estimatedTotal / 10000).toLocaleString("ja-JP")} suffix="万円" accent="text-amber-600" />
        <KpiCard label="確定金額" value={Math.round(overall.confirmedTotal / 10000).toLocaleString("ja-JP")} suffix="万円" accent="text-emerald-600" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="肌感別の受注率" note="HOT・WARM・COOLの順に確度が高い案件">
          <div className="flex flex-col gap-3">
            {byConfidence.map((r) => (
              <div key={r.conf} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3.5 py-3">
                <div className="w-16 shrink-0"><ConfidenceStars value={r.conf} /></div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span>案件 <b className="font-semibold text-slate-800">{r.total}</b></span>
                  <span>受注 <b className="font-semibold text-emerald-600">{r.won}</b></span>
                  <span>ロスト <b className="font-semibold text-rose-600">{r.lost}</b></span>
                </div>
                <RateBar won={r.won} lost={r.lost} rate={r.rate} width="40%" />
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="担当者別の実績" note="確定金額の大きさを棒で表示">
          <div className="flex flex-col gap-3">
            {byAssignee.map((r) => (
              <div key={r.assignee} className="flex items-center gap-3">
                <Avatar name={r.assignee} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-sm font-semibold text-slate-800">{r.assignee}</span>
                    <span className="text-xs text-slate-500">
                      案件 {r.total}・受注 <b className="text-emerald-600">{r.won}</b>・ロスト <b className="text-rose-600">{r.lost}</b>
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${(r.confirmedTotal / maxWhoAmount) * 100}%`, background: "#059669" }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums text-emerald-700">{formatManYen(r.confirmedTotal)}</span>
                    <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-indigo-600">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="カテゴリー別の金額と受注率" note="棒：確定（緑）＋見込み（橙）">
        <div className="flex flex-col divide-y divide-slate-100">
          {byCategory.map((r) => (
            <div key={r.category} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="w-24 shrink-0"><CategoryPill category={r.category} /></div>
              <div className="w-20 shrink-0 text-xs text-slate-500">案件 <b className="font-semibold text-slate-800">{r.total}</b></div>
              <div className="flex min-w-[160px] flex-1 items-center gap-2">
                <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div style={{ width: `${(r.confirmedTotal / maxCatAmount) * 100}%`, background: "#059669" }} />
                  <div style={{ width: `${(r.estimatedTotal / maxCatAmount) * 100}%`, background: "#f59e0b" }} />
                </div>
              </div>
              <div className="w-24 shrink-0 text-right text-xs tabular-nums text-emerald-700">確定 <b>{formatManYen(r.confirmedTotal)}</b></div>
              <div className="w-24 shrink-0 text-right text-xs tabular-nums text-amber-600">見込み <b>{formatManYen(r.estimatedTotal)}</b></div>
              <RateBar won={r.won} lost={r.lost} rate={r.rate} width="120px" />
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="カテゴリー別の案件数">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCategory}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" strokeOpacity={0.6} />
              <XAxis dataKey="category" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
              <Tooltip cursor={{ fill: "rgba(148,163,184,.12)" }} />
              <Bar dataKey="案件数" fill={chartAccent()} radius={[6, 6, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
        <SectionCard title="月別の受注率（直近6か月）">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthlyRate}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" strokeOpacity={0.6} />
              <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} unit="%" width={40} domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="受注率" stroke={chartAccent()} strokeWidth={2.5} dot={{ r: 4, strokeWidth: 2, fill: "var(--c-card)" }} />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 年別売上比率ページ                                                    */
/* ------------------------------------------------------------------ */

function YoyBadge({ yoy }) {
  if (yoy === null || yoy === undefined) return <span className="text-slate-400">—</span>;
  const up = yoy >= 0;
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${up ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      {up ? "+" : ""}{yoy}%
    </span>
  );
}

function YearlyRevenuePage({ projects }) {
  const years = Array.from(new Set(projects.map((p) => yearOf(p.scheduledMonth)))).sort();
  const rows = years.map((y, i) => {
    const list = projects.filter((p) => yearOf(p.scheduledMonth) === y);
    const c = computeCounts(list);
    const prevYear = years[i - 1];
    const prevRevenue = prevYear ? computeCounts(projects.filter((p) => yearOf(p.scheduledMonth) === prevYear)).confirmedTotal : null;
    const yoy = prevRevenue && prevRevenue > 0 ? Math.round(((c.confirmedTotal - prevRevenue) / prevRevenue) * 1000) / 10 : null;
    const byCat = CATEGORIES.map((cat) => ({ cat, v: computeCounts(list.filter((p) => p.category === cat)).confirmedTotal })).filter((x) => x.v > 0);
    return { year: y, ...c, yoy, byCat };
  });
  const chartData = rows.map((r) => ({ 年: `${r.year}年`, 確定金額: Math.round(r.confirmedTotal / 10000) }));
  const maxRev = Math.max(1, ...rows.map((r) => r.confirmedTotal));
  const catColor = { WEB: "#4f46e5", グラフィック: "#db2777", 動画: "#d97706", AI: "#0891b2", SNS: "#7c3aed", 未設定: "#94a3b8" };
  const axis = { fontSize: 12, fill: "#94A3B8" };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...rows].reverse().map((r, i) => (
          <div key={r.year} className={`rounded-[22px] border p-5 shadow-sm ${i === 0 ? "border-indigo-200 bg-white" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">{r.year}年</span>
              <YoyBadge yoy={r.yoy} />
            </div>
            <div className="mt-2 text-xs text-slate-500">確定金額</div>
            <div className="tabular-nums text-slate-900" style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 32, lineHeight: 1.1 }}>
              {Math.round(r.confirmedTotal / 10000).toLocaleString("ja-JP")}
              <span className="ml-1 text-sm font-semibold">万円</span>
            </div>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
              {r.byCat.map((x) => (
                <div key={x.cat} title={`${x.cat} ${formatManYen(x.v)}`} style={{ width: `${(x.v / Math.max(1, r.confirmedTotal)) * 100}%`, background: catColor[x.cat] }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              {r.byCat.map((x) => (
                <span key={x.cat} className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: catColor[x.cat] }} />
                  {x.cat} {formatManYen(x.v)}
                </span>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-center">
              <div><div className="text-[11px] text-slate-500">案件</div><div className="text-sm font-semibold tabular-nums text-slate-800">{r.total}</div></div>
              <div><div className="text-[11px] text-slate-500">受注/ロスト</div><div className="text-sm font-semibold tabular-nums"><span className="text-emerald-600">{r.won}</span><span className="text-slate-300"> / </span><span className="text-rose-600">{r.lost}</span></div></div>
              <div><div className="text-[11px] text-slate-500">受注率</div><div className="text-sm font-semibold tabular-nums text-indigo-600">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</div></div>
            </div>
          </div>
        ))}
      </div>

      <SectionCard title="年別の確定金額（万円）">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" strokeOpacity={0.6} />
            <XAxis dataKey="年" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={44} />
            <Tooltip formatter={(v) => `${v.toLocaleString("ja-JP")}万円`} cursor={{ fill: "rgba(148,163,184,.12)" }} />
            <Bar dataKey="確定金額" fill={chartAccent()} radius={[8, 8, 0, 0]} maxBarSize={90} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard title="年別サマリー">
        <div className="flex flex-col divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.year} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="w-16 shrink-0 text-sm font-semibold text-slate-800">{r.year}年</div>
              <div className="flex min-w-[140px] flex-1 items-center gap-2">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${(r.confirmedTotal / maxRev) * 100}%`, background: "#059669" }} />
                </div>
                <span className="w-20 text-right text-sm font-semibold tabular-nums text-emerald-700">{formatManYen(r.confirmedTotal)}</span>
              </div>
              <div className="text-xs text-slate-500">案件 <b className="text-slate-800">{r.total}</b>・受注 <b className="text-emerald-600">{r.won}</b>・ロスト <b className="text-rose-600">{r.lost}</b></div>
              <RateBar won={r.won} lost={r.lost} rate={r.rate} width="120px" />
              <div className="w-20 text-right"><YoyBadge yoy={r.yoy} /></div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 会社一覧ページ                                                       */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* 会社一覧・訪問記録の共通パーツ                                         */
/* ------------------------------------------------------------------ */

const NUM_FONT_STYLE = { fontFamily: "var(--font-num)" };
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const AVATAR_COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#475569"];
const PURPOSE_STYLES = {
  新規開拓: { bg: "#eef2ff", fg: "#4338ca" },
  ヒアリング: { bg: "#f0f9ff", fg: "#0369a1" },
  "提案・見積提示": { bg: "#fff7ed", fg: "#c2410c" },
  契約締結: { bg: "#ecfdf5", fg: "#047857" },
  定例訪問: { bg: "var(--c-track)", fg: "#475569" },
  "納品・報告": { bg: "#f5f3ff", fg: "#6d28d9" },
};

function colorFor(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name, size = 28 }) {
  const label = String(name || "?").replace(/^(株式会社|有限会社|合同会社)/, "").slice(0, 1);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: colorFor(name), fontSize: Math.round(size * 0.42) }}
    >
      {label}
    </span>
  );
}

function PurposeTag({ purpose }) {
  if (!purpose) return null;
  const st = PURPOSE_STYLES[purpose] || { bg: "var(--c-track)", fg: "#475569" };
  return (
    <span className="app-tag rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: st.bg, color: st.fg, "--tag-fg": st.fg }}>
      {purpose}
    </span>
  );
}

function corpPrefix(name) {
  const m = String(name || "").match(/^(株式会社|有限会社|合同会社)/);
  return m ? m[1] : "";
}

function daysSince(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function sinceLabel(dateStr) {
  const n = daysSince(dateStr);
  if (n <= 0) return "今日";
  if (n < 31) return `${n}日前`;
  if (n < 365) return `${Math.floor(n / 30)}か月前`;
  return `${Math.floor(n / 365)}年以上前`;
}

function StatTile({ label, value, unit, sub, tone = "text-slate-900" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 tabular-nums ${tone}`} style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 28, lineHeight: 1.1 }}>
        {value}
        {unit && <span className="ml-1 text-sm font-semibold">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

// 訪問記録を月ごとにまとめたタイムライン（訪問記録ページ・会社詳細で共用）
function VisitTimeline({ visits, projects, onOpenDetail, onDelete, showCompany = true, onOpenCompany }) {
  const sorted = [...visits].sort((a, b) => (a.date < b.date ? 1 : -1));
  const groups = [];
  sorted.forEach((v) => {
    const key = v.date.slice(0, 7);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, items: [] };
      groups.push(g);
    }
    g.items.push(v);
  });
  if (sorted.length === 0) {
    return <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">訪問記録はまだありません</div>;
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.key}>
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <span className="text-sm font-semibold text-slate-800">{monthLabel(g.key)}</span>
            <span className="text-xs text-slate-400">{g.items.length}件</span>
          </div>
          <ol className="flex flex-col gap-2">
            {g.items.map((v) => {
              const d = new Date(`${v.date}T00:00:00`);
              const related = v.relatedProjectId ? projects.find((p) => p.id === v.relatedProjectId) : null;
              return (
                <li key={v.id} className="flex gap-3">
                  <div className="flex w-12 shrink-0 flex-col items-center pt-3 sm:w-14">
                    <span className="tabular-nums text-slate-900" style={{ ...NUM_FONT_STYLE, fontWeight: 400, fontSize: 26, lineHeight: 1 }}>
                      {d.getDate()}
                    </span>
                    <span className={`mt-1 text-[11px] ${d.getDay() === 0 ? "text-rose-500" : d.getDay() === 6 ? "text-sky-600" : "text-slate-400"}`}>
                      {WEEKDAYS[d.getDay()]}曜
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {showCompany && (
                          <button
                            onClick={() => onOpenCompany && onOpenCompany(v.clientName)}
                            className={`flex min-w-0 items-center gap-2 ${onOpenCompany ? "hover:text-indigo-600" : ""}`}
                          >
                            <Avatar name={v.clientName} size={24} />
                            <span className="truncate text-sm font-semibold text-slate-800">{v.clientName}</span>
                          </button>
                        )}
                        <div className={`flex flex-wrap items-center gap-2 ${showCompany ? "mt-2" : ""}`}>
                          <PurposeTag purpose={v.purpose} />
                          <span className="flex items-center gap-1.5 text-xs text-slate-500">
                            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: colorFor(v.assignee) }} />
                            担当 {v.assignee}
                          </span>
                        </div>
                      </div>
                      {onDelete && (
                        <button
                          onClick={() => onDelete(v)}
                          className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                          title="削除"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                    {v.memo && <p className="mt-2.5 text-sm leading-relaxed text-slate-700">{v.memo}</p>}
                    {related && (
                      <button
                        onClick={() => onOpenDetail && onOpenDetail(related)}
                        className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                      >
                        <Link2 size={12} className="shrink-0" />
                        <span className="truncate">関連案件：{related.name}</span>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function CompanyListPage({ projects, onOpenDetail, visits, onAddVisit, stocks = [], initialCompany = null }) {
  const companies = useMemo(
    () => Array.from(new Set(projects.map((p) => p.clientName))).sort((a, b) => a.localeCompare(b, "ja")),
    [projects]
  );
  const [selected, setSelected] = useState(initialCompany);
  const [search, setSearch] = useState("");
  const [kanaFilter, setKanaFilter] = useState("全て");
  const [sortKey, setSortKey] = useState("recent");
  const [showAddVisit, setShowAddVisit] = useState(false);
  const thisYear = String(new Date().getFullYear());
  const thisMonth = currentMonthKey();

  useEffect(() => {
    if (initialCompany) setSelected(initialCompany);
  }, [initialCompany]);

  // 会社ごとの集計
  const summaries = useMemo(() => {
    return companies.map((name) => {
      const list = projects.filter((p) => p.clientName === name);
      const c = computeCounts(list);
      const vs = (visits || []).filter((v) => v.clientName === name).sort((a, b) => (a.date < b.date ? 1 : -1));
      const st = stocks.filter((x) => x.clientName === name && stockActiveIn(x, thisMonth));
      const lastActivity = [
        ...list.map((p) => p.updatedAt || p.createdAt || ""),
        ...vs.map((v) => v.date),
      ].sort().pop() || "";
      return {
        name,
        list,
        ...c,
        yearConfirmed: computeCounts(list.filter((p) => yearOf(p.scheduledMonth) === thisYear)).confirmedTotal,
        lastVisit: vs[0] ? vs[0].date : null,
        visitCount: vs.length,
        stockMonthly: st.reduce((a, x) => a + x.monthlyAmount, 0),
        assignees: Array.from(new Set(list.map((p) => p.assignee).filter(Boolean))),
        lastActivity,
      };
    });
  }, [companies, projects, visits, stocks, thisYear, thisMonth]);

  const q = search.trim().toLowerCase();
  const visible = summaries
    .filter((c) => {
      if (kanaFilter !== "全て" && companyKanaRow(c.name) !== kanaFilter) return false;
      if (!q) return true;
      if (c.name.toLowerCase().includes(q)) return true;
      return c.list.some((p) => p.name.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (sortKey === "confirmed") return b.confirmedTotal - a.confirmedTotal;
      if (sortKey === "active") return b.active - a.active || b.estimatedTotal - a.estimatedTotal;
      if (sortKey === "kana") return companyDisplayName(a.name).localeCompare(companyDisplayName(b.name), "ja");
      return a.lastActivity < b.lastActivity ? 1 : -1;
    });

  const totals = {
    companies: summaries.length,
    activeCompanies: summaries.filter((c) => c.active > 0).length,
    yearConfirmed: summaries.reduce((a, c) => a + c.yearConfirmed, 0),
    stockCompanies: summaries.filter((c) => c.stockMonthly > 0).length,
  };

  /* ---------------- 一覧 ---------------- */
  if (!selected) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="取引のある会社" value={totals.companies} unit="社" />
          <StatTile label="進行中の案件がある会社" value={totals.activeCompanies} unit="社" tone="text-indigo-600" />
          <StatTile label={`${thisYear}年の確定金額`} value={Math.round(totals.yearConfirmed / 10000).toLocaleString("ja-JP")} unit="万円" tone="text-emerald-600" />
          <StatTile label="ストック契約のある会社" value={totals.stockCompanies} unit="社" tone="text-violet-600" />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="会社名・案件名で検索"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <ArrowUpDown size={14} className="text-slate-400" />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 focus:outline-none"
              >
                <option value="recent">最近動きがあった順</option>
                <option value="confirmed">確定金額が大きい順</option>
                <option value="active">進行中の案件が多い順</option>
                <option value="kana">50音順</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["全て", "あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ"].map((row) => (
              <button
                key={row}
                onClick={() => setKanaFilter(row)}
                className={`min-w-[36px] rounded-full px-3 py-1 text-xs font-medium ${
                  kanaFilter === row ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {row}
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs text-slate-400">{visible.length}社を表示中</div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((c) => (
            <button
              key={c.name}
              onClick={() => setSelected(c.name)}
              className="flex flex-col gap-4 rounded-[22px] border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-indigo-300"
            >
              <div className="flex items-center gap-3">
                <Avatar name={c.name} size={40} />
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-400">{corpPrefix(c.name) || "　"}</div>
                  <div className="truncate text-[15px] font-semibold text-slate-900">{companyDisplayName(c.name)}</div>
                </div>
                {c.active > 0 && (
                  <span className="ml-auto shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">進行中 {c.active}件</span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 px-3 py-2.5 text-center">
                <div>
                  <div className="text-[11px] text-slate-500">案件</div>
                  <div className="tabular-nums text-slate-800" style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 20 }}>{c.total}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">受注 / ロスト</div>
                  <div className="tabular-nums" style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 20 }}>
                    <span className="text-emerald-600">{c.won}</span>
                    <span className="mx-1 text-slate-300">/</span>
                    <span className="text-rose-600">{c.lost}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">受注率</div>
                  <div className="tabular-nums text-slate-800" style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 20 }}>
                    {c.rate ?? "—"}
                    {c.rate !== null && <span className="text-xs">%</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] text-slate-500">確定金額（累計）</div>
                  <div className="tabular-nums text-emerald-700" style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 24, lineHeight: 1.1 }}>
                    {Math.round(c.confirmedTotal / 10000).toLocaleString("ja-JP")}
                    <span className="ml-0.5 text-xs font-semibold">万円</span>
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>見込み <b className="tabular-nums font-semibold text-amber-600">{formatManYen(c.estimatedTotal)}</b></div>
                  {c.stockMonthly > 0 && (
                    <div className="mt-0.5">ストック <b className="tabular-nums font-semibold text-violet-600">{formatManYen(c.stockMonthly)}</b>/月</div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <MapPin size={13} className={c.lastVisit ? "text-indigo-500" : "text-slate-300"} />
                  {c.lastVisit ? `最終訪問 ${fmtDate(c.lastVisit)}（${sinceLabel(c.lastVisit)}）` : "訪問記録なし"}
                </span>
                <span className="flex -space-x-1.5">
                  {c.assignees.slice(0, 3).map((a) => (
                    <span key={a} title={a} className="rounded-full ring-2 ring-white">
                      <Avatar name={a} size={22} />
                    </span>
                  ))}
                </span>
              </div>
            </button>
          ))}
          {visible.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
              該当する会社がありません。検索語や50音の絞り込みを変えてください。
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---------------- 会社詳細 ---------------- */
  const sum = summaries.find((c) => c.name === selected) || { list: [], assignees: [] };
  const companyProjects = projects.filter((p) => p.clientName === selected);
  const overall = computeCounts(companyProjects);
  const monthsSet = Array.from(new Set(companyProjects.map((p) => p.scheduledMonth))).sort().reverse();
  const monthlyRows = monthsSet.map((m) => ({ month: m, ...computeCounts(companyProjects.filter((p) => p.scheduledMonth === m)) }));
  const years = Array.from(new Set(companyProjects.map((p) => yearOf(p.scheduledMonth)))).sort();
  const yearlyRows = years.map((y, i) => {
    const c = computeCounts(companyProjects.filter((p) => yearOf(p.scheduledMonth) === y));
    const prevYear = years[i - 1];
    const prevRevenue = prevYear ? computeCounts(companyProjects.filter((p) => yearOf(p.scheduledMonth) === prevYear)).confirmedTotal : null;
    const yoy = prevRevenue && prevRevenue > 0 ? Math.round(((c.confirmedTotal - prevRevenue) / prevRevenue) * 1000) / 10 : null;
    return { year: y, ...c, yoy };
  });
  const maxYear = Math.max(1, ...yearlyRows.map((r) => r.confirmedTotal));
  const sortedProjects = [...companyProjects].sort((a, b) => (a.scheduledMonth < b.scheduledMonth ? 1 : -1));
  const companyVisits = (visits || []).filter((v) => v.clientName === selected);
  const companyStocks = stocks.filter((x) => x.clientName === selected);

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => setSelected(null)}
        className="flex w-fit items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
      >
        <ChevronLeft size={16} />
        会社一覧に戻る
      </button>

      <div className="flex flex-col gap-4 rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={selected} size={52} />
          <div className="min-w-0">
            <div className="text-xs text-slate-400">{corpPrefix(selected)}</div>
            <div className="truncate text-xl font-semibold text-slate-900">{companyDisplayName(selected)}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <MapPin size={12} />
                {sum.lastVisit ? `最終訪問 ${fmtDate(sum.lastVisit)}（${sinceLabel(sum.lastVisit)}）` : "訪問記録なし"}
              </span>
              {sum.assignees.length > 0 && <span>担当：{sum.assignees.join("・")}</span>}
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowAddVisit(true)}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus size={16} />
          訪問記録を追加
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="案件数" value={overall.total} unit="件" sub={`受注 ${overall.won}・ロスト ${overall.lost}・進行中 ${overall.active}`} />
        <StatTile label="受注率" value={overall.rate ?? "—"} unit={overall.rate !== null ? "%" : ""} tone="text-indigo-600" />
        <StatTile label="見込み金額" value={Math.round(overall.estimatedTotal / 10000).toLocaleString("ja-JP")} unit="万円" tone="text-amber-600" />
        <StatTile
          label="確定金額（累計）"
          value={Math.round(overall.confirmedTotal / 10000).toLocaleString("ja-JP")}
          unit="万円"
          tone="text-emerald-600"
          sub={sum.stockMonthly > 0 ? `ストック ${formatManYen(sum.stockMonthly)}/月` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-3">
          <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-sm font-semibold text-slate-800">案件一覧</div>
              <div className="text-xs text-slate-400">{sortedProjects.length}件・クリックで詳細</div>
            </div>
            <div className="flex flex-col gap-2">
              {sortedProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpenDetail && onOpenDetail(p)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-3 text-left hover:border-indigo-300 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{p.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <CategoryPill category={p.category} />
                      <span>{monthLabel(p.scheduledMonth)}</span>
                      {p.assignee && <span>担当 {p.assignee}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="tabular-nums text-sm font-semibold text-slate-800">
                      {formatManYen(p.status === "won" || p.status === "delivered" ? p.confirmedAmount : p.estimatedAmount)}
                    </span>
                    <StatusBadge status={p.status} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-800">年別の確定金額・昨年比</div>
            {yearlyRows.length === 0 ? (
              <div className="text-sm text-slate-400">データがありません</div>
            ) : (
              <div className="flex flex-col gap-3">
                {yearlyRows.map((r) => (
                  <div key={r.year} className="flex items-center gap-3">
                    <div className="w-14 shrink-0 text-sm font-medium text-slate-700">{r.year}年</div>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${(r.confirmedTotal / maxYear) * 100}%`, background: "#059669" }} />
                    </div>
                    <div className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-emerald-700">{formatManYen(r.confirmedTotal)}</div>
                    <div className="w-20 shrink-0 text-right"><YoyBadge yoy={r.yoy} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-800">月別の受注状況</div>
            {monthlyRows.length === 0 ? (
              <div className="text-sm text-slate-400">データがありません</div>
            ) : (
              <div className="flex flex-col divide-y divide-slate-100">
                {monthlyRows.map((r) => {
                  const decided = r.won + r.lost;
                  return (
                    <div key={r.month} className="flex items-center gap-3 py-2.5">
                      <div className="w-24 shrink-0 text-sm text-slate-700">{monthLabel(r.month)}</div>
                      <div className="flex flex-1 flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>案件 <b className="font-semibold text-slate-800">{r.total}</b></span>
                        <span>受注 <b className="font-semibold text-emerald-600">{r.won}</b></span>
                        <span>ロスト <b className="font-semibold text-rose-600">{r.lost}</b></span>
                      </div>
                      <div className="flex w-28 shrink-0 items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: decided ? "var(--c-lost-track)" : "var(--c-track)" }}>
                          <div className="h-full" style={{ width: `${decided ? (r.won / decided) * 100 : 0}%`, background: "#059669" }} />
                        </div>
                        <span className="w-9 text-right text-xs font-semibold tabular-nums text-slate-700">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-2">
          {companyStocks.length > 0 && (
            <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 text-sm font-semibold text-slate-800">ストック契約</div>
              <div className="flex flex-col gap-2">
                {companyStocks.map((x) => (
                  <div key={x.id} className="flex items-center justify-between rounded-xl bg-violet-50 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800">{x.name}</div>
                      <div className="text-xs text-slate-500">{x.category}・{monthLabel(x.startMonth)}〜{x.endMonth ? monthLabel(x.endMonth) : ""}</div>
                    </div>
                    <div className="shrink-0 pl-2 font-semibold tabular-nums text-violet-700">{formatYen(x.monthlyAmount)}<span className="text-[10px] font-normal text-slate-400">/月</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="mb-3 flex items-baseline justify-between px-1">
              <div className="text-sm font-semibold text-slate-800">訪問記録</div>
              <div className="text-xs text-slate-400">{companyVisits.length}件</div>
            </div>
            <VisitTimeline visits={companyVisits} projects={projects} onOpenDetail={onOpenDetail} showCompany={false} />
          </div>
        </div>
      </div>

      <Modal open={showAddVisit} onClose={() => setShowAddVisit(false)} title="訪問記録を追加">
        <VisitForm
          companies={companies}
          projects={projects}
          initialClientName={selected}
          onSubmit={(f) => {
            onAddVisit(f);
            setShowAddVisit(false);
          }}
          onCancel={() => setShowAddVisit(false)}
        />
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* リマインドパネル                                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* ダッシュボード：月ごとの状況（今月フォーカス）                      */
/* ------------------------------------------------------------------ */

function DashboardHero({ month, projects, stocks, target, onEditTarget, onChangeMonth, monthChoices }) {
  const list = projects.filter((p) => p.scheduledMonth === month);
  const c = computeCounts(list);
  const open = list.filter((p) => p.status === "active");
  const sumOf = (arr) => arr.reduce((a, p) => a + (Number(p.estimatedAmount) || 0), 0);
  const hot = sumOf(open.filter((p) => p.confidence === 3));
  const warm = sumOf(open.filter((p) => p.confidence === 2));
  const cool = sumOf(open.filter((p) => p.confidence === 1));
  const stock = stocks.filter((st) => stockActiveIn(st, month)).reduce((a, st) => a + st.monthlyAmount, 0);
  const postponed = projects.reduce((acc, p) => acc + p.history.filter((h) => h.type === "postponed" && h.fromMonth === month).length, 0);
  const isNow = month === currentMonthKey();
  const pct = target > 0 ? Math.round((c.confirmedTotal / target) * 100) : 0;
  const remain = target - c.confirmedTotal;
  const manN = (n) => Math.round(n / 10000).toLocaleString("ja-JP");

  // リング：目標額（超えていれば合計額）を一周として、確定→HOT→WARM→COOLを積み上げる
  const R = 58;
  const C = 2 * Math.PI * R;
  const base = Math.max(target, c.confirmedTotal + hot + warm + cool, 1);
  let off = 0;
  const segs = [
    [c.confirmedTotal, "#059669", 1],
    [hot, "#e11d48", 0.55],
    [warm, "#d97706", 0.55],
    [cool, "#0284c7", 0.55],
  ]
    .filter((x) => x[0] > 0)
    .map(([v, color, op], i) => {
      const len = (v / base) * C;
      const el = (
        <circle key={i} cx="75" cy="75" r={R} fill="none" stroke={color} strokeWidth="12" opacity={op}
          strokeDasharray={`${Math.max(0.1, len - 3)} ${C}`} strokeDashoffset={-off} />
      );
      off += len;
      return el;
    });

  const idx = monthChoices.indexOf(month);
  const tiles = [
    ["HOT", hot, "#e11d48", "bg-rose-50 text-rose-600"],
    ["WARM", warm, "#d97706", "bg-amber-50 text-amber-600"],
    ["COOL", cool, "#0284c7", "bg-sky-50 text-sky-600"],
    ["ストック", stock, "#7c3aed", "bg-violet-50 text-violet-600"],
  ];

  return (
    <div className="app-hero flex flex-col gap-5 rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {isNow ? "今月の状況" : "月の状況"}
            {isNow && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] text-white">今月</span>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => onChangeMonth(addMonths(month, -1))}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
              aria-label="前の月"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-baseline gap-1.5 px-1">
              <span className="text-slate-900" style={{ ...NUM_FONT_STYLE, fontWeight: 300, fontSize: 52, lineHeight: 1, letterSpacing: "-.03em" }}>
                {Number(month.slice(5))}
              </span>
              <span className="font-semibold text-slate-700">月</span>
              <span className="ml-1 text-xs text-slate-400" style={NUM_FONT_STYLE}>{month.slice(0, 4)}</span>
            </div>
            <button
              onClick={() => onChangeMonth(addMonths(month, 1))}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
              aria-label="次の月"
            >
              <ChevronRight size={18} />
            </button>
            {!isNow && (
              <button onClick={() => onChangeMonth(currentMonthKey())} className="ml-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
                今月に戻る
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-5 text-center">
          {[
            ["案件", c.total, "text-slate-800"],
            ["受注", c.won, "text-emerald-600"],
            ["ロスト", c.lost, "text-rose-600"],
            ["時期変更", postponed, "text-amber-600"],
            ["受注率", c.rate === null ? "—" : `${c.rate}%`, "text-indigo-600"],
          ].map(([lb, v, cls]) => (
            <div key={lb}>
              <div className="text-[11px] text-slate-500">{lb}</div>
              <div className={`tabular-nums ${cls}`} style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 24, lineHeight: 1.15 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {monthChoices.map((m) => (
          <button
            key={m}
            onClick={() => onChangeMonth(m)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${m === month ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            {monthLabel(m)}
          </button>
        ))}
      </div>

      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <svg width="150" height="150" viewBox="0 0 150 150" className="shrink-0">
          <g transform="rotate(-90 75 75)">
            <circle cx="75" cy="75" r={R} fill="none" style={{ stroke: "var(--c-track)" }} strokeWidth="12" />
            {segs}
          </g>
          <text x="75" y="74" textAnchor="middle" style={{ ...NUM_FONT_STYLE, fontSize: 30, fontWeight: 500, fill: "var(--c-ink)" }}>{pct}%</text>
          <text x="75" y="95" textAnchor="middle" style={{ fontSize: 11, fill: "var(--c-muted)" }}>確定の目標達成率</text>
        </svg>
        <div className="flex w-full min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm text-slate-600">
              確定
              <b className="mx-1 tabular-nums text-emerald-700" style={{ ...NUM_FONT_STYLE, fontWeight: 600, fontSize: 24 }}>{manN(c.confirmedTotal)}</b>
              <span className="text-xs">万円</span>
              <span className="text-slate-400"> / 目標 {formatManYen(target)}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className={`text-sm font-semibold ${remain <= 0 ? "text-emerald-600" : "text-indigo-700"}`}>
                {target <= 0 ? "目標未設定" : remain <= 0 ? "目標達成" : `あと ${formatManYen(remain)}`}
              </span>
              <button onClick={onEditTarget} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
                <Target size={13} />
                目標を編集
              </button>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {tiles.map(([lb, v, dot, cls]) => (
              <div key={lb} className={`rounded-2xl px-3 py-2.5 ${cls}`}>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />
                  {lb}
                </div>
                <div className="tabular-nums" style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 22, lineHeight: 1.2, opacity: v === 0 ? 0.45 : 1 }}>
                  {manN(v)}
                  <span className="ml-0.5 text-[11px] font-semibold">万円</span>
                </div>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-slate-400">見込み金額（HOT＋WARM＋COOL）{formatManYen(hot + warm + cool)}</div>
        </div>
      </div>
    </div>
  );
}

function RemindersPanel({ projects, visits, onOpenDetail, onGoToVisits }) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const in7 = new Date();
  in7.setDate(in7.getDate() + 7);
  const in7Str = in7.toISOString().slice(0, 10);

  const overdue = projects.filter((p) => p.status === "won" && p.deliveryDueDate && p.deliveryDueDate < todayStr);
  const upcoming = projects.filter(
    (p) => p.status === "won" && p.deliveryDueDate && p.deliveryDueDate >= todayStr && p.deliveryDueDate <= in7Str
  );

  // 案件登録（登録日）から1週間以上経っても見積を提出していない案件を知らせる。
  const quoteOverdue = projects.filter((p) => {
    if (p.status !== "active" || p.quoteSubmitted) return false;
    const base = p.registeredDate || p.createdAt;
    if (!base) return false;
    const baseStr = base.length > 10 ? base.slice(0, 10) : base;
    const dueDate = new Date(baseStr);
    dueDate.setDate(dueDate.getDate() + 7);
    return dueDate.toISOString().slice(0, 10) <= todayStr;
  });

  const activeCompanies = Array.from(
    new Set(projects.filter((p) => p.status === "active" || p.status === "won").map((p) => p.clientName))
  );
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const staleCompanies = activeCompanies.filter((name) => {
    const companyVisits = visits.filter((v) => v.clientName === name);
    // 訪問記録が一度もない会社は「新規で追加したばかり」の可能性が高いため対象外にする。
    // あくまで「過去に訪問歴はあるが、3ヶ月以上間が空いている」会社だけを知らせる。
    if (companyVisits.length === 0) return false;
    const lastVisit = companyVisits.reduce((max, v) => (v.date > max ? v.date : max), companyVisits[0].date);
    return lastVisit < cutoffStr;
  });

  const total = overdue.length + upcoming.length + quoteOverdue.length + staleCompanies.length;
  if (dismissed || total === 0) return null;

  const DISPLAY_LIMIT = 3;
  const items = [
    ...overdue.map((p) => ({ kind: "overdue", key: p.id, p })),
    ...upcoming.map((p) => ({ kind: "upcoming", key: p.id, p })),
    ...quoteOverdue.map((p) => ({ kind: "quote_overdue", key: p.id, p })),
    ...staleCompanies.map((name) => ({ kind: "stale", key: name, name })),
  ];
  const visibleItems = expanded ? items : items.slice(0, DISPLAY_LIMIT);
  const restCount = total - visibleItems.length;

  return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
          <Bell size={16} />
          リマインド（{total}件）
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="rounded-md p-1 text-amber-500 hover:bg-amber-100"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {visibleItems.map((item) => {
          if (item.kind === "overdue") {
            return (
              <button
                key={item.key}
                onClick={() => onOpenDetail(item.p)}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm hover:bg-rose-50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-700">納品期限超過</span>
                  <span className="truncate">{item.p.clientName} / {item.p.name}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-rose-500">{item.p.deliveryDueDate}</span>
              </button>
            );
          }
          if (item.kind === "upcoming") {
            return (
              <button
                key={item.key}
                onClick={() => onOpenDetail(item.p)}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm hover:bg-amber-50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">納品予定間近</span>
                  <span className="truncate">{item.p.clientName} / {item.p.name}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-amber-600">{item.p.deliveryDueDate}</span>
              </button>
            );
          }
          if (item.kind === "quote_overdue") {
            return (
              <button
                key={item.key}
                onClick={() => onOpenDetail(item.p)}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm hover:bg-orange-50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700">見積未提出</span>
                  <span className="truncate">{item.p.clientName} / {item.p.name}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-orange-600">登録から1週間超</span>
              </button>
            );
          }
          return (
            <button
              key={item.key}
              onClick={onGoToVisits}
              className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm hover:bg-sky-50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700">訪問推奨</span>
                <span className="truncate">{item.name}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">3ヶ月以上未訪問</span>
            </button>
          );
        })}
      </div>
      {(restCount > 0 || expanded) && total > DISPLAY_LIMIT && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 w-full text-right text-xs font-medium text-amber-700 hover:underline"
        >
          {expanded ? "閉じる" : `ほか${restCount}件`}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 月別状況ページ                                                       */
/* ------------------------------------------------------------------ */

const MONTHLY_GRID_STYLE = { display: "grid", gridTemplateColumns: "1.5fr repeat(7, 1fr)", gap: "6px", alignItems: "center" };

function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

function useIsDesktop() {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 640px)").matches : true);
  const [v, setV] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const on = () => setV(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, []);
  return v;
}


function MonthlyPage({ projects, stocks = [], onOpenDetail, monthlyTarget = 0, assignees = [], scope = "all", onScopeChange }) {
  const per = Math.round(monthlyTarget / Math.max(1, assignees.length));
  const isAll = scope === "all" || !assignees.includes(scope);
  const tabs = [{ key: "all", label: "全体" }, ...assignees.map((a) => ({ key: a, label: a }))];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {tabs.map((t) => {
          const active = isAll ? t.key === "all" : t.key === scope;
          return (
            <button
              key={t.key}
              onClick={() => onScopeChange && onScopeChange(t.key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            >
              {t.key !== "all" && <Avatar name={t.label} size={20} />}
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-slate-700">{isAll ? "月別売り上げ（全体）" : `月別売り上げ（${scope}）`}</h2>
        <span className="text-xs text-slate-400">
          月間目標 {formatManYen(isAll ? monthlyTarget : per)}{!isAll && "（全体目標を担当人数で割った額）"}
        </span>
      </div>
      {isAll ? (
        <MonthlyTable key="all" projects={projects} stocks={stocks} onOpenDetail={onOpenDetail} target={monthlyTarget} />
      ) : (
        <MonthlyTable
          key={scope}
          projects={projects.filter((p) => p.assignee === scope)}
          stocks={stocks.filter((st) => st.assignee === scope)}
          onOpenDetail={onOpenDetail}
          target={per}
        />
      )}
    </div>
  );
}

function MonthlyTable({ projects, stocks = [], onOpenDetail, target = 0 }) {
  const [openMonth, setOpenMonth] = useState(null);
  const isDesktop = useIsDesktop();
  const presentMonths = projects.map((p) => p.scheduledMonth);
  const months = Array.from(new Set([...monthKeysRange(-1, 4), ...presentMonths])).sort();
  const thisMonth = currentMonthKey();
  const rows = months.map((m) => {
    const list = projects.filter((p) => p.scheduledMonth === m);
    const c = computeCounts(list);
    const sum = (arr) => arr.reduce((a, p) => a + (p.estimatedAmount || 0), 0);
    const open = list.filter((p) => p.status === "active");
    const stockList = stocks.filter((st) => stockActiveIn(st, m));
    const stockTotal = stockList.reduce((a, st) => a + (st.monthlyAmount || 0), 0);
    const forecast = c.confirmedTotal + sum(open);
    return {
      month: m,
      list,
      stockList,
      caseCount: c.total,
      won: c.won,
      lost: c.lost,
      rate: c.rate,
      confirmed: c.confirmedTotal,
      hot: sum(open.filter((p) => p.confidence === 3)),
      warm: sum(open.filter((p) => p.confidence === 2)),
      cool: sum(open.filter((p) => p.confidence === 1)),
      stock: stockTotal,
      grand: forecast,
      remain: target - c.confirmedTotal,
    };
  });

  const LIST = [
    { key: "confirmed", label: "確定金額", dot: "#059669", cls: "bg-emerald-50 text-emerald-700" },
    { key: "hot", label: "HOT", dot: "#e11d48", cls: "bg-rose-50 text-rose-600" },
    { key: "warm", label: "WARM", dot: "#d97706", cls: "bg-amber-50 text-amber-600" },
    { key: "cool", label: "COOL", dot: "#0284c7", cls: "bg-sky-50 text-sky-600" },
    { key: "stock", label: "ストック", dot: "#7c3aed", cls: "bg-violet-50 text-violet-600" },
  ];
  const NUM_FONT = { fontFamily: "var(--font-num)" };
  const manN = (n) => Math.round(n / 10000).toLocaleString("ja-JP");
  const width = useWindowWidth();
  const colCount = width < 640 ? 1 : width < 1000 ? 2 : 3;

  function Detail({ r }) {
    return (
      <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 p-4">
        <div className="text-xs text-slate-500">
          案件 {r.caseCount}件／受注 {r.won}・ロスト {r.lost}／受注率 {r.rate ?? "—"}{r.rate !== null ? "%" : ""}
        </div>
        {r.list.length === 0 && <div className="text-sm text-slate-400">この月の案件はありません</div>}
        {r.list.map((p) => {
          const amount = p.status === "won" || p.status === "delivered" ? p.confirmedAmount ?? p.estimatedAmount : p.estimatedAmount;
          return (
            <button
              key={p.id}
              onClick={() => onOpenDetail && onOpenDetail(p)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-indigo-300"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{p.clientName}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span className="truncate">{p.name}</span>
                  <span className="text-slate-400">{p.assignee}</span>
                  {p.status === "active" && <ConfidenceStars value={p.confidence} />}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-medium tabular-nums text-slate-700">{formatManYen(amount)}</span>
                <StatusBadge status={p.status} />
              </div>
            </button>
          );
        })}
        {r.stockList.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-violet-600">
              <Repeat size={12} /> ストック売上 {formatManYen(r.stock)}
            </div>
            <div className="flex flex-col gap-1">
              {r.stockList.map((st) => (
                <div key={st.id} className="flex justify-between rounded-lg border border-violet-100 bg-white px-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-slate-600">{st.clientName}／{st.name}</span>
                  <span className="shrink-0 pl-2 tabular-nums text-slate-700">{formatYen(st.monthlyAmount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function Card({ r }) {
    const isOpen = openMonth === r.month;
    const renderLine = (it) => (
      <div key={it.key} className={`flex items-center justify-between rounded-xl px-3 py-2 ${it.cls}`}>
        <span className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: it.dot }} />
          {it.label}
        </span>
        <span className="tabular-nums" style={{ ...NUM_FONT, fontWeight: 600, fontSize: 18, opacity: r[it.key] === 0 ? 0.4 : 1 }}>
          {manN(r[it.key])}<span className="ml-0.5 text-[11px]">万円</span>
        </span>
      </div>
    );
    const isNow = r.month === thisMonth;
    const decided = r.won + r.lost;
    const winW = decided ? (r.won / decided) * 100 : 0;
    const done = target > 0 && r.remain <= 0;
    const cardStyle = isNow
      ? { background: "linear-gradient(var(--c-card),var(--c-card)) padding-box, linear-gradient(120deg,var(--c-now-a),var(--c-now-b)) border-box", border: "2px solid transparent" }
      : isOpen
      ? { border: "1px solid #4f46e5", boxShadow: "0 0 0 3px #e0e7ff" }
      : { border: "1px solid var(--c-border-soft)", boxShadow: "0 1px 2px rgba(15,23,42,.04), 0 10px 28px -16px rgba(15,23,42,.18)" };
    return (
      <button
        onClick={() => setOpenMonth(isOpen ? null : r.month)}
        aria-expanded={isOpen}
        className="app-card flex w-full flex-col gap-3.5 bg-white p-5 text-left"
        style={{ borderRadius: 22, ...cardStyle }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[13px] text-slate-500" style={{ ...NUM_FONT, letterSpacing: ".06em" }}>
              {r.month.slice(0, 4)}年
              {isNow && <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[11px] text-white" style={{ letterSpacing: 0 }}>今月</span>}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-slate-900" style={{ ...NUM_FONT, fontWeight: 300, fontSize: 48, lineHeight: 1, letterSpacing: "-.03em" }}>
                {parseInt(r.month.slice(5), 10)}
              </span>
              <span className="text-base font-semibold text-slate-700">月</span>
            </div>
          </div>
          <div className="text-center" style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", columnGap: 14, rowGap: 2 }}>
            {[
              ["案件", r.caseCount, "text-slate-800"],
              ["受注", r.won, "text-emerald-600"],
              ["ロスト", r.lost, "text-rose-600"],
            ].map(([lb, v, c]) => (
              <div key={lb}>
                <div className="text-[11px] text-slate-500">{lb}</div>
                <div className={`tabular-nums ${c}`} style={{ ...NUM_FONT, fontWeight: 500, fontSize: 24, lineHeight: 1.1 }}>{v}</div>
              </div>
            ))}
            <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
              <div className="overflow-hidden rounded-full" style={{ height: 5, background: "var(--c-lost-track)" }}>
                <div style={{ height: "100%", width: `${winW}%`, background: "#059669" }} />
              </div>
              <div className="mt-1 text-right text-[11px] text-slate-500">受注率 {r.rate ?? "—"}{r.rate !== null ? "%" : ""}</div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div className="text-white" style={{ background: "var(--c-hero)", borderRadius: 16, padding: "12px 14px" }}>
            <div className="text-xs" style={{ color: "rgba(255,255,255,.72)" }}>総額（確定＋見込み）</div>
            <div className="mt-1 tabular-nums" style={{ ...NUM_FONT, fontWeight: 500, fontSize: 26, lineHeight: 1.1 }}>
              {manN(r.grand)}<span className="ml-0.5 text-[13px] font-semibold">万円</span>
            </div>
          </div>
          <div className={done ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"} style={{ borderRadius: 16, padding: "12px 14px" }}>
            <div className="text-xs">目標まであと</div>
            <div className="mt-1 tabular-nums" style={{ ...NUM_FONT, fontWeight: 500, fontSize: 26, lineHeight: 1.1 }}>
              {!target ? "—" : done ? "達成" : <>{manN(r.remain)}<span className="ml-0.5 text-[13px] font-semibold">万円</span></>}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          {LIST.filter((it) => it.key === "confirmed").map(renderLine)}
          <div className="rounded-2xl border border-slate-200 p-1.5">
            <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
              <span className="text-xs font-medium text-slate-500">見込み金額（HOT＋WARM＋COOL）</span>
              <span className="tabular-nums text-slate-800" style={{ ...NUM_FONT, fontWeight: 600, fontSize: 16 }}>
                {manN(r.hot + r.warm + r.cool)}<span className="ml-0.5 text-[11px]">万円</span>
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {LIST.filter((it) => ["hot", "warm", "cool"].includes(it.key)).map(renderLine)}
            </div>
          </div>
          {LIST.filter((it) => it.key === "stock").map(renderLine)}
        </div>
        <div className="text-center text-xs text-slate-500">{isOpen ? "▴ 案件を閉じる" : "▾ 案件を見る"}</div>
      </button>
    );
  }

  const items = [];
  rows.forEach((r, i) => {
    items.push(<Card key={r.month} r={r} />);
    const endOfRow = (i + 1) % colCount === 0 || i === rows.length - 1;
    if (endOfRow && openMonth) {
      const start = i - (i % colCount);
      const openRow = rows.slice(start, i + 1).find((x) => x.month === openMonth);
      if (openRow) {
        items.push(
          <div key={`panel-${openMonth}`} className="overflow-hidden bg-white" style={{ gridColumn: "1 / -1", borderRadius: 22, border: "1px solid var(--c-border-soft)" }}>
            <div className="px-5 pt-4 text-[15px] font-semibold text-slate-800">{monthLabel(openRow.month)}の案件</div>
            <Detail r={openRow} />
          </div>
        );
      }
    }
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400">カードをクリックすると、その月の案件が開きます。案件をクリックすると詳細を確認できます。</p>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`, gap: colCount === 1 ? 12 : 16 }}>
        {items}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ストック売上ページ（AI・SNS・保守管理などの月額売上）                   */
/* ------------------------------------------------------------------ */

function StockForm({ initial, companies, assignees, onSubmit, onCancel }) {
  const [form, setForm] = useState(
    initial || {
      clientName: "",
      name: "",
      category: STOCK_CATEGORIES[0],
      monthlyAmount: "",
      startMonth: currentMonthKey(),
      endMonth: "",
      assignee: assignees[0] || "",
      memo: "",
    }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.clientName.trim() && form.name.trim() && Number(form.monthlyAmount) > 0 && form.startMonth;
  const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-xs font-medium text-slate-500">会社名 *</label>
        <input list="stock-companies" value={form.clientName} onChange={(e) => set("clientName", e.target.value)} className={inputCls} />
        <datalist id="stock-companies">{companies.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">サービス名 *</label>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="例：SNS運用代行" className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-slate-500">区分</label>
          <select value={form.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>
            {STOCK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">月額（円）*</label>
          <input type="number" inputMode="numeric" value={form.monthlyAmount} onChange={(e) => set("monthlyAmount", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">開始月 *</label>
          <input type="month" value={form.startMonth} onChange={(e) => set("startMonth", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">終了月（継続中は空欄）</label>
          <input type="month" value={form.endMonth || ""} onChange={(e) => set("endMonth", e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">自社担当者</label>
        <select value={form.assignee} onChange={(e) => set("assignee", e.target.value)} className={inputCls}>
          {assignees.map((a) => <option key={a}>{a}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">メモ</label>
        <textarea rows={2} value={form.memo} onChange={(e) => set("memo", e.target.value)} className={inputCls} />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">キャンセル</button>
        <button
          disabled={!valid}
          onClick={() => onSubmit({ ...form, monthlyAmount: Number(form.monthlyAmount), endMonth: form.endMonth || null })}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          保存
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ストック売上の推移グラフ（金額ラベル・区分の表示切替・アニメーション付き） */
/* ------------------------------------------------------------------ */

function StockTrendChart({ stocks, catColors }) {
  const [hidden, setHidden] = useState([]);
  const narrow = useWindowWidth() < 640;
  const [range, setRange] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? 6 : 12));
  const thisMonth = currentMonthKey();
  const keys = range === 12 ? monthKeysRange(-5, 6) : monthKeysRange(-2, 3);
  const visibleCats = STOCK_CATEGORIES.filter((c) => !hidden.includes(c));
  const sumFor = (m, cats) =>
    stocks.filter((st) => cats.includes(st.category) && stockActiveIn(st, m)).reduce((a, st) => a + st.monthlyAmount, 0);

  const data = keys.map((m) => {
    const row = { key: m, month: `${parseInt(m.slice(5), 10)}月`, isNow: m === thisMonth, isFuture: m > thisMonth };
    STOCK_CATEGORIES.forEach((c) => {
      row[c] = hidden.includes(c) ? 0 : sumFor(m, [c]) / 10000;
    });
    row.total = visibleCats.reduce((a, c) => a + row[c], 0);
    return row;
  });

  const nowTotal = sumFor(thisMonth, visibleCats);
  const prevTotal = sumFor(addMonths(thisMonth, -1), visibleCats);
  const futureTotal = sumFor(addMonths(thisMonth, range === 12 ? 6 : 3), visibleCats);
  const diff = nowTotal - prevTotal;
  const lastCat = [...visibleCats].reverse().find((c) => data.some((r) => r[c] > 0)) || visibleCats[visibleCats.length - 1];
  const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
  const toggle = (c) => setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c]));
  const animKey = `${range}-${hidden.join(",")}`;

  function TotalLabel({ x, y, width, index }) {
    const row = data[index];
    if (!row || row.total <= 0) return null;
    if (narrow && range === 12 && !row.isNow) return null; // スマホの12か月表示は今月だけ数字を出す（重なり防止）
    return (
      <g>
        {row.isNow && (
          <g transform={`translate(${x + width / 2}, ${y - 30})`}>
            <rect x={-18} y={-9} width={36} height={16} rx={8} fill="#4f46e5" />
            <text x={0} y={3} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: "#fff" }}>今月</text>
          </g>
        )}
        <text
          x={x + width / 2}
          y={y - 8}
          textAnchor="middle"
          style={{ fontSize: narrow ? (row.isNow ? 12 : 10) : row.isNow ? 13 : 11, fontWeight: row.isNow ? 700 : 600, fill: "var(--c-ink)", fontFamily: "var(--font-num)" }}
        >
          {fmt(row.total)}
        </text>
      </g>
    );
  }

  function TrendTooltip({ active, payload }) {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0].payload;
    return (
      <div className="min-w-[170px] rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-800">{monthLabel(row.key)}</span>
          {row.isNow ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">今月</span> : row.isFuture ? <span className="text-[10px] text-slate-400">予定</span> : null}
        </div>
        {visibleCats.filter((c) => row[c] > 0).map((c) => (
          <div key={c} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-slate-600"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: catColors[c] }} />{c}</span>
            <span className="tabular-nums font-medium text-slate-800">{fmt(row[c])}万円</span>
          </div>
        ))}
        <div className="mt-1.5 flex items-center justify-between border-t border-slate-100 pt-1.5 font-semibold text-slate-900">
          <span>合計</span>
          <span className="tabular-nums">{fmt(row.total)}万円</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-800">ストック売上の推移</div>
          <div className="mt-0.5 text-xs text-slate-400">棒の上の数字は月の合計（万円）。今月より右は契約済みの予定です。</div>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {[[12, "12か月"], [6, "6か月"]].map(([v, lb]) => (
            <button key={v} onClick={() => setRange(v)} className={`rounded-lg px-3 py-1 text-xs font-medium ${range === v ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              {lb}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
          <div className="text-[11px] text-slate-500">今月</div>
          <div className="tabular-nums text-slate-900" style={{ fontFamily: "var(--font-num)", fontWeight: 600, fontSize: 22, lineHeight: 1.2 }}>
            {fmt(nowTotal / 10000)}<span className="ml-0.5 text-xs">万円</span>
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
          <div className="text-[11px] text-slate-500">先月比</div>
          <div className={`tabular-nums ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-700"}`} style={{ fontFamily: "var(--font-num)", fontWeight: 600, fontSize: 22, lineHeight: 1.2 }}>
            {diff > 0 ? "+" : ""}{fmt(diff / 10000)}<span className="ml-0.5 text-xs">万円</span>
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
          <div className="text-[11px] text-slate-500">{range === 12 ? "6" : "3"}か月後（予定）</div>
          <div className="tabular-nums text-slate-900" style={{ fontFamily: "var(--font-num)", fontWeight: 600, fontSize: 22, lineHeight: 1.2 }}>
            {fmt(futureTotal / 10000)}<span className="ml-0.5 text-xs">万円</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {STOCK_CATEGORIES.map((c) => {
          const off = hidden.includes(c);
          const amt = sumFor(thisMonth, [c]);
          return (
            <button
              key={c}
              onClick={() => toggle(c)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${off ? "border-slate-200 text-slate-400" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
              title={off ? "クリックで表示" : "クリックで非表示"}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: off ? "transparent" : catColors[c], border: `2px solid ${catColors[c]}` }} />
              <span className={off ? "line-through" : ""}>{c}</span>
              <span className="tabular-nums text-slate-400">{fmt(amt / 10000)}万</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart key={animKey} data={data} margin={{ top: 40, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" strokeOpacity={0.6} />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              interval={0}
              tick={({ x, y, payload, index }) => {
                const row = data[index];
                return (
                  <text x={x} y={y + 14} textAnchor="middle" style={{ fontSize: 11, fontWeight: row && row.isNow ? 700 : 400, fill: row && row.isNow ? "var(--c-ink)" : "#94A3B8" }}>
                    {payload.value}
                  </text>
                );
              }}
            />
            <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={34} />
            <Tooltip content={<TrendTooltip />} cursor={{ fill: "rgba(148,163,184,.12)", radius: 8 }} />
            {visibleCats.map((c, i) => (
              <Bar
                key={c}
                dataKey={c}
                stackId="a"
                fill={catColors[c]}
                radius={c === lastCat ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                isAnimationActive
                animationBegin={i * 140}
                animationDuration={700}
                animationEasing="ease-out"
              >
                {data.map((row) => (
                  <Cell key={row.key} fillOpacity={row.isFuture ? 0.45 : 1} />
                ))}
                {c === lastCat && <LabelList content={<TotalLabel />} />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StockPage({ stocks, companies, assignees, onAdd, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(null); // null | "new" | stock
  const [catFilter, setCatFilter] = useState("all");
  const thisMonth = currentMonthKey();
  const activeNow = stocks.filter((st) => stockActiveIn(st, thisMonth));
  const mrr = activeNow.reduce((a, st) => a + st.monthlyAmount, 0);
  const byCat = STOCK_CATEGORIES.map((c) => {
    const list = activeNow.filter((st) => st.category === c);
    return { category: c, count: list.length, amount: list.reduce((a, st) => a + st.monthlyAmount, 0) };
  }).filter((x) => x.count > 0);
  const trend = monthKeysRange(-5, 6).map((m) => {
    const row = { month: `${parseInt(m.slice(5), 10)}月` };
    STOCK_CATEGORIES.forEach((c) => {
      row[c] = stocks.filter((st) => st.category === c && stockActiveIn(st, m)).reduce((a, st) => a + st.monthlyAmount, 0) / 10000;
    });
    return row;
  });
  const catColors = { AI: "#6366f1", SNS: "#ec4899", 保守管理: "#10b981", "サーバー・ドメイン": "#f59e0b", その他: "#94a3b8" };
  const shown = stocks
    .filter((st) => catFilter === "all" || st.category === catFilter)
    .sort((a, b) => Number(stockActiveIn(b, thisMonth)) - Number(stockActiveIn(a, thisMonth)) || b.monthlyAmount - a.monthlyAmount);

  function statusOf(st) {
    if (st.startMonth > thisMonth) return { label: "開始前", cls: "bg-sky-50 text-sky-700" };
    if (st.endMonth && st.endMonth < thisMonth) return { label: "終了", cls: "bg-slate-100 text-slate-500" };
    return { label: "継続中", cls: "bg-emerald-50 text-emerald-700" };
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
          <div className="text-xs text-slate-500">今月のストック売上</div>
          <div className="mt-1 text-xl font-semibold text-violet-700">{formatYen(mrr)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">年換算</div>
          <div className="mt-1 text-xl font-semibold text-slate-800">{formatManYen(mrr * 12)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">継続契約数</div>
          <div className="mt-1 text-xl font-semibold text-slate-800">{activeNow.length}件</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">契約社数</div>
          <div className="mt-1 text-xl font-semibold text-slate-800">{new Set(activeNow.map((s) => s.clientName)).size}社</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {byCat.map((c) => (
          <div key={c.category} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: catColors[c.category] }} />
              {c.category}
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-800">{formatYen(c.amount)}<span className="text-xs font-normal text-slate-400"> /月</span></div>
            <div className="text-xs text-slate-400">{c.count}件</div>
          </div>
        ))}
      </div>

      <StockTrendChart stocks={stocks} catColors={catColors} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {["all", ...STOCK_CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${catFilter === c ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
            >
              {c === "all" ? "全て" : c}
            </button>
          ))}
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          <Plus size={16} />ストックを追加
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((st) => {
          const sts = statusOf(st);
          return (
            <div key={st.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">{st.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${sts.cls}`}>{sts.label}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-400">
                  <span>{st.clientName}</span>
                  <span>{st.category}</span>
                  <span>{st.assignee}</span>
                  <span>{monthLabel(st.startMonth)}〜{st.endMonth ? monthLabel(st.endMonth) : ""}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <div className="pr-2 text-right text-sm font-semibold tabular-nums text-violet-700">{formatYen(st.monthlyAmount)}<span className="text-[10px] font-normal text-slate-400">/月</span></div>
                <button onClick={() => setEditing(st)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><Pencil size={15} /></button>
                <button onClick={() => onDelete(st)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-500"><Trash2 size={15} /></button>
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">該当するストックはありません</div>}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "ストックを追加" : "ストックを編集"}>
        {editing && (
          <StockForm
            initial={editing === "new" ? null : editing}
            companies={companies}
            assignees={assignees}
            onCancel={() => setEditing(null)}
            onSubmit={(form) => {
              if (editing === "new") onAdd(form);
              else onUpdate(editing.id, form);
              setEditing(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 訪問記録                                                             */
/* ------------------------------------------------------------------ */

function VisitForm({ companies, projects = [], initialClientName = "", onSubmit, onCancel }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    clientName: initialClientName,
    assignee: ASSIGNEES[0],
    purpose: "",
    memo: "",
    relatedProjectId: "",
  });
  const valid = form.date && form.clientName.trim();
  const relatedOptions = projects.filter((p) => p.clientName === form.clientName && !p.archived);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-slate-500">訪問日 *</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">担当者</label>
          <div className="mt-1 flex gap-2">
            {ASSIGNEES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setForm({ ...form, assignee: a })}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                  form.assignee === a
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">訪問先（会社名） *</label>
        <input
          list="visit-company-list"
          value={form.clientName}
          onChange={(e) => setForm({ ...form, clientName: e.target.value, relatedProjectId: "" })}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          placeholder="例）株式会社◯◯"
        />
        <datalist id="visit-company-list">
          {companies.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      {relatedOptions.length > 0 && (
        <div>
          <label className="text-xs font-medium text-slate-500">関連する案件（任意）</label>
          <select
            value={form.relatedProjectId}
            onChange={(e) => setForm({ ...form, relatedProjectId: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">関連付けない</option>
            {relatedOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{STATUS_LABEL[p.status]}）
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="text-xs font-medium text-slate-500">訪問目的（任意）</label>
        <input
          value={form.purpose}
          onChange={(e) => setForm({ ...form, purpose: e.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          placeholder="例）提案・見積提示"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">訪問メモ（任意）</label>
        <textarea
          value={form.memo}
          onChange={(e) => setForm({ ...form, memo: e.target.value })}
          rows={4}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          placeholder="訪問内容・先方の反応など"
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          キャンセル
        </button>
        <button
          disabled={!valid}
          onClick={() => onSubmit({ ...form, relatedProjectId: form.relatedProjectId || null })}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          保存する
        </button>
      </div>
    </div>
  );
}

// 訪問記録：一覧表（月ごとに区切り、行クリックでメモ全文・関連案件を展開）
function VisitTable({ visits, projects, onOpenDetail, onDelete, onOpenCompany }) {
  const [openId, setOpenId] = useState(null);
  const width = useWindowWidth();
  const wide = width >= 900;
  const cols = { display: "grid", gridTemplateColumns: "92px minmax(0,1.3fr) 120px 84px minmax(0,2fr) 28px", gap: 12, alignItems: "center" };
  const sorted = [...visits].sort((a, b) => (a.date < b.date ? 1 : -1));
  const groups = [];
  sorted.forEach((v) => {
    const key = v.date.slice(0, 7);
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, items: [] }));
    g.items.push(v);
  });
  if (sorted.length === 0) {
    return <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">条件に合う訪問記録はありません</div>;
  }
  const dayColor = (d) => (d === 0 ? "text-rose-500" : d === 6 ? "text-sky-600" : "text-slate-400");
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {wide && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500" style={cols}>
          <div>訪問日</div>
          <div>会社</div>
          <div>目的</div>
          <div>担当</div>
          <div>メモ</div>
          <div />
        </div>
      )}
      {groups.map((g) => (
        <div key={g.key}>
          <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs font-semibold text-slate-700">
            {monthLabel(g.key)}
            <span className="ml-1.5 font-normal text-slate-400">{g.items.length}件</span>
          </div>
          {g.items.map((v) => {
            const d = new Date(`${v.date}T00:00:00`);
            const isOpen = openId === v.id;
            const related = v.relatedProjectId ? projects.find((p) => p.id === v.relatedProjectId) : null;
            const dateCell = (
              <div className="tabular-nums text-sm text-slate-600">
                <b className="font-semibold text-slate-900">{d.getMonth() + 1}/{d.getDate()}</b>
                <span className={`ml-1 text-xs ${dayColor(d.getDay())}`}>({WEEKDAYS[d.getDay()]})</span>
              </div>
            );
            return (
              <div key={v.id} className="border-b border-slate-100 last:border-b-0">
                <button
                  onClick={() => setOpenId(isOpen ? null : v.id)}
                  className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${isOpen ? "bg-slate-50" : ""}`}
                  style={wide ? cols : undefined}
                >
                  {wide ? (
                    <>
                      {dateCell}
                      <div className="truncate text-sm font-semibold text-slate-800">{v.clientName}</div>
                      <div><PurposeTag purpose={v.purpose} /></div>
                      <div className="flex items-center gap-1.5 text-[13px] text-slate-600">
                        <Avatar name={v.assignee} size={20} />
                        {v.assignee}
                      </div>
                      <div className="truncate text-sm text-slate-600">{v.memo}</div>
                      <div className="text-center text-xs text-slate-300">{isOpen ? "▴" : "▾"}</div>
                    </>
                  ) : (
                    <div className="flex gap-3">
                      <div className="w-12 shrink-0 text-center">
                        <div className="tabular-nums text-sm font-semibold text-slate-900">{d.getMonth() + 1}/{d.getDate()}</div>
                        <div className={`text-[11px] ${dayColor(d.getDay())}`}>({WEEKDAYS[d.getDay()]})</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-800">{v.clientName}</div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">{v.memo}</div>
                      </div>
                      <div className="shrink-0 pt-0.5 text-xs text-slate-300">{isOpen ? "▴" : "▾"}</div>
                    </div>
                  )}
                </button>
                {isOpen && (
                  <div className="bg-slate-50 px-4 pb-4" style={{ paddingLeft: wide ? 120 : 76 }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <PurposeTag purpose={v.purpose} />
                      <span className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Avatar name={v.assignee} size={18} />
                        担当 {v.assignee}
                      </span>
                      <span className="text-xs text-slate-400">{fmtDate(v.date)}</span>
                    </div>
                    {v.memo && <p className="mt-2 text-sm leading-relaxed text-slate-700">{v.memo}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {related && (
                        <button
                          onClick={() => onOpenDetail && onOpenDetail(related)}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                        >
                          <Link2 size={12} className="shrink-0" />
                          <span className="truncate">関連案件：{related.name}</span>
                        </button>
                      )}
                      {onOpenCompany && (
                        <button
                          onClick={() => onOpenCompany(v.clientName)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                        >
                          <Building2 size={12} />
                          会社の詳細を見る
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(v)}
                          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                        >
                          <Trash2 size={13} />
                          削除
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// 訪問記録：カレンダー表示（日付クリックでその日の記録を表示）
function VisitCalendar({ visits, projects, onOpenDetail, onDelete, onOpenCompany }) {
  const today = new Date();
  const [month, setMonth] = useState(() => {
    const latest = [...visits].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return latest && latest.date.slice(0, 7) > currentMonthKey() ? latest.date.slice(0, 7) : currentMonthKey();
  });
  const [selDay, setSelDay] = useState(null);
  const width = useWindowWidth();
  const wide = width >= 900;
  const small = width < 600;
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const monthVisits = visits.filter((v) => v.date.startsWith(month)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const list = selDay ? monthVisits.filter((v) => v.date === selDay) : monthVisits;
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const move = (n) => {
    setMonth(addMonths(month, n));
    setSelDay(null);
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: wide ? "minmax(0,1.35fr) minmax(0,1fr)" : "minmax(0,1fr)", gap: 16, alignItems: "start" }}>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-base font-semibold text-slate-900">
            {y}年{m}月<span className="ml-2 text-xs font-normal text-slate-400">{monthVisits.length}件</span>
          </div>
          <div className="flex gap-1">
            <button onClick={() => move(-1)} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" aria-label="前の月"><ChevronLeft size={16} /></button>
            <button onClick={() => { setMonth(currentMonthKey()); setSelDay(null); }} className="rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500 hover:bg-slate-50">今月</button>
            <button onClick={() => move(1)} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" aria-label="次の月"><ChevronRight size={16} /></button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 4 }}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`py-1 text-center text-[11px] ${i === 0 ? "text-rose-500" : i === 6 ? "text-sky-600" : "text-slate-400"}`}>{w}</div>
          ))}
          {cells.map((key, i) => {
            if (!key) return <div key={`e${i}`} />;
            const evs = monthVisits.filter((v) => v.date === key);
            const isSel = selDay === key;
            return (
              <button
                key={key}
                onClick={() => setSelDay(isSel ? null : key)}
                className={`flex min-w-0 flex-col gap-0.5 rounded-lg border p-1 text-left ${
                  isSel ? "border-indigo-500 bg-indigo-50" : evs.length ? "border-slate-200 bg-white hover:border-indigo-300" : "border-slate-100 bg-slate-50/50"
                }`}
                style={{ minHeight: small ? 50 : 76 }}
              >
                <span className={`self-start rounded-full px-1.5 text-xs tabular-nums ${key === todayKey ? "bg-slate-900 text-white" : "text-slate-600"}`}>
                  {Number(key.slice(8))}
                </span>
                {evs.map((v) => {
                  const st = PURPOSE_STYLES[v.purpose] || { bg: "var(--c-track)", fg: "#475569" };
                  return small ? (
                    <span key={v.id} className="block h-1.5 rounded-full" style={{ background: st.fg }} />
                  ) : (
                    <span key={v.id} className="app-tag truncate rounded px-1 py-0.5 text-[10.5px] font-medium" style={{ background: st.bg, color: st.fg, "--tag-fg": st.fg }}>
                      {companyDisplayName(v.clientName)}
                    </span>
                  );
                })}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline gap-2 px-1">
          <span className="text-sm font-semibold text-slate-800">
            {selDay ? `${Number(selDay.slice(5, 7))}月${Number(selDay.slice(8))}日（${WEEKDAYS[new Date(`${selDay}T00:00:00`).getDay()]}）の訪問` : `${m}月の訪問`}
          </span>
          <span className="text-xs text-slate-400">{list.length}件</span>
          {selDay && (
            <button onClick={() => setSelDay(null)} className="text-xs font-medium text-indigo-600 hover:underline">月全体を表示</button>
          )}
        </div>
        {list.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
            {selDay ? "この日の訪問記録はありません" : "この月の訪問記録はありません"}
          </div>
        )}
        {list.map((v) => {
          const related = v.relatedProjectId ? projects.find((p) => p.id === v.relatedProjectId) : null;
          const d = new Date(`${v.date}T00:00:00`);
          return (
            <div key={v.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => onOpenCompany && onOpenCompany(v.clientName)} className="flex min-w-0 items-center gap-2 hover:text-indigo-600">
                  <Avatar name={v.clientName} size={24} />
                  <span className="truncate text-sm font-semibold text-slate-800">{v.clientName}</span>
                </button>
                {onDelete && (
                  <button onClick={() => onDelete(v)} className="shrink-0 rounded-lg p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500" title="削除">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold tabular-nums text-slate-700">{fmtDate(v.date)}（{WEEKDAYS[d.getDay()]}）</span>
                <PurposeTag purpose={v.purpose} />
                <span className="flex items-center gap-1"><Avatar name={v.assignee} size={18} />{v.assignee}</span>
              </div>
              {v.memo && <p className="mt-2 text-sm leading-relaxed text-slate-700">{v.memo}</p>}
              {related && (
                <button
                  onClick={() => onOpenDetail && onOpenDetail(related)}
                  className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  <Link2 size={12} className="shrink-0" />
                  <span className="truncate">関連案件：{related.name}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VisitsPage({ visits, companies, projects, onAdd, onDelete, onOpenDetail, onOpenCompany }) {
  const [showAdd, setShowAdd] = useState(false);
  const [mode, setMode] = useState("list");
  const [who, setWho] = useState("全員");
  const [purpose, setPurpose] = useState("全て");
  const [search, setSearch] = useState("");
  const thisMonth = currentMonthKey();
  const lastMonth = addMonths(thisMonth, -1);
  const assignees = Array.from(new Set(visits.map((v) => v.assignee).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja"));
  const purposes = Array.from(new Set(visits.map((v) => v.purpose).filter(Boolean)));
  const q = search.trim().toLowerCase();
  const filtered = visits.filter((v) => {
    if (who !== "全員" && v.assignee !== who) return false;
    if (purpose !== "全て" && v.purpose !== purpose) return false;
    if (q && !`${v.clientName} ${v.memo || ""} ${v.purpose || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const thisCount = visits.filter((v) => v.date.startsWith(thisMonth)).length;
  const lastCount = visits.filter((v) => v.date.startsWith(lastMonth)).length;
  const thisCompanies = new Set(visits.filter((v) => v.date.startsWith(thisMonth)).map((v) => v.clientName)).size;
  const byAssignee = assignees.map((a) => ({ name: a, count: visits.filter((v) => v.assignee === a && v.date.startsWith(thisMonth)).length }));
  const diff = thisCount - lastCount;

  const chip = (active) =>
    `rounded-full px-3 py-1 text-xs font-medium ${active ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="今月の訪問" value={thisCount} unit="件" sub={`先月 ${lastCount}件（${diff >= 0 ? "+" : ""}${diff}）`} tone="text-indigo-600" />
        <StatTile label="今月訪問した会社" value={thisCompanies} unit="社" />
        <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">今月の担当別訪問件数</div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {byAssignee.map((a) => (
              <div key={a.name} className="flex items-center gap-2">
                <Avatar name={a.name} size={26} />
                <span className="text-sm text-slate-600">{a.name}</span>
                <span className="tabular-nums text-slate-900" style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 20 }}>{a.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="会社名・メモで検索"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none"
            />
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus size={16} />
            訪問記録を追加
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-slate-400">担当</span>
          {["全員", ...assignees].map((a) => (
            <button key={a} onClick={() => setWho(a)} className={chip(who === a)}>{a}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-slate-400">目的</span>
          {["全て", ...purposes].map((x) => (
            <button key={x} onClick={() => setPurpose(x)} className={chip(purpose === x)}>{x}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-400">
          {filtered.length}件{mode === "list" ? "・行をクリックするとメモ全文と関連案件が開きます" : "・日付をクリックするとその日の記録が表示されます"}
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {[
            ["list", "一覧", FileText],
            ["calendar", "カレンダー", CalendarDays],
          ].map(([k, lb, Icon]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${mode === k ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <Icon size={14} />
              {lb}
            </button>
          ))}
        </div>
      </div>

      {mode === "list" ? (
        <VisitTable visits={filtered} projects={projects} onOpenDetail={onOpenDetail} onDelete={onDelete} onOpenCompany={onOpenCompany} />
      ) : (
        <VisitCalendar visits={filtered} projects={projects} onOpenDetail={onOpenDetail} onDelete={onDelete} onOpenCompany={onOpenCompany} />
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="訪問記録を追加">
        <VisitForm
          companies={companies}
          projects={projects}
          onSubmit={(f) => {
            onAdd(f);
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 参考見積りページ                                                     */
/* ------------------------------------------------------------------ */

function ReferenceEstimatesPage({ referenceProjects, onPromote, onEdit, onDelete, onAdd }) {
  const total = referenceProjects.reduce((a, p) => a + (Number(p.estimatedAmount) || 0), 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl text-sm leading-relaxed text-slate-500">
          まだ受注予定に組み込まれていない、社内検討用の参考見積りです。ここにある間は他の画面には表示されず、「本見積もりにする」を押すと案件として全体に反映されます。
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <div className="text-right">
            <div className="text-[11px] text-slate-500">{referenceProjects.length}件の合計</div>
            <div className="tabular-nums text-slate-900" style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 24, lineHeight: 1.1 }}>
              {Math.round(total / 10000).toLocaleString("ja-JP")}
              <span className="ml-0.5 text-xs font-semibold">万円</span>
            </div>
          </div>
          <button onClick={onAdd} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            <Plus size={16} />
            参考見積りを追加
          </button>
        </div>
      </div>

      {referenceProjects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
          参考見積りはまだありません。「参考見積りを追加」から登録できます。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {referenceProjects.map((p) => (
            <div key={p.id} className="flex flex-col gap-4 rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-slate-900">{p.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <Avatar name={p.clientName} size={18} />
                    <span className="truncate">{p.clientName}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <button onClick={() => onEdit(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="編集"><Pencil size={15} /></button>
                  <button onClick={() => onDelete(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500" title="削除"><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] text-slate-500">見込み金額</div>
                  <div className="tabular-nums text-slate-900" style={{ ...NUM_FONT_STYLE, fontWeight: 500, fontSize: 26, lineHeight: 1.1 }}>
                    {Math.round((Number(p.estimatedAmount) || 0) / 10000).toLocaleString("ja-JP")}
                    <span className="ml-0.5 text-xs font-semibold">万円</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <CategoryPill category={p.category} />
                  <ConfidenceStars value={p.confidence} />
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="flex items-center gap-1.5 text-xs text-slate-500"><Avatar name={p.assignee} size={20} />担当 {p.assignee}</span>
                <button onClick={() => onPromote(p)} className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
                  本見積もりにする
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Googleスプレッドシート連携（公開CSVを定期取得して案件へ反映）           */
/* ------------------------------------------------------------------ */

const SYNC_STORAGE_KEY = "salesDashboardDemo.sheetSources.v1";
const SYNC_INTERVAL_MS = 3 * 60 * 1000;

function loadSheetSources() {
  try {
    const raw = window.localStorage.getItem(SYNC_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveSheetSources(list) {
  try {
    window.localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    // 保存できない環境ではこのセッション内のみ有効
  }
}

// 「ウェブに公開」のCSV URLはそのまま使い、通常のスプレッドシートURL（…/edit?gid=0）は
// CSVで取得できる形式（gviz）に変換する。
function toSheetCsvUrl(input) {
  const url = String(input || "").trim();
  if (!url) return "";
  if (/\/pub\?/.test(url) || /output=csv/.test(url) || /\/gviz\//.test(url)) return url;
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m && !/\/d\/e\//.test(url)) {
    const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
    return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ""}`;
  }
  return url;
}

async function fetchSheetCsv(url) {
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`取得に失敗しました（HTTP ${res.status}）`);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error("CSVではなくログイン画面等が返されました。公開設定（ウェブに公開／リンクを知っている全員が閲覧可）をご確認ください");
  }
  return text.replace(/^﻿/, "");
}

// シートの行を案件一覧へ反映する。
// ・新しい行 → 案件として追加
// ・既存行 → 「前回取得時から変わった項目」だけを上書き（アプリ側で編集した他の項目は保持）
// ・シートから消えた行 → 案件はそのまま残す
function applySheetRows(list, rows, sourceId) {
  const next = [...list];
  let added = 0;
  let updated = 0;
  const now = todayIso();
  for (const row of rows) {
    const key = row.csvSourceKey;
    const idx = next.findIndex((p) => (p.csvSourceKey || csvDedupeKey(p.clientName || "", p.name || "")) === key);
    if (idx === -1) {
      next.push({ ...row, csvSourceId: sourceId });
      added++;
      continue;
    }
    const cur = next[idx];
    const snap = row.csvSnapshot;
    const prev = cur.csvSnapshot;
    if (!prev) {
      next[idx] = { ...cur, csvSnapshot: snap, csvSourceId: cur.csvSourceId || sourceId };
      continue;
    }
    const patch = {};
    const history = [];
    const changes = [];
    if (snap.stage !== prev.stage) {
      if (snap.stage === "won" && cur.status === "active") {
        patch.status = "won";
        patch.confirmedAmount = snap.amount;
        history.push({ id: uid(), date: now, type: "won", label: "受注（シート更新）", previousStatus: cur.status });
        changes.push("受注");
      } else if (prev.stage === "won" && snap.stage === "active" && cur.status === "won") {
        patch.status = "active";
        patch.confirmedAmount = null;
        changes.push("受注取消");
      }
      if (prev.stage === "reference" && snap.stage !== "reference" && cur.isReference) {
        patch.isReference = false;
        history.push({ id: uid(), date: now, type: "promoted", label: "本見積もりに変更（シート更新）" });
        changes.push("本見積もり化");
      } else if (snap.stage === "reference" && !cur.isReference) {
        patch.isReference = true;
        changes.push("参考見積り化");
      }
    }
    if (snap.scheduledMonth !== prev.scheduledMonth) {
      patch.scheduledMonth = snap.scheduledMonth;
      history.push({
        id: uid(), date: now, type: "postponed", label: "時期変更（シート更新）",
        fromMonth: cur.scheduledMonth, toMonth: snap.scheduledMonth,
      });
      changes.push("受注予定月");
    }
    if (snap.amount !== prev.amount) {
      patch.estimatedAmount = snap.amount;
      if (cur.status === "won" && cur.confirmedAmount === cur.estimatedAmount) patch.confirmedAmount = snap.amount;
      changes.push("見込額");
    }
    if (snap.assignee !== prev.assignee) {
      patch.assignee = snap.assignee;
      changes.push("担当者");
    }
    if (snap.progress !== prev.progress && snap.progress) {
      patch.progressNotes = [...(cur.progressNotes || []), { id: uid(), date: now, text: snap.progress }];
      changes.push("進捗");
    }
    if (changes.length === 0) {
      continue;
    }
    history.push({ id: uid(), date: now, type: "sheet_sync", label: `スプレッドシートから更新（${changes.join("・")}）` });
    next[idx] = {
      ...cur,
      ...patch,
      csvSnapshot: snap,
      history: [...cur.history, ...history],
      updatedAt: now,
    };
    updated++;
  }
  return { list: next, added, updated };
}

function formatSyncTime(iso) {
  if (!iso) return "未取得";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function SheetSyncModal({ open, onClose, sources, onAdd, onRemove, onSyncNow, syncing, autoSync, onToggleAuto }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");

  function submit() {
    const csvUrl = toSheetCsvUrl(url);
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(csvUrl)) {
      setErr("GoogleスプレッドシートのURLを入力してください（https://docs.google.com/spreadsheets/…）");
      return;
    }
    if (sources.some((s) => s.url === csvUrl)) {
      setErr("このURLはすでに登録されています");
      return;
    }
    onAdd({ name: name.trim() || `シート${sources.length + 1}`, url: csvUrl });
    setName("");
    setUrl("");
    setErr("");
  }

  return (
    <Modal open={open} onClose={onClose} title="スプレッドシート連携" width="max-w-xl">
      <p className="text-sm text-slate-500">
        登録したGoogleスプレッドシートを自動で読み取り、編集内容を案件へ反映します（約3分ごと）。複数登録できます。
      </p>
      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>これは公開デモです。ここにはダミー用のシートだけを登録してください（実在の顧客情報は入れないでください）。</span>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {sources.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400">
            まだ連携しているシートはありません
          </div>
        )}
        {sources.map((s) => (
          <div key={s.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-700">{s.name}</div>
                <div className="mt-0.5 text-xs text-slate-400">最終取得 {formatSyncTime(s.lastSyncedAt)}</div>
              </div>
              <button
                onClick={() => onRemove(s.id)}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-rose-500"
                title="連携を解除"
              >
                <Trash2 size={15} />
              </button>
            </div>
            {s.lastError ? (
              <div className="mt-1.5 text-xs text-rose-600">{s.lastError}</div>
            ) : s.lastSyncedAt ? (
              <div className="mt-1.5 text-xs text-emerald-600">
                OK：{s.lastRows}行を確認（追加 {s.lastAdded}件・更新 {s.lastUpdated}件）
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 p-3">
        <div className="text-sm font-medium text-slate-700">シートを追加</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名前（例：デモ用アタックリスト）"
          className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="スプレッドシートのURL（公開CSVのURLでも可）"
          className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
        />
        {err && <div className="mt-2 text-xs text-rose-600">{err}</div>}
        <button
          onClick={submit}
          className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          追加して取得
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={autoSync} onChange={(e) => onToggleAuto(e.target.checked)} />
          3分ごとに自動で更新する
        </label>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            閉じる
          </button>
          <button
            onClick={onSyncNow}
            disabled={syncing || sources.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            今すぐ更新
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        反映ルール：シートで変更した項目（ステージ・受注予定月・見込額・担当者・進捗）だけを上書きします。アプリ側で編集したカテゴリ等は保持され、シートから行を消しても案件は残ります。キーは「クライアント名＋案件名」です。
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* CSV取り込みモーダル                                                   */
/* ------------------------------------------------------------------ */

function ImportCsvModal({ open, onClose, onImport, existingKeys }) {
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    setResult(null);
    try {
      const text = await readCsvFile(file);
      const parsed = buildProjectsFromCsv(text, existingKeys);
      setResult(parsed);
    } catch (err) {
      console.error(err);
      setError("CSVの読み込みに失敗しました。ファイル形式をご確認ください。");
    }
  }

  function handleClose() {
    setResult(null);
    setFileName("");
    setError("");
    onClose();
  }

  function handleConfirm() {
    if (!result || result.imported.length === 0) return;
    onImport(result.imported);
    handleClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="CSVから取り込み" width="max-w-lg">
      <p className="text-sm text-slate-500">
        以下の列を含むCSVファイルを読み込めます。
      </p>
      <p className="mt-1 text-xs text-slate-400">
        ステージ／担当者／受注予定日／クライアント名／案件名／進捗／売上見込額
      </p>
      <div className="mt-4">
        <input
          type="file"
          accept=".csv"
          onChange={handleFile}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-600 hover:file:bg-slate-50"
        />
      </div>
      {error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-600">{error}</div>
      )}
      {result && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="font-medium text-slate-700">{fileName}</div>
            <div className="mt-1 text-xs text-slate-500">
              取り込み対象 {result.summary.total}件（案件提案中 {result.summary.active} ・ 受注 {result.summary.won} ・ 参考見積 {result.summary.reference}）
              {result.summary.skipped > 0 && ` ／ スキップ ${result.summary.skipped}件`}
              {result.summary.duplicate > 0 && `（うち取り込み済み ${result.summary.duplicate}件）`}
            </div>
          </div>
          {result.skipped.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="max-h-28 overflow-y-auto">
                {result.skipped.slice(0, 10).map((s, i) => (
                  <div key={i}>{s.row}行目：{s.reason}</div>
                ))}
                {result.skipped.length > 10 && <div>ほか{result.skipped.length - 10}件をスキップ</div>}
              </div>
            </div>
          )}
          {result.imported.length > 0 && (
            <div className="text-xs text-slate-400">
              クリエイティブ内容はCSVに含まれないため「未設定」として取り込まれます。取り込み後に各案件を編集してください。
            </div>
          )}
        </div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={handleClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          キャンセル
        </button>
        <button
          disabled={!result || result.imported.length === 0}
          onClick={handleConfirm}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {result ? `${result.imported.length}件を取り込む` : "取り込む"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* メインアプリ                                                        */
/* ------------------------------------------------------------------ */

const THEMES = [
  { key: "a", name: "ライト", swatch: ["#f8fafc", "#4f46e5"] },
  { key: "b", name: "ネイビー", swatch: ["#0f1b2d", "#14b8a6"] },
  { key: "c", name: "ダーク", swatch: ["#0b1018", "#818cf8"] },
];

function currentTheme() {
  return (typeof document !== "undefined" && document.documentElement.dataset.theme) || "a";
}

// グラフの主色（テーマごとに切り替え）
function chartAccent() {
  const t = currentTheme();
  return t === "b" ? "#0d9488" : t === "c" ? "#818cf8" : "#6366F1";
}

function loadTheme() {
  try {
    const v = window.localStorage.getItem("salesDashboardDemo.theme");
    return THEMES.some((t) => t.key === v) ? v : "a";
  } catch (e) {
    return "a";
  }
}

function ThemeSwitcher({ theme, onChange }) {
  return (
    <div className="app-theme rounded-2xl border border-slate-200 p-2">
      <div className="px-1 pb-1.5 text-[11px] text-slate-500">カラーモード</div>
      <div className="grid grid-cols-3 gap-1">
        {THEMES.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            title={`${t.name}モード`}
            className={`flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium ${
              theme === t.key ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            <span className="flex overflow-hidden rounded-full border border-slate-300" style={{ width: 22, height: 12 }}>
              <span style={{ flex: 1, background: t.swatch[0] }} />
              <span style={{ flex: 1, background: t.swatch[1] }} />
            </span>
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}

const PAGE_META = {
  dashboard: ["ダッシュボード", "月ごとの売上と目標の進み具合、気をつける案件をまとめて確認できます。"],
  analysis: ["受注率分析", "肌感・担当者・カテゴリーごとに、受注率と金額を比べられます。"],
  monthly: ["月別状況", "月ごとの確定・見込み・ストックを確認し、カードから案件を開けます。"],
  stock: ["ストック売上", "AI・SNS・保守管理など、毎月入る売上の契約を管理します。"],
  yearly: ["年別売上", "年ごとの確定金額と前年比、カテゴリーの内訳を確認できます。"],
  companies: ["会社一覧", "取引先ごとの案件・受注率・訪問状況を確認できます。"],
  visits: ["訪問記録", "訪問の履歴を一覧とカレンダーで確認・登録できます。"],
  reference: ["参考見積り", "受注予定に入れる前の、社内検討用の見積りです。"],
};

export default function App() {
  const [initialData] = useState(() => {
    const seededProjects = [...seedProjects(), ...seedArchivedProjects(), ...seedReferenceEstimates()];
    return { projects: seededProjects, visits: seedVisits(seededProjects) };
  });
  const [projects, setProjects] = useState(initialData.projects);
  const [visits, setVisits] = useState(initialData.visits);
  const [stocks, setStocks] = useState(() => seedStocks());
  const [companyJump, setCompanyJump] = useState(null);
  const [monthlyScope, setMonthlyScope] = useState("all");
  const [monthlyNavOpen, setMonthlyNavOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    const t = loadTheme();
    if (typeof document !== "undefined") document.documentElement.dataset.theme = t;
    return t;
  });
  function changeTheme(t) {
    document.documentElement.dataset.theme = t;
    try {
      window.localStorage.setItem("salesDashboardDemo.theme", t);
    } catch (e) {
      // 保存できない環境ではこの画面の間だけ有効
    }
    setTheme(t);
  }
  const [view, setView] = useState("dashboard");
  const [activeCategory, setActiveCategory] = useState("全体");
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [dashMonth, setDashMonth] = useState(currentMonthKey());
  const [listAll, setListAll] = useState(false);
  const [sortBy, setSortBy] = useState("updated_desc");
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddReference, setShowAddReference] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSheetSync, setShowSheetSync] = useState(false);
  const [sheetSources, setSheetSources] = useState(loadSheetSources);
  const [autoSync, setAutoSync] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const projectsRef = useRef(projects);
  const sourcesRef = useRef(sheetSources);
  const syncingRef = useRef(false);
  const [editing, setEditing] = useState(null);
  const [postponeTarget, setPostponeTarget] = useState(null);
  const [wonTarget, setWonTarget] = useState(null);
  const [lostTarget, setLostTarget] = useState(null);
  const [deliveredTarget, setDeliveredTarget] = useState(null);
  const [quoteTarget, setQuoteTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [monthlyTarget, setMonthlyTargetState] = useState(3000000);
  const [showTargetEdit, setShowTargetEdit] = useState(false);
  projectsRef.current = projects;
  sourcesRef.current = sheetSources;
  const detail = projects.find((p) => p.id === detailId) || null;
  const setDetail = (p) => setDetailId(p ? p.id : null);
  const detailVisits = detail ? visits.filter((v) => v.relatedProjectId === detail.id) : [];

  function pushToast(message) {
    const id = uid();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
  }

  const visibleProjects = useMemo(() => projects.filter((p) => !p.isReference), [projects]);
  const referenceProjects = useMemo(() => projects.filter((p) => p.isReference), [projects]);
  const boardProjects = useMemo(() => visibleProjects.filter((p) => !p.archived), [visibleProjects]);
  const companyNames = useMemo(
    () => Array.from(new Set(visibleProjects.map((p) => p.clientName))).sort((a, b) => a.localeCompare(b, "ja")),
    [visibleProjects]
  );
  const assigneeNames = useMemo(
    () => Array.from(new Set([...ASSIGNEES, ...projects.map((p) => p.assignee).filter(Boolean)])).sort((a, b) => a.localeCompare(b, "ja")),
    [projects]
  );
  const existingCsvKeys = useMemo(
    () => new Set(projects.map((p) => p.csvSourceKey || csvDedupeKey(p.clientName || "", p.name || ""))),
    [projects]
  );

  const monthOptions = useMemo(() => {
    const set = new Set(boardProjects.map((p) => p.scheduledMonth));
    return Array.from(set).sort();
  }, [boardProjects]);

  const filtered = useMemo(() => {
    const list = boardProjects.filter((p) => {
      if (activeCategory !== "全体" && p.category !== activeCategory) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!listAll && p.scheduledMonth !== dashMonth) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (
          !p.name.toLowerCase().includes(q) &&
          !p.clientName.toLowerCase().includes(q) &&
          !p.memo.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
    return sortProjects(list, sortBy);
  }, [boardProjects, activeCategory, statusFilter, dashMonth, listAll, search, sortBy]);

  const kpi = computeCounts(filtered);
  const months = useMemo(() => {
    const set = new Set(filtered.map((p) => p.scheduledMonth));
    return Array.from(set).sort();
  }, [filtered]);

  const thisMonthKey = currentMonthKey();
  const thisMonthList = filtered.filter((p) => p.scheduledMonth === thisMonthKey);
  const thisMonthPostponed = boardProjects.reduce(
    (acc, p) =>
      acc + p.history.filter((h) => h.type === "postponed" && h.fromMonth === thisMonthKey).length,
    0
  );
  const thisMonthCounts = computeCounts(thisMonthList);

  const spotlight = boardProjects.filter((p) => p.scheduledMonth === dashMonth && p.confidence === 3 && p.status === "active").slice(0, 3);
  const overallKpi = computeCounts(boardProjects);
  const dashMonthChoices = Array.from(new Set([...monthOptions, currentMonthKey(), dashMonth])).sort();

  function updateProject(id, patch) {
    setProjects((list) =>
      list.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: todayIso() } : p))
    );
  }

  function handleAction(key, project) {
    if (key === "won") {
      setWonTarget(project);
    } else if (key === "lost") {
      setLostTarget(project);
    } else if (key === "postpone") {
      setPostponeTarget(project);
    } else if (key === "delivered") {
      setDeliveredTarget(project);
    } else if (key === "quote") {
      setQuoteTarget(project);
    } else if (key === "edit") {
      setEditing(project);
    } else if (key === "delete") {
      setDeleteTarget(project);
    }
    setDetail(null);
  }

  function confirmWon(amount) {
    updateProject(wonTarget.id, {
      status: "won",
      confirmedAmount: amount,
      history: [
        ...wonTarget.history,
        { id: uid(), date: todayIso(), type: "won", label: "受注", previousStatus: wonTarget.status },
      ],
    });
    pushToast(`「${wonTarget.name}」を受注にしました（${formatYen(amount)}）`);
    setWonTarget(null);
  }

  function confirmLost() {
    updateProject(lostTarget.id, {
      status: "lost",
      history: [
        ...lostTarget.history,
        { id: uid(), date: todayIso(), type: "lost", label: "ロスト", previousStatus: lostTarget.status },
      ],
    });
    pushToast(`「${lostTarget.name}」をロストにしました`);
    setLostTarget(null);
  }

  function confirmDelivered() {
    updateProject(deliveredTarget.id, {
      status: "delivered",
      deliveredAt: todayIso(),
      history: [
        ...deliveredTarget.history,
        { id: uid(), date: todayIso(), type: "delivered", label: "納品済み", previousStatus: deliveredTarget.status },
      ],
    });
    pushToast(`「${deliveredTarget.name}」を納品済みにしました`);
    setDeliveredTarget(null);
  }

  function setProjectDeliveryDate(project, date) {
    updateProject(project.id, { deliveryDueDate: date });
  }

  function confirmQuote(amount, date) {
    const isResubmit = !!quoteTarget.quoteSubmitted;
    updateProject(quoteTarget.id, {
      quoteSubmitted: true,
      quoteSubmittedAt: date,
      quotedAmount: amount,
      history: [
        ...quoteTarget.history,
        {
          id: uid(),
          date: todayIso(),
          type: "quote_submitted",
          label: isResubmit ? "再見積提出" : "見積提出",
          quoteDate: date,
          quoteAmount: amount,
        },
      ],
    });
    pushToast(`${isResubmit ? "再見積を提出しました" : "見積を提出しました"}（${formatYen(amount)}）`);
    setQuoteTarget(null);
  }

  function addVisit(form) {
    setVisits((list) => [...list, { id: uid(), ...form, createdAt: todayIso() }]);
    pushToast("訪問記録を追加しました");
  }

  function deleteVisit(visit) {
    setVisits((list) => list.filter((v) => v.id !== visit.id));
    pushToast("訪問記録を削除しました");
  }

  function confirmPostpone(targetMonth) {
    const fromMonth = postponeTarget.scheduledMonth;
    updateProject(postponeTarget.id, {
      scheduledMonth: targetMonth,
      history: [
        ...postponeTarget.history,
        {
          id: uid(),
          date: todayIso(),
          type: "postponed",
          label: "時期変更",
          fromMonth,
          toMonth: targetMonth,
        },
      ],
    });
    pushToast(`${monthLabel(targetMonth)}に変更しました`);
    setPostponeTarget(null);
  }

  function confirmDelete() {
    setProjects((list) => list.filter((p) => p.id !== deleteTarget.id));
    pushToast("案件を削除しました");
    setDeleteTarget(null);
  }

  function addProgressNote(project, text) {
    updateProject(project.id, {
      progressNotes: [...(project.progressNotes || []), { id: uid(), date: todayIso(), text }],
    });
    pushToast("進行状況メモを追加しました");
  }

  async function runSheetSync(onlySourceId) {
    if (syncingRef.current) return;
    const targets = sourcesRef.current.filter((s) => !onlySourceId || s.id === onlySourceId);
    if (targets.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);
    let totalAdded = 0;
    let totalUpdated = 0;
    const results = {};
    for (const src of targets) {
      try {
        const text = await fetchSheetCsv(src.url);
        const parsed = buildProjectsFromCsv(text, new Set(), { anyAssignee: true });
        const applied = applySheetRows(projectsRef.current, parsed.imported, src.id);
        projectsRef.current = applied.list;
        setProjects(applied.list);
        totalAdded += applied.added;
        totalUpdated += applied.updated;
        results[src.id] = {
          lastSyncedAt: new Date().toISOString(), lastError: "",
          lastRows: parsed.imported.length, lastAdded: applied.added, lastUpdated: applied.updated,
        };
      } catch (e) {
        results[src.id] = {
          lastError: e && e.message && !/Failed to fetch/i.test(e.message)
            ? e.message
            : "取得できませんでした。URLと公開設定（ウェブに公開／リンクを知っている全員）をご確認ください",
        };
      }
    }
    const merged = sourcesRef.current.map((s) => (results[s.id] ? { ...s, ...results[s.id] } : s));
    sourcesRef.current = merged;
    setSheetSources(merged);
    saveSheetSources(merged);
    syncingRef.current = false;
    setSyncing(false);
    if (totalAdded + totalUpdated > 0) pushToast(`スプレッドシートから反映：追加${totalAdded}件・更新${totalUpdated}件`);
  }

  function addSheetSource({ name, url }) {
    const src = { id: uid(), name, url, lastSyncedAt: null, lastError: "" };
    const next = [...sourcesRef.current, src];
    sourcesRef.current = next;
    setSheetSources(next);
    saveSheetSources(next);
    runSheetSync(src.id);
  }

  function removeSheetSource(id) {
    const next = sourcesRef.current.filter((s) => s.id !== id);
    sourcesRef.current = next;
    setSheetSources(next);
    saveSheetSources(next);
  }

  // 画面を開いたとき・一定間隔・タブに戻ったときに自動取得する。
  useEffect(() => {
    if (!autoSync) return undefined;
    const first = setTimeout(() => runSheetSync(), 1500);
    const timer = setInterval(() => runSheetSync(), SYNC_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") runSheetSync();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync]);

  function addStock(form) {
    setStocks((l) => [...l, { id: uid(), ...form }]);
    pushToast("ストックを追加しました");
  }
  function updateStock(id, form) {
    setStocks((l) => l.map((x) => (x.id === id ? { ...x, ...form } : x)));
    pushToast("ストックを更新しました");
  }
  function deleteStock(st) {
    setStocks((l) => l.filter((x) => x.id !== st.id));
    pushToast("ストックを削除しました");
  }

  function importFromCsv(newProjects) {
    setProjects((list) => [...list, ...newProjects]);
    pushToast(`${newProjects.length}件の案件をCSVから取り込みました`);
    setShowImport(false);
  }

  function saveNewProject(form) {
    const now = todayIso();
    setProjects((list) => [
      ...list,
      {
        id: uid(),
        ...form,
        estimatedAmount: Number(form.estimatedAmount) || 0,
        confirmedAmount: null,
        status: "active",
        quoteSubmitted: false,
        quoteSubmittedAt: null,
        quotedAmount: null,
        progressNotes: [],
        archived: false,
        isReference: false,
        createdAt: now,
        updatedAt: now,
        history: [{ id: uid(), date: now, type: "created", label: "新規登録", scheduledMonth: form.scheduledMonth }],
      },
    ]);
    pushToast("案件を登録しました");
    setShowAdd(false);
  }

  function saveNewReferenceProject(form) {
    const now = todayIso();
    setProjects((list) => [
      ...list,
      {
        id: uid(),
        ...form,
        estimatedAmount: Number(form.estimatedAmount) || 0,
        confirmedAmount: null,
        status: "active",
        quoteSubmitted: false,
        quoteSubmittedAt: null,
        quotedAmount: null,
        progressNotes: [],
        archived: false,
        isReference: true,
        createdAt: now,
        updatedAt: now,
        history: [{ id: uid(), date: now, type: "created", label: "参考見積りとして登録", scheduledMonth: form.scheduledMonth }],
      },
    ]);
    pushToast("参考見積りを登録しました");
    setShowAddReference(false);
  }

  function promoteReference(project) {
    updateProject(project.id, {
      isReference: false,
      history: [
        ...project.history,
        { id: uid(), date: todayIso(), type: "promoted", label: "本見積もりに変更" },
      ],
    });
    pushToast(`「${project.name}」を本見積もりにしました`);
  }

  function saveEditProject(form) {
    updateProject(editing.id, { ...form, estimatedAmount: Number(form.estimatedAmount) || 0 });
    pushToast("案件を更新しました");
    setEditing(null);
  }

  const navItems = [
    { key: "dashboard", label: "ダッシュボード", icon: LayoutDashboard },
    { key: "analysis", label: "受注率分析", icon: BarChart3 },
    { key: "monthly", label: "月別状況", icon: CalendarDays },
    { key: "stock", label: "ストック売上", icon: Repeat },
    { key: "yearly", label: "年別売上", icon: TrendingUp },
    { key: "companies", label: "会社一覧", icon: Building2 },
    { key: "visits", label: "訪問記録", icon: MapPin },
    { key: "reference", label: "参考見積り", icon: FileText },
  ];

  // サイドメニュー（月別状況は「全体／担当者」のサブメニューを開く）
  function renderNav(afterSelect) {
    return navItems.map((item) => {
      const active = view === item.key;
      const isMonthly = item.key === "monthly";
      const expanded = isMonthly && monthlyNavOpen;
      return (
        <div key={item.key}>
          <button
            onClick={() => {
              setCompanyJump(null);
              if (isMonthly) {
                if (active) {
                  setMonthlyNavOpen((v) => !v);
                } else {
                  setView("monthly");
                  setMonthlyScope("all");
                  setMonthlyNavOpen(true);
                }
                return; // サブメニューを選べるよう、モバイルでもメニューは閉じない
              }
              setView(item.key);
              afterSelect();
            }}
            className={`app-nav flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium ${
              active ? "is-active bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"
            }`}
            aria-expanded={isMonthly ? expanded : undefined}
          >
            <item.icon size={16} />
            {item.label}
            {isMonthly && (
              <ChevronDown size={14} className={`ml-auto transition-transform ${expanded ? "rotate-180" : ""}`} />
            )}
          </button>
          {isMonthly && expanded && (
            <div className="ml-5 mt-1 flex flex-col gap-0.5 border-l border-slate-200 pl-2">
              {[{ key: "all", label: "全体" }, ...assigneeNames.map((a) => ({ key: a, label: a }))].map((sub) => {
                const subActive = active && (monthlyScope === sub.key || (sub.key === "all" && !assigneeNames.includes(monthlyScope)));
                return (
                  <button
                    key={sub.key}
                    onClick={() => {
                      setCompanyJump(null);
                      setView("monthly");
                      setMonthlyScope(sub.key);
                      afterSelect();
                    }}
                    className={`app-subnav flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] ${
                      subActive ? "is-active bg-slate-100 font-semibold text-slate-900" : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {sub.key === "all" ? (
                      <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600">全</span>
                    ) : (
                      <Avatar name={sub.label} size={18} />
                    )}
                    {sub.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <div className="app-root flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar (デスクトップ) */}
      <aside className="app-sidebar sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 sm:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <span className="app-logo flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">案</span>
          <div>
            <div className="text-[15px] font-semibold tracking-tight text-slate-900">案件管理</div>
            <div className="text-[10px] text-slate-400">Sales Dashboard</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {renderNav(() => {})}
        </nav>
        <ThemeSwitcher theme={theme} onChange={changeTheme} />
      </aside>

      {/* Sidebar (モバイル用ドロワー) */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-slate-900/40 sm:hidden"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="app-sidebar flex h-full w-64 flex-col bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between px-2">
              <div className="text-lg font-semibold tracking-tight text-slate-900">案件管理</div>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex flex-col gap-1 overflow-y-auto">
              {renderNav(() => setMobileNavOpen(false))}
            </nav>
            <div className="mt-auto pt-4">
              <ThemeSwitcher theme={theme} onChange={changeTheme} />
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="app-header flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 sm:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="text-sm font-semibold text-slate-500 sm:hidden">案件管理</div>
          <div className="order-3 w-full sm:order-none sm:max-w-xs sm:flex-1">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="案件名・客先・メモで検索"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 sm:px-3.5"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">案件を追加</span>
            </button>
            <button
              onClick={() => setShowAddReference(true)}
              className="hidden items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3.5 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 sm:flex"
            >
              <FileText size={16} />
              参考見積り追加
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:flex"
            >
              <Upload size={16} />
              CSV取り込み
            </button>
            <button
              onClick={() => setShowSheetSync(true)}
              className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:flex"
            >
              <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
              シート連携{sheetSources.length > 0 ? `（${sheetSources.length}）` : ""}
            </button>
            <HeaderMoreMenu onAddReference={() => setShowAddReference(true)} onImport={() => setShowImport(true)} onSheetSync={() => setShowSheetSync(true)} />
            <button className="hidden rounded-lg p-2 text-slate-400 hover:bg-slate-100 sm:inline-flex"><Bell size={18} /></button>
            <button className="hidden rounded-lg p-2 text-slate-400 hover:bg-slate-100 sm:inline-flex"><Settings size={18} /></button>
            <div className="hidden h-8 w-8 rounded-full bg-indigo-100 text-center text-sm font-medium leading-8 text-indigo-700 sm:block">営</div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {PAGE_META[view] && !(view === "companies" && companyJump) && (
            <div className="mx-auto mb-5 max-w-6xl">
              <h1 data-view={view} className="app-title text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl"><span className="app-title-text">{PAGE_META[view][0]}</span></h1>
              <p className="mt-1 text-sm text-slate-500">{PAGE_META[view][1]}</p>
            </div>
          )}
          {view === "dashboard" && (
            <div className="mx-auto flex max-w-6xl flex-col gap-5">
              <div className="grid gap-5 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                  <DashboardHero
                    month={dashMonth}
                    projects={boardProjects}
                    stocks={stocks}
                    target={monthlyTarget}
                    onEditTarget={() => setShowTargetEdit(true)}
                    onChangeMonth={(m) => {
                      setDashMonth(m);
                      setListAll(false);
                    }}
                    monthChoices={dashMonthChoices}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-5">
                  <RemindersPanel
                    projects={boardProjects}
                    visits={visits}
                    onOpenDetail={setDetail}
                    onGoToVisits={() => setView("visits")}
                  />
                  <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">注目案件 <ConfidenceStars value={3} /><span className="font-normal text-slate-400">{Number(dashMonth.slice(5))}月</span></div>
                    <div className="flex flex-col gap-2.5">
                      {spotlight.length === 0 && <div className="text-sm text-slate-400">この月の注目案件はありません</div>}
                      {spotlight.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setDetail(p)}
                          className="rounded-2xl border border-amber-200 bg-amber-50/60 px-3.5 py-3 text-left hover:border-amber-300"
                        >
                          <div className="text-sm font-semibold text-slate-900">{p.clientName}</div>
                          <div className="mt-0.5 text-xs text-slate-500">{p.name}・{p.category}</div>
                          <div className="mt-1 tabular-nums text-slate-800" style={{ ...NUM_FONT_STYLE, fontWeight: 600 }}>{formatManYen(p.estimatedAmount)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="全体の案件数" value={overallKpi.total} unit="件" sub={`進行中 ${overallKpi.active}件`} />
                <StatTile label="全体の受注率" value={overallKpi.rate ?? "—"} unit={overallKpi.rate !== null ? "%" : ""} tone="text-indigo-600" sub={`受注 ${overallKpi.won}・ロスト ${overallKpi.lost}`} />
                <StatTile label="見込み金額（全体）" value={Math.round(overallKpi.estimatedTotal / 10000).toLocaleString("ja-JP")} unit="万円" tone="text-amber-600" sub="進行中の案件の合計" />
                <StatTile label="確定金額（全体）" value={Math.round(overallKpi.confirmedTotal / 10000).toLocaleString("ja-JP")} unit="万円" tone="text-emerald-600" sub="受注＋納品済み" />
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-slate-400">カテゴリ</span>
                  {["全体", ...CATEGORIES].map((c) => (
                    <button
                      key={c}
                      onClick={() => setActiveCategory(c)}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${activeCategory === c ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-slate-400">状態</span>
                    {STATUS_FILTERS.map((st) => (
                      <button
                        key={st.key}
                        onClick={() => setStatusFilter(st.key)}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${statusFilter === st.key ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <ArrowUpDown size={14} className="text-slate-400" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-indigo-300 focus:outline-none"
                    >
                      {SORT_OPTIONS.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-800">{listAll ? "全ての月の案件" : `${monthLabel(dashMonth)}の案件`}</div>
                <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                  <button
                    onClick={() => setListAll(false)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${!listAll ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                  >
                    {Number(dashMonth.slice(5))}月のみ
                  </button>
                  <button
                    onClick={() => setListAll(true)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${listAll ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                  >
                    全ての月
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {months.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
                    条件に一致する案件がありません。月や絞り込みを変えるか、「＋案件を追加」から登録してください。
                  </div>
                )}
                {months.map((m, i) => (
                  <MonthSection
                    key={`${m}-${listAll}`}
                    month={m}
                    projects={filtered.filter((p) => p.scheduledMonth === m)}
                    defaultOpen={!listAll || i < 2}
                    onAction={handleAction}
                    onOpenDetail={setDetail}
                  />
                ))}
              </div>
            </div>
          )}

          {view === "analysis" && (
            <div className="mx-auto max-w-6xl">
              <AnalysisPage projects={boardProjects} />
            </div>
          )}

          {view === "monthly" && (
            <div className="mx-auto max-w-6xl">
              <MonthlyPage projects={boardProjects} stocks={stocks} onOpenDetail={setDetail} monthlyTarget={monthlyTarget} assignees={assigneeNames} scope={monthlyScope} onScopeChange={setMonthlyScope} />
            </div>
          )}

          {view === "stock" && (
            <div className="mx-auto max-w-6xl">
              <StockPage stocks={stocks} companies={companyNames} assignees={assigneeNames} onAdd={addStock} onUpdate={updateStock} onDelete={deleteStock} />
            </div>
          )}

          {view === "yearly" && (
            <div className="mx-auto max-w-6xl">
              <YearlyRevenuePage projects={visibleProjects} />
            </div>
          )}

          {view === "companies" && (
            <div className="mx-auto max-w-6xl">
              <CompanyListPage
                key={companyJump ? companyJump.ts : "list"}
                projects={visibleProjects}
                onOpenDetail={setDetail}
                visits={visits}
                onAddVisit={addVisit}
                stocks={stocks}
                initialCompany={companyJump ? companyJump.name : null}
              />
            </div>
          )}

          {view === "visits" && (
            <div className="mx-auto max-w-6xl">
              <VisitsPage
                visits={visits}
                companies={companyNames}
                projects={visibleProjects}
                onAdd={addVisit}
                onDelete={deleteVisit}
                onOpenDetail={setDetail}
                onOpenCompany={(name) => {
                  setCompanyJump({ name, ts: Date.now() });
                  setView("companies");
                }}
              />
            </div>
          )}

          {view === "reference" && (
            <div className="mx-auto max-w-6xl">
              <ReferenceEstimatesPage
                referenceProjects={referenceProjects}
                onPromote={promoteReference}
                onEdit={setEditing}
                onDelete={setDeleteTarget}
                onAdd={() => setShowAddReference(true)}
              />
            </div>
          )}
        </main>
      </div>

      {/* モーダル類 */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="案件を追加">
        <ProjectForm onSubmit={saveNewProject} onCancel={() => setShowAdd(false)} companies={companyNames} assignees={assigneeNames} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="案件を編集">
        {editing && (
          <ProjectForm initial={editing} companies={companyNames} assignees={assigneeNames} onSubmit={saveEditProject} onCancel={() => setEditing(null)} />
        )}
      </Modal>

      <Modal open={showAddReference} onClose={() => setShowAddReference(false)} title="参考見積りを追加">
        <ProjectForm onSubmit={saveNewReferenceProject} onCancel={() => setShowAddReference(false)} companies={companyNames} assignees={assigneeNames} />
      </Modal>

      <SheetSyncModal
        open={showSheetSync}
        onClose={() => setShowSheetSync(false)}
        sources={sheetSources}
        onAdd={addSheetSource}
        onRemove={removeSheetSource}
        onSyncNow={() => runSheetSync()}
        syncing={syncing}
        autoSync={autoSync}
        onToggleAuto={setAutoSync}
      />
      <ImportCsvModal open={showImport} onClose={() => setShowImport(false)} onImport={importFromCsv} existingKeys={existingCsvKeys} />

      <Modal open={showTargetEdit} onClose={() => setShowTargetEdit(false)} title="月間目標を設定" width="max-w-sm">
        <TargetForm
          initial={monthlyTarget}
          onSubmit={(amount) => {
            setMonthlyTargetState(amount);
            pushToast("月間目標を更新しました");
            setShowTargetEdit(false);
          }}
          onCancel={() => setShowTargetEdit(false)}
        />
      </Modal>

      <PostponeDialog
        project={postponeTarget}
        onClose={() => setPostponeTarget(null)}
        onConfirm={confirmPostpone}
      />

      <WonDialog
        project={wonTarget}
        onClose={() => setWonTarget(null)}
        onConfirm={confirmWon}
      />

      <QuoteDialog
        project={quoteTarget}
        onClose={() => setQuoteTarget(null)}
        onConfirm={confirmQuote}
      />

      <ConfirmDialog
        open={!!lostTarget}
        onClose={() => setLostTarget(null)}
        onConfirm={confirmLost}
        title="この案件をロストにしますか？"
        message={lostTarget ? `「${lostTarget.name}」をロストとして記録します。` : ""}
        tone="danger"
      />

      <ConfirmDialog
        open={!!deliveredTarget}
        onClose={() => setDeliveredTarget(null)}
        onConfirm={confirmDelivered}
        title="この案件を納品済みにしますか？"
        message={deliveredTarget ? `「${deliveredTarget.name}」を納品済みとして記録します。` : ""}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="案件を削除しますか？"
        message={deleteTarget ? `「${deleteTarget.name}」を完全に削除します。この操作は取り消せません。` : ""}
        tone="danger"
      />

      {detail && (
        <ProjectDetail
          project={detail}
          onClose={() => setDetail(null)}
          onAction={handleAction}
          onAddNote={(text) => addProgressNote(detail, text)}
          onSetDeliveryDate={(date) => setProjectDeliveryDate(detail, date)}
          relatedVisits={detailVisits}
        />
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
