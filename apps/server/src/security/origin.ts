import type { FastifyRequest } from 'fastify';
import { AppError } from '../utils/errors.ts';

// No login/session state. Keep CSRF and DNS-rebinding checks for the workspace.
export class WorkspaceOrigin {
  origin = '';
  sameOrigin(request: FastifyRequest, allowed: string) {
    if (request.headers.origin !== (allowed || this.origin))
      throw new AppError('请从受信任的工作台页面发起操作', 403);
  }
}
