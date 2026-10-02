# w-zip
A compression tool with zip and 7z.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-zip.svg?style=flat)](https://npmjs.org/package/w-zip) 
[![license](https://img.shields.io/npm/l/w-zip.svg?style=flat)](https://npmjs.org/package/w-zip) 
[![npm download](https://img.shields.io/npm/dt/w-zip.svg)](https://npmjs.org/package/w-zip) 
[![npm download](https://img.shields.io/npm/dm/w-zip.svg)](https://npmjs.org/package/w-zip) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-zip.svg)](https://www.jsdelivr.com/package/npm/w-zip)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-zip/mZip.html).

## Core
> If you want to use `7z` on windows, it needs to install `7z`.

## Installation

### Using npm(ES6 module):
```alias
npm i w-zip
```

#### Example for ZIP:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-zip/blob/master/g_zip.mjs)]
```alias
import wz from 'w-zip'

let fpUnzip = './test/outputZip'
let fpUnzipExtract = fpUnzip + '/extract'

let fpSrc1 = './test/input/file1(中文).txt'
let fpZip1 = fpUnzip + '/test1.zip'

let fpSrc2 = './test/input/folder1'
let fpZip2 = fpUnzip + '/test2.zip'
let fpZip2PW = fpUnzip + '/test2PW.zip'
let pw = 'abc'

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

    //listEntries
    console.log('listEntries before')
    console.log('listEntries', (await wz.mZip.listEntries(fpZip2)).map((v) => v.filename))
    console.log('listEntries after')

    //readEntry
    console.log('readEntry before')
    console.log('readEntry', JSON.parse(await wz.mZip.readEntry(fpZip1, 'file1(中文).txt')).name)
    console.log('readEntry after')

    //readEntry with password
    console.log('readEntry with password before')
    console.log('readEntry with password', (await wz.mZip.readEntry(fpZip2PW, 'folder1/f1-1.xlsx', { type: 'u8', pw })).length)
    console.log('readEntry with password after')

}
test()
    .catch((err) => {
        console.log(err)
    })

// zipFile before
// zipFile done: test1.zip
// zipFile after
// zipFolder before
// zipFolder done: test2.zip
// zipFolder after
// zipFolder with password before
// zipFolder with password done: test2PW.zip
// zipFolder with password after
// unzip1 before
// unzip1 done: test1
// unzip1 after
// unzip2 before
// unzip2 done: test2
// unzip2 after
// unzip2 with password before
// unzip2 with password done: test2PW
// unzip2 with password after
// listEntries before
// listEntries [
//   'folder1/f1-1.xlsx',
//   'folder1/f1-2.xlsx',
//   'folder1/folder2/',
//   'folder1/folder2/f2-1.xlsx',
//   'folder1/folder2/f2-2.xlsx',
//   'folder1/folder2/f2-3(中文).xlsx'
// ]
// listEntries after
// readEntry before
// readEntry w-backup
// readEntry after
// readEntry with password before
// readEntry with password 6663
// readEntry with password after
```

#### Example for 7z:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-zip/blob/master/g_7z.mjs)]
```alias
import wz from 'w-zip'

let fpUnzip = './test/output7z'
let fpUnzipExtract = fpUnzip + '/extract'

let fpSrc1 = './test/input/file1(中文).txt'
let fpZip1 = fpUnzip + '/test1.7z'

let fpSrc2 = './test/input/folder1'
let fpZip2 = fpUnzip + '/test2.7z'
let fpZip2PW = fpUnzip + '/test2PW.7z'
let pw = 'abc'

async function test() {

    // //setProg
    // let path7zexe = 'path of 7zEXE'
    // wz.m7z.setProg(path7zexe)

    //zipFile
    console.log('zipFile before')
    console.log('zipFile', await wz.m7z.zipFile(fpSrc1, fpZip1))
    console.log('zipFile after')

    //zipFolder
    console.log('zipFolder before')
    console.log('zipFolder', await wz.m7z.zipFolder(fpSrc2, fpZip2))
    console.log('zipFolder after')

    //zipFolder with password
    console.log('zipFolder with password before')
    console.log('zipFolder with password', await wz.m7z.zipFolder(fpSrc2, fpZip2PW, { pw }))
    console.log('zipFolder with password after')

    //unzip
    console.log('unzip1 before')
    console.log('unzip1', await wz.m7z.unzip(fpZip1, fpUnzipExtract + '/test1'))
    console.log('unzip1 after')

    //unzip
    console.log('unzip2 before')
    console.log('unzip2', await wz.m7z.unzip(fpZip2, fpUnzipExtract + '/test2'))
    console.log('unzip2 after')

    //unzip with password
    console.log('unzip2 with password before')
    console.log('unzip2 with password', await wz.m7z.unzip(fpZip2PW, fpUnzipExtract + '/test2PW', { pw }))
    console.log('unzip2 with password after')

}
test()
    .catch((err) => {
        console.log(err)
    })
    
// zipFile before
// zipFile finish: test1.7z
// zipFile after
// zipFolder before
// zipFolder finish: test2.7z
// zipFolder after
// zipFolder with password before
// zipFolder with password finish: test2PW.7z
// zipFolder with password after
// unzip1 before
// unzip1 finish: test1
// unzip1 after
// unzip2 before
// unzip2 finish: test2
// unzip2 after
// unzip2 with password before
// unzip2 with password finish: test2PW
// unzip2 with password after
```
