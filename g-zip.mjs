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
    console.log('zipFile')
    console.log(await wz.mZip.zipFile(fpSrc1, fpZip1))

    //zipFolder
    console.log('zipFolder')
    console.log(await wz.mZip.zipFolder(fpSrc2, fpZip2))

    //zipFolder with password
    console.log('zipFolder with password')
    console.log(await wz.mZip.zipFolder(fpSrc2, fpZip2PW, { pw }))

    //unzip
    console.log('unzip1')
    console.log(await wz.mZip.unzip(fpZip1, fpUnzipExtract + '/test1'))

    //unzip
    console.log('unzip2')
    console.log(await wz.mZip.unzip(fpZip2, fpUnzipExtract + '/test2'))

    //unzip with password
    console.log('unzip2 with password')
    console.log(await wz.mZip.unzip(fpZip2PW, fpUnzipExtract + '/test2PW', { pw }))

    console.log('finish')
}
test()
    .catch((err) => {
        console.log(err)
    })

//node --experimental-modules --es-module-specifier-resolution=node g-zip.mjs
