const path = require('path');
const { GitRevisionPlugin } = require('git-revision-webpack-plugin')
const gitRevisionPlugin = new GitRevisionPlugin()
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

const pad = (number) => `0${number}`.slice(-2)

const formatDate = (date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`

const commitDate = new Date(gitRevisionPlugin.lastcommitdatetime());
const buildDate = new Date();

module.exports = {
    entry: './src/client/client.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        alias: {
            three: path.resolve('./node_modules/three')
        },
        extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, '../../dist/client'),
    },

    plugins: [
        new CopyPlugin({
            patterns: [
                { from: path.resolve(__dirname, '../../node_modules/nouislider/dist/nouislider.css'), to: 'nouislider.css' },
                { from: path.resolve(__dirname, 'static'), to: '.' },
            ],
        }),
        new HtmlWebpackPlugin({
            template: 'src/client/index.html',
            filename: "index.html",
            version: (gitRevisionPlugin.version().replace('"', '')),
            commitDate: (formatDate(commitDate)),
            buildDate: (formatDate(buildDate)),
            commithash: (gitRevisionPlugin.commithash()),
            branch: (gitRevisionPlugin.branch())
        })
    ],
};