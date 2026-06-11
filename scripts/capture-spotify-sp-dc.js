import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// playwright 是選用依賴：僅本地 auth 流程需要，evaluator 的 demo 路徑不需安裝
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('此腳本需要 playwright：請先執行 `npm install playwright --no-save`，再重跑 npm run auth:spotify');
  process.exit(1);
}
import { fetchSpotifyLyrics } from '../src/spotify-lyrics.js';

// 取得當前檔案路徑與根目錄
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env.local');
const userDir = path.join(rootDir, '.local', 'spotify-auth-browser');

async function main() {
  console.log('==================================================');
  console.log('🎵 Spotify Web Lyrics Adapter (Experimental Local-Only Helper)');
  console.log('==================================================');
  console.log('⚠️ 安全與合規提示 (Security & Compliance Notice)：');
  console.log('1. sp_dc 是您的個人登入憑證，等同於密碼，請勿洩漏或上傳至 GitHub。');
  console.log('   sp_dc is a sensitive session credential. Do NOT share or commit it.');
  console.log('2. 本整合非官方 API，僅限本地測試使用，使用者需自負帳號限制或封鎖之風險。');
  console.log('   This is an unofficial experimental tool. Use at your own risk.');
  console.log('3. 本工具使用獨立沙盒瀏覽器，絕不讀取或儲存您的密碼。');
  console.log('   Runs in an isolated browser sandbox. Password is never saved.');
  console.log('==================================================\n');

  console.log('ℹ️ 登入小提示 (Login Tips)：');
  console.log('- 由於自動化防護限制，使用「Google 帳號登入」可能會被 Google 攔截。');
  console.log('  如果遇到攔截，請嘗試使用「Spotify 帳號密碼（Email）」進行原生登入。');
  console.log('- Google may block "Sign in with Google" inside automated browsers.');
  console.log('  If blocked, please sign in using your native Spotify Email & Password.');
  console.log('==================================================\n');

  console.log('正在啟動安全沙盒瀏覽器視窗...');

  let context;
  try {
    // 啟動獨立持久化 Chrome 實例 (沙盒隔離 + 規避自動化標記)
    context = await chromium.launchPersistentContext(userDir, {
      headless: false,
      viewport: { width: 1200, height: 800 },
      // 使用 disable-blink-features 規避 navigator.webdriver 偵測
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await context.newPage();
    
    // 導向 Spotify 首頁
    console.log('正在導向至 Spotify Web Player...');
    await page.goto('https://open.spotify.com/');

    console.log('\n👉 請在瀏覽器視窗中手動登入您的 Spotify 帳號。');
    console.log('⏱️ 系統將持續監測登入狀態（超時時間：5分鐘）...\n');

    let spDcValue = null;
    let accessTokenValue = null;
    
    // 攔截網路請求以獲取 accessToken (因 Node.js fetch 會被 WAF 阻擋)
    page.on('request', req => {
      const auth = req.headers()['authorization'];
      if (auth && auth.startsWith('Bearer ')) {
        accessTokenValue = auth.split(' ')[1];
      }
    });

    const maxAttempts = 150; // 最多等待 300 秒 (150 * 2 秒)
    
    for (let i = 0; i < maxAttempts; i++) {
      // 取得瀏覽器所有 Cookies
      const cookies = await context.cookies();
      const spDcCookie = cookies.find(c => c.name === 'sp_dc');
      
      if (spDcCookie && accessTokenValue) {
        spDcValue = spDcCookie.value;
        break;
      }
      
      // 每 2 秒檢查一次
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (spDcValue) {
      // 遮罩 Cookie 以保護隱私
      const maskedCookie = spDcValue.slice(0, 6) + '...' + spDcValue.slice(-4);
      console.log(`🎉 成功獲取 sp_dc 憑證: [${maskedCookie}]`);

      // 載入或建立 .env.local 內容
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      } else {
        const examplePath = path.join(rootDir, '.env.example');
        if (fs.existsSync(examplePath)) {
          envContent = fs.readFileSync(examplePath, 'utf8');
        }
      }

      const keySpDc = 'SPOTIFY_SP_DC';
      const keyToken = 'SPOTIFY_ACCESS_TOKEN';
      const newlineSpDc = `${keySpDc}=${spDcValue}`;
      const newlineToken = `${keyToken}=${accessTokenValue}`;

      // 使用正則表達式更新或新增憑證
      if (envContent.match(new RegExp(`^${keySpDc}\\s*=`, 'm'))) {
        envContent = envContent.replace(new RegExp(`^${keySpDc}\\s*=.*$`, 'm'), newlineSpDc);
      } else {
        envContent = envContent.trim() + `\n\n# Spotify Premium 憑證 (由轉接器自動獲取)\n${newlineSpDc}\n`;
      }
      
      if (envContent.match(new RegExp(`^${keyToken}\\s*=`, 'm'))) {
        envContent = envContent.replace(new RegExp(`^${keyToken}\\s*=.*$`, 'm'), newlineToken);
      } else {
        envContent = envContent.trim() + `\n${newlineToken}\n`;
      }

      fs.writeFileSync(envPath, envContent, 'utf8');
      console.log('✅ 已成功將憑證與 Access Token 寫入至根目錄的 .env.local 檔案中！');

      // 進行歌詞抓取驗證測試
      console.log('\n🔍 正在進行連線驗證測試 (Verifying connection)...');
      
      // 更新當前 process 環境變數，讓測試能讀到最新憑證
      process.env.SPOTIFY_SP_DC = spDcValue;
      process.env.SPOTIFY_ACCESS_TOKEN = accessTokenValue;
      
      const testTrackId = '2lAgFL0Vh2UlcOimU8uaLZ'; // 使用確定有歌詞的單曲 ID 進行驗證
      try {
        const result = await fetchSpotifyLyrics(testTrackId, spDcValue);
        if (result && result.lyrics) {
          console.log('✅ 連線驗證成功！該憑證可正常讀取 Spotify 歌詞。');
          console.log('   Verification Success: Lyrics fetched successfully!');
        } else {
          console.log('⚠️ 連線驗證提示：雖然取得憑證，但無法抓取歌詞。');
          console.log('   請確認您的 Spotify 帳號是否擁有 Premium 權限，或該測試曲目在該地區是否可用。');
          console.log('   Verification Warning: Cookie saved, but lyrics fetch failed. Please check Premium status.');
        }
      } catch (testErr) {
        console.log(`⚠️ 連線驗證出錯: ${testErr.message}`);
      }

    } else {
      console.log('❌ 逾時未完成登入，或未能在瀏覽器中獲取到 sp_dc 憑證。');
    }
  } catch (error) {
    console.error('❌ 執行過程中發生錯誤:', error.message);
  } finally {
    if (context) {
      console.log('正在關閉瀏覽器...');
      await context.close();
    }
    console.log('執行結束。');
  }
}

main().catch(err => {
  console.error('全域錯誤:', err);
  process.exit(1);
});
