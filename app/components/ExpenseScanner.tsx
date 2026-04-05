"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

// --- カメラキャプチャモーダル ---
function CameraModal({ onCapture, onClose }: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 1920 } } })
      .then(s => {
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setError("カメラにアクセスできません。ブラウザの設定を確認してください。"));
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `receipt_${Date.now()}.jpg`, { type: "image/jpeg" });
      stream?.getTracks().forEach(t => t.stop());
      onCapture(file);
      onClose();
    }, "image/jpeg", 0.92);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="flex justify-between items-center mb-3">
          <p className="text-white font-medium">レシートをカメラに向けてください</p>
          <button onClick={() => { stream?.getTracks().forEach(t => t.stop()); onClose(); }}
            className="text-gray-400 hover:text-white text-2xl leading-none">✕</button>
        </div>
        {error ? (
          <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/30 text-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline
              className="w-full rounded-xl bg-gray-900 aspect-[4/3] object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            <button onClick={capture}
              className="mt-4 w-full py-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-lg transition-colors cursor-pointer">
              📸 撮影する
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// --- 型定義 ---
type Classification = "business" | "personal" | "split";

interface ReceiptItem {
  name: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_rate: number;
  confidence: number;
  category: string;
  // 仕分け
  classification: Classification;
  split_ratio: number; // 業務割合 0-100
}

interface Receipt {
  id: string;
  store_name: string;
  date: string;
  items: ReceiptItem[];
  subtotal: number;
  tax_8: number;
  tax_10: number;
  total: number;
  payment_method: string;
  confidence: number;
  warnings: string[];
}

const STORAGE_KEY = "expense_scanner_v2";

function loadSaved(): Receipt[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveSessions(data: Receipt[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data.slice(0, 200)));
}

// 勘定科目リスト
const CATEGORIES = [
  "会議費", "交際費", "消耗品費", "新聞図書費", "旅費交通費",
  "通信費", "車両費", "荷造運賃", "支払手数料", "雑費", "家庭費", "不明"
];

// 業務金額を計算
function businessAmount(item: ReceiptItem): number {
  if (item.classification === "business") return item.amount;
  if (item.classification === "personal") return 0;
  return Math.round(item.amount * item.split_ratio / 100);
}

// CSV生成
function generateCSV(receipts: Receipt[]): string {
  const rows: string[][] = [
    ["日付", "店舗名", "品名", "数量", "金額", "業務金額", "税率(%)", "勘定科目", "仕分け", "業務割合(%)"],
  ];
  receipts.forEach(r => {
    r.items.forEach(item => {
      const ba = businessAmount(item);
      if (ba === 0 && item.classification === "personal") return; // 家庭のみは除外
      rows.push([
        r.date, r.store_name, item.name,
        String(item.quantity), String(item.amount), String(ba),
        String(item.tax_rate), item.category,
        item.classification === "business" ? "仕事" : item.classification === "personal" ? "家庭" : "按分",
        item.classification === "split" ? String(item.split_ratio) : item.classification === "business" ? "100" : "0",
      ]);
    });
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  return "\uFEFF" + csv;
}

// --- ItemRow ---
function ItemRow({ item, onChange }: {
  item: ReceiptItem;
  onChange: (updated: ReceiptItem) => void;
}) {
  const ba = businessAmount(item);
  return (
    <div className={`grid grid-cols-12 gap-1 items-center px-3 py-2 text-xs border-b border-gray-800/50 ${item.confidence < 0.7 ? "bg-red-500/5" : ""}`}>
      {/* 品名 */}
      <div className="col-span-3 truncate text-gray-200">{item.name}</div>
      {/* 金額 */}
      <div className="col-span-2 text-right font-mono text-gray-300">¥{item.amount.toLocaleString()}</div>
      {/* 仕分け選択 */}
      <div className="col-span-3 flex gap-1">
        {(["business", "personal", "split"] as Classification[]).map(c => (
          <button
            key={c}
            onClick={() => onChange({ ...item, classification: c })}
            className={`flex-1 py-1 rounded text-[10px] font-bold transition-colors cursor-pointer ${
              item.classification === c
                ? c === "business" ? "bg-blue-600 text-white"
                  : c === "personal" ? "bg-gray-600 text-white"
                  : "bg-amber-600 text-white"
                : "bg-gray-800 text-gray-500 hover:bg-gray-700"
            }`}
          >
            {c === "business" ? "仕事" : c === "personal" ? "家庭" : "按分"}
          </button>
        ))}
      </div>
      {/* 按分% */}
      <div className="col-span-1 text-center">
        {item.classification === "split" ? (
          <input
            type="number"
            min={0} max={100} step={10}
            value={item.split_ratio}
            onChange={e => onChange({ ...item, split_ratio: Number(e.target.value) })}
            className="w-full bg-gray-800 text-amber-400 text-center rounded px-1 py-0.5 text-[10px]"
          />
        ) : (
          <span className="text-gray-600">—</span>
        )}
      </div>
      {/* 勘定科目 */}
      <div className="col-span-2">
        <select
          value={item.category}
          onChange={e => onChange({ ...item, category: e.target.value })}
          className="w-full bg-gray-800 text-gray-300 rounded px-1 py-0.5 text-[10px] cursor-pointer"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {/* 業務金額 */}
      <div className={`col-span-1 text-right font-mono font-bold ${ba > 0 ? "text-blue-400" : "text-gray-600"}`}>
        {ba > 0 ? `¥${ba.toLocaleString()}` : "—"}
      </div>
    </div>
  );
}

// --- ReceiptCard ---
function ReceiptCard({ receipt, onChange }: {
  receipt: Receipt;
  onChange: (updated: Receipt) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const businessTotal = receipt.items.reduce((s, i) => s + businessAmount(i), 0);

  const updateItem = (idx: number, updated: ReceiptItem) => {
    const items = [...receipt.items];
    items[idx] = updated;
    onChange({ ...receipt, items });
  };

  const setAll = (c: Classification) => {
    onChange({ ...receipt, items: receipt.items.map(i => ({ ...i, classification: c })) });
  };

  return (
    <div className="rounded-xl border border-gray-700 overflow-hidden bg-gray-900/50">
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-800/60 cursor-pointer"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <span className="text-gray-200 font-bold text-sm">{receipt.store_name || "不明"}</span>
          <span className="text-gray-500 text-xs">{receipt.date}</span>
          <span className="text-gray-500 text-xs">{receipt.payment_method}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-gray-500">合計 / 業務分</div>
            <div className="text-sm font-mono">
              <span className="text-gray-400">¥{receipt.total?.toLocaleString()}</span>
              <span className="text-gray-600 mx-1">/</span>
              <span className="text-blue-400 font-bold">¥{businessTotal.toLocaleString()}</span>
            </div>
          </div>
          <span className="text-gray-500 text-lg">{collapsed ? "▶" : "▼"}</span>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* 一括設定 */}
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/30 border-b border-gray-700">
            <span className="text-xs text-gray-500">一括:</span>
            {(["business", "personal", "split"] as Classification[]).map(c => (
              <button
                key={c}
                onClick={() => setAll(c)}
                className="text-[10px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 cursor-pointer"
              >
                全て{c === "business" ? "仕事" : c === "personal" ? "家庭" : "按分"}
              </button>
            ))}
          </div>

          {/* ヘッダー行 */}
          <div className="grid grid-cols-12 gap-1 px-3 py-1 text-[10px] text-gray-600 bg-gray-800/30">
            <div className="col-span-3">品名</div>
            <div className="col-span-2 text-right">金額</div>
            <div className="col-span-3 text-center">仕分け</div>
            <div className="col-span-1 text-center">%</div>
            <div className="col-span-2 text-center">勘定科目</div>
            <div className="col-span-1 text-right">業務分</div>
          </div>

          {/* 明細 */}
          {receipt.items.map((item, i) => (
            <ItemRow key={i} item={item} onChange={u => updateItem(i, u)} />
          ))}

          {/* 合計行 */}
          <div className="flex justify-between items-center px-3 py-2 bg-gray-800/30 text-xs">
            <div className="flex gap-4 text-gray-500">
              <span>小計 ¥{receipt.subtotal?.toLocaleString()}</span>
              {receipt.tax_8 > 0 && <span>税8% ¥{receipt.tax_8.toLocaleString()}</span>}
              {receipt.tax_10 > 0 && <span>税10% ¥{receipt.tax_10.toLocaleString()}</span>}
            </div>
            <div className="font-bold">
              業務計: <span className="text-blue-400 font-mono">¥{businessTotal.toLocaleString()}</span>
            </div>
          </div>

          {/* 警告 */}
          {receipt.warnings?.length > 0 && (
            <div className="px-3 py-2 bg-yellow-500/5 border-t border-yellow-500/20">
              {receipt.warnings.map((w, i) => (
                <p key={i} className="text-yellow-400/80 text-xs">⚠ {w}</p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- メインコンポーネント ---
export default function ExpenseScanner() {
  const { data: session } = useSession();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [saved, setSaved] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState<"scan" | "history">("scan");
  const [driveStatus, setDriveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [extensionInstalled, setExtensionInstalled] = useState<boolean>(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drive保存
  const saveToDrive = useCallback(async (receiptsToSave: Receipt[]) => {
    if (!session?.accessToken) return;
    const month = new Date().toISOString().slice(0, 7);
    setDriveStatus("saving");
    try {
      // 既存データを取得してマージ
      const existing = await fetch(`/api/drive?month=${month}`).then(r => r.json());
      const existingReceipts: Receipt[] = existing.receipts || [];
      // IDが被らないようにマージ
      const merged = [...existingReceipts.filter(e => !receiptsToSave.find(n => n.id === e.id)), ...receiptsToSave];
      await fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, data: { receipts: merged } }),
      });
      setDriveStatus("saved");
      setTimeout(() => setDriveStatus("idle"), 3000);
    } catch {
      setDriveStatus("error");
    }
  }, [session]);

  // ハイドレーション完了後にのみクライアント固有の処理を実行
  useEffect(() => {
    setMounted(true);
    setSaved(loadSaved());
  }, []);

  // Chrome拡張の存在確認（マウント後にSCANNER_CHECKを送って応答を待つ）
  useEffect(() => {
    if (!mounted) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "SCANNER_EXTENSION_READY") setExtensionInstalled(true);
    };
    window.addEventListener("message", handler);
    window.postMessage({ type: "SCANNER_CHECK" }, "*");
    const timer = setTimeout(() => setExtensionInstalled((v) => v || false), 1500);
    return () => { window.removeEventListener("message", handler); clearTimeout(timer); };
  }, [mounted]);

  // Drive読み込み（ログイン時）
  useEffect(() => {
    if (!session?.accessToken) return;
    const month = new Date().toISOString().slice(0, 7);
    fetch(`/api/drive?month=${month}`)
      .then(r => r.json())
      .then(data => {
        if (data.receipts?.length > 0) setSaved(data.receipts);
      })
      .catch(() => {});
  }, [session]);

  const processFile = useCallback(async (file: File) => {
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) { setError("PNG / JPEG / PDF を選択してください"); return; }
    if (file.size > 15 * 1024 * 1024) { setError("15MB以下のファイルにしてください"); return; }

    setError(null);
    setLoading(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64, mimeType: file.type }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || "解析に失敗しました"); return; }

        // 各レシートに仕分けデフォルト値とIDを付与
        const newReceipts: Receipt[] = (data.receipts || [data]).map((r: Omit<Receipt, "id" | "items"> & { items: Omit<ReceiptItem, "classification" | "split_ratio">[] }) => ({
          ...r,
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          items: (r.items || []).map((item) => ({
            ...item,
            classification: "business" as Classification,
            split_ratio: 50,
          })),
        }));
        setReceipts(newReceipts);
        // スキャン完了と同時に自動保存
        const next = [...loadSaved(), ...newReceipts];
        saveSessions(next);
        setSaved(next);
        if (session?.accessToken) saveToDrive(newReceipts);
      } catch {
        setError("通信エラーが発生しました");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  }, [session, saveToDrive]);

  // Chrome拡張経由でスキャン
  const scanFromScanner = useCallback(async () => {
    setScannerError(null);
    setScannerLoading(true);

    try {
      // 拡張機能の存在確認
      setScannerStatus("スキャナを検索中...");
      const extensionReady = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1500);
        const handler = (e: MessageEvent) => {
          if (e.data?.type === "SCANNER_EXTENSION_READY") {
            clearTimeout(timer);
            window.removeEventListener("message", handler);
            resolve(true);
          }
        };
        window.addEventListener("message", handler);
        window.postMessage({ type: "SCANNER_CHECK" }, "*");
      });

      if (!extensionReady) {
        setScannerError("Chrome拡張機能がインストールされていません。拡張機能をインストールしてください。");
        return;
      }

      // スキャン実行
      setScannerStatus("スキャン中... 原稿をセットしてお待ちください");
      const result = await new Promise<{image?: string; mimeType?: string; error?: string}>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("タイムアウト")), 120000);
        const chunks: string[] = [];
        const handler = (e: MessageEvent) => {
          if (e.data?.type !== "SCANNER_RESPONSE") return;
          if (e.data.status === "discovering") { setScannerStatus("スキャナを検索中..."); return; }
          if (e.data.status === "scanning") { setScannerStatus("スキャン中... しばらくお待ちください"); return; }
          if (e.data.error) {
            clearTimeout(timer);
            window.removeEventListener("message", handler);
            resolve({ error: e.data.error });
            return;
          }
          // チャンク受信
          if (e.data.chunk !== undefined) {
            chunks[e.data.chunkIndex] = e.data.chunk;
            setScannerStatus(`受信中... ${e.data.chunkIndex + 1}/${e.data.totalChunks}`);
            if (chunks.filter(Boolean).length === e.data.totalChunks) {
              clearTimeout(timer);
              window.removeEventListener("message", handler);
              resolve({ image: chunks.join(""), mimeType: e.data.mimeType });
            }
            return;
          }
          // 旧形式（チャンクなし）
          clearTimeout(timer);
          window.removeEventListener("message", handler);
          resolve(e.data);
        };
        window.addEventListener("message", handler);
        window.postMessage({ type: "SCANNER_REQUEST", action: "scan" }, "*");
      });

      if (result.error) {
        setScannerError(result.error);
        return;
      }
      if (!result.image) {
        setScannerError("画像データが取得できませんでした");
        return;
      }

      // base64 → File に変換してOCR処理へ
      const binary = atob(result.image);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], `scan_${Date.now()}.jpg`, { type: result.mimeType || "image/jpeg" });
      await processFile(file);

    } catch (e: unknown) {
      setScannerError(e instanceof Error ? e.message : "スキャンに失敗しました");
    } finally {
      setScannerLoading(false);
      setScannerStatus(null);
    }
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const updateReceipt = (idx: number, updated: Receipt) => {
    const next = [...receipts];
    next[idx] = updated;
    setReceipts(next);
    // 仕分け変更後1秒でDrive自動保存
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      const merged = [...saved.filter(s => !next.find(n => n.id === s.id)), ...next];
      saveSessions(merged);
      setSaved(merged);
      if (session?.accessToken) saveToDrive(next);
    }, 1000);
  };

  const downloadCSV = (target: Receipt[]) => {
    const csv = generateCSV(target);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `経費_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearHistory = () => {
    if (confirm("履歴を全て削除しますか？")) {
      localStorage.removeItem(STORAGE_KEY);
      setSaved([]);
    }
  };

  // 月別集計
  const monthlyTotals = saved.reduce<Record<string, number>>((acc, r) => {
    const ym = r.date?.slice(0, 7) || "不明";
    const bt = r.items.reduce((s, i) => s + businessAmount(i), 0);
    acc[ym] = (acc[ym] || 0) + bt;
    return acc;
  }, {});

  return (
    <>
    {cameraOpen && (
      <CameraModal
        onCapture={file => { setCameraOpen(false); processFile(file); }}
        onClose={() => setCameraOpen(false)}
      />
    )}
    <div className="max-w-4xl mx-auto px-4 py-10">
      {/* ヘッダー */}
      <div className="text-center mb-8">
        <div className="text-xs text-amber-500 tracking-widest mb-2 font-mono">EXPENSE SCANNER</div>
        <h1 className="text-3xl font-bold mb-2">
          経費<span className="text-amber-500">仕分けツール</span>
        </h1>
        <p className="text-gray-400 text-sm">レシートをスキャン → 仕事/家庭を仕分け → 確定申告用CSV出力</p>
      </div>

      {/* Googleログイン */}
      <div className="flex justify-center mb-6">
        {session ? (
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-gray-900 border border-gray-700">
            <span className="text-xs text-gray-400">{session.user?.email}</span>
            {driveStatus === "error" && <span className="text-xs text-red-400">⚠ Drive保存失敗</span>}
            <button
              onClick={() => signOut()}
              className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer"
            >
              ログアウト
            </button>
          </div>
        ) : (
          <button
            onClick={() => signIn("google")}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-gray-800 font-medium text-sm hover:bg-gray-100 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Googleでログイン（Drive自動保存）
          </button>
        )}
      </div>

      {/* タブ */}
      <div className="flex border-b border-gray-700 mb-6">
        {(["scan", "history"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px cursor-pointer ${
              activeTab === tab
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab === "scan" ? "📸 スキャン" : `📋 履歴 (${saved.length}件)`}
          </button>
        ))}
      </div>

      {/* スキャンタブ */}
      {activeTab === "scan" && (
        <>
          {/* アップロードエリア */}
          {receipts.length === 0 && !loading && (
            <>
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  dragOver ? "border-amber-500 bg-amber-500/10" : "border-gray-700 hover:border-gray-500 hover:bg-gray-900/50"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }}
                />
                <div className="text-4xl mb-4">🗂️</div>
                <p className="text-gray-300 font-medium mb-1">レシートをドロップ or クリックして選択</p>
                <p className="text-gray-500 text-xs">PNG / JPEG / PDF（複数レシートOK・複数ページPDFもOK）最大15MB</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setCameraOpen(true)}
                  className="py-3 rounded-xl border border-gray-700 hover:border-amber-500/50 hover:bg-amber-500/5 text-gray-400 hover:text-amber-400 text-sm font-medium transition-all flex items-center justify-center gap-2"
                >
                  📷 カメラで撮影
                </button>
                <button
                  onClick={scanFromScanner}
                  disabled={scannerLoading}
                  title={!extensionInstalled ? "Chrome拡張機能をインストールしてください" : ""}
                  className={`py-3 rounded-xl border text-sm font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    !extensionInstalled
                      ? "border-gray-800 text-gray-600 cursor-not-allowed"
                      : "border-gray-700 hover:border-blue-500/50 hover:bg-blue-500/5 text-gray-400 hover:text-blue-400 cursor-pointer"
                  }`}
                >
                  🖨️ {!extensionInstalled ? "拡張機能が必要です" : "スキャナで読み込む"}
                </button>
              </div>
              {scannerStatus && (
                <p className="mt-2 text-xs text-blue-400 text-center animate-pulse">{scannerStatus}</p>
              )}
              {scannerError && (
                <p className="mt-2 text-xs text-red-400 text-center">{scannerError}</p>
              )}
            </>
          )}

          {/* ローディング */}
          {(loading || scannerLoading) && (
            <div className="text-center py-20">
              <div className="animate-spin text-5xl mb-4">⚙️</div>
              <p className="text-gray-400">
                {scannerLoading ? (scannerStatus || "スキャン中...") : "AIがレシートを読み取り中..."}
              </p>
              <p className="text-gray-600 text-xs mt-2">
                {scannerLoading ? "原稿をセットしてお待ちください" : "複数枚の場合は少し時間がかかります"}
              </p>
            </div>
          )}

          {/* エラー */}
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 mb-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* レシート一覧 */}
          {receipts.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-gray-400 text-sm">{receipts.length}件のレシートを検出</span>
                <div className="flex items-center gap-3">
                  {driveStatus === "saving" && <span className="text-xs text-amber-400 animate-pulse">⏳ 保存中...</span>}
                  {driveStatus === "saved" && <span className="text-xs text-green-400">✓ 保存済み</span>}
                  <button
                    onClick={() => { setReceipts([]); setError(null); }}
                    className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs hover:bg-gray-700 cursor-pointer"
                  >
                    次をスキャン
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {receipts.map((r, i) => (
                  <ReceiptCard key={r.id} receipt={r} onChange={u => updateReceipt(i, u)} />
                ))}
              </div>

              {/* 合計サマリー */}
              <div className="mt-4 p-4 rounded-xl bg-gray-900 border border-gray-700">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">今回の業務経費合計</span>
                  <span className="text-2xl font-bold text-amber-500 font-mono">
                    ¥{receipts.reduce((s, r) => s + r.items.reduce((si, i) => si + businessAmount(i), 0), 0).toLocaleString()}
                  </span>
                </div>
              </div>

              <button
                onClick={() => downloadCSV(receipts)}
                className="w-full mt-3 py-3 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-400 text-sm font-medium transition-colors cursor-pointer"
              >
                📥 CSVダウンロード（確定申告用）
              </button>
            </>
          )}
        </>
      )}

      {/* 履歴タブ */}
      {activeTab === "history" && (
        <>
          {/* 月別集計 */}
          {Object.keys(monthlyTotals).length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              {Object.entries(monthlyTotals).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6).map(([ym, total]) => (
                <div key={ym} className="p-3 rounded-xl bg-gray-900 border border-gray-700 text-center">
                  <div className="text-xs text-gray-500 mb-1">{ym}</div>
                  <div className="text-lg font-bold text-amber-500 font-mono">¥{total.toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}

          {saved.length === 0 ? (
            <div className="text-center py-20 text-gray-600">保存されたレシートはありません</div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-3">
                <span className="text-gray-400 text-sm">{saved.length}件</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => downloadCSV(saved)}
                    className="px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs hover:bg-blue-500/30 cursor-pointer"
                  >
                    📥 全件CSV
                  </button>
                  <button
                    onClick={clearHistory}
                    className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs hover:bg-red-500/20 cursor-pointer"
                  >
                    🗑 全削除
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {saved.map((r, i) => (
                  <ReceiptCard key={r.id || i} receipt={r} onChange={u => {
                    const next = [...saved];
                    next[i] = u;
                    setSaved(next);
                    saveSessions(next);
                  }} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
    </>
  );
}
