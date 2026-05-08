import { UserProfile } from '../types';

const API_BASE = '/api';

export async function fetchUsers(): Promise<UserProfile[]> {
  const resp = await fetch(`${API_BASE}/users`);
  const data = await resp.json();
  if (!data.success) throw new Error(data.error || '加载用户失败');
  return data.data;
}

export async function createUser(payload: {
  name: string;
  avatar?: string;
  birthDate?: string;
  baseGrade?: number;
}): Promise<UserProfile> {
  const resp = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!data.success) throw new Error(data.error || '创建用户失败');
  return data.data;
}

export async function updateUser(
  id: string,
  payload: Partial<{ name: string; avatar: string; birthDate: string; baseGrade: number }>
): Promise<UserProfile> {
  const resp = await fetch(`${API_BASE}/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!data.success) throw new Error(data.error || '更新用户失败');
  return data.data;
}

export async function deleteUser(id: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/users/${id}`, { method: 'DELETE' });
  const data = await resp.json();
  if (!data.success) throw new Error(data.error || '删除用户失败');
}
