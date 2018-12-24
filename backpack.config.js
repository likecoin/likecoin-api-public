/* eslint-disable no-param-reassign */

module.exports = {
  webpack: (config, options, webpack) => { // eslint-disable-line no-unused-vars
    config.resolve.alias =  {
      '~': __dirname,
      '@': __dirname,
    };
    config.entry.main = './src/index.js';
    config.externals = [config.externals];
    config.externals.push((ctx, request, callback) => {
      if (/^(\.\.\/)+config/.test(request)) {
        const res = request.replace(/^(\.\.\/)+config/, '../config');
        return callback(null, res);
      }
      return callback();
    });
    config.module.rules.push({
      enforce: 'pre',
      test: /\.(js|vue)$/,
      loader: 'eslint-loader',
      exclude: /(node_modules)/,
    });
    return config;
  },
};
