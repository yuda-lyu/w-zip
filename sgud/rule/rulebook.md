# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

## R1 壓縮寫出側不得整包組於記憶體(記憶體用量不隨總容量增加)

- 規格來源:`建議w-zip調整.md`(Gitea issue #10)「zipFolder(與 zipFile)改以串流寫出…各檔以…分段讀取加入,記憶體用量不隨總容量增加」.
- 規則:`zipFile`/`zipFolder` 一律經 `writeZip`(`Writable.toWeb(fs.createWriteStream(fpOut))` 接 `ZipWriter`)寫出;來源檔案一律經 `addFile`(`createFileReader` 分段讀取)加入.寫出側不得使用 `Uint8ArrayWriter`、不得 `fs.writeFileSync` 整包寫、來源側不得 `fs.readFileSync`/`Uint8ArrayReader` 整檔讀入.
- 盤點指令與站點全集(2026-10-20,`src/mZip.mjs`):

  | 指令 | 站點 | 判準 |
  |---|---|---|
  | `Grep "Uint8ArrayWriter" src/mZip.mjs` | `unzip` 之 `entry.getData(new Uint8ArrayWriter())`、`readEntry` 之 `type:'u8'` | 讀取側,見 R8,刻意不套(本輪不改) |
  | `Grep "readFileSync\|writeFileSync" src/mZip.mjs` | `unzip` 之 `fs.readFileSync(fpSrc)`(整個壓縮檔)與 `fs.writeFileSync(p, u8)`(整個項目) | 讀取側,見 R8,待處理(未套) |
  | `Grep "new ZipWriter" src/mZip.mjs` | 僅 `writeZip` 1 處 | 已套 |
  | `Grep "zipWriter.add" src/mZip.mjs` | `zipFolder` 之目錄項(無內容)、`addFile` 之檔案 | 已套 |

- 對應測試:`test/unit-zipStream.test.mjs` MEM01(zipFolder 64→256 MB)、MEM02(zipFile 64→256 MB)、MEM03(zipFolder+密碼 384 MB)、ED04(選用 `WZIP_TEST_BIG=1`,單檔 2 GiB+1 位元組);指令 `npx mocha --no-parallel test/unit-zipStream.test.mjs --timeout 180000 --grep MEM`.
- 變異:`node test/tools/mutateZip.mjs [M編號]`(M1–M9,各自須使至少一條測試轉紅;2026-10-20 全數轉紅:M1 輸出整包組於記憶體→MEM01–03 等、M2 輸入整檔讀入→MEM02 等、M3 不關閉讀取代號、M4 不 destroy、M5 不等 close、M6 未知大小串流→EQ01、M7→ED06、M8→ER09、M9→ER10).`src/mZip.mjs` 改動後樣式可能不再命中而丟錯,須同步更新該工具之樣式.

## R2 項目大小須於加入前已知(產物不變:不得強制 zip64)

- 規則:加入檔案項目之 Reader 須帶 `size`(`createFileReader` 之 `init` 設定);不得以無大小之 `ReadableStream` 加入.
- 對應測試:EQ01(逐位元組相同)、EQ02/EQ03(`zip64` 欄位與舊產物相同,`summEntries`);變異 M6 須轉紅.

## R3 產物不變:以凍結之 1.0.47 為對照

- 規則:`test/tools/mZipV1047.mjs` 為 1.0.47(`967736a`)之 `src/mZip.mjs` 原樣凍結,其相依 `checkLevel.mjs`、`replaceTarget.mjs` 亦原樣凍結為同資料夾之 `checkLevelV1047.mjs`、`replaceTargetV1047.mjs`(僅 import 路徑不同),**三檔皆不得修改**(唯一例外:`mZipV1047.mjs` 之 `fsTreeFolder` 之層數參數隨 wsemi 之變更同步,2026-11-17 由 `null` 改 `4294967295`、2026-11-26 由 `4294967295` 改為省略第 2 參數,見 R9,皆僅傳值之變更,語意仍為窮舉全部層級).無密碼:凍結時間下新舊產物逐位元組相同;有密碼:結構(`summEntries`)相同、互相可解、錯誤密碼 reject、7z 可解.
- 對應測試:EQ01–EQ05.已知差異:無(項目時間取壓縮當下,與舊版相同,EQ05).
- 若 zip.js 升版使 EQ01 紅:先確認新舊於同一 zip.js 下是否仍相同(兩者同用一份 zip.js,理應相同);不同則為本套件寫出行為改變,須回查.

## R4 檔案代號與串流之關閉(成功與失敗路徑)

- 規則:`addFile` 於加入失敗時須關閉讀取代號且 reject 原始錯誤(不得被關閉錯誤取代);`createFileReader.close()` 冪等;`writeZip` 之 `catch` 必 `stream.destroy()`、`finally` 必 `await closed`(確認 `'close'` 後才返回)並自 `activeTemps` 移除暫存資料夾.
- 對應測試:ER01(寫出中途失敗)、ER02(既有目標壓縮檔位元組不變)、ER03(讀取來源中途失敗)、ER04(來源無法開啟)、ER05(成功)、ER06(前置檢查失敗不開串流)、ER07(同時多個與同一目標並發)、ED03(3000 檔);ER08(`fun` 拋出壓縮器以外之錯誤,串流仍關閉);ER10(讀取失敗又關閉失敗時為原始錯誤);ER11(關閉後才改名);ER12(結束階段失敗).變異 M3(不關閉讀取代號)、M4(不 destroy)、M5(不等 close)、M9(關閉錯誤覆蓋原始錯誤)須轉紅.

## R4b 同行程並發之暫存排除與虛擬檔案

- 規則:`zipFolder` 列舉來源時須排除所有進行中之暫存資料夾(`activeTemps`,於 `writeZip` 登記與移除),不只自己的(ER09,變異 M8).`addFile` 以 `createFileReader(fp, true)`,大小為 0 之檔案讀至檔尾(ED06,變異 M7);`readZip` 不用此選項.

## R5 replaceTarget 機制不變

- 規則:`replaceTarget`(暫存同層、成功才改名、失敗清除、備份還原)與 `getTargetError` 不修改;`writeZip` 只在 `fun(fpOut)` 內產出單一檔案.
- 對應測試:既有 `unit-mZip.test.mjs` TG01–TG08、ZF/ZD 系列;新增 ER01/ER02/ER08 之失敗路徑.

## R6 測試資料

- 測試資料於 `test/_tmp/zipStream/` 生成、`after` 刪除;大型測資總量 ≤ 2 GB 且用完即刪(MEM 單次最大 384 MB 輸入 + 約同大輸出;ED04 約 2.1 GB 為選用).測試程式不用 `./tmp/`.

## R7 輸入空間表(zipFile/zipFolder 寫出側)

| 軸 | 成員 | 已測 | 刻意不測/已知不修 |
|---|---|---|---|
| 函數 | zipFile、zipFolder | 全部 | — |
| 密碼 | 無、ZipCrypto | EQ03、MEM03、ER02、ER05 | AES(套件不提供) |
| level | 0、1、6、9、無效 | EQ01、ER05、既有 ZF05/ZD09 | 2–5、7–8(與已測同路徑) |
| 檔案大小 | 0、1、256 KiB±1、512 KiB±1、1 MiB(±1)、3 MiB、64–384 MB、2 GiB+1、stat 回報 0 但有內容 | EQ/ED01/MEM/ED04/ED06 | 單項 ≥ 4 GiB(zip64,磁碟與時間成本,未測) |
| 項目數 | 3000、66067(≥ 65535,zip64 中央目錄) | ED03、ED07(`WZIP_TEST_BIG=1`) | 數十萬項(`fsTreeFolder` 清單為 O(項目數),舊版同) |
| 結構 | 根空資料夾、巢狀空資料夾、深層 12 層、3000 檔、中文與特殊字元檔名 | EQ02、ED02、ED03、既有 ZD03/ZD04 | 符號連結(fsTreeFolder 既有行為,未動) |
| 來源於壓縮期間變動 | 讀取中縮短 | ED05 | 增長(以開啟時大小為界)、原地改寫(非一致快照,已寫入 JSDoc) |
| 失敗點 | 寫出中途、結束階段、讀取中途、開啟失敗、關閉失敗、列舉失敗、前置檢查、改名失敗 | ER01–ER12、既有 TG04 | 磁碟真滿(以 mock 寫出失敗代之)、行程被強制終止(暫存殘留,已寫入 JSDoc) |
| 並發 | 單一、多目標同時、同一目標同時、同一來源且目標在來源內 | ER07、ER09 | 跨行程(replaceTarget 既有限制) |
| 平台 | Windows 11(本機);CI 為 ubuntu(7z 相關測試於非 Windows 略過) | 全部於 Windows 跑過 | Linux/macOS 本機實跑未做 |
| 目標 | 已存在、不存在、位於來源內 | ER01/ER02、既有 ZF09/ZD08/TG08 | — |

## R9 遞迴列舉資料夾須窮舉者不給第 2 參數(wsemi 1.9.80 起),限層才給 `{ levelLimit: n }`,不得給數字

- 規格來源:wsemi 破壞性變更第 83 項(1.9.80):`fsTreeFolder`、`fsTreeFolderWithHash`、`fsGetFilesInFolder`、`fsGetFilesWithHashInFolder`、`fsGetFoldersInFolder` 及各 `*Core` 之第 2 參數由 `levelLimit`(舊預設 1 層)改為 `opt = {}`:`opt.levelLimit` 為有效正整數才限層,未給即窮舉全部層級;第 2 參數給了而非物件(含舊寫法之數字)拋 `invalid opt: must be an object`,第 3 個引數有給拋 `invalid arguments: must be fd and opt only`(回傳 Promise 者以 reject).歷史:1.9.63 起 `levelLimit` 給 `null` 取預設 1(Gitea 第 492 項第 2 批,W-11),1.9.63~1.9.79 窮舉須給 `4294967295`,該寫法於 1.9.80 起拋錯.
- 規則:凡遞迴列舉全部層級者(本套件為 `zipFolder`,JSDoc 規定含全部子資料夾與檔案)一律**不給第 2 參數**;須限層者給 `{ levelLimit: n }`;不得給數字(含 `4294967295`)、`null`、`Infinity`.
- 盤點指令:`git grep -nE "\b(fsTreeFolder|fsTreeFolderWithHash|fsGetFilesInFolder|fsGetFilesWithHashInFolder|fsGetFoldersInFolder)(Core)?\s*\(" -- . ':!dist' ':!docs'`(排除 `dist/`、`docs/` 之產生物;含 md).
- 站點全集(2026-11-26):

  | 站點 | 傳值 | 語意 | 判準 |
  |---|---|---|---|
  | `src/mZip.mjs:236` `zipFolder` 之 `fsTreeFolder(fpSrc)` | 省略 | 窮舉 | 已套 |
  | `test/tools/mZipV1047.mjs:254` 同 | 省略 | 窮舉 | 已套(凍結檔之唯一例外,見 R3) |
  | 其餘 4 個函數、`toolg/`、`g_*.mjs`、README、`.vue` | — | — | 0 站點 |

  2 站點之「省略」皆為本意之窮舉(非舊式「省略取 1 層」),重盤時勿誤判為舊形.
- 對應測試:`unit-mZip.test.mjs` ZD10(5 層子資料夾逐項列出,層數語意之直接斷言)、ZD01、`unit-zipStream.test.mjs` ED02(12 層)、EQ01–EQ04(新舊產物對照)等.
- 變異(2026-11-26,wsemi 1.9.80,鏡像根注入,跑 `unit-mZip` 與 `unit-zipStream`〔不含 MEM〕,對照組 62 passing、2 pending、0 紅):`src` 改 `{ levelLimit: 1 }` → 18 案紅(含 ZD10、ED02、ED03、EQ01–04);改 `{ levelLimit: 3 }` → 7 案紅(ZD10、ED02、EQ01–04、ER07);凍結檔單獨改 `{ levelLimit: 1 }` → EQ01–03 紅;`src` 退回舊寫法(`4294967295`)→ 31 案紅(`invalid opt: must be an object`).
- 注意:`src` 與凍結檔兩側皆只列第 1 層時 EQ01 仍綠(新舊同樣漏列,逐位元組相同,為假綠;實測 17 案紅之名單不含 EQ01),只有 ZD、ED、EQ02–04 等以內容往返為斷言者會紅;兩側須同步,只改其一則 EQ01 轉紅.

## R8 讀取側盤點(2026-10-20,只列報告,本輪不改)

- `unzip`:整個壓縮檔 `fs.readFileSync` 入記憶體(>2 GiB 直接失敗),每個項目以 `Uint8ArrayWriter` 整個解出後 `writeFileSync`(單一項目須放得進記憶體).為獨立路徑,與 zip 寫出不共用(僅 `readZip` 之 `createFileReader` 共用,行為不變).
- `listEntries`/`readEntry`:給檔案路徑時為隨機讀取(只讀中央目錄與所需項目);`readEntry` 回傳值本身即項目全量(API 設計).
- `m7z`:交外部 7z 行程,node 端不載入內容.
