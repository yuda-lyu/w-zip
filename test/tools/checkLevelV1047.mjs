//checkLevel, 檢查壓縮程度須為0至9之整數, 有誤回傳錯誤訊息字串(同zip.js之訊息), 無誤回傳空字串
function checkLevel(level) {
    if (!Number.isInteger(level) || level < 0 || level > 9) {
        return 'Invalid level (must be integer 0..9)'
    }
    return ''
}


export default checkLevel
