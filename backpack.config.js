/* eslint-disable no-param-reassign */
const entries = {
  api: './src/api.js',
  web: './src/web.js',
  development: './src/index.js',
};

module.exports = {
  webpack: (config, options, webpack) => { // eslint-disable-line no-unused-vars
    config.resolve.alias = {
      '~': __dirname,
      '@': __dirname,
    };
    if (process.env.NODE_ENV === 'production') {
      config.entry = entries;
      config.output.filename = '[name].js';
    } else {
      const buildTarget = process.env.BACKPACK_ENTRY || 'development';
      delete config.entry.main;
      config.entry[buildTarget] = [
        entries[buildTarget],
      ];
      config.output.filename = `${buildTarget}.js`;
    }
    config.externals = [config.externals];
    config.externals.push((ctx, request, callback) => {
      if (/^(\.\.\/)+config/.test(request)) {
        const res = request.replace(/^(\.\.\/)+config/, '../config');
        return callback(null, res);
      }
      return callback();
    });
    if (process.env.NODE_ENV !== 'production') {
      config.module.rules.push({
        enforce: 'pre',
        test: /\.(js|vue)$/,
        loader: 'eslint-loader',
        exclude: /(node_modules)/,
      });
    }
    return config;
  },
};
