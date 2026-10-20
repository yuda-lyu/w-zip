import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'


//mutateZip, 變異驗證: 於test/_tmp/mut/依src/mZip.mjs產生各變異版(退回整包組於記憶體、不關閉代號等), 以環境變數WZIP_MOD指向各變異版執行test/unit-zipStream.test.mjs, 彙整轉紅之測試編號, 每個變異版都應至少使一條測試轉紅
//用法: node test/tools/mutateZip.mjs [變異編號前綴, 例如M4], 逐版執行日誌寫至./tmp/mutation-<編號>.log, 彙總寫至./tmp/mutation-result.txt
//src/mZip.mjs修改後, 下列變異之樣式(from)可能不再命中而丟出錯誤, 須同步更新樣式
process.chdir(path.resolve(import.meta.dirname, '../..'))

let fdMut = './test/_tmp/mut'
let src = fs.readFileSync('./src/mZip.mjs', 'utf8').replaceAll('\r\n', '\n') //工作目錄之src/mZip.mjs可能為CRLF
src = src.replace(`from './checkLevel.mjs'`, `from '../../../src/checkLevel.mjs'`).replace(`from './replaceTarget.mjs'`, `from '../../../src/replaceTarget.mjs'`)

let addFileBody = `        let err = null
        try {
            await zipWriter.add(name, fr.reader)
        }
        catch (e) {
            err = e
        }
        try {
            await fr.close()
        }
        catch (e) {
            if (err === null) {
                err = e
            }
        }
        if (err !== null) {
            throw err
        }`

let mutants = {
    'M1-輸出整包組於記憶體': [
        [`let zipWriter = new ZipWriter(Writable.toWeb(stream), zipOpt)`, `let zipWriter = new ZipWriter(new Uint8ArrayWriter(), zipOpt)`],
        [`            await zipWriter.close()\n`, `            let u8 = await zipWriter.close()\n            stream.end(u8)\n`],
    ],
    'M2-輸入整檔讀入': [
        [`            await zipWriter.add(name, fr.reader)\n`, `            let b = fs.readFileSync(fp)\n            await zipWriter.add(name, new Uint8ArrayReader(b))\n`],
    ],
    'M3-讀取代號不關閉': [
        [`        try {\n            await fr.close()\n        }\n        catch (e) {\n            if (err === null) {\n                err = e\n            }\n        }\n`, ``],
    ],
    'M4-失敗不destroy串流': [
        [`            stream.destroy()\n`, ``],
    ],
    'M5-不等串流關閉': [
        [`            await closed\n`, ``],
    ],
    'M6-以未知大小串流加入(產物變動)': [
        [`            await zipWriter.add(name, fr.reader)\n`, `            await zipWriter.add(name, Readable.toWeb(fs.createReadStream(fp)))\n`],
        [`import { Writable } from 'stream'`, `import { Writable, Readable } from 'stream'`],
    ],
    'M7-大小為0之檔案不讀至檔尾': [
        [`createFileReader(fp, true)`, `createFileReader(fp, false)`],
    ],
    'M8-並發時不排除他方暫存': [
        [`!Array.from(activeTemps).some((fdTemp) => isSameOrInside(p, fdTemp))`, `!isSameOrInside(p, path.dirname(fpOut))`],
    ],
    'M9-關閉錯誤蓋掉原始錯誤': [
        [addFileBody, `        try {\n            await zipWriter.add(name, fr.reader)\n        }\n        finally {\n            await fr.close()\n        }`],
    ],
}

fs.mkdirSync(fdMut, { recursive: true })
fs.mkdirSync('./tmp', { recursive: true })
let only = process.argv[2]
let out = []
for (let [name, reps] of Object.entries(mutants)) {
    if (only && !name.startsWith(only)) {
        continue
    }
    let code = src
    for (let [from, to] of reps) {
        if (!code.includes(from)) {
            throw new Error(`mutant ${name}: pattern not found: ${from.slice(0, 60)}`)
        }
        code = code.replace(from, to)
    }
    let id = name.split('-')[0]
    let fp = path.join(fdMut, id + '.mjs')
    fs.writeFileSync(fp, code)
    let t0 = Date.now()
    let r = spawnSync(process.execPath, ['node_modules/mocha/bin/mocha.js', '--no-parallel', 'test/unit-zipStream.test.mjs', '--timeout', '60000', '--exit'], { env: { ...process.env, WZIP_MOD: fp }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 })
    let text = (r.stdout || '') + (r.stderr || '')
    let ids = [...new Set([...text.matchAll(/^\s+\d+\) ((?:EQ|ED|MEM|ER)\d\d) /gm)].map((m) => m[1]))]
    let passing = (text.match(/(\d+) passing/) || [])[1]
    let nfail = (text.match(/(\d+) failing/) || [])[1] || '0'
    let line = `${name}: exit=${r.status} passing=${passing} failing=${nfail} 紅燈=[${ids.join(',')}] ${Math.round((Date.now() - t0) / 1000)}s`
    console.log(line)
    out.push(line)
    fs.writeFileSync(`./tmp/mutation-${id}.log`, text)
}
fs.writeFileSync('./tmp/mutation-result.txt', out.join('\n') + '\n')
fs.rmSync(fdMut, { recursive: true, force: true })
try {
    fs.rmdirSync('./test/_tmp') //僅於已無其他測試暫存時移除
}
catch (err) {}
