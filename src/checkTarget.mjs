import fs from 'fs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'


async function checkTarget(fpTar) {

    //check fpTar
    try {

        //刪除儲存對象
        if (fsIsFile(fpTar)) {
            fs.unlinkSync(fpTar)
        }
        else if (fsIsFolder(fpTar)) {
            fsDeleteFolder(fpTar)
        }

        //測試儲存fpTar成文字檔案
        fs.writeFileSync(fpTar, 'test', 'utf8')

        //刪除測試檔案
        fs.unlinkSync(fpTar)

    }
    catch (err) {
        return false
    }

    return true
}


export default checkTarget
