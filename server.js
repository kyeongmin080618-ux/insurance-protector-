import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();

const MODEL = process.env.GEMMA_MODEL || 'gemma-4-31b-it';
const MAX_FILES = 8;
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_BODY_SIZE = MAX_FILES * MAX_FILE_SIZE + 1024 * 1024;
const PORT = process.env.PORT || 3000;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function safeJoin(base, target) {
  const resolved = path.resolve(base, target.replace(/^\/+/, ''));
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

function parseHeaders(headerText) {
  const headers = new Map();
  headerText.split('\r\n').forEach((line) => {
    const separator = line.indexOf(':');
    if (separator === -1) return;
    headers.set(line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim());
  });
  return headers;
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=("?)([^";]+)\1/i);
  if (!boundaryMatch) throw new Error('multipart boundary를 찾을 수 없습니다.');

  const boundary = `--${boundaryMatch[2]}`;
  const body = buffer.toString('latin1');
  const segments = body.split(boundary).slice(1, -1);
  const fields = {};
  const files = [];

  for (const segment of segments) {
    const normalized = segment.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const headerEnd = normalized.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = parseHeaders(normalized.slice(0, headerEnd));
    let value = normalized.slice(headerEnd + 4);
    if (value.endsWith('\r\n')) value = value.slice(0, -2);

    const disposition = headers.get('content-disposition') || '';
    const nameMatch = disposition.match(/name="([^"]+)"/);
    const filenameMatch = disposition.match(/filename="([^"]*)"/);
    const name = nameMatch?.[1];
    if (!name) continue;

    if (!filenameMatch) {
      fields[name] = Buffer.from(value, 'latin1').toString('utf8').trim();
      continue;
    }

    const originalname = path.basename(filenameMatch[1]);
    if (!originalname) continue;

    const mimetype = headers.get('content-type') || 'application/octet-stream';
    const fileBuffer = Buffer.from(value, 'latin1');
    files.push({ originalname, mimetype, buffer: fileBuffer, size: fileBuffer.length });
  }

  return { fields, files };
}

async function readRequestBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_SIZE) {
      throw new Error('업로드 용량이 너무 큽니다. 파일당 12MB, 최대 8개까지 업로드해 주세요.');
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function validateFiles(files) {
  if (files.length === 0) {
    throw new Error('분석할 보험증권 또는 청구 서류를 1개 이상 업로드해 주세요.');
  }

  if (files.length > MAX_FILES) {
    throw new Error(`최대 ${MAX_FILES}개 파일까지 업로드할 수 있습니다.`);
  }

  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      throw new Error('PDF, JPG, PNG, WEBP, HEIC 파일만 업로드할 수 있습니다.');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`${file.originalname} 파일이 12MB를 초과합니다.`);
    }
  }
}

function buildPrompt({ customerQuestion, claimContext, files }) {
  const fileList = files
    .map((file, index) => `${index + 1}. ${file.originalname} (${file.mimetype}, ${Math.ceil(file.size / 1024)}KB)`)
    .join('\n');

  const persona = `당신은 대한민국 보험금 청구 서류를 검토하는 AI 보험금 예상 분석가입니다.
역할:
- 업로드된 보험증권, 약관, 진단서, 영수증, 입퇴원확인서, 사고확인서 등에서 보장 항목과 청구 근거를 찾아 예상 보험금을 산정합니다.
- 실제 지급 결정권자는 보험회사이며, 당신의 결과는 법률/금융 자문이 아닌 참고용 예상치임을 분명히 안내합니다.
- 문서에서 확인되지 않는 내용은 추정하지 말고 "확인 필요"로 표시합니다.
- 약관상 면책, 감액, 자기부담금, 보장 한도, 중복 보상 가능성, 추가 제출 서류를 꼼꼼히 점검합니다.
- 개인정보는 답변에 불필요하게 반복하지 않습니다.

출력 형식:
1. 한 줄 결론: 예상 지급액 범위와 신뢰도
2. 산정표: 보장 항목 / 근거 문서 / 계산식 / 예상액 / 확인 필요 사항
3. 감액·면책·한도 리스크
4. 추가로 제출하면 좋은 서류
5. 최종 안내 문구`;

  const constraints = `제약조건:
- 금액은 원화(KRW)로 표기합니다.
- 문서 판독이 불명확하면 OCR 한계를 명시합니다.
- 확정 표현(반드시 지급, 100% 지급 등)을 피합니다.
- 모르는 약관 조항이나 보장명은 만들어내지 않습니다.
- 사용자가 보험사에 문의할 수 있도록 질문 목록을 제안합니다.`;

  return `<start_of_turn>user
${persona}

${constraints}

사용자 입력:
${customerQuestion || '업로드한 서류를 기준으로 예상 보험금을 계산해 주세요.'}

추가 청구 상황:
${claimContext || '별도 입력 없음'}

업로드 파일 목록:
${fileList}

위 자료를 종합해 보험금 예상액을 한국어로 분석해 주세요.
<end_of_turn>
<start_of_turn>model`;
}

function parseJsonSafe(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizeUpstreamBody(text) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '응답 본문이 비어 있습니다.';
  return compact.length > 240 ? `${compact.slice(0, 240)}...` : compact;
}

function normalizeModelResponse(data) {
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  if (text) return text;

  const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
  if (reason) return `모델 응답이 비어 있습니다. 종료/차단 사유: ${reason}`;

  return '모델 응답을 해석할 수 없습니다.';
}

async function analyze(req, res) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: '서버에 GOOGLE_API_KEY 환경 변수가 설정되어 있지 않습니다.' });
    return;
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('multipart/form-data')) {
    sendJson(res, 400, { error: 'multipart/form-data 형식으로 요청해 주세요.' });
    return;
  }

  const body = await readRequestBody(req);
  const { fields, files } = parseMultipart(body, contentType);
  validateFiles(files);

  const prompt = buildPrompt({
    customerQuestion: fields.customerQuestion,
    claimContext: fields.claimContext,
    files,
  });

  const parts = [
    { text: prompt },
    ...files.map((file) => ({
      inline_data: {
        mime_type: file.mimetype,
        data: file.buffer.toString('base64'),
      },
    })),
  ];

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 4096,
      },
    }),
  });

  const responseText = await response.text();
  const data = parseJsonSafe(responseText);

  if (!data) {
    sendJson(res, 502, {
      error: `Google API가 JSON이 아닌 응답을 반환했습니다. 모델 ID(${MODEL}) 또는 API 엔드포인트를 확인해 주세요. 상태: ${response.status} ${response.statusText}. 응답: ${summarizeUpstreamBody(responseText)}`,
    });
    return;
  }

  if (!response.ok) {
    sendJson(res, response.status, { error: data?.error?.message || 'Google Generative Language API 호출에 실패했습니다.' });
    return;
  }

  sendJson(res, 200, {
    model: MODEL,
    result: normalizeModelResponse(data),
    uploadedFiles: files.map((file) => ({ name: file.originalname, type: file.mimetype, size: file.size })),
  });
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const filePath = safeJoin(publicDir, pathname);

  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const file = await readFile(filePath);
    const contentType = mimeTypes[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && requestUrl.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, model: MODEL, hasApiKey: Boolean(process.env.GOOGLE_API_KEY) });
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/analyze') {
      await analyze(req, res);
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: '지원하지 않는 메서드입니다.' });
  } catch (error) {
    const status = error.message?.includes('업로드') || error.message?.includes('파일') || error.message?.includes('multipart') ? 400 : 500;
    sendJson(res, status, { error: error.message || '서버 오류가 발생했습니다.' });
  }
});

server.listen(PORT, () => {
  console.log(`Insurance Protector is running on http://localhost:${PORT}`);
});
