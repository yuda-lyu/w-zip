import assert from 'assert'
import w from 'wsemi'
import wz from '../src/WZip.mjs'


function isWindows() {
    return process.platform === 'win32'
}


describe('7z', function() {

    if (isWindows()) {

        let fpUnzip = './testData/output7z'
        let fpUnzipExtract = fpUnzip + '/extract'

        let fpSrc1 = './testData/input/file1(中文).txt'
        let fpZip1 = fpUnzip + '/test1.7z'

        let fpSrc2 = './testData/input/folder1'
        let fpZip2 = fpUnzip + '/test2.7z'
        let fpZip2PW = fpUnzip + '/test2PW.7z'
        let pw = 'abc'

        let fpUnzip1 = fpUnzipExtract + '/test1'
        let fpUnzip2 = fpUnzipExtract + '/test2'
        let fpUnzip2PW = fpUnzipExtract + '/test2'

        //fsDeleteFolder
        w.fsDeleteFolder(fpUnzip)

        //zipFile
        // console.log('zipFile')
        // console.log((await wz.m7z.zipFile(fpSrc1, fpZip1)).state)
        it('zipFile by wz.m7z.zipFile(fpSrc1, fpZip1)', async function() {
            await wz.m7z.zipFile(fpSrc1, fpZip1)
            let rt = w.fsIsFile(fpZip1)
            assert.strict.deepEqual(true, rt)
        })

        //zipFolder
        // console.log('zipFolder')
        // console.log((await wz.m7z.zipFolder(fpSrc2, fpZip2)).state)
        it('zipFolder by wz.m7z.zipFolder(fpSrc2, fpZip2)', async function() {
            await wz.m7z.zipFolder(fpSrc2, fpZip2)
            let rt = w.fsIsFile(fpZip2)
            assert.strict.deepEqual(true, rt)
        })

        //zipFolder with password
        // console.log('zipFolder with password')
        // console.log((await wz.m7z.zipFolder(fpSrc2, fpZip2PW, { pw })).state)
        it('zipFolder with password by wz.m7z.zipFolder(fpSrc2, fpZip2PW, { pw })', async function() {
            await wz.m7z.zipFolder(fpSrc2, fpZip2PW, { pw })
            let rt = w.fsIsFile(fpZip2PW)
            assert.strict.deepEqual(true, rt)
        })

        //unzip
        // console.log('unzip1')
        // console.log((await wz.m7z.unzip(fpZip1, fpUnzip1)).state)
        it('unzip by wz.m7z.zipFile(fpSrc1, fpZip1)', async function() {
            await wz.m7z.unzip(fpZip1, fpUnzip1)
            let rt = w.fsIsFolder(fpUnzip1)
            assert.strict.deepEqual(true, rt)
        })

        //unzip
        // console.log('unzip2')
        // console.log((await wz.m7z.unzip(fpZip2, fpUnzip2)).state)
        it('unzip by wz.m7z.unzip(fpZip2, fpUnzip2)', async function() {
            await wz.m7z.unzip(fpZip2, fpUnzip2)
            let rt = w.fsIsFolder(fpUnzip2)
            assert.strict.deepEqual(true, rt)
        })

        //unzip with password
        // console.log('unzip2 with password')
        // console.log((await wz.m7z.unzip(fpZip2PW, fpUnzip2PW, { pw })).state)
        it('unzip with password by wz.m7z.unzip(fpZip2PW, fpUnzip2PW, { pw })', async function() {
            await wz.m7z.unzip(fpZip2PW, fpUnzip2PW, { pw })
            let rt = w.fsIsFolder(fpUnzip2PW)
            assert.strict.deepEqual(true, rt)
        })

    }
    else {
        //github單元測試為linux, 略過測試

        it('test in localhost', function() {
            assert.strict.deepEqual(1, 1)
        })

    }

})
