# Insurance Protector

보험증권, 약관, 진단서, 영수증 등 보험금 청구 서류를 업로드하면 Google AI Studio의 Gemma 모델로 예상 보험금과 리스크를 정리하는 웹 애플리케이션입니다.

## 주요 기능

- PDF 및 이미지 기반 보험 청구 서류 업로드
- `gemma-4-31b-it` 기본 모델을 사용한 보험금 예상 분석
- 보장 항목별 산정표, 감액·면책 리스크, 추가 제출 서류 안내
- API 키를 브라우저에 노출하지 않는 Node/Express 프록시 서버

## 실행 방법

```bash
cp .env.example .env
# .env 파일의 GOOGLE_API_KEY 값을 실제 Google API 키로 교체하세요.
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

- 실제 API 키는 `.env`에만 저장하고 Git에 커밋하지 마세요.
- 업로드되는 문서에는 민감한 개인정보가 포함될 수 있으므로 배포 전 저장 정책, 접근 통제, 전송 구간 암호화, 이용자 동의 절차를 마련해야 합니다.
- AI 분석 결과는 참고용이며 실제 보험금 지급 여부와 금액은 보험회사 심사 결과에 따라 달라질 수 있습니다.
