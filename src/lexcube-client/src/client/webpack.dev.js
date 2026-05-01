const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const path = require('path');

module.exports = merge(common, {
    mode: 'development',
    devtool: 'eval-source-map',
    devServer: {
        static: {
            directory: path.join(__dirname, '../../dist/client'),
            watch: true,
        },
        historyApiFallback: true,  // For SPA routing
        hot: true,
        //host: '0.0.0.0', // expose on LAN
        port: 8080,
        client: { overlay: true }, // show build errors in browser
    },
});
