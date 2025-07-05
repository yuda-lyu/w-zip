import wz from './src/WZip.mjs'
import w from 'wsemi'

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

async function test() {

    // //setProg
    // let path7zexe = 'path of 7zEXE'
    // wz.m7z.setProg(path7zexe)

    //zipFile
    console.log('zipFile')
    console.log((await wz.m7z.zipFile(fpSrc1, fpZip1)).state)

    //zipFolder
    console.log('zipFolder')
    console.log((await wz.m7z.zipFolder(fpSrc2, fpZip2)).state)

    //zipFolder with password
    console.log('zipFolder with password')
    console.log((await wz.m7z.zipFolder(fpSrc2, fpZip2PW, { pw })).state)

    //unzip
    console.log('unzip1')
    console.log((await wz.m7z.unzip(fpZip1, fpUnzip1)).state)

    //unzip
    console.log('unzip2')
    console.log((await wz.m7z.unzip(fpZip2, fpUnzip2)).state)

    //unzip with password
    console.log('unzip2 with password')
    console.log((await wz.m7z.unzip(fpZip2PW, fpUnzip2PW, { pw })).state)

    console.log('finish')
}
test()
    .catch((err) => {
        console.log(err)
    })

//node g-7z.mjs
