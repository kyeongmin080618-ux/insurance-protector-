import { sendHealth, sendJson } from '../lib/insurance-ai.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: '지원하지 않는 메서드입니다.' });
    return;
  }

  sendHealth(res);
}
