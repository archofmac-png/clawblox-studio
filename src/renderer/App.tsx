import { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { api, Project } from './api';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

function buildFileTree(files: string[]): FileNode[] {
  const root: FileNode[] = [];
  
  for (const file of files) {
    const parts = file.replace(/\\/g, '/').split('/');
    let current = root;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');
      
      let node = current.find(n => n.name === part);
      
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          isDirectory: !isLast,
          children: isLast ? undefined : []
        };
        current.push(node);
      }
      
      if (!isLast && node.children) {
        current = node.children;
      }
    }
  }
  
  return root;
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [code, setCode] = useState<string>('-- Select a file to edit\n');
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src']));
  
  // New state for v1 features
  const [fileFilter, setFileFilter] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string>('');

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  // Load files when project changes
  useEffect(() => {
    if (selectedProject) {
      loadFiles(selectedProject.id);
    }
  }, [selectedProject]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S to save
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (selectedFile && isModified) {
          saveFile();
        }
      }
      // Ctrl+N for new file
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        if (selectedProject) {
          setShowNewFile(true);
        }
      }
      // Escape to close modals
      if (e.key === 'Escape') {
        setShowNewProject(false);
        setShowNewFile(false);
        setShowDeleteConfirm(false);
        setError(null);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFile, isModified, selectedProject]);

  // Unsaved changes warning on close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isModified) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isModified]);

  // Filter file tree
  const filterFileTree = useCallback((nodes: FileNode[], filter: string): FileNode[] => {
    if (!filter.trim()) return nodes;
    
    const lowerFilter = filter.toLowerCase();
    
    const filterNodes = (items: FileNode[]): FileNode[] => {
      return items.reduce<FileNode[]>((acc, node) => {
        if (node.isDirectory) {
          const filteredChildren = filterNodes(node.children || []);
          if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lowerFilter)) {
            acc.push({ ...node, children: filteredChildren });
          }
        } else if (node.name.toLowerCase().includes(lowerFilter)) {
          acc.push(node);
        }
        return acc;
      }, []);
    };
    
    return filterNodes(nodes);
  }, []);

  const loadProjects = async () => {
    try {
      setIsLoading(true);
      setLoadingMessage('Loading projects...');
      const projectList = await api.getProjects();
      setProjects(projectList);
      if (projectList.length > 0 && !selectedProject) {
        setSelectedProject(projectList[0]);
      }
    } catch {
      setError('Unable to load projects. Please ensure the API server is running.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const loadFiles = async (projectId: string) => {
    try {
      setIsLoading(true);
      setLoadingMessage('Loading files...');
      const fileList = await api.getProjectFiles(projectId);
      setFileTree(buildFileTree(fileList));
    } catch {
      setError('Unable to load files. Please try again.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const loadFile = async (filePath: string) => {
    // Check for unsaved changes
    if (isModified && selectedFile) {
      const proceed = confirm('You have unsaved changes. Do you want to discard them?');
      if (!proceed) return;
    }
    
    if (!selectedProject) return;
    try {
      setIsLoading(true);
      setLoadingMessage('Loading file...');
      const fileData = await api.getFile(selectedProject.id, filePath);
      setCode(fileData.content || '');
      setSelectedFile(filePath);
      setIsModified(false);
    } catch {
      setError('Unable to load file. Please try again.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const saveFile = async () => {
    if (!selectedProject || !selectedFile) return;
    try {
      setIsLoading(true);
      setLoadingMessage('Saving file...');
      await api.saveFile(selectedProject.id, selectedFile, code);
      setIsModified(false);
      setError(null); // Clear any previous errors on successful save
    } catch {
      setError('Failed to save file. Please try again.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const handleCodeChange = (value: string | undefined) => {
    setCode(value || '');
    setIsModified(true);
  };

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      setIsLoading(true);
      setLoadingMessage('Creating project...');
      const project = await api.createProject(newProjectName.trim());
      setProjects([...projects, project]);
      setSelectedProject(project);
      setNewProjectName('');
      setShowNewProject(false);
    } catch {
      setError('Failed to create project. Please try again.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const createFile = async () => {
    if (!selectedProject || !newFileName.trim()) return;
    try {
      setIsLoading(true);
      setLoadingMessage('Creating file...');
      const filePath = `src/ServerScriptService/${newFileName.trim()}.lua`;
      await api.saveFile(selectedProject.id, filePath, `-- ${newFileName}.lua\n-- Created with ClawBlox Studio\n\n`);
      await loadFiles(selectedProject.id);
      await loadFile(filePath);
      setNewFileName('');
      setShowNewFile(false);
    } catch {
      setError('Failed to create file. Please try again.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const confirmDeleteFile = (filePath: string) => {
    setPendingDeletePath(filePath);
    setShowDeleteConfirm(true);
  };

  const deleteFile = async () => {
    if (!selectedProject || !pendingDeletePath) return;
    try {
      setIsLoading(true);
      setLoadingMessage('Deleting file...');
      await api.deleteFile(selectedProject.id, pendingDeletePath);
      if (selectedFile === pendingDeletePath) {
        setSelectedFile(null);
        setCode('-- Select a file to edit\n');
        setIsModified(false);
      }
      await loadFiles(selectedProject.id);
    } catch {
      setError('Failed to delete file. Please try again.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
      setShowDeleteConfirm(false);
      setPendingDeletePath(null);
    }
  };

  const toggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };

  const closeTab = () => {
    if (isModified) {
      const proceed = confirm('You have unsaved changes. Do you want to close without saving?');
      if (!proceed) return;
    }
    setSelectedFile(null);
    setCode('-- Select a file to edit\n');
    setIsModified(false);
  };

  const renderFileTree = (nodes: FileNode[], depth = 0) => {
    const filteredNodes = filterFileTree(nodes, fileFilter);
    
    return filteredNodes.map((node) => {
      const isExpanded = expandedFolders.has(node.path);
      const paddingLeft = 12 + depth * 16;

      if (node.isDirectory) {
        return (
          <div key={node.path}>
            <div
              className="folder"
              style={{ paddingLeft }}
              onClick={() => toggleFolder(node.path)}
            >
              <span className="folder-icon">{isExpanded ? '📂' : '📁'}</span>
              {node.name}
            </div>
            {isExpanded && node.children && (
              <div>{renderFileTree(node.children, depth + 1)}</div>
            )}
          </div>
        );
      }

      return (
        <div
          key={node.path}
          className={`file ${selectedFile === node.path ? 'selected' : ''}`}
          style={{ paddingLeft }}
          onClick={() => loadFile(node.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            confirmDeleteFile(node.path);
          }}
        >
          <span className="file-icon">📄</span>
          {node.name}
        </div>
      );
    });
  };

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className="logo-icon">🦀</span>
          <span className="logo-text">ClawBlox Studio</span>
        </div>
        
        <div className="project-selector">
          <select
            value={selectedProject?.id || ''}
            onChange={(e) => {
              const proj = projects.find(p => p.id === e.target.value);
              setSelectedProject(proj || null);
              setSelectedFile(null);
              setCode('-- Select a file to edit\n');
            }}
          >
            <option value="">Select Project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button onClick={() => setShowNewProject(true)} title="New Project">+</button>
        </div>

        <div className="menu">
          <button className="menu-btn" onClick={saveFile} disabled={!selectedFile || !isModified}>Save</button>
          <button className="menu-btn" onClick={() => setShowNewFile(true)} disabled={!selectedProject}>New File</button>
        </div>
      </header>

      {showNewProject && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>New Project</h3>
            <input
              type="text"
              placeholder="Project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              autoFocus
            />
            <div className="modal-buttons">
              <button onClick={createProject}>Create</button>
              <button onClick={() => { setShowNewProject(false); setNewProjectName(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showNewFile && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>New Lua File</h3>
            <input
              type="text"
              placeholder="File name (without .lua)"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createFile()}
              autoFocus
            />
            <p className="modal-hint">Will be created in src/ServerScriptService/</p>
            <div className="modal-buttons">
              <button onClick={createFile}>Create</button>
              <button onClick={() => { setShowNewFile(false); setNewFileName(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      
      <div className="main-content">
        <aside className="sidebar">
          <div className="sidebar-header">
            Explorer
            {selectedProject && (
              <span className="project-name">{selectedProject.name}</span>
            )}
          </div>
          {selectedProject && (
            <div className="file-filter">
              <input
                type="text"
                placeholder="Search files..."
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
              />
            </div>
          )}
          <div className="file-tree">
            {fileTree.length > 0 ? renderFileTree(fileTree) : (
              <div className="empty-tree">
                {selectedProject ? 'No files yet' : 'Select a project'}
              </div>
            )}
          </div>
        </aside>
        
        <div className="editor-area">
          <div className="tab-bar">
            {selectedFile ? (
              <div className="tab active">
                <span className="tab-icon">📄</span>
                {selectedFile.split('/').pop()}
                {isModified && <span className="modified-indicator">•</span>}
                <button className="tab-close" onClick={closeTab} title="Close tab">×</button>
              </div>
            ) : (
              <div className="tab">No file selected</div>
            )}
          </div>
          <div className="editor-container">
            <Editor
              height="100%"
              defaultLanguage="lua"
              value={code}
              onChange={handleCodeChange}
              theme="vs-dark"
              options={{
                minimap: { enabled: true },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                readOnly: false
              }}
            />
          </div>
        </div>
      </div>
      
      <footer className="footer">
        <span>{isLoading ? loadingMessage || 'Loading...' : 'Ready'}</span>
        <span>{selectedProject?.name || 'No project'}</span>
        <span>{selectedFile || 'No file'}</span>
        <span>Luau</span>
        <span>{isModified ? 'Modified' : 'Saved'}</span>
      </footer>

      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Confirm Delete</h3>
            <p>Are you sure you want to delete <strong>{pendingDeletePath}</strong>?</p>
            <p className="modal-warning">This action cannot be undone.</p>
            <div className="modal-buttons">
              <button className="danger-btn" onClick={deleteFile}>Delete</button>
              <button onClick={() => { setShowDeleteConfirm(false); setPendingDeletePath(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}

export default App;
