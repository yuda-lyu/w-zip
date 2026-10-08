import fs from 'fs'
import path from 'path'
import assert from 'assert'
import wz from '../src/WZip.mjs'
import { has7z, run7z, makeZip, makeSlipZip, makeDupZip, buildSrcTree, zipEntries, findFalseAcceptPassword, getRejection, errMsg, treeOf, sha, assertSameTree } from './tools/helpers.mjs'


describe('mZip', function() {

    let fdTmp = './test/_tmp/mZip'
    let fdSrc = `${fdTmp}/srcTree`
    let fdEmpty = `${fdTmp}/emptyDir`
    let fpTxt = `${fdSrc}/a.txt`
    let fpZh = `${fdSrc}/中文目錄/檔案(中文).txt`
    let fpZero = `${fdSrc}/zero.bin`
    let pw = 'abc'

    before(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdEmpty, { recursive: true })
        buildSrcTree(fdSrc)
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        try {
            fs.rmdirSync('./test/_tmp') //僅於已無其他測試暫存時移除
        }
        catch (err) {}
    })

    describe('README範例流程', function() {

        //規格: README「Example for ZIP」(原zip.test.mjs之情境): 以repo之test/input素材(中文檔名、xlsx)壓縮單檔與資料夾(含密碼), 輸出資料夾不存在時自動建立, 解壓後內容與來源相同
        it('RD01 單檔與資料夾(含密碼)壓縮後解壓內容與來源相同', async function() {
            let fdOut = `${fdTmp}/readme/outputZip`
            let fpSrc1 = './test/input/file1(中文).txt'
            let fpSrc2 = './test/input/folder1'
            await wz.mZip.zipFile(fpSrc1, `${fdOut}/test1.zip`)
            await wz.mZip.zipFolder(fpSrc2, `${fdOut}/test2.zip`)
            await wz.mZip.zipFolder(fpSrc2, `${fdOut}/test2PW.zip`, { pw })
            await wz.mZip.unzip(`${fdOut}/test1.zip`, `${fdOut}/extract/test1`)
            await wz.mZip.unzip(`${fdOut}/test2.zip`, `${fdOut}/extract/test2`)
            await wz.mZip.unzip(`${fdOut}/test2PW.zip`, `${fdOut}/extract/test2PW`, { pw })
            assert.strict.equal(sha(`${fdOut}/extract/test1/file1(中文).txt`), sha(fpSrc1))
            assertSameTree(fpSrc2, `${fdOut}/extract/test2/folder1`)
            assertSameTree(fpSrc2, `${fdOut}/extract/test2PW/folder1`)
        })

    })

    describe('zipFile', function() {

        //規格: JSDoc「壓縮檔案」, 壓縮檔內以檔名為項目, 解壓後內容與來源相同
        it('ZF01 單檔壓縮後解壓內容一致, 項目名為檔名', async function() {
            let fp = `${fdTmp}/zf01.zip`
            await wz.mZip.zipFile(fpTxt, fp)
            assert.strict.deepEqual((await wz.mZip.listEntries(fp)).map((v) => v.filename), ['a.txt'])
            await wz.mZip.unzip(fp, `${fdTmp}/zf01Out`)
            assert.strict.equal(sha(`${fdTmp}/zf01Out/a.txt`), sha(fpTxt))
        })

        //規格: 同上, 中文檔名須保留
        it('ZF02 中文檔名保留且內容一致', async function() {
            let fp = `${fdTmp}/zf02.zip`
            await wz.mZip.zipFile(fpZh, fp)
            assert.strict.deepEqual((await wz.mZip.listEntries(fp)).map((v) => v.filename), ['檔案(中文).txt'])
            assert.strict.equal(await wz.mZip.readEntry(fp, '檔案(中文).txt'), fs.readFileSync(fpZh, 'utf8'))
        })

        //規格: 同上, 0位元組檔案亦可往返
        it('ZF03 0位元組檔案可往返', async function() {
            let fp = `${fdTmp}/zf03.zip`
            await wz.mZip.zipFile(fpZero, fp)
            await wz.mZip.unzip(fp, `${fdTmp}/zf03Out`)
            assert.strict.equal(fs.statSync(`${fdTmp}/zf03Out/zero.bin`).size, 0)
        })

        //規格: JSDoc opt.level「0為不壓縮而9為最高壓縮，預設9」
        it('ZF04 level預設為壓縮, level 0為不壓縮, 皆可還原', async function() {
            let fp9 = `${fdTmp}/zf04-9.zip`
            let fp0 = `${fdTmp}/zf04-0.zip`
            await wz.mZip.zipFile(fpTxt, fp9)
            await wz.mZip.zipFile(fpTxt, fp0, { level: 0 })
            let e9 = (await wz.mZip.listEntries(fp9))[0]
            let e0 = (await wz.mZip.listEntries(fp0))[0]
            assert.ok(e9.compressedSize < e9.uncompressedSize, `level 9 ${e9.compressedSize}/${e9.uncompressedSize}`)
            assert.strict.equal(e0.compressedSize, e0.uncompressedSize)
            for (let fp of [fp9, fp0]) {
                assert.strict.equal(await wz.mZip.readEntry(fp, 'a.txt'), fs.readFileSync(fpTxt, 'utf8'))
            }
        })

        //規格: JSDoc opt.level「範圍為0至9」, 範圍外或非整數須reject
        it('ZF05 level超出0至9或非整數時reject', async function() {
            for (let level of [-1, 10, 'abc', 5.5]) {
                assert.match(errMsg(await getRejection(wz.mZip.zipFile(fpTxt, `${fdTmp}/zf05.zip`, { level }))), /Invalid level/, String(level))
            }
        })

        //規格: 參數無效時須於變動目標前reject, 既有目標不得因此遺失
        it('ZF13 level無效時不刪除既有目標檔', async function() {
            for (let fun of [(t) => wz.mZip.zipFile(fpTxt, t, { level: 10 }), (t) => wz.mZip.zipFolder(fdSrc, t, { level: 10 })]) {
                let fp = `${fdTmp}/zf13.zip`
                fs.writeFileSync(fp, 'existing')
                assert.match(errMsg(await getRejection(fun(fp))), /Invalid level/)
                assert.strict.equal(fs.readFileSync(fp, 'utf8'), 'existing')
            }
        })

        //規格: JSDoc opt.pw; 程式註解「使用ZipCrypto…維持與舊版相同相容性」
        it('ZF06 給密碼時以ZipCrypto加密, 正確密碼可還原, 無密碼或錯誤密碼reject', async function() {
            let fp = `${fdTmp}/zf06.zip`
            await wz.mZip.zipFile(fpTxt, fp, { pw })
            let es = await zipEntries(fp)
            assert.ok(es.length === 1 && es[0].encrypted && es[0].zipCrypto, 'ZipCrypto')
            assert.strict.equal(await wz.mZip.readEntry(fp, 'a.txt', { pw }), fs.readFileSync(fpTxt, 'utf8'))
            assert.match(errMsg(await getRejection(wz.mZip.unzip(fp, `${fdTmp}/zf06Out`))), /encrypted entry/)
            assert.ok(await getRejection(wz.mZip.unzip(fp, `${fdTmp}/zf06Out`, { pw: 'abd' })))
        })

        //規格: 程式之來源檢查與其訊息
        it('ZF07 來源不存在或為資料夾時reject', async function() {
            assert.strict.equal(await getRejection(wz.mZip.zipFile(`${fdTmp}/nope.txt`, `${fdTmp}/zf07.zip`)), 'invalid path of source file')
            assert.strict.equal(await getRejection(wz.mZip.zipFile(fdSrc, `${fdTmp}/zf07.zip`)), 'path of source is not file')
        })

        //規格: JSDoc「目標上層資料夾不存在時會自動建立」(README範例先刪輸出資料夾再壓縮)
        it('ZF08 目標上層資料夾不存在時自動建立', async function() {
            let fp = `${fdTmp}/zf08/a/b/c.zip`
            await wz.mZip.zipFile(fpTxt, fp)
            assert.strict.equal(await wz.mZip.readEntry(fp, 'a.txt'), fs.readFileSync(fpTxt, 'utf8'))
        })

        //規格: JSDoc「目標檔案已存在時會先刪除後重建」(程式註解「刪除儲存對象」)
        it('ZF09 目標已存在時覆寫而非追加', async function() {
            let fp = `${fdTmp}/zf09.zip`
            await wz.mZip.zipFile(fpTxt, fp)
            await wz.mZip.zipFile(fpZero, fp)
            assert.strict.deepEqual((await wz.mZip.listEntries(fp)).map((v) => v.filename), ['zero.bin'])
        })

        //規格: 無法寫出時reject
        it('ZF10 目標無法寫出(上層路徑為檔案)時reject', async function() {
            fs.writeFileSync(`${fdTmp}/zf10blocker`, 'x')
            assert.ok(await getRejection(wz.mZip.zipFile(fpTxt, `${fdTmp}/zf10blocker/x.zip`)))
        })

        //規格: JSDoc「resolve為成功資訊」
        it('ZF11 成功時resolve為成功資訊字串', async function() {
            let r = await wz.mZip.zipFile(fpTxt, `${fdTmp}/zf11.zip`)
            assert.ok(typeof r === 'string' && r.startsWith('done: '), r)
        })

        //規格: 產出須為標準zip, 以獨立工具7-Zip驗證完整性與加密方式(ZipCrypto相容)
        it('ZF12 7-Zip獨立驗證完整性與加密方式', async function() {
            if (!has7z()) {
                this.skip()
            }
            let fp = `${fdTmp}/zf12.zip`
            let fpPW = `${fdTmp}/zf12pw.zip`
            await wz.mZip.zipFile(fpTxt, fp)
            await wz.mZip.zipFile(fpTxt, fpPW, { pw })
            assert.strict.equal(run7z(['t', fp]).code, 0)
            assert.strict.equal(run7z(['t', `-p${pw}`, fpPW]).code, 0)
            assert.match(run7z(['l', '-slt', fpPW]).out, /Method = ZipCrypto/)
        })

    })

    describe('zipFolder', function() {

        //規格: JSDoc「壓縮資料夾」, 解壓後結構與內容同來源(含中文、0位元組、空子資料夾)
        it('ZD01 解壓後樹狀結構與檔案內容皆與來源相同', async function() {
            let fp = `${fdTmp}/zd01.zip`
            await wz.mZip.zipFolder(fdSrc, fp)
            await wz.mZip.unzip(fp, `${fdTmp}/zd01Out`)
            assertSameTree(fdSrc, `${fdTmp}/zd01Out/srcTree`)
        })

        //規格: 程式註解「以來源資料夾名稱為zip內根目錄」
        it('ZD02 壓縮檔內以來源資料夾名稱為根目錄', async function() {
            let fp = `${fdTmp}/zd02.zip`
            await wz.mZip.zipFolder(fdSrc, fp)
            let names = (await wz.mZip.listEntries(fp)).map((v) => v.filename)
            assert.ok(names.length > 0 && names.every((v) => v.startsWith('srcTree/')), JSON.stringify(names))
        })

        //規格: 程式註解「保留空資料夾結構」
        it('ZD03 空子資料夾以目錄項保留', async function() {
            let fp = `${fdTmp}/zd03.zip`
            await wz.mZip.zipFolder(fdSrc, fp)
            let e = (await wz.mZip.listEntries(fp)).find((v) => v.filename === 'srcTree/emptyChild/')
            assert.ok(e && e.directory)
        })

        //規格: 同上「保留空資料夾結構」, 且與m7z一致: 來源為空資料夾時解壓後須有根資料夾
        it('ZD04 來源為空資料夾時解壓後仍有根資料夾', async function() {
            let fp = `${fdTmp}/zd04.zip`
            await wz.mZip.zipFolder(fdEmpty, fp)
            await wz.mZip.unzip(fp, `${fdTmp}/zd04Out`)
            assert.strict.deepEqual(treeOf(`${fdTmp}/zd04Out`), ['emptyDir/'])
        })

        //規格: JSDoc opt.pw; 程式註解ZipCrypto
        it('ZD05 給密碼時以ZipCrypto加密, 正確密碼可完整還原, 錯誤或無密碼reject', async function() {
            let fp = `${fdTmp}/zd05.zip`
            await wz.mZip.zipFolder(fdSrc, fp, { pw })
            let files = (await zipEntries(fp)).filter((e) => !e.directory)
            assert.ok(files.length > 0 && files.every((e) => e.encrypted && e.zipCrypto), 'ZipCrypto')
            await wz.mZip.unzip(fp, `${fdTmp}/zd05Out`, { pw })
            assertSameTree(fdSrc, `${fdTmp}/zd05Out/srcTree`)
            assert.ok(await getRejection(wz.mZip.unzip(fp, `${fdTmp}/zd05No`)))
            assert.ok(await getRejection(wz.mZip.unzip(fp, `${fdTmp}/zd05Wrong`, { pw: 'abd' })))
        })

        //規格: JSDoc opt.level
        it('ZD06 level 0為不壓縮, 預設為壓縮', async function() {
            let fp9 = `${fdTmp}/zd06-9.zip`
            let fp0 = `${fdTmp}/zd06-0.zip`
            await wz.mZip.zipFolder(fdSrc, fp9)
            await wz.mZip.zipFolder(fdSrc, fp0, { level: 0 })
            let e9 = (await wz.mZip.listEntries(fp9)).find((v) => v.filename === 'srcTree/a.txt')
            let e0 = (await wz.mZip.listEntries(fp0)).find((v) => v.filename === 'srcTree/a.txt')
            assert.ok(e9.compressedSize < e9.uncompressedSize)
            assert.strict.equal(e0.compressedSize, e0.uncompressedSize)
        })

        //規格: 程式之來源檢查與其訊息
        it('ZD07 來源不存在或為檔案時reject', async function() {
            assert.strict.equal(await getRejection(wz.mZip.zipFolder(`${fdTmp}/nope`, `${fdTmp}/zd07.zip`)), 'invalid path of source file')
            assert.strict.equal(await getRejection(wz.mZip.zipFolder(fpTxt, `${fdTmp}/zd07.zip`)), 'path of source is not folder')
        })

        //規格: JSDoc目標處理(自動建立上層、已存在時覆寫)
        it('ZD08 目標上層不存在時自動建立, 已存在時覆寫', async function() {
            let fp = `${fdTmp}/zd08/x/y.zip`
            await wz.mZip.zipFile(fpTxt, fp)
            await wz.mZip.zipFolder(fdSrc, fp)
            let names = (await wz.mZip.listEntries(fp)).map((v) => v.filename)
            assert.ok(!names.includes('a.txt') && names.includes('srcTree/a.txt'), JSON.stringify(names))
        })

        //規格: JSDoc opt.level範圍
        it('ZD09 level無效時reject', async function() {
            assert.match(errMsg(await getRejection(wz.mZip.zipFolder(fdSrc, `${fdTmp}/zd09.zip`, { level: 10 }))), /Invalid level/)
        })

    })

    describe('unzip', function() {

        //規格: JSDoc「解壓縮檔案至資料夾」, 外部工具產製之zip(含根目錄項、中文檔名、空子資料夾)亦須完整還原
        it('UZ01 解壓7-Zip產製之zip結構與內容與來源相同', async function() {
            if (!has7z()) {
                this.skip()
            }
            let fp = path.resolve(fdTmp, 'uz01By7z.zip')
            assert.strict.equal(run7z(['a', '-tzip', fp, 'srcTree'], { cwd: path.resolve(fdTmp) }).code, 0)
            await wz.mZip.unzip(fp, `${fdTmp}/uz01Out`)
            assertSameTree(fdSrc, `${fdTmp}/uz01Out/srcTree`)
        })

        //規格: JSDoc opt.pw
        it('UZ02 密碼: 正確可還原, 錯誤、未給、空字串皆reject', async function() {
            let fp = `${fdTmp}/uz02.zip`
            await wz.mZip.zipFolder(fdSrc, fp, { pw })
            await wz.mZip.unzip(fp, `${fdTmp}/uz02Out`, { pw })
            assertSameTree(fdSrc, `${fdTmp}/uz02Out/srcTree`)
            for (let opt of [{ pw: 'abd' }, {}, { pw: '' }]) {
                assert.ok(await getRejection(wz.mZip.unzip(fp, `${fdTmp}/uz02Bad`, opt)), JSON.stringify(opt))
            }
        })

        //規格: JSDoc「目標資料夾已存在時會先整個刪除再解壓」(程式註解「刪除儲存對象」)
        it('UZ03 目標資料夾已存在時先整個刪除再解壓', async function() {
            let fp = `${fdTmp}/uz03.zip`
            let fdOut = `${fdTmp}/uz03Out`
            await wz.mZip.zipFile(fpTxt, fp)
            fs.mkdirSync(fdOut, { recursive: true })
            fs.writeFileSync(`${fdOut}/unrelated.txt`, 'x')
            await wz.mZip.unzip(fp, fdOut)
            assert.strict.deepEqual(treeOf(fdOut), ['a.txt'])
        })

        //規格: JSDoc目標上層自動建立
        it('UZ04 目標上層不存在時自動建立', async function() {
            let fp = `${fdTmp}/uz04.zip`
            await wz.mZip.zipFile(fpTxt, fp)
            await wz.mZip.unzip(fp, `${fdTmp}/uz04/x/y`)
            assert.strict.deepEqual(treeOf(`${fdTmp}/uz04/x/y`), ['a.txt'])
        })

        //規格: 程式之來源檢查與其訊息
        it('UZ05 來源不存在、為資料夾、非zip時reject', async function() {
            assert.strict.equal(await getRejection(wz.mZip.unzip(`${fdTmp}/nope.zip`, `${fdTmp}/uz05`)), 'invalid path of source file')
            assert.strict.equal(await getRejection(wz.mZip.unzip(fdSrc, `${fdTmp}/uz05`)), 'path of source is not file')
            assert.ok(await getRejection(wz.mZip.unzip(fpTxt, `${fdTmp}/uz05`)))
        })

        //規格: JSDoc「含不安全路徑之壓縮檔整個reject」, 且目標外不得出現檔案
        it('UZ06 含不安全路徑之壓縮檔reject且不寫出目標外', async function() {
            let fp = `${fdTmp}/uz06/slip.zip`
            fs.mkdirSync(`${fdTmp}/uz06`, { recursive: true })
            fs.writeFileSync(fp, await makeSlipZip())
            assert.match(errMsg(await getRejection(wz.mZip.unzip(fp, `${fdTmp}/uz06/out`))), /Unsafe filename/)
            assert.ok(!fs.existsSync(`${fdTmp}/uz06/evil.txt`))
        })

        //規格: 同名項目依序寫出, 磁碟上為最後一筆(與readEntry取最後一筆一致)
        it('UZ07 同名項目以最後一筆寫出', async function() {
            let fp = `${fdTmp}/uz07.zip`
            fs.writeFileSync(fp, await makeDupZip())
            await wz.mZip.unzip(fp, `${fdTmp}/uz07Out`)
            assert.strict.equal(fs.readFileSync(`${fdTmp}/uz07Out/dup1.txt`, 'utf8'), 'second')
        })

        //規格: JSDoc「解出內容會驗證CRC32」(與readEntry一致), 資料損毀或可通過驗證位元組之錯誤密碼須reject而非寫出錯誤內容
        it('UZ08 資料損毀或可通過驗證位元組之錯誤密碼時reject', async function() {
            let buf = Buffer.from(await makeZip([['t.txt', 'The quick brown fox']], { level: 0 }))
            let i = buf.indexOf(Buffer.from('quick'))
            buf[i] = buf[i] ^ 0x20
            fs.writeFileSync(`${fdTmp}/uz08corrupt.zip`, buf)
            assert.ok(await getRejection(wz.mZip.unzip(`${fdTmp}/uz08corrupt.zip`, `${fdTmp}/uz08Out1`)))
            let u8 = await makeZip([['s.txt', 'store content'.repeat(100)]], { level: 0, password: pw, zipCrypto: true })
            fs.writeFileSync(`${fdTmp}/uz08pw.zip`, u8)
            let pwFalse = await findFalseAcceptPassword(u8, 's.txt')
            assert.ok(await getRejection(wz.mZip.unzip(`${fdTmp}/uz08pw.zip`, `${fdTmp}/uz08Out2`, { pw: pwFalse })))
        })

        //規格: JSDoc「解壓縮檔案至資料夾」, 空壓縮檔解壓後目標資料夾仍須存在
        it('UZ09 空壓縮檔解壓後目標資料夾存在', async function() {
            fs.writeFileSync(`${fdTmp}/uz09.zip`, await makeZip([]))
            await wz.mZip.unzip(`${fdTmp}/uz09.zip`, `${fdTmp}/uz09Out`)
            assert.strict.deepEqual(treeOf(`${fdTmp}/uz09Out`), [])
        })

    })

})
