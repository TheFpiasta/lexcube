const { merge } = require('webpack-merge');
const TerserPlugin = require('terser-webpack-plugin');
const WebpackObfuscatorPlugin = require('webpack-obfuscator');
const common = require('./webpack.common.js');

module.exports = merge(common, {
    mode: 'production',
    performance: { hints: false },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                // Keep the default: minify: TerserPlugin.terserMinify
                terserOptions: {
                    compress: true,
                    mangle: true,
                    format: { comments: false },
                },
                extractComments: false,
            }),
        ],
    },
    plugins: [
        new WebpackObfuscatorPlugin(
            {
                controlFlowFlattening: false,
                deadCodeInjection: false,
                debugProtection: false,
                debugProtectionInterval: 0,
                disableConsoleOutput: false,
                identifierNamesGenerator: 'hexadecimal',
                log: false,
                numbersToExpressions: false,
                renameGlobals: false,
                selfDefending: true,
                simplify: true,
                splitStrings: false,
                stringArray: true,
                stringArrayCallsTransform: false,
                stringArrayEncoding: [],
                stringArrayIndexShift: true,
                stringArrayRotate: true,
                stringArrayShuffle: true,
                stringArrayWrappersCount: 1,
                stringArrayWrappersChainedCalls: true,
                stringArrayWrappersParametersMaxCount: 2,
                stringArrayWrappersType: 'variable',
                stringArrayThreshold: 0.75,
                unicodeEscapeSequence: false,
            },
            []
        ),
    ],
});
