import type { NextApiRequest, NextApiResponse } from 'next';
import {
  clearPersonalSessionCookie,
  hasSameOrigin,
  hasValidPersonalSession,
  setPersonalSessionCookie,
  verifyPersonalPassword,
} from '../../lib/server/personalSession';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return res.status(200).json({ authenticated: hasValidPersonalSession(req) });
  if (req.method === 'DELETE') {
    if (!hasSameOrigin(req)) return res.status(403).json({ message: '허용되지 않은 요청입니다.' });
    clearPersonalSessionCookie(res);
    return res.status(200).json({ authenticated: false });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ message: '지원하지 않는 요청입니다.' });
  }
  if (!hasSameOrigin(req)) return res.status(403).json({ message: '허용되지 않은 요청입니다.' });
  if (!verifyPersonalPassword(req.body?.password)) {
    await new Promise(resolve => setTimeout(resolve, 350));
    return res.status(401).json({ message: '비밀번호가 올바르지 않습니다.' });
  }
  setPersonalSessionCookie(res);
  return res.status(200).json({ authenticated: true });
}
