export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
export const safeError = (error: unknown) => error instanceof AppError || (error instanceof Error && /^(精度冲突|无效的十进制|十进制数值|数量必须|价格和步长|数量小于|数量超过|平仓计算参数|平仓激活价格)/.test(error.message)) ? error.message : '操作失败，请检查连接、权限或数据格式';
