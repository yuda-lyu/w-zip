import fs from 'fs'
import path from 'path'
import assert from 'assert'
import wz from '../src/WZip.mjs'
import { exe7zDefault, has7z, makeZip, makeSlipZip, makeDupZip, buildSrcTree, zipEntries, getRejection, errMsg, treeOf, sha, assertSameTree, withTimeout } from './tools/helpers.mjs'


describe('m7z', function() {

    let fdTmp = './test/_tmp/m7z'
    let fdSrc = `${fdTmp}/srcTree`
    let fdEmpty = `${fdTmp}/emptyDir`
    let fdPortable = `${fdTmp}/portable7z`
    let fpTxt = `${fdSrc}/a.txt`
    let fpZh = `${fdSrc}/中文目錄/檔案(中文).txt`
    let fpZero = `${fdSrc}/zero.bin`
    let fpFake = path.resolve(fdTmp, 'fake7z.exe')
    let pw = 'abc'

    before(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdEmpty, { recursive: true })
        buildSrcTree(fdSrc)
        fs.writeFileSync(fpFake, 'not an executable')
    })

    after(function() {
        wz.m7z.setProg() //設回預設, 避免影響同一行程之其他測試
        fs.rmSync(fdTmp, { recursive: true, force: true })
        try {
            fs.rmdirSync('./test/_tmp') //僅於已無其他測試暫存時移除
        }
        catch (err) {}
    })

    describe('setProg檢查(不需7-Zip)', function() {

        afterEach(function() {
            wz.m7z.setProg()
        })

        //規格: JSDoc「失敗則提供error欄位」; 建議w-zip修正.md重現第2行
        it('SP02 給資料夾回error', function() {
            assert.strict.deepEqual(wz.m7z.setProg(path.resolve(fdTmp)), { error: 'path of 7z is not file' })
        })

        //規格: 同上; 重現第3行
        it('SP03 給不存在路徑回error', function() {
            assert.strict.deepEqual(wz.m7z.setProg(path.resolve(fdTmp, 'nope', '7z.exe')), { error: 'invalid path of 7z' })
        })

        //規格: 同上, 非字串與空字串為無效路徑
        it('SP05 非字串或空字串回error', function() {
            for (let p of [null, 123, {}, '']) {
                assert.strict.deepEqual(wz.m7z.setProg(p), { error: 'invalid path of 7z' }, JSON.stringify(p))
            }
        })

        //規格: JSDoc「執行成功物件內會提供success欄位」; 重現第1行(給檔案須成功)
        it('SP01a 給存在之檔案回success', function() {
            assert.strict.deepEqual(wz.m7z.setProg(fpFake), { success: 'done: ' + fpFake })
        })

    })

    describe('需7-Zip之實際執行', function() {

        before(function() {
            if (!has7z()) {
                this.skip()
            }
            fs.mkdirSync(fdPortable, { recursive: true })
            fs.copyFileSync(exe7zDefault, `${fdPortable}/7z.exe`)
            fs.copyFileSync(path.join(path.dirname(exe7zDefault), '7z.dll'), `${fdPortable}/7z.dll`)
        })

        describe('setProg', function() {

            let fpExe = path.resolve(fdPortable, '7z.exe')

            afterEach(function() {
                wz.m7z.setProg()
            })

            //規格: 建議w-zip修正.md「7-Zip不在預設位置之機器須能以setProg指定」; 設定後之操作須使用該執行檔
            it('SP01 給非預設位置之7z執行檔回success, 其後壓縮解壓即使用該執行檔', async function() {
                assert.strict.deepEqual(wz.m7z.setProg(fpFake), { success: 'done: ' + fpFake })
                assert.ok(await getRejection(wz.m7z.zipFile(fpTxt, `${fdTmp}/sp01fake.7z`)), '設為非執行檔後壓縮應失敗, 證明確實使用設定值')
                assert.strict.deepEqual(wz.m7z.setProg(fpExe), { success: 'done: ' + fpExe })
                await wz.m7z.zipFolder(fdSrc, `${fdTmp}/sp01.7z`)
                await wz.m7z.unzip(`${fdTmp}/sp01.7z`, `${fdTmp}/sp01Out`)
                assertSameTree(fdSrc, `${fdTmp}/sp01Out/srcTree`)
            })

            //規格: JSDoc「失敗…不變更既有設定」
            it('SP02b 給資料夾或不存在路徑回error後沿用原設定', async function() {
                assert.ok(wz.m7z.setProg(fpExe).success)
                assert.ok(wz.m7z.setProg(path.resolve(fdTmp)).error)
                assert.ok(wz.m7z.setProg(path.resolve(fdTmp, 'nope.exe')).error)
                let r = await wz.m7z.zipFile(fpTxt, `${fdTmp}/sp02b.7z`)
                assert.ok(r.state.startsWith('finish: '))
            })

            //規格: JSDoc「[path7zexe=預設位置]…不給則設回預設」
            it('SP04 不給參數時設回預設位置', async function() {
                assert.ok(wz.m7z.setProg(fpFake).success)
                assert.ok(await getRejection(wz.m7z.zipFile(fpTxt, `${fdTmp}/sp04fake.7z`)))
                assert.strict.deepEqual(wz.m7z.setProg(), { success: 'done: ' + exe7zDefault })
                let r = await wz.m7z.zipFile(fpTxt, `${fdTmp}/sp04.7z`)
                assert.ok(r.state.startsWith('finish: '))
            })

            //規格: JSDoc「可為符號連結」
            it('SP06 符號連結指向7z執行檔回success', function() {
                let fpLink = path.resolve(fdTmp, 'link7z.exe')
                try {
                    fs.symlinkSync(fpExe, fpLink, 'file')
                }
                catch (err) {
                    this.skip() //本機無建立符號連結之權限(Windows需管理員或開發人員模式)
                }
                assert.strict.deepEqual(wz.m7z.setProg(fpLink), { success: 'done: ' + fpLink })
            })

        })

        describe('zipFile、zipFolder、unzip', function() {

            before(function() {
                wz.m7z.setProg()
            })

            //規格: README「Example for 7z」(原7z.test.mjs之情境): 以repo之test/input素材壓縮單檔與資料夾(含密碼), 輸出資料夾不存在時自動建立, 解壓後內容與來源相同
            it('RD01 README範例流程: 單檔與資料夾(含密碼)壓縮後解壓內容與來源相同', async function() {
                let fdOut = `${fdTmp}/readme/output7z`
                let fpSrc1 = './test/input/file1(中文).txt'
                let fpSrc2 = './test/input/folder1'
                await wz.m7z.zipFile(fpSrc1, `${fdOut}/test1.7z`)
                await wz.m7z.zipFolder(fpSrc2, `${fdOut}/test2.7z`)
                await wz.m7z.zipFolder(fpSrc2, `${fdOut}/test2PW.7z`, { pw })
                await wz.m7z.unzip(`${fdOut}/test1.7z`, `${fdOut}/extract/test1`)
                await wz.m7z.unzip(`${fdOut}/test2.7z`, `${fdOut}/extract/test2`)
                await wz.m7z.unzip(`${fdOut}/test2PW.7z`, `${fdOut}/extract/test2PW`, { pw })
                assert.strict.equal(sha(`${fdOut}/extract/test1/file1(中文).txt`), sha(fpSrc1))
                assertSameTree(fpSrc2, `${fdOut}/extract/test2/folder1`)
                assertSameTree(fpSrc2, `${fdOut}/extract/test2PW/folder1`)
            })

            //規格: JSDoc「壓縮檔案」「解壓縮檔案至資料夾」, 中文檔名往返
            it('MZ01 zipFile往返內容一致(中文檔名)', async function() {
                await wz.m7z.zipFile(fpZh, `${fdTmp}/mz01.7z`)
                await wz.m7z.unzip(`${fdTmp}/mz01.7z`, `${fdTmp}/mz01Out`)
                assert.strict.equal(sha(`${fdTmp}/mz01Out/檔案(中文).txt`), sha(fpZh))
            })

            //規格: JSDoc「壓縮資料夾」, 結構與內容(含空子資料夾、0位元組)
            it('MZ02 zipFolder解壓後樹狀結構與內容與來源相同', async function() {
                await wz.m7z.zipFolder(fdSrc, `${fdTmp}/mz02.7z`)
                await wz.m7z.unzip(`${fdTmp}/mz02.7z`, `${fdTmp}/mz02Out`)
                assertSameTree(fdSrc, `${fdTmp}/mz02Out/srcTree`)
            })

            //規格: 空資料夾結構保留
            it('MZ03 來源為空資料夾時解壓後有根資料夾', async function() {
                await wz.m7z.zipFolder(fdEmpty, `${fdTmp}/mz03.7z`)
                await wz.m7z.unzip(`${fdTmp}/mz03.7z`, `${fdTmp}/mz03Out`)
                assert.strict.deepEqual(treeOf(`${fdTmp}/mz03Out`), ['emptyDir/'])
            })

            //規格: JSDoc opt.pw
            it('MZ04 密碼: 正確可還原, 錯誤reject', async function() {
                await wz.m7z.zipFolder(fdSrc, `${fdTmp}/mz04.7z`, { pw })
                await wz.m7z.unzip(`${fdTmp}/mz04.7z`, `${fdTmp}/mz04Out`, { pw })
                assertSameTree(fdSrc, `${fdTmp}/mz04Out/srcTree`)
                assert.ok(await getRejection(wz.m7z.unzip(`${fdTmp}/mz04.7z`, `${fdTmp}/mz04Wrong`, { pw: 'abd' })))
            })

            //規格: JSDoc「以非互動方式執行7z」, 未給密碼解壓加密檔須reject, 不得永久等待
            it('MZ04b 加密檔未給密碼時reject且不卡住', async function() {
                await wz.m7z.zipFolder(fdSrc, `${fdTmp}/mz04b.7z`, { pw })
                assert.ok(await withTimeout(getRejection(wz.m7z.unzip(`${fdTmp}/mz04b.7z`, `${fdTmp}/mz04bOut`)), 20000))
            })

            //規格: JSDoc「同名項目以最後一筆為準」, 解壓含同名項目之壓縮檔須正常結束(與mZip.unzip一致)
            it('MZ14 含同名項目之壓縮檔解壓不卡住且以最後一筆為準', async function() {
                fs.writeFileSync(`${fdTmp}/mz14.zip`, await makeDupZip())
                await withTimeout(wz.m7z.unzip(`${fdTmp}/mz14.zip`, `${fdTmp}/mz14Out`), 20000)
                assert.strict.equal(fs.readFileSync(`${fdTmp}/mz14Out/dup1.txt`, 'utf8'), 'second')
            })

            //規格: JSDoc opt.level「0為不壓縮而9為最高壓縮」
            it('MZ05 level 0之壓縮檔大於level 9, level -1 reject', async function() {
                await wz.m7z.zipFile(fpTxt, `${fdTmp}/mz05-0.7z`, { level: 0 })
                await wz.m7z.zipFile(fpTxt, `${fdTmp}/mz05-9.7z`, { level: 9 })
                assert.ok(fs.statSync(`${fdTmp}/mz05-0.7z`).size > fs.statSync(`${fdTmp}/mz05-9.7z`).size)
                assert.ok(await getRejection(wz.m7z.zipFile(fpTxt, `${fdTmp}/mz05-n.7z`, { level: -1 })))
            })

            //規格: JSDoc opt.level「範圍為0至9」, 範圍外或非整數須reject(訊息同mZip)
            it('MZ05b level超出0至9或非整數時reject', async function() {
                for (let level of [-1, 10, 'abc', 5.5]) {
                    assert.match(errMsg(await getRejection(wz.m7z.zipFile(fpTxt, `${fdTmp}/mz05b.7z`, { level }))), /Invalid level/, String(level))
                }
            })

            //規格: 參數無效時須於變動目標前reject, 既有目標不得因此遺失
            it('MZ15 level無效時不刪除既有目標檔', async function() {
                for (let fun of [(t) => wz.m7z.zipFile(fpTxt, t, { level: 10 }), (t) => wz.m7z.zipFolder(fdSrc, t, { level: 10 })]) {
                    let fp = `${fdTmp}/mz15.7z`
                    fs.writeFileSync(fp, 'existing')
                    assert.match(errMsg(await getRejection(fun(fp))), /Invalid level/)
                    assert.strict.equal(fs.readFileSync(fp, 'utf8'), 'existing')
                }
            })

            //規格: JSDoc「解壓縮檔案至資料夾」, 空壓縮檔解壓後目標資料夾仍須存在(與mZip一致)
            it('MZ16 空壓縮檔解壓後目標資料夾存在', async function() {
                fs.writeFileSync(`${fdTmp}/mz16.zip`, await makeZip([]))
                await wz.m7z.unzip(`${fdTmp}/mz16.zip`, `${fdTmp}/mz16Out`)
                assert.strict.deepEqual(treeOf(`${fdTmp}/mz16Out`), [])
            })

            //規格: 程式之來源檢查與其訊息(與mZip相同)
            it('MZ06 來源不存在或型別不符時reject', async function() {
                assert.strict.equal(await getRejection(wz.m7z.zipFile(`${fdTmp}/nope.txt`, `${fdTmp}/mz06.7z`)), 'invalid path of source file')
                assert.strict.equal(await getRejection(wz.m7z.zipFile(fdSrc, `${fdTmp}/mz06.7z`)), 'path of source is not file')
                assert.strict.equal(await getRejection(wz.m7z.zipFolder(fpTxt, `${fdTmp}/mz06.7z`)), 'path of source is not folder')
                assert.strict.equal(await getRejection(wz.m7z.unzip(`${fdTmp}/nope.7z`, `${fdTmp}/mz06Out`)), 'invalid path of source file')
                assert.strict.equal(await getRejection(wz.m7z.unzip(fdSrc, `${fdTmp}/mz06Out`)), 'path of source is not file')
            })

            //規格: JSDoc「目標檔案已存在時會先刪除後重建」(7z本身預設會追加)
            it('MZ07 壓縮至既有壓縮檔時覆寫而非追加', async function() {
                await wz.m7z.zipFile(fpTxt, `${fdTmp}/mz07.7z`)
                await wz.m7z.zipFile(fpZero, `${fdTmp}/mz07.7z`)
                await wz.m7z.unzip(`${fdTmp}/mz07.7z`, `${fdTmp}/mz07Out`)
                assert.strict.deepEqual(treeOf(`${fdTmp}/mz07Out`), ['zero.bin'])
            })

            //規格: JSDoc「目標資料夾已存在時會先整個刪除再解壓」
            it('MZ08 解壓至既有資料夾時先整個刪除', async function() {
                await wz.m7z.zipFile(fpTxt, `${fdTmp}/mz08.7z`)
                fs.mkdirSync(`${fdTmp}/mz08Out`, { recursive: true })
                fs.writeFileSync(`${fdTmp}/mz08Out/unrelated.txt`, 'x')
                await wz.m7z.unzip(`${fdTmp}/mz08.7z`, `${fdTmp}/mz08Out`)
                assert.strict.deepEqual(treeOf(`${fdTmp}/mz08Out`), ['a.txt'])
            })

            //規格: 目標上層資料夾不存在時自動建立
            it('MZ09 目標上層不存在時自動建立', async function() {
                await wz.m7z.zipFile(fpTxt, `${fdTmp}/mz09/a/b.7z`)
                await wz.m7z.unzip(`${fdTmp}/mz09/a/b.7z`, `${fdTmp}/mz09/x/y`)
                assert.strict.deepEqual(treeOf(`${fdTmp}/mz09/x/y`), ['a.txt'])
            })

            //規格: 非壓縮檔無法解壓須reject
            it('MZ10 解壓非壓縮檔時reject', async function() {
                assert.ok(await getRejection(wz.m7z.unzip(fpTxt, `${fdTmp}/mz10Out`)))
            })

            //規格: 不得寫出目標資料夾外(7z會去除'..')
            it('MZ11 含不安全路徑之zip不寫出目標外', async function() {
                fs.mkdirSync(`${fdTmp}/mz11`, { recursive: true })
                fs.writeFileSync(`${fdTmp}/mz11/slip.zip`, await makeSlipZip())
                await wz.m7z.unzip(`${fdTmp}/mz11/slip.zip`, `${fdTmp}/mz11/out`)
                assert.ok(!fs.existsSync(`${fdTmp}/mz11/evil.txt`))
                assert.ok(fs.existsSync(`${fdTmp}/mz11/out/ok.txt`))
            })

            //規格: 程式回傳{state, msg7z}
            it('MZ12 成功時回傳state與msg7z', async function() {
                let r = await wz.m7z.zipFile(fpTxt, `${fdTmp}/mz12.7z`)
                assert.ok(r.state.startsWith('finish: '), r.state)
                assert.strict.equal(typeof r.msg7z, 'string')
            })

            //規格: 兩種引擎產出之zip須可互相讀取, 加密方式皆為ZipCrypto
            it('MZ13 與mZip互通: m7z產zip可由mZip解壓, mZip產zip可由m7z解壓', async function() {
                await wz.m7z.zipFolder(fdSrc, `${fdTmp}/mz13by7z.zip`, { pw })
                let files = (await zipEntries(`${fdTmp}/mz13by7z.zip`)).filter((e) => !e.directory)
                assert.ok(files.length > 0 && files.every((e) => e.encrypted && e.zipCrypto), 'ZipCrypto')
                await wz.mZip.unzip(`${fdTmp}/mz13by7z.zip`, `${fdTmp}/mz13Out1`, { pw })
                assertSameTree(fdSrc, `${fdTmp}/mz13Out1/srcTree`)
                await wz.mZip.zipFolder(fdSrc, `${fdTmp}/mz13byMZip.zip`, { pw })
                await wz.m7z.unzip(`${fdTmp}/mz13byMZip.zip`, `${fdTmp}/mz13Out2`, { pw })
                assertSameTree(fdSrc, `${fdTmp}/mz13Out2/srcTree`)
            })

        })

    })

})
