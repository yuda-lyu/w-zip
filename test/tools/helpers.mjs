import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import assert from 'assert'
import { execFileSync } from 'child_process'
import { configure, ZipWriter, ZipReader, Uint8ArrayReader, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js'


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
    findFalseAcceptPassword,
    getRejection,
    errMsg,
    treeOf,
    sha,
    assertSameTree,
    withTimeout
}
