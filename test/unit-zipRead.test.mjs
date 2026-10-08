import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import assert from 'assert'
import { ZipWriter, ZipReader, Uint8ArrayReader, Uint8ArrayWriter, TextReader, TextWriter } from '@zip.js/zip.js'
import wz from '../src/WZip.mjs'
import { makeZip, replaceName, makeSlipZip, makeDupZip, getRejection, findFalseAcceptPassword } from './tools/helpers.mjs'


//walkSrc, 由來源資料夾列出zipFolder應產生之項目(以來源資料夾名稱為根目錄項, 子資料夾為目錄項)
function walkSrc(fdSrc) {
    let bn = path.basename(fdSrc)
    let r = [{ filename: bn + '/', directory: true }]
    let walk = (fd, rel) => {
        for (let d of fs.readdirSync(fd, { withFileTypes: true })) {
            let p = path.join(fd, d.name)
            let name = `${bn}/${rel}${d.name}`
            if (d.isDirectory()) {
                r.push({ filename: name + '/', directory: true })
                walk(p, `${rel}${d.name}/`)
            }
            else {
                r.push({ filename: name, directory: false, uncompressedSize: fs.statSync(p).size })
            }
        }
    }
    walk(fdSrc, '')
    return r
}


//listFiles, 遞迴列出資料夾內所有檔案相對路徑, 用以確認讀取不寫入磁碟
function listFiles(fd) {
    return fs.readdirSync(fd, { recursive: true }).map((v) => String(v)).sort()
}


//spyFs, 攔截fs.promises.open以統計開啟/關閉之檔案代號數、實際讀取位元組數與單次讀取緩衝區最大長度, 結束後還原
//opt.maxChunk: 限制每次read最多回傳之位元組數, 用以模擬短讀
async function spyFs(fun, opt = {}) {
    let open0 = fs.promises.open
    let st = { opened: 0, closed: 0, bytesRead: 0, maxBuffer: 0, result: undefined, error: undefined }
    fs.promises.open = async (...args) => {
        let fh = await open0.apply(fs.promises, args)
        st.opened++
        let read0 = fh.read.bind(fh)
        let close0 = fh.close.bind(fh)
        fh.read = async (buffer, offset, length, position) => {
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
            return close0()
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


//setMethod, 改寫唯一項目之壓縮方法欄位(本地標頭offset 8、中央目錄offset 10), 用以造出不支援之壓縮方法
function setMethod(u8, method) {
    let buf = Buffer.from(u8)
    let iL = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    let iC = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    buf.writeUInt16LE(method, iL + 8)
    buf.writeUInt16LE(method, iC + 10)
    return buf
}


//setCdLength, 改寫EOCD之中央目錄長度欄位, 用以造出欄位異常之壓縮檔
function setCdLength(u8, len) {
    let buf = Buffer.from(u8)
    let i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    buf.writeUInt32LE(len, i + 12)
    return buf
}


describe('zipRead', function() {

    let fdTmp = './test/_tmp/zipRead'
    let fpSrcTxt = './test/input/file1(中文).txt'
    let fdSrc = './test/input/folder1'
    let pw = 'abc'

    let fpZipTxt = `${fdTmp}/txt.zip`
    let fpZipFolder = `${fdTmp}/folder1.zip`
    let fpZipPW = `${fdTmp}/folder1PW.zip`
    let fpZipAES = `${fdTmp}/aes.zip`
    let fpZipBOM = `${fdTmp}/bom.zip`
    let fpZipDup = `${fdTmp}/dup.zip`
    let fpZipSlip = `${fdTmp}/slip.zip`
    let fpZipEmpty = `${fdTmp}/empty.zip`
    let fpZipDocx = `${fdTmp}/sample.docx`
    let fpZipBig = `${fdTmp}/big.zip`
    let fpZipStorePW = `${fdTmp}/storePW.zip`
    let fpZipCorrupt = `${fdTmp}/corrupt.zip`
    let fpZipCorruptNoDD = `${fdTmp}/corruptNoDD.zip`
    let fpZipNoDD = `${fdTmp}/noDD.zip`
    let fpZipCdLength = `${fdTmp}/cdLength.zip`
    let fpZipBackslash = `${fdTmp}/backslash.zip`
    let fpZipMethod = `${fdTmp}/method12.zip`
    let fpZipAbs = `${fdTmp}/abs.zip`
    let fpZipDrive = `${fdTmp}/drive.zip`
    let fpZipAppendSmall = `${fdTmp}/appendSmall.zip`
    let fpZipAppendLarge = `${fdTmp}/appendLarge.zip`
    let fpZipPrepend = `${fdTmp}/prepend.zip`
    let fpZip64 = `${fdTmp}/zip64.zip`
    let fpZipZeroByte = `${fdTmp}/zeroByte.zip`
    let txtFox = 'The quick brown fox jumps over the lazy dog'

    let xmlDocx = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格內容 cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'

    before(async function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })

        //w-zip產製: 單檔, 資料夾(含目錄項), 資料夾加密(ZipCrypto)
        await wz.mZip.zipFile(fpSrcTxt, fpZipTxt)
        await wz.mZip.zipFolder(fdSrc, fpZipFolder)
        await wz.mZip.zipFolder(fdSrc, fpZipPW, { pw })

        //zip.js產製: AES加密, 含BOM, 空壓縮檔, docx結構
        fs.writeFileSync(fpZipAES, await makeZip([['a.txt', 'aes content']], { password: pw, encryptionStrength: 3 }))
        let u8BOM = new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode('<a>中文</a>')])
        fs.writeFileSync(fpZipBOM, await makeZip([['bom.xml', u8BOM]]))
        fs.writeFileSync(fpZipEmpty, await makeZip([]))
        fs.writeFileSync(fpZipDocx, await makeZip([
            ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types/>'],
            ['word/document.xml', xmlDocx],
            ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships/>'],
            ['word/media/image1.png', crypto.randomBytes(2048)],
            ['word/media/image2.jpeg', crypto.randomBytes(4096)],
        ]))

        //同名項目: 以dup2.txt寫入後改名為dup1.txt, 中央目錄依序為first、second
        fs.writeFileSync(fpZipDup, await makeDupZip())

        //不安全路徑: 以aa/evil.txt寫入後改名為../evil.txt
        fs.writeFileSync(fpZipSlip, await makeSlipZip())

        //大檔: 20MB不可壓縮內容加一個小項目
        fs.writeFileSync(fpZipBig, await makeZip([['big.bin', crypto.randomBytes(20 * 1024 * 1024)], ['small.txt', 'small']], { level: 0 }))

        //ZipCrypto未壓縮項目: 錯誤密碼約1/256可通過單一位元組驗證, 須靠CRC擋下
        fs.writeFileSync(fpZipStorePW, await makeZip([['s.xlsx', fs.readFileSync(`${fdSrc}/f1-1.xlsx`)]], { level: 0, password: pw, zipCrypto: true }))

        //資料區損毀: 未壓縮項目翻轉1位元組, 有無資料描述子各一
        for (let [fp, opt] of [[fpZipCorrupt, { level: 0 }], [fpZipCorruptNoDD, { level: 0, dataDescriptor: false }]]) {
            let buf = Buffer.from(await makeZip([['t.txt', txtFox]], opt))
            let i = buf.indexOf(Buffer.from('quick'))
            buf[i] = buf[i] ^ 0x20
            fs.writeFileSync(fp, buf)
        }

        //無資料描述子: 同Word產製之docx
        fs.writeFileSync(fpZipNoDD, await makeZip([['n.txt', 'no data descriptor'], ['n.xlsx', fs.readFileSync(`${fdSrc}/f1-1.xlsx`)]], { dataDescriptor: false }))

        //中央目錄長度欄位異常: 宣告為1GiB
        fs.writeFileSync(fpZipCdLength, setCdLength(await makeZip([['a.txt', 'aaa'], ['b.txt', 'bbb']]), 0x40000000))

        //反斜線分隔之項目名: 以'/'寫入後改為'\'
        let zwBs = new ZipWriter(new Uint8ArrayWriter(), { level: 0 })
        await zwBs.add('a/b.txt', new TextReader('bbb'))
        await zwBs.add('dir/', undefined, { directory: true })
        fs.writeFileSync(fpZipBackslash, replaceName(replaceName(await zwBs.close(), 'a/b.txt', 'a\\b.txt'), 'dir/', 'dir\\'))

        //不支援之壓縮方法(12為BZip2), 不安全路徑之其他形態(絕對路徑, 磁碟代號)
        fs.writeFileSync(fpZipMethod, setMethod(await makeZip([['m.txt', 'method']], { level: 0 }), 12))
        fs.writeFileSync(fpZipAbs, replaceName(await makeZip([['xabs.txt', 'x']], { level: 0 }), 'xabs.txt', '/abs.txt'))
        fs.writeFileSync(fpZipDrive, replaceName(await makeZip([['Cxx.txt', 'x']], { level: 0 }), 'Cxx.txt', 'C:x.txt'))

        //附加資料(EOCD之後)少量與超量, 前置資料(類自解壓檔), 強制zip64, 0位元組項目
        let bTxt = fs.readFileSync(fpZipTxt)
        fs.writeFileSync(fpZipAppendSmall, Buffer.concat([bTxt, Buffer.alloc(1000)]))
        fs.writeFileSync(fpZipAppendLarge, Buffer.concat([bTxt, Buffer.alloc(70000)]))
        fs.writeFileSync(fpZipPrepend, Buffer.concat([Buffer.alloc(5000, 0x4d), bTxt]))
        fs.writeFileSync(fpZip64, await makeZip([['z.txt', 'zip64']], { zip64: true }))
        fs.writeFileSync(fpZipZeroByte, await makeZip([['empty.txt', '']]))
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        try {
            fs.rmdirSync('./test/_tmp') //僅於已無其他測試暫存時移除
        }
        catch (err) {}
    })

    describe('listEntries', function() {

        it('P01a 列出zipFolder之全部項目, 含目錄項與正確大小', async function() {
            let r = await wz.mZip.listEntries(fpZipFolder)
            let exp = walkSrc(fdSrc).sort((a, b) => a.filename.localeCompare(b.filename))
            let act = r.map((v) => {
                return v.directory ? { filename: v.filename, directory: true } : { filename: v.filename, directory: false, uncompressedSize: v.uncompressedSize }
            }).sort((a, b) => a.filename.localeCompare(b.filename))
            assert.strict.deepEqual(act, exp)
        })

        it('P01b 每項僅含6個欄位且型別正確, 不含size與getData', async function() {
            let r = await wz.mZip.listEntries(fpZipFolder)
            assert.ok(r.length > 0)
            for (let v of r) {
                assert.strict.deepEqual(Object.keys(v).sort(), ['compressedSize', 'directory', 'encrypted', 'filename', 'lastModDate', 'uncompressedSize'])
                assert.strict.equal(typeof v.filename, 'string')
                assert.strict.equal(typeof v.directory, 'boolean')
                assert.strict.equal(typeof v.uncompressedSize, 'number')
                assert.strict.equal(typeof v.compressedSize, 'number')
                assert.strict.equal(v.encrypted, false)
                assert.ok(v.lastModDate instanceof Date)
            }
        })

        it('P01d 空壓縮檔回傳空陣列', async function() {
            assert.strict.deepEqual(await wz.mZip.listEntries(fpZipEmpty), [])
        })

        it('P03a Buffer與非Buffer之Uint8Array結果同檔案路徑', async function() {
            let rPath = await wz.mZip.listEntries(fpZipFolder)
            let b = fs.readFileSync(fpZipFolder)
            assert.strict.deepEqual(await wz.mZip.listEntries(b), rPath)
            assert.strict.deepEqual(await wz.mZip.listEntries(new Uint8Array(b)), rPath)
        })

        it('P05c 加密壓縮檔(ZipCrypto與AES)不需密碼即可列出, 檔案項encrypted為true', async function() {
            for (let fp of [fpZipPW, fpZipAES]) {
                let r = await wz.mZip.listEntries(fp)
                let files = r.filter((v) => !v.directory)
                assert.ok(files.length > 0)
                assert.ok(files.every((v) => v.encrypted === true), fp)
            }
        })

        it('P06b 同名項目兩筆皆列出', async function() {
            let r = await wz.mZip.listEntries(fpZipDup)
            assert.strict.deepEqual(r.map((v) => v.filename), ['dup1.txt', 'dup1.txt'])
        })

        it('P03b 無效src型別reject為invalid src', async function() {
            for (let src of [123, null, undefined, {}, new ArrayBuffer(8)]) {
                assert.strict.equal(await getRejection(wz.mZip.listEntries(src)), 'invalid src')
            }
        })

        it('P03c 路徑不存在或為資料夾時reject', async function() {
            assert.strict.equal(await getRejection(wz.mZip.listEntries(`${fdTmp}/nope.zip`)), 'invalid path of source file')
            assert.strict.equal(await getRejection(wz.mZip.listEntries('')), 'invalid path of source file')
            assert.strict.equal(await getRejection(wz.mZip.listEntries(fdTmp)), 'path of source is not file')
        })

        it('P04c 非zip、截斷zip、空Buffer時reject', async function() {
            let b = fs.readFileSync(fpZipFolder)
            for (let src of [fpSrcTxt, b.subarray(0, b.length - 30), Buffer.alloc(0)]) {
                assert.ok(await getRejection(wz.mZip.listEntries(src)) instanceof Error)
            }
        })

        it('P04f 含不安全路徑之壓縮檔整個reject', async function() {
            let err = await getRejection(wz.mZip.listEntries(fpZipSlip))
            assert.match(err.message, /Unsafe filename/)
        })

        it('P04f 其他不安全路徑(絕對路徑、磁碟代號)亦整個reject', async function() {
            for (let fp of [fpZipAbs, fpZipDrive]) {
                assert.match((await getRejection(wz.mZip.listEntries(fp))).message, /Unsafe filename/, fp)
            }
        })

        it('P11a 以反斜線分隔之項目名正規化為/', async function() {
            let r = await wz.mZip.listEntries(fpZipBackslash)
            assert.strict.deepEqual(r.map((v) => [v.filename, v.directory]), [['a/b.txt', false], ['dir/', true]])
        })

        it('P11b 中央目錄長度欄位異常時路徑與Buffer結果一致, 且不依宣告長度配置緩衝區', async function() {
            let st = await spyFs(() => wz.mZip.listEntries(fpZipCdLength))
            assert.strict.equal(st.error, undefined)
            assert.strict.deepEqual(st.result.map((v) => v.filename), ['a.txt', 'b.txt'])
            assert.strict.deepEqual(await wz.mZip.listEntries(fs.readFileSync(fpZipCdLength)), st.result)
            assert.ok(st.maxBuffer <= fs.statSync(fpZipCdLength).size, `maxBuffer ${st.maxBuffer}`)
        })

        it('P11c 不支援之壓縮方法仍可列出', async function() {
            assert.strict.deepEqual((await wz.mZip.listEntries(fpZipMethod)).map((v) => v.filename), ['m.txt'])
        })

        it('P11e EOCD後附加資料: 1000位元組可列出, 70000位元組reject', async function() {
            assert.strict.deepEqual((await wz.mZip.listEntries(fpZipAppendSmall)).map((v) => v.filename), ['file1(中文).txt'])
            for (let src of [fpZipAppendLarge, fs.readFileSync(fpZipAppendLarge)]) {
                assert.match((await getRejection(wz.mZip.listEntries(src))).message, /Ambiguous archive/)
            }
        })

        it('P11f 前置資料(類自解壓檔)與zip64可列出, 路徑與Buffer一致', async function() {
            for (let [fp, names] of [[fpZipPrepend, ['file1(中文).txt']], [fpZip64, ['z.txt']]]) {
                let r = await wz.mZip.listEntries(fp)
                assert.strict.deepEqual(r.map((v) => v.filename), names)
                assert.strict.deepEqual(await wz.mZip.listEntries(fs.readFileSync(fp)), r)
            }
        })

    })

    describe('readEntry', function() {

        it('P02a 預設與text回傳UTF-8字串且等於來源', async function() {
            let exp = fs.readFileSync(fpSrcTxt, 'utf8')
            assert.strict.equal(await wz.mZip.readEntry(fpZipTxt, 'file1(中文).txt'), exp)
            assert.strict.equal(await wz.mZip.readEntry(fpZipTxt, 'file1(中文).txt', { type: 'text' }), exp)
        })

        it('P02b P02d u8回傳Uint8Array且位元組等於來源(含中文檔名)', async function() {
            for (let rel of ['f1-1.xlsx', 'folder2/f2-3(中文).xlsx']) {
                let r = await wz.mZip.readEntry(fpZipFolder, `folder1/${rel}`, { type: 'u8' })
                assert.ok(r instanceof Uint8Array)
                assert.ok(Buffer.from(r).equals(fs.readFileSync(`${fdSrc}/${rel}`)), rel)
            }
        })

        it('P02c 含BOM之項目text去除BOM, u8保留原始位元組', async function() {
            let t = await wz.mZip.readEntry(fpZipBOM, 'bom.xml')
            assert.strict.equal(t, '<a>中文</a>')
            let u = await wz.mZip.readEntry(fpZipBOM, 'bom.xml', { type: 'u8' })
            assert.strict.deepEqual([...u.subarray(0, 3)], [0xEF, 0xBB, 0xBF])
        })

        it('P03a Buffer與非Buffer之Uint8Array結果同檔案路徑', async function() {
            let b = fs.readFileSync(fpZipTxt)
            let exp = await wz.mZip.readEntry(fpZipTxt, 'file1(中文).txt')
            assert.strict.equal(await wz.mZip.readEntry(b, 'file1(中文).txt'), exp)
            assert.strict.equal(await wz.mZip.readEntry(new Uint8Array(b), 'file1(中文).txt'), exp)
        })

        it('P04a 找不到項目時reject並含項目名稱', async function() {
            assert.strict.equal(await getRejection(wz.mZip.readEntry(fpZipFolder, 'nope.txt')), 'entry not found: nope.txt')
            assert.strict.equal(await getRejection(wz.mZip.readEntry(fpZipEmpty, 'nope.txt')), 'entry not found: nope.txt')
        })

        it('P04b 項目為資料夾時reject', async function() {
            assert.strict.equal(await getRejection(wz.mZip.readEntry(fpZipFolder, 'folder1/folder2/')), 'entry is directory: folder1/folder2/')
        })

        it('P06a 以/路徑精確比對, 反斜線、前導/、大小寫不同皆視為找不到', async function() {
            for (let name of ['folder1\\folder2\\f2-1.xlsx', '/folder1/f1-1.xlsx', 'FOLDER1/f1-1.xlsx']) {
                assert.strict.equal(await getRejection(wz.mZip.readEntry(fpZipFolder, name)), `entry not found: ${name}`)
            }
        })

        it('P11a 以反斜線分隔之項目以/路徑讀取', async function() {
            assert.strict.equal(await wz.mZip.readEntry(fpZipBackslash, 'a/b.txt'), 'bbb')
            assert.strict.equal(await getRejection(wz.mZip.readEntry(fpZipBackslash, 'dir/')), 'entry is directory: dir/')
        })

        it('P05e ZipCrypto未壓縮項目: 可通過驗證位元組之錯誤密碼仍reject, 正確密碼可讀', async function() {
            let pwFalse = await findFalseAcceptPassword(fs.readFileSync(fpZipStorePW), 's.xlsx')
            assert.match((await getRejection(wz.mZip.readEntry(fpZipStorePW, 's.xlsx', { type: 'u8', pw: pwFalse }))).message, /Invalid CRC32/)
            let r = await wz.mZip.readEntry(fpZipStorePW, 's.xlsx', { type: 'u8', pw })
            assert.ok(Buffer.from(r).equals(fs.readFileSync(`${fdSrc}/f1-1.xlsx`)))
        })

        it('P05f 資料區損毀時reject, 有無資料描述子皆同, 列出不受影響', async function() {
            for (let fp of [fpZipCorrupt, fpZipCorruptNoDD]) {
                assert.match((await getRejection(wz.mZip.readEntry(fp, 't.txt'))).message, /Invalid CRC32/, fp)
                assert.strict.deepEqual((await wz.mZip.listEntries(fp)).map((v) => v.filename), ['t.txt'])
            }
        })

        it('P11g 無資料描述子之項目可讀(同Word產製之docx)', async function() {
            assert.strict.equal(await wz.mZip.readEntry(fpZipNoDD, 'n.txt'), 'no data descriptor')
            let r = await wz.mZip.readEntry(fpZipNoDD, 'n.xlsx', { type: 'u8' })
            assert.ok(Buffer.from(r).equals(fs.readFileSync(`${fdSrc}/f1-1.xlsx`)))
        })

        it('P11c 不支援之壓縮方法reject', async function() {
            assert.match((await getRejection(wz.mZip.readEntry(fpZipMethod, 'm.txt'))).message, /Compression method not supported/)
        })

        it('P11e P11f 附加少量資料、前置資料、zip64之項目可讀', async function() {
            let exp = fs.readFileSync(fpSrcTxt, 'utf8')
            assert.strict.equal(await wz.mZip.readEntry(fpZipAppendSmall, 'file1(中文).txt'), exp)
            assert.strict.equal(await wz.mZip.readEntry(fpZipPrepend, 'file1(中文).txt'), exp)
            assert.strict.equal(await wz.mZip.readEntry(fs.readFileSync(fpZipPrepend), 'file1(中文).txt'), exp)
            assert.strict.equal(await wz.mZip.readEntry(fpZip64, 'z.txt'), 'zip64')
        })

        it('P11h 0位元組項目: text為空字串, u8長度為0', async function() {
            assert.strict.equal(await wz.mZip.readEntry(fpZipZeroByte, 'empty.txt'), '')
            let u = await wz.mZip.readEntry(fpZipZeroByte, 'empty.txt', { type: 'u8' })
            assert.ok(u instanceof Uint8Array)
            assert.strict.equal(u.length, 0)
        })

        it('P11i 具byteOffset之Buffer視圖可讀', async function() {
            let b = fs.readFileSync(fpZipTxt)
            let big = Buffer.alloc(b.length + 100)
            b.copy(big, 37)
            let view = big.subarray(37, 37 + b.length)
            assert.strict.equal(view.byteOffset, 37)
            assert.strict.equal(await wz.mZip.readEntry(view, 'file1(中文).txt'), fs.readFileSync(fpSrcTxt, 'utf8'))
        })

        it('P04g opt.pw非字串時reject', async function() {
            for (let p of [123, true, null, {}]) {
                assert.strict.equal(await getRejection(wz.mZip.readEntry(fpZipTxt, 'file1(中文).txt', { pw: p })), 'invalid opt.pw')
            }
        })

        it('P06b 同名項目取中央目錄最後一筆', async function() {
            assert.strict.equal(await wz.mZip.readEntry(fpZipDup, 'dup1.txt'), 'second')
        })

        it('P05a ZipCrypto加密: 正確密碼可讀, 無密碼或空字串密碼或錯誤密碼reject', async function() {
            let name = 'folder1/f1-1.xlsx'
            let r = await wz.mZip.readEntry(fpZipPW, name, { type: 'u8', pw })
            assert.ok(Buffer.from(r).equals(fs.readFileSync(`${fdSrc}/f1-1.xlsx`)))
            assert.match((await getRejection(wz.mZip.readEntry(fpZipPW, name, { type: 'u8' }))).message, /encrypted entry/)
            assert.match((await getRejection(wz.mZip.readEntry(fpZipPW, name, { type: 'u8', pw: '' }))).message, /encrypted entry/)
            assert.ok(await getRejection(wz.mZip.readEntry(fpZipPW, name, { type: 'u8', pw: 'abd' })) instanceof Error)
        })

        it('P05b AES加密: 正確密碼可讀, 無密碼或錯誤密碼reject', async function() {
            assert.strict.equal(await wz.mZip.readEntry(fpZipAES, 'a.txt', { pw }), 'aes content')
            assert.match((await getRejection(wz.mZip.readEntry(fpZipAES, 'a.txt'))).message, /encrypted entry/)
            assert.ok(await getRejection(wz.mZip.readEntry(fpZipAES, 'a.txt', { pw: 'abd' })) instanceof Error)
        })

        it('P05d 未加密項目給予密碼仍可讀', async function() {
            assert.strict.equal(await wz.mZip.readEntry(fpZipTxt, 'file1(中文).txt', { pw }), fs.readFileSync(fpSrcTxt, 'utf8'))
        })

        it('P03b 無效src型別reject為invalid src', async function() {
            for (let src of [123, null, undefined, {}, new ArrayBuffer(8)]) {
                assert.strict.equal(await getRejection(wz.mZip.readEntry(src, 'a.txt')), 'invalid src')
            }
        })

        it('P03c 路徑不存在或為資料夾時reject', async function() {
            assert.strict.equal(await getRejection(wz.mZip.readEntry(`${fdTmp}/nope.zip`, 'a.txt')), 'invalid path of source file')
            assert.strict.equal(await getRejection(wz.mZip.readEntry('', 'a.txt')), 'invalid path of source file')
            assert.strict.equal(await getRejection(wz.mZip.readEntry(fdTmp, 'a.txt')), 'path of source is not file')
        })

        it('P04c 非zip、截斷zip、空Buffer時reject', async function() {
            let b = fs.readFileSync(fpZipFolder)
            for (let src of [fpSrcTxt, b.subarray(0, b.length - 30), Buffer.alloc(0)]) {
                assert.ok(await getRejection(wz.mZip.readEntry(src, 'folder1/f1-1.xlsx')) instanceof Error)
            }
        })

        it('P04d 無效filename時reject', async function() {
            for (let name of [undefined, null, 1, '']) {
                assert.strict.equal(await getRejection(wz.mZip.readEntry(fpZipTxt, name)), 'invalid filename')
            }
        })

        it('P04e 無效opt.type時reject', async function() {
            for (let type of ['buffer', null, 1]) {
                assert.strict.equal(await getRejection(wz.mZip.readEntry(fpZipTxt, 'file1(中文).txt', { type })), 'invalid opt.type')
            }
        })

        it('P04f 含不安全路徑之壓縮檔整個reject', async function() {
            let err = await getRejection(wz.mZip.readEntry(fpZipSlip, 'ok.txt'))
            assert.match(err.message, /Unsafe filename/)
        })

        it('P10a docx結構: document.xml等於zip.js直接讀出, word/media項數一致', async function() {
            let zr = new ZipReader(new Uint8ArrayReader(fs.readFileSync(fpZipDocx)))
            let es = await zr.getEntries()
            let textDirect = await es.find((v) => v.filename === 'word/document.xml').getData(new TextWriter())
            let nMediaDirect = es.filter((v) => v.filename.startsWith('word/media/') && !v.directory).length
            await zr.close()
            let text = await wz.mZip.readEntry(fpZipDocx, 'word/document.xml')
            assert.strict.equal(text, textDirect)
            assert.strict.equal(text, xmlDocx)
            let nMedia = (await wz.mZip.listEntries(fpZipDocx)).filter((v) => v.filename.startsWith('word/media/') && !v.directory).length
            assert.strict.equal(nMedia, nMediaDirect)
            assert.strict.equal(nMedia, 2)
        })

    })

    describe('resource', function() {

        it('P07a 給予檔案路徑時只讀取部分內容, 20MB檔案讀取量小於1MB', async function() {
            assert.ok(fs.statSync(fpZipBig).size > 20 * 1024 * 1024)
            let sl = await spyFs(() => wz.mZip.listEntries(fpZipBig))
            assert.strict.deepEqual(sl.result.map((v) => v.filename), ['big.bin', 'small.txt'])
            assert.strict.equal(sl.opened, 1) //確為經檔案代號讀取, 非整檔讀入
            assert.ok(sl.bytesRead > 0 && sl.bytesRead < 1024 * 1024, `listEntries bytesRead ${sl.bytesRead}`)
            let sr = await spyFs(() => wz.mZip.readEntry(fpZipBig, 'small.txt'))
            assert.strict.equal(sr.result, 'small')
            assert.strict.equal(sr.opened, 1)
            assert.ok(sr.bytesRead > 0 && sr.bytesRead < 1024 * 1024, `readEntry bytesRead ${sr.bytesRead}`)
        })

        it('P08a 成功與各失敗路徑結束後檔案代號皆已關閉', async function() {
            let cases = [
                ['listEntries成功', () => wz.mZip.listEntries(fpZipFolder), false],
                ['readEntry成功', () => wz.mZip.readEntry(fpZipFolder, 'folder1/f1-1.xlsx', { type: 'u8' }), false],
                ['找不到項目', () => wz.mZip.readEntry(fpZipFolder, 'nope.txt'), true],
                ['項目為資料夾', () => wz.mZip.readEntry(fpZipFolder, 'folder1/folder2/'), true],
                ['錯誤密碼', () => wz.mZip.readEntry(fpZipPW, 'folder1/f1-1.xlsx', { pw: 'abd' }), true],
                ['無密碼', () => wz.mZip.readEntry(fpZipPW, 'folder1/f1-1.xlsx'), true],
                ['非zip之listEntries', () => wz.mZip.listEntries(fpSrcTxt), true],
                ['非zip之readEntry', () => wz.mZip.readEntry(fpSrcTxt, 'a.txt'), true],
                ['不安全路徑', () => wz.mZip.listEntries(fpZipSlip), true],
            ]
            for (let [name, fun, expectError] of cases) {
                let st = await spyFs(fun)
                assert.strict.equal(st.error !== undefined, expectError, `${name}: error ${st.error}`)
                assert.strict.equal(st.opened, 1, `${name}: opened ${st.opened}`)
                assert.strict.equal(st.closed, st.opened, `${name}: closed ${st.closed}`)
            }
        })

        it('P08b 檔案讀取發生短讀時仍得完整結果', async function() {
            let exp = fs.readFileSync(`${fdSrc}/f1-1.xlsx`)
            let sr = await spyFs(() => wz.mZip.readEntry(fpZipFolder, 'folder1/f1-1.xlsx', { type: 'u8' }), { maxChunk: 7 })
            assert.strict.equal(sr.error, undefined, String(sr.error))
            assert.ok(Buffer.from(sr.result).equals(exp))
            let sl = await spyFs(() => wz.mZip.listEntries(fpZipFolder), { maxChunk: 7 })
            assert.strict.equal(sl.error, undefined, String(sl.error))
            assert.strict.deepEqual(sl.result, await wz.mZip.listEntries(fpZipFolder))
        })

        it('P08a 前置檢查失敗時不開啟檔案', async function() {
            let cases = [
                () => wz.mZip.readEntry(fpZipFolder, ''),
                () => wz.mZip.readEntry(fpZipFolder, 'a.txt', { type: 'buffer' }),
                () => wz.mZip.readEntry(fpZipFolder, 'a.txt', { pw: 123 }),
                () => wz.mZip.listEntries(fdTmp),
            ]
            for (let fun of cases) {
                let st = await spyFs(fun)
                assert.ok(st.error !== undefined)
                assert.strict.equal(st.opened, 0)
            }
        })

        it('P09a 同一檔案並發讀取5次結果一致且皆關閉', async function() {
            let exp = fs.readFileSync(`${fdSrc}/f1-1.xlsx`)
            let st = await spyFs(() => Promise.all([1, 2, 3, 4, 5].map(() => wz.mZip.readEntry(fpZipFolder, 'folder1/f1-1.xlsx', { type: 'u8' }))))
            assert.strict.equal(st.result.length, 5)
            assert.ok(st.result.every((r) => Buffer.from(r).equals(exp)))
            assert.strict.equal(st.opened, 5)
            assert.strict.equal(st.closed, 5)
        })

        it('P01c 讀取不寫入磁碟', async function() {
            let before = listFiles(fdTmp)
            await wz.mZip.listEntries(fpZipFolder)
            await wz.mZip.readEntry(fpZipFolder, 'folder1/f1-1.xlsx', { type: 'u8' })
            await wz.mZip.readEntry(fpZipTxt, 'file1(中文).txt')
            assert.strict.deepEqual(listFiles(fdTmp), before)
        })

    })

})
