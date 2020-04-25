import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'
import getFiles from 'w-package-tools/src/getFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


rollupFiles({
    fns: 'WZip.mjs',
    fdSrc,
    fdTar,
    nameDistType: 'kebabCase',
    globals: {
        'path': 'path',
        'fs': 'fs',
        'child_process': 'child_process',
        'archiver': 'archiver',
        'archiver-zip-encrypted': 'archiver-zip-encrypted',
        'unzipper': 'unzipper',
    },
    external: [
        'path',
        'fs',
        'child_process',
        'archiver',
        'archiver-zip-encrypted',
        'unzipper',
    ],
})

