import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import assert from 'assert'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { configure, ZipWriter, ZipReader, BlobReader, Uint8ArrayReader, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js'


//configure, 測試自行產製壓縮檔時亦關閉web worker
configure({ useWebWorkers: false })


//exe7zDefault, 7-Zip預設安裝位置(同m7z之預設)
let exe7zDefault = 'C:\\Program Files\\7-Zip\\7z.exe'


//has7z, 是否可執行7z相關測試(Windows且預設位置已安裝7-Zip), 同既有7z.test.mjs僅於Windows執行
function has7z() {
    return process.platform === 'win32' && fs.existsSync(exe7zDefault)
}


//run7z, 以7-Zip獨立驗證壓縮檔(不經w-zip), 回傳離開碼與輸出
function run7z(args, opt = {}) {
    try {
        let out = execFileSync(exe7zDefault, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opt })
        return { code: 0, out }
    }
    catch (err) {
        return { code: err.status, out: String(err.stdout || '') + String(err.stderr || '') }
    }
}


//makeZip, 以zip.js產製壓縮檔, items為[項目路徑, 字串或Uint8Array]陣列
async function makeZip(items, opt = {}) {
    let zw = new ZipWriter(new Uint8ArrayWriter(), opt)
    for (let [name, data] of items) {
        let reader = typeof data === 'string' ? new TextReader(data) : new Uint8ArrayReader(data)
        await zw.add(name, reader)
    }
    return zw.close()
}


//replaceName, 同長度替換項目名稱, 須於本地標頭與中央目錄各命中1次, 用以造出zip.js寫入端不允許之名稱
function replaceName(u8, from, to) {
    let buf = Buffer.from(u8)
    let bFrom = Buffer.from(from)
    let bTo = Buffer.from(to)
    let n = 0
    let i = buf.indexOf(bFrom)
    while (i >= 0) {
        bTo.copy(buf, i)
        n++
        i = buf.indexOf(bFrom, i + bTo.length)
    }
    assert.strict.equal(n, 2, `replaceName ${from} -> ${to} hit ${n}`)
    return buf
}


//makeSlipZip, 產製含不安全路徑'../evil.txt'(另含ok.txt)之壓縮檔
async function makeSlipZip() {
    return replaceName(await makeZip([['ok.txt', 'ok'], ['aa/evil.txt', 'evil']], { level: 0 }), 'aa/evil.txt', '../evil.txt')
}


//makeDupZip, 產製兩個同名項目dup1.txt之壓縮檔, 中央目錄依序為first、second
async function makeDupZip() {
    return replaceName(await makeZip([['dup1.txt', 'first'], ['dup2.txt', 'second']], { level: 0 }), 'dup2.txt', 'dup1.txt')
}


//buildSrcTree, 建立測試來源資料夾: 可壓縮文字、0位元組、二進位、中文目錄與檔名、空子資料夾
function buildSrcTree(dir) {
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true })
    fs.mkdirSync(path.join(dir, '中文目錄'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'emptyChild'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.txt'), 'w-zip 測試內容 compressible line\n'.repeat(4000))
    fs.writeFileSync(path.join(dir, 'zero.bin'), '')
    fs.writeFileSync(path.join(dir, 'bin', 'random.bin'), crypto.randomBytes(64 * 1024))
    fs.writeFileSync(path.join(dir, '中文目錄', '檔案(中文).txt'), '中文內容 Chinese content')
    return dir
}


//zipEntries, 以zip.js直接讀取壓縮檔之項目(獨立於w-zip之listEntries), 用以檢查加密方式與壓縮方法
async function zipEntries(fp) {
    let zr = new ZipReader(new Uint8ArrayReader(fs.readFileSync(fp)))
    let es = await zr.getEntries()
    await zr.close()
    return es
}


//zipEntriesLazy, 同zipEntries但以fs.openAsBlob依需求讀取(只讀中央目錄), 供大型壓縮檔使用而不載入整檔
async function zipEntriesLazy(fp) {
    let zr = new ZipReader(new BlobReader(await fs.openAsBlob(fp)))
    let es = await zr.getEntries()
    await zr.close()
    return es
}


//findFalseAcceptPassword, 找出可通過ZipCrypto單一位元組密碼驗證之錯誤密碼(約1/256), 用以驗證錯誤密碼不會讀出亂碼
async function findFalseAcceptPassword(u8, name) {
    let zr = new ZipReader(new Uint8ArrayReader(u8))
    let entry = (await zr.getEntries()).find((v) => v.filename === name)
    let r = null
    for (let i = 0; i < 20000 && r === null; i++) {
        let p = `wrong${i}`
        try {
            await entry.getData(new Uint8ArrayWriter(), { password: p, checkPasswordOnly: true })
            r = p
        }
        catch (err) {}
    }
    await zr.close()
    assert.ok(r !== null, 'no false-accept password found')
    return r
}


//getRejection, 取得reject值, 若resolve則測試失敗
async function getRejection(p) {
    try {
        await p
    }
    catch (err) {
        return err
    }
    assert.fail('expected reject but resolved')
}


//errMsg, 取reject值之訊息(字串或Error皆可)
function errMsg(err) {
    return err && err.message ? err.message : String(err)
}


//treeOf, 遞迴列出資料夾內之相對路徑(以'/'分隔, 資料夾以'/'結尾), 資料夾不存在回傳null
function treeOf(dir) {
    if (!fs.existsSync(dir)) {
        return null
    }
    let r = []
    let walk = (d, rel) => {
        for (let x of fs.readdirSync(d, { withFileTypes: true })) {
            let name = `${rel}${x.name}`
            if (x.isDirectory()) {
                r.push(name + '/')
                walk(path.join(d, x.name), name + '/')
            }
            else {
                r.push(name)
            }
        }
    }
    walk(dir, '')
    return r.sort()
}


//sha, 檔案內容之sha256
function sha(fp) {
    return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex')
}


//assertSameTree, 斷言兩資料夾之樹狀結構與每個檔案內容皆相同
function assertSameTree(dirExp, dirAct) {
    let te = treeOf(dirExp)
    let ta = treeOf(dirAct)
    assert.strict.deepEqual(ta, te, `tree differs: ${dirAct}`)
    for (let rel of te.filter((v) => !v.endsWith('/'))) {
        assert.strict.equal(sha(path.join(dirAct, rel)), sha(path.join(dirExp, rel)), `content differs: ${rel}`)
    }
}


//mb, 位元組換算為MB(1024*1024)
let mb = 1024 * 1024


//probeFile, zipMemoryProbe.mjs之位置
let probeFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'zipMemoryProbe.mjs')


//writeRandomFile, 寫出指定大小之不可壓縮(隨機)檔案, 以固定大小分段寫入避免整檔載入記憶體
function writeRandomFile(fp, size) {
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    let fd = fs.openSync(fp, 'w')
    try {
        let left = size
        while (left > 0) {
            let n = Math.min(left, 8 * mb)
            fs.writeSync(fd, crypto.randomBytes(n))
            left -= n
        }
    }
    finally {
        fs.closeSync(fd)
    }
}


//buildBigTree, 建立n個各sizeMB的不可壓縮檔案分散於dir下3個子資料夾, 回傳實際總位元組數
function buildBigTree(dir, n, sizeMB) {
    fs.mkdirSync(dir, { recursive: true })
    for (let i = 0; i < n; i++) {
        writeRandomFile(path.join(dir, `d${i % 3}`, `f${i}.bin`), Math.round(sizeMB * mb))
    }
    return n * Math.round(sizeMB * mb)
}


//probeZip, 於獨立行程執行mod之fun(src,tar)並回傳記憶體量測結果, 見zipMemoryProbe.mjs
function probeZip(mod, fun, src, tar, level = '', pw = '') {
    let out = execFileSync(process.execPath, [probeFile, mod, fun, src, tar, String(level), pw], { encoding: 'utf8', maxBuffer: 16 * mb })
    return JSON.parse(out.trim().split('\n').pop())
}


//spyFs, 攔截fs.promises.open以統計開啟/關閉之檔案代號數、實際讀取位元組數與單次讀取緩衝區最大長度, 結束後還原
//opt.maxChunk: 限制每次read最多回傳之位元組數, 用以模擬短讀
//opt.openError(fp): 回傳Error則該檔案開啟時reject(模擬來源檔無法開啟)
//opt.readError(fp, nth): 回傳Error則該檔案之第nth次read(自1起)時reject(模擬讀取中途失敗)
//opt.eofAt(fp, nth): 回傳true則該檔案之第nth次(含)以後之read皆回傳0位元組(模擬檔案於讀取中途縮短)
//opt.statSize(fp): 回傳數字則該檔案之stat.size以該數字回報(模擬宣告大小為0但仍有內容之虛擬檔案)
//opt.closeError(fp): 回傳Error則該檔案於實際關閉代號後close仍reject(模擬關閉時失敗)
async function spyFs(fun, opt = {}) {
    let open0 = fs.promises.open
    let st = { opened: 0, closed: 0, bytesRead: 0, maxBuffer: 0, result: undefined, error: undefined }
    fs.promises.open = async (...args) => {
        if (opt.openError) {
            let err = opt.openError(String(args[0]))
            if (err) {
                throw err
            }
        }
        let fh = await open0.apply(fs.promises, args)
        st.opened++
        let nth = 0
        let read0 = fh.read.bind(fh)
        let close0 = fh.close.bind(fh)
        fh.read = async (buffer, offset, length, position) => {
            nth++
            if (opt.readError) {
                let err = opt.readError(String(args[0]), nth)
                if (err) {
                    throw err
                }
            }
            if (opt.eofAt && opt.eofAt(String(args[0]), nth)) {
                return { bytesRead: 0, buffer }
            }
            st.maxBuffer = Math.max(st.maxBuffer, buffer.length)
            if (opt.maxChunk) {
                length = Math.min(length, opt.maxChunk)
            }
            let r = await read0(buffer, offset, length, position)
            st.bytesRead += r.bytesRead
            return r
        }
        fh.close = async () => {
            st.closed++
            await close0()
            if (opt.closeError) {
                let err = opt.closeError(String(args[0]))
                if (err) {
                    throw err
                }
            }
        }
        if (opt.statSize) {
            let stat0 = fh.stat.bind(fh)
            fh.stat = async (...a) => {
                let s = await stat0(...a)
                let size = opt.statSize(String(args[0]))
                if (typeof size === 'number') {
                    s.size = size
                }
                return s
            }
        }
        return fh
    }
    try {
        st.result = await fun()
    }
    catch (err) {
        st.error = err
    }
    finally {
        fs.promises.open = open0
    }
    return st
}


//spyWriteStream, 攔截fs.createWriteStream以統計開啟/關閉(close事件)之寫入串流數與寫入位元組數, 結束後還原
//opt.failAfter: 累計寫入超過此位元組數後之寫入以'mock write failure'失敗(模擬寫出中途失敗, 已寫入部分仍留在檔案)
//opt.finalError: true則於串流結束階段(所有寫入完成後之_final)以'mock final failure'失敗(模擬最後flush或關閉階段失敗)
//opt.onStart(st): 開始時回傳進行中的統計物件st, 供執行期間(如改名當下)讀取開啟/關閉數
async function spyWriteStream(fun, opt = {}) {
    let create0 = fs.createWriteStream
    let st = { opened: 0, closed: 0, bytesWritten: 0, result: undefined, error: undefined }
    if (opt.onStart) {
        opt.onStart(st)
    }
    fs.createWriteStream = (...args) => {
        let s = create0.apply(fs, args)
        st.opened++
        s.once('close', () => {
            st.closed++
        })
        if (opt.finalError) {
            s._final = (cb) => {
                cb(new Error('mock final failure'))
            }
        }
        let write0 = s._write.bind(s)
        s._writev = undefined //統一經_write以便計數與注入失敗
        s._write = (chunk, enc, cb) => {
            if (opt.failAfter !== undefined && st.bytesWritten + chunk.length > opt.failAfter) {
                return cb(new Error('mock write failure'))
            }
            st.bytesWritten += chunk.length
            return write0(chunk, enc, cb)
        }
        return s
    }
    try {
        st.result = await fun()
    }
    catch (err) {
        st.error = err
    }
    finally {
        fs.createWriteStream = create0
    }
    return st
}


//freezeDate, 於fun執行期間凍結現在時間(new Date()與Date.now()), 使壓縮檔內項目時間固定而可逐位元組比對, 結束後還原
async function freezeDate(fun, iso = '2026-01-01T00:00:00Z') {
    let RealDate = Date
    let fixed = new RealDate(iso).getTime()
    globalThis.Date = class extends RealDate {
        constructor(...a) {
            if (a.length === 0) {
                super(fixed)
            }
            else {
                super(...a)
            }
        }

        static now() {
            return fixed
        }
    }
    try {
        return await fun()
    }
    finally {
        globalThis.Date = RealDate
    }
}


//withTimeout, 為可能永不結束之呼叫加上逾時, 逾時視為失敗而不卡住測試
function withTimeout(p, ms) {
    let timer
    let tout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`no settle within ${ms}ms`)), ms)
    })
    return Promise.race([p, tout]).finally(() => clearTimeout(timer))
}


export {
    exe7zDefault,
    has7z,
    run7z,
    makeZip,
    replaceName,
    makeSlipZip,
    makeDupZip,
    buildSrcTree,
    zipEntries,
    zipEntriesLazy,
    findFalseAcceptPassword,
    getRejection,
    errMsg,
    treeOf,
    sha,
    assertSameTree,
    mb,
    writeRandomFile,
    buildBigTree,
    probeZip,
    spyFs,
    spyWriteStream,
    freezeDate,
    withTimeout
}
