import { analyze, getErrorStatus, sendJson } from '../lib/insurance-ai.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: '지원하지 않는 메서드입니다.' });
      return;
    }

    await analyze(req, res);
  } catch (error) {
    sendJson(res, getErrorStatus(error), { error: error.message || '서버 오류가 발생했습니다.' });
  }
}
