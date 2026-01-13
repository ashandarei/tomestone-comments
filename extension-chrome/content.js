// Tomestone Comments - Content Script (Chrome)
// Injects a comments section into tomestone.gg character profile pages

(function() {
  'use strict';

  // Configuration
  const STORAGE_KEYS = {
    USERNAME: 'tomestone_comments_username',
    API_URL: 'tomestone_comments_api_url'
  };
  const DEFAULT_API_URL = 'https://tomestone-comments-production.up.railway.app';

  // State
  let currentCharacterId = null;
  let currentUsername = null;
  let apiBaseUrl = DEFAULT_API_URL;
  let commentsVisible = false;
  let commentsContainer = null;
  let commentsTab = null;
  let originalContentContainer = null;
  let lastActiveTab = null;
  let usernameObserver = null;

  // Extract character ID from URL
  function getCharacterIdFromUrl() {
    const match = window.location.pathname.match(/\/character\/(\d+)/);
    return match ? match[1] : null;
  }

  // Load settings from storage
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.USERNAME,
        STORAGE_KEYS.API_URL
      ]);
      currentUsername = result[STORAGE_KEYS.USERNAME] || null;
      apiBaseUrl = result[STORAGE_KEYS.API_URL] || DEFAULT_API_URL;
    } catch (e) {
      console.error('Failed to load settings:', e);
      currentUsername = null;
      apiBaseUrl = DEFAULT_API_URL;
    }
  }

  // Save username to storage
  async function saveUsername(username) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.USERNAME]: username });
      currentUsername = username;
      // Update the UI if comments are visible
      updateUsernameDisplay();
    } catch (e) {
      console.error('Failed to save username:', e);
    }
  }

  // Check if user is logged in (avatar button exists)
  function isUserLoggedIn() {
    // Look for the user menu button with avatar
    const avatarButton = document.querySelector('button[aria-haspopup="menu"] img[alt="avatar"]');
    return !!avatarButton;
  }

  // Extract username from the HeadlessUI dropdown menu
  function extractUsernameFromMenu() {
    // Look for menu items that link to a character profile
    const menuItems = document.querySelectorAll('a[role="menuitem"][href^="/character/"]');
    
    for (const menuItem of menuItems) {
      // Find the username in the .font-medium div
      const usernameEl = menuItem.querySelector('.font-medium');
      if (usernameEl) {
        const username = usernameEl.textContent.trim();
        if (username) {
          console.log('Tomestone Comments: Found username:', username);
          return username;
        }
      }
    }
    return null;
  }

  // Set up observer to watch for the dropdown menu opening
  function setupUsernameObserver() {
    if (usernameObserver) return; // Already set up

    usernameObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is a HeadlessUI menu (role="menu")
            const menu = node.querySelector ? 
              (node.getAttribute('role') === 'menu' ? node : node.querySelector('[role="menu"]')) : 
              null;
            
            if (menu) {
              // Small delay to ensure menu content is rendered
              setTimeout(() => {
                const username = extractUsernameFromMenu();
                if (username && username !== currentUsername) {
                  saveUsername(username);
                }
              }, 50);
            }
          }
        }
      }
    });

    usernameObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Update the username display in the comments form
  function updateUsernameDisplay() {
    const usernameDisplay = document.getElementById('tomestone-username-display');
    const loginPrompt = document.getElementById('tomestone-login-prompt');
    const commentInput = document.getElementById('tomestone-new-comment');
    const submitBtn = document.getElementById('tomestone-submit-comment');
    
    if (usernameDisplay && loginPrompt) {
      if (currentUsername) {
        usernameDisplay.textContent = currentUsername;
        usernameDisplay.parentElement.style.display = 'flex';
        loginPrompt.style.display = 'none';
        if (commentInput) commentInput.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
      } else if (isUserLoggedIn()) {
        usernameDisplay.parentElement.style.display = 'none';
        loginPrompt.innerHTML = '👆 Click your profile avatar above to enable commenting';
        loginPrompt.style.display = 'block';
        if (commentInput) commentInput.disabled = true;
        if (submitBtn) submitBtn.disabled = true;
      } else {
        usernameDisplay.parentElement.style.display = 'none';
        loginPrompt.innerHTML = '🔒 <a href="https://tomestone.gg/login" style="color: #3b82f6; text-decoration: underline;">Sign in to Tomestone.gg</a> to comment';
        loginPrompt.style.display = 'block';
        if (commentInput) commentInput.disabled = true;
        if (submitBtn) submitBtn.disabled = true;
      }
    }
  }

  // Create the Comments tab in the navigation
  function createCommentsTab() {
    const nav = document.querySelector('nav[aria-label="Tabs"]');
    if (!nav || document.getElementById('tomestone-comments-tab')) return null;

    const tab = document.createElement('h2');
    tab.id = 'tomestone-comments-tab';
    tab.className = 'text-[var(--color-text-300)] hover:text-white w-0 flex-1 min-w-[110px] sm:min-w-[150px] text-sm sm:text-base font-medium my-2 text-center cursor-pointer';
    tab.innerHTML = `
      <span class="block py-2 sm:py-3 px-2 sm:px-4 tomestone-comments-tab-link">
        💬 Comments <span id="tomestone-comments-count" class="text-xs opacity-70"></span>
      </span>
    `;

    tab.addEventListener('click', toggleComments);
    nav.appendChild(tab);

    // Add click handlers to other tabs to close comments when they're clicked
    const otherTabs = nav.querySelectorAll('h2:not(#tomestone-comments-tab)');
    otherTabs.forEach(otherTab => {
      otherTab.addEventListener('click', handleOtherTabClick);
    });

    return tab;
  }

  // Toggle comments visibility
  function toggleComments() {
    if (commentsVisible) {
      closeComments();
    } else {
      showComments();
    }
  }

  // Find the content container below the nav tabs
  function findContentContainer() {
    const nav = document.querySelector('nav[aria-label="Tabs"]');
    if (!nav) return null;
    
    // The content area is typically the next sibling container after the nav's parent
    // Look for the main content container that changes when tabs are clicked
    let parent = nav.parentElement;
    if (parent) {
      // Find the next sibling that contains the actual content
      let sibling = parent.nextElementSibling;
      while (sibling) {
        // Skip our comments container
        if (sibling.id !== 'tomestone-comments-container') {
          return sibling;
        }
        sibling = sibling.nextElementSibling;
      }
    }
    return null;
  }

  // Get the currently active tab (not our comments tab)
  function findActiveTab() {
    const nav = document.querySelector('nav[aria-label="Tabs"]');
    if (!nav) return null;
    
    // Find the tab that has the active styling (bg-[var(--color-controls-700)] or similar)
    const tabs = nav.querySelectorAll('h2');
    for (const tab of tabs) {
      if (tab.id === 'tomestone-comments-tab') continue;
      // Active tabs typically have the background color class
      if (tab.className.includes('bg-[var(--color-controls-700)]') || 
          tab.className.includes('bg-') && tab.className.includes('rounded')) {
        return tab;
      }
    }
    return null;
  }

  // Unhighlight all native tabs
  function unhighlightNativeTabs() {
    const nav = document.querySelector('nav[aria-label="Tabs"]');
    if (!nav) return;
    
    const tabs = nav.querySelectorAll('h2');
    for (const tab of tabs) {
      if (tab.id === 'tomestone-comments-tab') continue;
      // Store the last active tab before we unhighlight it
      if (tab.className.includes('bg-[var(--color-controls-700)]') || 
          (tab.className.includes('bg-') && tab.className.includes('rounded'))) {
        lastActiveTab = tab;
      }
      // Remove active styling and add inactive styling
      tab.className = tab.className
        .replace(/bg-\[var\(--color-controls-700\)\]/g, '')
        .replace(/text-white/g, 'text-[var(--color-text-300)]')
        .replace(/rounded-md/g, '');
    }
  }

  // Highlight the comments tab as active
  function highlightCommentsTab(active) {
    if (!commentsTab) return;

    if (active) {
      commentsTab.className = 'text-white bg-[var(--color-controls-700)] rounded-md w-0 flex-1 min-w-[110px] sm:min-w-[150px] text-sm sm:text-base font-medium my-2 text-center cursor-pointer';
    } else {
      commentsTab.className = 'text-[var(--color-text-300)] hover:text-white w-0 flex-1 min-w-[110px] sm:min-w-[150px] text-sm sm:text-base font-medium my-2 text-center cursor-pointer';
    }
  }

  // Show comments section
  function showComments() {
    commentsVisible = true;
    
    // Find and hide the current content container
    originalContentContainer = findContentContainer();
    if (originalContentContainer) {
      originalContentContainer.style.display = 'none';
    }
    
    // Unhighlight other tabs
    unhighlightNativeTabs();
    
    // Create comments container if needed
    if (!commentsContainer) {
      createCommentsContainer();
    }
    
    commentsContainer.style.display = 'block';
    highlightCommentsTab(true);
    fetchAndRenderComments();
  }

  // Close/hide comments section
  function closeComments() {
    commentsVisible = false;
    
    // Hide comments container
    if (commentsContainer) {
      commentsContainer.style.display = 'none';
    }
    
    // Show the original content container
    if (originalContentContainer) {
      originalContentContainer.style.display = '';
    }
    
    // Unhighlight comments tab
    highlightCommentsTab(false);
    
    // Click the last active tab to restore its state
    if (lastActiveTab) {
      const link = lastActiveTab.querySelector('a');
      if (link) {
        link.click();
      }
    }
  }

  // Hide comments when another tab is clicked
  function handleOtherTabClick() {
    if (commentsVisible) {
      commentsVisible = false;
      
      if (commentsContainer) {
        commentsContainer.style.display = 'none';
      }
      
      if (originalContentContainer) {
        originalContentContainer.style.display = '';
      }
      
      highlightCommentsTab(false);
    }
  }

  // Create the comments container
  function createCommentsContainer() {
    const nav = document.querySelector('nav[aria-label="Tabs"]');
    if (!nav) return;

    commentsContainer = document.createElement('div');
    commentsContainer.id = 'tomestone-comments-container';
    commentsContainer.className = 'tomestone-comments-section';

    commentsContainer.innerHTML = `
      <div class="tomestone-comments-header">
        <h3>Community Comments</h3>
        <p class="tomestone-comments-subtitle">Share your thoughts about this character</p>
      </div>
      
      <div class="tomestone-comments-form">
        <div class="tomestone-user-info">
          <div class="tomestone-username-row" style="display: ${currentUsername ? 'flex' : 'none'};">
            <span class="tomestone-posting-as">Posting as:</span>
            <span id="tomestone-username-display" class="tomestone-username">${currentUsername || ''}</span>
          </div>
          <div id="tomestone-login-prompt" class="tomestone-login-prompt" style="display: ${currentUsername ? 'none' : 'block'};">
            ${isUserLoggedIn() ? '👆 Click your profile avatar above to enable commenting' : '🔒 <a href="https://tomestone.gg/login" style="color: #3b82f6; text-decoration: underline;">Sign in to Tomestone.gg</a> to comment'}
          </div>
        </div>
        <div class="tomestone-comment-input">
          <textarea id="tomestone-new-comment" placeholder="Write a comment..." maxlength="2000" rows="3" ${!currentUsername ? 'disabled' : ''}></textarea>
          <div class="tomestone-comment-actions">
            <span id="tomestone-char-count">0/2000</span>
            <button id="tomestone-submit-comment" class="tomestone-btn tomestone-btn-primary" ${!currentUsername ? 'disabled' : ''}>Post Comment</button>
          </div>
        </div>
      </div>

      <div id="tomestone-comments-list" class="tomestone-comments-list">
        <div class="tomestone-loading">Loading comments...</div>
      </div>
    `;

    // Find where to insert - after the nav's parent container, in the same area as content
    const navParent = nav.parentElement;
    if (navParent) {
      // Insert after nav parent (same level as content area)
      navParent.parentNode.insertBefore(commentsContainer, navParent.nextSibling);
    } else {
      // Fallback: insert after the nav
      nav.parentNode.insertBefore(commentsContainer, nav.nextSibling);
    }

    // Set up event listeners
    setupFormListeners();
  }

  // Set up form event listeners
  function setupFormListeners() {
    const commentInput = document.getElementById('tomestone-new-comment');
    const submitBtn = document.getElementById('tomestone-submit-comment');
    const charCount = document.getElementById('tomestone-char-count');

    // Character count
    commentInput.addEventListener('input', () => {
      const count = commentInput.value.length;
      charCount.textContent = `${count}/2000`;
      charCount.className = count > 1800 ? 'tomestone-char-warning' : '';
    });

    // Submit comment
    submitBtn.addEventListener('click', () => submitComment());

    // Submit on Ctrl+Enter
    commentInput.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        submitComment();
      }
    });

    // Update UI based on login state
    updateUsernameDisplay();
  }

  // Fetch and render comments
  async function fetchAndRenderComments() {
    const listEl = document.getElementById('tomestone-comments-list');
    if (!listEl) return;

    listEl.innerHTML = '<div class="tomestone-loading">Loading comments...</div>';

    try {
      const response = await fetch(`${apiBaseUrl}/api/comments/${currentCharacterId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Update count in tab
      const countEl = document.getElementById('tomestone-comments-count');
      if (countEl) {
        countEl.textContent = data.count > 0 ? `(${data.count})` : '';
      }

      if (data.comments.length === 0) {
        listEl.innerHTML = `
          <div class="tomestone-no-comments">
            <p>No comments yet. Be the first to share your thoughts!</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = '';
      data.comments.forEach(comment => {
        listEl.appendChild(renderComment(comment, 0));
      });

    } catch (error) {
      console.error('Failed to fetch comments:', error);
      listEl.innerHTML = `
        <div class="tomestone-error">
          <p>Failed to load comments. Please try again later.</p>
          <button onclick="window.tomestoneRefreshComments()" class="tomestone-btn">Retry</button>
        </div>
      `;
    }
  }

  // Expose refresh function globally
  window.tomestoneRefreshComments = fetchAndRenderComments;

  // Render a single comment with replies
  function renderComment(comment, depth = 0) {
    const el = document.createElement('div');
    el.className = `tomestone-comment ${depth > 0 ? 'tomestone-reply' : ''}`;
    el.dataset.commentId = comment.id;
    el.style.marginLeft = `${Math.min(depth * 24, 72)}px`;

    const date = new Date(comment.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const isOwnComment = comment.nickname === currentUsername;

    el.innerHTML = `
      <div class="tomestone-comment-header">
        <span class="tomestone-comment-author">${escapeHtml(comment.nickname)}</span>
        <span class="tomestone-comment-date">${date}</span>
      </div>
      <div class="tomestone-comment-content">${escapeHtml(comment.content)}</div>
      <div class="tomestone-comment-footer">
        <button class="tomestone-btn-link tomestone-reply-btn" data-comment-id="${comment.id}">Reply</button>
        ${isOwnComment ? `<button class="tomestone-btn-link tomestone-delete-btn" data-comment-id="${comment.id}">Delete</button>` : ''}
      </div>
      <div class="tomestone-reply-form" id="reply-form-${comment.id}" style="display: none;">
        <textarea placeholder="Write a reply..." maxlength="2000" rows="2"></textarea>
        <div class="tomestone-reply-actions">
          <button class="tomestone-btn tomestone-btn-small tomestone-cancel-reply">Cancel</button>
          <button class="tomestone-btn tomestone-btn-primary tomestone-btn-small tomestone-submit-reply">Reply</button>
        </div>
      </div>
    `;

    // Reply button
    el.querySelector('.tomestone-reply-btn').addEventListener('click', () => {
      const replyForm = el.querySelector('.tomestone-reply-form');
      replyForm.style.display = replyForm.style.display === 'none' ? 'block' : 'none';
    });

    // Cancel reply
    el.querySelector('.tomestone-cancel-reply').addEventListener('click', () => {
      el.querySelector('.tomestone-reply-form').style.display = 'none';
    });

    // Submit reply
    el.querySelector('.tomestone-submit-reply').addEventListener('click', () => {
      const textarea = el.querySelector('.tomestone-reply-form textarea');
      submitReply(comment.id, textarea.value);
    });

    // Delete button
    const deleteBtn = el.querySelector('.tomestone-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => deleteComment(comment.id));
    }

    // Render replies
    if (comment.replies && comment.replies.length > 0) {
      const repliesContainer = document.createElement('div');
      repliesContainer.className = 'tomestone-replies';
      comment.replies.forEach(reply => {
        repliesContainer.appendChild(renderComment(reply, depth + 1));
      });
      el.appendChild(repliesContainer);
    }

    return el;
  }

  // Submit a new comment
  async function submitComment() {
    const commentInput = document.getElementById('tomestone-new-comment');
    const submitBtn = document.getElementById('tomestone-submit-comment');

    if (!currentUsername) {
      showToast('Please sign in to Tomestone.gg and click your profile avatar', 'error');
      return;
    }

    const content = commentInput.value.trim();

    if (!content) {
      showToast('Please enter a comment', 'error');
      commentInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting...';

    try {
      const response = await fetch(`${apiBaseUrl}/api/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nickname': currentUsername
        },
        body: JSON.stringify({
          characterId: currentCharacterId,
          nickname: currentUsername,
          content
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to post comment');
      }

      // Clear input
      commentInput.value = '';
      document.getElementById('tomestone-char-count').textContent = '0/2000';

      // Refresh comments
      await fetchAndRenderComments();
      showToast('Comment posted!', 'success');

    } catch (error) {
      console.error('Failed to post comment:', error);
      showToast(error.message || 'Failed to post comment', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Post Comment';
    }
  }

  // Submit a reply
  async function submitReply(parentId, content) {
    if (!currentUsername) {
      showToast('Please sign in to Tomestone.gg and click your profile avatar', 'error');
      return;
    }

    if (!content.trim()) {
      showToast('Please enter a reply', 'error');
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nickname': currentUsername
        },
        body: JSON.stringify({
          characterId: currentCharacterId,
          parentId,
          nickname: currentUsername,
          content: content.trim()
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to post reply');
      }

      await fetchAndRenderComments();
      showToast('Reply posted!', 'success');

    } catch (error) {
      console.error('Failed to post reply:', error);
      showToast(error.message || 'Failed to post reply', 'error');
    }
  }

  // Delete a comment
  async function deleteComment(commentId) {
    if (!confirm('Are you sure you want to delete this comment?')) {
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/comments/${commentId}`, {
        method: 'DELETE',
        headers: {
          'X-Nickname': currentUsername
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete comment');
      }

      await fetchAndRenderComments();
      showToast('Comment deleted', 'success');

    } catch (error) {
      console.error('Failed to delete comment:', error);
      showToast(error.message || 'Failed to delete comment', 'error');
    }
  }

  // Show toast notification
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.tomestone-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `tomestone-toast tomestone-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('tomestone-toast-show'), 10);
    setTimeout(() => {
      toast.classList.remove('tomestone-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Update comment count in tab
  async function updateCommentCount() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/comments/${currentCharacterId}`);
      if (response.ok) {
        const data = await response.json();
        const countEl = document.getElementById('tomestone-comments-count');
        if (countEl) {
          countEl.textContent = data.count > 0 ? `(${data.count})` : '';
        }
      }
    } catch (e) {
      // Silently fail
    }
  }

  // Clean up previous state when navigating to a new character
  function cleanup() {
    // Remove the comments tab if it exists
    const existingTab = document.getElementById('tomestone-comments-tab');
    if (existingTab) {
      existingTab.remove();
    }
    
    // Remove the comments container if it exists
    const existingContainer = document.getElementById('tomestone-comments-container');
    if (existingContainer) {
      existingContainer.remove();
    }
    
    // Reset state
    commentsVisible = false;
    commentsContainer = null;
    commentsTab = null;
    originalContentContainer = null;
    lastActiveTab = null;
  }

  // Handle URL changes for SPA navigation
  function handleUrlChange() {
    const newCharacterId = getCharacterIdFromUrl();
    
    // If we're no longer on a character page, cleanup and exit
    if (!newCharacterId) {
      cleanup();
      currentCharacterId = null;
      return;
    }
    
    // If we're on a new character page (or first time on a character page)
    if (newCharacterId !== currentCharacterId) {
      cleanup();
      currentCharacterId = newCharacterId;
      
      // Wait for the nav to be ready (SPA may still be rendering)
      const waitForNav = setInterval(() => {
        const nav = document.querySelector('nav[aria-label="Tabs"]');
        if (nav) {
          clearInterval(waitForNav);
          commentsTab = createCommentsTab();
          updateCommentCount();
        }
      }, 100);
      
      // Timeout after 10 seconds
      setTimeout(() => clearInterval(waitForNav), 10000);
    }
  }

  // Set up URL change detection for SPA navigation
  function setupUrlChangeDetection() {
    let lastUrl = window.location.href;
    
    // Override pushState and replaceState to detect programmatic navigation
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        handleUrlChange();
      }
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        handleUrlChange();
      }
    };
    
    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        handleUrlChange();
      }
    });
    
    // Also use MutationObserver as a fallback for frameworks that may not trigger history events
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        handleUrlChange();
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initialize the extension
  async function init() {
    await loadSettings();
    
    // Set up observer to capture username from dropdown
    setupUsernameObserver();
    
    // Set up URL change detection for SPA navigation
    setupUrlChangeDetection();
    
    // Handle the current page
    handleUrlChange();
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
