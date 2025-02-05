import {
  app,
  BrowserWindow,
  globalShortcut,
  screen,
  Tray,
  Menu,
  ipcMain,
} from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import Store from 'electron-store'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let overlayWindows = new Set()
let tray = null
let aboutWindow = null
let preferencesWindow = null
let isRecordingShortcut = false
let currentShortcut = 'CommandOrControl+Y'

let currentlyPressedKeys = new Set()
let currentModifiers = new Set()

class PingLimiter {
  constructor() {
    this.pings = []
    this.isLocked = false
    this.lockoutDuration = 0
    this.PING_WINDOW = 5000
    this.MAX_PINGS = 6
    this.LOCKOUT_DURATIONS = [6, 12, 16, 20, 24]
    this.warningWindow = null
  }

  initializeWarningWindow() {
    if (this.warningWindow) return

    this.warningWindow = new BrowserWindow({
      width: 300,
      height: 400,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    })

    const display = screen.getPrimaryDisplay()
    const { width, height } = display.workAreaSize

    this.warningWindow.setPosition(20, height - 420)
    this.warningWindow.loadFile('warning.html')
    this.warningWindow.setIgnoreMouseEvents(true)
  }

  cleanupOldPings() {
    const now = Date.now()
    this.pings = this.pings.filter(
      pingTime => now - pingTime < this.PING_WINDOW
    )
  }

  calculateLockoutDuration() {
    const violationCount = Math.min(
      this.LOCKOUT_DURATIONS.length - 1,
      Math.floor(this.pings.length / this.MAX_PINGS)
    )
    return this.LOCKOUT_DURATIONS[violationCount] * 1000
  }

  showWarning() {
    if (!this.warningWindow || this.warningWindow.isDestroyed()) {
      this.initializeWarningWindow()
    }
    this.warningWindow.webContents.send('show-warning')
  }

  startLockoutTimer() {
    setTimeout(() => {
      this.isLocked = false
    }, this.lockoutDuration)
  }

  attemptPing() {
    const now = Date.now()
    this.cleanupOldPings()

    if (this.isLocked) {
      this.showWarning()
      return false
    }

    this.pings.push(now)

    if (this.pings.length >= this.MAX_PINGS) {
      this.lockoutDuration = this.calculateLockoutDuration()
      this.isLocked = true
      this.startLockoutTimer()
      return true
    }

    return true
  }
}

const pingLimiter = new PingLimiter()

const store = new Store({
  defaults: {
    shortcut: 'CommandOrControl+G',
    volume: 0.5,
    size: 'small',
    hasLaunched: false,
    pingDelay: false,
    rateLimit: false,
  },
})

function createFirstLaunchWindow() {
  const windowOptions = {
    width: 400,
    height: 320,
    resizable: false,
    show: false,
    backgroundColor: '#232323',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  }

  if (process.platform !== 'darwin') {
    windowOptions.icon = path.join(__dirname, 'build/icon.ico')
    windowOptions.autoHideMenuBar = true
  }

  const win = new BrowserWindow(windowOptions)

  win.once('ready-to-show', () => {
    win.show()
  })

  win.loadFile('first-launch.html')
}

function createAboutWindow() {
  if (aboutWindow) {
    aboutWindow.focus()
    return
  }

  const windowOptions = {
    width: 380,
    height: 280,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#232323',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  }

  if (process.platform !== 'darwin') {
    windowOptions.icon = path.join(__dirname, 'build/icon.ico')
    windowOptions.autoHideMenuBar = true
  }

  aboutWindow = new BrowserWindow(windowOptions)
  aboutWindow.loadFile('about.html')

  aboutWindow.once('ready-to-show', () => {
    aboutWindow.show()
  })

  aboutWindow.on('closed', () => {
    aboutWindow = null
  })
}

function createPreferencesWindow() {
  if (preferencesWindow) {
    preferencesWindow.focus()
    return
  }

  const windowOptions = {
    width: 380,
    height: process.platform === 'darwin' ? 510 : 530,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#232323',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  }

  if (process.platform !== 'darwin') {
    windowOptions.icon = path.join(__dirname, 'build/icon.ico')
    windowOptions.autoHideMenuBar = true
  }

  preferencesWindow = new BrowserWindow(windowOptions)

  preferencesWindow.once('ready-to-show', () => {
    preferencesWindow.show()
  })

  preferencesWindow.loadFile('preferences.html')

  preferencesWindow.on('closed', () => {
    preferencesWindow = null
    isRecordingShortcut = false
    currentlyPressedKeys.clear()
    currentModifiers.clear()
  })
}

let lastPingTime = 0
function createOverlayWindow(x, y) {
  const now = Date.now()
  const pingDelay = store.get('pingDelay')
  const rateLimit = store.get('rateLimit')

  if (pingDelay && now - lastPingTime < 300) {
    return
  }

  if (rateLimit && !pingLimiter.attemptPing()) {
    return
  }

  lastPingTime = now

  const displays = screen.getAllDisplays()
  const cursorDisplay = displays.find(display => {
    const {
      x: displayX,
      y: displayY,
      width: displayWidth,
      height: displayHeight,
    } = display.bounds
    return (
      x >= displayX &&
      x <= displayX + displayWidth &&
      y >= displayY &&
      y <= displayY + displayHeight
    )
  })

  if (!cursorDisplay) return

  const { width: screenWidth, height: screenHeight } = cursorDisplay.bounds
  const overlayWidth = 128
  const overlayHeight = 226

  const adjustedX = Math.max(
    cursorDisplay.bounds.x,
    Math.min(
      x - overlayWidth / 2,
      cursorDisplay.bounds.x + screenWidth - overlayWidth
    )
  )
  const adjustedY = Math.max(
    cursorDisplay.bounds.y,
    Math.min(
      y - overlayHeight / 2 - 50,
      cursorDisplay.bounds.y + screenHeight - overlayHeight
    )
  )

  const overlay = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    x: adjustedX,
    y: adjustedY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    type: 'toolbar',
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  overlayWindows.add(overlay)
  overlay.setIgnoreMouseEvents(true)
  overlay.loadFile('overlay.html')
  overlay.setBackgroundColor('#00000000')

  setTimeout(() => {
    if (!overlay.isDestroyed()) {
      overlay.close()
      overlayWindows.delete(overlay)
    }
  }, 1800)

  overlay.on('closed', () => {
    overlayWindows.delete(overlay)
  })
}

function createTray() {
  const iconPath =
    process.platform === 'darwin'
      ? path.join(__dirname, 'assets', 'icon-mac.png')
      : path.join(__dirname, 'assets', 'icon-win.png')

  tray = new Tray(iconPath)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'About Enemies Are Missing',
      click: () => {
        createAboutWindow()
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Preferences...',
      click: () => {
        createPreferencesWindow()
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      },
    },
  ])

  tray.setToolTip('Enemies Are Missing')
  tray.setContextMenu(contextMenu)
}

function convertKeyName(key) {
  const keyConversions = {
    ' ': 'Space',
    '+': 'Plus',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    AudioVolumeMute: 'Mute',
    AudioVolumeUp: 'VolumeUp',
    AudioVolumeDown: 'VolumeDown',
    MediaPlayPause: 'MediaPlayPause',
  }

  return keyConversions[key] || (key.length === 1 ? key.toUpperCase() : key)
}

function updateShortcutDisplay() {
  if (!preferencesWindow) return

  const modifierArray = Array.from(currentModifiers)
  const keyArray = Array.from(currentlyPressedKeys)
  const allKeys = [...modifierArray, ...keyArray]
  const shortcutString = allKeys.join('+')

  preferencesWindow.webContents.send('shortcut-recording', shortcutString)
}

function registerShortcut(shortcut) {
  globalShortcut.unregisterAll()

  try {
    globalShortcut.register(shortcut, () => {
      const point = screen.getCursorScreenPoint()
      createOverlayWindow(point.x, point.y)
    })
    currentShortcut = shortcut
    store.set('shortcut', shortcut)
    return true
  } catch (error) {
    console.error('Failed to register shortcut:', error)
    globalShortcut.register(currentShortcut, () => {
      const point = screen.getCursorScreenPoint()
      createOverlayWindow(point.x, point.y)
    })
    return false
  }
}

ipcMain.handle('get-size', () => {
  return store.get('size')
})

ipcMain.on('set-size', (_, size) => {
  store.set('size', size)
})

ipcMain.handle('get-volume', () => {
  return store.get('volume')
})

ipcMain.on('set-volume', (_, volume) => {
  store.set('volume', volume)
})

ipcMain.handle('get-shortcut', () => {
  return store.get('shortcut')
})

ipcMain.on('set-shortcut', (_, shortcut) => {
  registerShortcut(shortcut)
})

ipcMain.on('start-recording', () => {
  isRecordingShortcut = true
  globalShortcut.unregisterAll()
  currentlyPressedKeys.clear()
  currentModifiers.clear()

  if (preferencesWindow) {
    preferencesWindow.webContents.executeJavaScript(
      'window.isRecording = true;'
    )
  }

  const handleKeyboard = (e, input) => {
    if (!isRecordingShortcut) return

    if (input.type === 'keyDown') {
      const key = convertKeyName(input.key)

      if (key === 'Control' || input.key === 'Control') {
        currentModifiers.add('Control')
      }
      if (key === 'Meta' || input.key === 'Meta' || key === 'Command') {
        currentModifiers.add('Command')
      }
      if (key === 'Alt' || input.key === 'Alt') {
        currentModifiers.add('Alt')
      }
      if (key === 'Shift' || input.key === 'Shift') {
        currentModifiers.add('Shift')
      }

      if (!['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(key)) {
        currentlyPressedKeys.add(key)
      }

      updateShortcutDisplay()
    }
  }

  if (preferencesWindow) {
    preferencesWindow.webContents.on('before-input-event', handleKeyboard)
  }
})

ipcMain.on('stop-recording', () => {
  isRecordingShortcut = false
  if (preferencesWindow) {
    preferencesWindow.webContents.executeJavaScript(
      'window.isRecording = false;'
    )
    preferencesWindow.webContents.removeAllListeners('before-input-event')

    const modifierArray = Array.from(currentModifiers)
    const keyArray = Array.from(currentlyPressedKeys)
    const shortcut = [...modifierArray, ...keyArray].join('+')

    preferencesWindow.webContents.send('shortcut-recorded', shortcut)
  }

  currentlyPressedKeys.clear()
  currentModifiers.clear()

  registerShortcut(currentShortcut)
})

ipcMain.on('close-preferences', () => {
  if (preferencesWindow) {
    preferencesWindow.close()
  }
})

ipcMain.handle('get-ping-delay', () => {
  return store.get('pingDelay')
})

ipcMain.on('set-ping-delay', (_, enabled) => {
  store.set('pingDelay', enabled)
})

ipcMain.handle('get-rate-limit', () => {
  return store.get('rateLimit')
})

ipcMain.on('set-rate-limit', (_, enabled) => {
  store.set('rateLimit', enabled)
})

app.dock?.hide()

app.whenReady().then(() => {
  createTray()
  pingLimiter.initializeWarningWindow()

  const isFirstLaunch = !store.get('hasLaunched')
  if (isFirstLaunch) {
    createFirstLaunchWindow()
    store.set('hasLaunched', true)
  }

  const savedShortcut = store.get('shortcut')
  registerShortcut(savedShortcut)
})

app.on('window-all-closed', e => {
  e.preventDefault()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  for (const window of overlayWindows) {
    if (!window.isDestroyed()) {
      window.close()
    }
  }

  if (tray) {
    tray.destroy()
  }
})
