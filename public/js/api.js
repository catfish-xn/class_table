// 与 Worker 接口通信

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      // 课程修改在页面切到后台/关闭时也能发出去
      keepalive: method === 'PATCH',
    });
  } catch {
    throw new ApiError('网络连接失败，请检查网络后再试');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应
  }
  if (!res.ok) throw new ApiError(data?.error || `请求失败（${res.status}）`, res.status);
  return data;
}

export const get = (path) => request('GET', path);
export const post = (path, body = {}) => request('POST', path, body);
export const put = (path, body = {}) => request('PUT', path, body);
export const patch = (path, body = {}) => request('PATCH', path, body);
export const del = (path) => request('DELETE', path);
