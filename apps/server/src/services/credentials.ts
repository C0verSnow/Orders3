import type { Configuration } from '../config/index.ts';
import { credential, serviceUrl } from '../config/index.ts';
import type { HttpClient } from '../exchange/http.ts';
import { object, text } from '../exchange/http.ts';
import { AppError } from '../utils/errors.ts';

export class Credentials {
  generation = 0;
  timer?: ReturnType<typeof setTimeout>;
  stopped = false;
  private config: Configuration;
  private http: HttpClient;
  constructor(config: Configuration, http: HttpClient) { this.config = config; this.http = http; }
  async refresh(retry = true): Promise<void> {
    clearTimeout(this.timer);
    const generation = ++this.generation, env = this.config.startup;
    const clientId = env.INFISICAL_CLIENT_ID ?? env.CLIENT_ID, clientSecret = env.INFISICAL_CLIENT_SECRET ?? env.CLIENT_SECRET;
    if (!clientId && !clientSecret && !env.INFISICAL_PROJECT_ID) return;
    let failed = false;
    try {
      if (!clientId || !clientSecret || !env.INFISICAL_PROJECT_ID) throw new AppError('机器认证配置不完整');
      const base = serviceUrl(env.INFISICAL_URL || 'https://app.infisical.com', true);
      const auth = await this.http.request('credentials', new URL('/api/v1/auth/universal-auth/login', base), 'POST', { 'Content-Type': 'application/json' }, JSON.stringify({ clientId, clientSecret }));
      if (auth.status < 200 || auth.status >= 300) throw new AppError('认证失败');
      const token = credential(text(object(auth.data).accessToken));
      if (!token) throw new AppError('认证令牌无效');
      const values: Record<string, string> = {};
      for (const [name, local] of [['GATE_API_KEY', 'API_KEY'], ['GATE_API_SECRET', 'API_SECRET']]) {
        try {
          const url = new URL(`/api/v4/secrets/${name}`, base);
          url.search = new URLSearchParams({ projectId: env.INFISICAL_PROJECT_ID, environment: env.INFISICAL_ENVIRONMENT || 'prod', secretPath: env.INFISICAL_SECRET_PATH || '/', type: 'shared' }).toString();
          const response = await this.http.request('credentials', url, 'GET', { Authorization: `Bearer ${token}`, Accept: 'application/json' });
          if (response.status < 200 || response.status >= 300) throw new AppError('密钥读取失败');
          const secret = object(object(response.data).secret), value = credential(text(secret.secretValue));
          if (secret.secretKey !== name || secret.secretValueHidden || !value) throw new AppError('密钥无效');
          values[local] = value;
        } catch { failed = true; }
      }
      if (this.generation === generation && !this.stopped) this.config.setFallback(values);
    } catch { failed = true; }
    if (failed && this.generation === generation && !this.stopped) {
      if (retry) this.timer = setTimeout(() => { void this.refresh(); }, 5000);
      console.error('Infisical 备用凭证获取失败，请检查机器认证和读取权限；保留上次成功值');
    }
  }
  stop() { this.stopped = true; this.generation++; clearTimeout(this.timer); }
}
