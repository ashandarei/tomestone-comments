// Tomestone Comments - Popup Script

const STORAGE_KEYS = {
  NICKNAME: 'tomestone_comments_nickname',
  API_URL: 'tomestone_comments_api_url'
};

const DEFAULT_API_URL = 'https://tomestone-comments-production.up.railway.app';

// DOM elements
const nicknameInput = document.getElementById('nickname');
const apiUrlInput = document.getElementById('api-url');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');

// Load saved settings
async function loadSettings() {
  try {
    const result = await browser.storage.local.get([
      STORAGE_KEYS.NICKNAME,
      STORAGE_KEYS.API_URL
    ]);

    nicknameInput.value = result[STORAGE_KEYS.NICKNAME] || '';
    apiUrlInput.value = result[STORAGE_KEYS.API_URL] || DEFAULT_API_URL;
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

// Save settings
async function saveSettings() {
  const nickname = nicknameInput.value.trim();
  const apiUrl = apiUrlInput.value.trim() || DEFAULT_API_URL;

  // Validate nickname
  if (nickname && nickname.length > 50) {
    showStatus('Nickname must be 50 characters or less', 'error');
    return;
  }

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
      [STORAGE_KEYS.NICKNAME]: nickname,
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

// Event listeners
saveBtn.addEventListener('click', saveSettings);

// Save on Enter key
nicknameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') saveSettings();
});

apiUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') saveSettings();
});

// Initialize
loadSettings();
