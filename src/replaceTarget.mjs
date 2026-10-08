import fs from 'fs'
import path from 'path'


//rmForce, 刪除檔案或資料夾, Windows下遇暫時鎖定時重試
function rmForce(p) {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}


//genName, 產生目標同層之暫存或備份名稱(含.wzip-以利辨識)
function genName(fp, tag) {
    let rand = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return path.join(path.dirname(fp), `${path.basename(fp)}.wzip-${tag}-${rand}`)
}


//commit, 以產物取代目標: 既有目標先改名備份, 產物改名為目標, 改名失敗則還原備份; 成功後刪除備份
function commit(fpProduct, fpFinal) {

    //backup
    let fpOld = null
    if (fs.existsSync(fpFinal)) {
        fpOld = genName(fpFinal, 'old')
        fs.renameSync(fpFinal, fpOld)
    }

    //rename
    try {
        fs.renameSync(fpProduct, fpFinal)
    }
    catch (err) {
        if (fpOld !== null) {
            fs.renameSync(fpOld, fpFinal)
        }
        throw err
    }

    //remove backup, 刪除失敗不影響已完成之取代
    if (fpOld !== null) {
        try {
            rmForce(fpOld)
        }
        catch (err) {}
    }

}


//isSameOrInside, 判斷p是否為fd本身或位於fd之內(Windows下不分大小寫)
function isSameOrInside(p, fd) {
    let rel = path.relative(fd, p)
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))
}


//getTargetError, 檢查目標, 有誤回傳錯誤訊息字串, 無誤回傳空字串
//取代目標時會移除其原有內容, 故目標不得為根目錄、目前工作目錄或其上層、來源本身或來源之上層(否則來源會隨之被移除)
function getTargetError(fpTar, fpSrc) {
    if (typeof fpTar !== 'string' || fpTar === '') {
        return 'invalid fpTar'
    }
    let fpTarAbs = path.resolve(fpTar)
    if (path.parse(fpTarAbs).root === fpTarAbs) {
        return 'unsafe fpTar'
    }
    if (isSameOrInside(process.cwd(), fpTarAbs)) {
        return 'unsafe fpTar'
    }
    if (isSameOrInside(path.resolve(fpSrc), fpTarAbs)) {
        return 'unsafe fpTar'
    }
    return ''
}


//replaceTarget, 於目標同層之暫存資料夾產出結果, 成功後才以結果取代目標, 失敗時刪除暫存而不變動既有目標
//fun(fpOut)須於fpOut產出結果(壓縮檔或解壓資料夾), fpOut與目標同名(7z依副檔名決定格式)
async function replaceTarget(fpTar, fpSrc, fun) {

    //check
    let errTar = getTargetError(fpTar, fpSrc)
    if (errTar !== '') {
        return Promise.reject(errTar)
    }

    //mkdir, 目標上層資料夾不存在時建立
    fpTar = path.resolve(fpTar)
    fs.mkdirSync(path.dirname(fpTar), { recursive: true })

    //fdTemp
    let fdTemp = genName(fpTar, 'tmp')
    fs.mkdirSync(fdTemp)

    try {

        //fun
        let r = await fun(path.join(fdTemp, path.basename(fpTar)))

        //product, 取暫存資料夾內唯一之產出, 7z於目標無副檔名時會自行補'.7z', 沿用其命名
        let items = fs.readdirSync(fdTemp)
        if (items.length !== 1) {
            throw new Error(`invalid output count[${items.length}]`)
        }

        //commit
        commit(path.join(fdTemp, items[0]), path.join(path.dirname(fpTar), items[0]))

        return r
    }
    finally {
        try {
            rmForce(fdTemp)
        }
        catch (err) {}
    }
}


export { getTargetError, isSameOrInside }
export default replaceTarget
