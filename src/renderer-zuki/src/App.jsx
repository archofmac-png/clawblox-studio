import React, { useState, useEffect, useRef, useCallback } from "react";
import Editor from "@monaco-editor/react";
import Viewport3D from "./Viewport3D";

const GAME_API_URL = "http://localhost:3001";

import {
  Files, Settings, Minus, Square, X, ChevronRight, Plus,
  Play, Square as SquareIcon, Save, FolderOpen, Trash2, Link, Unlink,
  Monitor, Pause, Box, FileCode, Grid3X3, Gauge, Camera, FlaskConical, Rocket,
} from "lucide-react";

const PRESET_THEMES = {
  dracula: { name: "Dracula", bg: "#282a36", sidebar: "#21222c", accent: "#ff79c6", button: "#bd93f9", text: "#f8f8f2" },
  monokai: { name: "Monokai", bg: "#272822", sidebar: "#1e1f1c", accent: "#a6e22e", button: "#f92672", text: "#f8f8f2" },
  nord: { name: "Nord", bg: "#2e3440", sidebar: "#3b4252", accent: "#88c0d0", button: "#81a1c1", text: "#d8dee9" },
  synthwave: { name: "Synthwave", bg: "#2b213a", sidebar: "#241b2f", accent: "#ff7edb", button: "#36f9f6", text: "#fbfbfb" },
  acrylic: { name: "Acrylic", bg: "#09090b", sidebar: "#121214", accent: "#22d3ee", button: "#22d3ee", text: "#ffffff" },
};

const ROBLOX_GLOBALS = ["game", "workspace", "Players", "ReplicatedStorage", "ReplicatedFirst", "RunService", "CollectionService", "DataStoreService", "TweenService", "Debris", "HttpService", "UserInputService"];
const ROBLOX_FUNCTIONS = ["print", "warn", "error", "pcall", "xpcall", "require", "Instance.new", "Vector3.new", "CFrame.new", "Color3.new", "task.spawn", "task.delay", "task.wait"];
const ROBLOX_TYPES = ["Part", "Script", "LocalScript", "ModuleScript", "RemoteEvent", "RemoteFunction", "BindableEvent", "Folder", "Model", "ScreenGui", "Frame", "Tool", "Humanoid"];

const getInstanceIcon = (className) => {
  const m = { Workspace: "🌍", Players: "👤", ReplicatedStorage: "📦", Part: "🧱", Script: "📝", LocalScript: "📝", ModuleScript: "📝", RemoteEvent: "📨", RemoteFunction: "📡", BindableEvent: "🔔", Folder: "📁", Model: "📐", Humanoid: "🧑", Player: "👤" };
  return m[className] || "⬜";
};

export default function App() {
  const [cameraMode, setCameraMode] = useState("orbit");
  const [gridEnabled, setGridEnabled] = useState(true);
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [activeActivity, setActiveActivity] = useState("files");
  const [leftPanelTab, setLeftPanelTab] = useState("files");
  const [expandedFolders, setExpandedFolders] = useState({ src: true, scripts: true });
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [viewportVisible, setViewportVisible] = useState(true);
  const [logs, setLogs] = useState([{ type: "info", text: "ClawBlox Studio v3.2 initialized..." }]);
  const [outputLines, setOutputLines] = useState([{ type: "info", text: "ClawBlox Studio — Output ready", timestamp: new Date().toLocaleTimeString() }]);
  const [cmdInput, setCmdInput] = useState("");
  const [cmdRunning, setCmdRunning] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [instances, setInstances] = useState([]);
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [instanceProperties, setInstanceProperties] = useState(null);
  const outputEndRef = useRef(null);
  const explorerIntervalRef = useRef(null);

  useEffect(() => { outputEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [outputLines]);

  const addOutput = useCallback((text, type = "print") => {
    setOutputLines(prev => [...prev, { type, text, timestamp: new Date().toLocaleTimeString() }]);
  }, []);

  const clearOutput = useCallback(() => setOutputLines([]), []);

  useEffect(() => {
    let ws, reconnectTimer;
    const connect = () => {
      try {
        ws = new WebSocket("ws://localhost:3002");
        ws.onopen = () => addOutput("🔌 Connected to ClawBlox engine", "info");
        ws.onmessage = (e) => { try { const d = JSON.parse(e.data); addOutput(d.message, d.type === "warn" ? "warn" : d.type === "error" ? "error" : "print"); } catch { addOutput(e.data, "print"); } };
        ws.onclose = () => { addOutput("⚡ Engine disconnected — reconnecting...", "warn"); reconnectTimer = setTimeout(connect, 3000); };
      } catch { reconnectTimer = setTimeout(connect, 3000); }
    };
    connect();
    return () => { clearTimeout(reconnectTimer); if (ws) ws.close(); };
  }, [addOutput]);

  const fetchInstances = useCallback(async () => {
    try { const r = await fetch(`${GAME_API_URL}/api/game/instances`); if (r.ok) { const d = await r.json(); setInstances(d.instances || []); } } catch {}
  }, []);

  const fetchInstanceProperties = useCallback(async (path) => {
    try { const r = await fetch(`${GAME_API_URL}/api/game/query?path=${encodeURIComponent(path)}`); if (r.ok) { const d = await r.json(); setInstanceProperties(d); } } catch { setInstanceProperties(null); }
  }, []);

  useEffect(() => {
    if (leftPanelTab === "explorer") { fetchInstances(); explorerIntervalRef.current = setInterval(fetchInstances, 3000); }
    else if (explorerIntervalRef.current) clearInterval(explorerIntervalRef.current);
    return () => { if (explorerIntervalRef.current) clearInterval(explorerIntervalRef.current); };
  }, [leftPanelTab, fetchInstances]);

  const handleSelectInstance = useCallback((inst) => { setSelectedInstance(inst); if (inst && inst.Path) fetchInstanceProperties(inst.Path); }, [fetchInstanceProperties]);

  const runCmdScript = useCallback(async (script) => {
    if (!script.trim()) return; setCmdRunning(true); addOutput(`> ${script}`, "info");
    try {
      const r = await fetch("http://localhost:3001/api/game/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script }) });
      const d = await r.json();
      if (d.output) d.output.forEach(l => addOutput(l, "print"));
      if (!d.success) addOutput(`Error: ${d.error}`, "error");
      else if (d.returns) addOutput(`→ ${JSON.stringify(d.returns)}`, "print");
    } catch (e) { addOutput(`Error: ${e.message}`, "error"); }
    finally { setCmdRunning(false); }
  }, [addOutput]);

  const [gameState, setGameState] = useState("stopped");
  const [gameStatus, setGameStatus] = useState(null);

  const startGame = async () => {
    if (gameState === "running" || gameState === "starting") return;
    setGameState("starting");
    try {
      const r = await fetch(`${GAME_API_URL}/api/game/start`, { method: "POST", headers: { "Content-Type": "application/json" } });
      const d = await r.json();
      if (d.success) { setGameState("running"); setGameStatus(d); const sr = await fetch(`${GAME_API_URL}/api/game/state`); setGameStatus(await sr.json()); }
      else { setGameState("stopped"); addLog(`Failed: ${d.error}`, "error"); }
    } catch (e) { setGameState("stopped"); addLog(`Error: ${e.message}`, "error"); }
  };

  const stopGame = async () => {
    if (gameState === "stopped" || gameState === "stopping") return;
    setGameState("stopping");
    try {
      const r = await fetch(`${GAME_API_URL}/api/game/stop`, { method: "POST" });
      const d = await r.json();
      if (d.success) { setGameState("stopped"); setGameStatus(d); }
    } catch (e) { addLog(`Error: ${e.message}`, "error"); }
  };

  const pauseGame = stopGame;

  const executeScript = async (code) => {
    if (gameState !== "running") { addOutput("⚠️ Start game first!", "warn"); return; }
    addOutput("▶ Executing...", "info");
    try {
      const r = await fetch(`${GAME_API_URL}/api/game/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script: code }) });
      const d = await r.json();
      if (d.success) { if (d.output) d.output.forEach(l => addOutput(l, "print")); if (d.returns) addOutput(`→ ${JSON.stringify(d.returns)}`, "print"); }
      else addOutput(`Error: ${d.error}`, "error");
    } catch (e) { addOutput(`Error: ${e.message}`, "error"); }
  };

  const insertPart = async () => {
    const code = "local p = Instance.new('Part'); p.Parent = workspace; p.Name = 'InsertedPart'; p.Position = Vector3.new(0, 5, 0)";
    await executeScript(code);
    addOutput("📦 Inserted Part", "info");
  };

  const insertScript = () => {
    const id = Date.now().toString();
    setFiles([...files, { id, name: "NewScript.lua", folder: "scripts", content: "-- NewScript\nprint('Hello from NewScript')\n", isTemp: true }]);
    setOpenTabIds([...openTabIds, id]);
    setActiveTabId(id);
    addLog("Created NewScript.lua", "success");
  };

  useEffect(() => {
    if (gameState !== "running") return;
    const i = setInterval(async () => { try { const r = await fetch(`${GAME_API_URL}/api/game/state`); setGameStatus(await r.json()); } catch {} }, 2000);
    return () => clearInterval(i);
  }, [gameState]);

  const handleExecute = () => { const f = files.find(f => f.id === activeTabId); if (f) executeScript(f.content); };

  const [settings, setSettings] = useState({ theme: "dracula", fontSize: 14, showLineNumbers: true });
  const colors = PRESET_THEMES[settings.theme] || PRESET_THEMES.dracula;

  const [files, setFiles] = useState([{ id: "1", name: "Main.lua", folder: "scripts", content: '-- Main Script\nprint("Hello from ClawBlox!")\n', isTemp: false }]);
  const [openTabIds, setOpenTabIds] = useState(["1"]);
  const [activeTabId, setActiveTabId] = useState("1");
  const [renamingId, setRenamingId] = useState(null);

  // Test Runner state
  const [testFiles, setTestFiles] = useState([]);
  const [selectedTestFile, setSelectedTestFile] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testAdHocCode, setTestAdHocCode] = useState('-- Write ad-hoc test code here\ndescribe("My Test", function()\n  it("passes", function()\n    expect(1 + 1):toBe(2)\n  end)\nend)');
  const [testAdHocResults, setTestAdHocResults] = useState(null);
  const [testAdHocRunning, setTestAdHocRunning] = useState(false);

  // Deploy state
  const [deploying, setDeploying] = useState(false);
  const [deployHistory, setDeployHistory] = useState([]);
  const [currentProjectPath, setCurrentProjectPath] = useState('');

  const fetchDeployHistory = useCallback(async () => {
    try {
      const r = await fetch(`${GAME_API_URL}/api/deploy/history`);
      if (r.ok) { const d = await r.json(); setDeployHistory(d); }
    } catch {}
  }, []);

  const handleDeploy = useCallback(async () => {
    if (!currentProjectPath) {
      addOutput("⚠️ No project selected. Open a project first.", "warn");
      return;
    }
    if (deploying) return;
    setDeploying(true);
    addOutput("🚀 Starting deploy...", "info");
    try {
      const r = await fetch(`${GAME_API_URL}/api/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: currentProjectPath }),
      });
      const d = await r.json();
      if (d.success || d.pushedToRoblox) {
        addOutput(`✅ Deploy complete! ID: ${d.deployId} | Scripts: ${d.scriptsDeployed} | Pushed to Roblox: ${d.pushedToRoblox}`, "print");
      } else {
        addOutput(`⚠️ Deploy ran but had errors: ${(d.errors || []).join(", ")}`, "warn");
        addOutput(`📦 Local .rbxlx generated: ${d.rbxlxPath}`, "info");
      }
      await fetchDeployHistory();
    } catch (e) {
      addOutput(`❌ Deploy failed: ${e.message}`, "error");
    } finally {
      setDeploying(false);
    }
  }, [deploying, currentProjectPath, addOutput, fetchDeployHistory]);

  useEffect(() => { fetchDeployHistory(); }, [fetchDeployHistory]);

  const fetchTestFiles = useCallback(async () => {
    try {
      const r = await fetch(`${GAME_API_URL}/api/test/files`);
      if (r.ok) { const d = await r.json(); setTestFiles(d.files || []); }
    } catch {}
  }, []);

  const runTestFile = useCallback(async (filePath) => {
    if (!filePath) return;
    setTestRunning(true); setTestResults(null);
    try {
      const r = await fetch(`${GAME_API_URL}/api/test/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filePath }) });
      if (r.ok) { const d = await r.json(); setTestResults(d); }
      else { setTestResults({ error: "Server error" }); }
    } catch (e) { setTestResults({ error: e.message }); }
    finally { setTestRunning(false); }
  }, []);

  const runAdHocTest = useCallback(async () => {
    if (!testAdHocCode.trim()) return;
    setTestAdHocRunning(true); setTestAdHocResults(null);
    try {
      const r = await fetch(`${GAME_API_URL}/api/test/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: testAdHocCode }) });
      if (r.ok) { const d = await r.json(); setTestAdHocResults(d); }
      else { setTestAdHocResults({ error: "Server error" }); }
    } catch (e) { setTestAdHocResults({ error: e.message }); }
    finally { setTestAdHocRunning(false); }
  }, [testAdHocCode]);

  useEffect(() => {
    if (activeActivity === "tests") fetchTestFiles();
  }, [activeActivity, fetchTestFiles]);

  const addLog = (t, ty = "info") => setLogs(p => [...p, { type: ty, text: t, time: new Date().toLocaleTimeString() }]);

  const handleNewFile = (name, content = "", isTemp = true) => {
    const id = Date.now().toString();
    setFiles([...files, { id, name: name || "Untitled.lua", folder: "root", content, isTemp }]);
    setOpenTabIds([...openTabIds, id]);
    setActiveTabId(id);
  };

  const handleRename = (id, newName) => { if (newName.trim()) setFiles(files.map(f => f.id === id ? { ...f, name: newName } : f)); setRenamingId(null); };
  const handleCloseTab = (e, id) => { const nt = openTabIds.filter(t => t !== id); setOpenTabIds(nt); if (activeTabId === id) setActiveTabId(nt[nt.length - 1] || null); };
  const handleEditorChange = (val) => setFiles(files.map(f => f.id === activeTabId ? { ...f, content: val } : f));
  const toggleFolder = (n) => setExpandedFolders(p => ({ ...p, [n]: !p[n] }));
  const activeFile = files.find(f => f.id === activeTabId);
  const uniqueFolders = [...new Set(files.map(f => f.folder).filter(f => f !== "root"))].sort();

  const editorOptions = { fontSize: parseInt(settings.fontSize), minimap: { enabled: true }, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true, lineNumbers: settings.showLineNumbers ? 'on' : 'off', tabSize: 4, theme: 'vs-dark' };

  const handleEditorMount = (ed, monaco) => {
    monaco.languages.registerCompletionItemProvider('lua', {
      provideCompletionItems: (model, pos) => {
        const word = model.getWordUntilPosition(pos);
        const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const suggestions = [
          ...ROBLOX_GLOBALS.map(g => ({ label: g, kind: monaco.languages.CompletionItemKind.Variable, insertText: g, range, detail: 'Roblox' })),
          ...ROBLOX_FUNCTIONS.map(f => ({ label: f, kind: monaco.languages.CompletionItemKind.Function, insertText: f, range, detail: 'Function' })),
          ...ROBLOX_TYPES.map(t => ({ label: t, kind: monaco.languages.CompletionItemKind.Class, insertText: t, range, detail: 'Type' })),
        ];
        return { suggestions };
      }
    });
    ed.onDidChangeCursorPosition((e) => setCursorPosition({ line: e.position.lineNumber, column: e.position.column }));
  };

  const renderInstanceTree = () => {
    if (!instances.length) return <div className="p-2 text-xs opacity-50">No instances</div>;
    return instances.map((inst, i) => {
      const sel = selectedInstance && selectedInstance.Path === inst.Path;
      return <div key={inst.Path || i} onClick={() => handleSelectInstance(inst)} className={`flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-white/5 ${sel ? 'bg-blue-500/20 border-l-2 border-blue-500' : ''}`}><span className="text-xs">{getInstanceIcon(inst.ClassName)}</span><span className="text-xs truncate">{inst.Name || 'Unnamed'}</span></div>;
    });
  };

  const renderProperties = () => {
    if (!selectedInstance) return <div className="p-4 text-xs opacity-50 text-center">Select an instance</div>;
    if (!instanceProperties) return <div className="p-4 text-xs opacity-50">Loading...</div>;
    const props = [];
    if (instanceProperties.Name) props.push(['Name', instanceProperties.Name]);
    if (instanceProperties.ClassName) props.push(['ClassName', instanceProperties.ClassName]);
    if (instanceProperties.Position) props.push(['Position', JSON.stringify(instanceProperties.Position)]);
    if (instanceProperties.Size) props.push(['Size', JSON.stringify(instanceProperties.Size)]);
    if (instanceProperties.Anchored !== undefined) props.push(['Anchored', instanceProperties.Anchored.toString()]);
    if (!props.length) return <div className="p-2 text-xs opacity-50">No properties</div>;
    return props.map(([k, v], i) => <div key={i} className="flex justify-between py-1 px-2 border-b border-white/5 text-xs"><span className="opacity-70">{k}</span><span className="truncate max-w-[100px]">{v}</span></div>);
  };

  return (
    <div className="flex flex-col h-full absolute inset-0 font-sans overflow-hidden transition-colors duration-300" style={{ backgroundColor: colors.bg, color: colors.text }}>
      <TitleBar colors={colors} settings={settings} gameState={gameState} onAttach={() => gameState === "stopped" ? startGame() : stopGame()} />
      <Toolbar colors={colors} gameState={gameState} onPlay={startGame} onStop={stopGame} onPause={pauseGame} onInsertPart={insertPart} onInsertScript={insertScript} cameraMode={cameraMode} setCameraMode={setCameraMode} gridEnabled={gridEnabled} setGridEnabled={setGridEnabled} physicsEnabled={physicsEnabled} setPhysicsEnabled={setPhysicsEnabled} onDeploy={handleDeploy} deploying={deploying} />
      <div className="flex flex-1 overflow-hidden relative">
        <div className="w-12 flex flex-col items-center py-4 gap-4 z-20 border-r border-white/5" style={{ backgroundColor: colors.bg }}>
          <ActivityIcon icon={Files} id="files" active={activeActivity} onClick={setActiveActivity} colors={colors} />
          <ActivityIcon icon={FlaskConical} id="tests" active={activeActivity} onClick={setActiveActivity} colors={colors} />
          <ActivityIcon icon={Settings} id="settings" active={isSettingsOpen ? "settings" : activeActivity} onClick={() => setIsSettingsOpen(true)} colors={colors} />
          <div onClick={() => setViewportVisible(v => !v)} className={`p-2 rounded-lg cursor-pointer mt-auto transition-all`} style={{ color: viewportVisible ? "#fff" : colors.text, backgroundColor: viewportVisible ? colors.button : "transparent", opacity: viewportVisible ? 1 : 0.6 }}><Monitor size={20} /></div>
        </div>
        {activeActivity === "files" && (
          <>
            <div className="w-64 flex flex-col border-r border-white/5" style={{ backgroundColor: colors.sidebar }}>
              <div className="flex border-b border-white/5">
                <button onClick={() => setLeftPanelTab("files")} className={`flex-1 py-2 text-[11px] font-bold uppercase tracking-wider ${leftPanelTab === "files" ? 'border-b-2' : 'opacity-50'}`} style={{ borderColor: leftPanelTab === "files" ? colors.accent : "transparent" }}>Files</button>
                <button onClick={() => setLeftPanelTab("explorer")} className={`flex-1 py-2 text-[11px] font-bold uppercase tracking-wider ${leftPanelTab === "explorer" ? 'border-b-2' : 'opacity-50'}`} style={{ borderColor: leftPanelTab === "explorer" ? colors.accent : "transparent" }}>Explorer</button>
              </div>
              {leftPanelTab === "files" ? (
                <div className="flex-1 overflow-y-auto px-2">
                  <FolderItem name="PROJECT" isOpen={true} isRoot colors={colors}>
                    {uniqueFolders.map(fn => <FolderItem key={fn} name={fn} isOpen={expandedFolders[fn]} onClick={() => toggleFolder(fn)} indent={1} colors={colors}>{files.filter(f => f.folder === fn && !f.isTemp).map(f => <FileItem key={f.id} file={f} indent={2} active={activeTabId === f.id} isRenaming={renamingId === f.id} onClick={() => { if (!openTabIds.includes(f.id)) setOpenTabIds([...openTabIds, f.id]); setActiveTabId(f.id); }} setRenamingId={setRenamingId} onRename={handleRename} colors={colors} />)}</FolderItem>)}
                  </FolderItem>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto flex flex-col">
                  <div className="flex-1 overflow-y-auto">{renderInstanceTree()}</div>
                  <div className="border-t border-white/5 max-h-48 overflow-y-auto"><div className="px-2 py-1 text-[11px] font-bold uppercase opacity-50">Properties</div>{renderProperties()}</div>
                </div>
              )}
            </div>
            <div className="flex-1 flex flex-col relative min-w-0" style={{ backgroundColor: colors.bg }}>
              <div className="flex h-9 border-b border-white/5 overflow-x-auto scrollbar-hide items-center pr-2">
                {openTabIds.map(id => { const f = files.find(f => f.id === id); if (!f) return null; return <Tab key={f.id} file={f} active={activeTabId === f.id} onClick={() => setActiveTabId(f.id)} onClose={(e) => handleCloseTab(e, f.id)} colors={colors} settings={settings} />; })}
                <button onClick={() => handleNewFile()} className="ml-2 p-1 rounded hover:bg-white/10 opacity-60"><Plus size={14} /></button>
              </div>
              <div className="flex-1 overflow-hidden relative min-h-0">
                {activeFile ? <Editor language="lua" theme="vs-dark" value={activeFile.content} onChange={handleEditorChange} onMount={handleEditorMount} options={editorOptions} /> : <div className="flex items-center justify-center h-full opacity-50"><p className="text-sm">No file open</p></div>}
              </div>
              <div className="absolute bottom-[244px] right-6 flex items-center gap-4 z-20">
                <div className="flex items-center backdrop-blur-md border border-white/10 rounded-full p-1 shadow-lg" style={{ backgroundColor: colors.sidebar + 'aa' }}>
                  <TooltipButton icon={<Save size={16} />} onClick={() => {}} title="Save" colors={colors} />
                  <div className="w-px h-4 bg-white/10 mx-1"></div>
                  <TooltipButton icon={<Trash2 size={16} />} onClick={() => handleEditorChange("")} title="Clear" colors={colors} />
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={stopGame} disabled={gameState === "stopped"} className="flex items-center justify-center w-10 h-10 rounded-full border border-white/10 transition-all hover:scale-110 disabled:opacity-30" style={{ backgroundColor: colors.bg + 'cc', color: colors.text }}><SquareIcon size={16} fill="currentColor" /></button>
                  <button onClick={handleExecute} disabled={gameState !== "running"} className="flex items-center justify-center w-12 h-12 rounded-full border border-white/10 transition-all hover:scale-110" style={{ backgroundColor: gameState === "running" ? colors.button + 'cc' : colors.bg + 'cc', color: colors.text }}><Play size={20} fill="currentColor" className="ml-0.5" /></button>
                </div>
              </div>
              <OutputPanel outputLines={outputLines} onClear={clearOutput} cmdInput={cmdInput} setCmdInput={setCmdInput} onRun={runCmdScript} cmdRunning={cmdRunning} colors={colors} outputEndRef={outputEndRef} deployHistory={deployHistory} />
            </div>
            {viewportVisible && <div className="flex flex-col border-l border-white/5" style={{ width: 440, backgroundColor: "#15151a" }}><div className="h-9 px-3 flex items-center gap-2 text-[11px] font-bold tracking-widest opacity-60 uppercase border-b border-white/5" style={{ backgroundColor: colors.sidebar }}><Monitor size={12} />3D VIEWPORT</div><div className="flex-1 overflow-hidden"><Viewport3D colors={colors} addOutput={addOutput} gridEnabled={gridEnabled} physicsEnabled={physicsEnabled} cameraMode={cameraMode} /></div></div>}
          </>
        )}
        {activeActivity === "tests" && (
          <TestRunnerPanel
            colors={colors}
            testFiles={testFiles}
            selectedTestFile={selectedTestFile}
            setSelectedTestFile={setSelectedTestFile}
            testResults={testResults}
            testRunning={testRunning}
            onRunTest={runTestFile}
            onRefreshFiles={fetchTestFiles}
            testAdHocCode={testAdHocCode}
            setTestAdHocCode={setTestAdHocCode}
            testAdHocResults={testAdHocResults}
            testAdHocRunning={testAdHocRunning}
            onRunAdHoc={runAdHocTest}
          />
        )}
      </div>
      <StatusBar colors={colors} gameState={gameState} filename={activeFile?.name || ""} cursorPosition={cursorPosition} />
    </div>
  );
}

function TestRunnerPanel({ colors, testFiles, selectedTestFile, setSelectedTestFile, testResults, testRunning, onRunTest, onRefreshFiles, testAdHocCode, setTestAdHocCode, testAdHocResults, testAdHocRunning, onRunAdHoc }) {
  const [tab, setTab] = useState("files"); // "files" | "adhoc"

  const shortName = (fp) => fp.split("/").pop();

  const ResultsView = ({ results }) => {
    if (!results) return null;
    if (results.error) return <div className="text-xs text-red-400 p-2">Error: {results.error}</div>;
    const { passed = 0, failed = 0, duration = 0, results: rows = [] } = results;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3 px-3 py-2 rounded text-xs font-bold" style={{ backgroundColor: failed > 0 ? "#3f1f1f" : "#1f3f2a" }}>
          <span style={{ color: failed > 0 ? "#f87171" : "#4ade80" }}>{passed} passed</span>
          {failed > 0 && <span style={{ color: "#f87171" }}>{failed} failed</span>}
          <span className="opacity-50 ml-auto">{duration}ms</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="flex flex-col gap-0.5 px-3 py-1.5 rounded" style={{ backgroundColor: r.passed ? "#1a2a1a" : "#2a1a1a" }}>
            <div className="flex items-center gap-2 text-xs">
              <span>{r.passed ? "✅" : "❌"}</span>
              <span style={{ color: r.passed ? "#86efac" : "#fca5a5" }}>{r.name}</span>
              <span className="opacity-30 ml-auto text-[10px]">{r.duration}ms</span>
            </div>
            {!r.passed && r.error && r.error !== "nil" && (
              <div className="text-[10px] pl-6 font-mono" style={{ color: "#f87171" }}>{r.error}</div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: colors.bg }}>
      {/* Left: file list */}
      <div className="w-64 flex flex-col border-r border-white/5" style={{ backgroundColor: colors.sidebar }}>
        <div className="flex items-center justify-between px-3 h-9 border-b border-white/5">
          <span className="text-[11px] font-bold uppercase tracking-widest opacity-60">🧪 Test Files</span>
          <button onClick={onRefreshFiles} className="text-[10px] px-2 py-0.5 rounded opacity-50 hover:opacity-100" style={{ color: colors.text }}>↻</button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {testFiles.length === 0 ? (
            <div className="px-3 py-4 text-xs opacity-40 text-center">No .clawtest.lua files found</div>
          ) : testFiles.map((fp, i) => (
            <div
              key={i}
              onClick={() => setSelectedTestFile(fp)}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5 border-l-2 transition-all"
              style={{ borderColor: selectedTestFile === fp ? colors.accent : "transparent", backgroundColor: selectedTestFile === fp ? colors.accent + "15" : "transparent" }}
            >
              <span className="text-xs">🧪</span>
              <span className="text-xs truncate" style={{ color: selectedTestFile === fp ? colors.accent : colors.text }}>{shortName(fp)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-white/5 p-2">
          <button
            onClick={() => selectedTestFile && onRunTest(selectedTestFile)}
            disabled={!selectedTestFile || testRunning}
            className="w-full py-2 rounded text-xs font-bold transition-all disabled:opacity-40"
            style={{ backgroundColor: colors.button, color: "#fff" }}
          >
            {testRunning ? "Running..." : "▶ Run Selected"}
          </button>
        </div>
      </div>

      {/* Right: results + ad-hoc */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-white/5 h-9">
          <button onClick={() => setTab("files")} className={`px-4 text-[11px] font-bold uppercase tracking-wider ${tab === "files" ? "border-b-2 opacity-100" : "opacity-40"}`} style={{ borderColor: tab === "files" ? colors.accent : "transparent" }}>Results</button>
          <button onClick={() => setTab("adhoc")} className={`px-4 text-[11px] font-bold uppercase tracking-wider ${tab === "adhoc" ? "border-b-2 opacity-100" : "opacity-40"}`} style={{ borderColor: tab === "adhoc" ? colors.accent : "transparent" }}>Ad-hoc</button>
        </div>

        {tab === "files" && (
          <div className="flex-1 overflow-y-auto p-3">
            {!testResults && !testRunning && (
              <div className="flex flex-col items-center justify-center h-full opacity-30">
                <span className="text-4xl mb-3">🧪</span>
                <span className="text-xs">Select a file and click Run</span>
              </div>
            )}
            {testRunning && (
              <div className="flex items-center justify-center h-full">
                <span className="text-xs opacity-50 animate-pulse">Running tests...</span>
              </div>
            )}
            {testResults && !testRunning && <ResultsView results={testResults} />}
          </div>
        )}

        {tab === "adhoc" && (
          <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold opacity-40 tracking-wider">Inline Test Code</span>
              <textarea
                value={testAdHocCode}
                onChange={(e) => setTestAdHocCode(e.target.value)}
                className="w-full rounded font-mono text-xs p-3 resize-none focus:outline-none border border-white/10"
                style={{ backgroundColor: "#0d0d0f", color: "#f8f8f2", height: 200 }}
                spellCheck={false}
              />
              <button
                onClick={onRunAdHoc}
                disabled={testAdHocRunning || !testAdHocCode.trim()}
                className="self-end px-4 py-1.5 rounded text-xs font-bold transition-all disabled:opacity-40"
                style={{ backgroundColor: colors.button, color: "#fff" }}
              >
                {testAdHocRunning ? "Running..." : "▶ Run Code"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {testAdHocResults && <ResultsView results={testAdHocResults} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Toolbar({ colors, gameState, onPlay, onStop, onPause, onInsertPart, onInsertScript, cameraMode, setCameraMode, gridEnabled, setGridEnabled, physicsEnabled, setPhysicsEnabled, onDeploy, deploying }) {
  return (
    <div className="h-10 border-b border-white/5 flex items-center justify-between px-3" style={{ backgroundColor: colors.bg }}>
      <div className="flex items-center gap-2">
        <button onClick={onPlay} disabled={gameState === "running"} className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors hover:bg-white/10 disabled:opacity-50" style={{ color: "#22c55e" }}><Play size={14} fill="currentColor" />Play</button>
        <button onClick={onStop} disabled={gameState === "stopped"} className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors hover:bg-white/10 disabled:opacity-50" style={{ color: "#ef4444" }}><SquareIcon size={12} fill="currentColor" />Stop</button>
        <button onClick={onPause} className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors hover:bg-white/10" style={{ color: "#fbbf24" }}><Pause size={14} />Pause</button>
        <div className="w-px h-4 bg-white/10" />
        <button onClick={onDeploy} disabled={deploying} className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors hover:bg-white/10 disabled:opacity-50" style={{ color: "#a78bfa" }}><Rocket size={14} />{deploying ? "Deploying..." : "Deploy"}</button>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onInsertPart} className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors hover:bg-white/10" style={{ color: colors.text }}><Box size={14} />Insert Part</button>
        <button onClick={onInsertScript} className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors hover:bg-white/10" style={{ color: colors.text }}><FileCode size={14} />Insert Script</button>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Camera size={14} className="opacity-50" />
          <select value={cameraMode} onChange={(e) => setCameraMode(e.target.value)} className="bg-transparent text-xs rounded px-2 py-1 border border-white/10" style={{ color: colors.text }}>
            <option value="orbit">Orbit</option>
            <option value="fly">Fly</option>
            <option value="top">Top</option>
          </select>
        </div>
        <button onClick={() => setGridEnabled(v => !v)} className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${gridEnabled ? 'bg-white/10' : ''}`} style={{ color: gridEnabled ? colors.accent : colors.text }}><Grid3X3 size={14} />Grid</button>
        <button onClick={() => setPhysicsEnabled(v => !v)} className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${physicsEnabled ? 'bg-white/10' : ''}`} style={{ color: physicsEnabled ? colors.accent : colors.text }}><Gauge size={14} />Physics</button>
      </div>
    </div>
  );
}

function StatusBar({ colors, gameState, filename, cursorPosition }) {
  return (
    <div className="h-6 border-t border-white/5 flex items-center px-3 text-[11px] justify-between select-none" style={{ backgroundColor: colors.sidebar, color: colors.text }}>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1"><div className={`w-2 h-2 rounded-full ${gameState === "running" ? "bg-green-500" : "bg-red-500"}`}></div>{gameState === "running" ? "● Running" : "■ Stopped"}</span>
      </div>
      <div className="opacity-70">{filename}</div>
      <div className="opacity-70">Ln {cursorPosition.line}, Col {cursorPosition.column}</div>
    </div>
  );
}

function TitleBar({ colors, settings, gameState, onAttach }) {
  return (
    <div className="h-8 flex items-center justify-between select-none border-b border-white/5 pl-2" style={{ backgroundColor: colors.bg, WebkitAppRegion: "drag" }}>
      <div className="flex items-center gap-3">
        <button onClick={onAttach} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ WebkitAppRegion: "no-drag", color: gameState === "running" ? "#22c55e" : "#ef4444" }}>{gameState === "running" ? <Link size={14} /> : <Unlink size={14} />}</button>
        <div className="text-[11px] font-medium tracking-wide">ClawBlox Studio {gameState === "running" ? "[Running]" : ""}</div>
      </div>
      <div className="flex h-full" style={{ WebkitAppRegion: "no-drag" }}>
        <WindowButton icon={<Minus size={14} />} onClick={() => window.api?.minimize()} colors={colors} />
        <WindowButton icon={<Square size={10} />} onClick={() => window.api?.maximize()} colors={colors} />
        <WindowButton icon={<X size={14} />} onClick={() => window.api?.close()} colors={colors} />
      </div>
    </div>
  );
}

function OutputPanel({ outputLines, onClear, cmdInput, setCmdInput, onRun, cmdRunning, colors, outputEndRef, deployHistory }) {
  const [outputTab, setOutputTab] = React.useState("output"); // "output" | "deploys"
  const getLineColor = (type) => { if (type === "warn") return "#fbbf24"; if (type === "error") return "#f87171"; if (type === "info") return "#60a5fa"; return "#f8f8f2"; };
  return (
    <div className="flex flex-col border-t border-white/10 z-40" style={{ backgroundColor: colors.bg + 'f0', height: 220 }}>
      <div className="flex items-center justify-between px-3 h-8 border-b border-white/5" style={{ backgroundColor: colors.sidebar + '80' }}>
        <div className="flex items-center gap-1">
          <button onClick={() => setOutputTab("output")} className={`text-[10px] font-bold px-2 py-0.5 rounded transition-colors ${outputTab === "output" ? "opacity-100" : "opacity-40"}`} style={{ color: outputTab === "output" ? colors.accent : colors.text }}>Output</button>
          <button onClick={() => setOutputTab("deploys")} className={`text-[10px] font-bold px-2 py-0.5 rounded transition-colors ${outputTab === "deploys" ? "opacity-100" : "opacity-40"}`} style={{ color: outputTab === "deploys" ? "#a78bfa" : colors.text }}>🚀 Deploys {deployHistory?.length > 0 ? `(${deployHistory.length})` : ""}</button>
        </div>
        <button onClick={onClear} className="text-[10px] font-semibold px-2 py-0.5 rounded opacity-50 hover:opacity-100">Clear</button>
      </div>
      {outputTab === "output" ? (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px]" style={{ color: "#f8f8f2" }}>{outputLines.map((l, i) => <div key={i} className="mb-0.5 flex gap-2"><span className="opacity-30">[{l.timestamp}]</span><span style={{ color: getLineColor(l.type) }}>{l.text}</span></div>)}<div ref={outputEndRef} /></div>
          <div className="flex items-center gap-2 px-3 py-2 border-t border-white/5" style={{ backgroundColor: colors.sidebar + '60' }}><span className="text-[11px] font-mono opacity-40">&gt;</span><input type="text" value={cmdInput} onChange={(e) => setCmdInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !cmdRunning) { onRun(cmdInput); setCmdInput(""); } }} placeholder="Run Lua..." className="flex-1 bg-transparent text-[11px] font-mono focus:outline-none" style={{ color: colors.text }} /><button onClick={() => { onRun(cmdInput); setCmdInput(""); }} disabled={cmdRunning || !cmdInput.trim()} className="text-[10px] font-bold px-3 py-1 rounded" style={{ backgroundColor: colors.button, color: "#fff" }}>Run</button></div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px]">
          {!deployHistory || deployHistory.length === 0 ? (
            <div className="opacity-40 text-center py-4">No deploys yet. Click 🚀 Deploy in the toolbar.</div>
          ) : deployHistory.map((d, i) => (
            <div key={i} className="mb-1 flex flex-col gap-0.5 border-b border-white/5 pb-1">
              <div className="flex items-center gap-2">
                <span>{d.success || d.pushedToRoblox ? "✅" : "⚠️"}</span>
                <span className="opacity-50">{new Date(d.timestamp).toLocaleString()}</span>
                <span style={{ color: "#a78bfa" }}>{d.deployId}</span>
              </div>
              <div className="pl-4 opacity-70">Scripts: {d.scriptsDeployed || 0} | Roblox: {d.pushedToRoblox ? "✅ Pushed" : "❌ Local only"}</div>
              {d.errors && d.errors.length > 0 && <div className="pl-4 text-red-400 text-[10px] truncate">{d.errors[0]}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WindowButton({ icon, onClick, colors }) { return <button onClick={onClick} className="w-10 h-full flex items-center justify-center transition-colors hover:bg-white/10" style={{ color: colors.text }}>{icon}</button>; }
function ActivityIcon({ icon: Icon, id, active, onClick, colors }) { return <div onClick={() => onClick(id)} className={`p-2 rounded-lg cursor-pointer transition-all`} style={{ color: active === id ? "#fff" : colors.text, backgroundColor: active === id ? colors.button : "transparent", opacity: active === id ? 1 : 0.6 }}><Icon size={20} strokeWidth={1.5} /></div>; }
function FolderItem({ name, isOpen, children, onClick, indent = 0, isRoot, colors }) { return <div><div onClick={onClick} className={`flex items-center gap-2 py-1 cursor-pointer hover:bg-white/5 select-none`} style={{ paddingLeft: indent * 12 + 8, color: colors.text }}><ChevronRight size={14} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} /><span className={`text-[13px] ${isRoot ? "font-bold" : ""}`}>{name}</span></div>{isOpen && children}</div>; }
function FileItem({ file, indent, active, onClick, isRenaming, onRename, setRenamingId, colors }) { return <div onClick={onClick} className={`flex items-center gap-2 py-1 cursor-pointer select-none transition-all border-l-2 ${active ? 'border-blue-500 bg-blue-500/10' : 'border-transparent'}`} style={{ paddingLeft: indent * 12 + 10, color: active ? '#fff' : colors.text }}><span className="text-xs">{file.name.endsWith('lua') ? '📝' : '📄'}</span><span className="text-[13px] truncate">{file.name}</span></div>; }
function Tab({ file, active, onClick, onClose, colors, settings }) { return <div onClick={onClick} className={`px-4 min-w-[120px] max-w-[200px] h-full flex items-center gap-2 text-xs cursor-pointer border-r border-white/5 flex-shrink-0 group ${active ? 'border-t-2' : ''}`} style={{ backgroundColor: active ? colors.bg : colors.sidebar, borderTopColor: active ? colors.accent : 'transparent', color: colors.text }}><span style={{ color: active ? colors.accent : colors.text, opacity: 0.7 }}>{file.name.endsWith('lua') ? 'Lua' : 'File'}</span><span className="truncate flex-1">{file.name}</span><div onClick={onClose} className={`p-0.5 rounded hover:bg-white/20 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}><X size={12} /></div></div>; }
function TooltipButton({ icon, onClick, title, colors }) { return <button onClick={onClick} title={title} className="p-2 rounded-full transition-all hover:bg-white/10" style={{ color: colors.text }}>{icon}</button>; }
