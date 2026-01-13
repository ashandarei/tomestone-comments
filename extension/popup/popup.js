// Tomestone Comments - Popup Script

const STORAGE_KEYS = {
  USERNAME: 'tomestone_comments_username',
  API_URL: 'tomestone_comments_api_url'
};

const DEFAULT_API_URL = 'https://tomestone-comments-production.up.railway.app';

// DOM elements
const userInfoEl = document.getElementById('user-info');
const apiUrlInput = document.getElementById('api-url');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');

// Load saved settings
async function loadSettings() {
  try {
    const result = await browser.storage.local.get([
      STORAGE_KEYS.USERNAME,
      STORAGE_KEYS.API_URL
    ]);

    // Display username status
    const username = result[STORAGE_KEYS.USERNAME];
    if (username) {
      userInfoEl.innerHTML = `
        <span class="user-logged-in">✓ Posting as: <strong>${escapeHtml(username)}</strong></span>
      `;
    } else {
      userInfoEl.innerHTML = `
        <span class="user-not-logged-in">⚠ Not detected yet</span>
        <p class="user-hint">Visit tomestone.gg while logged in and click your profile avatar to detect your username.</p>
      `;
    }

    apiUrlInput.value = result[STORAGE_KEYS.API_URL] || DEFAULT_API_URL;
  } catch (e) {
    console.error('Failed to load settings:', e);
    userInfoEl.innerHTML = '<span class="user-error">Failed to load</span>';
  }
}

// Save settings
async function saveSettings() {
  const apiUrl = apiUrlInput.value.trim() || DEFAULT_API_URL;

  // Validate API URL
  try {
    new URL(apiUrl);
  } catch (e) {
    showStatus('Please enter a valid URL', 'error');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await browser.storage.local.set({
      [STORAGE_KEYS.API_URL]: apiUrl
    });

    showStatus('Settings saved!', 'success');

    // Test connection to API
    testApiConnection(apiUrl);
  } catch (e) {
    console.error('Failed to save settings:', e);
    showStatus('Failed to save settings', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Settings';
  }
}

// Test API connection
async function testApiConnection(apiUrl) {
  try {
    const response = await fetch(`${apiUrl}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      showStatus('Settings saved! API connection successful.', 'success');
    } else {
      showStatus('Settings saved, but API returned an error.', 'error');
    }
  } catch (e) {
    showStatus('Settings saved. Could not connect to API server.', 'error');
  }
}

// Show status message
function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;

  // Auto-hide after 5 seconds
  setTimeout(() => {
    statusEl.className = 'status';
  }, 5000);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event listeners
saveBtn.addEventListener('click', saveSettings);

apiUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') saveSettings();
});

// Initialize
loadSettings();
