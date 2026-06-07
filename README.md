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

1. `npm start`로 Node 서버를 실행한 뒤 `http://localhost:3000`에서 접속했는지 확인합니다. 정적 파일만 배포하면 `/api/analyze`가 없어서 HTML 오류 페이지가 반환될 수 있습니다.
2. `.env`의 `GOOGLE_API_KEY`가 올바른지 확인합니다.
3. `.env`의 `GEMMA_MODEL`이 Google Generative Language API에서 사용 가능한 모델 ID인지 확인합니다.
