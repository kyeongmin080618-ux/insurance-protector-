import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const envFileNames = ['.env', '.env.local'];
const envDirectories = [...new Set([process.cwd(), projectRoot])];
const envStatus = {
  checkedFiles: envDirectories.flatMap((directory) => envFileNames.map((fileName) => path.join(directory, fileName))),
  loadedFiles: [],
};

function displayPath(filePath) {
  const relative = path.relative(projectRoot, filePath);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative || '.';
  return filePath;
}

function loadEnvFile(envPath) {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^[ '"]|[ '"]$/g, '');
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function loadLocalEnv() {
  for (const envPath of envStatus.checkedFiles) {
    if (!existsSync(envPath)) continue;
    loadEnvFile(envPath);
    envStatus.loadedFiles.push(envPath);
  }
}

loadLocalEnv();

export const MODEL = process.env.GEMMA_MODEL || 'gemma-4-31b-it';

function getEnvDebugInfo() {
  return {
    cwd: process.cwd(),
    checkedFiles: envStatus.checkedFiles.map(displayPath),
    loadedFiles: envStatus.loadedFiles.map(displayPath),
  };
}

function missingApiKeyMessage() {
  const info = getEnvDebugInfo();
  const loaded = info.loadedFiles.length > 0 ? info.loadedFiles.join(', ') : '없음';
  return `서버에 GOOGLE_API_KEY 환경 변수가 설정되어 있지 않습니다. 프로젝트 루트의 .env 또는 .env.local 파일에 GOOGLE_API_KEY=키값을 넣고 서버를 재시작하세요. 확인한 파일: ${info.checkedFiles.join(', ')}. 읽은 파일: ${loaded}. 현재 실행 위치: ${info.cwd}`;
}
const MAX_FILES = 8;
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_BODY_SIZE = MAX_FILES * MAX_FILE_SIZE + 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
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

  // 1. 구글 API의 systemInstruction 필드로 들어갈 페르소나 및 제약조건
  const systemInstruction = `당신은 대한민국 보험금 청구 서류를 검토하는 AI 보험금 예상 분석가입니다.
역할:
- 업로드된 보험증권, 약관, 진단서, 영수증, 입퇴원확인서, 사고확인서 등에서 보장 항목과 청구 근거를 찾아 예상 보험금을 산정합니다.
- 실제 지급 결정권자는 보험회사이며, 당신의 결과는 법률/금융 자문이 아닌 참고용 예상치임을 분명히 안내합니다.
- 문서에서 확인되지 않는 내용은 추정하지 말고 "확인 필요"로 표시합니다.
- 약관상 면책, 감액, 자기부담금, 보장 한도, 중복 보상 가능성, 추가 제출 서류를 꼼꼼히 점검합니다.
- 개인정보는 답변에 불필요하게 반복하지 않습니다.

제약조건:
- 금액은 원화(KRW)로 표기합니다.
- 문서 판독이 불명확하면 OCR 한계를 명시합니다.
- 확정 표현(반드시 지급, 100% 지급 등)을 피합니다.
- 모르는 약관 조항이나 보장명은 만들어내지 않습니다.
- 사용자가 보험사에 문의할 수 있도록 질문 목록을 제안합니다.

출력 및 언어 제한:
- 생각 과정, 추론, 프롬프트 분석, <thought> 등 내부 추론 메커니즘은 절대 출력하지 마십시오.
- 영어는 쓰지 말고 오직 한국어로만 최종 답변을 출력하십시오.

출력 형식:
1. 한 줄 결론: 예상 지급액 범위와 신뢰도
2. 산정표: 보장 항목 / 근거 문서 / 계산식 / 예상액 / 확인 필요 사항
3. 감액·면책·한도 리스크
4. 추가로 제출하면 좋은 서류
5. 최종 안내 문구`;

  // 2. 구글 API의 contents 필드로 들어갈 순수 사용자 데이터
  const userContent = `사용자 입력:
${customerQuestion || '업로드한 서류를 기준으로 예상 보험금을 계산해 주세요.'}

추가 청구 상황:
${claimContext || '별도 입력 없음'}

업로드 파일 목록:
${fileList}

위 자료를 종합해 보험금 예상액을 한국어로만 분석해 주세요.`;

  // 구글 API 호출부에서 꺼내 쓰기 좋게 객체 형태로 반환합니다.
  return { systemInstruction, userContent };
}

// 모델이 간헐적으로 생각 과정 태그(<|channel|>thought 등)를 뱉을 때 강제로 지워버리는 방어 함수
function stripThinkingProcess(rawText) {
  if (!rawText) return '';
  let cleaned = rawText.replace(/<\|channel\|>thought[\s\S]*?<channel\|>/g, '');
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>|\[thought\][\s\S]*?\[\/thought\]/g, '');
  return cleaned.trim();
}

function parseJsonSafe(text) {
  if (!text) return null;

  // 파싱하기 전에 혹시 모를 생각 태그나 잔여 추론 텍스트가 있다면 먼저 청소합니다.
  const cleanedText = stripThinkingProcess(text);

  try {
    return JSON.parse(cleanedText);
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

export async function analyze(req, res) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: missingApiKeyMessage(), config: getEnvDebugInfo() });
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



export function sendHealth(res) {
  sendJson(res, 200, { ok: true, model: MODEL, hasApiKey: Boolean(process.env.GOOGLE_API_KEY), config: getEnvDebugInfo() });
}

export function getErrorStatus(error) {
  return error.message?.includes('업로드') || error.message?.includes('파일') || error.message?.includes('multipart') ? 400 : 500;
}
