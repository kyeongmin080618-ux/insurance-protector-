import { Readable } from 'stream';
import { analyze } from '../lib/insurance-ai.js';

const previousApiKey = process.env.GOOGLE_API_KEY;
process.env.GOOGLE_API_KEY = 'test-key';

const boundary = '----codex-payload-validation';
const multipartBody = Buffer.from([
  `--${boundary}`,
  'Content-Disposition: form-data; name="customerQuestion"',
  '',
  '보험금 예상액을 알려주세요.',
  `--${boundary}`,
  'Content-Disposition: form-data; name="claimContext"',
  '',
  '입원 치료 후 보험금 청구 예정입니다.',
  `--${boundary}`,
  'Content-Disposition: form-data; name="files"; filename="claim.png"',
  'Content-Type: image/png',
  '',
  'png fixture bytes',
  `--${boundary}--`,
  ''
].join('\r\n'));

let capturedRequest;
globalThis.fetch = async (url, options) => {
  capturedRequest = {
    url,
    options,
    payload: JSON.parse(options.body)
  };

  return new Response(
    JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: [
              'AI Insurance Claim Analyst.',
              'Analyze expected insurance payouts for uploaded documents.',
              '최종 답변',
              '한 줄 결론: 예상 보험금은 확인 필요입니다.'
            ].join('\n')
          }]
        }
      }]
    }),
    { status: 200 }
  );
};

const request = Readable.from([multipartBody]);
request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };

const response = {
  statusCode: undefined,
  headers: undefined,
  body: undefined,
  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
  },
  end(body) {
    this.body = body;
  }
};

await analyze(request, response);

if (previousApiKey === undefined) {
  delete process.env.GOOGLE_API_KEY;
} else {
  process.env.GOOGLE_API_KEY = previousApiKey;
}

if (response.statusCode !== 200) {
  throw new Error(`Expected status 200, received ${response.statusCode}: ${response.body}`);
}

const responseBody = JSON.parse(response.body);
if (!responseBody.result.startsWith('최종 답변')) {
  throw new Error('Model response did not keep only the final-answer section.');
}

if (responseBody.result.includes('AI Insurance Claim Analyst') || responseBody.result.includes('Analyze expected insurance payouts')) {
  throw new Error('Internal prompt leakage was not removed from the model response.');
}

if (!capturedRequest?.url?.includes(':generateContent')) {
  throw new Error('Gemini generateContent endpoint was not called.');
}

const payload = capturedRequest.payload;
const userText = payload.contents?.[0]?.parts?.[0]?.text;
const systemText = payload.systemInstruction?.parts?.[0]?.text;
const inlineData = payload.contents?.[0]?.parts?.[1]?.inline_data;

if (typeof userText !== 'string' || !userText.includes('보험금 예상액')) {
  throw new Error('User prompt text was not serialized correctly.');
}

if (typeof systemText !== 'string' || !systemText.includes('AI 보험금 예상 분석가')) {
  throw new Error('System instruction was not serialized correctly.');
}

if (inlineData?.mime_type !== 'image/png' || typeof inlineData.data !== 'string') {
  throw new Error('Uploaded file inline_data was not serialized correctly.');
}

if (payload.generationConfig?.maxOutputTokens !== 4096) {
  throw new Error('Generation config was not serialized correctly.');
}

console.log('analyze payload validation passed');
