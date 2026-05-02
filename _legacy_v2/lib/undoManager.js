import { supabase } from "./supabase";

class UndoManager {
  constructor() {
    this.current   = null;
    this.listeners = new Set();
    this.timeoutId = null;
  }

  // Register a batch operation that can be undone.
  // op: { type: "save_batch" | "delete_single", ids?: [uuid], deletedRow?: object, label: string }
  register(op, duration = 5000) {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.current = { ...op, expiresAt: Date.now() + duration };
    this.notify();
    this.timeoutId = setTimeout(() => this.clear(), duration);
  }

  async undo() {
    if (!this.current) return { undone: 0 };
    const op = this.current;
    this.clear();

    if (op.type === "save_batch" && op.ids?.length) {
      const { error } = await supabase.from("ledger").delete().in("id", op.ids);
      if (error) throw new Error(error.message);
      return { undone: op.ids.length };
    }
    if (op.type === "delete_single" && op.deletedRow) {
      const { id, ...rest } = op.deletedRow;
      const { error } = await supabase.from("ledger").insert({ id, ...rest });
      if (error) throw new Error(error.message);
      return { undone: 1 };
    }
    return { undone: 0 };
  }

  clear() {
    this.current = null;
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.timeoutId = null;
    this.notify();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach(l => l(this.current));
  }
}

export const undoManager = new UndoManager();
