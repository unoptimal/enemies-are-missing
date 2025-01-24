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
let preferencesWindow = null
let isRecordingShortcut = false
let currentShortcut = 'CommandOrControl+Y'

let currentlyPressedKeys = new Set()
let currentModifiers = new Set()

const store = new Store({
  defaults: {
    shortcut: 'CommandOrControl+Y',
  },
})

function createOverlayWindow(x, y) {
  const overlay = new BrowserWindow({
    width: 640,
    height: 360,
    x: x - 320,
    y: y - 180,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
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

function createPreferencesWindow() {
  if (preferencesWindow) {
    preferencesWindow.focus()
    return
  }

  preferencesWindow = new BrowserWindow({
    width: 440,
    height: 200,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  preferencesWindow.loadFile('preferences.html')

  preferencesWindow.on('closed', () => {
    preferencesWindow = null
    isRecordingShortcut = false
    currentlyPressedKeys.clear()
    currentModifiers.clear()
  })
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.png'))

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'About Enemies Are Missing',
      enabled: true,
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

  tray.setToolTip('Ping Overlay')
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

  const handleKeyboard = (e, input) => {
    if (!isRecordingShortcut) return

    if (input.type === 'keyDown') {
      const key = convertKeyName(input.key)

      if (key === 'Control' || input.key === 'Control') {
        if (currentModifiers.has('Control')) {
          currentModifiers.delete('Control')
        } else {
          currentModifiers.add('Control')
        }
      }
      if (key === 'Meta' || input.key === 'Meta' || key === 'Command') {
        if (currentModifiers.has('Command')) {
          currentModifiers.delete('Command')
        } else {
          currentModifiers.add('Command')
        }
      }
      if (key === 'Alt' || input.key === 'Alt') {
        if (currentModifiers.has('Alt')) {
          currentModifiers.delete('Alt')
        } else {
          currentModifiers.add('Alt')
        }
      }
      if (key === 'Shift' || input.key === 'Shift') {
        if (currentModifiers.has('Shift')) {
          currentModifiers.delete('Shift')
        } else {
          currentModifiers.add('Shift')
        }
      }

      if (!['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(key)) {
        if (currentlyPressedKeys.has(key)) {
          currentlyPressedKeys.delete(key)
        } else {
          currentlyPressedKeys.add(key)
        }
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

app.dock?.hide()

app.whenReady().then(() => {
  createTray()

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
