module.exports = { 
    "presets": [
        ["@babel/preset-env", {
            "useBuiltIns": "entry",
            "corejs": 3
        }]
    ],
    "plugins": [
        "@babel/plugin-proposal-export-default-from",
        "@babel/plugin-transform-runtime"
    ]
}; 