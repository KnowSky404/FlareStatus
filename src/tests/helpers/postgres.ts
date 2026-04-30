import type { SqlConnection, SqlValue } from "../../lib/sql";

export function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

type QueryHandler = (
  params?: readonly SqlValue[],
) => unknown | Promise<unknown>;

export class RecordingSqlConnection implements SqlConnection {
  readonly log: Array<{ query: string; params?: readonly SqlValue[] }> = [];
  private readonly handlers = new Map<string, QueryHandler>();

  when(query: string, handler: QueryHandler) {
    this.handlers.set(normalizeSql(query), handler);
    return this;
  }

  async unsafe<T = unknown>(
    query: string,
    params?: readonly SqlValue[],
  ): Promise<T> {
    this.log.push({ query, params });

    const handler = this.handlers.get(normalizeSql(query));

    if (!handler) {
      throw new Error(`Unexpected SQL: ${query}`);
    }

    return (await handler(params)) as T;
  }

  async begin<T>(callback: (tx: SqlConnection) => Promise<T>): Promise<T> {
    return callback(this);
  }
}
