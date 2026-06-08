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
const THINKING_STOP_SEQUENCES = [
  '<|channel>thought',
  '<|channel|>thought',
  '<thought>',
  '[thought]',
];

const FINAL_ANSWER_MARKER = '최종 답변';

function buildPrompt({ customerQuestion, claimContext, files }) {
  const fileList = files
    .map(
      (file, index) =>
        `${index + 1}. ${file.originalname} (${file.mimetype}, ${Math.ceil(file.size / 1024)}KB)`
    )
    .join('\n');

  const systemInstruction = `당신은 대한민국 보험금 청구 서류를 검토하는 AI 보험금 예상 분석가입니다.

역할:
- 업로드된 보험증권, 약관, 진단서, 영수증, 입퇴원확인서, 사고확인서 등에서 보장 항목과 청구 근거를 찾아 예상 보험금을 산정합니다.
- 실제 지급 결정권자는 보험회사이며 결과는 참고용 예상치입니다.
- 문서에서 확인되지 않는 내용은 추정하지 말고 "확인 필요"로 표시합니다.
- 약관상 면책, 감액, 자기부담금, 보장 한도, 중복 보상 가능성, 추가 제출 서류를 검토합니다.
- 개인정보는 불필요하게 반복하지 않습니다.

제약조건:
- 금액은 원화(KRW)로 표기합니다.
- 문서 판독이 불명확하면 OCR 한계를 명시합니다.
- 확정 표현(반드시 지급, 100% 지급 등)을 사용하지 않습니다.
- 존재하지 않는 약관이나 보장명을 만들지 않습니다.

출력 제한:
- 내부 추론 과정, 사고 과정, 분석 메모, 프롬프트 분석을 출력하지 마십시오.
- Scenario, Ambiguity, Assumption, Reasoning, Thought Process, Internal Analysis 같은 제목을 출력하지 마십시오.
- 최종 사용자에게 보여줄 답변만 출력하십시오.
- 영어를 사용하지 마십시오.

출력 형식:
반드시 첫 줄을 "최종 답변"으로 시작하십시오.

1. 한 줄 결론 (예상 지급액 범위 및 신뢰도)
2. 산정표 (보장 항목 / 근거 문서 / 계산식 / 예상액 / 확인 필요 사항)
3. 감액·면책·한도 리스크
4. 추가 제출 권장 서류
5. 최종 안내 문구`;

  const userContent = `사용자 입력:
${customerQuestion || '업로드한 서류를 기준으로 예상 보험금을 계산해 주세요.'}

추가 청구 상황:
${claimContext || '별도 입력 없음'}

업로드 파일 목록:
${fileList}

위 자료를 종합하여 분석하십시오.

반드시 "최종 답변"으로 시작하십시오.
"최종 답변" 이전에 어떠한 설명, 메모, 사고 과정, 분석 과정도 출력하지 마십시오.`;

  return { systemInstruction, userContent };
}

function stripThinkingProcess(rawText) {
  if (!rawText) return '';

  let cleaned = rawText;

  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  cleaned = cleaned.replace(/\[thought\][\s\S]*?\[\/thought\]/gi, '');
  cleaned = cleaned.replace(/<\|channel\|?>thought[\s\S]*?(?:<channel\|>|$)/gi, '');

  return cleaned.trim();
}

function extractFinalAnswer(text) {
  if (!text) return '';

  const idx = text.indexOf(FINAL_ANSWER_MARKER);

  if (idx >= 0) {
    return text.substring(idx).trim();
  }

  return text.trim();
}

function sanitizeModelResponse(rawText) {
  const withoutThinking = stripThinkingProcess(rawText);
  return extractFinalAnswer(withoutThinking);
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
  const compact = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!compact) {
    return '응답 본문이 비어 있습니다.';
  }

  return compact.length > 240
    ? `${compact.slice(0, 240)}...`
    : compact;
}

function buildUpstreamErrorMessage(data, status) {
  const message = data?.error?.message || 'Google Generative Language API 호출에 실패했습니다.';
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('internal error encountered') || status >= 500) {
    return `${message} 현재 모델(${MODEL})에서 일시적인 내부 오류가 발생했거나 업로드한 PDF/이미지 입력을 처리하지 못했을 수 있습니다. 환경 변수 GEMMA_MODEL을 설정했다면 Google Generative Language API에서 사용할 수 있는 모델 ID인지 확인한 뒤 서버를 재시작/재배포해 주세요.`;
  }

  if (lowerMessage.includes('not found') || lowerMessage.includes('not supported') || lowerMessage.includes('unknown')) {
    return `${message} 모델 ID(${MODEL})가 Google Generative Language API에서 사용할 수 있는지 확인해 주세요.`;
  }

  return message;
}


function looksLikeInternalInstruction(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  return [
    /^AI Insurance Claim Analyst\.?$/i,
    /^Analyze expected insurance payouts/i,
    /^Insurance policy proposal/i,
    /^\*\s+One-line conclusion/i,
    /^\*\s+Calculation table/i,
    /^\*\s+Reduction\/Exemption\/Limit risks/i,
    /^\*\s+Additional documents/i,
    /^\*\s+Final disclaimer/i,
    /^\*\s+KRW currency/i,
    /^\*\s+Mention OCR limits/i,
    /^\*\s+Avoid definitive terms/i,
    /^\*\s+No made-up terms/i,
    /^\*\s+Suggest questions/i,
    /^\*\s+Language: Korean only/i,
    /^\*\s+No internal thought process output/i,
    /^\*\s+\*(Policy Name|Insured|Policy Period|Cancer-related Coverage|Crucial Note|Conclusion|Wait|Risk Factors|One-line conclusion|Calculation Table|Risks|Additional Docs|Questions for Insurance Co):\*/i,
    /^\*\s+Ensure /i
  ].some((pattern) => pattern.test(trimmed));
}

function findKoreanAnswerStart(lines) {
  return lines.findIndex((line) => /^\s*(?:#{1,3}\s*)?(?:\d+\.\s*)?(?:한 줄 결론|결론|예상 지급액|산정표|감액[·ㆍ]면책[·ㆍ]한도|추가로 제출)/.test(line.trim()));
}

function sanitizeModelOutput(text) {
  const withoutThinking = stripThinkingProcess(text);
  if (!withoutThinking) return '';

  const markerIndex = withoutThinking.indexOf(FINAL_ANSWER_MARKER);
  if (markerIndex !== -1) {
    return withoutThinking.slice(markerIndex).trim();
  }

  const lines = withoutThinking.split(/\r?\n/);
  const answerStart = findKoreanAnswerStart(lines);
  const candidateLines = answerStart === -1 ? lines : lines.slice(answerStart);

  return candidateLines
    .filter((line) => !looksLikeInternalInstruction(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


function normalizeModelResponse(data) {
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  if (text) {
    const sanitizedText = sanitizeModelOutput(text);
    if (sanitizedText) return sanitizedText;
  }

  const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
  if (reason) return `모델 응답이 비어 있습니다. 종료/차단 사유: ${reason}`;

  return '모델 응답을 해석할 수 없습니다.';
}


function buildGeminiRequestPayload(prompt, files) {
  const parts = [];
  parts.push({ text: prompt.userContent });

  for (const file of files) {
    parts.push({
      inlineData: {
        mimeType: file.mimetype,
        data: file.buffer.toString('base64')
      }
    });
  }

  return {
    systemInstruction: {
      parts: [
        { text: prompt.systemInstruction }
      ]
    },
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 4096,
      stopSequences: THINKING_STOP_SEQUENCES
    }
  };
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

  const requestPayload = buildGeminiRequestPayload(prompt, files);
  const requestBody = JSON.stringify(requestPayload);
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    }
  };
  requestOptions.body = requestBody;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const response = await fetch(endpoint, requestOptions);

  const responseText = await response.text();
  const data = parseJsonSafe(responseText);

  if (!data) {
    sendJson(res, 502, {
      error: `Google API가 JSON이 아닌 응답을 반환했습니다. 모델 ID(${MODEL}) 또는 API 엔드포인트를 확인해 주세요. 상태: ${response.status} ${response.statusText}. 응답: ${summarizeUpstreamBody(responseText)}`,
    });
    return;
  }

  if (!response.ok) {
    sendJson(res, response.status, { error: buildUpstreamErrorMessage(data, response.status) });
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
