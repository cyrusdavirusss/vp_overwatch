import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The mobile shell loads its application code from ONE operator-controlled HTTPS
 * origin.
 *
 * It used to be `http://100.94.31.125:3100` with `cleartext: true`, which meant the
 * whole shell — HTML and JavaScript — arrived over plain HTTP. Anyone who could
 * influence that network path could substitute the app's code in the WebView: not
 * a data response, the application itself. Release builds must not load remote
 * code over cleartext.
 *
 * Local development still works, but it is opt-in at build time so a release
 * artifact cannot carry it by accident:
 *
 *     VP_DEV_SERVER_URL=http://100.94.31.125:3100 npx cap sync android
 *
 * and a cleartext URL then needs the DEBUG network-security config
 * (android/app/src/debug/res/xml/network_security_config.xml); the release config
 * permits no cleartext at all.
 */
const devServerUrl = process.env.VP_DEV_SERVER_URL

const config: CapacitorConfig = {
  appId: 'com.vpoverwatch.app',
  appName: 'VP-Overwatch',
  webDir: 'out',
  server: devServerUrl
    ? { url: devServerUrl, cleartext: devServerUrl.startsWith('http://') }
    : { url: 'https://vpoverwatch.com', cleartext: false },
}

export default config
