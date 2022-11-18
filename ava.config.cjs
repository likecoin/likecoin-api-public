// CI HACK: https://github.com/lovell/sharp/issues/3164
require('sharp');

module.exports = {
  require: [
    'source-map-support/register',
  ],
  files: [
    'test/**/*.test.ts',
  ],
  typescript: {
    rewritePaths: {
      'test/': 'dist/test/',
      'src/': 'dist/src/',
    },
    compile: false,
  },
};
