module.exports = {
  packagerConfig: {
    asar: true,
    appCopyright: 'Copyright 2025 Helix Browser',
    icon: './assets/icon' // no extension needed for packagerConfig
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'helix_browser',
        setupIcon: './assets/icon.ico'
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux'],
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'CodeVoyager210',
          name: 'helix-browser',
        },
        prerelease: false,
        draft: true,
      },
    },
  ],
};
