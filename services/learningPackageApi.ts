const API_BASE = '/api';

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, init);
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || '请求失败');
  return data.data;
}

export const createLearningPackage = (body: Record<string, unknown>) => request('/learning-packages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const getLearningPackage = (id: string, ownerId: string) => request(`/learning-packages/${encodeURIComponent(id)}?ownerId=${encodeURIComponent(ownerId)}`);
export const updatePlayback = (id: string, ownerId: string, event: 'completed' | 'submit', answers?: Record<string, string>) => request(`/learning-packages/${encodeURIComponent(id)}/playback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId, event, ...(answers ? { answers } : {}) }) });
