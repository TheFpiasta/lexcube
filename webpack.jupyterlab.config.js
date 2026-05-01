const path = require('path');

module.exports = {
  module: {
    rules: [
      {
        test: /\.svg$/i,
        resourceQuery: /raw/,
        type: 'asset/source'
      },
      {
        test: /\.(gif|jpe?g|png|svg|mp4|glb|gltf)$/,
        resourceQuery: { not: [/raw/] },
        type: 'asset/resource'
      }
    ]
  },
  resolve: {
    alias: {
      './pin.glb$': path.resolve(__dirname, 'src', 'lexcube-client', 'src', 'client', 'pin.glb'),
      './geojson-loader.worker.ts$': path.resolve(
        __dirname,
        'lib',
        'lexcube-client',
        'src',
        'client',
        'rendering',
        'geojson-loader.worker.js'
      ),
      'zfp_codec.wasm$': false
    }
  }
};
