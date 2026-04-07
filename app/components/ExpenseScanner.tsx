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
  classification: Classification;
  split_ratio: number;
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

// 日付+合計金額が一致するレシートを重複とみなす（店舗名はOCRブレがあるため除外）
function findDuplicates(existing: Receipt[], incoming: Receipt[]): Receipt[] {
  return incoming.filter(r =>
    existing.some(s => s.date === r.date && s.total === r.total)
  );
}

// 勘定科目リスト
const CATEGORIES = [
  "会議費", "交際費", "消耗品費", "新聞図書費", "旅費交通費",
  "通信費", "車両費", "荷造運賃", "支払手数料", "雑費", "家庭費", "不明"
];

// 業務金額を計算
function businessAmount(item: ReceiptItem): number {
  const amount = typeof item.amount === "number" && !isNaN(item.amount) ? item.amount : 0;
  if (item.classification === "business") return amount;
  if (item.classification === "personal") return 0;
  return Math.round(amount * item.split_ratio / 100);
}

// CSV生成
function generateCSV(receipts: Receipt[]): string {
  const rows: string[][] = [
    ["日付", "店舗名", "品名", "数量", "金額", "業務金額", "税率(%)", "勘定科目", "仕分け", "業務割合(%)"],
  ];
  receipts.forEach(r => {
    r.items.forEach(item => {
      const ba = businessAmount(item);
      if (ba === 0 && item.classification === "personal") return;
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

// 月オプション生成（直近24ヶ月）
function getMonthOptions(): string[] {
  const options: string[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return options;
}

// --- ItemRow ---
function ItemRow({ item, onChange }: {
  item: ReceiptItem;
  onChange: (updated: ReceiptItem) => void;
}) {
  const ba = businessAmount(item);
  return (
    <div className={`grid grid-cols-12 gap-1 items-center px-3 py-2 text-xs border-b border-gray-800/50 ${item.confidence < 0.7 ? "bg-red-500/5" : ""}`}>
      <div className="col-span-3 truncate text-gray-200">{item.name}</div>
      <div className="col-span-2 text-right font-mono text-gray-300">{typeof item.amount === "number" && !isNaN(item.amount) ? `¥${item.amount.toLocaleString()}` : <span className="text-gray-600">—</span>}</div>
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
      <div className="col-span-2">
        <select
          value={item.category}
          onChange={e => onChange({ ...item, category: e.target.value })}
          className="w-full bg-gray-800 text-gray-300 rounded px-1 py-0.5 text-[10px] cursor-pointer"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className={`col-span-1 text-right font-mono font-bold ${ba > 0 ? "text-blue-400" : "text-gray-600"}`}>
        {ba > 0 ? `¥${ba.toLocaleString()}` : "—"}
      </div>
    </div>
  );
}

// --- ReceiptCard ---
function ReceiptCard({ receipt, onChange, onDelete }: {
  receipt: Receipt;
  onChange: (updated: Receipt) => void;
  onDelete?: () => void;
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
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-800/60 cursor-pointer"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <span className="text-gray-200 font-bold text-sm">{receipt.store_name || "不明"}</span>
          <span className="text-gray-500 text-xs">{receipt.date}</span>
          <span className="text-gray-500 text-xs">{receipt.payment_method}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-gray-500">合計 / 業務分</div>
            <div className="text-sm font-mono">
              <span className="text-gray-400">¥{receipt.total?.toLocaleString()}</span>
              <span className="text-gray-600 mx-1">/</span>
              <span className="text-blue-400 font-bold">¥{businessTotal.toLocaleString()}</span>
            </div>
          </div>
          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="text-gray-600 hover:text-red-400 text-lg leading-none cursor-pointer transition-colors"
              title="このレシートを削除"
            >
              🗑
            </button>
          )}
          <span className="text-gray-500 text-lg">{collapsed ? "▶" : "▼"}</span>
        </div>
      </div>

      {!collapsed && (
        <>
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

          <div className="grid grid-cols-12 gap-1 px-3 py-1 text-[10px] text-gray-600 bg-gray-800/30">
            <div className="col-span-3">品名</div>
            <div className="col-span-2 text-right">金額</div>
            <div className="col-span-3 text-center">仕分け</div>
            <div className="col-span-1 text-center">%</div>
            <div className="col-span-2 text-center">勘定科目</div>
            <div className="col-span-1 text-right">業務分</div>
          </div>

          {receipt.items.map((item, i) => (
            <ItemRow key={i} item={item} onChange={u => updateItem(i, u)} />
          ))}

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

// --- 重複確認モーダル ---
function DuplicateModal({ duplicates, imageUrl, onOk, onCancel }: {
  duplicates: Receipt[];
  imageUrl: string | null;
  onOk: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700">
          <p className="text-white font-bold">重複レシートを検出</p>
          <p className="text-gray-400 text-xs mt-1">以下のレシートは既に保存されています。内容を確認して追加するか判断してください。</p>
        </div>
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {duplicates.map((r, i) => (
            <div key={i} className="flex gap-3 items-start">
              {imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="レシート" className="w-24 object-cover rounded border border-gray-700 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-gray-200 text-sm font-bold">{r.store_name || "不明"}</p>
                <p className="text-gray-500 text-xs">{r.date}　合計 <span className="text-amber-400 font-mono">¥{r.total?.toLocaleString()}</span></p>
                <div className="mt-2 border border-gray-700 rounded overflow-hidden">
                  <div className="grid grid-cols-12 px-2 py-1 text-[10px] text-gray-600 bg-gray-800">
                    <div className="col-span-7">品名</div>
                    <div className="col-span-2 text-right">数量</div>
                    <div className="col-span-3 text-right">金額</div>
                  </div>
                  {r.items.map((item, j) => (
                    <div key={j} className="grid grid-cols-12 px-2 py-1 text-[10px] border-t border-gray-800">
                      <div className="col-span-7 text-gray-300 truncate">{item.name}</div>
                      <div className="col-span-2 text-right text-gray-500">{item.quantity}</div>
                      <div className="col-span-3 text-right text-gray-300 font-mono">¥{item.amount.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-gray-700">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm cursor-pointer">
            キャンセル
          </button>
          <button onClick={onOk} className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm cursor-pointer">
            重複も追加する
          </button>
        </div>
      </div>
    </div>
  );
}

// --- メインコンポーネント ---
export default function ExpenseScanner() {
  const { data: session, status } = useSession();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [driveStatus, setDriveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const [dupModal, setDupModal] = useState<{ duplicates: Receipt[]; imageUrl: string | null; resolve: (ok: boolean) => void } | null>(null);
  const [startMonth, setStartMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [endMonth, setEndMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [csvLoading, setCsvLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monthOptions = getMonthOptions();

  // Chrome拡張の存在確認
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "SCANNER_EXTENSION_READY") setExtensionInstalled(true);
    };
    window.addEventListener("message", handler);
    window.postMessage({ type: "SCANNER_CHECK" }, "*");
    const timer = setTimeout(() => {}, 1500);
    return () => { window.removeEventListener("message", handler); clearTimeout(timer); };
  }, []);

  // 重複確認モーダルを表示してユーザーの選択を待つ
  const confirmDuplicate = useCallback((duplicates: Receipt[], imageUrl: string | null): Promise<boolean> => {
    return new Promise(resolve => {
      setDupModal({ duplicates, imageUrl, resolve });
    });
  }, []);

  // Drive保存（重複チェック含む）
  const saveToDrive = useCallback(async (newReceipts: Receipt[], imageUrl: string | null = null): Promise<boolean> => {
    if (!session?.accessToken) return true;
    const byMonth: Record<string, Receipt[]> = {};
    for (const r of newReceipts) {
      const m = r.date?.slice(0, 7) || new Date().toISOString().slice(0, 7);
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push(r);
    }
    setDriveStatus("saving");
    try {
      for (const [month, recs] of Object.entries(byMonth)) {
        const existing = await fetch(`/api/drive?month=${month}`).then(r => r.json());
        const existingReceipts: Receipt[] = existing.receipts || [];
        const dups = findDuplicates(existingReceipts, recs);
        const newRecs = recs.filter(r => !dups.find(d => d.date === r.date && d.total === r.total));
        let recsToSave = [...newRecs];
        if (dups.length > 0) {
          const ok = await confirmDuplicate(dups, imageUrl);
          if (ok) recsToSave = [...newRecs, ...recs.filter(r => dups.find(d => d.date === r.date && d.total === r.total))];
        }
        if (recsToSave.length === 0) continue;
        const merged = [...existingReceipts.filter(e => !recsToSave.find(n => n.id === e.id)), ...recsToSave];
        await fetch("/api/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, data: { receipts: merged } }),
        });
      }
      setDriveStatus("saved");
      setTimeout(() => setDriveStatus("idle"), 3000);
      return true;
    } catch {
      setDriveStatus("error");
      return true;
    }
  }, [session, confirmDuplicate]);

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
        await saveToDrive(newReceipts, reader.result as string);
      } catch {
        setError("通信エラーが発生しました");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  }, [saveToDrive]);

  // Chrome拡張経由でスキャン
  const scanFromScanner = useCallback(async () => {
    setScannerError(null);
    setScannerLoading(true);

    try {
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

      setScannerStatus("スキャン中... 原稿をセットしてお待ちください");
      const result = await new Promise<{receipts?: Receipt[]; error?: string}>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("タイムアウト")), 150000);
        const handler = (e: MessageEvent) => {
          if (e.data?.type !== "SCANNER_RESPONSE") return;
          if (e.data.status === "discovering") { setScannerStatus("スキャナを検索中..."); return; }
          if (e.data.status === "scanning") { setScannerStatus("スキャン中... しばらくお待ちください"); return; }
          if (e.data.status === "processing") { setScannerStatus("AIが読み取り中..."); return; }
          clearTimeout(timer);
          window.removeEventListener("message", handler);
          resolve(e.data);
        };
        window.addEventListener("message", handler);
        window.postMessage({ type: "SCANNER_REQUEST", action: "scan" }, "*");
      });

      if (result.error) { setScannerError(result.error); return; }
      if (!result.receipts?.length) { setScannerError("レシートを検出できませんでした"); return; }

      const newReceipts: Receipt[] = result.receipts.map((r) => ({
        ...r,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        items: (r.items || []).map((item) => ({
          ...item,
          classification: "business" as Classification,
          split_ratio: 50,
        })),
      }));
      setReceipts(newReceipts);
      await saveToDrive(newReceipts);

    } catch (e: unknown) {
      setScannerError(e instanceof Error ? e.message : "スキャンに失敗しました");
    } finally {
      setScannerLoading(false);
      setScannerStatus(null);
    }
  }, [saveToDrive]);

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
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      if (!session?.accessToken) return;
      const month = updated.date?.slice(0, 7) || new Date().toISOString().slice(0, 7);
      setDriveStatus("saving");
      try {
        const existing = await fetch(`/api/drive?month=${month}`).then(r => r.json());
        const existingReceipts: Receipt[] = existing.receipts || [];
        const merged = existingReceipts.map(r => r.id === updated.id ? updated : r);
        if (!merged.find(r => r.id === updated.id)) merged.push(updated);
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
    }, 1000);
  };

  const deleteReceipt = async (receipt: Receipt) => {
    if (!session?.accessToken) return;
    const month = receipt.date?.slice(0, 7) || new Date().toISOString().slice(0, 7);
    // 表示中レシートから削除
    setReceipts(prev => prev.filter(r => r.id !== receipt.id));
    // Driveから削除
    try {
      const existing = await fetch(`/api/drive?month=${month}`).then(r => r.json());
      const existingReceipts: Receipt[] = existing.receipts || [];
      const filtered = existingReceipts.filter(r => r.id !== receipt.id);
      await fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, data: { receipts: filtered } }),
      });
    } catch {
      // 失敗しても表示からは除去済み
    }
  };

  const downloadPeriodCSV = async () => {
    setCsvLoading(true);
    try {
      const months: string[] = [];
      const [sy, sm] = startMonth.split("-").map(Number);
      const [ey, em] = endMonth.split("-").map(Number);
      let y = sy, m = sm;
      while (y < ey || (y === ey && m <= em)) {
        months.push(`${y}-${String(m).padStart(2, "0")}`);
        m++;
        if (m > 12) { m = 1; y++; }
      }
      const allReceipts: Receipt[] = [];
      for (const month of months) {
        const data = await fetch(`/api/drive?month=${month}`).then(r => r.json());
        if (data.receipts) allReceipts.push(...data.receipts);
      }
      // レシートの日付で絞り込み（Driveファイルとレシート日付が異なる場合を考慮）
      const filtered = allReceipts.filter(r => {
        const m = r.date?.slice(0, 7);
        return m && m >= startMonth && m <= endMonth;
      });
      if (filtered.length === 0) {
        alert("指定した期間にレシートデータがありません");
        return;
      }
      const csv = generateCSV(filtered.sort((a, b) => a.date.localeCompare(b.date)));
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `経費_${startMonth}_${endMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("CSVのダウンロードに失敗しました");
    } finally {
      setCsvLoading(false);
    }
  };

  // セッション読み込み中
  if (status === "loading") {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="animate-spin text-5xl mb-4">⚙️</div>
        <p className="text-gray-400">読み込み中...</p>
      </div>
    );
  }

  // 未ログイン → ログイン画面のみ表示
  if (!session) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="text-center mb-10">
          <div className="text-xs text-amber-500 tracking-widest mb-2 font-mono">EXPENSE SCANNER</div>
          <h1 className="text-3xl font-bold mb-2">
            経費<span className="text-amber-500">仕分けツール</span>
          </h1>
          <p className="text-gray-400 text-sm">レシートをスキャン → 仕事/家庭を仕分け → 確定申告用CSV出力</p>
        </div>
        <div className="flex flex-col items-center gap-4">
          <p className="text-gray-500 text-sm">ご利用にはGoogleアカウントでのログインが必要です</p>
          <button
            onClick={() => signIn("google")}
            className="flex items-center gap-2 px-6 py-3 rounded-lg bg-white text-gray-800 font-medium text-sm hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Googleでログイン
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {cameraOpen && (
        <CameraModal
          onCapture={file => { setCameraOpen(false); processFile(file); }}
          onClose={() => setCameraOpen(false)}
        />
      )}
      {dupModal && (
        <DuplicateModal
          duplicates={dupModal.duplicates}
          imageUrl={dupModal.imageUrl}
          onOk={() => { dupModal.resolve(true); setDupModal(null); }}
          onCancel={() => { dupModal.resolve(false); setDupModal(null); }}
        />
      )}
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* ヘッダー */}
        <div className="text-center mb-6">
          <div className="text-xs text-amber-500 tracking-widest mb-2 font-mono">EXPENSE SCANNER</div>
          <h1 className="text-3xl font-bold mb-2">
            経費<span className="text-amber-500">仕分けツール</span>
          </h1>
          <p className="text-gray-400 text-sm">レシートをスキャン → 仕事/家庭を仕分け → 確定申告用CSV出力</p>
        </div>

        {/* ユーザー情報 + 期間CSVダウンロード */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-6 px-4 py-3 rounded-xl bg-gray-900 border border-gray-700">
          {/* ユーザー */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{session.user?.email}</span>
            {driveStatus === "saving" && <span className="text-xs text-amber-400 animate-pulse">⏳ 保存中...</span>}
            {driveStatus === "saved" && <span className="text-xs text-green-400">✓ 保存済み</span>}
            {driveStatus === "error" && <span className="text-xs text-red-400">⚠ 保存失敗</span>}
            <button onClick={() => signOut()} className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer">
              ログアウト
            </button>
          </div>
          {/* 期間指定CSVダウンロード */}
          <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
            <select
              value={startMonth}
              onChange={e => setStartMonth(e.target.value)}
              className="bg-gray-800 text-gray-300 text-xs rounded px-2 py-1.5 cursor-pointer"
            >
              {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="text-gray-500 text-xs">〜</span>
            <select
              value={endMonth}
              onChange={e => setEndMonth(e.target.value)}
              className="bg-gray-800 text-gray-300 text-xs rounded px-2 py-1.5 cursor-pointer"
            >
              {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button
              onClick={downloadPeriodCSV}
              disabled={csvLoading}
              className="px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              {csvLoading ? "取得中..." : "📥 CSVダウンロード"}
            </button>
          </div>
        </div>

        {/* スキャナー連携ツール */}
        <div className="flex justify-center mb-6">
          <a
            href="https://github.com/keita2399/receipt-scanner/releases/download/v1.0.0/receipt-scanner-installer.zip"
            className="text-xs text-gray-500 hover:text-amber-400 underline cursor-pointer transition-colors"
          >
            ⬇ スキャナー連携ツールをダウンロード
          </a>
        </div>

        {/* アップロードエリア */}
        {receipts.length === 0 && !loading && (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={scannerLoading ? undefined : handleDrop}
              onClick={scannerLoading ? undefined : () => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-all ${
                scannerLoading
                  ? "border-gray-800 opacity-40 cursor-not-allowed"
                  : dragOver ? "border-amber-500 bg-amber-500/10 cursor-pointer" : "border-gray-700 hover:border-gray-500 hover:bg-gray-900/50 cursor-pointer"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                disabled={scannerLoading}
                onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }}
              />
              <div className="text-4xl mb-4">🗂️</div>
              <p className="text-gray-300 font-medium mb-1">レシートをドロップ or クリックして選択</p>
              <p className="text-gray-500 text-xs">PNG / JPEG / PDF（複数レシートOK・複数ページPDFもOK）最大15MB</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => setCameraOpen(true)}
                disabled={scannerLoading}
                className="py-3 rounded-xl border border-gray-700 hover:border-amber-500/50 hover:bg-amber-500/5 text-gray-400 hover:text-amber-400 text-sm font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
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
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm transition-colors cursor-pointer"
                >
                  📷 次をスキャン
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {receipts.map((r, i) => (
                <ReceiptCard key={r.id} receipt={r} onChange={u => updateReceipt(i, u)} onDelete={() => deleteReceipt(r)} />
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
          </>
        )}
      </div>
    </>
  );
}
