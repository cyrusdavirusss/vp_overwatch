import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.vpoverwatch.app',
  appName: 'VP-Overwatch',
  webDir: 'out',
  server: {
    url: 'http://100.94.31.125:3100',
    cleartext: true,
  },
}

export default config
