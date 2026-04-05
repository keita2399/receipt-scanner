import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { google } from "googleapis";

const FOLDER_NAME = "経費仕分けツール";

async function getDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

// フォルダを取得または作成
async function getOrCreateFolder(drive: ReturnType<typeof google.drive>, folderName: string): Promise<string> {
  const res = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
  });
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });
  return folder.data.id!;
}

// GET: 指定月のJSONを読み込む
export async function GET(req: NextRequest) {
  const token = await getToken({ req });
  if (!token?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // YYYY-MM
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  try {
    const drive = await getDriveClient(token.accessToken as string);
    const folderId = await getOrCreateFolder(drive, FOLDER_NAME);
    const fileName = `expense_${month}.json`;

    const res = await drive.files.list({
      q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
      fields: "files(id, name)",
    });

    if (!res.data.files || res.data.files.length === 0) {
      return NextResponse.json({ receipts: [] });
    }

    const fileId = res.data.files[0].id!;
    const file = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
    const data = JSON.parse(file.data as string);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Drive GET error:", error);
    return NextResponse.json({ error: "Failed to read from Drive" }, { status: 500 });
  }
}

// POST: 指定月のJSONを保存（上書き）
export async function POST(req: NextRequest) {
  const token = await getToken({ req });
  if (!token?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { month, data } = await req.json();
    if (!month || !data) return NextResponse.json({ error: "month and data required" }, { status: 400 });

    const drive = await getDriveClient(token.accessToken as string);
    const folderId = await getOrCreateFolder(drive, FOLDER_NAME);
    const fileName = `expense_${month}.json`;
    const content = JSON.stringify(data, null, 2);

    // 既存ファイルを検索
    const res = await drive.files.list({
      q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
      fields: "files(id)",
    });

    if (res.data.files && res.data.files.length > 0) {
      // 上書き
      const fileId = res.data.files[0].id!;
      await drive.files.update({
        fileId,
        media: { mimeType: "application/json", body: content },
      });
    } else {
      // 新規作成
      await drive.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: { mimeType: "application/json", body: content },
        fields: "id",
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Drive POST error:", error);
    return NextResponse.json({ error: "Failed to save to Drive" }, { status: 500 });
  }
}
