import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import zlib from 'zlib'
import assert from 'assert'
import { pathToFileURL } from 'url'
import { ZipReader, ZipWriter, Uint8ArrayReader } from '@zip.js/zip.js'
import legacy from './tools/mZipV1047.mjs'
import { has7z, run7z, buildSrcTree, zipEntries, zipEntriesLazy, getRejection, errMsg, sha, assertSameTree, mb, writeRandomFile, buildBigTree, probeZip, spyFs, spyWriteStream, freezeDate, withTimeout } from './tools/helpers.mjs'


//fpMod, 受測之mZip模組位置, 預設為src/mZip.mjs, 環境變數WZIP_MOD可指向變異版或舊版(test/tools/mZipV1047.mjs)以驗證測試確實抓得到整包組於記憶體
let fpMod = path.resolve(process.env.WZIP_MOD || './src/mZip.mjs')
let mm = (await import(pathToFileURL(fpMod).href)).default


//listWzip, 列出資料夾內暫存或備份(名稱含.wzip-)之項目
function listWzip(fd) {
    return fs.readdirSync(fd).filter((v) => v.includes('.wzip-'))
}


//summEntries, 以zip.js直接讀取壓縮檔之各項目重要欄位(不含時間), 用以比對新舊產物之結構(含是否使用zip64、壓縮方法、加密方式)
async function summEntries(fp) {
    let es = await zipEntries(fp)
    return es.map((e) => {
        return {
            filename: e.filename,
            directory: e.directory,
            encrypted: e.encrypted,
            zipCrypto: e.zipCrypto,
            zip64: e.zip64,
            compressionMethod: e.compressionMethod,
            uncompressedSize: e.uncompressedSize,
            compressedSize: e.compressedSize,
            signature: e.signature,
        }
    })
}


//buildEdgeTree, 建立邊界來源資料夾: 空資料夾與巢狀空資料夾、0與1位元組檔、讀取分段(zip.js預設chunkSize為256KiB)邊界前後大小之檔、可壓縮大檔、深層路徑、中文與特殊字元檔名
function buildEdgeTree(dir) {
    fs.mkdirSync(path.join(dir, 'empty'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'nested', 'e1', 'e2', 'e3'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'sizes'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'sizes', 'zero.bin'), '')
    for (let n of [1, 262143, 262144, 262145, 524287, 524288, 524289, 1048576, 1048577]) {
        fs.writeFileSync(path.join(dir, 'sizes', `rand-${n}.bin`), crypto.randomBytes(n))
    }
    fs.writeFileSync(path.join(dir, 'sizes', 'text-3mb.txt'), 'abc,中文,0123456789\n'.repeat(160000) + 'end')
    let deep = path.join(dir, ...Array.from({ length: 12 }, (_, i) => `lv${String(i + 1).padStart(2, '0')}`))
    fs.mkdirSync(deep, { recursive: true })
    fs.writeFileSync(path.join(deep, 'deep.txt'), 'deep content 深層內容')
    fs.mkdirSync(path.join(dir, '中文 目錄#1'), { recursive: true })
    fs.writeFileSync(path.join(dir, '中文 目錄#1', '特殊 名稱%2&3+4 (副本),[x]=@!~.txt'), '特殊字元檔名內容')
    fs.writeFileSync(path.join(dir, '𠮷野家.txt'), '罕用字檔名內容')
    return dir
}


describe('zipStream', function() {

    this.timeout(180000) //含256MB與384MB之記憶體量測, 單獨執行時不依賴runner之--timeout

    let fdTmp = './test/_tmp/zipStream'
    let fdEdge = `${fdTmp}/edgeTree`
    let fdSrc = `${fdTmp}/srcTree`
    let pw = 'abc'

    before(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        buildSrcTree(fdSrc)
        buildEdgeTree(fdEdge)
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        try {
            fs.rmdirSync('./test/_tmp') //僅於已無其他測試暫存時移除
        }
        catch (err) {}
    })

    describe('產物不變(與修改前1.0.47比對)', function() {

        //規格: 建議w-zip調整.md「介面與產物維持不變(壓縮檔內之根資料夾、空資料夾、密碼、level 等行為相同)」; 凍結時間後新舊產物應逐位元組相同(含項目順序、標頭、zip64旗標、壓縮資料)
        it('EQ01 無密碼時各level之zipFolder與zipFile產物與舊版逐位元組相同', async function() {
            let fd = `${fdTmp}/eq01`
            let srcFile = `${fdEdge}/sizes/text-3mb.txt`
            for (let level of [0, 1, 6, 9]) {
                await freezeDate(async () => {
                    await legacy.zipFolder(fdEdge, `${fd}/old-d${level}.zip`, { level })
                    await mm.zipFolder(fdEdge, `${fd}/new-d${level}.zip`, { level })
                    await legacy.zipFile(srcFile, `${fd}/old-f${level}.zip`, { level })
                    await mm.zipFile(srcFile, `${fd}/new-f${level}.zip`, { level })
                })
                for (let k of ['d', 'f']) {
                    let a = fs.readFileSync(`${fd}/old-${k}${level}.zip`)
                    let b = fs.readFileSync(`${fd}/new-${k}${level}.zip`)
                    let diffAt = a.length === b.length ? a.findIndex((v, i) => v !== b[i]) : Math.min(a.length, b.length)
                    assert.ok(a.equals(b), `level ${level} ${k}: 長度 ${a.length}/${b.length}, 首個差異位置 ${diffAt}`)
                }
            }
            assert.strict.deepEqual(listWzip(fd), [])
        })

        //規格: 同上; 新產物以舊版(1.0.47)unzip與readEntry讀取、舊產物以新版讀取, 解壓後逐檔內容、路徑、空資料夾集合皆與來源相同
        it('EQ02 新產物可由舊版unzip與readEntry還原, 舊產物可由新版還原, 項目清單相同', async function() {
            let fd = `${fdTmp}/eq02`
            await legacy.zipFolder(fdEdge, `${fd}/old.zip`)
            await mm.zipFolder(fdEdge, `${fd}/new.zip`)
            assert.strict.deepEqual(await summEntries(`${fd}/new.zip`), await summEntries(`${fd}/old.zip`))
            await legacy.unzip(`${fd}/new.zip`, `${fd}/outLegacyOfNew`)
            await mm.unzip(`${fd}/old.zip`, `${fd}/outNewOfOld`)
            await mm.unzip(`${fd}/new.zip`, `${fd}/outNewOfNew`)
            for (let o of ['outLegacyOfNew', 'outNewOfOld', 'outNewOfNew']) {
                assertSameTree(fdEdge, `${fd}/${o}/edgeTree`)
            }
            let names = (await legacy.listEntries(`${fd}/new.zip`)).map((v) => v.filename)
            assert.strict.deepEqual(names, (await legacy.listEntries(`${fd}/old.zip`)).map((v) => v.filename))
            assert.ok(names.includes('edgeTree/'), '根資料夾項')
            assert.ok(names.includes('edgeTree/empty/') && names.includes('edgeTree/nested/e1/e2/e3/'), '空資料夾項')
            let exp = fs.readFileSync(`${fdEdge}/sizes/rand-524289.bin`)
            assert.ok(Buffer.from(await legacy.readEntry(`${fd}/new.zip`, 'edgeTree/sizes/rand-524289.bin', { type: 'u8' })).equals(exp))
            await legacy.zipFile(`${fdEdge}/sizes/rand-524289.bin`, `${fd}/oldf.zip`)
            await mm.zipFile(`${fdEdge}/sizes/rand-524289.bin`, `${fd}/newf.zip`)
            assert.strict.deepEqual(await summEntries(`${fd}/newf.zip`), await summEntries(`${fd}/oldf.zip`))
            assert.ok(Buffer.from(await legacy.readEntry(`${fd}/newf.zip`, 'rand-524289.bin', { type: 'u8' })).equals(exp))
        })

        //規格: 同上(密碼); 加密檔以ZipCrypto, 同密碼可由舊版解開, 錯誤或未給密碼reject, 結構與舊產物相同(隨機加密標頭使位元組不同故不逐位元組比對)
        it('EQ03 給密碼時新產物為ZipCrypto, 可由舊版以同密碼解開, 錯誤或無密碼reject, 結構與舊產物相同', async function() {
            let fd = `${fdTmp}/eq03`
            await legacy.zipFolder(fdEdge, `${fd}/old.zip`, { pw })
            await mm.zipFolder(fdEdge, `${fd}/new.zip`, { pw })
            let sNew = await summEntries(`${fd}/new.zip`)
            assert.strict.deepEqual(sNew, await summEntries(`${fd}/old.zip`))
            assert.ok(sNew.filter((v) => !v.directory).every((v) => v.encrypted && v.zipCrypto), '檔案項目皆ZipCrypto加密')
            await legacy.unzip(`${fd}/new.zip`, `${fd}/outLegacyOfNew`, { pw })
            await mm.unzip(`${fd}/old.zip`, `${fd}/outNewOfOld`, { pw })
            assertSameTree(fdEdge, `${fd}/outLegacyOfNew/edgeTree`)
            assertSameTree(fdEdge, `${fd}/outNewOfOld/edgeTree`)
            for (let opt of [{}, { pw: 'abd' }]) {
                assert.ok(await getRejection(legacy.unzip(`${fd}/new.zip`, `${fd}/outBad`, opt)), JSON.stringify(opt))
                assert.ok(await getRejection(mm.unzip(`${fd}/new.zip`, `${fd}/outBad`, opt)), JSON.stringify(opt))
            }
            await legacy.zipFile(`${fdEdge}/sizes/text-3mb.txt`, `${fd}/oldf.zip`, { pw })
            await mm.zipFile(`${fdEdge}/sizes/text-3mb.txt`, `${fd}/newf.zip`, { pw })
            assert.strict.deepEqual(await summEntries(`${fd}/newf.zip`), await summEntries(`${fd}/oldf.zip`))
            assert.strict.equal(await legacy.readEntry(`${fd}/newf.zip`, 'text-3mb.txt', { pw }), fs.readFileSync(`${fdEdge}/sizes/text-3mb.txt`, 'utf8'))
            //密碼與level之組合、非ASCII密碼: 新產物結構與舊產物相同, 且可由舊版以同密碼解開
            for (let [i, opt] of [{ pw, level: 0 }, { pw: '密碼abc', level: 1 }].entries()) {
                await legacy.zipFolder(fdEdge, `${fd}/old${i}.zip`, opt)
                await mm.zipFolder(fdEdge, `${fd}/new${i}.zip`, opt)
                assert.strict.deepEqual(await summEntries(`${fd}/new${i}.zip`), await summEntries(`${fd}/old${i}.zip`), JSON.stringify(opt))
                await legacy.unzip(`${fd}/new${i}.zip`, `${fd}/outV${i}`, { pw: opt.pw })
                assertSameTree(fdEdge, `${fd}/outV${i}/edgeTree`)
            }
        })

        //規格: 同上; 以獨立工具7-Zip驗證新產物之完整性、解壓內容與加密方式
        it('EQ04 7-Zip獨立驗證新產物(含密碼)之完整性與解壓內容', async function() {
            if (!has7z()) {
                this.skip()
            }
            let fd = `${fdTmp}/eq04`
            await mm.zipFolder(fdEdge, `${fd}/a.zip`)
            await mm.zipFolder(fdEdge, `${fd}/pw.zip`, { pw })
            assert.strict.equal(run7z(['t', `${fd}/a.zip`]).code, 0)
            assert.strict.equal(run7z(['t', `-p${pw}`, `${fd}/pw.zip`]).code, 0)
            assert.match(run7z(['l', '-slt', `${fd}/pw.zip`]).out, /Method = ZipCrypto/)
            assert.strict.equal(run7z(['x', `-o${fd}/out7z`, '-y', `${fd}/a.zip`]).code, 0)
            assert.strict.equal(run7z(['x', `-o${fd}/out7zPW`, `-p${pw}`, '-y', `${fd}/pw.zip`]).code, 0)
            assertSameTree(fdEdge, `${fd}/out7z/edgeTree`)
            assertSameTree(fdEdge, `${fd}/out7zPW/edgeTree`)
        })

        //規格: 同上(檔案時間); 舊版項目時間為壓縮當下而非來源檔修改時間, 新版維持
        it('EQ05 項目時間為壓縮當下, 不取來源檔修改時間(與舊版相同)', async function() {
            let fd = `${fdTmp}/eq05`
            let fdIn = `${fd}/in`
            fs.mkdirSync(fdIn, { recursive: true })
            fs.writeFileSync(`${fdIn}/old.txt`, 'old file')
            let past = new Date('2001-01-01T00:00:00Z')
            fs.utimesSync(`${fdIn}/old.txt`, past, past)
            let t0 = Date.now()
            await legacy.zipFolder(fdIn, `${fd}/old.zip`)
            await mm.zipFolder(fdIn, `${fd}/new.zip`)
            let t1 = Date.now()
            for (let fp of [`${fd}/old.zip`, `${fd}/new.zip`]) {
                let es = await zipEntries(fp)
                assert.strict.equal(es.length, 2)
                for (let e of es) {
                    let t = e.lastModDate.getTime()
                    assert.ok(t >= t0 - 4000 && t <= t1 + 4000, `${fp} ${e.filename} ${e.lastModDate.toISOString()}`) //DOS時間精度2秒
                }
            }
        })

    })

    describe('邊界', function() {

        //規格: 建議w-zip調整.md「各檔以…分段讀取加入」; 檔案大小落在分段讀取(zip.js預設chunkSize 256KiB)邊界前後、0與1位元組時內容不得遺漏或重複
        it('ED01 單檔大小於分段讀取邊界前後皆可往返', async function() {
            let fd = `${fdTmp}/ed01`
            for (let name of fs.readdirSync(`${fdEdge}/sizes`)) {
                let fp = `${fd}/${name}.zip`
                await mm.zipFile(`${fdEdge}/sizes/${name}`, fp)
                let u8 = await mm.readEntry(fp, name, { type: 'u8' })
                assert.ok(Buffer.from(u8).equals(fs.readFileSync(`${fdEdge}/sizes/${name}`)), name)
            }
        })

        //規格: JSDoc「含全部子資料夾與檔案，空資料夾亦保留」; 邊界樹含巢狀空資料夾、深層路徑、中文與特殊字元檔名
        it('ED02 邊界來源樹(空資料夾、深層路徑、中文與特殊字元檔名)往返後結構與內容相同', async function() {
            let fd = `${fdTmp}/ed02`
            await mm.zipFolder(fdEdge, `${fd}/a.zip`)
            await mm.unzip(`${fd}/a.zip`, `${fd}/out`)
            assertSameTree(fdEdge, `${fd}/out/edgeTree`)
            let names = (await mm.listEntries(`${fd}/a.zip`)).map((v) => v.filename)
            assert.ok(names.includes('edgeTree/中文 目錄#1/特殊 名稱%2&3+4 (副本),[x]=@!~.txt'))
            assert.ok(names.includes('edgeTree/𠮷野家.txt'))
            assert.ok(names.includes('edgeTree/lv01/lv02/lv03/lv04/lv05/lv06/lv07/lv08/lv09/lv10/lv11/lv12/deep.txt'))
        })

        //規格: 建議w-zip調整.md「記憶體用量不隨總容量增加」(檔數面); 大檔數時每個檔案代號皆關閉且結果完整
        it('ED03 3000個小檔往返後結構與內容相同, 檔案代號與寫入串流皆關閉', async function() {
            let fd = `${fdTmp}/ed03`
            let fdMany = `${fd}/many`
            for (let i = 0; i < 3000; i++) {
                let fdi = `${fdMany}/d${i % 30}`
                fs.mkdirSync(fdi, { recursive: true })
                fs.writeFileSync(`${fdi}/f${i}.txt`, `file ${i} `.repeat(i % 50))
            }
            let sw = await spyWriteStream(() => spyFs(() => mm.zipFolder(fdMany, `${fd}/many.zip`)))
            assert.strict.equal(sw.error, undefined, String(sw.error))
            assert.strict.equal(sw.result.error, undefined, String(sw.result.error))
            assert.strict.equal(sw.result.opened, 3000)
            assert.strict.equal(sw.result.closed, 3000)
            assert.strict.deepEqual([sw.opened, sw.closed], [1, 1])
            await mm.unzip(`${fd}/many.zip`, `${fd}/out`)
            assertSameTree(fdMany, `${fd}/out/many`)
            assert.strict.deepEqual(listWzip(fd), [])
        })

        //規格: 建議w-zip調整.md「各檔以…分段讀取加入」; 來源檔案於分段讀取中途縮短(舊版為一次讀入故無此情形)時, 不得產出損毀之壓縮檔: 項目內容為實際讀到之前段、CRC32與大小自洽
        it('ED05 來源檔案於讀取中途縮短時仍產出自洽之壓縮檔(內容為實際讀到之前段)', async function() {
            let fd = `${fdTmp}/ed05`
            fs.mkdirSync(fd, { recursive: true })
            let fpSrc = `${fd}/shrink.bin`
            writeRandomFile(fpSrc, 1024 * 1024)
            let st = await spyFs(() => mm.zipFile(fpSrc, `${fd}/a.zip`), { eofAt: (fp, nth) => nth >= 2 })
            assert.strict.equal(st.error, undefined, String(st.error))
            let es = await mm.listEntries(`${fd}/a.zip`)
            assert.strict.equal(es.length, 1)
            assert.ok(es[0].uncompressedSize > 0 && es[0].uncompressedSize < 1024 * 1024, `uncompressedSize ${es[0].uncompressedSize}`)
            let u8 = await mm.readEntry(`${fd}/a.zip`, 'shrink.bin', { type: 'u8' }) //讀出時驗證CRC32
            assert.ok(Buffer.from(u8).equals(fs.readFileSync(fpSrc).subarray(0, u8.length)))
            assert.strict.equal(u8.length, es[0].uncompressedSize)
            assert.strict.deepEqual(listWzip(fd), [])
        })

        //規格: 建議w-zip調整.md「介面與產物維持不變」; 舊版以fs.readFileSync讀入, 對宣告大小為0但仍有內容之檔案(如Linux之/proc下虛擬檔案)讀至檔尾, 新版不得因stat.size為0而漏掉內容(以stat回報0之替身模擬), 真正之空檔仍為空項目
        it('ED06 宣告大小為0但仍有內容之檔案讀至檔尾而不漏內容, 真正之空檔仍為空項目', async function() {
            let fd = `${fdTmp}/ed06`
            let fdIn = `${fd}/in`
            fs.mkdirSync(fdIn, { recursive: true })
            writeRandomFile(`${fdIn}/virtual.bin`, 1024 * 1024 + 17)
            fs.writeFileSync(`${fdIn}/empty.bin`, '')
            let st = await spyFs(() => mm.zipFile(`${fdIn}/virtual.bin`, `${fd}/a.zip`), { statSize: () => 0 })
            assert.strict.equal(st.error, undefined, String(st.error))
            let u8 = await mm.readEntry(`${fd}/a.zip`, 'virtual.bin', { type: 'u8' })
            assert.ok(Buffer.from(u8).equals(fs.readFileSync(`${fdIn}/virtual.bin`)))
            let sf = await spyFs(() => mm.zipFolder(fdIn, `${fd}/b.zip`), { statSize: () => 0 })
            assert.strict.equal(sf.error, undefined, String(sf.error))
            await mm.unzip(`${fd}/b.zip`, `${fd}/out`)
            assertSameTree(fdIn, `${fd}/out/in`)
            assert.strict.equal(sf.closed, sf.opened)
        })

        //規格: 建議w-zip調整.md「介面與產物維持不變」; 項目數超過65535(zip64中央目錄)時新舊產物亦逐位元組相同且項目數正確(需WZIP_TEST_BIG=1, 建立66000個極小檔, 用畢即刪)
        it('ED07 項目數超過65535時產物與舊版逐位元組相同(需WZIP_TEST_BIG=1)', async function() {
            if (process.env.WZIP_TEST_BIG !== '1') {
                this.skip()
            }
            this.timeout(900000)
            let fd = `${fdTmp}/ed07`
            let fdMany = `${fd}/many`
            for (let i = 0; i < 66; i++) {
                fs.mkdirSync(`${fdMany}/d${i}`, { recursive: true })
                for (let j = 0; j < 1000; j++) {
                    fs.writeFileSync(`${fdMany}/d${i}/${j}.txt`, String(j % 10))
                }
            }
            try {
                await freezeDate(async () => {
                    await legacy.zipFolder(fdMany, `${fd}/old.zip`)
                    await mm.zipFolder(fdMany, `${fd}/new.zip`)
                })
                assert.ok(fs.readFileSync(`${fd}/old.zip`).equals(fs.readFileSync(`${fd}/new.zip`)))
                assert.strict.equal((await mm.listEntries(`${fd}/new.zip`)).length, 66000 + 66 + 1)
                if (has7z()) {
                    assert.strict.equal(run7z(['t', `${fd}/new.zip`]).code, 0)
                }
            }
            finally {
                fs.rmSync(fd, { recursive: true, force: true })
            }
        })

        //規格: 建議w-zip調整.md「記憶體用量不隨總容量增加」「可能超過單一 Buffer 之上限」; 舊版整檔讀入(fs.readFileSync)無法處理大於2GiB之檔案, 新版分段讀取可處理(需設定WZIP_TEST_BIG=1, 暫用約2.1GB磁碟, 用畢即刪)
        it('ED04 單檔大於2GiB可壓縮且記憶體不隨檔案大小增加(需WZIP_TEST_BIG=1)', async function() {
            if (process.env.WZIP_TEST_BIG !== '1') {
                this.skip()
            }
            this.timeout(900000)
            let fd = `${fdTmp}/ed04`
            let fpBig = `${fd}/big.bin`
            let size = 2 ** 31 + 1
            fs.mkdirSync(fd, { recursive: true })
            let h = fs.openSync(fpBig, 'w')
            try {
                let zeros = Buffer.alloc(8 * mb)
                for (let left = size; left > 0; left -= zeros.length) {
                    fs.writeSync(h, zeros, 0, Math.min(left, zeros.length))
                }
            }
            finally {
                fs.closeSync(h)
            }
            try {
                let r = probeZip(fpMod, 'zipFile', fpBig, `${fd}/big.zip`)
                console.log(`        [記憶體] zipFile ${(size / mb).toFixed(0)}MB(單檔): maxRSS ${(r.maxRSS / mb).toFixed(0)}MB, 耗時 ${r.ms}ms`)
                assert.ok(r.maxRSS - r.base.rss < 0.2 * 1024 * mb, `maxRSS增量 ${(r.maxRSS - r.base.rss) / mb}MB`)
                let es = await mm.listEntries(`${fd}/big.zip`)
                assert.strict.equal(es.length, 1)
                assert.strict.equal(es[0].uncompressedSize, size)
                let zr = new ZipReader(new Uint8ArrayReader(fs.readFileSync(`${fd}/big.zip`)), { checkCrc32: true })
                let entry = (await zr.getEntries())[0]
                let n = 0
                let sink = new WritableStream({
                    write(chunk) {
                        n += chunk.length
                    }
                })
                await entry.getData(sink) //解出時驗證CRC32
                await zr.close()
                assert.strict.equal(n, size)
            }
            finally {
                fs.rmSync(fd, { recursive: true, force: true })
            }
        })

    })

    describe('記憶體', function() {

        let fdMem = `${fdTmp}/mem`

        //assertFullZip, 斷言壓縮檔內檔案項目與來源檔案逐一對應(名稱、未壓縮大小、CRC32), 確認量測時確實完整處理了全部輸入(於量測行程之外驗證, 不影響量測值)
        let assertFullZip = async (fpZip, srcs) => {
            let es = (await zipEntriesLazy(fpZip)).filter((e) => !e.directory)
            assert.strict.deepEqual(es.map((e) => e.filename).sort(), srcs.map((s) => s.name).sort())
            for (let s of srcs) {
                let e = es.find((v) => v.filename === s.name)
                let b = fs.readFileSync(s.fp)
                assert.strict.equal(e.uncompressedSize, b.length, `${s.name} 大小`)
                assert.strict.equal(e.signature, zlib.crc32(b), `${s.name} CRC32`)
            }
        }

        //probeFolder, 建立總量sizeMB(8個檔案)之隨機資料夾並於獨立行程執行zipFolder, 驗證產物完整後回傳量測結果
        let probeFolder = async (sizeMB, pwd = '') => {
            fs.rmSync(fdMem, { recursive: true, force: true })
            buildBigTree(`${fdMem}/src`, 8, sizeMB / 8)
            let r = probeZip(fpMod, 'zipFolder', `${fdMem}/src`, `${fdMem}/out.zip`, '', pwd)
            let srcs = Array.from({ length: 8 }, (_, i) => ({ name: `src/d${i % 3}/f${i}.bin`, fp: `${fdMem}/src/d${i % 3}/f${i}.bin` }))
            await assertFullZip(`${fdMem}/out.zip`, srcs)
            fs.rmSync(fdMem, { recursive: true, force: true })
            return r
        }

        //probeFile, 建立sizeMB之單一隨機檔案並於獨立行程執行zipFile, 驗證產物完整後回傳量測結果
        let probeFile = async (sizeMB) => {
            fs.rmSync(fdMem, { recursive: true, force: true })
            writeRandomFile(`${fdMem}/src.bin`, sizeMB * mb)
            let r = probeZip(fpMod, 'zipFile', `${fdMem}/src.bin`, `${fdMem}/out.zip`)
            await assertFullZip(`${fdMem}/out.zip`, [{ name: 'src.bin', fp: `${fdMem}/src.bin` }])
            fs.rmSync(fdMem, { recursive: true, force: true })
            return r
        }

        //assertAbs, 斷言以largeMB(不可壓縮, 壓縮檔與輸入約同大)為輸入時, maxRSS與arrayBuffers峰值較啟動時之增量皆小於輸入之absRatio倍(舊版整包組於記憶體者為2倍以上)
        let assertAbs = (name, rl, largeMB, absRatio) => {
            let absRss = (rl.maxRSS - rl.base.rss) / mb
            let absAb = (rl.peakArrayBuffers - rl.base.arrayBuffers) / mb
            console.log(`        [記憶體] ${name} ${largeMB}MB: maxRSS ${(rl.maxRSS / mb).toFixed(0)}MB(較啟動時增加${absRss.toFixed(0)}MB), 峰值arrayBuffers增加${absAb.toFixed(0)}MB, 耗時 ${rl.ms}ms`)
            assert.ok(absRss < absRatio * largeMB, `${name}: ${largeMB}MB時maxRSS較啟動時增加${absRss.toFixed(0)}MB(須小於輸入之${absRatio * 100}%)`)
            assert.ok(absAb < absRatio * largeMB, `${name}: ${largeMB}MB時arrayBuffers峰值增加${absAb.toFixed(0)}MB(須小於輸入之${absRatio * 100}%)`)
        }

        //assertBounded, 斷言輸入總量由smallMB增為largeMB時, maxRSS增量小於輸入增量之35%(固定開銷如JS堆積之落差不計), 且largeMB時之絕對增量小於輸入之50%
        let assertBounded = (name, rs, rl, smallMB, largeMB) => {
            let incRss = (rl.maxRSS - rs.maxRSS) / mb
            let incIn = largeMB - smallMB
            console.log(`        [記憶體] ${name} ${smallMB}MB→${largeMB}MB: maxRSS ${(rs.maxRSS / mb).toFixed(0)}→${(rl.maxRSS / mb).toFixed(0)}MB, 耗時 ${rs.ms}→${rl.ms}ms`)
            assert.ok(incRss < 0.35 * incIn, `${name}: 輸入增加${incIn}MB, maxRSS增加${incRss.toFixed(0)}MB(須小於輸入增量之35%)`)
            assertAbs(name, rl, largeMB, 0.5)
        }

        //規格: 建議w-zip調整.md「記憶體用量不隨總容量增加」
        it('MEM01 zipFolder之記憶體峰值不隨來源總量增加(64MB對256MB)', async function() {
            assertBounded('zipFolder', await probeFolder(64), await probeFolder(256), 64, 256)
        })

        //規格: 同上(zipFile)
        it('MEM02 zipFile之記憶體峰值不隨來源檔案大小增加(64MB對256MB)', async function() {
            assertBounded('zipFile', await probeFile(64), await probeFile(256), 64, 256)
        })

        //規格: 同上(密碼); ZipCrypto於JS堆積之固定開銷較大且隨GC時機浮動(實測384MB時maxRSS約170至300MB, 768MB時未再增加, 舊版為1006MB增量), 故只驗大輸入時之絕對增量小於輸入之90%
        it('MEM03 zipFolder給密碼時記憶體峰值仍遠小於來源總量(384MB)', async function() {
            assertAbs('zipFolder+pw', await probeFolder(384, pw), 384, 0.9)
        })

    })

    describe('失敗與清理', function() {

        //mkTree, 建立3個各1MB之隨機檔案之來源資料夾
        let mkTree = (fd) => {
            buildBigTree(fd, 3, 1)
            return fd
        }

        //規格: 建議w-zip調整.md「現有之 replaceTarget 機制不變，成功後才改名為目標」; JSDoc「操作失敗時不變動既有目標」; 寫出中途失敗(如磁碟空間不足)時既有目標不變、暫存清除、寫入串流關閉, 且之後再壓縮可成功
        it('ER01 寫出壓縮檔中途失敗時既有目標不變, 暫存清除, 寫入串流關閉', async function() {
            let fd = `${fdTmp}/er01`
            let fdIn = mkTree(`${fd}/in`)
            for (let [name, fun] of [['zipFolder', (t) => mm.zipFolder(fdIn, t)], ['zipFile', (t) => mm.zipFile(`${fdIn}/d0/f0.bin`, t)]]) {
                let fpTar = `${fd}/${name}.zip`
                fs.writeFileSync(fpTar, 'existing')
                let st = await spyWriteStream(() => fun(fpTar), { failAfter: 600 * 1024 })
                assert.match(errMsg(st.error), /mock write failure/, name)
                assert.ok(st.bytesWritten > 0, `${name}: 應已寫入部分資料才失敗`)
                assert.strict.deepEqual([st.opened, st.closed], [1, 1], `${name}: 寫入串流開啟/關閉數`)
                assert.strict.equal(fs.readFileSync(fpTar, 'utf8'), 'existing', name)
                assert.strict.deepEqual(listWzip(fd), [], name)
                await fun(fpTar) //失敗後再壓縮可成功
                assert.ok((await mm.listEntries(fpTar)).length >= 1, name)
            }
        })

        //規格: 同上; 既有目標為真實壓縮檔時位元組不變
        it('ER02 寫出中途失敗時既有目標壓縮檔位元組不變', async function() {
            let fd = `${fdTmp}/er02`
            let fdIn = mkTree(`${fd}/in`)
            let fpTar = `${fd}/exist.zip`
            await mm.zipFolder(fdSrc, fpTar)
            let before = sha(fpTar)
            let st = await spyWriteStream(() => mm.zipFolder(fdIn, fpTar, { pw }), { failAfter: 600 * 1024 })
            assert.match(errMsg(st.error), /mock write failure/)
            assert.strict.equal(sha(fpTar), before)
            assert.strict.deepEqual(fs.readdirSync(fd).sort(), ['exist.zip', 'in'])
        })

        //規格: 同上; 讀取來源檔案中途失敗(第2個檔案之第2次讀取)時既有目標不變、暫存清除、讀取代號與寫入串流皆關閉
        it('ER03 讀取來源檔案中途失敗時既有目標不變, 暫存清除, 檔案代號與寫入串流皆關閉', async function() {
            let fd = `${fdTmp}/er03`
            let fdIn = mkTree(`${fd}/in`)
            let fpTar = `${fd}/a.zip`
            fs.writeFileSync(fpTar, 'existing')
            let readError = (fp, nth) => fp.replaceAll('\\', '/').endsWith('/d1/f1.bin') && nth === 2 ? new Error('mock read failure') : null
            let sw = await spyWriteStream(() => spyFs(() => mm.zipFolder(fdIn, fpTar), { readError }))
            let st = sw.result
            assert.match(errMsg(st.error), /mock read failure/)
            assert.ok(st.opened >= 2, `應已開啟至少2個來源檔, 實際${st.opened}`)
            assert.strict.equal(st.closed, st.opened, '來源檔案代號開啟/關閉數')
            assert.strict.deepEqual([sw.opened, sw.closed], [1, 1], '寫入串流開啟/關閉數')
            assert.strict.equal(fs.readFileSync(fpTar, 'utf8'), 'existing')
            assert.strict.deepEqual(listWzip(fd), [])
        })

        //規格: 同上; 來源檔案無法開啟(如被占用)時reject, 既有目標不變、暫存清除、寫入串流關閉
        it('ER04 來源檔案無法開啟時reject, 既有目標不變, 暫存清除, 寫入串流關閉', async function() {
            let fd = `${fdTmp}/er04`
            let fdIn = mkTree(`${fd}/in`)
            let fpTar = `${fd}/a.zip`
            fs.writeFileSync(fpTar, 'existing')
            let openError = (fp) => fp.replaceAll('\\', '/').endsWith('/d2/f2.bin') ? new Error('mock open failure') : null
            let sw = await spyWriteStream(() => spyFs(() => mm.zipFolder(fdIn, fpTar), { openError }))
            let st = sw.result
            assert.match(errMsg(st.error), /mock open failure/)
            assert.strict.equal(st.closed, st.opened, '來源檔案代號開啟/關閉數')
            assert.strict.deepEqual([sw.opened, sw.closed], [1, 1], '寫入串流開啟/關閉數')
            assert.strict.equal(fs.readFileSync(fpTar, 'utf8'), 'existing')
            assert.strict.deepEqual(listWzip(fd), [])
            let st1 = await spyFs(() => mm.zipFile(`${fdIn}/d0/f0.bin`, fpTar), { openError: () => new Error('mock open failure') })
            assert.match(errMsg(st1.error), /mock open failure/)
            assert.strict.equal(fs.readFileSync(fpTar, 'utf8'), 'existing')
            assert.strict.deepEqual(listWzip(fd), [])
        })

        //規格: JSDoc「成功後才取代既有目標(覆寫)」; 成功時來源檔案代號與寫入串流皆關閉, 且目標同層無暫存
        it('ER05 成功時來源檔案代號與寫入串流皆關閉, 無暫存殘留', async function() {
            let fd = `${fdTmp}/er05`
            let fdIn = mkTree(`${fd}/in`)
            for (let opt of [{}, { pw }, { level: 0 }]) {
                let sw = await spyWriteStream(() => spyFs(() => mm.zipFolder(fdIn, `${fd}/a.zip`, opt)))
                assert.strict.equal(sw.result.error, undefined, String(sw.result.error))
                assert.strict.equal(sw.result.opened, 3)
                assert.strict.equal(sw.result.closed, 3)
                assert.strict.deepEqual([sw.opened, sw.closed], [1, 1])
                let sf = await spyWriteStream(() => spyFs(() => mm.zipFile(`${fdIn}/d0/f0.bin`, `${fd}/b.zip`, opt)))
                assert.strict.equal(sf.result.error, undefined, String(sf.result.error))
                assert.strict.deepEqual([sf.result.opened, sf.result.closed, sf.opened, sf.closed], [1, 1, 1, 1])
                assert.strict.deepEqual(listWzip(fd), [])
            }
        })

        //規格: 前置檢查失敗(來源不存在、level無效)時不建立任何檔案
        it('ER06 前置檢查失敗時不開啟寫入串流與暫存', async function() {
            let fd = `${fdTmp}/er06`
            fs.mkdirSync(fd, { recursive: true })
            let sw = await spyWriteStream(async () => {
                await getRejection(mm.zipFolder(`${fd}/nope`, `${fd}/a.zip`))
                await getRejection(mm.zipFile(`${fd}/nope.txt`, `${fd}/a.zip`))
                await getRejection(mm.zipFolder(fdSrc, `${fd}/a.zip`, { level: 10 }))
                await getRejection(mm.zipFile(`${fdSrc}/a.txt`, `${fd}/a.zip`, { level: 1.5 }))
            })
            assert.strict.equal(sw.error, undefined, String(sw.error))
            assert.strict.equal(sw.opened, 0)
            assert.strict.deepEqual(fs.readdirSync(fd), [])
        })

        //規格: 同上; 加入項目之過程發生壓縮器以外之錯誤(如列舉來源資料夾失敗, 壓縮器未中止寫入串流)時, 仍須reject且關閉寫入串流, 不得永不結束
        it('ER08 列舉來源資料夾失敗時reject, 寫入串流關閉, 既有目標不變, 暫存清除', async function() {
            let fd = `${fdTmp}/er08`
            let fdIn = mkTree(`${fd}/in`)
            let fpTar = `${fd}/a.zip`
            fs.writeFileSync(fpTar, 'existing')
            let readdir0 = fs.readdirSync
            fs.readdirSync = (p, ...args) => {
                if (path.resolve(String(p)) === path.resolve(fdIn)) {
                    throw new Error('mock readdir failure')
                }
                return readdir0(p, ...args)
            }
            let st
            try {
                st = await spyWriteStream(() => withTimeout(mm.zipFolder(fdIn, fpTar), 15000))
            }
            finally {
                fs.readdirSync = readdir0
            }
            assert.match(errMsg(st.error), /mock readdir failure/)
            assert.strict.deepEqual([st.opened, st.closed], [1, 1], '寫入串流開啟/關閉數')
            assert.strict.equal(fs.readFileSync(fpTar, 'utf8'), 'existing')
            assert.strict.deepEqual(listWzip(fd), [])
        })

        //規格: JSDoc「目標位於來源資料夾內時不含目標本身」(暫存位於目標同層); 同行程內並發壓縮同一來源且目標皆位於來源內時, 各壓縮檔不得含他方進行中之暫存(寫出串流使進行中之未完成壓縮檔於暫存內可見)
        it('ER09 並發壓縮同一來源(目標皆位於來源內)時不含他方進行中之暫存', async function() {
            let fd = `${fdTmp}/er09`
            let fdIn = `${fd}/tree`
            fs.mkdirSync(fdIn, { recursive: true })
            fs.writeFileSync(`${fdIn}/a.bin`, 'fixed source content')
            //暫停第一個壓縮於加入a.bin之前(其暫存檔已建立且含根目錄項), 第二個壓縮於此時列舉來源
            let add0 = ZipWriter.prototype.add
            let release
            let paused = new Promise((resolve) => {
                release = resolve
            })
            let stage
            let staged = new Promise((resolve) => {
                stage = resolve
            })
            let seen = 0
            ZipWriter.prototype.add = async function(name, ...args) {
                if (name === 'tree/a.bin' && ++seen === 1) {
                    stage()
                    await paused
                }
                return add0.call(this, name, ...args)
            }
            try {
                let first = mm.zipFolder(fdIn, `${fdIn}/x.zip`, { level: 0 })
                await staged
                await mm.zipFolder(fdIn, `${fdIn}/y.zip`, { level: 0 })
                release()
                await first
            }
            finally {
                release()
                ZipWriter.prototype.add = add0
            }
            for (let t of ['x.zip', 'y.zip']) {
                assert.strict.deepEqual((await mm.listEntries(`${fdIn}/${t}`)).map((v) => v.filename), ['tree/', 'tree/a.bin'], t)
            }
            assert.strict.deepEqual(listWzip(fdIn), [])
        })

        //規格: JSDoc「操作失敗時」, 失敗原因須可辨識; 加入來源檔案失敗且關閉該檔案又失敗時reject為原始錯誤而非關閉錯誤, 僅關閉失敗時reject為關閉錯誤, 兩者皆不變動既有目標
        it('ER10 讀取失敗並同時關閉失敗時reject為原始讀取錯誤, 僅關閉失敗時reject為關閉錯誤', async function() {
            let fd = `${fdTmp}/er10`
            let fdIn = mkTree(`${fd}/in`)
            let fpTar = `${fd}/a.zip`
            let fpSrc = `${fdIn}/d0/f0.bin`
            fs.writeFileSync(fpTar, 'existing')
            let st = await spyFs(() => mm.zipFile(fpSrc, fpTar), { readError: (fp, nth) => nth === 2 ? new Error('mock read failure') : null, closeError: () => new Error('mock close failure') })
            assert.match(errMsg(st.error), /mock read failure/)
            assert.strict.equal(st.closed, st.opened)
            let st2 = await spyFs(() => mm.zipFile(fpSrc, fpTar), { closeError: () => new Error('mock close failure') })
            assert.match(errMsg(st2.error), /mock close failure/)
            assert.strict.equal(fs.readFileSync(fpTar, 'utf8'), 'existing')
            assert.strict.deepEqual(listWzip(fd), [])
        })

        //規格: 同ER01; 成功時須於寫入串流之檔案代號關閉後才由replaceTarget改名為目標(Windows下Node以FILE_SHARE_DELETE開檔, 未關閉亦可改名, 故順序須由測試釘住)
        it('ER11 成功時於寫入串流關閉後才改名為目標', async function() {
            let fd = `${fdTmp}/er11`
            let fdIn = mkTree(`${fd}/in`)
            let live
            let atRename = []
            let rename0 = fs.renameSync
            fs.renameSync = (a, b) => {
                if (String(a).includes('.wzip-tmp-')) {
                    atRename.push([live.opened, live.closed])
                }
                return rename0(a, b)
            }
            let st
            try {
                let onStart = (s) => {
                    live = s
                }
                st = await spyWriteStream(async () => {
                    await mm.zipFolder(fdIn, `${fd}/a.zip`)
                    await mm.zipFile(`${fdIn}/d0/f0.bin`, `${fd}/b.zip`)
                }, { onStart })
            }
            finally {
                fs.renameSync = rename0
            }
            assert.strict.equal(st.error, undefined, String(st.error))
            assert.strict.deepEqual(atRename, [[1, 1], [2, 2]])
        })

        //規格: 同ER01; 寫出結束階段(最後flush或關閉)失敗時亦須reject, 既有目標不變, 暫存清除, 寫入串流關閉
        it('ER12 寫出結束階段失敗時reject, 既有目標不變, 暫存清除, 寫入串流關閉', async function() {
            let fd = `${fdTmp}/er12`
            let fdIn = mkTree(`${fd}/in`)
            let fpTar = `${fd}/a.zip`
            fs.writeFileSync(fpTar, 'existing')
            for (let fun of [() => mm.zipFolder(fdIn, fpTar), () => mm.zipFile(`${fdIn}/d0/f0.bin`, fpTar)]) {
                let st = await spyWriteStream(fun, { finalError: true })
                assert.match(errMsg(st.error), /mock final failure/)
                assert.strict.deepEqual([st.opened, st.closed], [1, 1])
                assert.strict.equal(fs.readFileSync(fpTar, 'utf8'), 'existing')
                assert.strict.deepEqual(listWzip(fd), [])
            }
        })

        //規格: 各呼叫之暫存與寫入串流彼此獨立; 同時壓縮多個目標互不影響
        it('ER07 同時壓縮多個目標時各自產物完整', async function() {
            let fd = `${fdTmp}/er07`
            fs.mkdirSync(fd, { recursive: true })
            await Promise.all([
                mm.zipFolder(fdEdge, `${fd}/a.zip`),
                mm.zipFolder(fdSrc, `${fd}/b.zip`, { pw }),
                mm.zipFile(`${fdEdge}/sizes/text-3mb.txt`, `${fd}/c.zip`),
                mm.zipFolder(fdEdge, `${fd}/d.zip`, { level: 0 }),
            ])
            await mm.unzip(`${fd}/a.zip`, `${fd}/outA`)
            await mm.unzip(`${fd}/b.zip`, `${fd}/outB`, { pw })
            await mm.unzip(`${fd}/d.zip`, `${fd}/outD`)
            assertSameTree(fdEdge, `${fd}/outA/edgeTree`)
            assertSameTree(fdSrc, `${fd}/outB/srcTree`)
            assertSameTree(fdEdge, `${fd}/outD/edgeTree`)
            assert.strict.equal(await mm.readEntry(`${fd}/c.zip`, 'text-3mb.txt'), fs.readFileSync(`${fdEdge}/sizes/text-3mb.txt`, 'utf8'))
            assert.strict.deepEqual(listWzip(fd), [])
            assert.strict.deepEqual(fs.readdirSync(fd).sort(), ['a.zip', 'b.zip', 'c.zip', 'd.zip', 'outA', 'outB', 'outD'])
            //同一目標並發: 皆成功, 目標為完整壓縮檔, 無暫存殘留
            await Promise.all([1, 2, 3].map(() => mm.zipFolder(fdSrc, `${fd}/same.zip`)))
            await mm.unzip(`${fd}/same.zip`, `${fd}/outSame`)
            assertSameTree(fdSrc, `${fd}/outSame/srcTree`)
            assert.strict.deepEqual(listWzip(fd), [])
        })

    })

})
