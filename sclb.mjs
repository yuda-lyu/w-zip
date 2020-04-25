import wz from './src/WZip.mjs'
import w from 'wsemi'

let fpSrc1 = './testData/input/file1(中文).txt'
let fpZip1 = './testData/output7z/test1.7z'

let fpSrc2 = './testData/input/folder1'
let fpZip2 = './testData/output7z/test2.7z'
let fpZip2PW = './testData/output7z/test2PW.7z'
let pw = 'abc'

let fpUnzip = './testData/output7z'
let fpUnzipExtract = './testData/output7z/extract'

//fsDeleteFolder
w.fsDeleteFolder(fpUnzip)

async function test() {

    // //setProg
    // let path7zexe = 'path of 7zEXE'
    // wz.m7z.setProg(path7zexe)

    //zipFile
    console.log('zipFile before')
    console.log('zipFile', (await wz.m7z.zipFile(fpSrc1, fpZip1)).state)
    console.log('zipFile after')

    //zipFolder
    console.log('zipFolder before')
    console.log('zipFolder', (await wz.m7z.zipFolder(fpSrc2, fpZip2)).state)
    console.log('zipFolder after')

    //zipFolder with password
    console.log('zipFolder with password before')
    console.log('zipFolder with password', (await wz.m7z.zipFolder(fpSrc2, fpZip2PW, { pw })).state)
    console.log('zipFolder with password after')

    //unzip
    console.log('unzip1 before')
    console.log('unzip1', (await wz.m7z.unzip(fpZip1, fpUnzipExtract + '/test1')).state)
    console.log('unzip1 after')

    //unzip
    console.log('unzip2 before')
    console.log('unzip2', (await wz.m7z.unzip(fpZip2, fpUnzipExtract + '/test2')).state)
    console.log('unzip2 after')

    //unzip
    console.log('unzip2 with password before')
    console.log('unzip2 with password', (await wz.m7z.unzip(fpZip2PW, fpUnzipExtract + '/test2PW', { pw })).state)
    console.log('unzip2 with password after')

}
test()
    .catch((err) => {
        console.log(err)
    })

//node --experimental-modules --es-module-specifier-resolution=node sclb.mjs
