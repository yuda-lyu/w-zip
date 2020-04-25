import wz from './src/WZip.mjs'
import w from 'wsemi'

let fpUnzip = './testData/outputZip'
let fpUnzipExtract = fpUnzip + '/extract'

let fpSrc1 = './testData/input/file1(中文).txt'
let fpZip1 = fpUnzip + '/test1.zip'

let fpSrc2 = './testData/input/folder1'
let fpZip2 = fpUnzip + '/test2.zip'
let fpZip2PW = fpUnzip + '/test2PW.zip'
let pw = 'abc'

//fsDeleteFolder
w.fsDeleteFolder(fpUnzip)

async function test() {

    //zipFile
    console.log('zipFile before')
    console.log('zipFile', await wz.mZip.zipFile(fpSrc1, fpZip1))
    console.log('zipFile after')

    //zipFolder
    console.log('zipFolder before')
    console.log('zipFolder', await wz.mZip.zipFolder(fpSrc2, fpZip2))
    console.log('zipFolder after')

    //zipFolder with password
    console.log('zipFolder with password before')
    console.log('zipFolder with password', await wz.mZip.zipFolder(fpSrc2, fpZip2PW, { pw }))
    console.log('zipFolder with password after')

    //unzip
    console.log('unzip1 before')
    console.log('unzip1', await wz.mZip.unzip(fpZip1, fpUnzipExtract + '/test1'))
    console.log('unzip1 after')

    //unzip
    console.log('unzip2 before')
    console.log('unzip2', await wz.mZip.unzip(fpZip2, fpUnzipExtract + '/test2'))
    console.log('unzip2 after')

    //unzip with password
    console.log('unzip2 with password before')
    console.log('unzip2 with password', await wz.mZip.unzip(fpZip2PW, fpUnzipExtract + '/test2PW', { pw }))
    console.log('unzip2 with password after')

}
test()
    .catch((err) => {
        console.log(err)
    })

//node --experimental-modules --es-module-specifier-resolution=node scla.mjs
