/**
 * Lua Sandbox Worker
 * 
 * Handles Luau/Lua script execution in an isolated Web Worker.
 * Uses Fengari (Lua VM in JavaScript) to run scripts.
 * 
 * Messages:
 * - { type: 'execute', script: string } -> { type: 'result', value: any }
 * - { type: 'execute', script: string } -> { type: 'error', message: string }
 * - { type: 'getGlobal', name: string } -> { type: 'global', value: any }
 * - { type: 'setGlobal', name: string, value: any } -> { type: 'ok' }
 */

import fengari from 'fengari';
import fengari_web from 'fengari-web';

const { lua, lauxlib, lualib, luaconf } = fengari;
const { to_luastring, to_jsstring } = fengari;

// Initialize Fengari with web bindings
fengari_web.initialize();

// Create Lua state
const L = lauxlib.luaL_newstate();

// Open standard libraries
lualib.luaL_openlibs(L);

// Message handler
self.onmessage = function(e) {
  const { type, id, ...data } = e.data;
  
  try {
    switch (type) {
      case 'execute':
        handleExecute(id, data.script);
        break;
      case 'getGlobal':
        handleGetGlobal(id, data.name);
        break;
      case 'setGlobal':
        handleSetGlobal(id, data.name, data.value);
        break;
      case 'ping':
        self.postMessage({ type: 'pong', id });
        break;
      default:
        self.postMessage({ type: 'error', id, message: `Unknown message type: ${type}` });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err.message });
  }
};

function handleExecute(id: number, script: string) {
  // Reset stack
  lua.lua_settop(L, 0);
  
  // Load and execute script
  const loadResult = lua.luaL_loadstring(L, to_luastring(script));
  
  if (loadResult !== 0) {
    const errorMsg = to_jsstring(lua.lua_tostring(L, -1));
    self.postMessage({ type: 'error', id, message: `Load error: ${errorMsg}` });
    return;
  }
  
  // Call the script
  const callResult = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
  
  if (callResult !== 0) {
    const errorMsg = to_jsstring(lua.lua_tostring(L, -1));
    self.postMessage({ type: 'error', id, message: `Runtime error: ${errorMsg}` });
    return;
  }
  
  // Get return values
  const numReturns = lua.lua_gettop(L);
  const returns: any[] = [];
  
  for (let i = 1; i <= numReturns; i++) {
    const value = lua.lua_tointeger(L, i);
    returns.push(value);
  }
  
  self.postMessage({ type: 'result', id, value: returns });
}

function handleGetGlobal(id: number, name: string) {
  lua.lua_getglobal(L, to_luastring(name));
  const value = lua.lua_tointeger(L, -1);
  self.postMessage({ type: 'global', id, name, value });
}

function handleSetGlobal(id: number, name: string, value: any) {
  lua.lua_pushinteger(L, value);
  lua.lua_setglobal(L, to_luastring(name));
  self.postMessage({ type: 'ok', id });
}

// Signal ready
self.postMessage({ type: 'ready' });
