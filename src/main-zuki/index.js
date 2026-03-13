import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import fs from 'fs'
import path from 'path'

let serverProcess = null

function startServer() {
  // In production, server is in extraResources/server/
  // In dev, use the source directly
  const isDev = !app.isPackaged
  const serverPath = isDev
    ? path.join(__dirname, '../../src/api/server.ts')
    : path.join(process.resourcesPath, 'server/src/api/server.ts')

  const cmd = isDev ? 'npx' : 'node'
  const args = isDev ? ['tsx', serverPath] : [serverPath]

  serverProcess = spawn(cmd, args, {
    cwd: isDev
      ? path.join(__dirname, '../../')
      : path.join(process.resourcesPath, 'server'),
    stdio: 'pipe',
    shell: true
  })

  serverProcess.stdout?.on('data', (d) => console.log('[SERVER]', d.toString().trim()))
  serverProcess.stderr?.on('data', (d) => console.error('[SERVER ERR]', d.toString().trim()))
  serverProcess.on('exit', (code) => console.log('[SERVER] Exited with code', code))
  console.log('[SERVER] API server spawned')
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 950,
    height: 650,
    minWidth: 600,
    minHeight: 400,
    show: false,
    frame: false, 
    autoHideMenuBar: true,
    transparent: false, // Keep false for resizing stability
    backgroundColor: '#09090b',
    resizable: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false
    }
  })

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; connect-src 'self' https: http:;"]
      }
    })
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // --- WINDOW CONTROLS ---
  ipcMain.on('minimize-window', () => mainWindow.minimize())
  ipcMain.on('maximize-window', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('close-window', () => mainWindow.close())

  // --- NEW: ALWAYS ON TOP HANDLER ---
  ipcMain.on('set-top-most', (_, isTop) => {
    mainWindow.setAlwaysOnTop(isTop)
  })
}

// --- FILE & API HANDLERS ---
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Scripts', extensions: ['lua', 'txt', 'json', 'md'] }, { name: 'All Files', extensions: ['*'] }]
  })
  if (canceled) return null
  const content = fs.readFileSync(filePaths[0], 'utf-8')
  return { name: path.basename(filePaths[0]), content, path: filePaths[0] }
})

ipcMain.handle('api:fetchScripts', async (_, { mode, query, page }) => {
  try {
    let url = `https://scriptblox.com/api/script/${mode}?page=${page}`
    if (mode === 'search') url = `https://scriptblox.com/api/script/search?q=${encodeURIComponent(query)}&page=${page}`
    
    const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    })
    
    if (!response.ok) return { scripts: [], totalPages: 1 }
    const data = await response.json()
    
    if (data.result && data.result.scripts) {
        return { scripts: data.result.scripts, totalPages: data.result.totalPages || 1 }
    }
    return { scripts: [], totalPages: 1 }
  } catch (error) {
    return { scripts: [], totalPages: 1 }
  }
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.clawblox.studio')
  app.on('browser-window-created', (_, window) => { optimizer.watchWindowShortcuts(window) })
  startServer()
  createWindow()
  app.on('activate', function () { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
    console.log('[SERVER] API server killed on quit')
  }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })