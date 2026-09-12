import type { Request, Response, NextFunction } from "express";

export function validateIsolationInstruction(req: Request, res: Response, next: NextFunction): void {
  const { skipIsolationInstruction } = req.body ?? {};
  if (skipIsolationInstruction !== undefined && typeof skipIsolationInstruction !== "boolean") {
    res.status(400).json({ error: "skipIsolationInstruction deve ser booleano" });
    return;
  }
  if (skipIsolationInstruction === true && req.ctx?.role !== "admin") {
    res.status(403).json({ error: "Somente administradores podem omitir a instrução de isolamento" });
    return;
  }

  next();
}
