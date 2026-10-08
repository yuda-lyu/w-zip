import fs from 'fs'
import get from 'lodash-es/get.js'
import execProcess from 'wsemi/src/execProcess.mjs'
import getFileName from 'wsemi/src/getFileName.mjs'
import checkTarget from './checkTarget.mjs'
import checkLevel from './checkLevel.mjs'


/**
 * 7z處理
 *
 * @class
 * @returns {Object} 回傳壓縮物件，可使用函數setProg、zipFile、zipFolder、unzip
 * @example
 * import wz from 'w-zip'
 *
 * let fpUnzip = './test/output7z'
 * let fpUnzipExtract = fpUnzip + '/extract'
 *
 * let fpSrc1 = './test/input/file1(中文).txt'
 * let fpZip1 = fpUnzip + '/test1.7z'
 *
 * let fpSrc2 = './test/input/folder1'
 * let fpZip2 = fpUnzip + '/test2.7z'
 * let fpZip2PW = fpUnzip + '/test2PW.7z'
 * let pw = 'abc'
 *
 * async function test() {
 *
 *     // //setProg
 *     // let path7zexe = 'path of 7zEXE'
 *     // wz.m7z.setProg(path7zexe)
 *
 *     //zipFile
 *     console.log('zipFile before')
 *     console.log('zipFile', await wz.m7z.zipFile(fpSrc1, fpZip1))
 *     console.log('zipFile after')
 *
 *     //zipFolder
 *     console.log('zipFolder before')
 *     console.log('zipFolder', await wz.m7z.zipFolder(fpSrc2, fpZip2))
 *     console.log('zipFolder after')
 *
 *     //zipFolder with password
 *     console.log('zipFolder with password before')
 *     console.log('zipFolder with password', await wz.m7z.zipFolder(fpSrc2, fpZip2PW, { pw }))
 *     console.log('zipFolder with password after')
 *
 *     //unzip
 *     console.log('unzip1 before')
 *     console.log('unzip1', await wz.m7z.unzip(fpZip1, fpUnzipExtract + '/test1'))
 *     console.log('unzip1 after')
 *
 *     //unzip
 *     console.log('unzip2 before')
 *     console.log('unzip2', await wz.m7z.unzip(fpZip2, fpUnzipExtract + '/test2'))
 *     console.log('unzip2 after')
 *
 *     //unzip with password
 *     console.log('unzip2 with password before')
 *     console.log('unzip2 with password', await wz.m7z.unzip(fpZip2PW, fpUnzipExtract + '/test2PW', { pw }))
 *     console.log('unzip2 with password after')
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 * // zipFile before
 * // zipFile finish: test1.7z
 * // zipFile after
 * // zipFolder before
 * // zipFolder finish: test2.7z
 * // zipFolder after
 * // zipFolder with password before
 * // zipFolder with password finish: test2PW.7z
 * // zipFolder with password after
 * // unzip1 before
 * // unzip1 finish: test1
 * // unzip1 after
 * // unzip2 before
 * // unzip2 finish: test2
 * // unzip2 after
 * // unzip2 with password before
 * // unzip2 with password finish: test2PW
 * // unzip2 with password after
 */
function m7z() {
    let progDefault = 'C:\\Program Files\\7-Zip\\7z.exe'
    let prog = progDefault


    /**
     * 設定7z執行檔位置
     *
     * 7-Zip未安裝於預設位置(例如另裝於其他磁碟或使用可攜版7za.exe)，或非Windows系統時，須先以此指定7z執行檔。
     *
     * @memberof m7z
     * @param {String} [path7zexe='C:\\Program Files\\7-Zip\\7z.exe'] 輸入7z執行檔位置字串，可為符號連結，不給則設回預設'C:\\Program Files\\7-Zip\\7z.exe'
     * @returns {Object} 回傳狀態物件，執行成功物件內會提供success欄位，失敗則提供error欄位且不變更既有設定
     */
    function setProg(path7zexe = progDefault) {

        //check
        if (typeof path7zexe !== 'string' || !fs.existsSync(path7zexe)) {
            return {
                error: 'invalid path of 7z'
            }
        }
        if (!fs.statSync(path7zexe).isFile()) { //statSync會跟隨符號連結, 7z執行檔為連結時亦視為檔案
            return {
                error: 'path of 7z is not file'
            }
        }

        //save
        prog = path7zexe

        return {
            success: 'done: ' + path7zexe,
        }
    }


    async function zip(fpSrc, fpTar, level = 1, pw = '') { //7z的-mx1為最快速壓縮(mx0為不壓縮)
        let arg = [
            'a',
            fpTar,
            fpSrc,
            `-mx${level}`,
            '-y', //非互動執行, 7z之詢問一律回答是, 避免等待輸入而永不結束
        ]
        if (pw !== '') {
            arg.push(`-p${pw}`)
        }
        let r = await execProcess(prog, arg)
        return r
    }


    /**
     * 壓縮檔案
     *
     * 壓縮格式依目標副檔名決定(例如.7z、.zip)。目標檔案已存在時會先刪除後重建(不追加至既有壓縮檔)，目標所在資料夾不存在時會自動建立。
     *
     * @memberof m7z
     * @param {String} fpSrc 輸入壓縮來源檔案位置字串
     * @param {String} fpTar 輸入壓縮目標檔案位置字串
     * @param {Object} [opt={}] 輸入設定物件，預設{}
     * @param {Integer} [opt.level=1] 輸入壓縮程度整數，範圍為0至9，0為不壓縮而9為最高壓縮，範圍外或非整數時reject且不變動既有目標，預設1為最快速壓縮
     * @param {String} [opt.pw=''] 輸入壓縮密碼字串，預設''
     * @returns {Promise} 回傳Promise，resolve為物件{state,msg7z}，state為完成資訊，msg7z為7z之輸出訊息，reject為失敗資訊
     */
    async function zipFile(fpSrc, fpTar, opt = {}) {

        //check fpSrc
        if (!fs.existsSync(fpSrc)) {
            return Promise.reject('invalid path of source file')
        }
        if (!fs.lstatSync(fpSrc).isFile()) {
            return Promise.reject('path of source is not file')
        }

        //default
        let level = get(opt, 'level', 1)
        let pw = get(opt, 'pw', '')

        //check level, 須於checkTarget刪除既有目標前檢查, 參數無效時不變動目標
        let errLevel = checkLevel(level)
        if (errLevel !== '') {
            return Promise.reject(new Error(errLevel))
        }

        //check fpTar
        if (!checkTarget(fpTar)) {
            return Promise.reject('invalid fpSrc')
        }

        //r
        let error = null
        let r = await zip(fpSrc, fpTar, level, pw)
            .catch((err) => {
                error = err
            })

        //check
        if (error) {
            return Promise.reject(error)
        }

        return {
            state: 'finish: ' + fpTar, //7z順利結束不代表就是順利完成加解壓縮
            msg7z: r,
        }
    }


    /**
     * 壓縮資料夾
     *
     * 壓縮檔內以來源資料夾名稱為根目錄，含全部子資料夾與檔案，空資料夾亦保留。壓縮格式依目標副檔名決定(例如.7z、.zip)。目標檔案已存在時會先刪除後重建(不追加至既有壓縮檔)，目標所在資料夾不存在時會自動建立。
     *
     * @memberof m7z
     * @param {String} fpSrc 輸入壓縮來源資料夾位置字串
     * @param {String} fpTar 輸入壓縮目標檔案位置字串
     * @param {Object} [opt={}] 輸入設定物件，預設{}
     * @param {Integer} [opt.level=1] 輸入壓縮程度整數，範圍為0至9，0為不壓縮而9為最高壓縮，範圍外或非整數時reject且不變動既有目標，預設1為最快速壓縮
     * @param {String} [opt.pw=''] 輸入壓縮密碼字串，預設''
     * @returns {Promise} 回傳Promise，resolve為物件{state,msg7z}，state為完成資訊，msg7z為7z之輸出訊息，reject為失敗資訊
     */
    async function zipFolder(fpSrc, fpTar, opt = {}) {

        //check
        if (!fs.existsSync(fpSrc)) {
            return Promise.reject('invalid path of source file')
        }
        if (!fs.lstatSync(fpSrc).isDirectory()) {
            return Promise.reject('path of source is not folder')
        }

        //default
        let level = get(opt, 'level', 1)
        let pw = get(opt, 'pw', '')

        //check level, 須於checkTarget刪除既有目標前檢查, 參數無效時不變動目標
        let errLevel = checkLevel(level)
        if (errLevel !== '') {
            return Promise.reject(new Error(errLevel))
        }

        //check fpTar
        if (!checkTarget(fpTar)) {
            return Promise.reject('invalid fpSrc')
        }

        //r
        let error = null
        let r = await zip(fpSrc, fpTar, level, pw)
            .catch((err) => {
                error = err
            })

        //check
        if (error) {
            return Promise.reject(error)
        }

        return {
            state: 'finish: ' + fpTar, //7z順利結束不代表就是順利完成加解壓縮
            msg7z: r,
        }
    }


    /**
     * 解壓縮檔案至資料夾
     *
     * 目標資料夾已存在時會先整個刪除再解壓(資料夾內原有檔案不保留)，目標所在資料夾不存在時會自動建立，壓縮檔無任何項目時亦建立目標資料夾。以非互動方式執行7z：加密檔未給密碼或密碼錯誤時reject，同名項目以最後一筆為準。項目路徑含'..'者由7z去除後解壓於目標資料夾內。
     *
     * @memberof m7z
     * @param {String} fpSrc 輸入解壓縮來源檔案位置字串
     * @param {String} fpTar 輸入解壓縮目標資料夾位置字串
     * @param {Object} [opt={}] 輸入設定物件，預設{}
     * @param {String} [opt.pw=''] 輸入解壓縮密碼字串，預設''
     * @returns {Promise} 回傳Promise，resolve為物件{state,msg7z}，state為完成資訊，msg7z為7z之輸出訊息，reject為失敗資訊
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

        //arg, 非互動執行: -y使同名覆寫等詢問一律回答是(同名以最後一筆為準), -p一律給予(未給密碼時為空密碼, 加密檔即失敗而不等待輸入密碼)
        let arg = [
            'x',
            fpSrc,
            '-o' + fpTar,
            '-y',
            `-p${pw}`,
        ]

        //r
        let error = null
        let r = await execProcess(prog, arg)
            .catch((err) => {
                error = err.toString()
            })

        //check
        if (error) {
            return Promise.reject(error)
        }

        //mkdir, 壓縮檔無任何項目時仍建立目標資料夾
        if (!fs.existsSync(fpTar)) {
            fs.mkdirSync(fpTar, { recursive: true })
        }

        return {
            state: 'finish: ' + getFileName(fpTar), //7z順利結束不代表就是順利完成加解壓縮
            msg7z: r,
        }
    }


    return {
        setProg,
        zipFile,
        zipFolder,
        unzip,
    }
}


export default m7z()
