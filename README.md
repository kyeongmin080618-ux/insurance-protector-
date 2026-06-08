# Insurance Protector

보험증권, 약관, 진단서, 영수증 등 보험금 청구 서류를 업로드하면 Google AI Studio의 Gemma 모델로 예상 보험금과 리스크를 정리하는 웹 애플리케이션입니다.

## 주요 기능

- PDF 및 이미지 기반 보험 청구 서류 업로드
- `gemma-4-31b-it` 기본 모델을 사용한 보험금 예상 분석
- 보장 항목별 산정표, 감액·면책 리스크, 추가 제출 서류 안내
- API 키를 브라우저에 노출하지 않는 Node 프록시 서버

## 실행 방법

```bash
GOOGLE_API_KEY=your-google-api-key npm run setup:env
npm start
```

브라우저에서 <http://localhost:3000>으로 접속합니다.

## Vercel 배포

이 프로젝트는 Vercel에서 정적 UI(`public/`)와 서버리스 API(`api/health.js`, `api/analyze.js`)로 동작합니다. Vercel 프로젝트 설정의 Environment Variables에 `GOOGLE_API_KEY`를 반드시 등록한 뒤 재배포하세요. `SERVICE_UNAVAILABLE` 또는 `The deployment is currently unavailable`가 보이면 배포가 실패했거나 서버리스 함수가 준비되지 않은 상태이므로 Vercel 배포 로그와 환경 변수를 확인해야 합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `GOOGLE_API_KEY` | 없음 | Google AI Studio / Gemini API 키 |
| `GEMMA_MODEL` | `gemma-4-31b-it` | 호출할 모델 ID |
| `PORT` | `3000` | 웹 서버 포트 |

## 보안 및 책임 안내

- 실제 API 키는 `.env`에만 저장하고 Git에 커밋하지 마세요. `npm run setup:env`는 `.env` 파일을 로컬에만 생성하며, `.gitignore`에 의해 커밋 대상에서 제외됩니다.
- 업로드되는 문서에는 민감한 개인정보가 포함될 수 있으므로 배포 전 저장 정책, 접근 통제, 전송 구간 암호화, 이용자 동의 절차를 마련해야 합니다.
- AI 분석 결과는 참고용이며 실제 보험금 지급 여부와 금액은 보험회사 심사 결과에 따라 달라질 수 있습니다.


## 문제 해결

### AI 분석 시 `Unexpected token 'T' ... is not valid JSON` 오류

이 오류는 Google API 또는 배포 환경이 JSON 대신 `The page could...` 같은 일반 텍스트/HTML 응답을 보낼 때 발생할 수 있습니다. 최신 버전은 JSON이 아닌 응답을 그대로 파싱하지 않고, 상태 코드와 응답 미리보기를 포함한 한국어 오류 메시지를 표시합니다.

확인할 항목:

1. 로컬에서는 `npm start`로 Node 서버를 실행한 뒤 `http://localhost:3000`에서 접속했는지 확인합니다. 정적 파일만 배포하면 `/api/analyze`가 없어서 HTML 오류 페이지가 반환될 수 있습니다.
2. Vercel에서는 `/api/health`가 JSON을 반환하는지 확인합니다. `The deployment is currently unavailable SERVICE_UNAVAILABLE`가 보이면 배포 로그를 확인하고 재배포하세요.
3. 로컬 `.env` 또는 Vercel Environment Variables의 `GOOGLE_API_KEY`가 올바른지 확인합니다.
4. `GEMMA_MODEL`이 Google Generative Language API에서 사용 가능한 모델 ID인지 확인합니다.


### 그래도 `GOOGLE_API_KEY` 오류가 뜨면

- 파일 이름이 정확히 `.env` 또는 `.env.local`인지 확인하세요. `env`, `emv`, `.emv`는 읽지 않습니다.
- `.env` 파일이 `package.json`과 같은 프로젝트 루트 폴더에 있는지 확인하세요.
- `.env` 안에 공백 없이 `GOOGLE_API_KEY=키값` 형태로 적었는지 확인하세요.
- `.env`를 만든 뒤에는 실행 중인 서버를 끄고 `npm start`로 다시 시작해야 합니다.
- 브라우저에서 `/api/health`를 열어 `hasApiKey`가 `true`인지 확인하세요. `config.loadedFiles`에 읽은 env 파일 이름이 표시됩니다.
- Vercel 배포라면 로컬 `.env`가 아니라 Vercel Settings → Environment Variables에 `GOOGLE_API_KEY`를 넣고 재배포해야 합니다.
