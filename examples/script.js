document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const filesApp = document.getElementById('files-app');
  const settingsApp = document.getElementById('settings-app');
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnMenu = document.getElementById('btn-menu');
  const sidebar = document.getElementById('sidebar');
  const pathInput = document.getElementById('path-input');
  const fileList = document.getElementById('file-list');
  const statusText = document.getElementById('status-text');
  
  // State
  let currentPath = 'REGISTRY:/';
  let items = [];
  let selectedItems = new Set();
  
  // --- View Switching ---
  
  btnOpenSettings.addEventListener('click', () => {
    filesApp.classList.add('hidden');
    settingsApp.classList.remove('hidden');
  });
  
  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => {
      settingsApp.classList.add('hidden');
      filesApp.classList.remove('hidden');
    });
  }

  // --- Sidebar & Navigation ---
  
  if (btnMenu) {
    btnMenu.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.addEventListener('click', (e) => {
      document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const dest = e.currentTarget.getAttribute('data-path');
      navigate(dest);
      sidebar.classList.remove('open');
    });
  });

  document.getElementById('btn-up').addEventListener('click', () => {
    if (currentPath === 'REGISTRY:/' || currentPath === 'C:/') return;
    let parts = currentPath.split('/');
    if (parts[parts.length - 1] === '') parts.pop();
    parts.pop();
    let newPath = parts.join('/');
    if (newPath === 'REGISTRY:') newPath = 'REGISTRY:/';
    if (newPath === 'C:') newPath = 'C:/';
    navigate(newPath);
  });

  document.getElementById('btn-refresh').addEventListener('click', () => {
    navigate(currentPath);
  });

  pathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      navigate(pathInput.value);
      pathInput.blur();
    }
  });

  // --- Toggles ---
  
  document.querySelectorAll('.toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('active');
    });
  });

  // --- Data Fetching & Rendering ---

  function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    if (isNaN(bytes)) return '--';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function renderList() {
    fileList.innerHTML = '';
    
    // Sort directories first
    const sorted = [...items].sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach(item => {
      const el = document.createElement('div');
      const isSelected = selectedItems.has(item.name);
      el.className = `file-item ${isSelected ? 'selected' : ''}`;
      
      const icon = item.type === 'directory' ? '📁' : '📄';
      const typeLabel = item.type === 'directory' ? 'File folder' : 'File';
      const dateStr = item.date ? new Date(item.date).toLocaleString() : '';
      const sizeStr = item.type === 'directory' ? '' : formatSize(item.size);

      el.innerHTML = `
        <span class="file-icon">${icon}</span>
        <span class="col-name">${item.name}</span>
        <span class="col-date desktop-only">${dateStr}</span>
        <span class="col-type desktop-only">${typeLabel}</span>
        <span class="col-size">${sizeStr}</span>
      `;
      
      el.addEventListener('click', (e) => {
        if (!e.ctrlKey && !e.metaKey) selectedItems.clear();
        if (selectedItems.has(item.name)) {
          selectedItems.delete(item.name);
        } else {
          selectedItems.add(item.name);
        }
        renderList();
        updateStatus();
      });

      el.addEventListener('dblclick', () => {
        if (item.type === 'directory') {
          navigate(item.path);
        } else {
          alert('Cannot open file directly in vanilla export mode: ' + item.name);
        }
      });

      fileList.appendChild(el);
    });
    
    updateStatus();
  }

  function updateStatus() {
    let txt = `${items.length} item${items.length !== 1 ? 's' : ''}`;
    if (selectedItems.size > 0) {
      txt += ` | ${selectedItems.size} item${selectedItems.size !== 1 ? 's' : ''} selected`;
    }
    statusText.innerText = txt;
  }

  document.getElementById('btn-select-all').addEventListener('click', () => {
    if (selectedItems.size === items.length && items.length > 0) {
      selectedItems.clear();
    } else {
      items.forEach(i => selectedItems.add(i.name));
    }
    renderList();
  });

  async function navigate(path) {
    currentPath = path;
    pathInput.value = path;
    selectedItems.clear();
    fileList.innerHTML = '<div style="padding:16px;">Loading...</div>';
    
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error('API fetch failed');
      const data = await res.json();
      items = data.items || [];
    } catch (e) {
      console.warn('API not available. Using mock data for export mode.');
      // Mock data for vanilla export
      items = [
        { name: 'System', type: 'directory', path: path + '/System', size: 0, date: Date.now() },
        { name: 'config.ini', type: 'file', path: path + '/config.ini', size: 1024, date: Date.now() },
        { name: 'readme.txt', type: 'file', path: path + '/readme.txt', size: 4096, date: Date.now() }
      ];
    }
    renderList();
  }

  // --- Modifying ---

  document.getElementById('btn-new').addEventListener('click', async () => {
    const name = prompt('Enter new file name:');
    if (!name) return;
    
    const fullPath = currentPath.endsWith('/') ? currentPath + name : currentPath + '/' + name;
    try {
      const res = await fetch('/api/fs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fullPath, type: 'file' })
      });
      if (res.ok) {
        navigate(currentPath);
      } else {
        throw new Error('API Failed');
      }
    } catch (e) {
      alert('File creation requires backend API. Added mock file locally.');
      items.push({ name, type: 'file', path: fullPath, size: 0, date: Date.now() });
      renderList();
    }
  });

  // Init
  navigate(currentPath);
});
