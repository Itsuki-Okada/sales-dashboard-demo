import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Search, Plus, MoreHorizontal, ChevronDown, ChevronRight, ChevronLeft, X,
  LayoutDashboard, BarChart3, CalendarDays, Star, Bell, Settings,
  Trash2, Pencil, CheckCircle2, XCircle, Clock3, ArrowRight,
  TrendingUp, TrendingDown, Building2, Truck, Menu, MapPin, FileCheck,
  ArrowUpDown, Target, Link2, FileText, Upload, AlertTriangle,
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
const CSV_ACTIVE_STAGES = ["提案予定", "案件提案中"];

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
  const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = String(m[2]).padStart(2, "0");
    const d = String(m[3]).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
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

function buildProjectsFromCsv(text, existingKeys = new Set()) {
  const rows = parseCSVText(text);
  if (rows.length === 0) {
    return { imported: [], skipped: [], summary: { total: 0, active: 0, won: 0, lost: 0, skipped: 0, duplicate: 0 } };
  }

  // 先頭に注記行が入っているCSVもあるため、「ステージ」列を含む行を
  // 実際のヘッダー行として自動検出する（先頭数行の中から探す）。
  let headerRowIndex = rows.findIndex((r) => r.some((c) => c.trim() === "ステージ"));
  if (headerRowIndex === -1) headerRowIndex = 0;
  const header = rows[headerRowIndex].map((h) => h.trim());

  // 列名の表記ゆれに対応できるよう、候補名を複数チェックする。
  function idx(...names) {
    for (const name of names) {
      const i = header.indexOf(name);
      if (i !== -1) return i;
    }
    return -1;
  }
  const col = {
    stage: idx("ステージ"),
    dealType: idx("新規・既存", "新規既存"),
    registeredDate: idx("初回入力日", "登録日"),
    priority: idx("優先度"),
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
  let duplicateCount = 0;

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const stageRaw = col.stage >= 0 ? (row[col.stage] || "").trim() : "";
    const isActive = CSV_ACTIVE_STAGES.includes(stageRaw);
    const isWon = stageRaw === "受注";
    const isLost = stageRaw === "ロスト";
    if (!isActive && !isWon && !isLost) {
      skipped.push({ row: r + 1, reason: `ステージ「${stageRaw || "(空欄)"}」は対象外` });
      continue;
    }

    const clientName = col.clientName >= 0 ? (row[col.clientName] || "").trim() : "";
    const name = col.name >= 0 ? (row[col.name] || "").trim() : "";
    if (!clientName || !name) {
      skipped.push({ row: r + 1, reason: "クライアント名または案件名が空欄" });
      continue;
    }

    const dedupeKey = csvDedupeKey(clientName, name);
    if (seenKeys.has(dedupeKey)) {
      skipped.push({ row: r + 1, reason: `「${clientName} / ${name}」は取り込み済みのためスキップ` });
      duplicateCount++;
      continue;
    }

    const registeredDate = (col.registeredDate >= 0 && parseFlexibleDate(row[col.registeredDate])) || todayDateStr();
    const scheduledDateParsed = col.scheduledDate >= 0 ? parseFlexibleDate(row[col.scheduledDate]) : null;
    const scheduledMonth = scheduledDateParsed ? scheduledDateParsed.slice(0, 7) : currentMonthKey();
    const priorityRaw = col.priority >= 0 ? (row[col.priority] || "").trim().toUpperCase() : "";
    const confidence = PRIORITY_TO_CONFIDENCE[priorityRaw] || 2;
    const dealType = (col.dealType >= 0 && (row[col.dealType] || "").trim()) || "新規";
    const progressText = col.progress >= 0 ? (row[col.progress] || "").trim() : "";
    const estimatedAmount = col.amount >= 0 ? parseFlexibleNumber(row[col.amount]) : 0;
    const assignee = (col.assignee >= 0 && (row[col.assignee] || "").trim()) || "未設定";

    const status = isWon ? "won" : isLost ? "lost" : "active";
    const confirmedAmount = isWon ? estimatedAmount : null;
    const createdIso = new Date(`${registeredDate}T00:00:00`).toISOString();

    const history = [
      { id: uid(), date: createdIso, type: "created", label: "新規登録（CSV取込）", scheduledMonth },
    ];
    if (isWon) {
      history.push({ id: uid(), date: createdIso, type: "won", label: "受注", previousStatus: "active" });
    } else if (isLost) {
      history.push({ id: uid(), date: createdIso, type: "lost", label: "ロスト", previousStatus: "active" });
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
      isReference: false,
      csvSourceKey: dedupeKey,
      createdAt: createdIso,
      updatedAt: createdIso,
      history,
    });
    seenKeys.add(dedupeKey);

    if (status === "active") activeCount++;
    else if (status === "won") wonCount++;
    else lostCount++;
  }

  return {
    imported,
    skipped,
    summary: { total: imported.length, active: activeCount, won: wonCount, lost: lostCount, skipped: skipped.length, duplicate: duplicateCount },
  };
}

const CONF_LABEL = { 1: "★☆☆", 2: "★★☆", 3: "★★★" };
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

function ConfidenceStars({ value }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500" title={CONF_HINT[value]}>
      {[1, 2, 3].map((n) => (
        <Star
          key={n}
          size={14}
          className={n <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"}
        />
      ))}
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

function HeaderMoreMenu({ onAddReference, onImport }) {
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
    <div className="flex-1 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${accent}`}>
        {value}
        <span className="ml-0.5 text-lg text-slate-400">{suffix}</span>
      </div>
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
        className="flex w-full items-center justify-between px-5 py-4"
      >
        <div className="flex items-center gap-2">
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
                  <th className="px-5 py-2 font-medium">案件</th>
                  <th className="px-3 py-2 font-medium">客先</th>
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
                    <td className="max-w-[220px] truncate px-5 py-3 font-medium text-slate-800">{p.name}</td>
                    <td className="max-w-[160px] truncate px-3 py-3 text-slate-500">{p.clientName}</td>
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
                    <div className="truncate text-sm font-medium text-slate-800">{p.name}</div>
                    <div className="truncate text-xs text-slate-500">{p.clientName}</div>
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
          {[1, 2, 3].map((n) => (
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
              {CONF_LABEL[n]}
              <div className="text-[11px] text-slate-400">{CONF_HINT[n]}</div>
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

  const filtered = projects.filter(
    (p) =>
      (category === "全体" || p.category === category) &&
      (confidence === "すべて" || p.confidence === Number(confidence)) &&
      (assignee === "全員" || p.assignee === assignee)
  );
  const overall = computeCounts(filtered);

  const byConfidence = [1, 2, 3].map((n) => {
    const list = filtered.filter((p) => p.confidence === n);
    const c = computeCounts(list);
    return { conf: n, ...c };
  });

  const byAssignee = ASSIGNEES.map((a) => {
    const list = projects.filter(
      (p) =>
        p.assignee === a &&
        (category === "全体" || p.category === category) &&
        (confidence === "すべて" || p.confidence === Number(confidence))
    );
    const c = computeCounts(list);
    return { assignee: a, ...c };
  });

  const byCategory = CATEGORIES.map((cat) => {
    const list = projects.filter((p) => p.category === cat);
    const c = computeCounts(list);
    return {
      category: cat,
      案件数: c.total,
      受注率: c.rate ?? 0,
      見込み金額: c.estimatedTotal,
      確定金額: c.confirmedTotal,
    };
  });

  const months = recentMonthKeys(6);
  const monthlyRate = months.map((m) => {
    const list = projects.filter((p) => p.scheduledMonth === m);
    const c = computeCounts(list);
    const [, mo] = m.split("-");
    return { month: `${parseInt(mo, 10)}月`, 受注率: c.rate ?? 0 };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option>全体</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select
          value={confidence}
          onChange={(e) => setConfidence(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option>すべて</option>
          <option value="1">★☆☆</option>
          <option value="2">★★☆</option>
          <option value="3">★★★</option>
        </select>
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option>全員</option>
          {ASSIGNEES.map((a) => <option key={a}>{a}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="総案件数" value={overall.total} />
        <KpiCard label="受注" value={overall.won} accent="text-emerald-600" />
        <KpiCard label="ロスト" value={overall.lost} accent="text-rose-600" />
        <KpiCard label="受注率" value={overall.rate ?? "—"} suffix={overall.rate !== null ? "%" : ""} accent="text-indigo-600" />
        <KpiCard label="見込み金額" value={formatManYen(overall.estimatedTotal)} accent="text-amber-600" />
        <KpiCard label="確定金額" value={formatManYen(overall.confirmedTotal)} accent="text-emerald-600" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-slate-800">肌感別受注率</div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-2 font-medium">肌感</th>
                <th className="py-2 font-medium">案件数</th>
                <th className="py-2 font-medium">受注</th>
                <th className="py-2 font-medium">ロスト</th>
                <th className="py-2 font-medium">受注率</th>
              </tr>
            </thead>
            <tbody>
              {byConfidence.map((r) => (
                <tr key={r.conf} className="border-t border-slate-100">
                  <td className="py-2"><ConfidenceStars value={r.conf} /></td>
                  <td className="py-2 tabular-nums">{r.total}</td>
                  <td className="py-2 tabular-nums text-emerald-600">{r.won}</td>
                  <td className="py-2 tabular-nums text-rose-600">{r.lost}</td>
                  <td className="py-2 tabular-nums font-medium">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 sm:hidden">
          {byConfidence.map((r) => (
            <div key={r.conf} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <ConfidenceStars value={r.conf} />
                <span className="text-sm font-medium text-slate-800">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</span>
              </div>
              <div className="mt-1.5 flex gap-3 text-xs text-slate-500">
                <span>{r.total}件</span>
                <span className="text-emerald-600">受注{r.won}</span>
                <span className="text-rose-600">ロスト{r.lost}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-slate-800">担当者別実績</div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-2 font-medium">担当者</th>
                <th className="py-2 font-medium">案件数</th>
                <th className="py-2 font-medium">受注</th>
                <th className="py-2 font-medium">ロスト</th>
                <th className="py-2 font-medium">受注率</th>
              </tr>
            </thead>
            <tbody>
              {byAssignee.map((r) => (
                <tr key={r.assignee} className="border-t border-slate-100">
                  <td className="py-2 font-medium text-slate-700">{r.assignee}</td>
                  <td className="py-2 tabular-nums">{r.total}</td>
                  <td className="py-2 tabular-nums text-emerald-600">{r.won}</td>
                  <td className="py-2 tabular-nums text-rose-600">{r.lost}</td>
                  <td className="py-2 tabular-nums font-medium">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 sm:hidden">
          {byAssignee.map((r) => (
            <div key={r.assignee} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{r.assignee}</span>
                <span className="text-sm font-medium text-slate-800">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</span>
              </div>
              <div className="mt-1.5 flex gap-3 text-xs text-slate-500">
                <span>{r.total}件</span>
                <span className="text-emerald-600">受注{r.won}</span>
                <span className="text-rose-600">ロスト{r.lost}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-slate-800">カテゴリー別 見込み・確定金額</div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-2 font-medium">カテゴリー</th>
                <th className="py-2 font-medium">案件数</th>
                <th className="py-2 font-medium">受注率</th>
                <th className="py-2 font-medium">見込み金額</th>
                <th className="py-2 font-medium">確定金額</th>
              </tr>
            </thead>
            <tbody>
              {byCategory.map((r) => (
                <tr key={r.category} className="border-t border-slate-100">
                  <td className="py-2"><CategoryPill category={r.category} /></td>
                  <td className="py-2 tabular-nums">{r.案件数}</td>
                  <td className="py-2 tabular-nums font-medium">{r.受注率}%</td>
                  <td className="py-2 tabular-nums text-amber-600">{formatManYen(r.見込み金額)}</td>
                  <td className="py-2 tabular-nums text-emerald-600">{formatManYen(r.確定金額)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 sm:hidden">
          {byCategory.map((r) => (
            <div key={r.category} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <CategoryPill category={r.category} />
                <span className="text-xs text-slate-500">{r.案件数}件 ・ {r.受注率}%</span>
              </div>
              <div className="mt-1.5 flex justify-between text-xs">
                <span className="text-amber-600">見込み {formatManYen(r.見込み金額)}</span>
                <span className="text-emerald-600">確定 {formatManYen(r.確定金額)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-800">カテゴリー別案件数</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCategory}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis dataKey="category" tick={{ fontSize: 12, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="案件数" fill="#6366F1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-800">カテゴリー別受注率</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCategory}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis dataKey="category" tick={{ fontSize: 12, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#94A3B8" }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip />
              <Bar dataKey="受注率" fill="#10B981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-slate-800">月別受注率</div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={monthlyRate}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: "#94A3B8" }} axisLine={false} tickLine={false} unit="%" />
            <Tooltip />
            <Line type="monotone" dataKey="受注率" stroke="#6366F1" strokeWidth={2.5} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
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
    const prevRevenue = prevYear
      ? computeCounts(projects.filter((p) => yearOf(p.scheduledMonth) === prevYear)).confirmedTotal
      : null;
    const yoy =
      prevRevenue && prevRevenue > 0
        ? Math.round(((c.confirmedTotal - prevRevenue) / prevRevenue) * 1000) / 10
        : null;
    return { year: y, ...c, yoy };
  });

  const chartData = rows.map((r) => ({ 年: `${r.year}年`, 確定金額: Math.round(r.confirmedTotal / 10000) }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.year} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-400">{r.year}年 確定金額</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
              {formatManYen(r.confirmedTotal)}
            </div>
            <div className="mt-1 text-xs">
              前年比：<YoyBadge yoy={r.yoy} />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-slate-800">年別 確定金額（万円）</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
            <XAxis dataKey="年" tick={{ fontSize: 12, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => `${v.toLocaleString("ja-JP")}万円`} />
            <Bar dataKey="確定金額" fill="#6366F1" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-slate-800">年別サマリー</div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-2 font-medium">年</th>
                <th className="py-2 font-medium">案件数</th>
                <th className="py-2 font-medium">受注</th>
                <th className="py-2 font-medium">ロスト</th>
                <th className="py-2 font-medium">受注率</th>
                <th className="py-2 font-medium">確定金額</th>
                <th className="py-2 font-medium">前年比</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year} className="border-t border-slate-100">
                  <td className="py-2 font-medium text-slate-800">{r.year}年</td>
                  <td className="py-2 tabular-nums">{r.total}</td>
                  <td className="py-2 tabular-nums text-emerald-600">{r.won}</td>
                  <td className="py-2 tabular-nums text-rose-600">{r.lost}</td>
                  <td className="py-2 tabular-nums font-medium">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</td>
                  <td className="py-2 tabular-nums text-emerald-600">{formatManYen(r.confirmedTotal)}</td>
                  <td className="py-2"><YoyBadge yoy={r.yoy} /></td>
                </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="flex flex-col gap-2 sm:hidden">
          {rows.map((r) => (
            <div key={r.year} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{r.year}年</span>
                <YoyBadge yoy={r.yoy} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>{r.total}件</span>
                <span className="text-emerald-600">受注{r.won}</span>
                <span className="text-rose-600">ロスト{r.lost}</span>
                <span className="font-medium text-slate-700">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</span>
              </div>
              <div className="mt-1 text-xs text-emerald-600">確定金額 {formatManYen(r.confirmedTotal)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 会社一覧ページ                                                       */
/* ------------------------------------------------------------------ */

function CompanyListPage({ projects, onOpenDetail, visits, onAddVisit }) {
  const companies = useMemo(
    () => Array.from(new Set(projects.map((p) => p.clientName))).sort((a, b) => a.localeCompare(b, "ja")),
    [projects]
  );
  const [selected, setSelected] = useState(null);
  const [listOpen, setListOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [kanaFilter, setKanaFilter] = useState("全て");
  const [showAddVisit, setShowAddVisit] = useState(false);

  const q = search.trim().toLowerCase();
  const visibleCompanies = companies.filter((name) => {
    if (kanaFilter !== "全て" && companyKanaRow(name) !== kanaFilter) return false;
    if (!q) return true;
    if (name.toLowerCase().includes(q)) return true;
    // 案件名でも検索できるようにする
    return projects.some((p) => p.clientName === name && p.name.toLowerCase().includes(q));
  });

  function selectCompany(name) {
    setSelected(name);
    setListOpen(false);
  }

  const companyProjects = projects.filter((p) => p.clientName === selected);
  const overall = computeCounts(companyProjects);

  const monthsSet = Array.from(new Set(companyProjects.map((p) => p.scheduledMonth))).sort();
  const monthlyRows = monthsSet.map((m) => {
    const list = companyProjects.filter((p) => p.scheduledMonth === m);
    return { month: m, ...computeCounts(list) };
  });

  const years = Array.from(new Set(companyProjects.map((p) => yearOf(p.scheduledMonth)))).sort();
  const yearlyRows = years.map((y, i) => {
    const list = companyProjects.filter((p) => yearOf(p.scheduledMonth) === y);
    const c = computeCounts(list);
    const prevYear = years[i - 1];
    const prevRevenue = prevYear
      ? computeCounts(companyProjects.filter((p) => yearOf(p.scheduledMonth) === prevYear)).confirmedTotal
      : null;
    const yoy =
      prevRevenue && prevRevenue > 0
        ? Math.round(((c.confirmedTotal - prevRevenue) / prevRevenue) * 1000) / 10
        : null;
    return { year: y, ...c, yoy };
  });

  const sortedProjects = [...companyProjects].sort((a, b) => (a.scheduledMonth < b.scheduledMonth ? 1 : -1));

  const companyVisits = (visits || [])
    .filter((v) => v.clientName === selected)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="flex flex-col gap-4">
      {listOpen && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="会社名・案件名で検索"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {["全て", "あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ"].map((row) => (
              <button
                key={row}
                onClick={() => setKanaFilter(row)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  kanaFilter === row
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                }`}
              >
                {row}
              </button>
            ))}
          </div>
          <div className="mt-2 grid max-h-[50vh] grid-cols-1 gap-0.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {visibleCompanies.map((name) => (
              <button
                key={name}
                onClick={() => selectCompany(name)}
                className="truncate rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
              >
                {name}
              </button>
            ))}
            {visibleCompanies.length === 0 && (
              <div className="col-span-full px-3 py-2 text-sm text-slate-400">該当する会社がありません</div>
            )}
          </div>
        </div>
      )}

      {!listOpen && selected && (
        <>
          <button
            onClick={() => setListOpen(true)}
            className="flex w-fit items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
          >
            <ChevronLeft size={16} />
            会社一覧に戻る
          </button>

          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-indigo-500" />
            <div className="text-lg font-semibold text-slate-900">{selected}</div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard label="案件数" value={overall.total} />
            <KpiCard label="受注率" value={overall.rate ?? "—"} suffix={overall.rate !== null ? "%" : ""} accent="text-indigo-600" />
            <KpiCard label="見込み金額" value={formatManYen(overall.estimatedTotal)} accent="text-amber-600" />
            <KpiCard label="確定金額(累計)" value={formatManYen(overall.confirmedTotal)} accent="text-emerald-600" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-800">年別売上・昨年比</div>
            {yearlyRows.length === 0 ? (
              <div className="text-sm text-slate-400">データがありません</div>
            ) : (
              <>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400">
                        <th className="py-2 font-medium">年</th>
                        <th className="py-2 font-medium">受注率</th>
                        <th className="py-2 font-medium">確定金額</th>
                        <th className="py-2 font-medium">前年比</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearlyRows.map((r) => (
                        <tr key={r.year} className="border-t border-slate-100">
                          <td className="py-2 font-medium text-slate-800">{r.year}年</td>
                          <td className="py-2 tabular-nums">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</td>
                          <td className="py-2 tabular-nums text-emerald-600">{formatManYen(r.confirmedTotal)}</td>
                          <td className="py-2"><YoyBadge yoy={r.yoy} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-2 sm:hidden">
                  {yearlyRows.map((r) => (
                    <div key={r.year} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-800">{r.year}年</span>
                        <YoyBadge yoy={r.yoy} />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs">
                        <span className="text-slate-500">受注率 {r.rate ?? "—"}{r.rate !== null ? "%" : ""}</span>
                        <span className="text-emerald-600">確定 {formatManYen(r.confirmedTotal)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-800">月別受注率</div>
            {monthlyRows.length === 0 ? (
              <div className="text-sm text-slate-400">データがありません</div>
            ) : (
              <>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[460px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400">
                        <th className="py-2 font-medium">月</th>
                        <th className="py-2 font-medium">案件数</th>
                        <th className="py-2 font-medium">受注</th>
                        <th className="py-2 font-medium">ロスト</th>
                        <th className="py-2 font-medium">受注率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyRows.map((r) => (
                        <tr key={r.month} className="border-t border-slate-100">
                          <td className="py-2 font-medium text-slate-800">{monthLabel(r.month)}</td>
                          <td className="py-2 tabular-nums">{r.total}</td>
                          <td className="py-2 tabular-nums text-emerald-600">{r.won}</td>
                          <td className="py-2 tabular-nums text-rose-600">{r.lost}</td>
                          <td className="py-2 tabular-nums font-medium">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-2 sm:hidden">
                  {monthlyRows.map((r) => (
                    <div key={r.month} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-800">{monthLabel(r.month)}</span>
                        <span className="text-sm font-medium text-slate-800">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</span>
                      </div>
                      <div className="mt-1.5 flex gap-3 text-xs text-slate-500">
                        <span>{r.total}件</span>
                        <span className="text-emerald-600">受注{r.won}</span>
                        <span className="text-rose-600">ロスト{r.lost}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-800">案件一覧</div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="py-2 font-medium">案件</th>
                    <th className="py-2 font-medium">内容</th>
                    <th className="py-2 font-medium">月</th>
                    <th className="py-2 font-medium">状態</th>
                    <th className="py-2 font-medium">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProjects.map((p) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/60"
                      onClick={() => onOpenDetail && onOpenDetail(p)}
                    >
                      <td className="max-w-[200px] truncate py-2 font-medium text-slate-800">{p.name}</td>
                      <td className="py-2"><CategoryPill category={p.category} /></td>
                      <td className="py-2 whitespace-nowrap text-slate-500">{monthLabel(p.scheduledMonth)}</td>
                      <td className="py-2"><StatusBadge status={p.status} /></td>
                      <td className="py-2 tabular-nums text-slate-600">
                        {p.status === "won" || p.status === "delivered"
                          ? formatManYen(p.confirmedAmount)
                          : formatManYen(p.estimatedAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2 sm:hidden">
              {sortedProjects.map((p) => (
                <div
                  key={p.id}
                  onClick={() => onOpenDetail && onOpenDetail(p)}
                  className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 p-3 active:bg-slate-100"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-medium text-slate-800">{p.name}</div>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <CategoryPill category={p.category} />
                      <span className="text-slate-400">{monthLabel(p.scheduledMonth)}</span>
                    </div>
                    <span className="font-medium tabular-nums text-slate-700">
                      {p.status === "won" || p.status === "delivered"
                        ? formatManYen(p.confirmedAmount)
                        : formatManYen(p.estimatedAmount)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800">訪問記録</div>
              <button
                onClick={() => setShowAddVisit(true)}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <Plus size={14} />
                訪問記録を追加
              </button>
            </div>
            {companyVisits.length === 0 ? (
              <div className="text-sm text-slate-400">まだ訪問記録がありません。</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {companyVisits.map((v) => {
                  const related = v.relatedProjectId ? projects.find((p) => p.id === v.relatedProjectId) : null;
                  return (
                    <li key={v.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="whitespace-nowrap text-xs font-medium text-slate-500">{fmtDate(v.date)}</span>
                        <span className="text-xs text-slate-400">担当：{v.assignee}</span>
                        {v.purpose && <span className="text-xs text-slate-400">・ {v.purpose}</span>}
                      </div>
                      {v.memo && <div className="mt-1 text-slate-600">{v.memo}</div>}
                      {related && (
                        <button
                          onClick={() => onOpenDetail && onOpenDetail(related)}
                          className="mt-2 inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                        >
                          <Link2 size={11} />
                          関連案件：{related.name}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
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
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* リマインドパネル                                                     */
/* ------------------------------------------------------------------ */

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

function MonthlyPage({ projects }) {
  const presentMonths = projects.map((p) => p.scheduledMonth);
  const months = Array.from(new Set([...monthKeysRange(-1, 4), ...presentMonths])).sort();
  const rows = months.map((m) => {
    const list = projects.filter((p) => p.scheduledMonth === m);
    const c = computeCounts(list);
    const postponedCount = projects.reduce(
      (acc, p) =>
        acc + p.history.filter((h) => h.type === "postponed" && h.fromMonth === m).length,
      0
    );
    return { month: m, ...c, postponedCount };
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white sm:block shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              <th className="px-5 py-3 font-medium">月</th>
              <th className="px-3 py-3 font-medium">案件数</th>
              <th className="px-3 py-3 font-medium">受注</th>
              <th className="px-3 py-3 font-medium">ロスト</th>
              <th className="px-3 py-3 font-medium">時期変更</th>
              <th className="px-3 py-3 font-medium">受注率</th>
              <th className="px-3 py-3 font-medium">見込み金額</th>
              <th className="px-3 py-3 font-medium">確定金額</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className="border-t border-slate-100">
                <td className="px-5 py-3 font-medium text-slate-800">{monthLabel(r.month)}</td>
                <td className="px-3 py-3 tabular-nums">{r.total}</td>
                <td className="px-3 py-3 tabular-nums text-emerald-600">{r.won}</td>
                <td className="px-3 py-3 tabular-nums text-rose-600">{r.lost}</td>
                <td className="px-3 py-3 tabular-nums text-amber-600">{r.postponedCount}</td>
                <td className="px-3 py-3 tabular-nums font-medium">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</td>
                <td className="px-3 py-3 tabular-nums text-amber-600">{formatManYen(r.estimatedTotal)}</td>
                <td className="px-3 py-3 tabular-nums text-emerald-600">{formatManYen(r.confirmedTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((r) => (
          <div key={r.month} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-800">{monthLabel(r.month)}</div>
              <div className="text-sm font-semibold text-slate-800">{r.rate ?? "—"}{r.rate !== null ? "%" : ""}</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div className="text-slate-500">案件数 <span className="font-medium text-slate-700">{r.total}</span></div>
              <div className="text-slate-500">時期変更 <span className="font-medium text-amber-600">{r.postponedCount}</span></div>
              <div className="text-slate-500">受注 <span className="font-medium text-emerald-600">{r.won}</span></div>
              <div className="text-slate-500">ロスト <span className="font-medium text-rose-600">{r.lost}</span></div>
              <div className="text-slate-500">見込み <span className="font-medium text-amber-600">{formatManYen(r.estimatedTotal)}</span></div>
              <div className="text-slate-500">確定 <span className="font-medium text-emerald-600">{formatManYen(r.confirmedTotal)}</span></div>
            </div>
          </div>
        ))}
      </div>
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

function VisitsPage({ visits, companies, projects, onAdd, onDelete, onOpenDetail }) {
  const [showAdd, setShowAdd] = useState(false);
  const sorted = [...visits].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus size={16} />
          訪問記録を追加
        </button>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {sorted.length === 0 && (
          <div className="p-10 text-center text-sm text-slate-400">まだ訪問記録がありません。</div>
        )}
        <ul className="divide-y divide-slate-100">
          {sorted.map((v) => {
            const related = v.relatedProjectId ? projects.find((p) => p.id === v.relatedProjectId) : null;
            return (
              <li key={v.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                    <MapPin size={14} className="shrink-0 text-indigo-500" />
                    <span className="truncate">{v.clientName}</span>
                    <span className="whitespace-nowrap text-xs font-normal text-slate-400">{fmtDate(v.date)}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    担当：{v.assignee}
                    {v.purpose ? ` ・ ${v.purpose}` : ""}
                  </div>
                  {v.memo && <div className="mt-2 text-sm text-slate-600">{v.memo}</div>}
                  {related && (
                    <button
                      onClick={() => onOpenDetail && onOpenDetail(related)}
                      className="mt-2 inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      <Link2 size={11} />
                      関連案件：{related.name}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => onDelete(v)}
                  className="shrink-0 rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

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
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-500">
          まだ受注予定に組み込まれていない、社内検討用の参考見積りです。ここに登録されている間は他の画面には表示されません。
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus size={16} />
          参考見積りを追加
        </button>
      </div>

      {referenceProjects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          参考見積りはまだありません。
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white sm:block shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">案件</th>
                  <th className="px-3 py-3 font-medium">客先</th>
                  <th className="px-3 py-3 font-medium">内容</th>
                  <th className="px-3 py-3 font-medium">担当</th>
                  <th className="px-3 py-3 font-medium">肌感</th>
                  <th className="px-3 py-3 font-medium">見込み金額</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {referenceProjects.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="max-w-[220px] truncate px-5 py-3 font-medium text-slate-800">{p.name}</td>
                    <td className="max-w-[160px] truncate px-3 py-3 text-slate-500">{p.clientName}</td>
                    <td className="px-3 py-3"><CategoryPill category={p.category} /></td>
                    <td className="px-3 py-3 whitespace-nowrap text-slate-500">{p.assignee}</td>
                    <td className="px-3 py-3"><ConfidenceStars value={p.confidence} /></td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums text-slate-600">{formatManYen(p.estimatedAmount)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => onEdit(p)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => onDelete(p)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                          <Trash2 size={15} />
                        </button>
                        <button
                          onClick={() => onPromote(p)}
                          className="whitespace-nowrap rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                        >
                          本見積もりにする
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 sm:hidden">
            {referenceProjects.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{p.name}</div>
                    <div className="truncate text-xs text-slate-500">{p.clientName}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => onEdit(p)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => onDelete(p)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <CategoryPill category={p.category} />
                  <ConfidenceStars value={p.confidence} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-slate-400">担当：{p.assignee}</span>
                  <span className="font-medium tabular-nums text-slate-700">{formatManYen(p.estimatedAmount)}</span>
                </div>
                <button
                  onClick={() => onPromote(p)}
                  className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  本見積もりにする
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
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
        ステージ／新規・既存／初回入力日／優先度／受注予定日／クライアント名／案件名／進捗／売上見込額／営業担当
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
              取り込み対象 {result.summary.total}件（進行中 {result.summary.active} ・ 受注 {result.summary.won} ・ ロスト {result.summary.lost}）
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

export default function App() {
  const [initialData] = useState(() => {
    const seededProjects = [...seedProjects(), ...seedArchivedProjects(), ...seedReferenceEstimates()];
    return { projects: seededProjects, visits: seedVisits(seededProjects) };
  });
  const [projects, setProjects] = useState(initialData.projects);
  const [visits, setVisits] = useState(initialData.visits);
  const [view, setView] = useState("dashboard");
  const [activeCategory, setActiveCategory] = useState("全体");
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [sortBy, setSortBy] = useState("updated_desc");
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddReference, setShowAddReference] = useState(false);
  const [showImport, setShowImport] = useState(false);
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
      if (monthFilter !== "all" && p.scheduledMonth !== monthFilter) return false;
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
  }, [boardProjects, activeCategory, statusFilter, monthFilter, search, sortBy]);

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

  const spotlight = filtered.filter((p) => p.confidence === 3 && p.status === "active").slice(0, 3);

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
    { key: "yearly", label: "年別売上", icon: TrendingUp },
    { key: "companies", label: "会社一覧", icon: Building2 },
    { key: "visits", label: "訪問記録", icon: MapPin },
    { key: "reference", label: "参考見積り", icon: FileText },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar (デスクトップ) */}
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 sm:block">
        <div className="mb-6 px-2 text-lg font-semibold tracking-tight text-slate-900">案件管理</div>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                view === item.key
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Sidebar (モバイル用ドロワー) */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-slate-900/40 sm:hidden"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="flex h-full w-64 flex-col bg-white p-4 shadow-xl"
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
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    setView(item.key);
                    setMobileNavOpen(false);
                  }}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                    view === item.key
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <item.icon size={16} />
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
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
            <HeaderMoreMenu onAddReference={() => setShowAddReference(true)} onImport={() => setShowImport(true)} />
            <button className="hidden rounded-lg p-2 text-slate-400 hover:bg-slate-100 sm:inline-flex"><Bell size={18} /></button>
            <button className="hidden rounded-lg p-2 text-slate-400 hover:bg-slate-100 sm:inline-flex"><Settings size={18} /></button>
            <div className="hidden h-8 w-8 rounded-full bg-indigo-100 text-center text-sm font-medium leading-8 text-indigo-700 sm:block">営</div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {view === "dashboard" && (
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
              {/* リマインド */}
              <RemindersPanel
                projects={boardProjects}
                visits={visits}
                onOpenDetail={setDetail}
                onGoToVisits={() => setView("visits")}
              />

              {/* カテゴリータブ */}
              <div className="flex flex-wrap gap-2">
                {["全体", ...CATEGORIES].map((c) => (
                  <button
                    key={c}
                    onClick={() => setActiveCategory(c)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                      activeCategory === c
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>

              {/* ステータス絞り込み・ソート */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {STATUS_FILTERS.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setStatusFilter(s.key)}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${
                        statusFilter === s.key
                          ? "bg-slate-800 text-white"
                          : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {s.label}
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

              {/* 月別タブ */}
              <div className="flex flex-wrap items-center gap-2">
                <CalendarDays size={14} className="shrink-0 text-slate-400" />
                <button
                  onClick={() => setMonthFilter("all")}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${
                    monthFilter === "all"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  全ての月
                </button>
                {monthOptions.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMonthFilter(m)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${
                      monthFilter === m
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {monthLabel(m)}
                  </button>
                ))}
              </div>

              {/* KPI */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <KpiCard label="案件数" value={kpi.total} />
                <KpiCard label="受注数" value={kpi.won} accent="text-emerald-600" />
                <KpiCard label="ロスト数" value={kpi.lost} accent="text-rose-600" />
                <KpiCard label="現在の受注率" value={kpi.rate ?? "—"} suffix={kpi.rate !== null ? "%" : ""} accent="text-indigo-600" />
                <KpiCard label="見込み金額" value={formatManYen(kpi.estimatedTotal)} accent="text-amber-600" />
                <KpiCard label="確定金額" value={formatManYen(kpi.confirmedTotal)} accent="text-emerald-600" />
              </div>

              {/* 今月の状況 + 注目案件 */}
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-800">今月の状況（{monthLabel(thisMonthKey)}）</div>
                    <button
                      onClick={() => setShowTargetEdit(true)}
                      className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                    >
                      <Target size={13} />
                      目標を編集
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <div className="text-xs text-slate-400">案件</div>
                      <div className="text-xl font-semibold tabular-nums">{thisMonthCounts.total}件</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">受注</div>
                      <div className="text-xl font-semibold tabular-nums text-emerald-600">{thisMonthCounts.won}件</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">ロスト</div>
                      <div className="text-xl font-semibold tabular-nums text-rose-600">{thisMonthCounts.lost}件</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">時期変更</div>
                      <div className="text-xl font-semibold tabular-nums text-amber-600">{thisMonthPostponed}件</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">見込み金額</div>
                      <div className="text-xl font-semibold tabular-nums text-amber-600">{formatManYen(thisMonthCounts.estimatedTotal)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">確定金額</div>
                      <div className="text-xl font-semibold tabular-nums text-emerald-600">{formatManYen(thisMonthCounts.confirmedTotal)}</div>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <div className="flex items-baseline justify-between text-xs text-slate-500">
                      <span>月間目標に対する進捗</span>
                      <span>
                        {formatManYen(thisMonthCounts.confirmedTotal)}
                        <span className="text-slate-400"> / 目標 {formatManYen(monthlyTarget)}</span>
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={thisMonthCounts.confirmedTotal} max={monthlyTarget} />
                    </div>
                    <div className="mt-1 text-right text-xs font-medium text-indigo-600">
                      {monthlyTarget > 0 ? Math.min(100, Math.round((thisMonthCounts.confirmedTotal / monthlyTarget) * 100)) : 0}%
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 text-sm font-semibold text-slate-800">注目案件（肌感★★★）</div>
                  <div className="flex flex-col gap-3">
                    {spotlight.length === 0 && <div className="text-sm text-slate-400">対象の案件はありません</div>}
                    {spotlight.map((p) => (
                      <div key={p.id} className="cursor-pointer rounded-lg border border-amber-100 bg-amber-50/50 p-3" onClick={() => setDetail(p)}>
                        <div className="text-sm font-medium text-slate-800">{p.clientName}</div>
                        <div className="text-xs text-slate-500">{p.name} ・ {p.category}</div>
                        <div className="mt-1 text-xs text-slate-400">受注予定：{monthLabel(p.scheduledMonth)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 月別一覧 */}
              <div className="flex flex-col gap-4">
                {months.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
                    条件に一致する案件がありません。「＋案件を追加」から登録してください。
                  </div>
                )}
                {months.map((m, i) => (
                  <MonthSection
                    key={m}
                    month={m}
                    projects={filtered.filter((p) => p.scheduledMonth === m)}
                    defaultOpen={i < 2}
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
            <div className="mx-auto max-w-4xl">
              <MonthlyPage projects={boardProjects} />
            </div>
          )}

          {view === "yearly" && (
            <div className="mx-auto max-w-5xl">
              <YearlyRevenuePage projects={visibleProjects} />
            </div>
          )}

          {view === "companies" && (
            <div className="mx-auto max-w-6xl">
              <CompanyListPage projects={visibleProjects} onOpenDetail={setDetail} visits={visits} onAddVisit={addVisit} />
            </div>
          )}

          {view === "visits" && (
            <div className="mx-auto max-w-4xl">
              <VisitsPage visits={visits} companies={companyNames} projects={visibleProjects} onAdd={addVisit} onDelete={deleteVisit} onOpenDetail={setDetail} />
            </div>
          )}

          {view === "reference" && (
            <div className="mx-auto max-w-5xl">
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
