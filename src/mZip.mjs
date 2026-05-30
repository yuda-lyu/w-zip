import path from 'path'
import fs from 'fs'
import { configure, ZipWriter, ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js'
import get from 'lodash-es/get.js'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import getFileName from 'wsemi/src/getFileName.mjs'
import checkTarget from './checkTarget.mjs'


//configure
configure({ useWebWorkers: false }) //關閉web worker改用主執行緒壓縮, 確保nodejs下無殘留worker導致process無法結束


/**
 * Zip處理
 *
 * @class
 * @returns {Object} 回傳壓縮物件，可使用函數zipFile、zipFolder、unzip
 * @example
 * import wz from 'w-zip'
 *
 * let fpUnzip = './test/outputZip'
 * let fpUnzipExtract = fpUnzip + '/extract'
 *
 * let fpSrc1 = './test/input/file1(中文).txt'
 * let fpZip1 = fpUnzip + '/test1.zip'
 *
 * let fpSrc2 = './test/input/folder1'
 * let fpZip2 = fpUnzip + '/test2.zip'
 * let fpZip2PW = fpUnzip + '/test2PW.zip'
 * let pw = 'abc'
 *
 * async function test() {
 *
 *     //zipFile
 *     console.log('zipFile before')
 *     console.log('zipFile', await wz.mZip.zipFile(fpSrc1, fpZip1))
 *     console.log('zipFile after')
 *
 *     //zipFolder
 *     console.log('zipFolder before')
 *     console.log('zipFolder', await wz.mZip.zipFolder(fpSrc2, fpZip2))
 *     console.log('zipFolder after')
 *
 *     //zipFolder with password
 *     console.log('zipFolder with password before')
 *     console.log('zipFolder with password', await wz.mZip.zipFolder(fpSrc2, fpZip2PW, { pw }))
 *     console.log('zipFolder with password after')
 *
 *     //unzip
 *     console.log('unzip1 before')
 *     console.log('unzip1', await wz.mZip.unzip(fpZip1, fpUnzipExtract + '/test1'))
 *     console.log('unzip1 after')
 *
 *     //unzip
 *     console.log('unzip2 before')
 *     console.log('unzip2', await wz.mZip.unzip(fpZip2, fpUnzipExtract + '/test2'))
 *     console.log('unzip2 after')
 *
 *     //unzip with password
 *     console.log('unzip2 with password before')
 *     console.log('unzip2 with password', await wz.mZip.unzip(fpZip2PW, fpUnzipExtract + '/test2PW', { pw }))
 *     console.log('unzip2 with password after')
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 * // zipFile before
 * // zipFile done: test1.zip
 * // zipFile after
 * // zipFolder before
 * // zipFolder done: test2.zip
 * // zipFolder after
 * // zipFolder with password before
 * // zipFolder with password done: test2PW.zip
 * // zipFolder with password after
 * // unzip1 before
 * // unzip1 done: test1
 * // unzip1 after
 * // unzip2 before
 * // unzip2 done: test2
 * // unzip2 after
 * // unzip2 with password before
 * // unzip2 with password done: test2PW
 * // unzip2 with password after
 */
function mZip() {


    /**
     * 壓縮檔案
     *
     * @memberof mZip
     * @param {String} fpSrc 輸入壓縮來源檔案位置字串
     * @param {String} fpTar 輸入壓縮目標檔案位置字串
     * @param {Object} [opt={}] 輸入設定物件，預設{}
     * @param {Integer} [opt.level=9] 輸入壓縮程度整數，範圍為0至9，0為不壓縮而9為最高壓縮，預設9
     * @param {String} [opt.pw] 輸入壓縮密碼字串，預設''
     * @returns {Promise} 回傳Promise，resolve為成功資訊，reject為失敗資訊
     */
    async function zipFile(fpSrc, fpTar, opt = {}) {

        //check
        if (!fs.existsSync(fpSrc)) {
            return Promise.reject('invalid path of source file')
        }
        if (!fs.lstatSync(fpSrc).isFile()) {
            return Promise.reject('path of source is not file')
        }

        //check fpTar
        if (!checkTarget(fpTar)) {
            return Promise.reject('invalid fpSrc')
        }

        //default
        let level = get(opt, 'level', 9)
        let pw = get(opt, 'pw', '')

        try {

            //check
            if (!fs.existsSync(path.dirname(fpTar))) {
                fs.mkdirSync(path.dirname(fpTar), { recursive: true })
            }

            //zipOpt
            let zipOpt = { level }
            if (pw !== '') {
                zipOpt.password = pw
                zipOpt.zipCrypto = true //使用ZipCrypto(即zip20)加密維持與舊版相同相容性, 若需更強加密可改為encryptionStrength: 3(AES-256)
            }

            //zipWriter
            let zipWriter = new ZipWriter(new Uint8ArrayWriter(), zipOpt)

            //add
            let b = fs.readFileSync(fpSrc)
            await zipWriter.add(path.basename(fpSrc), new Uint8ArrayReader(b))

            //close
            let u8 = await zipWriter.close()

            //writeFileSync
            fs.writeFileSync(fpTar, u8)

            return Promise.resolve('done: ' + fpTar)
        }
        catch (err) {
            return Promise.reject(err)
        }
    }


    /**
     * 壓縮資料夾
     *
     * @memberof mZip
     * @param {String} fpSrc 輸入壓縮來源資料夾位置字串
     * @param {String} fpTar 輸入壓縮目標資料夾位置字串
     * @param {Integer} level 輸入壓縮程度整數，範圍為0至9，0為不壓縮而9為最高壓縮，預設9
     * @returns {Promise} 回傳Promise，resolve為成功資訊，reject為失敗資訊
     */
    async function zipFolder(fpSrc, fpTar, opt = {}) {

        //check
        if (!fs.existsSync(fpSrc)) {
            return Promise.reject('invalid path of source file')
        }
        if (!fs.lstatSync(fpSrc).isDirectory()) {
            return Promise.reject('path of source is not folder')
        }

        //check fpTar
        if (!checkTarget(fpTar)) {
            return Promise.reject('invalid fpSrc')
        }

        //default
        let level = get(opt, 'level', 9)
        let pw = get(opt, 'pw', '')

        try {

            //check
            if (!fs.existsSync(path.dirname(fpTar))) {
                fs.mkdirSync(path.dirname(fpTar), { recursive: true })
            }

            //zipOpt
            let zipOpt = { level }
            if (pw !== '') {
                zipOpt.password = pw
                zipOpt.zipCrypto = true //使用ZipCrypto(即zip20)加密維持與舊版相同相容性, 若需更強加密可改為encryptionStrength: 3(AES-256)
            }

            //zipWriter
            let zipWriter = new ZipWriter(new Uint8ArrayWriter(), zipOpt)

            //bn, 以來源資料夾名稱為zip內根目錄(同archiver.directory(fpSrc, basename)行為)
            let bn = path.basename(fpSrc)

            //items, 遞迴列舉資料夾下全部檔案與子資料夾
            let items = fsTreeFolder(fpSrc, null)

            //add
            for (let item of items) {

                //name, zip內相對路徑統一用'/'
                let rel = path.relative(fpSrc, item.path)
                let name = path.join(bn, rel).replaceAll('\\', '/')

                if (item.isFolder) {

                    //directory, 保留空資料夾結構
                    await zipWriter.add(name, undefined, { directory: true })

                }
                else {

                    //file
                    let b = fs.readFileSync(item.path)
                    await zipWriter.add(name, new Uint8ArrayReader(b))

                }

            }

            //close
            let u8 = await zipWriter.close()

            //writeFileSync
            fs.writeFileSync(fpTar, u8)

            return Promise.resolve('done: ' + fpTar)
        }
        catch (err) {
            return Promise.reject(err)
        }
    }


    /**
     * 解壓縮檔案至資料夾
     *
     * @memberof mZip
     * @param {String} fpSrc 輸入解壓縮來源檔案位置字串
     * @param {String} fpTar 輸入解壓縮目標資料夾位置字串
     * @param {Object} [opt={}] 輸入設定物件，預設{}
     * @param {String} [opt.pw=''] 輸入解壓縮密碼字串，預設''
     * @returns {Promise} 回傳Promise，resolve為成功資訊，reject為失敗資訊
     */
    async function unzip(fpSrc, fpTar, opt = {}) {

        //check
        if (!fs.existsSync(fpSrc)) {
            return Promise.reject('invalid path of source file')
        }
        if (!fs.lstatSync(fpSrc).isFile()) {
            return Promise.reject('path of source is not file')
        }

        //check fpTar
        if (!checkTarget(fpTar)) {
            return Promise.reject('invalid fpSrc')
        }

        //default
        let pw = get(opt, 'pw', '')

        try {

            //readerOpt
            let readerOpt = {}
            if (pw !== '') {
                readerOpt.password = pw
            }

            //zipReader
            let b = fs.readFileSync(fpSrc)
            let zipReader = new ZipReader(new Uint8ArrayReader(b), readerOpt)

            //entries
            let entries = await zipReader.getEntries()

            //extract
            for (let entry of entries) {

                //p, 解壓目標位置
                let p = path.join(fpTar, entry.filename)

                if (entry.directory) {

                    //mkdir
                    if (!fs.existsSync(p)) {
                        fs.mkdirSync(p, { recursive: true })
                    }

                }
                else {

                    //mkdir, 先建立上層資料夾
                    if (!fs.existsSync(path.dirname(p))) {
                        fs.mkdirSync(path.dirname(p), { recursive: true })
                    }

                    //getData
                    let u8 = await entry.getData(new Uint8ArrayWriter())

                    //writeFileSync
                    fs.writeFileSync(p, u8)

                }

            }

            //close
            await zipReader.close()

            return Promise.resolve('done: ' + getFileName(fpTar))
        }
        catch (err) {
            return Promise.reject(err)
        }
    }


    return {
        zipFile,
        zipFolder,
        unzip,
    }
}


export default mZip()
