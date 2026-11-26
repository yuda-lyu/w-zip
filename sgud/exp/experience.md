# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

## 1. zip.js 2.22.0 寫出行為(影響「產物不變」之判斷)

- `ZipWriter` 與寫出端之種類無關:`dataDescriptor` 預設即為 true、`bufferedWrite` 預設 false,壓縮資料邊壓縮邊寫入 writer.故 `Uint8ArrayWriter` 換成檔案寫入串流**不改變產物**;凍結 `Date` 後新舊實作對無密碼輸入產出之壓縮檔**逐位元組相同**(level 0/1/6/9,zipFolder 與 zipFile 皆驗過,見 `test/unit-zipStream.test.mjs` EQ01).
- 項目大小是否已知決定是否強制 zip64:`add()` 傳入**具 `size` 之 Reader**(`new Reader()` 補 `init`/`readUint8Array`,同 `createFileReader`)時,只在預估壓縮後 ≥ 4 GiB 才用 zip64;傳 `ReadableStream`(`Readable.toWeb(fs.createReadStream())`)則大小未知,**每個項目一律強制 zip64**,產物改變(變異 M6 驗證).故各檔須以具 size 之 Reader 加入,不可為了方便改用 createReadStream.
- 讀取分段由 zip.js 決定(`configure` 之 `chunkSize` 預設 **256 KiB**,`lib/core/configuration.js:42`;初稿誤記為 512 KiB,經外審實測更正),Reader 的 `readUint8Array(index, length)` 依 `length` 配置緩衝區;Reader 須依檔案大小夾限(同既有 readZip),0 位元組檔與分段邊界前後之檔皆已驗(`sizes/` 邊界檔:262143/262144/262145、524287–524289、1 MiB±1).
- zip64 之觸發不只「單項預估壓縮後 ≥ 4 GiB」:另有未壓縮大小 ≥ 0xFFFFFFFF、整包偏移/中央目錄長度 ≥ 0xFFFFFFFF、項目數 ≥ 0xFFFF(`zip-writer.js:1265`、`:2363`).已實測項目數 66067 時新舊逐位元組相同(ED07,`WZIP_TEST_BIG=1`);單項 ≥ 4 GiB 未測.
- `stat.size` 為 0 不代表無內容(Linux `/proc` 等虛擬檔案):舊版 `fs.readFileSync` 讀至檔尾,新版 `createFileReader(fp, true)` 於 size 為 0 時 `fh.readFile()` 讀至檔尾(只用於寫出側;讀取側 `readZip` 不用),ED06 守之.
- 同行程並發壓縮同一來源且目標皆在來源內時,他方進行中之暫存檔(寫出串流使其於暫存內可見)會被列舉進來:以模組內 `activeTemps` 登記進行中之暫存資料夾並於 `zipFolder` 列舉時排除(ER09).不同行程間無法排除(`replaceTarget` 既有限制,舊版亦會收進他方之空暫存資料夾).
- `Writable.toWeb(fs.createWriteStream())` 之 `close()` 在成功路徑會等 Node 串流之 `'close'`(`stream.finished` 語意),故 `writeZip` 之 `await closed` 於成功路徑冗餘(移除後 ER11 仍綠,變異 M5 只被失敗路徑測試抓到),但失敗路徑(destroy 後)需要它.行程被強制終止時,暫存位置會留下未完成之壓縮檔(舊版僅留空資料夾),已寫入 JSDoc;未實作孤兒清除(`replaceTarget` 機制不變為要求).
- 外審兩位(sol、minimax)互補:sol 以替身實測出並發暫存、stat=0、close 錯誤覆蓋、量測工具不驗產物完整四點;minimax 偏重對照表文字與測試門檻.minimax 之「`Writable.toWeb` 會建立 readable 側」為誤報.
- 密碼檢查位元組(ZipCrypto)取自 `lastModDate`(有 data descriptor 時),與寫出端無關.
- 項目時間 = `new Date()`(壓縮當下),**不取來源檔 mtime**;舊版如此,新版維持(EQ05).若要改為取 mtime 屬產物變更,須另案.

## 2. 串流寫出之接法與陷阱

- `ZipWriter` 可直接接 `Writable.toWeb(fs.createWriteStream(fpOut))`;`zipWriter.close()` 會關閉該 WritableStream,但 Node 之 fd 在其後才釋放,**須另等 stream 之 `'close'` 事件**才進行改名/刪暫存(`writeZip` 之 `closed`).
- 失敗路徑須自行 `stream.destroy()`:壓縮器內部錯誤時 zip.js 會 abort 串流,但 `fun` 拋出壓縮器以外之錯誤(如 `fsTreeFolder` 列舉失敗)時 zip.js 不知情,串流永不關閉,`await closed` 會永遠卡住(ER08 守此情形,變異 M4 驗證).
- `process.resourceUsage().maxRSS`(KiB)為作業系統回報之行程常駐記憶體峰值,Windows 亦可用;比 `process.memoryUsage()` 輪詢準確.量測一律於**獨立子行程**執行(`test/tools/zipMemoryProbe.mjs`),避免 mocha 與其他測試之記憶體混入.
- 模擬寫出中途失敗:包 `fs.createWriteStream`,覆寫實例之 `_write` 並設 `_writev = undefined`(`fs.WriteStream` 有 `_writev`,不清掉則多個緩衝片段繞過 `_write`),見 `spyWriteStream`.

## 2b. wsemi 列舉層數:null 非無窮(1.9.63 起);第 2 參數改為 opt(1.9.80 起)

- **1.9.80 起(2026-11-26 遷移)**:`fsTreeFolder(fd, opt = {})`,`opt.levelLimit` 為有效正整數才限層,**未給即窮舉**;第 2 參數給數字(含 `4294967295`)拋 `invalid opt: must be an object`.`zipFolder` 本意窮舉,故改為 `fsTreeFolder(fpSrc)`(`src` 與凍結檔同步).遷移後以 `{ levelLimit: 1 }`、`{ levelLimit: 3 }` 變異於鏡像根驗證 ZD10、ED02、EQ01–04 等會紅(見規則帳本 R9);退回舊寫法則 31 案紅,舊版呼叫點漏改時不會靜默(與 1.9.63~1.9.79 之「靜默只列第 1 層」不同).
- 重盤時「省略第 2 參數」在 1.9.80 前後意義相反:舊版為 1 層、新版為窮舉;`zipFolder` 之省略為本意窮舉.
- 以下為 1.9.63~1.9.79 之歷史行為(保留供對照).
- `fsTreeFolder(fd, levelLimit)`:wsemi 1.9.62(含)以前 `null` 為無窮遍歷;1.9.63 起 `null`、`Infinity`、0、負數、小數、超過 4294967295 皆視為未給而取預設 1(只列第 1 層),無窮遍歷須給大有限值 `4294967295`.`4294967295` 於 1.9.62 亦有效,故新寫法對新舊版皆可.
- 現形:`zipFolder` 悄悄只壓縮來源之第 1 層,不報錯;2026-11-17 於 1.9.63 實測改回 `null` 時 22 案紅(`tree differs`,子資料夾內容全缺).查此類問題先看 `assertSameTree` 之差異是否皆為「子資料夾下的項目」.
- 凍結之舊版對照檔(`test/tools/mZipV1047.mjs`)與 `src` 兩側皆為 `null` 時,EQ01(新舊逐位元組相同)仍綠(兩側同樣漏列),是**假綠**,實測 22 案紅之名單不含 EQ01;只改其一則 EQ01 轉紅.凍結檔之相依行為隨 wsemi 升版而變時,須與 `src` 同步其傳值(見規則帳本 R3、R9).

## 3. 記憶體量測之實測數據與判讀(Windows 11,Node 24.19,不可壓縮輸入,level 9)

- 修前(1.0.47)峰值 RSS 約為輸入之 2.4 倍(zipFolder)至 3.4 倍(zipFile),隨輸入線性增加;修後約 120–165 MB 平坦.詳見報告.
- 無密碼:輸入 128→768 MB,RSS 約 124→165 MB,約 192 MB 起趨於平坦(V8/arrayBuffers 回收時機造成之浮動,非累積).
- 有密碼(ZipCrypto):JS 堆積之固定開銷較大,RSS 約 170–300 MB 且**隨 GC 時機浮動**(384 MB 輸入時 170–250 MB、768 MB 時 237 MB),不隨輸入增加.測試 MEM03 因此只驗大輸入時之絕對增量(< 輸入之 75%),不驗兩點間之增量.
- 斷言門檻之設計:新實作量測值需有 ≥ 1.6 倍餘裕、舊實作需 ≥ 2 倍違反,才不致在 CI 浮動時假紅,又能在退回整包組於記憶體時轉紅.

## 4. 專案環境備忘

- `src/mZip.mjs` 於工作目錄為 CRLF(`core.autocrlf=true`,索引為 LF);Edit 工具會保留 CRLF.以腳本讀取該檔做字串比對/變異時須先 `replaceAll('\r\n', '\n')`.
- 套件 `package.json` 之 test 為 `mocha --parallel`,各測試檔於不同 worker 行程,於測試內覆寫 `fs.*` 為行程內作用,不互相干擾;但 `test/_tmp/` 為共用根,各測試檔之 `after` 只能 `rmdirSync` 空目錄.
- 單檔 > 2 GiB:舊版 `fs.readFileSync` 直接 `ERR_FS_FILE_TOO_LARGE`,新版可處理;選用測試 ED04(`WZIP_TEST_BIG=1`)暫用約 2.1 GB 磁碟.
- 變異驗證:`WZIP_MOD=<變異版路徑>` 可使 `unit-zipStream.test.mjs` 改測任一 mZip 模組(舊版 `test/tools/mZipV1047.mjs` 亦可,用以示範修前紅);變異版之產生與彙整用 `node test/tools/mutateZip.mjs`.mocha 須帶 `--exit`:變異 M4(不 destroy)會使寫入串流永不關閉,mocha 因而不結束.
- Bash 工具之工作目錄會持續:曾於一次指令中 `cd` 出去,之後所有相對路徑(`./test/_tmp`、eslint 之 babel 設定)都指錯地方.補救是腳本內 `process.chdir(import.meta.dirname/..)`、`quiet-run --cwd <repo根>`,不再 `cd` 回來.
