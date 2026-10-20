import path from 'path'
import { pathToFileURL } from 'url'


//zipMemoryProbe, 於獨立行程執行壓縮並量測記憶體峰值, 結果以單行JSON輸出於stdout
//用法: node zipMemoryProbe.mjs <mod> <fun> <src> <tar> [level] [pw]
//  mod: 提供zipFile、zipFolder之模組位置(default匯出), 例如src/mZip.mjs或test/tools/mZipV1047.mjs
//  fun: zipFile或zipFolder
//輸出: { ms, maxRSS, peakRss, peakExternal, peakArrayBuffers, peakHeapUsed, base }, 單位為位元組與毫秒
//  maxRSS為作業系統回報之行程常駐記憶體峰值(process.resourceUsage), 其餘峰值為每10ms取樣之最大值, base為執行前之取樣值
let [mod, fun, src, tar, level, pw] = process.argv.slice(2)


function sample() {
    let m = process.memoryUsage()
    return { rss: m.rss, external: m.external, arrayBuffers: m.arrayBuffers, heapUsed: m.heapUsed }
}


async function main() {

    //import
    let mm = (await import(pathToFileURL(path.resolve(mod)).href)).default

    //opt
    let opt = {}
    if (level !== undefined && level !== '') {
        opt.level = Number(level)
    }
    if (pw !== undefined && pw !== '') {
        opt.pw = pw
    }

    //sampler
    let base = sample()
    let peak = Object.assign({}, base)
    let timer = setInterval(() => {
        let s = sample()
        for (let k of Object.keys(peak)) {
            peak[k] = Math.max(peak[k], s[k])
        }
    }, 10)

    //run
    let t0 = Date.now()
    await mm[fun](src, tar, opt)
    let ms = Date.now() - t0
    clearInterval(timer)

    //final sample
    let s = sample()
    for (let k of Object.keys(peak)) {
        peak[k] = Math.max(peak[k], s[k])
    }

    console.log(JSON.stringify({
        ms,
        maxRSS: process.resourceUsage().maxRSS * 1024,
        peakRss: peak.rss,
        peakExternal: peak.external,
        peakArrayBuffers: peak.arrayBuffers,
        peakHeapUsed: peak.heapUsed,
        base,
    }))
}


main()
    .catch((err) => {
        console.error(err)
        process.exit(1)
    })
