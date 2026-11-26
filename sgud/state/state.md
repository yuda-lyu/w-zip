# 狀態(現況)

本檔記當前已開發功能之最新狀態:各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本.只記現況,不寫過程(過程見經驗檔).更新:2026-11-26.

- 套件:`w-zip`(zip 與 7z 之壓縮與解壓縮);`package.json` 版本 1.0.83,本輪未發布.
- 指引文件:本套件規則帳本與經驗仍為舊制根目錄檔(`CLAUDE_rulebook.md`、`CLAUDE_experience.md`),未遷移;`sgud/` 目前只有本檔與 `sgud/feedback/feedback.md`.

## 功能與規則對照

| 功能 | 規則帳本 | 測試檔 | 狀態 |
|---|---|---|---|
| `zipFolder` 遞迴列舉來源資料夾之全部層級(wsemi 1.9.80 起省略第 2 參數即窮舉) | R9(`CLAUDE_rulebook.md`) | `test/unit-mZip.test.mjs` ZD10、ZD01;`test/unit-zipStream.test.mjs` ED02、EQ01–EQ04 | 已套:`src/mZip.mjs:236` 與凍結對照檔 `test/tools/mZipV1047.mjs:254` 皆 `fsTreeFolder(fpSrc)` |
| 壓縮寫出側串流、項目大小已知、產物不變、關閉與失敗處理 | R1–R5(`CLAUDE_rulebook.md`) | `test/unit-zipStream.test.mjs`、`test/unit-mZip.test.mjs` | 已套(本輪未改動) |

## 測試

- `npm test`(`mocha --parallel "test/*.test.mjs" --timeout 180000`):2026-11-26(本機 Windows、wsemi 1.9.80)154 案通過、3 案略過.

## 已知缺口與待辦

- 讀取側(`unzip` 整檔讀入、單項須放得進記憶體)見規則帳本 R8,本輪未改.
- 無新增缺口.
