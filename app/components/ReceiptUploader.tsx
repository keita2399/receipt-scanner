"use client";

import { useState, useRef, useCallback } from "react";

interface ReceiptItem {
  name: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_rate: number;
  confidence: number;
}

interface ReceiptData {
  store_name: string;
  date: string;
  items: ReceiptItem[];
  subtotal: number;
  tax_8: number;
  tax_10: number;
  total: number;
  payment_method: string;
  category: string;
  confidence: number;
  warnings: string[];
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 90 ? "text-green-400 border-green-400/30 bg-green-400/10" :
    pct >= 70 ? "text-yellow-400 border-yellow-400/30 bg-yellow-400/10" :
    "text-red-400 border-red-400/30 bg-red-400/10";
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${color}`}>
      {pct}%
    </span>
  );
}

export default function ReceiptUploader() {
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("画像ファイルを選択してください");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("ファイルサイズは10MB以下にしてください");
      return;
    }

    setError(null);
    setResult(null);

    // Preview
    const previewUrl = URL.createObjectURL(file);
    setPreview(previewUrl);

    // Convert to base64
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      setLoading(true);
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64, mimeType: file.type }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "解析に失敗しました");
        } else {
          setResult(data);
        }
      } catch {
        setError("通信エラーが発生しました");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="text-xs text-amber-500 tracking-widest mb-3 font-mono">RECEIPT SCANNER</div>
        <h1 className="text-3xl md:text-4xl font-bold mb-3">
          レシート<span className="text-amber-500">スキャナー</span>
        </h1>
        <p className="text-gray-400 text-sm">
          レシートを撮影 → AIが読み取り → 勘定科目を自動判定
        </p>
      </div>

      {/* Upload area */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`
          border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
          transition-all duration-300
          ${dragOver
            ? "border-amber-500 bg-amber-500/10"
            : "border-gray-700 hover:border-gray-500 hover:bg-gray-900/50"
          }
        `}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) processFile(file);
          }}
        />
        <div className="text-4xl mb-4">📸</div>
        <p className="text-gray-300 font-medium mb-1">
          レシートの写真をドロップ or タップして撮影
        </p>
        <p className="text-gray-500 text-xs">PNG / JPEG / WebP — 10MB以下</p>
      </div>

      {/* Preview + Result */}
      {(preview || loading || result || error) && (
        <div className="mt-8 grid md:grid-cols-2 gap-6">
          {/* Left: Preview */}
          {preview && (
            <div className="rounded-xl overflow-hidden border border-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="レシート" className="w-full" />
            </div>
          )}

          {/* Right: Result */}
          <div>
            {loading && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="animate-spin text-4xl mb-4">⚙️</div>
                  <p className="text-gray-400 text-sm">AIが読み取り中...</p>
                </div>
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {/* Store & Date */}
                <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-lg font-bold">{result.store_name}</div>
                      <div className="text-gray-400 text-sm">{result.date}</div>
                    </div>
                    <ConfidenceBadge value={result.confidence} />
                  </div>
                  <div className="flex gap-3 mt-3">
                    <span className="text-xs px-2 py-1 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      {result.category}
                    </span>
                    <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400">
                      {result.payment_method}
                    </span>
                  </div>
                </div>

                {/* Items */}
                <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
                  <div className="px-4 py-2 bg-gray-800/50 text-xs text-gray-400 font-mono flex">
                    <span className="flex-1">品名</span>
                    <span className="w-12 text-right">数量</span>
                    <span className="w-20 text-right">金額</span>
                    <span className="w-10 text-right">税</span>
                    <span className="w-12 text-right">信頼度</span>
                  </div>
                  {result.items.map((item, i) => (
                    <div
                      key={i}
                      className={`px-4 py-2 flex items-center text-sm ${
                        item.confidence < 0.7 ? "bg-red-500/5" : ""
                      } ${i > 0 ? "border-t border-gray-800/50" : ""}`}
                    >
                      <span className="flex-1 truncate">{item.name}</span>
                      <span className="w-12 text-right text-gray-400">{item.quantity}</span>
                      <span className="w-20 text-right font-mono">¥{item.amount.toLocaleString()}</span>
                      <span className="w-10 text-right text-gray-500 text-xs">{item.tax_rate}%</span>
                      <span className="w-12 text-right">
                        <ConfidenceBadge value={item.confidence} />
                      </span>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
                  <div className="flex justify-between text-sm text-gray-400 mb-1">
                    <span>小計</span>
                    <span className="font-mono">¥{result.subtotal?.toLocaleString()}</span>
                  </div>
                  {result.tax_8 > 0 && (
                    <div className="flex justify-between text-sm text-gray-400 mb-1">
                      <span>消費税（8%軽減）</span>
                      <span className="font-mono">¥{result.tax_8.toLocaleString()}</span>
                    </div>
                  )}
                  {result.tax_10 > 0 && (
                    <div className="flex justify-between text-sm text-gray-400 mb-1">
                      <span>消費税（10%）</span>
                      <span className="font-mono">¥{result.tax_10.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold mt-2 pt-2 border-t border-gray-700">
                    <span>合計</span>
                    <span className="text-amber-500 font-mono">¥{result.total?.toLocaleString()}</span>
                  </div>
                </div>

                {/* Warnings */}
                {result.warnings && result.warnings.length > 0 && (
                  <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
                    <div className="text-yellow-400 text-xs font-mono mb-2">⚠ 確認が必要な箇所</div>
                    {result.warnings.map((w, i) => (
                      <p key={i} className="text-yellow-300/80 text-sm">{w}</p>
                    ))}
                  </div>
                )}

                {/* Reset */}
                <button
                  onClick={() => { setPreview(null); setResult(null); setError(null); }}
                  className="w-full py-3 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm transition-colors"
                >
                  別のレシートをスキャン
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
