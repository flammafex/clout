// Scarcity Web Wallet - Frontend Application

const API_BASE = '/api';
let initialized = false;

// Utility functions
const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);

function showLoading(text = 'Processing...') {
  $('loading').style.display = 'flex';
  $('loading-text').textContent = text;
}

function hideLoading() {
  $('loading').style.display = 'none';
}

function showError(message) {
  const toast = $('error-toast');
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 5000);
}

function showSuccess(message) {
  const toast = $('success-toast');
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 3000);
}

async function apiCall(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Request failed');
    }

    return data.data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Tab navigation
function setupTabs() {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // Update buttons
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update content
      $$('.tab-content').forEach(c => c.classList.remove('active'));
      $(`${tab}-tab`).classList.add('active');

      // Load tab-specific data
      if (tab === 'wallets') loadWallets();
      if (tab === 'tokens') loadTokens();
      if (tab === 'send') loadSendOptions();
      if (tab === 'receive') loadReceiveOptions();
      if (tab === 'operations') loadOperationsOptions();
    });
  });
}

// Initialize network
async function initializeNetwork() {
  try {
    showLoading('Connecting to Scarcity network...');
    await apiCall('/init', 'POST');
    initialized = true;

    // Update UI
    $('init-section').style.display = 'none';
    $('main-app').style.display = 'block';
    $('status-indicator').classList.add('online');
    $('status-text').textContent = 'Connected';

    showSuccess('Connected to Scarcity network');
    loadWallets();
  } catch (error) {
    showError('Failed to initialize: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Wallet management
async function loadWallets() {
  try {
    const data = await apiCall('/wallets');
    const walletList = $('wallet-list');
    walletList.innerHTML = '';

    if (data.wallets.length === 0) {
      walletList.innerHTML = '<p style="text-align: center; color: var(--text-light);">No wallets yet. Create one to get started!</p>';
      return;
    }

    for (const wallet of data.wallets) {
      const balance = await apiCall(`/wallets/${wallet.name}/balance`);
      const card = document.createElement('div');
      card.className = `wallet-card ${wallet.isDefault ? 'default' : ''}`;
      card.innerHTML = `
        <div class="wallet-header">
          <div class="wallet-name">
            ${wallet.name}
            ${wallet.isDefault ? '<span class="wallet-badge">DEFAULT</span>' : ''}
          </div>
          <div class="wallet-actions">
            ${!wallet.isDefault ? `<button class="btn btn-small" onclick="setDefaultWallet('${wallet.name}')">Set Default</button>` : ''}
            <button class="btn btn-small btn-secondary" onclick="exportWallet('${wallet.name}')">Export</button>
          </div>
        </div>
        <div class="wallet-pubkey">${wallet.publicKey}</div>
        <div class="wallet-balance">
          <span>Balance:</span>
          <span class="wallet-balance-amount">${balance.balance}</span>
        </div>
        <div style="font-size: 0.85rem; color: var(--text-light); margin-top: 0.5rem;">
          ${balance.tokenCount} token${balance.tokenCount !== 1 ? 's' : ''}
        </div>
      `;
      walletList.appendChild(card);
    }

    // Update wallet dropdowns
    updateWalletDropdowns(data.wallets);
  } catch (error) {
    showError('Failed to load wallets: ' + error.message);
  }
}

function updateWalletDropdowns(wallets) {
  const selects = ['mint-wallet', 'receive-wallet', 'token-wallet-filter'];

  selects.forEach(selectId => {
    const select = $(selectId);
    const currentValue = select.value;
    select.innerHTML = selectId === 'token-wallet-filter' ? '<option value="">All wallets</option>' : '<option value="">Select wallet</option>';

    wallets.forEach(wallet => {
      const option = document.createElement('option');
      option.value = wallet.name;
      option.textContent = wallet.name;
      select.appendChild(option);
    });

    if (currentValue) select.value = currentValue;
  });
}

async function createWallet() {
  const name = $('new-wallet-name').value.trim();
  const setDefault = $('set-default').checked;

  if (!name) {
    showError('Please enter a wallet name');
    return;
  }

  try {
    showLoading('Creating wallet...');
    await apiCall('/wallets', 'POST', { name, setDefault });
    showSuccess('Wallet created successfully');
    $('create-wallet-form').style.display = 'none';
    $('new-wallet-name').value = '';
    loadWallets();
  } catch (error) {
    showError('Failed to create wallet: ' + error.message);
  } finally {
    hideLoading();
  }
}

async function importWallet() {
  const name = $('import-wallet-name').value.trim();
  const secretKey = $('import-secret-key').value.trim();

  if (!name || !secretKey) {
    showError('Please enter wallet name and secret key');
    return;
  }

  try {
    showLoading('Importing wallet...');
    await apiCall('/wallets/import', 'POST', { name, secretKey, setDefault: false });
    showSuccess('Wallet imported successfully');
    $('import-wallet-form').style.display = 'none';
    $('import-wallet-name').value = '';
    $('import-secret-key').value = '';
    loadWallets();
  } catch (error) {
    showError('Failed to import wallet: ' + error.message);
  } finally {
    hideLoading();
  }
}

async function setDefaultWallet(name) {
  try {
    showLoading('Setting default wallet...');
    await apiCall(`/wallets/${name}/default`, 'POST');
    showSuccess('Default wallet updated');
    loadWallets();
  } catch (error) {
    showError('Failed to set default: ' + error.message);
  } finally {
    hideLoading();
  }
}

async function exportWallet(name) {
  try {
    const data = await apiCall(`/wallets/${name}/export`);

    // Show secret key in a copyable format
    const secretKey = data.secretKey;
    const message = `Secret key for wallet "${name}":\n\n${secretKey}\n\nKeep this safe!`;

    if (confirm('Your secret key will be shown. Make sure to copy it to a safe place!\n\nClick OK to reveal.')) {
      prompt(message, secretKey);
      showSuccess('Secret key revealed');
    }
  } catch (error) {
    showError('Failed to export wallet: ' + error.message);
  }
}

// Token management
async function loadTokens() {
  try {
    const wallet = $('token-wallet-filter').value;
    const data = await apiCall(`/tokens?wallet=${wallet || ''}&spent=false`);

    // Calculate total balance
    const balance = data.tokens.reduce((sum, t) => sum + t.amount, 0);
    $('total-balance').textContent = balance;
    $('token-count').textContent = `${data.tokens.length} token${data.tokens.length !== 1 ? 's' : ''}`;

    const tokenList = $('token-list');
    tokenList.innerHTML = '';

    if (data.tokens.length === 0) {
      tokenList.innerHTML = '<p style="text-align: center; color: var(--text-light);">No tokens yet. Mint one to get started!</p>';
      return;
    }

    data.tokens.forEach(token => {
      const card = document.createElement('div');
      card.className = `token-card ${token.spent ? 'spent' : ''}`;
      card.innerHTML = `
        <div class="token-info">
          <div class="token-id">${token.id}</div>
          <div class="token-amount">${token.amount}</div>
          <div class="token-meta">
            Wallet: ${token.wallet} •
            ${token.metadata?.type ? token.metadata.type.charAt(0).toUpperCase() + token.metadata.type.slice(1) : 'Unknown'} •
            ${new Date(token.created).toLocaleDateString()}
          </div>
        </div>
        <div class="token-status ${token.spent ? 'spent' : 'available'}">
          ${token.spent ? 'Spent' : 'Available'}
        </div>
      `;
      tokenList.appendChild(card);
    });
  } catch (error) {
    showError('Failed to load tokens: ' + error.message);
  }
}

async function mintToken() {
  const wallet = $('mint-wallet').value;
  const amount = parseInt($('mint-amount').value);

  if (!wallet || !amount || amount <= 0) {
    showError('Please select wallet and enter valid amount');
    return;
  }

  try {
    showLoading('Minting token...');
    const data = await apiCall('/tokens/mint', 'POST', { wallet, amount });
    showSuccess(`Token minted: ${data.id}`);
    $('mint-form').style.display = 'none';
    $('mint-amount').value = '';
    loadTokens();
  } catch (error) {
    showError('Failed to mint token: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Send/Receive
async function loadSendOptions() {
  try {
    const data = await apiCall('/tokens?spent=false');
    const select = $('send-token');
    select.innerHTML = '<option value="">Select token to send</option>';

    data.tokens.forEach(token => {
      const option = document.createElement('option');
      option.value = token.id;
      option.textContent = `${token.id.substring(0, 16)}... (${token.amount}) - ${token.wallet}`;
      option.dataset.wallet = token.wallet;
      select.appendChild(option);
    });
  } catch (error) {
    showError('Failed to load tokens: ' + error.message);
  }
}

async function loadReceiveOptions() {
  // Just make sure wallets are loaded in dropdown
  try {
    const data = await apiCall('/wallets');
    updateWalletDropdowns(data.wallets);
  } catch (error) {
    showError('Failed to load wallets: ' + error.message);
  }
}

async function sendToken() {
  const tokenId = $('send-token').value;
  const recipientPublicKey = $('send-recipient').value.trim();
  const selectedOption = $('send-token').selectedOptions[0];
  const wallet = selectedOption ? selectedOption.dataset.wallet : null;

  if (!tokenId || !recipientPublicKey) {
    showError('Please select token and enter recipient public key');
    return;
  }

  try {
    showLoading('Sending token...');
    const data = await apiCall('/tokens/transfer', 'POST', {
      tokenId,
      recipientPublicKey,
      wallet
    });

    const transferJson = JSON.stringify(data.transfer, null, 2);
    $('send-result').style.display = 'block';
    $('send-result').innerHTML = `
      <h4>Transfer Created Successfully</h4>
      <p>Share this transfer data with the recipient:</p>
      <pre>${transferJson}</pre>
      <button class="btn btn-small" onclick="copyTransfer(${JSON.stringify(transferJson).replace(/"/g, '&quot;')})">Copy Transfer Data</button>
    `;

    showSuccess('Token sent successfully');
    $('send-token').value = '';
    $('send-recipient').value = '';
  } catch (error) {
    showError('Failed to send token: ' + error.message);
  } finally {
    hideLoading();
  }
}

function copyTransfer(data) {
  navigator.clipboard.writeText(data).then(() => {
    showSuccess('Transfer data copied to clipboard');
  });
}

async function receiveToken() {
  const wallet = $('receive-wallet').value;
  const transferText = $('receive-transfer').value.trim();

  if (!wallet || !transferText) {
    showError('Please select wallet and paste transfer data');
    return;
  }

  try {
    const transfer = JSON.parse(transferText);

    showLoading('Receiving token...');
    const data = await apiCall('/tokens/receive', 'POST', { transfer, wallet });

    $('receive-result').style.display = 'block';
    $('receive-result').innerHTML = `
      <h4>Token Received Successfully</h4>
      <p><strong>Token ID:</strong> ${data.id}</p>
      <p><strong>Amount:</strong> ${data.amount}</p>
    `;

    showSuccess('Token received successfully');
    $('receive-transfer').value = '';
  } catch (error) {
    showError('Failed to receive token: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Operations
async function loadOperationsOptions() {
  try {
    const data = await apiCall('/tokens?spent=false');

    // Split dropdown
    const splitSelect = $('split-token');
    splitSelect.innerHTML = '<option value="">Select token to split</option>';

    // Merge checkboxes
    const mergeCheckboxes = $('merge-token-checkboxes');
    mergeCheckboxes.innerHTML = '';

    if (data.tokens.length === 0) {
      mergeCheckboxes.innerHTML = '<p style="text-align: center; color: var(--text-light);">No tokens available</p>';
      return;
    }

    data.tokens.forEach(token => {
      // Split option
      const option = document.createElement('option');
      option.value = token.id;
      option.textContent = `${token.id.substring(0, 16)}... (${token.amount}) - ${token.wallet}`;
      option.dataset.wallet = token.wallet;
      splitSelect.appendChild(option);

      // Merge checkbox
      const checkboxDiv = document.createElement('div');
      checkboxDiv.className = 'checkbox-item';
      checkboxDiv.innerHTML = `
        <input type="checkbox" id="merge-${token.id}" value="${token.id}" data-wallet="${token.wallet}">
        <label for="merge-${token.id}" style="cursor: pointer; flex: 1;">
          <strong>${token.amount}</strong> - ${token.id.substring(0, 32)}... (${token.wallet})
        </label>
      `;
      mergeCheckboxes.appendChild(checkboxDiv);
    });
  } catch (error) {
    showError('Failed to load tokens: ' + error.message);
  }
}

async function splitToken() {
  const tokenId = $('split-token').value;
  const amountsText = $('split-amounts').value.trim();
  const selectedOption = $('split-token').selectedOptions[0];
  const wallet = selectedOption ? selectedOption.dataset.wallet : null;

  if (!tokenId || !amountsText) {
    showError('Please select token and enter amounts');
    return;
  }

  try {
    const amounts = amountsText.split(',').map(a => parseInt(a.trim()));
    if (amounts.some(a => isNaN(a) || a <= 0)) {
      throw new Error('Invalid amounts format');
    }

    showLoading('Splitting token...');
    const data = await apiCall('/tokens/split', 'POST', { tokenId, amounts, wallet });

    $('split-result').style.display = 'block';
    $('split-result').innerHTML = `
      <h4>Token Split Successfully</h4>
      <p>Created ${data.tokens.length} new tokens:</p>
      <ul>
        ${data.tokens.map(t => `<li>${t.id.substring(0, 32)}... (${t.amount})</li>`).join('')}
      </ul>
    `;

    showSuccess('Token split successfully');
    $('split-token').value = '';
    $('split-amounts').value = '';
    loadOperationsOptions();
    loadTokens();
  } catch (error) {
    showError('Failed to split token: ' + error.message);
  } finally {
    hideLoading();
  }
}

async function mergeTokens() {
  const checkboxes = $$('#merge-token-checkboxes input[type="checkbox"]:checked');
  const tokenIds = Array.from(checkboxes).map(cb => cb.value);

  if (tokenIds.length < 2) {
    showError('Please select at least 2 tokens to merge');
    return;
  }

  // Get wallet from first checked token
  const wallet = checkboxes[0].dataset.wallet;

  try {
    showLoading('Merging tokens...');
    const data = await apiCall('/tokens/merge', 'POST', { tokenIds, wallet });

    $('merge-result').style.display = 'block';
    $('merge-result').innerHTML = `
      <h4>Tokens Merged Successfully</h4>
      <p><strong>New Token ID:</strong> ${data.id}</p>
      <p><strong>Total Amount:</strong> ${data.amount}</p>
    `;

    showSuccess('Tokens merged successfully');
    loadOperationsOptions();
    loadTokens();
  } catch (error) {
    showError('Failed to merge tokens: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();

  // Initialize
  $('init-btn').addEventListener('click', initializeNetwork);

  // Wallet events
  $('create-wallet-btn').addEventListener('click', () => {
    $('create-wallet-form').style.display = 'block';
    $('import-wallet-form').style.display = 'none';
  });

  $('create-wallet-cancel').addEventListener('click', () => {
    $('create-wallet-form').style.display = 'none';
  });

  $('create-wallet-submit').addEventListener('click', createWallet);

  $('import-wallet-btn').addEventListener('click', () => {
    $('import-wallet-form').style.display = 'block';
    $('create-wallet-form').style.display = 'none';
  });

  $('import-wallet-cancel').addEventListener('click', () => {
    $('import-wallet-form').style.display = 'none';
  });

  $('import-wallet-submit').addEventListener('click', importWallet);

  // Token events
  $('token-wallet-filter').addEventListener('change', loadTokens);

  $('mint-token-btn').addEventListener('click', () => {
    $('mint-form').style.display = $('mint-form').style.display === 'none' ? 'block' : 'none';
  });

  $('mint-cancel').addEventListener('click', () => {
    $('mint-form').style.display = 'none';
  });

  $('mint-submit').addEventListener('click', mintToken);

  // Send/Receive events
  $('send-submit').addEventListener('click', sendToken);
  $('receive-submit').addEventListener('click', receiveToken);

  // Operations events
  $('split-submit').addEventListener('click', splitToken);
  $('merge-submit').addEventListener('click', mergeTokens);
});
