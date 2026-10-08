import path from 'path'
import assert from 'assert'
import { getTargetError, isSameOrInside } from '../src/replaceTarget.mjs'


describe('replaceTarget', function() {

    let cwd = process.cwd()
    let fdSrc = path.join(cwd, 'test', '_tmp', 'rt', 'src')

    describe('isSameOrInside', function() {

        //規格: 判斷p是否為fd本身或位於fd之內
        it('RT01 本身與子孫為true, 上層、兄弟與同前綴兄弟為false', function() {
            assert.strict.equal(isSameOrInside(fdSrc, fdSrc), true)
            assert.strict.equal(isSameOrInside(path.join(fdSrc, 'a', 'b.txt'), fdSrc), true)
            assert.strict.equal(isSameOrInside(path.dirname(fdSrc), fdSrc), false)
            assert.strict.equal(isSameOrInside(path.join(path.dirname(fdSrc), 'other'), fdSrc), false)
            assert.strict.equal(isSameOrInside(fdSrc + '2', fdSrc), false)
            assert.strict.equal(isSameOrInside(path.join(fdSrc, '..foo'), fdSrc), true)
        })

        //規格: Windows路徑不分大小寫
        it('RT02 Windows下不分大小寫', function() {
            if (process.platform !== 'win32') {
                this.skip()
            }
            assert.strict.equal(isSameOrInside(fdSrc.toUpperCase(), fdSrc.toLowerCase()), true)
        })

    })

    describe('getTargetError', function() {

        //規格: fpTar須為非空字串
        it('RT03 fpTar非字串或空字串為invalid fpTar', function() {
            for (let t of [undefined, null, 123, {}, '']) {
                assert.strict.equal(getTargetError(t, fdSrc), 'invalid fpTar', String(t))
            }
        })

        //規格: 取代目標會移除其原有內容, 目標不得為根目錄、目前工作目錄或其上層
        it('RT04 根目錄、目前工作目錄與其上層為unsafe fpTar', function() {
            assert.strict.equal(getTargetError(path.parse(cwd).root, fdSrc), 'unsafe fpTar')
            if (process.platform === 'win32') {
                //他磁碟之根目錄非工作目錄之上層, 須由根目錄檢查擋下(僅判斷字串, 不存取該磁碟)
                let other = path.parse(cwd).root.toUpperCase().startsWith('Z') ? 'Y:\\' : 'Z:\\'
                assert.strict.equal(getTargetError(other, fdSrc), 'unsafe fpTar')
            }
            assert.strict.equal(getTargetError('.', fdSrc), 'unsafe fpTar')
            assert.strict.equal(getTargetError(cwd, fdSrc), 'unsafe fpTar')
            assert.strict.equal(getTargetError(path.dirname(cwd), fdSrc), 'unsafe fpTar')
        })

        //規格: 目標不得為來源本身或來源之上層(否則來源會隨之被移除)
        it('RT05 來源本身與來源之上層為unsafe fpTar', function() {
            assert.strict.equal(getTargetError(fdSrc, fdSrc), 'unsafe fpTar')
            assert.strict.equal(getTargetError(path.dirname(fdSrc), fdSrc), 'unsafe fpTar')
            assert.strict.equal(getTargetError(path.join(fdSrc, 'a.zip'), path.join(fdSrc, 'a.zip')), 'unsafe fpTar')
        })

        //規格: 其餘目標(含位於來源資料夾內者)為有效
        it('RT06 來源資料夾內、兄弟與工作目錄下之一般目標有效', function() {
            assert.strict.equal(getTargetError(path.join(fdSrc, 'inner.zip'), fdSrc), '')
            assert.strict.equal(getTargetError(path.join(path.dirname(fdSrc), 'out.zip'), fdSrc), '')
            assert.strict.equal(getTargetError('./test/_tmp/rt/out', fdSrc), '')
        })

    })

})
