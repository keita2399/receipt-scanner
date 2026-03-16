import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_PROMPT = `あなたはレシート読み取りの専門AIです。画像からレシートの内容を正確に読み取り、以下のJSON形式で出力してください。

## 出力形式（必ずこのJSON形式で）
{
  "store_name": "店舗名",
  "date": "YYYY-MM-DD",
  "items": [
    {
      "name": "商品名",
      "quantity": 1,
      "unit_price": 100,
      "amount": 100,
      "tax_rate": 10,
      "confidence": 0.95
    }
  ],
  "subtotal": 1000,
  "tax_8": 0,
  "tax_10": 100,
  "total": 1100,
  "payment_method": "現金 or クレジット or 電子マネー or 不明",
  "category": "勘定科目（下記参照）",
  "confidence": 0.92,
  "warnings": ["信頼度が低い箇所の説明"]
}

## 勘定科目の判定ルール
- コンビニ・スーパー・飲食店 → "会議費" (1人) or "交際費" (2人以上)
- 文房具・オフィス用品 → "消耗品費"
- 書籍・技術書 → "新聞図書費"
- 交通費（タクシー・電車・バス）→ "旅費交通費"
- 通信費（電話・インターネット）→ "通信費"
- ガソリン・駐車場 → "車両費"
- 宅配・郵便 → "荷造運賃"
- ソフトウェア・サブスク → "支払手数料" or "通信費"
- その他 → "雑費"
- 判定できない場合 → "不明"

## 注意事項
- 金額は必ず数値（整数）で出力
- 読み取れない文字がある場合、confidenceを下げてwarningsに記載
- 軽減税率（8%）と標準税率（10%）を区別
- ※マークは軽減税率8%を示す
- 合計金額が各項目の合計と一致するか検証し、不一致ならwarningsに記載
- JSON以外の文字は一切出力しないこと

## 最重要ルール: 推測禁止
- 画像から読み取れた文字だけを使うこと。推測・補完は絶対にしない
- 店舗名がデザイン文字・ロゴ等で読み取れない場合は store_name を "不明" にし、warningsに「店舗名が読み取れません」と記載
- 商品名が不明瞭な場合も "不明" とし、推測で商品名を補完しない
- 電話番号・住所・レジ番号などの補助情報が読み取れたら warningsに「参考情報: 〇〇」として記載（店舗特定の手がかりになる）`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { image, mimeType } = await req.json();

    if (!image || !mimeType) {
      return NextResponse.json({ error: "image and mimeType are required" }, { status: 400 });
    }

    // Gemini API call
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: SYSTEM_PROMPT },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: image,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      return NextResponse.json({ error: "AI API error", detail: errorText }, { status: 502 });
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return NextResponse.json({ error: "No response from AI" }, { status: 502 });
    }

    // Parse JSON response
    const receiptData = JSON.parse(text);

    // Validate totals
    if (receiptData.items && receiptData.total) {
      const itemsTotal = receiptData.items.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0);
      const taxTotal = (receiptData.tax_8 || 0) + (receiptData.tax_10 || 0);
      const calculatedTotal = receiptData.subtotal
        ? receiptData.subtotal + taxTotal
        : itemsTotal + taxTotal;

      if (Math.abs(calculatedTotal - receiptData.total) > 1) {
        receiptData.warnings = receiptData.warnings || [];
        receiptData.warnings.push(
          `合計金額の不一致: 計算値=${calculatedTotal}円, レシート表示=${receiptData.total}円`
        );
      }
    }

    return NextResponse.json(receiptData);
  } catch (error) {
    console.error("Scan error:", error);
    return NextResponse.json(
      { error: "Failed to process receipt", detail: String(error) },
      { status: 500 }
    );
  }
}
