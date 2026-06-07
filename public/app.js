const form = document.querySelector('#claim-form');
const fileInput = document.querySelector('#documents');
const fileList = document.querySelector('#file-list');
const result = document.querySelector('#result');
const submitButton = document.querySelector('#submit-button');
const modelBadge = document.querySelector('#model-badge');
const uploadZone = document.querySelector('.upload-zone');

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function renderFileList() {
  fileList.innerHTML = '';
  [...fileInput.files].forEach((file) => {
    const item = document.createElement('li');
    item.innerHTML = `<span>${file.name}</span><span>${formatBytes(file.size)}</span>`;
    fileList.append(item);
  });
}

function setResult(message, state = 'empty') {
  result.textContent = message;
  result.className = `result ${state}`;
}

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    modelBadge.textContent = data.model;
  } catch {
    modelBadge.textContent = 'model 확인 실패';
  }
}

fileInput.addEventListener('change', renderFileList);

['dragenter', 'dragover'].forEach((eventName) => {
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.add('dragging');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.remove('dragging');
  });
});

uploadZone.addEventListener('drop', (event) => {
  fileInput.files = event.dataTransfer.files;
  renderFileList();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (fileInput.files.length === 0) {
    setResult('분석할 보험증권 또는 청구 서류를 1개 이상 업로드해 주세요.', 'error');
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = '분석 중입니다...';
  setResult('AI가 서류를 읽고 보장 항목과 예상 보험금을 계산하고 있습니다. 잠시만 기다려 주세요.', 'loading');

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      body: new FormData(form),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '분석 요청에 실패했습니다.');
    }

    modelBadge.textContent = data.model;
    setResult(data.result, '');
  } catch (error) {
    setResult(error.message, 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'AI로 보험금 예상하기';
  }
});

loadHealth();
