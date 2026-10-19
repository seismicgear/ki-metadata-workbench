'use strict';

// Keep the renderer, desktop shell and license payload identical across platforms.
// The Linux engines are rebuilt from the vendored source by prepare-linux-tools.py.
const {build} = require('../package.json');
module.exports = {
  ...build,
  extraResources: [
    {from: 'native/target/release/ki-meta', to: 'bin/ki-meta'},
    {from: 'vendor/linux-x64', to: 'bin'},
    {from: 'vendor/licenses', to: 'licenses'},
  ],
  linux: {
    target: ['AppImage', 'deb'],
    executableName: 'ki-metadata-workbench',
    icon: 'assets/metadata-icon.png',
    category: 'Utility',
    artifactName: 'KI-Metadata-Workbench-${version}-Linux-${arch}.${ext}',
    desktop: {entry: {StartupWMClass: 'ki-metadata-workbench'}},
  },
  deb: {
    maintainer: 'Kuykendall Industries',
    // ExifTool ships its source/modules, while Perl and Brotli come from the OS.
    depends: [
      'libc6 (>= 2.39)', 'libgtk-3-0t64 | libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1',
      'libxtst6', 'xdg-utils', 'libatspi2.0-0t64 | libatspi2.0-0', 'libuuid1', 'libsecret-1-0',
      'libasound2t64 | libasound2', 'libgbm1', 'perl', 'libio-compress-brotli-perl',
    ],
  },
};
