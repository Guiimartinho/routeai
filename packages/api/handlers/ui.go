package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// simpleHTML is a self-contained HTML page for quick testing without a full
// frontend build.  Mirrors the Python /simple endpoint.
const simpleHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RouteAI — Simple UI</title>
<style>
  :root { --bg: #0f172a; --surface: #1e293b; --border: #334155; --text: #e2e8f0; --accent: #38bdf8; --accent2: #818cf8; --danger: #f87171; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .container { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 1.6rem; font-weight: 700; margin-bottom: 8px; }
  h1 span { color: var(--accent); }
  .subtitle { color: #94a3b8; font-size: 0.85rem; margin-bottom: 24px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .card h2 { font-size: 1.1rem; margin-bottom: 12px; color: var(--accent); }
  label { display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 4px; }
  input[type="text"], input[type="file"], textarea, select {
    width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--bg); color: var(--text); font-size: 0.9rem; margin-bottom: 10px;
  }
  textarea { resize: vertical; min-height: 70px; font-family: inherit; }
  button {
    padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer;
    font-weight: 600; font-size: 0.85rem; transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
  .btn-primary { background: var(--accent); color: var(--bg); }
  .btn-secondary { background: var(--accent2); color: #fff; }
  .btn-danger { background: var(--danger); color: #fff; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  #status { padding: 8px 12px; border-radius: 8px; background: var(--bg); margin-top: 12px; font-size: 0.85rem; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
  #project-list { list-style: none; padding: 0; }
  #project-list li { padding: 8px 0; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; }
  #board-viewer { width: 100%; height: 300px; border-radius: 8px; background: #000; display: flex; align-items: center; justify-content: center; color: #475569; font-size: 0.95rem; }
  #chat-messages { max-height: 200px; overflow-y: auto; margin-bottom: 10px; font-size: 0.85rem; }
  .msg { padding: 6px 10px; border-radius: 6px; margin-bottom: 4px; }
  .msg.user { background: #1e3a5f; text-align: right; }
  .msg.ai { background: #1a2744; }
</style>
</head>
<body>
<div class="container">
  <h1><span>RouteAI</span> Simple UI</h1>
  <p class="subtitle">Quick testing interface &bull; Go API Gateway &bull; <a href="/health" style="color:var(--accent);">/health</a></p>

  <div class="grid">
    <!-- Upload -->
    <div class="card">
      <h2>Upload KiCad File</h2>
      <form id="upload-form">
        <label for="project-name">Project Name</label>
        <input type="text" id="project-name" placeholder="my-board-v2">
        <label for="file-input">KiCad Board (.kicad_pcb)</label>
        <input type="file" id="file-input" accept=".kicad_pcb,.kicad_sch">
        <button type="submit" class="btn-primary">Upload &amp; Parse</button>
      </form>
      <div id="status"></div>
    </div>

    <!-- Projects -->
    <div class="card">
      <h2>Projects</h2>
      <button class="btn-secondary" onclick="loadProjects()">Refresh</button>
      <ul id="project-list"><li style="color:#64748b;">Click Refresh to load</li></ul>
    </div>
  </div>

  <!-- Board Viewer -->
  <div class="card">
    <h2>Board Viewer</h2>
    <div id="board-viewer">Select a project to view board data</div>
  </div>

  <!-- AI Chat -->
  <div class="card">
    <h2>AI Design Chat</h2>
    <div id="chat-messages"></div>
    <div style="display:flex;gap:8px;">
      <textarea id="chat-input" placeholder="Ask about your PCB design..." style="flex:1;min-height:40px;"></textarea>
      <button class="btn-primary" onclick="sendChat()" style="align-self:flex-end;">Send</button>
    </div>
  </div>
</div>

<script>
const API = '/api/v1';
let token = '';

async function api(method, path, body) {
  const opts = { method, headers: {'Content-Type':'application/json'} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  return res.json();
}

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('project-name').value || 'untitled';
  const file = document.getElementById('file-input').files[0];
  const status = document.getElementById('status');
  if (!file) { status.textContent = 'Please select a file.'; return; }
  status.textContent = 'Uploading...';
  try {
    const proj = await api('POST', '/projects', {name: name, description: 'Uploaded via Simple UI'});
    status.textContent = 'Project created: ' + JSON.stringify(proj, null, 2);
  } catch(err) {
    status.textContent = 'Error: ' + err.message;
  }
});

async function loadProjects() {
  const list = document.getElementById('project-list');
  list.innerHTML = '<li style="color:#64748b;">Loading...</li>';
  try {
    const data = await api('GET', '/projects');
    const projects = data.projects || data || [];
    if (!projects.length) { list.innerHTML = '<li style="color:#64748b;">No projects</li>'; return; }
    list.innerHTML = projects.map(p =>
      '<li>' + (p.name||p.id) + ' <button class="btn-danger" style="padding:4px 10px;font-size:0.75rem;" onclick="deleteProject(\''+p.id+'\')">Delete</button></li>'
    ).join('');
  } catch(err) {
    list.innerHTML = '<li style="color:var(--danger);">Error: ' + err.message + '</li>';
  }
}

async function deleteProject(id) {
  if (!confirm('Delete project ' + id + '?')) return;
  await api('DELETE', '/projects/' + id);
  loadProjects();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  const container = document.getElementById('chat-messages');
  container.innerHTML += '<div class="msg user">' + msg + '</div>';
  input.value = '';
  container.innerHTML += '<div class="msg ai">Thinking...</div>';
  container.scrollTop = container.scrollHeight;
  try {
    const res = await api('POST', '/projects/default/chat', {message: msg});
    const last = container.querySelector('.msg.ai:last-child');
    last.textContent = res.response || JSON.stringify(res);
  } catch(err) {
    const last = container.querySelector('.msg.ai:last-child');
    last.textContent = 'Error: ' + err.message;
  }
}
</script>
</body>
</html>`

// ServeSimpleUI returns a self-contained HTML page for quick testing.
func ServeSimpleUI(c *gin.Context) {
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(simpleHTML))
}

// SetupStaticRoutes configures the Gin router to serve the React frontend
// build (from distPath) if it exists, and registers the /simple fallback UI.
//
// Static routes:
//
//	GET /          → index.html (from dist) or JSON fallback
//	GET /assets/*  → static assets from dist/assets/
//	GET /simple    → built-in simple HTML page
//
// Any path that doesn't match an API route or static file is redirected to
// index.html so that the React SPA router can handle it.
func SetupStaticRoutes(router *gin.Engine, distPath string) {
	indexPath := filepath.Join(distPath, "index.html")
	distExists := false

	if _, err := os.Stat(indexPath); err == nil {
		distExists = true
	}

	// Always register the simple UI (no auth).
	router.GET("/simple", ServeSimpleUI)

	if distExists {
		// Serve the React build.
		router.StaticFile("/", indexPath)
		router.StaticFile("/index.html", indexPath)
		router.Static("/assets", filepath.Join(distPath, "assets"))

		// SPA catch-all: any path that is not an API call, health, or known
		// static route is served index.html so React Router can handle it.
		router.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path

			// Don't intercept API calls or WebSocket upgrades.
			if strings.HasPrefix(path, "/api/") ||
				strings.HasPrefix(path, "/health") ||
				strings.HasPrefix(path, "/simple") {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}

			c.File(indexPath)
		})
	} else {
		// No dist build — serve a JSON message at root.
		router.GET("/", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"service": "RouteAI API Gateway",
				"status":  "running",
				"ui":      "React build not found. Visit /simple for a quick testing UI.",
				"docs":    "/api/v1",
			})
		})
	}
}
