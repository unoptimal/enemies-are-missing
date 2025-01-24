import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let overlayWindows = new Set()

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
    }
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

app.whenReady().then(() => {
  globalShortcut.register('CommandOrControl+Y', () => {
    const point = screen.getCursorScreenPoint()
    createOverlayWindow(point.x, point.y)
  })
})

app.on('window-all-closed', (e) => {
  e.preventDefault()
})

app.on('before-quit', () => {
  for (const window of overlayWindows) {
    if (!window.isDestroyed()) {
      window.close()
    }
  }
})