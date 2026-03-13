const API_BASE = 'http://localhost:3001/api';

export interface Project {
  id: string;
  name: string;
  created: string;
  modified?: string;
}

export interface FileItem {
  path: string;
  content?: string;
}

export const api = {
  // Health check
  async health() {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },

  // Projects
  async getProjects(): Promise<Project[]> {
    const res = await fetch(`${API_BASE}/projects`);
    return res.json();
  },

  async createProject(name: string): Promise<Project> {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    return res.json();
  },

  async getProject(id: string): Promise<Project> {
    const res = await fetch(`${API_BASE}/projects/${id}`);
    return res.json();
  },

  async deleteProject(id: string): Promise<void> {
    await fetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
  },

  // Files
  async getProjectFiles(projectId: string): Promise<string[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/files`);
    return res.json();
  },

  async getFile(projectId: string, filePath: string): Promise<FileItem> {
    const res = await fetch(`${API_BASE}/files/${projectId}?path=${encodeURIComponent(filePath)}`);
    return res.json();
  },

  async saveFile(projectId: string, filePath: string, content: string): Promise<void> {
    await fetch(`${API_BASE}/files/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content })
    });
  },

  async deleteFile(projectId: string, filePath: string): Promise<void> {
    await fetch(`${API_BASE}/projects/${projectId}/files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath })
    });
  }
};
