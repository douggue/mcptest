// Thin client for the Cutroom API.

export type Job = {
  id: string;
  kind: string;
  title: string;
  meta: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  progress: number;
  message: string;
  result: any;
  error: string;
  created: number;
  finished: number | null;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('cutroom:locked'));
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* not json */
    }
    throw new Error(detail);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T = any>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T = any>(path: string) => request<T>('DELETE', path),
};

/** Multipart upload with progress (0..1). */
export function upload<T = any>(path: string, form: FormData, onProgress?: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status === 401) window.dispatchEvent(new Event('cutroom:locked'));
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new Error(typeof data?.detail === 'string' ? data.detail : xhr.statusText || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
}

/** Poll a background job until it finishes. Resolves with its result, rejects on error/cancel. */
export async function waitJob<T = any>(jobId: string, onUpdate?: (job: Job) => void): Promise<T> {
  for (;;) {
    const job = await api.get<Job>(`/api/jobs/${jobId}`);
    onUpdate?.(job);
    if (job.status === 'done') return job.result as T;
    if (job.status === 'error') throw new Error(job.error || 'Job failed');
    if (job.status === 'cancelled') throw new Error('Cancelled');
    await new Promise((r) => setTimeout(r, 450));
  }
}

export const cancelJob = (jobId: string) => api.post(`/api/jobs/${jobId}/cancel`);
