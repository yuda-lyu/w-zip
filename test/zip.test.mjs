import assert from 'assert'
import w from 'wsemi'
import wz from '../src/WZip.mjs'


describe('zip', function() {

    let fpUnzip = './testData/outputZip'
    let fpUnzipExtract = fpUnzip + '/extract'

    let fpSrc1 = './testData/input/file1(中文).txt'
    let fpZip1 = fpUnzip + '/test1.zip'

    let fpSrc2 = './testData/input/folder1'
    let fpZip2 = fpUnzip + '/test2.zip'
    let fpZip2PW = fpUnzip + '/test2PW.zip'
    let pw = 'abc'

    let fpUnzip1 = fpUnzipExtract + '/test1'
    let fpUnzip2 = fpUnzipExtract + '/test2'
    let fpUnzip2PW = fpUnzipExtract + '/test2'

    //fsDeleteFolder
    w.fsDeleteFolder(fpUnzip)

    //zipFile
    // console.log('zipFile')
    // console.log(await wz.mZip.zipFile(fpSrc1, fpZip1))
    it('zipFile by wz.mZip.zipFile(fpSrc1, fpZip1)', async function() {
        await wz.mZip.zipFile(fpSrc1, fpZip1)
        let rt = w.fsIsFile(fpZip1)
        assert.strict.deepEqual(true, rt)
    })

    //zipFolder
    // console.log('zipFolder')
    // console.log(await wz.mZip.zipFolder(fpSrc2, fpZip2))
    it('zipFolder by wz.mZip.zipFolder(fpSrc2, fpZip2)', async function() {
        await wz.mZip.zipFolder(fpSrc2, fpZip2)
        let rt = w.fsIsFile(fpZip2)
        assert.strict.deepEqual(true, rt)
    })

    //zipFolder with password
    // console.log('zipFolder with password')
    // console.log(await wz.mZip.zipFolder(fpSrc2, fpZip2PW, { pw }))
    it('zipFolder with password by wz.mZip.zipFolder(fpSrc2, fpZip2PW, { pw })', async function() {
        await wz.mZip.zipFolder(fpSrc2, fpZip2PW, { pw })
        let rt = w.fsIsFile(fpZip2PW)
        assert.strict.deepEqual(true, rt)
    })

    //unzip
    // console.log('unzip1')
    // console.log(await wz.mZip.unzip(fpZip1, fpUnzip1))
    it('unzip by wz.mZip.unzip(fpZip1, fpUnzip1)', async function() {
        await wz.mZip.unzip(fpZip1, fpUnzip1)
        let rt = w.fsIsFolder(fpUnzip1)
        assert.strict.deepEqual(true, rt)
    })

    //unzip
    // console.log('unzip2')
    // console.log(await wz.mZip.unzip(fpZip2, fpUnzip2))
    it('unzip by wz.mZip.unzip(fpZip2, fpUnzip2)', async function() {
        await wz.mZip.unzip(fpZip2, fpUnzip2)
        let rt = w.fsIsFolder(fpUnzip2)
        assert.strict.deepEqual(true, rt)
    })

    //unzip with password
    // console.log('unzip2 with password')
    // console.log(await wz.mZip.unzip(fpZip2PW, fpUnzip2PW, { pw }))
    it('unzip with password by wz.mZip.unzip(fpZip2PW, fpUnzip2PW, { pw })', async function() {
        await wz.mZip.unzip(fpZip2PW, fpUnzip2PW, { pw })
        let rt = w.fsIsFolder(fpUnzip2PW)
        assert.strict.deepEqual(true, rt)
    })

})
